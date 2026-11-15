//! Profiles and their keys.
//!
//! Each profile has one random master key. It is stored twice, sealed:
//! once with a key derived from the login password, once with a key derived
//! from the 12-word recovery phrase. Project keys (step 1.2) are sealed with
//! the master key, so changing the password only re-seals the master key.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use bip39::{Language, Mnemonic};
use chacha20poly1305::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng, Payload},
    XChaCha20Poly1305, XNonce,
};
use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path};
use zeroize::Zeroizing;

pub type Key = Zeroizing<[u8; 32]>;

pub const MIN_PASSWORD_CHARS: usize = 10;
const ARGON_MEMORY_KIB: u32 = 64 * 1024;
const ARGON_PASSES: u32 = 3;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Sealed {
    salt: String,
    nonce: String,
    ct: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Profile {
    pub v: u32,
    pub id: String,
    pub name: String,
    pub initials: String,
    pub created: u64,
    pub autolock_min: u32,
    key_by_password: Sealed,
    key_by_recovery: Sealed,
    pub failed: u32,
    pub locked_until: u64,
}

#[derive(Debug, PartialEq)]
pub enum RecoveryError {
    /// Not 12 valid words (unknown word, wrong count or failed checksum).
    BadWords,
    /// Valid words, but not this profile's key.
    WrongKey,
}

fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    OsRng.fill_bytes(&mut b);
    b
}

fn kdf(secret: &[u8], salt: &[u8]) -> Key {
    let params = Params::new(ARGON_MEMORY_KIB, ARGON_PASSES, 1, Some(32)).expect("valid Argon2 params");
    let mut out = Key::default();
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret, salt, out.as_mut())
        .expect("Argon2 with fixed params");
    out
}

fn seal(secret: &[u8], aad: &str, plain: &[u8]) -> Sealed {
    let salt: [u8; 16] = random();
    let nonce: [u8; 24] = random();
    let kek = kdf(secret, &salt);
    let ct = XChaCha20Poly1305::new(kek.as_ref().into())
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: plain, aad: aad.as_bytes() })
        .expect("encryption cannot fail");
    Sealed { salt: B64.encode(salt), nonce: B64.encode(nonce), ct: B64.encode(ct) }
}

fn open(secret: &[u8], aad: &str, s: &Sealed) -> Option<Key> {
    let salt = B64.decode(&s.salt).ok()?;
    let nonce = B64.decode(&s.nonce).ok()?;
    let ct = B64.decode(&s.ct).ok()?;
    if nonce.len() != 24 {
        return None;
    }
    let kek = kdf(secret, &salt);
    let plain = Zeroizing::new(
        XChaCha20Poly1305::new(kek.as_ref().into())
            .decrypt(XNonce::from_slice(&nonce), Payload { msg: &ct, aad: aad.as_bytes() })
            .ok()?,
    );
    let mut key = Key::default();
    if plain.len() != 32 {
        return None;
    }
    key.copy_from_slice(&plain);
    Some(key)
}

/// Normalises what a person typed: any spacing, commas, capitals.
fn parse_phrase(phrase: &str) -> Result<Mnemonic, RecoveryError> {
    let words: Vec<String> = phrase
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect();
    if words.len() != 12 {
        return Err(RecoveryError::BadWords);
    }
    Mnemonic::parse_in_normalized(Language::English, &words.join(" ")).map_err(|_| RecoveryError::BadWords)
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

pub fn new_id() -> String {
    random::<16>().iter().map(|b| format!("{b:02x}")).collect()
}

impl Profile {
    /// Returns the profile, its unlocked master key and the 12 recovery words.
    pub fn create(id: String, name: String, initials: String, password: &str, now: u64) -> (Profile, Key, Vec<String>) {
        let master = Key::new(random());
        let entropy = Zeroizing::new(random::<16>());
        let mnemonic = Mnemonic::from_entropy(entropy.as_ref()).expect("16 bytes is a valid entropy length");
        let words = mnemonic.words().map(String::from).collect();
        let p = Profile {
            v: 1,
            key_by_password: seal(password.as_bytes(), &format!("qda:{id}:password"), master.as_ref()),
            key_by_recovery: seal(entropy.as_ref(), &format!("qda:{id}:recovery"), master.as_ref()),
            id,
            name,
            initials,
            created: now,
            autolock_min: 15,
            failed: 0,
            locked_until: 0,
        };
        (p, master, words)
    }

    pub fn unlock(&self, password: &str) -> Option<Key> {
        open(password.as_bytes(), &format!("qda:{}:password", self.id), &self.key_by_password)
    }

    pub fn unlock_with_recovery(&self, phrase: &str) -> Result<Key, RecoveryError> {
        let entropy = Zeroizing::new(parse_phrase(phrase)?.to_entropy());
        open(&entropy, &format!("qda:{}:recovery", self.id), &self.key_by_recovery).ok_or(RecoveryError::WrongKey)
    }

    pub fn set_password(&mut self, master: &Key, password: &str) {
        self.key_by_password = seal(password.as_bytes(), &format!("qda:{}:password", self.id), master.as_ref());
    }

    /// Seconds to wait before the next password attempt.
    pub fn wait_secs(&self, now: u64) -> u64 {
        self.locked_until.saturating_sub(now)
    }

    /// After every 3rd wrong password in a row: 30 s, then 60 s, 120 s… up to 1 h.
    pub fn register_failure(&mut self, now: u64) {
        self.failed += 1;
        if self.failed % 3 == 0 {
            let doublings = (self.failed / 3 - 1).min(7);
            self.locked_until = now + (30u64 << doublings).min(3600);
        }
    }

    pub fn register_success(&mut self) {
        self.failed = 0;
        self.locked_until = 0;
    }
}

pub fn load_all(dir: &Path) -> Vec<Profile> {
    let mut out: Vec<Profile> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_slice(&fs::read(e.path()).ok()?).ok())
        .filter(|p: &Profile| valid_id(&p.id))
        .collect();
    out.sort_by_key(|p| p.created);
    out
}

pub fn load(dir: &Path, id: &str) -> io::Result<Profile> {
    if !valid_id(id) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "bad profile id"));
    }
    let bytes = fs::read(dir.join(format!("{id}.json")))?;
    serde_json::from_slice(&bytes).map_err(io::Error::other)
}

/// Writes to a temporary file first, so a crash never leaves half a profile.
pub fn save(dir: &Path, p: &Profile) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{}.json.tmp", p.id));
    fs::write(&tmp, serde_json::to_vec_pretty(p)?)?;
    fs::rename(tmp, dir.join(format!("{}.json", p.id)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make() -> (Profile, Key, Vec<String>) {
        Profile::create(new_id(), "Олена Коваль".into(), "ОК".into(), "зелений чайник читає", 1)
    }

    #[test]
    fn password_and_recovery_open_the_same_key() {
        let (p, master, words) = make();
        assert_eq!(words.len(), 12);
        assert_eq!(*p.unlock("зелений чайник читає").unwrap(), *master);
        assert!(p.unlock("зелений чайник читаЄ").is_none());
        assert!(p.unlock("").is_none());
        let typed = format!("  {} ", words.join(",  ").to_uppercase());
        assert_eq!(*p.unlock_with_recovery(&typed).unwrap(), *master);
    }

    #[test]
    fn recovery_rejects_wrong_words() {
        let (p, _, words) = make();
        assert_eq!(p.unlock_with_recovery("one two three").unwrap_err(), RecoveryError::BadWords);
        let mut swapped = words.clone();
        swapped.swap(0, 1);
        // A swap almost always breaks the checksum; if not, it is someone else's key.
        assert!(p.unlock_with_recovery(&swapped.join(" ")).is_err());
        let (_, _, other) = make();
        assert_eq!(p.unlock_with_recovery(&other.join(" ")).unwrap_err(), RecoveryError::WrongKey);
    }

    #[test]
    fn changing_password_keeps_recovery_and_master() {
        let (mut p, master, words) = make();
        p.set_password(&master, "новий довгий пароль");
        assert!(p.unlock("зелений чайник читає").is_none());
        assert_eq!(*p.unlock("новий довгий пароль").unwrap(), *master);
        assert_eq!(*p.unlock_with_recovery(&words.join(" ")).unwrap(), *master);
    }

    #[test]
    fn sealed_key_is_bound_to_its_profile() {
        let (a, _, _) = make();
        let (mut b, _, _) = make();
        b.key_by_password = a.key_by_password.clone();
        assert!(b.unlock("зелений чайник читає").is_none());
    }

    #[test]
    fn pause_grows_after_every_three_failures() {
        let (mut p, _, _) = make();
        p.register_failure(100);
        p.register_failure(100);
        assert_eq!(p.wait_secs(100), 0);
        p.register_failure(100);
        assert_eq!(p.wait_secs(100), 30);
        for _ in 0..3 {
            p.register_failure(200);
        }
        assert_eq!(p.wait_secs(200), 60);
        p.register_success();
        assert_eq!(p.wait_secs(200), 0);
    }

    #[test]
    fn save_load_round_trip_and_id_check() {
        let dir = std::env::temp_dir().join(format!("qda-test-{}", new_id()));
        let (p, master, _) = make();
        save(&dir, &p).unwrap();
        assert!(!fs::read_to_string(dir.join(format!("{}.json", p.id))).unwrap().contains("зелений"));
        let q = load(&dir, &p.id).unwrap();
        assert_eq!(*q.unlock("зелений чайник читає").unwrap(), *master);
        assert_eq!(load_all(&dir).len(), 1);
        assert!(load(&dir, "../etc/passwd").is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
