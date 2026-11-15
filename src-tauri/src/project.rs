//! Project files (.qda): one file per project, everything inside encrypted.
//!
//! The file carries its owner's sealed master key (the same seals as the
//! profile), so any copy of it opens on any computer with the owner's password
//! or recovery words. The project key is sealed with the master key and, for
//! student projects, also with two halves held by student and supervisor.

use crate::vault::{self, Blob, Key, Owner, Profile, RecoveryError, Sealed};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

const FORMAT: &str = "qda-project";
const HALF_FORMAT: &str = "qda-key-half";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectFile {
    format: String,
    v: u32,
    pub id: String,
    pub owner: Owner,
    pk_by_master: Blob,
    #[serde(default)]
    pk_by_halves: Option<Sealed>,
    content: Blob,
}

/// What is inside the encrypted part. Later steps add interviews, codes, text.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Content {
    pub name: String,
    pub method: String,
    #[serde(default)]
    pub student: Option<Student>,
    pub created: u64,
    pub modified: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Student {
    pub work: String,
    pub supervisor: String,
}

/// One line of "Мої проєкти", kept encrypted in the profile.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub method: String,
    pub student: Option<Student>,
    pub path: String,
    pub modified: u64,
    pub last_backup: Option<u64>,
}

#[derive(Serialize, Deserialize)]
struct HalfFile {
    format: String,
    v: u32,
    project_id: String,
    project_name: String,
    half: String,
}

#[derive(Debug, PartialEq)]
pub enum OpenError {
    NotAProject,
    WrongSecret,
    BadWords,
    HalfMismatch,
}

fn aad_pk(p: &str, owner: &str) -> String {
    format!("qda:{p}:{owner}:project-key")
}
fn aad_content(p: &str) -> String {
    format!("qda:{p}:content")
}
fn aad_halves(p: &str) -> String {
    format!("qda:{p}:halves")
}
fn aad_list(owner: &str) -> String {
    format!("qda:{owner}:projects")
}

/// Student's 16 bytes (as 12 words) + supervisor's 32 bytes; only both together open the project.
fn halves_secret(student: &[u8], supervisor: &[u8]) -> Zeroizing<Vec<u8>> {
    Zeroizing::new([student, supervisor].concat())
}

impl ProjectFile {
    /// For student projects also returns the student's 12 words and the supervisor's half.
    pub fn create(owner: &Profile, master: &Key, content: &Content) -> (ProjectFile, Option<(Vec<String>, Zeroizing<Vec<u8>>)>) {
        let id = vault::new_id();
        let pk = vault::new_key();
        let mut halves = None;
        let pk_by_halves = content.student.as_ref().map(|_| {
            let (student, words) = vault::new_phrase();
            let supervisor = vault::new_key();
            let sealed = vault::seal(&halves_secret(student.as_ref(), supervisor.as_ref()), &aad_halves(&id), pk.as_ref());
            halves = Some((words, Zeroizing::new(supervisor.to_vec())));
            sealed
        });
        let f = ProjectFile {
            format: FORMAT.into(),
            v: 1,
            pk_by_master: vault::lock(master, &aad_pk(&id, &owner.id), pk.as_ref()),
            content: vault::lock(&pk, &aad_content(&id), &serde_json::to_vec(content).unwrap()),
            pk_by_halves,
            owner: owner.owner(),
            id,
        };
        (f, halves)
    }

    pub fn read(path: &Path) -> Result<ProjectFile, OpenError> {
        let f: ProjectFile = serde_json::from_slice(&fs::read(path).map_err(|_| OpenError::NotAProject)?).map_err(|_| OpenError::NotAProject)?;
        if f.format != FORMAT || !vault::valid_id(&f.id) || !vault::valid_id(&f.owner.id) {
            return Err(OpenError::NotAProject);
        }
        Ok(f)
    }

    pub fn project_key(&self, master: &Key) -> Option<Key> {
        vault::to_key(&vault::unlock(master, &aad_pk(&self.id, &self.owner.id), &self.pk_by_master)?)
    }

    pub fn content(&self, pk: &Key) -> Option<Content> {
        serde_json::from_slice(&vault::unlock(pk, &aad_content(&self.id), &self.content)?).ok()
    }

    pub fn set_content(&mut self, pk: &Key, c: &Content) {
        self.content = vault::lock(pk, &aad_content(&self.id), &serde_json::to_vec(c).unwrap());
    }

    pub fn has_halves(&self) -> bool {
        self.pk_by_halves.is_some()
    }

    /// Opens with the student's words and the supervisor's half file.
    pub fn project_key_by_halves(&self, words: &str, half_file: &Path) -> Result<Key, OpenError> {
        let sealed = self.pk_by_halves.as_ref().ok_or(OpenError::WrongSecret)?;
        let half: HalfFile = serde_json::from_slice(&fs::read(half_file).map_err(|_| OpenError::HalfMismatch)?).map_err(|_| OpenError::HalfMismatch)?;
        if half.format != HALF_FORMAT || half.project_id != self.id {
            return Err(OpenError::HalfMismatch);
        }
        let supervisor = Zeroizing::new(B64.decode(&half.half).map_err(|_| OpenError::HalfMismatch)?);
        let student = vault::phrase_entropy(words).map_err(|e| match e {
            RecoveryError::BadWords => OpenError::BadWords,
            RecoveryError::WrongKey => OpenError::WrongSecret,
        })?;
        vault::open(&halves_secret(&student, &supervisor), &aad_halves(&self.id), sealed).ok_or(OpenError::WrongSecret)
    }

    /// Hands the project to (another) profile: the owner header and the master seal change, the content does not.
    pub fn adopt(&mut self, owner: &Profile, master: &Key, pk: &Key) {
        self.owner = owner.owner();
        self.pk_by_master = vault::lock(master, &aad_pk(&self.id, &owner.id), pk.as_ref());
    }

    /// The owner's seals change when the password changes; keep the file's copy current.
    pub fn refresh_owner(&mut self, owner: &Profile) {
        if owner.id == self.owner.id {
            self.owner = owner.owner();
        }
    }

    /// A separate copy with its own id and key (for "Відкрити як окремий проєкт").
    pub fn duplicate(&self, owner: &Profile, master: &Key, content: &Content) -> ProjectFile {
        let mut f = ProjectFile::create(owner, master, content).0;
        f.pk_by_halves = None;
        f
    }

    pub fn write(&self, path: &Path) -> io::Result<()> {
        write_atomic(path, &serde_json::to_vec(self)?)
    }
}

pub fn write_half_file(path: &Path, project_id: &str, project_name: &str, half: &[u8]) -> io::Result<()> {
    let f = HalfFile { format: HALF_FORMAT.into(), v: 1, project_id: project_id.into(), project_name: project_name.into(), half: B64.encode(half) };
    write_atomic(path, &serde_json::to_vec_pretty(&f)?)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("qda-tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(tmp, path)
}

pub fn entries(p: &Profile, master: &Key) -> Vec<Entry> {
    p.projects
        .as_ref()
        .and_then(|b| vault::unlock(master, &aad_list(&p.id), b))
        .and_then(|plain| serde_json::from_slice(&plain).ok())
        .unwrap_or_default()
}

pub fn set_entries(p: &mut Profile, master: &Key, list: &[Entry]) {
    p.projects = Some(vault::lock(master, &aad_list(&p.id), &serde_json::to_vec(list).unwrap()));
}

/// A file name safe on macOS and Windows.
pub fn file_stem(name: &str) -> String {
    let s: String = name.chars().filter(|c| !c.is_control() && !r#"\/:*?"<>|"#.contains(*c)).take(80).collect();
    let s = s.trim().trim_end_matches('.').to_string();
    if s.is_empty() { "Без назви".into() } else { s }
}

/// `dir/stem.ext`, or `dir/stem (2).ext`… if taken.
pub fn free_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut p = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while p.exists() {
        p = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("qda-proj-{}", vault::new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn content(student: bool) -> Content {
        Content {
            name: "Досвід очікування".into(),
            method: "ІФА".into(),
            student: student.then(|| Student { work: "курсова".into(), supervisor: "Єгор Б.".into() }),
            created: 1,
            modified: 1,
        }
    }

    #[test]
    fn project_opens_with_master_and_on_a_new_computer() {
        let d = tmp();
        let (owner, master, words) = Profile::create(vault::new_id(), "Олена".into(), "ОК".into(), "довгий пароль тут", 1);
        let (f, halves) = ProjectFile::create(&owner, &master, &content(false));
        assert!(halves.is_none());
        let path = d.join("p.qda");
        f.write(&path).unwrap();
        assert!(!fs::read_to_string(&path).unwrap().contains("очікування"));

        let g = ProjectFile::read(&path).unwrap();
        let pk = g.project_key(&master).unwrap();
        assert_eq!(g.content(&pk).unwrap(), content(false));

        // New computer: only the file, the password or the words.
        let m2 = g.owner.unlock("довгий пароль тут").unwrap();
        assert_eq!(g.content(&g.project_key(&m2).unwrap()).unwrap().name, "Досвід очікування");
        let m3 = g.owner.unlock_with_recovery(&words.join(" ")).unwrap();
        assert!(g.project_key(&m3).is_some());
        assert!(g.owner.unlock("не той пароль").is_none());

        // Someone else's master key does not open it.
        let (_, other_master, _) = Profile::create(vault::new_id(), "Інша".into(), "ІН".into(), "довгий пароль тут", 1);
        assert!(g.project_key(&other_master).is_none());
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn student_project_opens_only_with_both_halves() {
        let d = tmp();
        let (owner, master, _) = Profile::create(vault::new_id(), "Олена".into(), "ОК".into(), "довгий пароль тут", 1);
        let (f, halves) = ProjectFile::create(&owner, &master, &content(true));
        let (words, supervisor) = halves.unwrap();
        let half = d.join("half.qdakey");
        write_half_file(&half, &f.id, "Досвід очікування", &supervisor).unwrap();

        let pk = f.project_key_by_halves(&words.join(" "), &half).unwrap();
        assert_eq!(*pk, *f.project_key(&master).unwrap());

        let (_, other_words) = vault::new_phrase();
        assert!(f.project_key_by_halves(&other_words.join(" "), &half).is_err());
        assert_eq!(f.project_key_by_halves("one two", &half).unwrap_err(), OpenError::BadWords);

        let (f2, h2) = ProjectFile::create(&owner, &master, &content(true));
        let other_half = d.join("other.qdakey");
        write_half_file(&other_half, &f2.id, "x", &h2.unwrap().1).unwrap();
        assert_eq!(f.project_key_by_halves(&words.join(" "), &other_half).unwrap_err(), OpenError::HalfMismatch);
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn adopted_project_opens_for_new_owner_only() {
        let (a, ma, _) = Profile::create(vault::new_id(), "А".into(), "А".into(), "довгий пароль тут", 1);
        let (b, mb, _) = Profile::create(vault::new_id(), "Б".into(), "Б".into(), "інший довгий пароль", 1);
        let (mut f, _) = ProjectFile::create(&a, &ma, &content(false));
        let pk = f.project_key(&ma).unwrap();
        f.adopt(&b, &mb, &pk);
        assert!(f.project_key(&ma).is_none());
        assert_eq!(f.content(&f.project_key(&mb).unwrap()).unwrap().name, "Досвід очікування");
    }

    #[test]
    fn project_list_round_trip_and_names() {
        let (mut p, m, _) = Profile::create(vault::new_id(), "А".into(), "А".into(), "довгий пароль тут", 1);
        assert!(entries(&p, &m).is_empty());
        let e = Entry { id: vault::new_id(), name: "Тест".into(), method: "РТА".into(), student: None, path: "/x.qda".into(), modified: 2, last_backup: None };
        set_entries(&mut p, &m, &[e.clone()]);
        assert_eq!(entries(&p, &m), vec![e]);
        assert_eq!(file_stem("  a/b:c?  "), "abc");
        assert_eq!(file_stem("///"), "Без назви");
        let d = tmp();
        fs::write(d.join("Тест.qda"), "").unwrap();
        assert_eq!(free_path(&d, "Тест", "qda"), d.join("Тест (2).qda"));
        fs::remove_dir_all(d).unwrap();
    }
}
