import { useEffect, useRef, useState } from "react";
import type { App, Code } from "./coding";

type Pos = { x: number; y: number };
const POS_KEY = "qda-codebook-pos";
const FOLD_KEY = "qda-codebook-folded";
const clamp = (p: Pos): Pos => ({ x: Math.min(Math.max(0, p.x), window.innerWidth - 120), y: Math.min(Math.max(60, p.y), window.innerHeight - 40) });

/** Floating code book over the transcript: move by the handle, resize by the corner, fold into a chip. */
export default function Codebook(props: {
  codes: Code[]; apps: App[]; focus: string | null; setFocus: (id: string | null) => void;
  rename: (id: string, name: string) => void; recolor: (id: string, color: string) => void;
  setNote: (id: string, note: string) => void; remove: (c: Code) => void; showFragments: (id: string) => void;
}) {
  // Bottom-left by default (the right edge holds the comments); remembered where the person puts it.
  const [pos, setPos] = useState<Pos>(() => {
    try { const p = JSON.parse(localStorage.getItem(POS_KEY) ?? ""); if (typeof p.x === "number") return clamp(p); } catch { /* first time */ }
    return clamp({ x: 16, y: window.innerHeight - 440 });
  });
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } });
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch { /* not kept */ } };
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      moved.current = true;
      setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
    };
    const up = () => {
      if (drag.current) setPos((p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* not kept */ } return p; });
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);
  const grab = (e: React.PointerEvent) => { moved.current = false; drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }; };

  const count = (id: string) => props.apps.filter((a) => a.code === id).length;
  const sorted = [...props.codes].sort((a, b) => a.name.localeCompare(b.name, "uk"));
  const f = props.codes.find((c) => c.id === props.focus);
  const fApps = f ? props.apps.filter((a) => a.code === f.id) : [];

  if (folded) {
    return (
      <button className="cbchip" style={{ left: pos.x, top: pos.y }} onPointerDown={grab}
        onClick={() => { if (!moved.current) fold(false); }} aria-label="Розгорнути кодову книгу">
        Кодова книга · {props.codes.length} {props.codes.length === 1 ? "код" : "кодів"}
      </button>
    );
  }
  return (
    <section className="codebook" style={{ left: pos.x, top: pos.y }} aria-label="Кодова книга">
      <div className="cbhead" onPointerDown={grab} title="Перетягніть, щоб перемістити">
        <span className="label" style={{ color: "var(--ink)" }}>Кодова книга · {props.codes.length}</span>
        <span className="grow" />
        <button className="x" aria-label="Згорнути кодову книгу" onPointerDown={(e) => e.stopPropagation()} onClick={() => fold(true)}>–</button>
      </div>
      <div className="cbbody">
        {!sorted.length && <span className="small">Кодів ще немає. Виділіть фрагмент у транскрипті й назвіть код.</span>}
        {sorted.map((c) => (
          <button key={c.id} className={"coderow" + (c.id === props.focus ? " on" : "")} aria-pressed={c.id === props.focus}
            onClick={() => props.setFocus(c.id === props.focus ? null : c.id)}>
            <span className="sw" style={{ background: c.color }} aria-hidden="true" />
            <span className="grow">{c.name}</span>
            <span className="mono small">{count(c.id)}</span>
          </button>
        ))}
        {f && (
          <div className="cbcard">
            <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
              <label className="swpick" title="Змінити колір" style={{ background: f.color }}>
                <input type="color" value={f.color} aria-label="Колір коду" onChange={(e) => props.recolor(f.id, e.target.value.toUpperCase())} />
              </label>
              <input key={f.id + f.name} className="input grow" style={{ height: 32, fontSize: 13, fontWeight: 600 }} defaultValue={f.name} aria-label="Назва коду"
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== f.name && props.rename(f.id, e.target.value.trim())}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            </div>
            <span className="small">{fApps.length} фрагм. · {new Set(fApps.map((a) => a.iv)).size} інтерв'ю · створив(ла) {f.by}</span>
            <label className="field"><span className="label">Попередня інтерпретація</span>
              <textarea key={f.id} className="input mono" rows={3} style={{ fontSize: 12 }} defaultValue={f.note ?? ""}
                onBlur={(e) => e.target.value !== (f.note ?? "") && props.setNote(f.id, e.target.value)} /></label>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => props.showFragments(f.id)}>Усі фрагменти з цим кодом →</button>
              <button className="link danger" style={{ fontSize: 12 }} onClick={() => props.remove(f)}>Видалити код</button>
            </div>
            <button className="link" style={{ fontSize: 12, alignSelf: "flex-start" }} onClick={() => props.setFocus(null)}>Показати всі коди в тексті</button>
          </div>
        )}
      </div>
    </section>
  );
}
