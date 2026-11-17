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
            Event::Text(t) if in_text => out.push_str(&t.decode().map_err(|_| "bad_docx")?),
            // Entities (&amp;, &#1103;) arrive separately since quick-xml 0.38.
            Event::GeneralRef(r) if in_text => match r.resolve_char_ref().map_err(|_| "bad_docx")? {
                Some(c) => out.push(c),
                None => out.push_str(quick_xml::escape::resolve_predefined_entity(&r.decode().map_err(|_| "bad_docx")?).unwrap_or("")),
            },
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

/// One paragraph of an exported transcript.
#[derive(serde::Deserialize)]
pub struct Line {
    pub t: Option<String>,
    pub who: Option<String>,
    pub text: String,
}

fn esc(s: &str) -> String {
    // Control characters other than tab/newline are not allowed in XML.
    s.chars().filter(|c| !c.is_control() || *c == '\t').collect::<String>()
        .replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn run(text: &str, style: &str) -> String {
    format!(r#"<w:r><w:rPr>{style}</w:rPr><w:t xml:space="preserve">{}</w:t></w:r>"#, esc(text))
}

/// Writes a plain Word document: title, card line, then one paragraph per replica
/// ("00:01:23  Speaker: text"). Readable back by `read`.
pub fn write_docx(path: &Path, title: &str, meta: &str, lines: &[Line]) -> Result<(), String> {
    if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("docx")) != Some(true) {
        return Err("not_docx".into());
    }
    let font = r#"<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>"#;
    let para = |runs: String, after: u32| format!(r#"<w:p><w:pPr><w:spacing w:after="{after}" w:line="300" w:lineRule="auto"/></w:pPr>{runs}</w:p>"#);
    let mut body = para(run(title, &format!("{font}<w:b/><w:sz w:val=\"28\"/>")), 80);
    if !meta.is_empty() {
        body += &para(run(meta, &format!("{font}<w:color w:val=\"666666\"/><w:sz w:val=\"20\"/>")), 320);
    }
    for l in lines {
        let mut runs = String::new();
        if let Some(t) = l.t.as_deref().filter(|t| !t.is_empty()) {
            runs += &run(&format!("{t}  "), &format!("{font}<w:color w:val=\"888888\"/><w:sz w:val=\"20\"/>"));
        }
        if let Some(w) = l.who.as_deref().filter(|w| !w.is_empty()) {
            runs += &run(&format!("{w}: "), &format!("{font}<w:b/><w:sz w:val=\"24\"/>"));
        }
        runs += &run(&l.text, &format!("{font}<w:sz w:val=\"24\"/>"));
        body += &para(runs, 160);
    }
    let doc = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>"#
    );
    pack_docx(path, &doc, None)
}

const W_NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing""#;

/// A Word file around `doc` (word/document.xml), with one PNG picture as rIdImg1 if given.
fn pack_docx(path: &Path, doc: &str, png: Option<&[u8]>) -> Result<(), String> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    let mut files: Vec<(&str, Vec<u8>)> = vec![
        ("[Content_Types].xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#.into()),
        ("_rels/.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#.into()),
        ("word/document.xml", doc.as_bytes().to_vec()),
    ];
    if let Some(img) = png {
        files.push(("word/_rels/document.xml.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/figure1.png"/></Relationships>"#.into()));
        files.push(("word/media/figure1.png", img.to_vec()));
    }
    // Written next to the target first, so a failure never leaves half a file under the chosen name.
    let tmp = path.with_extension("docx.part");
    let result = (|| -> Result<(), String> {
        let mut z = zip::ZipWriter::new(fs::File::create(&tmp).map_err(|e| format!("io:{e}"))?);
        for (name, content) in files {
            z.start_file(name, SimpleFileOptions::default()).map_err(|e| e.to_string())?;
            z.write_all(&content).map_err(|e| e.to_string())?;
        }
        z.finish().map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| format!("io:{e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// A figure laid out by APA 7: number in bold, title in italics on the next line, the picture,
/// then "Note." in italics with the note. Times New Roman 12, double spacing, flush left.
/// A leading "N" in the note (as in "N = 7") is set in italics, as APA asks for statistical symbols.
pub struct Figure<'a> {
    pub label: &'a str,
    pub title: &'a str,
    pub note_label: &'a str,
    pub note: &'a str,
    pub png: &'a [u8],
    pub width_emu: u64,
    pub height_emu: u64,
    pub landscape: bool,
}

pub fn write_figure_docx(path: &Path, f: &Figure) -> Result<(), String> {
    if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("docx")) != Some(true) || !f.png.starts_with(b"\x89PNG") {
        return Err("bad_input".into());
    }
    let font = r#"<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/>"#;
    let p = |runs: String| format!(r#"<w:p><w:pPr><w:spacing w:after="0" w:line="480" w:lineRule="auto"/></w:pPr>{runs}</w:p>"#);
    let note_runs = match f.note.strip_prefix('N').filter(|r| r.starts_with(' ') || r.starts_with('\u{a0}')) {
        Some(rest) => run("N", &format!("{font}<w:i/>")) + &run(rest, font),
        None => run(f.note, font),
    };
    let (w, h) = (f.width_emu, f.height_emu);
    let picture = format!(
        r#"<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{w}" cy="{h}"/><wp:docPr id="1" name="{label}" descr="{title}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="figure1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#,
        label = esc(f.label), title = esc(f.title)
    );
    let mut body = p(run(f.label, &format!("{font}<w:b/>")));
    body += &p(run(f.title, &format!("{font}<w:i/>")));
    body += &p(picture);
    if !f.note.trim().is_empty() {
        body += &p(run(&format!("{} ", f.note_label), &format!("{font}<w:i/>")) + &note_runs);
    }
    // A4, margins 2.54 cm (APA: 1 inch); a wide figure goes on a landscape page.
    let page = if f.landscape { r#"<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>"# } else { r#"<w:pgSz w:w="11906" w:h="16838"/>"# };
    let doc = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W_NS}><w:body>{body}<w:sectPr>{page}<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>"#
    );
    pack_docx(path, &doc, Some(f.png))
}

#[cfg(test)]
mod export_tests {
    use super::*;

    #[test]
    fn exported_docx_reads_back() {
        let path = std::env::temp_dir().join(format!("qda-export-{}.docx", std::process::id()));
        let lines = vec![
            Line { t: Some("00:00:03".into()), who: Some("І".into()), text: "Розкажіть, з чого <все> почалося & як.".into() },
            Line { t: None, who: None, text: "Ну, це було в березні.".into() },
        ];
        write_docx(&path, "Інтерв'ю 01 · Марта", "19 р. · жінка", &lines).unwrap();
        let text = read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        assert!(text.contains("Інтерв'ю 01 · Марта"));
        assert!(text.contains("00:00:03  І: Розкажіть, з чого <все> почалося & як."), "{text}");
        assert!(text.contains("Ну, це було в березні."));
        assert!(write_docx(Path::new("/tmp/x.txt"), "a", "", &[]).is_err());
    }

    #[test]
    fn figure_docx_has_apa_parts_and_the_picture() {
        let path = std::env::temp_dir().join(format!("qda-figure-{}.docx", std::process::id()));
        let png = b"\x89PNG\r\n\x1a\nfake";
        let f = Figure { label: "Рисунок 1", title: "Спільна поява кодів у семи інтерв'ю", note_label: "Примітка.", note: "N = 7 інтерв'ю; кодування двох дослідників(ць).", png, width_emu: 5_000_000, height_emu: 3_000_000, landscape: false };
        write_figure_docx(&path, &f).unwrap();
        let text = read(&path).unwrap();
        assert!(text.contains("Рисунок 1") && text.contains("Спільна поява кодів у семи інтерв'ю") && text.contains("Примітка. N = 7 інтерв'ю"), "{text}");
        let mut z = zip::ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
        let mut img = Vec::new();
        std::io::Read::read_to_end(&mut z.by_name("word/media/figure1.png").unwrap(), &mut img).unwrap();
        assert_eq!(img, png);
        let mut doc = String::new();
        std::io::Read::read_to_string(&mut z.by_name("word/document.xml").unwrap(), &mut doc).unwrap();
        assert!(doc.contains(r#"<w:b/></w:rPr><w:t xml:space="preserve">Рисунок 1"#) && doc.contains(r#"<w:i/></w:rPr><w:t xml:space="preserve">N</w:t>"#));
        fs::remove_file(&path).unwrap();
        assert!(write_figure_docx(Path::new("/tmp/x.docx"), &Figure { png: b"GIF8", ..f }).is_err());
    }
}
