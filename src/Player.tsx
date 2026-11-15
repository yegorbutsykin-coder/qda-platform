import { useEffect, useState, type RefObject } from "react";

export const RATES = [0.75, 1, 1.25, 1.5];

/** "01:02:03" or "02:03" → seconds; null if not a timecode. */
export function seconds(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function clock(s: number): string {
  const v = Math.max(0, Math.floor(s));
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  return [h, m, sec].map((x) => String(x).padStart(2, "0")).join(":");
}

/** Controls for the hidden <audio> element owned by the project view. */
export default function Player(props: { audio: RefObject<HTMLAudioElement | null>; src: string; name: string; onTime: (t: number) => void }) {
  const a = props.audio;
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const el = a.current;
    if (!el) return;
    const tick = () => { setTime(el.currentTime); props.onTime(el.currentTime); };
    const meta = () => setDur(el.duration || 0);
    const on = () => setPlaying(true), off = () => setPlaying(false);
    el.addEventListener("timeupdate", tick); el.addEventListener("loadedmetadata", meta);
    el.addEventListener("play", on); el.addEventListener("pause", off); el.addEventListener("ended", off);
    return () => {
      el.removeEventListener("timeupdate", tick); el.removeEventListener("loadedmetadata", meta);
      el.removeEventListener("play", on); el.removeEventListener("pause", off); el.removeEventListener("ended", off);
    };
  }, [props.src]);

  const jump = (d: number) => { if (a.current) a.current.currentTime = Math.max(0, Math.min(dur || Infinity, a.current.currentTime + d)); };
  const toggle = () => { const el = a.current; if (el) el.paused ? el.play() : el.pause(); };
  const setR = (r: number) => { setRate(r); if (a.current) a.current.playbackRate = r; };
  const pct = dur ? (time / dur) * 100 : 0;

  return (
    <div className="player" role="group" aria-label={`Запис: ${props.name}`}>
      <button className="pbtn" aria-label="Назад на 5 секунд" onClick={() => jump(-5)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 4 4 8l4 4M12 4 8 8l4 4" /></svg>
      </button>
      <button className="pbtn play" aria-label={playing ? "Пауза" : "Відтворити"} onClick={toggle}>
        {playing
          ? <svg width="16" height="16" viewBox="0 0 16 16" fill="#FFFFFF" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" /></svg>
          : <svg width="16" height="16" viewBox="0 0 16 16" fill="#FFFFFF" aria-hidden="true"><path d="M5 3v10l8-5z" /></svg>}
      </button>
      <button className="pbtn" aria-label="Вперед на 5 секунд" onClick={() => jump(5)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m8 4 4 4-4 4M4 4l4 4-4 4" /></svg>
      </button>
      <input className="pbar" type="range" min={0} max={dur || 0} step={0.1} value={time} aria-label="Позиція в записі"
        style={{ background: `linear-gradient(to right, var(--ink) ${pct}%, var(--line) ${pct}%)` }}
        onChange={(e) => { if (a.current) a.current.currentTime = Number(e.target.value); }} />
      <span className="mono" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{clock(time)} / {clock(dur)}</span>
      <div className="seg" role="group" aria-label="Швидкість">
        {RATES.map((r) => <button key={r} aria-pressed={rate === r} onClick={() => setR(r)}>{String(r).replace(".", ",")}×</button>)}
      </div>
    </div>
  );
}
