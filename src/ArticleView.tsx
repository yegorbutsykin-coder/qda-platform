// Stage 5: the «Стаття» tab — title, sections by method with hints, word counts, supervisor remarks, quotes from coding.
import { useEffect, useRef, useState } from "react";
import { countWords, formatQuote, insertAt, journalChanged, METHODS, resetJournal, sectionsOf, totalLimit, type Article, type Journal, type Method, type SectionConf } from "./article";
import { initialsOf, newId, type Note, type Private, type Shared } from "./model";
import { quote } from "./coding";
import { codesByCategory, fragments, type Frag } from "./figures";
import { applyDict } from "./text";
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
  article: Article; method: string; shared: Shared; priv: Private; readOnly: boolean; supervisor: boolean; me: string;
  notes: Record<string, Note>; who: (by: string) => string; focus: string | null;
  save: (a: Article) => void; addRemark: (sec: string, text: string, quote: string) => void; setRemark: (key: string, p: RemarkPatch) => void;
}) {
  const [draft, setDraft] = useState(props.article);
  const [active, setActive] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [writing, setWriting] = useState<string | null>(null); // section with an open remark form
  const [remark, setRemarkText] = useState("");
  const selection = useRef<Record<string, string>>({});
  const caret = useRef<{ sec: string; pos: number } | null>(null); // where a quote goes
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
    setDraft(a);
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 700);
  };
  // Text put in by a quote, undo or a package doesn't fire onInput — fit the boxes to it too.
  useEffect(() => document.querySelectorAll<HTMLTextAreaElement>("textarea.arttext").forEach(grow), [draft.texts]);
  useEffect(() => {
    if (props.focus) document.getElementById(`sec-${props.focus}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
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
  const insertQuote = (f: Frag) => {
    const iv = ivOf(f.iv);
    if (!iv) return;
    const c = caret.current;
    const k = c && secs.some((x) => x.key === c.sec) ? c.sec : (secs.find((x) => x.key === "results") ?? secs[secs.length - 1]).key;
    const cur = draft.texts[k] ?? "";
    const r = insertAt(cur, c?.sec === k ? Math.min(c.pos, cur.length) : cur.length, formatQuote(fragText(f), iv.card.pseudonym, iv.n, lang));
    edit({ ...draft, texts: { ...draft.texts, [k]: r.text } });
    caret.current = { sec: k, pos: r.pos };
    setActive(k);
    setPlaced(`Цитату вставлено в розділ «${secs.find((x) => x.key === k)?.name}».`);
  };
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
            <label className="stack" style={{ gap: 4, fontSize: 13 }}>Інші вимоги журналу — видно над статтею, коли панель закрита
              <textarea className="input" rows={3} value={j.other} onChange={(e) => setJ({ other: e.target.value })} placeholder="Напр.: анонімізований рукопис; структурована анотація; ключові слова англійською…" /></label>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn sm" disabled={!journalChanged(draft)} onClick={() => edit(resetJournal(draft))}>Скинути вимоги журналу</button>
              <span className="small">Повертає стандарт APA для формату {fmt}: назви, підказки, ліміти, порядок і 8000 слів. Текст статті не змінюється; додані розділи з текстом переходять у кінець, порожні прибираються.</span>
            </div>
          </div>
        )}
        {!props.readOnly && (
          <div className="row" style={{ gap: 10 }}>
            <button className={"btn sm" + (quotes ? " primary" : "")} aria-expanded={quotes} onClick={() => setQuotes(!quotes)} disabled={!props.shared.apps.length}
              title={props.shared.apps.length ? undefined : "Цитати з'являться, коли закодуєте хоча б один фрагмент"}>Цитати з кодування{quotes ? " ▸" : " ◂"}</button>
            {quotes && <span className="small">Поставте курсор у тексті розділу й натисніть «Вставити» біля цитати. Без курсора цитата піде в кінець розділу «{(secs.find((x) => x.key === "results") ?? secs[secs.length - 1]).name}».</span>}
          </div>
        )}
        {props.readOnly && <div className="warnline" style={{ borderStyle: "solid" }}>Статтю пише власник(ця) проєкту.{props.supervisor ? " Виділіть речення й натисніть «+ Зауваження» під розділом." : ""}</div>}
        <input className="input arttitle" value={draft.title} readOnly={props.readOnly} placeholder="Назва статті" aria-label="Назва статті"
          onChange={(e) => edit({ ...draft, title: e.target.value })} />

        {secs.map(({ key: k, ...d }) => {
          const text = draft.texts[k] ?? "";
          return (
            <section key={k} id={`sec-${k}`} className={"artsec" + (active === k ? " on" : "")} aria-label={d.name}>
              <div className="row" style={{ alignItems: "baseline" }}>
                <h3 className="grow" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{d.name}</h3>
                <Count n={countWords(text)} limit={d.limit || undefined} />
              </div>
              {d.hint && <details className="arthint"><summary>{draft.journal?.sections?.find((c) => c.key === k)?.hint?.trim() ? "Вимога журналу" : "Що писати"}</summary><p>{d.hint}</p></details>}
              <textarea className="input mono arttext" value={text} readOnly={props.readOnly} rows={3} aria-label={`Текст розділу «${d.name}»`}
                ref={grow} onInput={(e) => grow(e.currentTarget)}
                onFocus={() => setActive(k)} onBlur={flush}
                onSelect={(e) => { const t = e.currentTarget; selection.current[k] = t.value.slice(t.selectionStart, t.selectionEnd).trim(); caret.current = { sec: k, pos: t.selectionEnd }; }}
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
        <p className="small">Список літератури з перевіркою за APA 7 з'явиться на етапі 6; рисунки й таблиця тем — на кроці 5.4; експорт у Word і PDF — 5.5.</p>
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
