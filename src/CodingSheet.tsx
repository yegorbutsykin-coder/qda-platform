import { useEffect, useRef, useState, type CSSProperties } from "react";
import { pieces, quote, snap, type App, type Code } from "./coding";
import { applyDict, wordKey, type Segment } from "./text";
import { noteKey, speaker, type Interview, type Note, type Private } from "./model";

type Sel = { rep: number; s: number; e: number; x: number; y: number };

export type CodingActions = {
  apply: (code: string, rep: number, s: number, e: number) => void;
  create: (name: string, rep: number, s: number, e: number) => void;
  removeApps: (ids: string[]) => void;
  setNote: (rep: number, text: string) => void;
};

/** Stacked underlines: one bar per code, lying one under another. */
function bars(colors: string[]): CSSProperties {
  if (!colors.length) return {};
  return {
    backgroundImage: colors.map((c) => `linear-gradient(${c}, ${c})`).join(","),
    backgroundSize: colors.map(() => "100% 3px").join(","),
    backgroundPosition: colors.map((_, i) => `0 calc(100% - ${i * 4}px)`).join(","),
    backgroundRepeat: "no-repeat",
    paddingBottom: colors.length * 4,
  };
}

/** Offset in the original text for a point of a DOM selection. */
function offsetAt(node: Node, offset: number, end: boolean): { rep: number; o: number } | null {
  let el: Element | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element).childNodes[offset] as Element ?? (node as Element);
  const piece = el?.closest?.("[data-o]") as HTMLElement | null;
  const row = el?.closest?.("[data-rep]") as HTMLElement | null;
  if (!row) return null;
  const rep = Number(row.dataset.rep);
  if (!piece) return { rep, o: end ? Number(row.dataset.len) : 0 };
  const o = Number(piece.dataset.o), len = Number(piece.dataset.len);
  if (node.nodeType !== Node.TEXT_NODE) return { rep, o: end ? o + len : o };
  if (piece.dataset.k === "plain") {
    const r = document.createRange(); // the piece may hold several text nodes (highlighted words)
    r.setStart(piece, 0);
    r.setEnd(node, offset);
    return { rep, o: o + Math.min(r.toString().length, len) };
  }
  return { rep, o: end ? o + len : o }; // inside a replaced word: take all of it
}

function Popup(props: {
  sel: Sel; iv: Interview; segs: Segment[]; codes: Code[]; apps: App[]; me: string;
  act: CodingActions; close: () => void;
}) {
  const { sel, codes, me, act } = props;
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const here = props.apps.filter((a) => a.iv === props.iv.id && a.rep === sel.rep && a.s < sel.e && a.e > sel.s);
  const mine = here.filter((a) => a.by === me);
  const name = (id: string) => codes.find((c) => c.id === id);
  const found = codes.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, "uk"));
  const exact = codes.find((c) => c.name.toLowerCase() === q.trim().toLowerCase());
  const make = () => {
    if (!q.trim()) return;
    if (exact) act.apply(exact.id, sel.rep, sel.s, sel.e);
    else act.create(q.trim(), sel.rep, sel.s, sel.e);
    props.close();
  };
  useEffect(() => {
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) props.close(); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && props.close();
    setTimeout(() => document.addEventListener("mousedown", away));
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, []);
  const left = Math.max(12, Math.min(sel.x, window.innerWidth - 340));
  const top = Math.min(sel.y + 8, window.innerHeight - 380);
  return (
    <div ref={ref} className="popup" role="dialog" aria-label="Кодування фрагмента" style={{ left, top }}>
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <span className="mono small grow" style={{ fontStyle: "italic" }}>«{quote(props.segs, sel.s, sel.e).slice(0, 160)}»</span>
        <button className="x" aria-label="Закрити" onClick={props.close}>✕</button>
      </div>
      {here.length > 0 && (
        <div className="stack" style={{ gap: 2, paddingBottom: 8, borderBottom: "1px solid var(--line3)" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="label">Коди на фрагменті</span>
            {mine.length > 0 && <button className="link danger" onClick={() => { act.removeApps(mine.map((a) => a.id)); props.close(); }}>Очистити мої коди</button>}
          </div>
          {here.map((a) => (
            <div className="row" key={a.id} style={{ flexWrap: "nowrap", minHeight: 32 }}>
              <span className="sw" style={{ background: name(a.code)?.color }} aria-hidden="true" />
              <span className="grow" style={{ fontSize: 13 }}>{name(a.code)?.name}</span>
              <span className="small">{a.by}</span>
              {a.by === me && <button className="x" aria-label={`Прибрати мій код «${name(a.code)?.name}»`} title="Прибрати мій код" onClick={() => act.removeApps([a.id])}>✕</button>}
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
        <input className="input grow" style={{ height: 36, fontSize: 13 }} autoFocus value={q} placeholder="Знайти або назвати код" aria-label="Назва коду"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); found.length === 1 && !exact && q.trim() ? (act.apply(found[0].id, sel.rep, sel.s, sel.e), props.close()) : make(); } }} />
        <button className="btn sm primary" disabled={!q.trim()} onClick={make}>+ Код</button>
      </div>
      <span className="label">Додати наявний код</span>
      <div className="stack" style={{ gap: 2, maxHeight: 220, overflow: "auto" }}>
        {found.map((c) => (
          <button key={c.id} className="coderow" onClick={() => { act.apply(c.id, sel.rep, sel.s, sel.e); props.close(); }}>
            <span className="sw" style={{ background: c.color }} aria-hidden="true" /><span className="grow">{c.name}</span>
          </button>
        ))}
        {!found.length && <span className="small" style={{ padding: "6px 8px" }}>{codes.length ? "Такого коду ще немає. Натисніть «+ Код», щоб створити." : "Кодів ще немає. Впишіть назву й натисніть «+ Код»."}</span>}
      </div>
    </div>
  );
}

function NoteCell(props: { note?: Note; t: string | null; me: string; save: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(props.note?.text ?? "");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setDraft(props.note?.text ?? ""), [props.note?.text]);
  const change = (v: string) => {
    setDraft(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => props.save(v), 800);
  };
  const done = () => { window.clearTimeout(timer.current); if (draft !== (props.note?.text ?? "")) props.save(draft); setOpen(false); };
  return (
    <div className="notecell">
      {props.note?.text && <p className="noteclamp">{props.note.text}</p>}
      <button className="notebtn" onClick={() => setOpen(true)}>{props.note?.text ? "Розгорнути" : "+ Коментар"}</button>
      {open && (
        <div className="notecard" role="dialog" aria-label="Коментар">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="label">Коментар{props.t ? ` · ${props.t}` : ""}</span>
            <button className="x" aria-label="Згорнути коментар" onClick={done}>✕</button>
          </div>
          <textarea className="input mono" rows={9} autoFocus value={draft} placeholder="Попередня інтерпретація, асоціації, питання до тексту…" aria-label="Текст коментаря"
            onChange={(e) => change(e.target.value)} onKeyDown={(e) => e.key === "Escape" && done()} />
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="small">{props.me} · зберігається автоматично</span>
            <button className="btn sm primary" onClick={done}>Готово</button>
          </div>
        </div>
      )}
    </div>
  );
}

const CAP = /(\p{Lu}[\p{Ll}'’ʼ-]*\p{Ll}|\p{Lu}{2,6})/gu;

export default function CodingSheet(props: {
  iv: Interview; priv: Private; codes: Code[]; apps: App[]; notes: Record<string, Note>; me: string;
  original: boolean; underlines: boolean; focus: string | null; flagged: Set<string>; act: CodingActions; target?: number | null;
  seek?: (t: string) => void; nowRep?: number | null;
}) {
  const { iv, priv, codes, original, focus } = props;
  const [sel, setSel] = useState<Sel | null>(null);
  const reps = priv.originals[iv.id] ?? [];
  const segsOf = (i: number) => applyDict(reps[i].text, priv.dict, iv.id);
  const color = new Map(codes.map((c) => [c.id, c.color]));
  const apps = props.apps.filter((a) => a.iv === iv.id);

  useEffect(() => {
    if (props.target == null) return;
    document.getElementById(`rep-${props.target}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [props.target, iv.id]);

  function onMouseUp() {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return;
    const range = s.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (s.isCollapsed) {
      // A click on coded text opens its codes.
      const piece = (range.startContainer.parentElement as Element | null)?.closest("[data-o]") as HTMLElement | null;
      const row = piece?.closest("[data-rep]") as HTMLElement | null;
      if (!piece || !row || !piece.dataset.coded) return;
      const rep = Number(row.dataset.rep), o = Number(piece.dataset.o);
      const covering = apps.filter((a) => a.rep === rep && a.s <= o && a.e > o);
      setSel({ rep, s: Math.min(...covering.map((a) => a.s)), e: Math.max(...covering.map((a) => a.e)), x: rect.left, y: rect.bottom });
      return;
    }
    const a = offsetAt(range.startContainer, range.startOffset, false);
    const b = offsetAt(range.endContainer, range.endOffset, true);
    if (!a || !b || a.rep !== b.rep) return; // one replica at a time
    const text = reps[a.rep].text;
    let [st, en] = snap(segsOf(a.rep), Math.min(a.o, b.o), Math.max(a.o, b.o));
    while (st < en && /\s/.test(text[st])) st++;
    while (en > st && /\s/.test(text[en - 1])) en--;
    if (en <= st) return;
    setSel({ rep: a.rep, s: st, e: en, x: rect.left, y: rect.bottom });
  }

  return (
    <article className="paper" onMouseUp={onMouseUp}>
      <div className="paperhead">
        <span className="label" style={{ width: 84 }}>Час</span>
        <span className="label grow">Транскрипт · виділіть фрагмент, щоб закодувати</span>
        <span className="label notecol">Дослідницькі коментарі</span>
      </div>
      {reps.map((r, i) => {
        const ps = pieces(segsOf(i), apps.filter((a) => a.rep === i), original);
        return (
          <div className={"prow" + (props.target === i ? " target" : "") + (props.nowRep === i ? " now" : "")} key={i} id={`rep-${i}`}>
            {props.seek && r.t ? (
              <button className="tcbtn" aria-label={`Відтворити з ${r.t}`} onClick={() => props.seek!(r.t!)}>
                <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M2 1v8l7-4z" /></svg>{r.t}
              </button>
            ) : <span className="tc">{r.t ?? ""}</span>}
            <p className="ptext" data-rep={i} data-len={r.text.length}>
              {r.role && <b className="spk">{speaker(r.role, iv.card)}: </b>}
              {ps.map((p) => {
                const shown = props.underlines ? p.codes.filter((c) => !focus || c === focus) : [];
                const dim = focus && !p.codes.includes(focus);
                const cls = p.kind === "plain" ? "" : p.kind === "orig" ? "orig" : "repl";
                const content = p.kind === "plain" && props.flagged.size
                  ? p.text.split(CAP).map((w, j) => (j % 2 && props.flagged.has(wordKey(w)) ? <mark key={j} className="suspect">{w}</mark> : w))
                  : p.text;
                return (
                  <span key={p.o} data-o={p.o} data-len={p.len} data-k={p.kind} data-coded={p.codes.length ? "1" : undefined}
                    className={(cls ? `m-${cls}` : "") + (dim ? " dim" : "") + (p.codes.length ? " coded" : "")}
                    style={bars(shown.map((c) => color.get(c) ?? "#1E1E1C"))}>{content}</span>
                );
              })}
            </p>
            <NoteCell note={props.notes[noteKey(iv.id, i)]} t={r.t} me={props.me} save={(text) => props.act.setNote(i, text)} />
          </div>
        );
      })}
      {sel && (
        <Popup sel={sel} iv={iv} segs={segsOf(sel.rep)} codes={codes} apps={props.apps} me={props.me} act={props.act}
          close={() => { setSel(null); window.getSelection()?.removeAllRanges(); }} />
      )}
    </article>
  );
}
