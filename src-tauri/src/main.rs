// Hide the extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod project;
mod textfile;
mod transcribe;
mod vault;

use serde::Serialize;
use std::{path::PathBuf, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use project::{Content, Entry, OpenError, ProjectFile, Student};
use vault::{Key, Profile, RecoveryError};
use zeroize::Zeroizing;

/// Unlocked master key of the person who is working now; dropped (and zeroed) on lock.
struct Session {
    id: String,
    master: Key,
}

/// A profile being created: written to disk only after the recovery words are checked.
struct Pending {
    profile: Profile,
    master: Key,
    words: Vec<String>,
    check: [usize; 3],
}

#[derive(Default)]
struct AppState {
    session: Mutex<Option<Session>>,
    pending: Mutex<Option<Pending>>,
    /// Supervisor's half of a just-created student project, until it is saved to a file.
    pending_half: Mutex<Option<(String, String, Zeroizing<Vec<u8>>)>>,
    jobs: transcribe::Jobs,
}

#[derive(Serialize)]
struct ProfileInfo {
    id: String,
    name: String,
    initials: String,
    autolock_min: u32,
}

impl From<&Profile> for ProfileInfo {
    fn from(p: &Profile) -> Self {
        ProfileInfo { id: p.id.clone(), name: p.name.clone(), initials: p.initials.clone(), autolock_min: p.autolock_min }
    }
}

#[derive(Serialize)]
struct NewProfile {
    words: Vec<String>,
    check: [usize; 3],
}

type Res<T> = Result<T, String>;

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn dir(app: &AppHandle) -> Res<PathBuf> {
    app.path().app_data_dir().map(|d| d.join("profiles")).map_err(|e| e.to_string())
}

fn io(e: std::io::Error) -> String {
    format!("io:{e}")
}

fn check_password(pw: &str) -> Res<()> {
    if pw.chars().count() < vault::MIN_PASSWORD_CHARS {
        return Err("short_password".into());
    }
    Ok(())
}

fn start_session(state: &AppState, p: &Profile, master: Key) -> ProfileInfo {
    *state.session.lock().unwrap() = Some(Session { id: p.id.clone(), master });
    ProfileInfo::from(p)
}

fn current_id(state: &AppState) -> Res<String> {
    state.session.lock().unwrap().as_ref().map(|s| s.id.clone()).ok_or_else(|| "locked".into())
}

#[tauri::command]
fn list_profiles(app: AppHandle) -> Res<Vec<ProfileInfo>> {
    Ok(vault::load_all(&dir(&app)?).iter().map(ProfileInfo::from).collect())
}

#[tauri::command]
async fn begin_profile(state: State<'_, AppState>, name: String, initials: String, password: String) -> Res<NewProfile> {
    let (name, initials) = (name.trim().to_string(), initials.trim().to_uppercase());
    let ini_len = initials.chars().count();
    if name.is_empty() || name.chars().count() > 100 || ini_len == 0 || ini_len > 3 {
        return Err("bad_name".into());
    }
    check_password(&password)?;
    let (profile, master, words) = Profile::create(vault::new_id(), name, initials, &password, now());
    let mut check = [0usize; 3];
    let mut pool: Vec<usize> = (1..=12).collect();
    for c in check.iter_mut() {
        let mut b = [0u8; 1];
        chacha20poly1305::aead::rand_core::RngCore::fill_bytes(&mut chacha20poly1305::aead::OsRng, &mut b);
        *c = pool.remove(b[0] as usize % pool.len());
    }
    check.sort();
    let out = NewProfile { words: words.clone(), check };
    *state.pending.lock().unwrap() = Some(Pending { profile, master, words, check });
    Ok(out)
}

/// `answers` are the words at the `check` positions, in order. Returns the wrong positions, if any.
#[tauri::command]
fn confirm_profile(app: AppHandle, state: State<'_, AppState>, answers: Vec<String>) -> Res<ProfileInfo> {
    let mut pending = state.pending.lock().unwrap();
    let p = pending.as_ref().ok_or("no_pending")?;
    let wrong: Vec<String> = p
        .check
        .iter()
        .zip(answers.iter().chain(std::iter::repeat(&String::new())))
        .filter(|(n, a)| a.trim().to_lowercase() != p.words[**n - 1])
        .map(|(n, _)| n.to_string())
        .collect();
    if !wrong.is_empty() {
        return Err(format!("mismatch:{}", wrong.join(",")));
    }
    let p = pending.take().unwrap();
    vault::save(&dir(&app)?, &p.profile).map_err(io)?;
    Ok(start_session(&state, &p.profile, p.master))
}

#[tauri::command]
fn cancel_profile(state: State<'_, AppState>) {
    *state.pending.lock().unwrap() = None;
}

#[tauri::command]
async fn unlock(app: AppHandle, state: State<'_, AppState>, id: String, password: String) -> Res<ProfileInfo> {
    let d = dir(&app)?;
    let mut p = vault::load(&d, &id).map_err(io)?;
    let wait = p.wait_secs(now());
    if wait > 0 {
        return Err(format!("wait:{wait}"));
    }
    match p.unlock(&password) {
        Some(master) => {
            if p.failed > 0 {
                p.register_success();
                vault::save(&d, &p).map_err(io)?;
            }
            Ok(start_session(&state, &p, master))
        }
        None => {
            p.register_failure(now());
            vault::save(&d, &p).map_err(io)?;
            let wait = p.wait_secs(now());
            Err(if wait > 0 { format!("wait:{wait}") } else { "wrong".into() })
        }
    }
}

/// Removes a profile from this computer; needs its password. Project files stay where they are.
#[tauri::command]
async fn delete_profile(app: AppHandle, state: State<'_, AppState>, id: String, password: String) -> Res<()> {
    let d = dir(&app)?;
    let mut p = vault::load(&d, &id).map_err(io)?;
    let wait = p.wait_secs(now());
    if wait > 0 {
        return Err(format!("wait:{wait}"));
    }
    if p.unlock(&password).is_none() {
        p.register_failure(now());
        vault::save(&d, &p).map_err(io)?;
        let wait = p.wait_secs(now());
        return Err(if wait > 0 { format!("wait:{wait}") } else { "wrong".into() });
    }
    vault::delete(&d, &id).map_err(io)?;
    let mut session = state.session.lock().unwrap();
    if session.as_ref().is_some_and(|s| s.id == id) {
        *session = None;
    }
    Ok(())
}

fn recovery_err(e: RecoveryError) -> String {
    match e {
        RecoveryError::BadWords => "bad_words".into(),
        RecoveryError::WrongKey => "wrong_key".into(),
    }
}

#[tauri::command]
async fn check_recovery(app: AppHandle, id: String, phrase: String) -> Res<()> {
    let p = vault::load(&dir(&app)?, &id).map_err(io)?;
    p.unlock_with_recovery(&phrase).map(|_| ()).map_err(recovery_err)
}

#[tauri::command]
async fn recover(app: AppHandle, state: State<'_, AppState>, id: String, phrase: String, password: String) -> Res<ProfileInfo> {
    check_password(&password)?;
    let d = dir(&app)?;
    let mut p = vault::load(&d, &id).map_err(io)?;
    let master = p.unlock_with_recovery(&phrase).map_err(recovery_err)?;
    p.set_password(&master, &password);
    p.register_success();
    vault::save(&d, &p).map_err(io)?;
    Ok(start_session(&state, &p, master))
}

#[tauri::command]
async fn change_password(app: AppHandle, state: State<'_, AppState>, current: String, password: String) -> Res<()> {
    check_password(&password)?;
    let d = dir(&app)?;
    let mut p = vault::load(&d, &current_id(&state)?).map_err(io)?;
    let master = p.unlock(&current).ok_or("wrong")?;
    p.set_password(&master, &password);
    vault::save(&d, &p).map_err(io)
}

#[tauri::command]
fn set_autolock(app: AppHandle, state: State<'_, AppState>, minutes: u32) -> Res<()> {
    if ![5, 15, 30, 60].contains(&minutes) {
        return Err("bad_minutes".into());
    }
    let d = dir(&app)?;
    let mut p = vault::load(&d, &current_id(&state)?).map_err(io)?;
    p.autolock_min = minutes;
    vault::save(&d, &p).map_err(io)
}

#[tauri::command]
fn lock(state: State<'_, AppState>) {
    *state.session.lock().unwrap() = None;
    *state.pending_half.lock().unwrap() = None;
}

/// `Some(true)` if the system disk is encrypted, `None` if we cannot tell.
#[tauri::command]
fn disk_encryption() -> Option<bool> {
    if cfg!(target_os = "macos") {
        let out = std::process::Command::new("/usr/bin/fdesetup").arg("status").output().ok()?;
        return Some(String::from_utf8_lossy(&out.stdout).contains("FileVault is On"));
    }
    // shortcut: Windows needs admin rights to query BitLocker; show the advice instead.
    None
}

#[tauri::command]
fn open_disk_settings() -> Res<()> {
    let r = if cfg!(target_os = "macos") {
        std::process::Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?FileVault")
            .spawn()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("explorer").arg("ms-settings:deviceencryption").spawn()
    } else {
        return Err("unsupported".into());
    };
    r.map(|_| ()).map_err(io)
}

#[tauri::command]
fn print_page(window: WebviewWindow) -> Res<()> {
    window.print().map_err(|e| e.to_string())
}

// ---------- projects (step 1.2) ----------

/// Runs `f` with the logged-in profile and its master key, then saves the profile.
fn with_profile<T>(app: &AppHandle, state: &AppState, f: impl FnOnce(&mut Profile, &Key) -> Res<T>) -> Res<T> {
    let session = state.session.lock().unwrap();
    let s = session.as_ref().ok_or("locked")?;
    let d = dir(app)?;
    let mut p = vault::load(&d, &s.id).map_err(io)?;
    let out = f(&mut p, &s.master)?;
    vault::save(&d, &p).map_err(io)?;
    Ok(out)
}

fn open_err(e: OpenError) -> String {
    match e {
        OpenError::NotAProject => "not_a_project".into(),
        OpenError::WrongSecret => "wrong".into(),
        OpenError::BadWords => "bad_words".into(),
        OpenError::HalfMismatch => "half_mismatch".into(),
    }
}

fn projects_dir(app: &AppHandle) -> Res<PathBuf> {
    app.path().document_dir().map(|d| d.join("QDA")).map_err(|e| e.to_string())
}

fn entry_of(f: &ProjectFile, c: &Content, path: &std::path::Path, last_backup: Option<u64>) -> Entry {
    Entry {
        id: f.id.clone(),
        name: c.name.clone(),
        method: c.method.clone(),
        student: c.student.clone(),
        path: path.to_string_lossy().into(),
        modified: c.modified,
        last_backup,
    }
}

/// Copies an opened file into the projects folder under the current owner and lists it.
fn add_copy(app: &AppHandle, p: &mut Profile, master: &Key, mut f: ProjectFile, pk: &Key) -> Res<Entry> {
    let c = f.content(pk).ok_or("not_a_project")?;
    let mut list = project::entries(p, master);
    if list.iter().any(|e| e.id == f.id) {
        return Err("already_in_list".into());
    }
    f.adopt(p, master, pk);
    let d = projects_dir(app)?;
    std::fs::create_dir_all(&d).map_err(io)?;
    let path = project::free_path(&d, &project::file_stem(&c.name), "qda");
    f.write(&path).map_err(io)?;
    let e = entry_of(&f, &c, &path, None);
    list.push(e.clone());
    project::set_entries(p, master, &list);
    Ok(e)
}

#[derive(Serialize)]
struct ListedProject {
    #[serde(flatten)]
    entry: Entry,
    exists: bool,
}

#[tauri::command]
fn list_projects(app: AppHandle, state: State<'_, AppState>) -> Res<Vec<ListedProject>> {
    let session = state.session.lock().unwrap();
    let s = session.as_ref().ok_or("locked")?;
    let p = vault::load(&dir(&app)?, &s.id).map_err(io)?;
    Ok(project::entries(&p, &s.master)
        .into_iter()
        .map(|e| ListedProject { exists: std::path::Path::new(&e.path).exists(), entry: e })
        .collect())
}

#[tauri::command]
fn default_folder(app: AppHandle) -> Res<String> {
    Ok(projects_dir(&app)?.to_string_lossy().into())
}

#[derive(Serialize)]
struct Created {
    entry: Entry,
    words: Option<Vec<String>>,
}

#[tauri::command]
async fn create_project(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    method: String,
    work: Option<String>,
    supervisor: Option<String>,
    folder: Option<String>,
) -> Res<Created> {
    let name = name.trim().to_string();
    if name.is_empty() || name.chars().count() > 200 || !["ІФА", "Дескр.", "РТА"].contains(&method.as_str()) {
        return Err("bad_input".into());
    }
    let student = match (work, supervisor) {
        (Some(w), Some(s)) if !s.trim().is_empty() && ["курсова", "бакалаврська", "магістерська"].contains(&w.as_str()) => {
            Some(Student { work: w, supervisor: s.trim().into() })
        }
        (None, None) => None,
        _ => return Err("bad_input".into()),
    };
    let d = match folder {
        Some(f) => PathBuf::from(f),
        None => projects_dir(&app)?,
    };
    std::fs::create_dir_all(&d).map_err(io)?;
    let t = now();
    let content = Content { name: name.clone(), method, student, created: t, modified: t, data: serde_json::Value::Null };
    with_profile(&app, &state, |p, master| {
        let (f, halves) = ProjectFile::create(p, master, &content);
        let path = project::free_path(&d, &project::file_stem(&name), "qda");
        f.write(&path).map_err(io)?;
        let e = entry_of(&f, &content, &path, None);
        let mut list = project::entries(p, master);
        list.push(e.clone());
        project::set_entries(p, master, &list);
        let words = halves.map(|(words, supervisor)| {
            *state.pending_half.lock().unwrap() = Some((f.id.clone(), name.clone(), supervisor));
            words
        });
        Ok(Created { entry: e, words })
    })
}

#[tauri::command]
fn save_supervisor_half(state: State<'_, AppState>, path: String) -> Res<()> {
    let pending = state.pending_half.lock().unwrap();
    let (id, name, half) = pending.as_ref().ok_or("no_pending")?;
    project::write_half_file(std::path::Path::new(&path), id, name, half).map_err(io)
}

#[tauri::command]
fn forget_supervisor_half(state: State<'_, AppState>) {
    *state.pending_half.lock().unwrap() = None;
}

fn find(p: &Profile, master: &Key, id: &str) -> Res<Entry> {
    project::entries(p, master).into_iter().find(|e| e.id == id).ok_or_else(|| "not_found".into())
}

#[tauri::command]
async fn backup_project(app: AppHandle, state: State<'_, AppState>, id: String, dest: String) -> Res<()> {
    let dest = PathBuf::from(dest);
    if dest.extension().map_or(true, |x| x != "qda") {
        return Err("bad_input".into());
    }
    with_profile(&app, &state, |p, master| {
        let mut list = project::entries(p, master);
        let e = list.iter_mut().find(|e| e.id == id).ok_or("not_found")?;
        let mut f = ProjectFile::read(std::path::Path::new(&e.path)).map_err(|_| format!("missing:{}", e.path))?;
        f.refresh_owner(p);
        f.write(&dest).map_err(io)?;
        // Check the copy really opens before saying it is saved.
        let copy = ProjectFile::read(&dest).map_err(open_err)?;
        copy.project_key(master).and_then(|pk| copy.content(&pk)).ok_or("backup_unreadable")?;
        e.last_backup = Some(now());
        project::set_entries(p, master, &list);
        Ok(())
    })
}

#[derive(Serialize)]
struct Inspected {
    /// "mine": my project; "other": another profile's (name of owner given).
    kind: &'static str,
    owner_name: String,
    owner_here: bool,
    has_halves: bool,
    name: Option<String>,
    modified: Option<u64>,
    in_list: bool,
}

#[tauri::command]
async fn inspect_backup(app: AppHandle, state: State<'_, AppState>, path: String) -> Res<Inspected> {
    let f = ProjectFile::read(std::path::Path::new(&path)).map_err(open_err)?;
    let session = state.session.lock().unwrap();
    let s = session.as_ref().ok_or("locked")?;
    let d = dir(&app)?;
    if f.owner.id == s.id {
        let p = vault::load(&d, &s.id).map_err(io)?;
        let c = f.project_key(&s.master).and_then(|pk| f.content(&pk)).ok_or("not_a_project")?;
        let in_list = project::entries(&p, &s.master).iter().any(|e| e.id == f.id);
        return Ok(Inspected { kind: "mine", owner_name: f.owner.name.clone(), owner_here: true, has_halves: f.has_halves(), name: Some(c.name), modified: Some(c.modified), in_list });
    }
    Ok(Inspected {
        kind: "other",
        owner_here: vault::load(&d, &f.owner.id).is_ok(),
        owner_name: f.owner.name.clone(),
        has_halves: f.has_halves(),
        name: None,
        modified: None,
        in_list: false,
    })
}

/// mode: "replace" keeps the current version next to it first; "separate" makes a new project.
#[tauri::command]
async fn restore_mine(app: AppHandle, state: State<'_, AppState>, path: String, mode: String, today: String) -> Res<Entry> {
    let today: String = today.chars().filter(|c| c.is_ascii_digit() || *c == '-').take(10).collect();
    let f = ProjectFile::read(std::path::Path::new(&path)).map_err(open_err)?;
    with_profile(&app, &state, |p, master| {
        let pk = f.project_key(master).ok_or("wrong")?;
        let c = f.content(&pk).ok_or("not_a_project")?;
        let mut list = project::entries(p, master);
        match (mode.as_str(), list.iter().position(|e| e.id == f.id)) {
            ("replace", Some(i)) => {
                let target = PathBuf::from(&list[i].path);
                if target.exists() {
                    let stem = target.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                    let keep = project::free_path(target.parent().ok_or("bad_path")?, &format!("{stem} — перед відновленням {today}"), "qda");
                    std::fs::copy(&target, keep).map_err(io)?;
                }
                let mut g = f.clone();
                g.refresh_owner(p);
                g.write(&target).map_err(io)?;
                list[i] = entry_of(&g, &c, &target, list[i].last_backup);
                project::set_entries(p, master, &list);
                Ok(list[i].clone())
            }
            ("separate", Some(_)) => {
                let mut c2 = c.clone();
                c2.name = format!("{} (копія {today})", c.name);
                let mut g = f.duplicate(p, master, &c2);
                let pk2 = g.project_key(master).ok_or("wrong")?;
                g.set_content(&pk2, &c2);
                g.set_private(&pk2, &f.private(&pk).ok_or("not_a_project")?);
                add_copy(&app, p, master, g, &pk2)
            }
            (_, None) => add_copy(&app, p, master, f.clone(), &pk),
            _ => Err("bad_input".into()),
        }
    })
}

/// A copy from a profile that is not on this computer: its password or words bring back the profile and the project.
#[tauri::command]
async fn restore_foreign(app: AppHandle, path: String, secret: String, way: String) -> Res<String> {
    let f = ProjectFile::read(std::path::Path::new(&path)).map_err(open_err)?;
    let master = match way.as_str() {
        "password" => f.owner.unlock(&secret).ok_or("wrong")?,
        "words" => f.owner.unlock_with_recovery(&secret).map_err(recovery_err)?,
        _ => return Err("bad_input".into()),
    };
    let pk = f.project_key(&master).ok_or("wrong")?;
    let d = dir(&app)?;
    let mut p = vault::load(&d, &f.owner.id).unwrap_or_else(|_| Profile::from_owner(&f.owner));
    match add_copy(&app, &mut p, &master, f.clone(), &pk) {
        Ok(_) => {}
        Err(e) if e == "already_in_list" => {}
        Err(e) => return Err(e),
    }
    vault::save(&d, &p).map_err(io)?;
    Ok(p.name)
}

/// Student project after losing both password and profile key: their words + the supervisor's file.
#[tauri::command]
async fn restore_halves(app: AppHandle, state: State<'_, AppState>, path: String, words: String, half: String) -> Res<Entry> {
    let f = ProjectFile::read(std::path::Path::new(&path)).map_err(open_err)?;
    let pk = f.project_key_by_halves(&words, std::path::Path::new(&half)).map_err(open_err)?;
    with_profile(&app, &state, |p, master| add_copy(&app, p, master, f.clone(), &pk))
}

// ---------- interviews (step 1.3) ----------

#[tauri::command]
async fn read_transcript(path: String) -> Res<String> {
    textfile::read(std::path::Path::new(&path))
}

#[derive(Serialize)]
struct Loaded {
    content: Content,
    private: serde_json::Value,
}

#[tauri::command]
async fn load_project(app: AppHandle, state: State<'_, AppState>, id: String) -> Res<Loaded> {
    with_profile(&app, &state, |p, master| {
        let e = find(p, master, &id)?;
        let f = ProjectFile::read(std::path::Path::new(&e.path)).map_err(|_| format!("missing:{}", e.path))?;
        let pk = f.project_key(master).ok_or("wrong")?;
        Ok(Loaded { content: f.content(&pk).ok_or("not_a_project")?, private: f.private(&pk).ok_or("not_a_project")? })
    })
}

/// Saves the window's data: `data` (shared part) and `private` (originals, dictionary). Returns the save time.
#[tauri::command]
async fn save_project(app: AppHandle, state: State<'_, AppState>, id: String, data: serde_json::Value, private: serde_json::Value) -> Res<u64> {
    with_profile(&app, &state, |p, master| {
        let mut list = project::entries(p, master);
        let e = list.iter_mut().find(|e| e.id == id).ok_or("not_found")?;
        let path = PathBuf::from(&e.path);
        let mut f = ProjectFile::read(&path).map_err(|_| format!("missing:{}", e.path))?;
        let pk = f.project_key(master).ok_or("wrong")?;
        let mut c = f.content(&pk).ok_or("not_a_project")?;
        c.data = data;
        c.modified = now();
        f.set_content(&pk, &c);
        f.set_private(&pk, &private);
        f.refresh_owner(p);
        f.write(&path).map_err(io)?;
        e.modified = c.modified;
        project::set_entries(p, master, &list);
        Ok(c.modified)
    })
}

// ---------- audio (step 2.1) ----------

/// The recording chosen for an interview: returns its fingerprint and lets the window play it.
#[tauri::command]
async fn attach_audio(app: AppHandle, path: String) -> Res<String> {
    let p = std::path::Path::new(&path);
    if !audio::is_audio(p) {
        return Err("not_audio".into());
    }
    let fp = audio::fingerprint(p).map_err(io)?;
    app.asset_protocol_scope().allow_file(p).map_err(|e| e.to_string())?;
    Ok(fp)
}

/// On opening a project: "ok" (and playable), "missing" or "changed" (another file at that path).
#[tauri::command]
async fn allow_audio(app: AppHandle, path: String, fingerprint: String) -> Res<String> {
    let p = std::path::Path::new(&path);
    if !audio::is_audio(p) || !p.exists() {
        return Ok("missing".into());
    }
    if audio::fingerprint(p).map_err(io)? != fingerprint {
        return Ok("changed".into());
    }
    app.asset_protocol_scope().allow_file(p).map_err(|e| e.to_string())?;
    Ok("ok".into())
}

// ---------- transcription (step 2.2) ----------

fn models_dir(app: &AppHandle) -> Res<PathBuf> {
    app.path().app_data_dir().map(|d| d.join("models")).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct ModelState {
    id: &'static str,
    label: &'static str,
    mib: u64,
    downloaded: bool,
    download: Option<transcribe::Progress>,
}

#[tauri::command]
fn models_list(app: AppHandle, state: State<'_, AppState>) -> Res<Vec<ModelState>> {
    let d = models_dir(&app)?;
    let downloads = state.jobs.downloads.lock().unwrap();
    Ok(transcribe::MODELS
        .iter()
        .map(|m| ModelState { id: m.id, label: m.label, mib: m.mib, downloaded: transcribe::model_path(&d, m.id).exists(), download: downloads.get(m.id).cloned() })
        .collect())
}

#[tauri::command]
fn download_model(app: AppHandle, state: State<'_, AppState>, id: String) -> Res<()> {
    let m = transcribe::model(&id).ok_or("bad_input")?;
    if state.jobs.downloads.lock().unwrap().get(m.id).is_some_and(|p| p.state == "running") {
        return Ok(());
    }
    transcribe::download(&state.jobs, models_dir(&app)?, m);
    Ok(())
}

/// Starts transcribing in the background; `job` is the interview id.
#[tauri::command]
fn start_transcription(app: AppHandle, state: State<'_, AppState>, job: String, path: String, model: String, language: String) -> Res<()> {
    if job.is_empty() || job.len() > 64 || !job.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("bad_input".into());
    }
    if !["auto", "uk", "ru", "en"].contains(&language.as_str()) || !audio::is_audio(std::path::Path::new(&path)) {
        return Err("bad_input".into());
    }
    let m = transcribe::model(&model).ok_or("bad_input")?;
    let file = transcribe::model_path(&models_dir(&app)?, m.id);
    if !file.exists() {
        return Err("no_model".into());
    }
    transcribe::start(&state.jobs, job, PathBuf::from(path), file, language);
    Ok(())
}

#[tauri::command]
fn cancel_transcription(state: State<'_, AppState>, job: String) {
    transcribe::cancel(&state.jobs, &job);
}

/// None: no such job in this run of the program (e.g. it was closed meanwhile). Finished results are handed over once.
#[tauri::command]
fn transcription_status(state: State<'_, AppState>, job: String) -> Option<transcribe::Progress> {
    let mut map = state.jobs.transcriptions.lock().unwrap();
    let p = map.get(&job).cloned()?;
    if p.state != "running" {
        map.remove(&job);
    }
    Some(p)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            begin_profile,
            confirm_profile,
            cancel_profile,
            unlock,
            check_recovery,
            recover,
            change_password,
            set_autolock,
            lock,
            delete_profile,
            disk_encryption,
            open_disk_settings,
            print_page,
            list_projects,
            default_folder,
            create_project,
            save_supervisor_half,
            forget_supervisor_half,
            backup_project,
            inspect_backup,
            restore_mine,
            restore_foreign,
            restore_halves,
            read_transcript,
            load_project,
            save_project,
            attach_audio,
            allow_audio,
            models_list,
            download_model,
            start_transcription,
            transcription_status,
            cancel_transcription
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Платформа QDA");
}
