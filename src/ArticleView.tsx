// Stage 5: the «Стаття» tab — title, sections by method with hints, word counts, supervisor remarks, quotes from coding.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createPortal } from "react-dom";
import { Fragment, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  addRefs, countWords, dataSig, dropFloat, exportBlocks, isCyrillic, refsSorted, rich, sortRefs, formatQuote, fragKey, join, journalChanged, METHODS, moveFloat, numbers, putFloat, putText, resetJournal, resultsKey,
  sectionsOf, split, themeTable, totalLimit, type Article, type Block, type Caret, type FigFloat, type Float, type Journal, type Method, type SectionConf, type TabFloat,
} from "./article";
import { checkList } from "./apaCheck";
import { audit, citeOf } from "./citations";
import { parseRefs } from "./importRefs";
import { LEVELS } from "./coding";
import { saveDocx, saveFigures, wideTable } from "./exportArticle";
import { initialsOf, newId, type Note, type Private, type Shared } from "./model";
import { quote } from "./coding";
import { codesByCategory, fragments, type Frag } from "./figures";
import { applyDict } from "./text";
import { Remark, type RemarkPatch } from "./Remarks";

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const tableTitle = (v: TabFloat["variant"], supers: boolean, en: boolean) => v === "presence"
  ? (en ? "Presence of Themes Across Participants" : "Присутність тем в інтерв'ю учасників(ць)")
  : en ? (supers ? "Superordinate Themes, Themes, and Illustrative Quotes" : "Themes and Illustrative Quotes") : (supers ? "Супертеми, теми та ілюстративні цитати" : "Теми та ілюстративні цитати");

/** Text with *italics*. */
const Rich = (p: { text: string }) => <>{rich(p.text).map((x, i) => (x.i ? <i key={i}>{x.text}</i> : <Fragment key={i}>{x.text}</Fragment>))}</>;

/** "N = 7 …" with the N in italics (APA sets statistical symbols in italics). */
const Note = (p: { label: string; text: string }) => (
  <p className="apanote"><i>{p.label}</i> {/^N[ \u00a0]/.test(p.text) ? <><i>N</i>{p.text.slice(1)}</> : p.text}</p>
);

/** The article as it is printed (and saved as PDF): only this is visible on paper. */
function PrintDoc(props: { blocks: Block[]; en: boolean }) {
  const note = props.en ? "Note." : "Примітка.";
  return (
    <div className="printdoc" aria-hidden="true">
      {props.blocks.map((b, i) => {
        if (b.k === "front") return (
          <div key={i} className="pfront">
            <p className="ptitle">{b.title}</p>
            {(b.authors || b.affiliation) && <p className="pline">&nbsp;</p>}
            {b.authors && <p className="pline">{b.authors}</p>}
            {b.affiliation && <p className="pline">{b.affiliation}</p>}
          </div>
        );
        if (b.k === "title") return <p key={i} className={"ptitle" + (b.brk ? " pbreak" : "")}>{b.text}</p>;
        if (b.k === "h2") return <h2 key={i}>{b.text}</h2>;
        if (b.k === "h3") return <h3 key={i}>{b.text}</h3>;
        if (b.k === "kw") return <p key={i} className="pind"><i>{b.label}</i> {b.text}</p>;
        if (b.k === "h1") return <h1 key={i} className={b.brk ? "pbreak" : ""}>{b.text}</h1>;
        if (b.k === "ref") return <p key={i} className="pref"><Rich text={b.text} /></p>;
        if (b.k === "p") return <p key={i} className={b.indent ? "pind" : ""}>{b.text}</p>;
        if (b.k === "quote") return <blockquote key={i}>{b.text}</blockquote>;
        const f = b.k === "fig" ? b.f : b.t;
        const wide = b.k === "fig" ? b.f.landscape : wideTable(b.head.length);
        return (
          <div key={i} className={"pfloat" + (b.brk ? " pbreak" : "") + (wide ? " pwide" : "")}>
            <p className="apanum">{b.label}</p>
            <p className="apatitle">{f.title}</p>
            {b.k === "fig" ? <img src={svgUrl(b.f.svg)} alt="" style={{ width: `${b.f.w}in` }} /> : (
              <table className="apatable">
                <thead><tr>{b.head.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j} className={r.group ? "tsup" : ""}>{r.group ? <td colSpan={b.head.length}>{r.cells[0]}</td> : r.cells.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
              </table>
            )}
            {f.note.trim() && <Note label={note} text={f.note} />}
          </div>
        );
      })}
    </div>
  );
}

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
  article: Article; method: string; shared: Shared; priv: Private; readOnly: boolean; supervisor: boolean; me: string;
  notes: Record<string, Note>; who: (by: string) => string; focus: string | null;
  save: (a: Article) => void; addRemark: (sec: string, text: string, quote: string) => void; setRemark: (key: string, p: RemarkPatch) => void;
  caret: MutableRefObject<Caret | null>; openFigure: (id: string) => void; toAnalysis: () => void;
  undoable: (text: string, before: Article, next: Article) => void;
}) {
  const [draft, setDraft] = useState(props.article);
  const [active, setActive] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [writing, setWriting] = useState<string | null>(null); // section with an open remark form
  const [remark, setRemarkText] = useState("");
  const selection = useRef<Record<string, string>>({});
  const caret = props.caret; // where a quote, figure or reference goes; outlives this view
  const [picking, setPicking] = useState<string | null>(null);
  const [out, setOut] = useState(""); // export status line
  const [refEdit, setRefEdit] = useState<string | null>(null);
  const [newRefs, setNewRefs] = useState("");
  const [why, setWhy] = useState<Set<string>>(new Set()); // sources with their APA notes unfolded
  const [refMsg, setRefMsg] = useState(""); // "table id|category id" choosing a quote
  const [quotes, setQuotes] = useState(false);
  const [qcode, setQcode] = useState<string | null>(null);
  const [placed, setPlaced] = useState("");
  const pending = useRef(false), timer = useRef(0), latest = useRef(draft);
  latest.current = draft;
  const fmt: Method = draft.format ?? (METHODS.includes(props.method as Method) ? (props.method as Method) : "РТА");

  // Changes from outside (undo, a colleague's package) replace the draft unless typing is in progress.
  useEffect(() => { if (!pending.current) setDraft(props.article); }, [props.article]);
  // Typing is saved after a short pause, and whatever is left when the tab closes.
  const flush = () => { if (pending.current) { window.clearTimeout(timer.current); pending.current = false; props.save(latest.current); } };
  useEffect(() => flush, []);
  const edit = (a: Article) => {
    latest.current = a; // quick clicks build on each other, not on the last render
    setDraft(a);
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 700);
  };
  // Text put in by a quote, undo or a package doesn't fire onInput — fit the boxes to it too.
  useEffect(() => document.querySelectorAll<HTMLTextAreaElement>("textarea.arttext").forEach(grow), [draft.texts]);
  useEffect(() => {
    if (props.focus) document.getElementById(props.focus.startsWith("fl-") ? props.focus : `sec-${props.focus}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [props.focus]);

  const secs = sectionsOf(draft, fmt);
  const total = secs.reduce((n, x) => n + countWords(draft.texts[x.key] ?? ""), 0);
  const limit = totalLimit(draft);
  const j: Journal = draft.journal ?? { name: "", lang: "uk", other: "" };
  const setJ = (p: Partial<Journal>) => edit({ ...draft, journal: { ...j, ...p } });
  const conf: SectionConf[] = j.sections ?? secs.map((x) => ({ key: x.key }));
  const setConf = (list: SectionConf[]) => setJ({ sections: list });
  const patchSec = (key: string, p: Partial<SectionConf>) => setConf(conf.map((c) => (c.key === key ? { ...c, ...p } : c)));
  const move = (i: number, d: number) => { const l = [...conf]; [l[i], l[i + d]] = [l[i + d], l[i]]; setConf(l); };
  const lang = j.lang;
  const ivOf = (id: string) => props.shared.interviews.find((x) => x.id === id);
  // Quotes always come from the text with replacements, as colleagues see it.
  const fragText = (f: Frag) => { const r = props.priv.originals[f.iv]?.[f.rep]; return r ? quote(applyDict(r.text, props.priv.dict, f.iv), f.s, f.e) : ""; };
  const isVoice = (f: Frag) => props.priv.originals[f.iv]?.[f.rep]?.role !== "i";
  const frags = qcode ? fragments(props.shared.apps.filter((a) => a.code === qcode))
    .sort((a, b) => (ivOf(a.iv)?.n ?? 0) - (ivOf(b.iv)?.n ?? 0) || a.rep - b.rep || a.s - b.s) : [];
  const keys = secs.map((x) => x.key), en = lang === "en";
  const nameOf = (k: string) => secs.find((x) => x.key === k)?.name ?? "";
  const insertQuote = (f: Frag) => {
    const iv = ivOf(f.iv);
    if (!iv) return;
    const r = putText(draft, keys, caret.current, formatQuote(fragText(f), iv.card.pseudonym, iv.n, lang));
    edit(r.article);
    caret.current = r.caret;
    setActive(r.caret.sec);
    setPlaced(`Цитату вставлено в розділ «${nameOf(r.caret.sec)}».`);
  };

  // Figures and tables.
  const sig = useMemo(() => dataSig(props.shared), [props.shared.apps, props.shared.codes, props.shared.cats, props.shared.supers, props.shared.interviews, props.shared.tones]);
  const nums = numbers(draft, keys);
  const label = (f: Float) => (f.kind === "fig" ? (en ? "Figure" : "Рисунок") : en ? "Table" : "Таблиця");
  const setFloat = (id: string, f: Float) => edit({ ...latest.current, floats: { ...latest.current.floats, [id]: f } });
  const levels = props.shared.levels ?? LEVELS[props.method] ?? LEVELS[""];
  const buildRows = (t: Omit<TabFloat, "rows" | "cols" | "n" | "sig">) => ({ ...t, ...themeTable(props.shared, t, fragText, isVoice, lang), sig } as TabFloat);
  const insertTable = () => {
    const supers = props.shared.supers.length > 0;
    const t = buildRows({ kind: "tab", variant: "themes", title: tableTitle("themes", supers, en), note: "", showPeople: fmt === "ІФА", showQuote: true, names: {}, picks: {} });
    t.note = en ? `N = ${t.n}. Participant names are pseudonyms; names and places in quotes have been replaced.` : `N = ${t.n}. Псевдоніми учасників(ць) змінено; імена й назви місць у цитатах замінено.`;
    const id = newId(), r = putFloat(draft, keys, caret.current, id, t);
    edit(r.article);
    setPlaced(`Таблицю ${numbers(r.article, keys).get(id)} вставлено в розділ «${nameOf(r.sec)}».`);
    setTimeout(() => document.getElementById(`fl-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };
  const refer = (id: string) => {
    const f = draft.floats![id], n = nums.get(id);
    if (!caret.current) { setPlaced("Поставте курсор у тексті, куди вставити посилання."); return; }
    const text = en ? `(see ${label(f)} ${n})` : `(див. ${f.kind === "fig" ? "Рисунок" : "Таблицю"} ${n})`;
    const r = putText(draft, keys, caret.current, { text, block: false });
    edit(r.article);
    caret.current = r.caret;
    setPlaced(`Посилання ${text} вставлено.`);
  };
  const remove = (id: string) => {
    const before = latest.current, f = before.floats![id], next = dropFloat(before, keys, id);
    window.clearTimeout(timer.current); pending.current = false; // saved together with the removal
    latest.current = next; setDraft(next);
    props.undoable(`${label(f)} ${nums.get(id)} прибрано зі статті; посилання на ${f.kind === "fig" ? "нього" : "неї"} тепер «?».`, before, next);
  };
  const candidates = (cat: string) => {
    const codes = new Set(props.shared.codes.filter((c) => c.cat === cat).map((c) => c.id));
    return fragments(props.shared.apps.filter((a) => codes.has(a.code))).filter(isVoice).map((f) => ({ f, q: fragText(f) })).filter((x) => x.q);
  };

  const blocks = useMemo(() => exportBlocks(draft, fmt, levels.mid), [draft, fmt, levels.mid]);
  const hasFigs = blocks.some((b) => b.k === "fig");
  async function toWord() {
    flush();
    setOut("Готую Word…");
    try { const f = await saveDocx(latest.current, fmt, levels.mid); setOut(f ? `Збережено: ${f}` : ""); }
    catch (e) { setOut(`Не вдалося зберегти: ${e}`); }
  }
  async function figuresOut() {
    flush();
    try { const n = await saveFigures(latest.current, fmt); setOut(n > 0 ? `Збережено рисунків: ${n} — кожен як PNG (300 dpi) і SVG.` : ""); }
    catch (e) { setOut(`Не вдалося зберегти: ${e}`); }
  }
  function toPdf() {
    flush();
    setOut("У вікні друку оберіть «Зберегти як PDF»: на Mac — кнопка «PDF» унизу вікна, на Windows — принтер «Microsoft Print to PDF».");
    window.print();
  }

  function RefList() {
    const refs = draft.refs ?? [], order = draft.refOrder ?? "cyr", sorted = refsSorted(draft), ro = props.readOnly;
    const setRefs = (list: typeof refs) => edit({ ...latest.current, refs: list });
    const dropRef = (id: string) => {
      const before = latest.current, next = { ...before, refs: (before.refs ?? []).filter((r) => r.id !== id) };
      window.clearTimeout(timer.current); pending.current = false;
      latest.current = next; setDraft(next);
      props.undoable("Джерело видалено зі списку літератури.", before, next);
    };
    const issues = checkList(refs, order);
    const level = (id: string) => (issues.get(id)!.some((x) => x.level === "error") ? "error" : issues.get(id)!.length ? "warn" : "");
    const nErr = refs.filter((r) => level(r.id) === "error").length, nWarn = refs.filter((r) => level(r.id) === "warn").length;
    const toggle = (id: string) => setWhy((w) => { const n = new Set(w); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const au = audit(draft, secs);
    const cite = (text: string) => {
      if (!caret.current) { setRefMsg("Поставте курсор у тексті статті, куди вставити посилання, і натисніть ще раз."); return; }
      const r = putText(latest.current, keys, caret.current, { text, block: false });
      edit(r.article);
      caret.current = r.caret;
      setRefMsg(`Посилання ${text} вставлено в розділ «${nameOf(r.caret.sec)}».`);
    };
    async function importFile() {
      const path = await open({ title: "Джерела з Zotero", filters: [{ name: "RIS або BibTeX", extensions: ["ris", "bib", "bibtex", "txt"] }] });
      if (!path || Array.isArray(path)) return;
      try {
        const found = parseRefs(await invoke<string>("read_transcript", { path }));
        if (!found.length) { setRefMsg("У файлі не знайдено джерел. Потрібен файл RIS (.ris) або BibTeX (.bib): у Zotero — «Файл → Експортувати бібліотеку…» або правий клік на колекції → «Експортувати колекцію…»."); return; }
        // The same DOI, or the same text, is already in the list: not added twice.
        const doi = (t: string) => t.match(/10\.\d{4,}\/[^\s]+/)?.[0].toLowerCase();
        const key = (t: string) => doi(t) ?? t.replace(/\*/g, "").toLowerCase().replace(/\s+/g, " ");
        const have = new Set((latest.current.refs ?? []).map((r) => key(r.text)));
        const fresh = found.filter((t) => { const k = key(t); if (have.has(k)) return false; have.add(k); return true; });
        if (fresh.length) edit(addRefs(latest.current, fresh.join("\n"), newId));
        setRefMsg(`Додано джерел: ${fresh.length}${found.length > fresh.length ? `; уже були в списку: ${found.length - fresh.length}` : ""}.${fresh.length ? " Перевірте позначки APA нижче: назви з Zotero часто в «Title Case», а APA вимагає реченнєвий регістр." : ""}`);
      } catch (e) { setRefMsg(`Не вдалося прочитати файл: ${e}`); }
    }
    const groups = order === "cyr" && sorted && refs.some((r) => isCyrillic(r.text)) && refs.some((r) => !isCyrillic(r.text));
    return (
      <section id="sec-refs" className="artsec" aria-label={en ? "References" : "Список літератури"}>
        <div className="row" style={{ alignItems: "baseline" }}>
          <h3 className="grow" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{en ? "References" : "Список літератури"}</h3>
          <span className="small mono">{refs.length} {refs.length % 10 === 1 && refs.length % 100 !== 11 ? "джерело" : [2, 3, 4].includes(refs.length % 10) && ![12, 13, 14].includes(refs.length % 100) ? "джерела" : "джерел"} · не входить у ліміт слів</span>
        </div>
        {refs.length > 1 && !ro && (
          <div className="row" style={{ gap: 10 }}>
            <div className="seg" role="group" aria-label="Як упорядкувати">
              <button aria-pressed={order === "cyr"} onClick={() => edit({ ...latest.current, refOrder: "cyr" })}>Кирилиця → латиниця</button>
              <button aria-pressed={order === "one"} onClick={() => edit({ ...latest.current, refOrder: "one" })}>Одна абетка</button>
            </div>
            <button className="btn sm" disabled={sorted} onClick={() => setRefs(sortRefs(refs, order))}>{sorted ? "✓ Упорядковано" : "Упорядкувати за абеткою"}</button>
            <span className="small grow">{order === "cyr" ? "Спершу джерела кирилицею за українською абеткою, потім латиницею." : "Один список за латинською абеткою — коли журнал вимагає транслітерувати кириличні джерела."}</span>
          </div>
        )}
        {refs.length > 0 && (
          <div className="row" style={{ gap: "4px 14px", fontSize: 13 }} role="status">
            <span>Перевірка за APA 7:</span>
            {nErr > 0 && <span className="refsum referr">з помилками — {nErr}</span>}
            {nWarn > 0 && <span className="refsum refwarn">варто перевірити — {nWarn}</span>}
            <span className="small">без зауважень — {refs.length - nErr - nWarn}</span>
            <span className="small grow">Перевірка евристична: наведіть на джерело або натисніть «!», щоб побачити, що виправити; остаточно звіряйте з посібником APA.</span>
          </div>
        )}
        {(au.missing.length > 0 || au.unused.size > 0) && (
          <div className="warnline stack" style={{ gap: 4 }} role="status">
            <b style={{ fontWeight: 600 }}>Звірка з текстом</b>
            {au.missing.length > 0 && <span>У тексті є посилання, яких немає в списку: {au.missing.map((m) => `${m.shown} (розділ «${m.sec}»)`).join("; ")}.</span>}
            {au.unused.size > 0 && <span>Джерел, на які немає посилань у тексті: {au.unused.size} — позначені «у тексті не згадано». APA вимагає, щоб кожне джерело списку було процитоване, і навпаки.</span>}
          </div>
        )}
        {refMsg && <span className="small" role="status">{refMsg}</span>}
        <div className="stack" style={{ gap: 2 }}>
          {refs.map((r, i) => (
            <Fragment key={r.id}>
              {groups && (i === 0 || isCyrillic(refs[i - 1].text) !== isCyrillic(r.text)) && <span className="label" style={{ marginTop: i ? 10 : 0 }}>{isCyrillic(r.text) ? "Кирилиця" : "Латиниця"}</span>}
              {refEdit === r.id && !ro ? (
                <textarea className="input arttext refline" autoFocus defaultValue={r.text} rows={2} ref={grow} onInput={(e) => grow(e.currentTarget)} aria-label="Опис джерела"
                  onBlur={(e) => { const t = e.currentTarget.value.replace(/\s*\n\s*/g, " ").trim(); setRefEdit(null); if (t !== r.text) setRefs(refs.map((x) => (x.id === r.id ? { ...x, text: t } : x))); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); if (e.key === "Escape") e.currentTarget.value = r.text; e.currentTarget.blur(); } }} />
              ) : (
                <div className={"refwrap" + (level(r.id) ? " ref" + (level(r.id) === "error" ? "err" : "warn") : "")}>
                <div className="row refrow" style={{ gap: 10, alignItems: "baseline", flexWrap: "nowrap" }}>
                  <p className="refline grow" title={issues.get(r.id)!.map((x) => (x.level === "error" ? "✕ " : "△ ") + x.msg).join("\n") || undefined}><Rich text={r.text} /></p>
                  {issues.get(r.id)!.length > 0 && (
                    <button className="refbang" aria-expanded={why.has(r.id)} onClick={() => toggle(r.id)}
                      aria-label={`Зауваження за APA 7: ${issues.get(r.id)!.length}`}>!</button>
                  )}
                  {au.unused.has(r.id) && <span className="small" style={{ whiteSpace: "nowrap" }}>у тексті не згадано</span>}
                  {!ro && <button className="link" style={{ fontSize: 12 }} onClick={() => setRefEdit(r.id)} aria-label={`Редагувати: ${r.text.slice(0, 40)}`}>Редагувати</button>}
                  {!ro && <button className="link danger" style={{ fontSize: 12 }} onClick={() => dropRef(r.id)} aria-label={`Видалити: ${r.text.slice(0, 40)}`}>Видалити</button>}
                </div>
                {!ro && (() => {
                  const c = citeOf(r.text);
                  return c && (
                    <div className="row refcite" style={{ gap: "2px 14px" }}>
                      <span className="small">↳ Послатися в тексті:</span>
                      <button className="link" onMouseDown={(e) => e.preventDefault()} onClick={() => cite(c.paren)} aria-label={`Вставити посилання ${c.paren}`}>{c.paren}</button>
                      <button className="link" onMouseDown={(e) => e.preventDefault()} onClick={() => cite(c.narr)} aria-label={`Вставити посилання ${c.narr}`}>{c.narr}</button>
                    </div>
                  );
                })()}
                {why.has(r.id) && (
                  <ul className="refissues">
                    {issues.get(r.id)!.map((x, k) => <li key={k} className={x.level}><b>{x.level === "error" ? "Помилка" : "Варто перевірити"}:</b> {x.msg}</li>)}
                  </ul>
                )}
                </div>
              )}
            </Fragment>
          ))}
        </div>
        {!ro && (
          <div className="stack" style={{ gap: 6 }}>
            <textarea className="input" rows={3} value={newRefs} onChange={(e) => setNewRefs(e.target.value)} aria-label="Нові джерела"
              placeholder={"Вставте одне чи кілька джерел — кожне з нового рядка.\nБоймер, Д. (2021). Невизначена втрата. *Журнал психології*, *12*(3), 45–60. https://doi.org/10.1234/abcd"} />
            <div className="row" style={{ gap: 10 }}>
              <button className="btn sm" disabled={!newRefs.trim()} onClick={() => { edit(addRefs(latest.current, newRefs, newId)); setNewRefs(""); }}>Додати до списку</button>
              <button className="btn sm" onClick={importFile}>Імпорт із Zotero (RIS, BibTeX)…</button>
              <span className="small">Курсив — між зірочками: *Назва журналу*, *12*(3). Zotero, Mendeley, Google Scholar: експортуйте файл .ris або .bib — програма оформить джерела за APA 7.</span>
            </div>
          </div>
        )}
      </section>
    );
  }

  // Called as functions, not mounted as components: a component declared here would be new on every render and lose the cursor.
  function FloatView(fp: { id: string; f: Float }) {
    const { id, f } = fp, n = nums.get(id), ro = props.readOnly;
    const changed = f.sig !== sig;
    return (
      <div className="artfloat" id={`fl-${id}`}>
        <div className="apapage">
          <p className="apanum">{label(f)} {n}</p>
          {ro ? <p className="apatitle">{f.title}</p>
            : <input className="apatitle apain" value={f.title} onChange={(e) => setFloat(id, { ...f, title: e.target.value })} aria-label={`Назва: ${label(f)} ${n}`} />}
          {f.kind === "fig"
            ? <img src={svgUrl(f.svg)} alt={f.title} style={{ width: `${f.w * 72}px`, maxWidth: "100%" }} />
            : TableView({ id, t: f })}
          {ro ? (f.note.trim() && <Note label={en ? "Note." : "Примітка."} text={f.note} />) : (
            <label className="row" style={{ gap: 6, alignItems: "baseline", flexWrap: "nowrap" }}><i style={{ flex: "none" }}>{en ? "Note." : "Примітка."}</i>
              <textarea className="apanote apain grow" rows={1} ref={grow} onInput={(e) => grow(e.currentTarget)} value={f.note} onChange={(e) => setFloat(id, { ...f, note: e.target.value })} aria-label={`Примітка: ${label(f)} ${n}`} /></label>
          )}
        </div>
        {!ro && (
          <div className="row" style={{ gap: "6px 14px", fontSize: 12 }}>
            <button className="link" onClick={() => edit(moveFloat(latest.current, keys, id, -1))} aria-label={`Вище: ${label(f)} ${n}`}>↑ Вище</button>
            <button className="link" onClick={() => edit(moveFloat(latest.current, keys, id, 1))} aria-label={`Нижче: ${label(f)} ${n}`}>↓ Нижче</button>
            <button className="link" onMouseDown={(e) => e.preventDefault()} onClick={() => refer(id)}>↳ Послатися в тексті</button>
            {f.kind === "fig" && <span className="small">{f.bw ? "чорно-білий" : "кольоровий"}{f.landscape ? " · альбомна сторінка" : ""}</span>}
            <span className="grow" />
            <button className="link danger" onClick={() => remove(id)}>Прибрати зі статті</button>
          </div>
        )}
        {changed && !ro && (
          <div className="warnline row" style={{ gap: 10 }}>
            <span className="grow">Кодування змінилося після вставлення: {f.kind === "fig" ? "рисунок" : "таблиця"} показує дані на той момент.</span>
            <button className="btn sm" onClick={() => (f.kind === "fig" ? props.openFigure(id) : setFloat(id, buildRows(f)))}>Оновити за поточним кодуванням</button>
          </div>
        )}
      </div>
    );
  }

  function TableView(tp: { id: string; t: TabFloat }) {
    const { id, t } = tp, ro = props.readOnly;
    const set = (p: Partial<TabFloat>) => setFloat(id, { ...t, ...p });
    const theme = en ? "Theme" : levels.mid;
    const supers = t.rows.some((r) => r.sup);
    const width = t.variant === "presence" ? t.cols.length + 2 : 1 + +t.showPeople + +t.showQuote;
    let last: string | undefined = "\u0000";
    const name = (rid: string, nm: string) => (ro ? nm : <input className="apain" value={t.names[rid] ?? nm} onChange={(e) => set({ names: { ...t.names, [rid]: e.target.value }, rows: t.rows.map((r) => (r.id === rid ? { ...r, name: e.target.value } : r)) })} aria-label="Назва теми" />);
    return (
      <div className="stack" style={{ gap: 8 }}>
        {!ro && (
          <div className="row tabctl" style={{ gap: "6px 14px" }}>
            <div className="seg" role="group" aria-label="Вигляд таблиці">
              {(["themes", "presence"] as const).map((v) => <button key={v} aria-pressed={t.variant === v} onClick={() => set({ variant: v, ...(t.title === tableTitle(t.variant, props.shared.supers.length > 0, en) ? { title: tableTitle(v, props.shared.supers.length > 0, en) } : {}) })}>{v === "themes" ? "Теми й цитати" : "Матриця присутності"}</button>)}
            </div>
            {t.variant === "themes" && <>
              <label className="check"><input type="checkbox" checked={t.showPeople} onChange={(e) => set({ showPeople: e.target.checked })} /><span>Учасники(ці)</span></label>
              <label className="check"><input type="checkbox" checked={t.showQuote} onChange={(e) => set({ showQuote: e.target.checked })} /><span>Ілюстративна цитата</span></label>
            </>}
          </div>
        )}
        {!ro && fmt === "РТА" && (t.showPeople || t.variant === "presence") && <span className="small">У рефлексивному ТА кількість учасників(ць) не є мірилом важливості теми (Браун і Кларк) — подумайте, чи потрібен цей стовпець.</span>}
        {!ro && t.variant === "presence" && t.cols.length >= 10 && <span className="small accent">Таблиця широка: в експорті буде на альбомній сторінці.</span>}
        <table className="apatable">
          <thead><tr>
            <th>{theme}</th>
            {t.variant === "presence" ? <>{t.cols.map((c, i) => <th key={i}>{c}</th>)}<th>{en ? "Total" : "Разом"}</th></>
              : <>{t.showPeople && <th>{en ? "Participants" : "Учасники(ці)"}</th>}{t.showQuote && <th>{en ? "Illustrative quote" : "Ілюстративна цитата"}</th>}</>}
          </tr></thead>
          <tbody>
            {t.rows.map((r) => {
              const head = supers && r.sup !== last ? <tr key={"s" + r.id} className="tsup"><td colSpan={width}>{r.sup ?? (en ? "Other themes" : "Інші теми")}</td></tr> : null;
              last = r.sup;
              const choose = picking === `${id}|${r.id}`;
              return [head, (
                <tr key={r.id}>
                  <td>{name(r.id, r.name)}</td>
                  {t.variant === "presence" ? <>{(r.cells ?? []).map((c, i) => <td key={i} className="mid">{c ? "✓" : ""}</td>)}<td className="mid">{r.people.length}</td></> : <>
                    {t.showPeople && <td>{r.people.join(", ")} ({r.people.length} {en ? "of" : "з"} {t.n})</td>}
                    {t.showQuote && <td>{r.quote ?? "—"}{!ro && <> <button className="link" style={{ fontSize: 12, fontFamily: "var(--sans)" }} onClick={() => setPicking(choose ? null : `${id}|${r.id}`)}>{choose ? "Закрити" : "Обрати цитату"}</button></>}
                      {choose && (
                        <div className="stack qpick" role="radiogroup" aria-label={`Цитата для теми «${r.name}»`}>
                          {candidates(r.id).map(({ f: fr, q }) => {
                            const iv = ivOf(fr.iv)!, k = fragKey(fr);
                            return (
                              <label key={k} className="check">
                                <input type="radio" name={`pick-${id}-${r.id}`} checked={r.pick === k} onChange={() => {
                                  set({ picks: { ...t.picks, [r.id]: k }, rows: t.rows.map((x) => (x.id === r.id ? { ...x, pick: k, quote: formatQuote(q, iv.card.pseudonym, iv.n, lang).text.replace(/^> /, "") } : x)) });
                                  setPicking(null);
                                }} />
                                <span>«{q.length > 180 ? q.slice(0, 179) + "…" : q}» <span className="small">({iv.card.pseudonym}, {String(iv.n).padStart(2, "0")})</span></span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </td>}
                  </>}
                </tr>
              )];
            })}
          </tbody>
        </table>
        {!t.rows.length && <span className="small">Тем ще немає: об'єднайте коди в категорії на вкладці «Кодування».</span>}
      </div>
    );
  }

  const remarksOf = (sec: string) => Object.entries(props.notes).filter(([k]) => k.startsWith(`art:${sec}:`));

  return (
    <div className={"article" + (quotes ? " withquotes" : "")}>
      <nav className="artnav" aria-label="Розділи статті">
        <span className="label">Розділи</span>
        {secs.map(({ key: k, ...d }) => {
          const n = countWords(draft.texts[k] ?? "");
          const open = remarksOf(k).filter(([, r]) => r.status && r.status !== "closed").length;
          return (
            <a key={k} href={`#sec-${k}`} className={"artlink" + (active === k ? " on" : "")}>
              <span className="grow">{d.name}</span>
              {open > 0 && <span className="small accent" title="Незакриті зауваження">● {open}</span>}
              <span className={"small mono" + (d.limit && n > d.limit ? " bad" : "")}>{n}</span>
            </a>
          );
        })}
        <a href="#sec-refs" className="artlink"><span className="grow">{en ? "References" : "Список літератури"}</span><span className="small mono">{(draft.refs ?? []).length}</span></a>
        <div className="stack" style={{ gap: 4, marginTop: 10 }}>
          <span className="small">Разом (без літератури)</span>
          <Count n={total} limit={limit || undefined} />
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
        <div className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="small">Експорт за APA 7:</span>
            <button className="btn sm" onClick={toWord}>Word (.docx)…</button>
            <button className="btn sm" onClick={toPdf}>PDF через друк…</button>
            {hasFigs && <button className="btn sm" onClick={figuresOut}>Рисунки окремими файлами…</button>}
          </div>
          {out && <span className="small" role="status">{out}</span>}
        </div>
        {!panel && (j.name || j.other.trim()) && (
          <div className="stack" style={{ gap: 4 }}>
            {j.name && <span className="label">{j.name}</span>}
            {j.other.trim() && <div className="warnline" style={{ whiteSpace: "pre-wrap" }}>{j.other.trim()}</div>}
          </div>
        )}
        {!props.readOnly && <button className={"btn sm" + (panel ? " primary" : "")} style={{ alignSelf: "flex-start" }} onClick={() => setPanel(!panel)} aria-expanded={panel}>Вимоги журналу{panel ? " ▴" : " ▾"}</button>}
        {panel && !props.readOnly && (
          <div className="panel stack" style={{ gap: 12 }} role="region" aria-label="Вимоги журналу">
            <div className="row" style={{ gap: 14, alignItems: "flex-end" }}>
              <label className="stack grow" style={{ gap: 4, fontSize: 13 }}>Назва журналу
                <input className="input" value={j.name} onChange={(e) => setJ({ name: e.target.value })} /></label>
              <div className="stack" style={{ gap: 4, fontSize: 13 }}>Мова статті
                <div className="seg" role="group" aria-label="Мова статті">
                  {(["uk", "en"] as const).map((l) => <button key={l} aria-pressed={j.lang === l} onClick={() => setJ({ lang: l })}>{l === "uk" ? "Українська" : "English"}</button>)}
                </div></div>
              <label className="stack" style={{ gap: 4, fontSize: 13 }}>Ліміт слів (0 — без ліміту)
                <input className="input mono" type="number" min={0} style={{ width: 120 }} value={limit} onChange={(e) => setJ({ total: Math.max(0, Number(e.target.value) || 0) })} /></label>
            </div>
            <span className="small">Мова статті визначає назви розділів і підписи «Рисунок / Figure», «Примітка. / Note.» в експорті. Порожні поля нижче беруть значення з формату методу ({fmt}).</span>
            <div className="stack" style={{ gap: 6 }}>
              {conf.map((c, i) => {
                const d = secs.find((x) => x.key === c.key)!, empty = !(draft.texts[c.key] ?? "").trim();
                return (
                  <div key={c.key} className="jrow">
                    <div className="stack" style={{ gap: 2 }}>
                      <button className="link" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Вище: ${d.name}`}>↑</button>
                      <button className="link" disabled={i === conf.length - 1} onClick={() => move(i, 1)} aria-label={`Нижче: ${d.name}`}>↓</button>
                    </div>
                    <input className="input" value={c.name ?? ""} placeholder={d.custom ? "Новий розділ" : d.name} onChange={(e) => patchSec(c.key, { name: e.target.value })} aria-label="Назва розділу" />
                    <textarea className="input" rows={2} value={c.hint ?? ""} placeholder={d.custom ? "Що журнал вимагає в цьому розділі" : d.hint} onChange={(e) => patchSec(c.key, { hint: e.target.value })} aria-label={`Вимога до розділу «${d.name}»`} />
                    <input className="input mono" type="number" min={0} value={c.limit ?? ""} placeholder={d.limit && !c.limit ? String(d.limit) : "ліміт"} onChange={(e) => patchSec(c.key, { limit: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })} aria-label={`Ліміт слів розділу «${d.name}»`} />
                    <button className="link danger" style={{ fontSize: 12 }} disabled={!empty} title={empty ? undefined : "Видалити можна лише порожній розділ"} onClick={() => setConf(conf.filter((x) => x.key !== c.key))}>Видалити</button>
                  </div>
                );
              })}
              <button className="link" style={{ alignSelf: "flex-start", fontSize: 13 }} onClick={() => setConf([...conf, { key: `c${newId().slice(0, 8)}`, name: "" }])}>+ Розділ</button>
            </div>
            <label className="stack" style={{ gap: 4, fontSize: 13 }}>Колонтитул — скорочена назва до 50 знаків (у професійних статтях APA; студентським роботам не потрібен). У Word — великими літерами зліва вгорі, номер сторінки справа.
              <input className="input" maxLength={50} value={j.runningHead ?? ""} onChange={(e) => setJ({ runningHead: e.target.value })} placeholder="НЕВИЗНАЧЕНА ВТРАТА В ДИТИНСТВІ" style={{ textTransform: "uppercase" }} /></label>
            <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={!!j.floatsAtEnd} onChange={(e) => setJ({ floatsAtEnd: e.target.checked })} />
              <span>Таблиці й рисунки — в кінці статті, кожен(на) з нової сторінки (інакше — у тексті, де вони стоять). Діє в експорті у Word.</span></label>
            <label className="stack" style={{ gap: 4, fontSize: 13 }}>Інші вимоги журналу — видно над статтею, коли панель закрита
              <textarea className="input" rows={3} value={j.other} onChange={(e) => setJ({ other: e.target.value })} placeholder="Напр.: анонімізований рукопис; структурована анотація; ключові слова англійською…" /></label>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn sm" disabled={!journalChanged(draft)} onClick={() => edit(resetJournal(draft))}>Скинути вимоги журналу</button>
              <span className="small">Повертає стандарт APA для формату {fmt}: назви, підказки, ліміти, порядок і 8000 слів. Текст статті не змінюється; додані розділи з текстом переходять у кінець, порожні прибираються.</span>
            </div>
          </div>
        )}
        {!props.readOnly && (
          <div className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 10 }}>
            <button className={"btn sm" + (quotes ? " primary" : "")} aria-expanded={quotes} onClick={() => setQuotes(!quotes)} disabled={!props.shared.apps.length}
              title={props.shared.apps.length ? undefined : "Цитати з'являться, коли закодуєте хоча б один фрагмент"}>Цитати з кодування{quotes ? " ▸" : " ◂"}</button>
            <button className="btn sm" onMouseDown={(e) => e.preventDefault()} onClick={insertTable} disabled={!props.shared.cats.length}
              title={props.shared.cats.length ? undefined : "Таблиця будується з категорій (тем) вкладки «Кодування»"}>↳ Вставити таблицю тем</button>
            <button className="btn sm quiet" onClick={() => { flush(); props.toAnalysis(); }} disabled={!props.shared.apps.length}>Рисунок з візуального аналізу →</button>
          </div>
          {(quotes || placed) && <span className="small">{placed || `Поставте курсор у тексті розділу й натисніть «Вставити» біля цитати. Без курсора цитата піде в кінець розділу «${nameOf(resultsKey(keys))}».`}</span>}
          </div>
        )}
        {props.readOnly && <div className="warnline" style={{ borderStyle: "solid" }}>Статтю пише власник(ця) проєкту.{props.supervisor ? " Виділіть речення й натисніть «+ Зауваження» під розділом." : ""}</div>}
        <input className="input arttitle" value={draft.title} readOnly={props.readOnly} placeholder="Назва статті" aria-label="Назва статті"
          onChange={(e) => edit({ ...draft, title: e.target.value })} />
        <div className="row" style={{ gap: 12 }}>
          <label className="stack grow" style={{ gap: 4, fontSize: 13 }}>Автори(ки) — для титульної сторінки
            <input className="input" value={draft.authors ?? ""} readOnly={props.readOnly} placeholder="Ольга Бойко, Єгор Буцикін" onChange={(e) => edit({ ...draft, authors: e.target.value })} /></label>
          <label className="stack grow" style={{ gap: 4, fontSize: 13 }}>Афіліація
            <input className="input" value={draft.affiliation ?? ""} readOnly={props.readOnly} placeholder="Київська школа економіки" onChange={(e) => edit({ ...draft, affiliation: e.target.value })} /></label>
        </div>
        <span className="small">Підзаголовки всередині розділу (напр., назви тем): рядок «## Назва» — рівень 2, «### Назва» — рівень 3. Рядок з «{">"} » — довга цитата блоком.</span>

        {secs.map(({ key: k, ...d }) => {
          const text = draft.texts[k] ?? "";
          return (
            <section key={k} id={`sec-${k}`} className={"artsec" + (active === k ? " on" : "")} aria-label={d.name}>
              <div className="row" style={{ alignItems: "baseline" }}>
                <h3 className="grow" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{d.name}</h3>
                <Count n={countWords(text)} limit={d.limit || undefined} />
              </div>
              {d.hint && <details className="arthint"><summary>{draft.journal?.sections?.find((c) => c.key === k)?.hint?.trim() ? "Вимога журналу" : "Що писати"}</summary><p>{d.hint}</p></details>}
              {split(text).map((p, i, ps) => ("text" in p ? (
                <textarea key={`t${i}`} className={"input mono arttext" + (i ? " more" : "")} value={p.text} readOnly={props.readOnly} rows={i ? 1 : 3}
                  aria-label={i ? `Текст розділу «${d.name}» після ${draft.floats?.[(ps[i - 1] as { id: string }).id]?.kind === "tab" ? "таблиці" : "рисунка"}` : `Текст розділу «${d.name}»`}
                  ref={grow} onInput={(e) => grow(e.currentTarget)}
                  onFocus={() => setActive(k)} onBlur={flush}
                  onSelect={(e) => { const t = e.currentTarget; selection.current[k] = t.value.slice(t.selectionStart, t.selectionEnd).trim(); caret.current = { sec: k, seg: i / 2, pos: t.selectionEnd }; }}
                  onChange={(e) => { const n = [...ps]; n[i] = { text: e.target.value }; edit({ ...draft, texts: { ...draft.texts, [k]: join(n) } }); }} />
              ) : draft.floats?.[p.id] ? <Fragment key={p.id}>{FloatView({ id: p.id, f: draft.floats[p.id] })}</Fragment> : null))}
              {k === "abstract" && (
                <label className="stack" style={{ gap: 4, fontSize: 13 }}>{en ? "Keywords" : "Ключові слова"} — під анотацією, через кому
                  <input className="input" value={draft.keywords ?? ""} readOnly={props.readOnly} placeholder="невизначена втрата, горе, феноменологія" onChange={(e) => edit({ ...draft, keywords: e.target.value })} /></label>
              )}

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
        {RefList()}
        {createPortal(<PrintDoc blocks={blocks} en={en} />, document.body)}
        <p className="small">Рисунки й таблиці не входять у ліміт слів. Список літератури — останній розділ, у ліміт слів не входить.</p>

      </div>

      {quotes && !props.readOnly && (
        <aside className="quotes" aria-label="Цитати з кодування">
          <div aria-live="polite" className="small accent">{placed}</div>
          {!qcode ? codesByCategory(props.shared.codes.filter((c) => props.shared.apps.some((a) => a.code === c.id)), props.shared.cats).map((g) => (
            <div key={g.cat?.id ?? "-"} className="stack" style={{ gap: 2 }}>
              <span className="label">{g.cat?.name ?? "Без категорії"}</span>
              {g.codes.map((c) => (
                <button key={c.id} className="qcode" onClick={() => { setQcode(c.id); setPlaced(""); }}>
                  <span className="sw" style={{ background: c.color }} aria-hidden="true" />
                  <span className="grow">{c.name}</span>
                  <span className="small mono">{fragments(props.shared.apps.filter((a) => a.code === c.id)).length}</span>
                </button>
              ))}
            </div>
          )) : (
            <>
              <button className="link" style={{ fontSize: 12, alignSelf: "flex-start" }} onClick={() => { setQcode(null); setPlaced(""); }}>← Усі коди</button>
              <div className="row" style={{ gap: 8 }}>
                <span className="sw" style={{ background: props.shared.codes.find((c) => c.id === qcode)?.color }} aria-hidden="true" />
                <span style={{ fontWeight: 600 }}>{props.shared.codes.find((c) => c.id === qcode)?.name}</span>
              </div>
              {frags.map((f) => {
                const iv = ivOf(f.iv), t = fragText(f), voice = isVoice(f);
                if (!iv || !t) return null;
                return (
                  <div key={`${f.iv}|${f.rep}|${f.s}`} className="qfrag">
                    <span className="small mono">{iv.card.pseudonym}, інтерв'ю {String(iv.n).padStart(2, "0")}{props.priv.originals[f.iv]?.[f.rep]?.t ? ` · ${props.priv.originals[f.iv][f.rep].t}` : ""} · {[...f.by].map((b) => initialsOf(props.shared, b)).join(", ")}</span>
                    <p className="mono">«{t}»</p>
                    {voice
                      ? <button className="btn sm" style={{ alignSelf: "flex-start" }} onMouseDown={(e) => e.preventDefault()} onClick={() => insertQuote(f)}>↳ Вставити{countWords(t) >= 40 ? " блоком" : ""}</button>
                      : <span className="small">Це слова дослідника(ці), не учасника(ці) — у статтю як цитату не вставляється.</span>}
                  </div>
                );
              })}
            </>
          )}
        </aside>
      )}
    </div>
  );
}
