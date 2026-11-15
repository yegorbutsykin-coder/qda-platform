//! Audio stays where the researcher keeps it. The project remembers only the path and a
//! fingerprint, and the window gets access to that one file at a time.

use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
};

const CHUNK: u64 = 1024 * 1024;
pub const EXTENSIONS: [&str; 6] = ["mp3", "m4a", "wav", "mp4", "aac", "ogg"];

pub fn is_audio(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| EXTENSIONS.contains(&e.to_lowercase().as_str()))
}

/// Size plus the first and last megabyte: recognises the same recording without reading all of it.
pub fn fingerprint(path: &Path) -> io::Result<String> {
    let mut f = File::open(path)?;
    let size = f.metadata()?.len();
    let mut h = Sha256::new();
    h.update(size.to_le_bytes());
    let mut buf = vec![0u8; CHUNK.min(size) as usize];
    f.read_exact(&mut buf)?;
    h.update(&buf);
    if size > CHUNK {
        f.seek(SeekFrom::Start(size - CHUNK.min(size)))?;
        f.read_exact(&mut buf)?;
        h.update(&buf);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn fingerprint_tells_files_apart() {
        let dir = std::env::temp_dir().join(format!("qda-audio-{}", crate::vault::new_id()));
        fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.m4a");
        let mut data = vec![7u8; 3 * CHUNK as usize];
        fs::write(&a, &data).unwrap();
        let fa = fingerprint(&a).unwrap();
        fs::copy(&a, dir.join("copy.m4a")).unwrap();
        assert_eq!(fingerprint(&dir.join("copy.m4a")).unwrap(), fa); // moved or copied: same recording
        let last = data.len() - 10;
        data[last] = 8;
        fs::write(&a, &data).unwrap();
        assert_ne!(fingerprint(&a).unwrap(), fa);
        fs::write(dir.join("small.wav"), b"abc").unwrap();
        assert_eq!(fingerprint(&dir.join("small.wav")).unwrap().len(), 64);
        assert!(is_audio(&a) && is_audio(Path::new("X.MP3")) && !is_audio(Path::new("x.docx")));
        fs::remove_dir_all(dir).unwrap();
    }
}
