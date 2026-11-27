import { initialsOf, type Person } from "./model";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { App, Code } from "./coding";

type Box = { x: number; y: number; w: number; h: number };
const POS_KEY = "qda-codebook-pos";
const FOLD_KEY = "qda-codebook-folded";
const MIN_W = 220, MIN_H = 160;
const lim = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const fit = (b: Box): Box => ({
  w: lim(b.w, MIN_W, window.innerWidth - 16), h: lim(b.h, MIN_H, window.innerHeight - 76),
  x: lim(b.x, 0, window.innerWidth - 120), y: lim(b.y, 60, window.innerHeight - 40),
});
// Which edges each handle moves: n/s/e/w and corners.
const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;

/** Floating code book: move by the handle, resize by any edge or corner, fold into a chip. */
export default function Codebook(props: {
  codes: Code[]; apps: App[]; focus: string | null; setFocus: (id: string | null) => void;
  rename: (id: string, name: string) => void; recolor: (id: string, color: string) => void;
  setNote: (id: string, note: string) => void; remove: (c: Code) => void; showFragments: (id: string) => void;
  people?: Record<string, Person>;
  /** Another book in the same window (the experience book of descriptive phenomenological analysis). */
  book?: { title: string; chip: string; body: ReactNode };
}) {
  // Bottom-left by default (the right edge holds the comments); place and size are remembered.
  const [box, setBox] = useState<Box>(() => {
    const first = { x: 16, y: window.innerHeight - 440, w: 300, h: 420 };
    try { const p = JSON.parse(localStorage.getItem(POS_KEY) ?? ""); if (typeof p.x === "number") return fit({ ...first, ...p }); } catch { /* first time */ }
    return fit(first);
  });
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } });
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch { /* not kept */ } };
  const drag = useRef<{ edge: string; sx: number; sy: number; start: Box } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      moved.current = true;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy, s = d.start;
      if (d.edge === "move") { setBox(fit({ ...s, x: s.x + dx, y: s.y + dy })); return; }
      const b = { ...s };
      if (d.edge.includes("e")) b.w = s.w + dx;
      if (d.edge.includes("s")) b.h = s.h + dy;
      // Left and top edges move the box too, keeping the opposite edge in place.
      if (d.edge.includes("w")) { b.w = Math.max(MIN_W, s.w - dx); b.x = s.x + s.w - b.w; }
      if (d.edge.includes("n")) { b.h = Math.max(MIN_H, s.h - dy); b.y = s.y + s.h - b.h; }
      setBox(fit(b));
    };
    const up = () => {
      if (drag.current) setBox((b) => { try { localStorage.setItem(POS_KEY, JSON.stringify(b)); } catch { /* not kept */ } return b; });
      drag.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);
  const grab = (edge: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    moved.current = false;
    drag.current = { edge, sx: e.clientX, sy: e.clientY, start: box };
    document.body.style.userSelect = "none"; // no text gets selected while resizing
  };

  const count = (id: string) => props.apps.filter((a) => a.code === id).length;
  const sorted = [...props.codes].sort((a, b) => a.name.localeCompare(b.name, "uk"));
  const f = props.codes.find((c) => c.id === props.focus);
  const fApps = f ? props.apps.filter((a) => a.code === f.id) : [];
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.scrollIntoView({ block: "nearest" }); }, [props.focus]);
  // The card opens right under its code (not below the whole list), so renaming is in sight.
  const card = f && (
          <div className="cbcard" ref={cardRef}>
            <span className="small">Назва й колір коду змінюються тут (Enter — зберегти):</span>
            <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
              <label className="swpick" title="Змінити колір" style={{ background: f.color }}>
                <input type="color" value={f.color} aria-label="Колір коду" onChange={(e) => props.recolor(f.id, e.target.value.toUpperCase())} />
              </label>
              <input key={f.id + f.name} className="input grow" style={{ height: 32, fontSize: 13, fontWeight: 600 }} defaultValue={f.name} aria-label="Назва коду"
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== f.name && props.rename(f.id, e.target.value.trim())}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            </div>
            <span className="small">{fApps.length} фрагм. · {new Set(fApps.map((a) => a.iv)).size} інтерв'ю · створив(ла) {initialsOf(props, f.by)}</span>
            <label className="field"><span className="label">Попередня інтерпретація</span>
              <textarea key={f.id} className="input mono" rows={3} style={{ fontSize: 12 }} defaultValue={f.note ?? ""}
                onBlur={(e) => e.target.value !== (f.note ?? "") && props.setNote(f.id, e.target.value)} /></label>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => props.showFragments(f.id)}>Усі фрагменти з цим кодом →</button>
              <button className="link danger" style={{ fontSize: 12 }} onClick={() => props.remove(f)}>Видалити код</button>
            </div>
            <button className="link" style={{ fontSize: 12, alignSelf: "flex-start" }} onClick={() => props.setFocus(null)}>Показати всі коди в тексті</button>
          </div>
  );

  if (folded) {
    return (
      <button className="cbchip" style={{ left: box.x, top: box.y }} onPointerDown={grab("move")}
        onClick={() => { if (!moved.current) fold(false); }} aria-label={`Розгорнути: ${props.book?.title ?? "кодова книга"}`}>
        {props.book ? props.book.chip : <>Кодова книга · {props.codes.length} {props.codes.length === 1 ? "код" : "кодів"}</>}
      </button>
    );
  }
  return (
    <section className="codebook" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} aria-label={props.book?.title ?? "Кодова книга"}>
      {EDGES.map((e) => <div key={e} className={"cbedge " + e} onPointerDown={grab(e)} aria-hidden="true" />)}
      <div className="cbhead" onPointerDown={grab("move")} title="Перетягніть, щоб перемістити; розмір — за будь-який край">
        <span className="label" style={{ color: "var(--ink)" }}>{props.book ? props.book.chip : `Кодова книга · ${props.codes.length}`}</span>
        <span className="grow" />
        <button className="x" aria-label={`Згорнути: ${props.book?.title ?? "кодова книга"}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => fold(true)}>–</button>
      </div>
      {props.book ? <div className="cbbody">{props.book.body}</div> : <div className="cbbody">
        {!sorted.length && <span className="small">Кодів ще немає. Виділіть фрагмент у транскрипті й назвіть код.</span>}
        {sorted.map((c) => (
          <Fragment key={c.id}>
            <button className={"coderow" + (c.id === props.focus ? " on" : "")} aria-pressed={c.id === props.focus} aria-expanded={c.id === props.focus}
              onClick={() => props.setFocus(c.id === props.focus ? null : c.id)} title="Натисніть, щоб перейменувати, змінити колір чи переглянути фрагменти">
              <span className="sw" style={{ background: c.color }} aria-hidden="true" />
              <span className="grow">{c.name}</span>
              <span className="mono small">{count(c.id)}</span>
            </button>
            {c.id === props.focus && card}
          </Fragment>
        ))}
      </div>}
    </section>
  );
}
