//! Exchange packages (stage 3): a project's shared part, or someone's changes, in one file
//! that opens only with a one-time phrase of 6 words, passed separately from the file.

use crate::vault::{self, Blob, Sealed};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

const FORMAT: &str = "qda-pack";
const WORDS: usize = 6;
const MAX_BYTES: u64 = 300 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct PackFile {
    format: String,
    v: u32,
    id: String,
    /// The package key, locked by the phrase (Argon2id: guessing is slow).
    key: Sealed,
    body: Blob,
}

fn aad(id: &str) -> String {
    format!("qda-pack:{id}")
}

/// 6 random words of the BIP39 English list: 66 bits, enough with the slow key derivation.
pub fn new_words() -> Vec<String> {
    let list = bip39::Language::English.word_list();
    (0..WORDS)
        .map(|_| {
            let r: [u8; 2] = vault::random();
            // 65536 is a multiple of 2048, so every word is equally likely.
            list[(u16::from_le_bytes(r) % 2048) as usize].to_string()
        })
        .collect()
}

/// The phrase as typed → its canonical form; `Err(n)`: word n (1-based) is not in the list, `Err(0)`: not 6 words.
pub fn normalize(phrase: &str) -> Result<String, usize> {
    let words: Vec<String> = phrase.split_whitespace().map(|w| w.to_lowercase()).collect();
    if words.len() != WORDS {
        return Err(0);
    }
    let list = bip39::Language::English.word_list();
    if let Some(i) = words.iter().position(|w| !list.contains(&w.as_str())) {
        return Err(i + 1);
    }
    Ok(words.join(" "))
}

/// Writes `body` locked with a new phrase and returns the phrase. The file appears only when complete.
pub fn write(path: &Path, body: &serde_json::Value) -> Result<Vec<String>, String> {
    if path.extension().and_then(|e| e.to_str()) != Some("qdapack") {
        return Err("bad_input".into());
    }
    let words = new_words();
    let id = vault::new_id();
    let key = vault::new_key();
    let file = PackFile {
        format: FORMAT.into(),
        v: 1,
        key: vault::seal(words.join(" ").as_bytes(), &aad(&id), key.as_ref()),
        body: vault::lock(&key, &aad(&id), &serde_json::to_vec(body).map_err(|e| e.to_string())?),
        id,
    };
    let tmp = path.with_extension("qdapack.part");
    fs::write(&tmp, serde_json::to_vec(&file).unwrap()).map_err(|e| format!("io:{e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("io:{e}")
    })?;
    Ok(words)
}

/// Opens a package. Errors: "not_a_pack", "bad_words:N" (word N unknown; 0 = not 6 words), "wrong".
pub fn read(path: &Path, phrase: &str) -> Result<serde_json::Value, String> {
    let meta = fs::metadata(path).map_err(|e| format!("io:{e}"))?;
    if meta.len() > MAX_BYTES {
        return Err("not_a_pack".into());
    }
    let file: PackFile = fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).ok_or("not_a_pack")?;
    if file.format != FORMAT || file.v != 1 {
        return Err("not_a_pack".into());
    }
    let phrase = normalize(phrase).map_err(|n| format!("bad_words:{n}"))?;
    let key = vault::open(phrase.as_bytes(), &aad(&file.id), &file.key).ok_or("wrong")?;
    let body = vault::unlock(&key, &aad(&file.id), &file.body).ok_or("wrong")?;
    serde_json::from_slice(&body).map_err(|_| "not_a_pack".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_wrong_phrase() {
        let path = std::env::temp_dir().join(format!("qda-test-{}.qdapack", std::process::id()));
        let body = serde_json::json!({"kind": "copy", "data": {"name": "Досвід втрати"}});
        let words = write(&path, &body).unwrap();
        assert_eq!(words.len(), 6);
        // Case and extra spaces do not matter.
        let typed = format!("  {}  ", words.join("   ").to_uppercase());
        assert_eq!(read(&path, &typed).unwrap(), body);
        let mut other = words.clone();
        other[5] = if other[5] == "zoo" { "abandon".into() } else { "zoo".into() };
        assert_eq!(read(&path, &other.join(" ")).unwrap_err(), "wrong");
        assert_eq!(read(&path, "one two").unwrap_err(), "bad_words:0");
        assert_eq!(read(&path, &format!("{} qqq", words[..5].join(" "))).unwrap_err(), "bad_words:6");
        fs::remove_file(&path).unwrap();
        assert!(write(Path::new("/tmp/x.qda"), &body).is_err());
    }

    #[test]
    fn words_come_from_the_list_and_differ() {
        let list = bip39::Language::English.word_list();
        let a = new_words();
        assert!(a.iter().all(|w| list.contains(&w.as_str())));
        assert_ne!(a, new_words());
    }
}
