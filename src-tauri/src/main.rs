// Hide the extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod vault;

use serde::Serialize;
use std::{path::PathBuf, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use vault::{Key, Profile, RecoveryError};

/// Unlocked master key of the person who is working now; dropped (and zeroed) on lock.
struct Session {
    id: String,
    _master: Key,
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
    *state.session.lock().unwrap() = Some(Session { id: p.id.clone(), _master: master });
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

fn main() {
    tauri::Builder::default()
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
            disk_encryption,
            open_disk_settings,
            print_page
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Платформа QDA");
}
