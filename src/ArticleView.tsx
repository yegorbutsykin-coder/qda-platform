// Stage 5.1: the «Стаття» tab — title, sections by method with hints, word counts, supervisor remarks.
import { useEffect, useRef, useState } from "react";
import { countWords, METHODS, SECTIONS, sectionDef, TOTAL_LIMIT, type Article, type Method, type SectionKey } from "./article";
import type { Note } from "./model";
import { Remark, type RemarkPatch } from "./Remarks";

const grow = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } };

function Count(props: { n: number; limit?: number }) {
  const over = !!props.limit && props.n > props.limit;
  return (
    <span className={"wcount" + (over ? " over" : "")} aria-live="polite">
      {props.limit ? <span className="wbar" aria-hidden="true"><span style={{ width: `${Math.min(100, (props.n / props.limit) * 100)}%` }} /></span> : null}
      {props.n}{props.limit ? ` / ${props.limit}` : ""} слів{over ? " — перевищено" : ""}
    </span>
  );
}

export default function ArticleView(props: {
  article: Article; method: string; readOnly: boolean; supervisor: boolean; me: string;
  notes: Record<string, Note>; who: (by: string) => string; focus: string | null;
  save: (a: Article) => void; addRemark: (sec: string, text: string, quote: string) => void; setRemark: (key: string, p: RemarkPatch) => void;
}) {
  const [draft, setDraft] = useState(props.article);
  const [active, setActive] = useState<SectionKey | null>(null);
  const [writing, setWriting] = useState<string | null>(null); // section with an open remark form
  const [remark, setRemarkText] = useState("");
  const selection = useRef<Record<string, string>>({});
  const pending = useRef(false), timer = useRef(0), latest = useRef(draft);
  latest.current = draft;
  const fmt: Method = draft.format ?? (METHODS.includes(props.method as Method) ? (props.method as Method) : "РТА");

  // Changes from outside (undo, a colleague's package) replace the draft unless typing is in progress.
  useEffect(() => { if (!pending.current) setDraft(props.article); }, [props.article]);
  // Typing is saved after a short pause, and whatever is left when the tab closes.
  const flush = () => { if (pending.current) { window.clearTimeout(timer.current); pending.current = false; props.save(latest.current); } };
  useEffect(() => flush, []);
  const edit = (a: Article) => {
    setDraft(a);
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 700);
  };
  useEffect(() => {
    if (props.focus) document.getElementById(`sec-${props.focus}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [props.focus]);

  const total = SECTIONS.reduce((n, k) => n + countWords(draft.texts[k] ?? ""), 0);
  const remarksOf = (sec: string) => Object.entries(props.notes).filter(([k]) => k.startsWith(`art:${sec}:`));

  return (
    <div className="article">
      <nav className="artnav" aria-label="Розділи статті">
        <span className="label">Розділи</span>
        {SECTIONS.map((k) => {
          const d = sectionDef(k, fmt), n = countWords(draft.texts[k] ?? "");
          const open = remarksOf(k).filter(([, r]) => r.status && r.status !== "closed").length;
          return (
            <a key={k} href={`#sec-${k}`} className={"artlink" + (active === k ? " on" : "")}>
              <span className="grow">{d.name}</span>
              {open > 0 && <span className="small accent" title="Незакриті зауваження">● {open}</span>}
              <span className={"small mono" + (d.limit && n > d.limit ? " bad" : "")}>{n}</span>
            </a>
          );
        })}
        <div className="stack" style={{ gap: 4, marginTop: 10 }}>
          <span className="small">Разом (без літератури)</span>
          <Count n={total} limit={TOTAL_LIMIT} />
        </div>
      </nav>

      <div className="stack" style={{ gap: 18, minWidth: 0 }}>
        <div className="row" style={{ gap: 14 }}>
          <span className="small">Формат статті:</span>
          <div className="seg" role="group" aria-label="Формат статті за методом">
            {METHODS.map((m) => <button key={m} aria-pressed={fmt === m} disabled={props.readOnly} onClick={() => edit({ ...draft, format: m })}>{m}</button>)}
          </div>
          <span className="small grow">Змінює назви й підказки розділів; текст не втрачається.</span>
        </div>
        {props.readOnly && <div className="warnline" style={{ borderStyle: "solid" }}>Статтю пише власник(ця) проєкту.{props.supervisor ? " Виділіть речення й натисніть «+ Зауваження» під розділом." : ""}</div>}
        <input className="input arttitle" value={draft.title} readOnly={props.readOnly} placeholder="Назва статті" aria-label="Назва статті"
          onChange={(e) => edit({ ...draft, title: e.target.value })} />

        {SECTIONS.map((k) => {
          const d = sectionDef(k, fmt), text = draft.texts[k] ?? "";
          return (
            <section key={k} id={`sec-${k}`} className={"artsec" + (active === k ? " on" : "")} aria-label={d.name}>
              <div className="row" style={{ alignItems: "baseline" }}>
                <h3 className="grow" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{d.name}</h3>
                <Count n={countWords(text)} limit={d.limit} />
              </div>
              <details className="arthint"><summary>Що писати</summary><p>{d.hint}</p></details>
              <textarea className="input mono arttext" value={text} readOnly={props.readOnly} rows={3} aria-label={`Текст розділу «${d.name}»`}
                ref={grow} onInput={(e) => grow(e.currentTarget)}
                onFocus={() => setActive(k)} onBlur={flush}
                onSelect={(e) => { const t = e.currentTarget; selection.current[k] = t.value.slice(t.selectionStart, t.selectionEnd).trim(); }}
                onChange={(e) => edit({ ...draft, texts: { ...draft.texts, [k]: e.target.value } })} />

              {remarksOf(k).map(([key, n]) => (
                <div key={key} className="artremark">
                  {n.quote && <span className="mono small">«{n.quote.length > 160 ? n.quote.slice(0, 159) + "…" : n.quote}»</span>}
                  <span style={{ fontSize: 13 }}><span className="small mono">{props.who(n.by)}</span> {n.text}</span>
                  <Remark n={n} me={props.me} who={props.who} set={(p) => props.setRemark(key, p)} />
                </div>
              ))}
              {props.supervisor && (writing === k ? (
                <div className="stack" style={{ gap: 6 }}>
                  {selection.current[k] && <span className="small mono">До фрагмента: «{selection.current[k].slice(0, 160)}»</span>}
                  <textarea className="input" rows={2} value={remark} onChange={(e) => setRemarkText(e.target.value)} placeholder="Зауваження до розділу" aria-label="Текст зауваження" autoFocus />
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn sm primary" disabled={!remark.trim()} onClick={() => { props.addRemark(k, remark.trim(), selection.current[k] ?? ""); setWriting(null); setRemarkText(""); }}>Додати зауваження</button>
                    <button className="link" style={{ fontSize: 12 }} onClick={() => setWriting(null)}>Скасувати</button>
                  </div>
                </div>
              ) : (
                <button className="link" style={{ fontSize: 12, alignSelf: "flex-start" }} onMouseDown={(e) => e.preventDefault()} onClick={() => { setWriting(k); setRemarkText(""); }}>+ Зауваження{selection.current[k] ? " до виділеного" : ""}</button>
              ))}
            </section>
          );
        })}
        <p className="small">Список літератури з перевіркою за APA 7 з'явиться на етапі 6; цитати, рисунки й таблиця тем — на кроках 5.3–5.4; експорт у Word і PDF — 5.5.</p>
      </div>
    </div>
  );
}
