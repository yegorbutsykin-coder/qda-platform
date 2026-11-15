//! Reads a transcript from .txt or .docx into plain text (one paragraph per line).

use quick_xml::events::Event;
use std::{fs, io::Read, path::Path};

const MAX_BYTES: u64 = 50 * 1024 * 1024;

pub fn read(path: &Path) -> Result<String, String> {
    let size = fs::metadata(path).map_err(|e| format!("io:{e}"))?.len();
    if size > MAX_BYTES {
        return Err("too_big".into());
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    match ext.as_str() {
        "txt" | "text" | "md" => Ok(decode(&fs::read(path).map_err(|e| format!("io:{e}"))?)),
        "docx" => docx(path),
        _ => Err("unsupported".into()),
    }
}

/// UTF-8 (with or without BOM), UTF-16 with BOM, otherwise Windows-1251 (old Ukrainian Word/Notepad files).
fn decode(b: &[u8]) -> String {
    if let Some((enc, bom)) = encoding_rs::Encoding::for_bom(b) {
        return enc.decode_without_bom_handling(&b[bom..]).0.into_owned();
    }
    match std::str::from_utf8(b) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::WINDOWS_1251.decode_without_bom_handling(b).0.into_owned(),
    }
}

fn docx(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("io:{e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "bad_docx")?;
    let mut xml = String::new();
    zip.by_name("word/document.xml")
        .map_err(|_| "bad_docx")?
        .take(MAX_BYTES)
        .read_to_string(&mut xml)
        .map_err(|_| "bad_docx")?;
    docx_text(&xml)
}

fn docx_text(xml: &str) -> Result<String, String> {
    let mut reader = quick_xml::Reader::from_str(xml);
    let (mut out, mut in_text) = (String::new(), false);
    loop {
        match reader.read_event().map_err(|_| "bad_docx")? {
            Event::Start(e) if e.name().as_ref() == b"w:t" => in_text = true,
            Event::End(e) if e.name().as_ref() == b"w:t" => in_text = false,
            Event::Text(t) if in_text => out.push_str(&t.unescape().map_err(|_| "bad_docx")?),
            Event::End(e) if e.name().as_ref() == b"w:p" => out.push('\n'),
            Event::Empty(e) if e.name().as_ref() == b"w:tab" => out.push('\t'),
            Event::Empty(e) if matches!(e.name().as_ref(), b"w:br" | b"w:cr") => out.push('\n'),
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn decodes_common_encodings() {
        assert_eq!(decode("І: привіт".as_bytes()), "І: привіт");
        assert_eq!(decode(&[0xEF, 0xBB, 0xBF, b'a']), "a");
        let (cp, _, _) = encoding_rs::WINDOWS_1251.encode("Учасниця: їжак");
        assert_eq!(decode(&cp), "Учасниця: їжак");
        let mut utf16 = vec![0xFF, 0xFE];
        for u in "Р: так".encode_utf16() {
            utf16.extend_from_slice(&u.to_le_bytes());
        }
        assert_eq!(decode(&utf16), "Р: так");
    }

    #[test]
    fn reads_docx_paragraphs() {
        let dir = std::env::temp_dir().join(format!("qda-docx-{}", crate::vault::new_id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.docx");
        let mut z = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        z.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(
            br#"<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:r><w:t>[00:01:05] </w:t></w:r><w:r><w:t xml:space="preserve">I: &#1103;&amp; </w:t></w:r><w:r><w:tab/><w:t>tab</w:t></w:r></w:p>
<w:p><w:r><w:t>P: second</w:t><w:br/><w:t>line</w:t></w:r></w:p></w:body></w:document>"#,
        )
        .unwrap();
        z.finish().unwrap();
        assert_eq!(read(&path).unwrap(), "[00:01:05] I: я& \ttab\nP: second\nline\n");
        fs::write(dir.join("x.pdf"), "x").unwrap();
        assert_eq!(read(&dir.join("x.pdf")).unwrap_err(), "unsupported");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reads_the_sample_transcripts() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-data");
        let t1 = read(&dir.join("Інтерв'ю 01 — повні мітки й таймкоди.txt")).unwrap();
        assert!(t1.starts_with("[00:00:04] Інтерв'юер:"));
        let t2 = read(&dir.join("Інтерв'ю 02 — літери І і Р.docx")).unwrap();
        assert!(t2.contains("в Сумах.\nІ: Як змінилася"));
        assert_eq!(t2.lines().count(), 7);
        let t3 = read(&dir.join("Інтерв'ю 03 — без міток, кодування Windows-1251.txt")).unwrap();
        assert!(t3.contains("в Ірпені"));
    }
}
