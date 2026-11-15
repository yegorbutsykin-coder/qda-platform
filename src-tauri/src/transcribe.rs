//! Local transcription with whisper.cpp. The recording never leaves the computer:
//! it is converted to a temporary 16 kHz WAV (deleted afterwards) and read by the
//! bundled `whisper-cli`; the text comes back over its output, never written to disk.

use serde::Serialize;
use sha1::{Digest, Sha1};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

pub struct Model {
    pub id: &'static str,
    pub label: &'static str,
    pub mib: u64,
    sha1: &'static str,
}

/// From the official whisper.cpp model list (name, size, SHA-1).
pub const MODELS: [Model; 4] = [
    Model { id: "large-v3-turbo-q5_0", label: "Велика (рекомендована)", mib: 547, sha1: "e050f7970618a659205450ad97eb95a18d69c9ee" },
    Model { id: "medium-q5_0", label: "Середня", mib: 514, sha1: "7718d4c1ec62ca96998f058114db98236937490e" },
    Model { id: "small", label: "Мала (швидка)", mib: 466, sha1: "55356645c2b361a969dfd0ef2c5a50d530afd8d5" },
    Model { id: "tiny", label: "Крихітна (лише для перевірки)", mib: 75, sha1: "bd577a113a864445d4c299885e0cb97d4ba92b5f" },
];

pub fn model(id: &str) -> Option<&'static Model> {
    MODELS.iter().find(|m| m.id == id)
}

#[derive(Serialize, Clone, Default)]
pub struct Progress {
    /// "running", "done" or "error"
    pub state: String,
    pub pct: u32,
    pub error: Option<String>,
    pub segments: Option<Vec<Segment>>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Default)]
pub struct Jobs {
    pub downloads: Arc<Mutex<HashMap<String, Progress>>>,
    pub transcriptions: Arc<Mutex<HashMap<String, Progress>>>,
}

fn set(map: &Arc<Mutex<HashMap<String, Progress>>>, key: &str, f: impl FnOnce(&mut Progress)) {
    let mut m = map.lock().unwrap();
    f(m.entry(key.to_string()).or_default());
}

pub fn model_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("ggml-{id}.bin"))
}

fn sha1_of(path: &Path) -> std::io::Result<String> {
    let mut f = fs::File::open(path)?;
    let mut h = Sha1::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Downloads a model once, with the person's consent, and checks it against the official checksum.
pub fn download(jobs: &Jobs, dir: PathBuf, m: &'static Model) {
    let map = jobs.downloads.clone();
    set(&map, m.id, |p| *p = Progress { state: "running".into(), ..Default::default() });
    thread::spawn(move || {
        let fail = |e: String| set(&map, m.id, |p| { p.state = "error".into(); p.error = Some(e); });
        if let Err(e) = fs::create_dir_all(&dir) {
            return fail(e.to_string());
        }
        let part = dir.join(format!("ggml-{}.bin.part", m.id));
        let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin", m.id);
        let mut child = match Command::new("curl").args(["-L", "--fail", "-sS", "-o"]).arg(&part).arg(&url).stderr(Stdio::piped()).spawn() {
            Ok(c) => c,
            Err(e) => return fail(format!("curl: {e}")),
        };
        let total = m.mib * 1024 * 1024;
        let status = loop {
            if let Some(s) = child.try_wait().ok().flatten() {
                break s;
            }
            let got = fs::metadata(&part).map(|x| x.len()).unwrap_or(0);
            set(&map, m.id, |p| p.pct = (got * 100 / total).min(99) as u32);
            thread::sleep(Duration::from_millis(500));
        };
        if !status.success() {
            let mut err = String::new();
            child.stderr.take().map(|mut s| s.read_to_string(&mut err));
            let _ = fs::remove_file(&part);
            return fail(format!("no_network: {}", err.trim()));
        }
        match sha1_of(&part) {
            Ok(h) if h == m.sha1 => match fs::rename(&part, model_path(&dir, m.id)) {
                Ok(()) => set(&map, m.id, |p| { p.state = "done".into(); p.pct = 100; }),
                Err(e) => fail(e.to_string()),
            },
            Ok(_) => {
                let _ = fs::remove_file(&part);
                fail("bad_checksum".into())
            }
            Err(e) => fail(e.to_string()),
        }
    });
}

/// `[00:01:02.500 --> 00:01:05.000]  text` → segment.
pub fn parse_line(line: &str) -> Option<Segment> {
    let rest = line.trim_start().strip_prefix('[')?;
    let (stamps, text) = rest.split_once(']')?;
    let (a, b) = stamps.split_once(" --> ")?;
    let ms = |s: &str| -> Option<u64> {
        let (hms, frac) = s.trim().split_once('.')?;
        let parts: Vec<u64> = hms.split(':').map(|x| x.parse().ok()).collect::<Option<_>>()?;
        let secs = parts.iter().fold(0, |acc, x| acc * 60 + x);
        Some(secs * 1000 + frac.parse::<u64>().ok()?)
    };
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(Segment { start_ms: ms(a)?, end_ms: ms(b)?, text: text.to_string() })
}

/// The bundled whisper-cli sits next to the program (Tauri "sidecar").
fn whisper_cli() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    let p = exe.parent().ok_or("no_dir")?.join(name);
    if p.exists() { Ok(p) } else { Err("no_whisper".into()) }
}

/// Converts any recording macOS can play to the 16 kHz mono WAV whisper.cpp reads.
fn to_wav(input: &Path, wav: &Path) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        let out = Command::new("/usr/bin/afconvert")
            .args(["-f", "WAVE", "-d", "LEI16@16000", "-c", "1"])
            .arg(input)
            .arg(wav)
            .output()
            .map_err(|e| e.to_string())?;
        return if out.status.success() { Ok(()) } else { Err(format!("convert: {}", String::from_utf8_lossy(&out.stderr).trim())) };
    }
    // shortcut: on Windows whisper-cli reads wav/mp3/ogg/flac itself; m4a/mp4 need a converter there (later).
    let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ["wav", "mp3", "ogg", "flac"].contains(&ext.as_str()) {
        fs::copy(input, wav).map(|_| ()).map_err(|e| e.to_string())
    } else {
        Err("format_windows".into())
    }
}

pub fn start(jobs: &Jobs, job: String, audio: PathBuf, model_file: PathBuf, language: String) {
    let map = jobs.transcriptions.clone();
    set(&map, &job, |p| *p = Progress { state: "running".into(), ..Default::default() });
    thread::spawn(move || {
        let wav = std::env::temp_dir().join(format!("qda-{job}.wav"));
        let result = run(&map, &job, &audio, &wav, &model_file, &language);
        let _ = fs::remove_file(&wav); // the temporary copy of the audio never stays behind
        match result {
            Ok(segments) => set(&map, &job, |p| { p.state = "done".into(); p.pct = 100; p.segments = Some(segments); }),
            Err(e) => set(&map, &job, |p| { p.state = "error".into(); p.error = Some(e); }),
        }
    });
}

fn run(map: &Arc<Mutex<HashMap<String, Progress>>>, job: &str, audio: &Path, wav: &Path, model_file: &Path, language: &str) -> Result<Vec<Segment>, String> {
    to_wav(audio, wav)?;
    // The graphics card makes it several times faster; if it fails on this computer, run on the processor.
    whisper(map, job, wav, model_file, language, true).or_else(|_| whisper(map, job, wav, model_file, language, false))
}

fn whisper(map: &Arc<Mutex<HashMap<String, Progress>>>, job: &str, wav: &Path, model_file: &Path, language: &str, gpu: bool) -> Result<Vec<Segment>, String> {
    let threads = thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let mut child = Command::new(whisper_cli()?)
        .arg("-m").arg(model_file)
        .arg("-f").arg(wav)
        .args(["-l", language, "-t", &threads.to_string(), "-pp"])
        .args(if gpu { &[][..] } else { &["-ng"][..] })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stderr = child.stderr.take().unwrap();
    let progress_map = map.clone();
    let job_id = job.to_string();
    let err_reader = thread::spawn(move || {
        let mut tail = Vec::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(v) = line.split("progress =").nth(1).and_then(|v| v.trim().trim_end_matches('%').trim().parse::<u32>().ok()) {
                set(&progress_map, &job_id, |p| p.pct = v.min(99));
            }
            tail.push(line);
            if tail.len() > 20 {
                tail.remove(0);
            }
        }
        tail.join("\n")
    });
    let segments: Vec<Segment> = BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok).filter_map(|l| parse_line(&l)).collect();
    let status = child.wait().map_err(|e| e.to_string())?;
    let tail = err_reader.join().unwrap_or_default();
    if !status.success() {
        return Err(format!("whisper: {tail}"));
    }
    Ok(segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_whisper_output() {
        assert_eq!(
            parse_line("[00:01:02.500 --> 00:01:05.000]   Ну, це було в березні."),
            Some(Segment { start_ms: 62_500, end_ms: 65_000, text: "Ну, це було в березні.".into() })
        );
        assert_eq!(parse_line("[01:00:00.000 --> 01:00:01.000]  ok").unwrap().start_ms, 3_600_000);
        assert_eq!(parse_line("whisper_init: loading model"), None);
        assert_eq!(parse_line("[00:00:00.000 --> 00:00:01.000]   "), None);
    }

    #[test]
    fn model_list_is_consistent() {
        assert!(MODELS.iter().all(|m| m.sha1.len() == 40 && model(m.id).is_some()));
        assert!(model("../../etc").is_none());
    }
}
