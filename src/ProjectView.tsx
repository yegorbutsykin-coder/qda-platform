import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { applyDict, guessRole, parseTranscript, suspects, type Role } from "./text";
import CodingSheet, { type CodingActions } from "./CodingSheet";
import Codebook from "./Codebook";
import CodesPanel from "./CodesPanel";
import { nextColor, quote, statuses, type Code } from "./coding";
import { applyDict as segsFor } from "./text";
import { emptyPrivate, emptyShared, GENDERS, newId, noteKey, pad, rebuild, speaker, type Card, type Field, type FieldType, type OrigReplica, type Private, type Shared } from "./model";
import Dictionary from "./Dictionary";

type Meta = { name: string; method: string; student: { work: string; supervisor: string } | null };
type Loaded = { content: Meta & { data: Shared | null }; private: Private | null };
type Toast = { text: string; undo?: () => void } | null;

const ROLE_LABEL: Record<Role, string> = { i: "Інтерв'юер(ка)", p: "Учасник(ця)", o: "Інше" };
const emptyCard = (): Card => ({ pseudonym: "", age: "", gender: "", date: "", values: {}, consent: false });

// ---------- card ----------

function CardForm(props: {
  card: Card; setCard: (c: Card) => void; fields: Field[];
  addField: (f: Field) => void; removeField: (f: Field) => void;
  realName?: string; setRealName?: (s: string) => void; openDict?: () => void;
}) {
  const { card, setCard, fields } = props;
  const set = (patch: Partial<Card>) => setCard({ ...card, ...patch });
  const [adding, setAdding] = useState(false);
  const [fName, setFName] = useState("");
  const [fType, setFType] = useState<FieldType>("text");
  const [fOpts, setFOpts] = useState("");
  const opts = fOpts.split(",").map((s) => s.trim()).filter(Boolean);
  const fieldMissing = !fName.trim() ? "Потрібна назва поля." : fType === "choice" && opts.length < 2 ? "Для вибору — щонайменше два варіанти." : "";
  const saveField = () => {
    if (fieldMissing) return;
    props.addField({ id: newId(), name: fName.trim(), type: fType, options: fType === "choice" ? opts : undefined });
    setAdding(false); setFName(""); setFOpts(""); setFType("text");
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="grid2">
        <label className="field"><span>Псевдонім <b className="req">*</b></span>
          <input className="input" value={card.pseudonym} maxLength={60} onChange={(e) => set({ pseudonym: e.target.value })} /></label>
        <label className="field"><span>Вік</span>
          <input className="input mono" inputMode="numeric" value={card.age} maxLength={3} onChange={(e) => set({ age: e.target.value.replace(/\D/g, "") })} /></label>
        <div className="field"><span id="glabel">Стать</span>
          <div className="row" role="group" aria-labelledby="glabel" style={{ gap: 6 }}>
            {GENDERS.map((g) => (
              <button type="button" key={g} className={"pill" + (card.gender === g ? " on" : "")} aria-pressed={card.gender === g}
                onClick={() => set({ gender: card.gender === g ? "" : g })}>{g}</button>
            ))}
          </div></div>
        <label className="field"><span>Дата інтерв'ю</span>
          <input className="input mono" type="date" value={card.date} onChange={(e) => set({ date: e.target.value })} /></label>
      </div>
      {fields.map((f) => (
        <label className="field" key={f.id}>
          <span className="row" style={{ gap: 8 }}>{f.name} <span className="small">· {f.type === "text" ? "текст" : f.type === "number" ? "число" : "вибір"}</span>
            <button type="button" className="link" style={{ minHeight: 24, fontSize: 12 }} onClick={() => props.removeField(f)}>прибрати поле</button></span>
          {f.type === "choice" ? (
            <select className="input" style={{ fontFamily: "inherit", fontSize: 14, height: 40 }} value={card.values[f.id] ?? ""} onChange={(e) => set({ values: { ...card.values, [f.id]: e.target.value } })}>
              <option value="">—</option>
              {f.options!.map((o) => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <input className={"input" + (f.type === "number" ? " mono" : "")} inputMode={f.type === "number" ? "decimal" : undefined} value={card.values[f.id] ?? ""}
              onChange={(e) => set({ values: { ...card.values, [f.id]: f.type === "number" ? e.target.value.replace(/[^\d.,-]/g, "") : e.target.value } })} />
          )}
        </label>
      ))}
      {!adding ? (
        <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>+ Додати поле</button>
      ) : (
        <div className="panel stack" style={{ gap: 10 }}>
          <span className="small">Нове поле з'явиться в картках усіх інтерв'ю проєкту.</span>
          <label className="field"><span>Назва поля</span><input className="input" value={fName} autoFocus placeholder="Напр.: спорідненість" onChange={(e) => setFName(e.target.value)} /></label>
          <div className="field"><span id="tlabel">Що вписувати</span>
            <div className="row" role="group" aria-labelledby="tlabel" style={{ gap: 6 }}>
              {([["text", "текст"], ["number", "число"], ["choice", "вибір"]] as const).map(([t, l]) => (
                <button type="button" key={t} className={"pill" + (fType === t ? " on" : "")} aria-pressed={fType === t} onClick={() => setFType(t)}>{l}</button>
              ))}
            </div></div>
          {fType === "choice" && <label className="field"><span>Варіанти через кому</span><input className="input" value={fOpts} placeholder="мати, батько, бабуся" onChange={(e) => setFOpts(e.target.value)} /></label>}
          <div className="row">
            <button type="button" className="btn sm primary" disabled={!!fieldMissing} onClick={saveField}>Додати поле</button>
            <button type="button" className="btn sm quiet" onClick={() => setAdding(false)}>Скасувати</button>
            <span className="small">{fieldMissing}</span>
          </div>
        </div>
      )}
      {props.setRealName && (
        <label className="field"><span>Справжнє ім'я учасника(ці) — лише для словника замін</span>
          <input className="input" value={props.realName} autoComplete="off" placeholder="Необов'язково" onChange={(e) => props.setRealName!(e.target.value)} />
          <span className="small">Якщо вписати, у словник замін цього інтерв'ю додасться заміна імені на псевдонім. Саме ім'я бачите лише ви.</span>
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={card.consent} onChange={(e) => set({ consent: e.target.checked })} />
        <span>Інформовану згоду на участь отримано <b className="req">*</b></span>
      </label>
      <span className="small">Псевдонім не має збігатися зі справжнім ім'ям. Справжні імена й назви місць у тексті — у словник замін{props.openDict && <>: <button type="button" className="link" style={{ minHeight: 0, fontSize: 12 }} onClick={props.openDict}>відкрити словник замін →</button></>}.</span>
    </div>
  );
}

// ---------- the project ----------

export default function ProjectView(props: { id: string; me: string; onBack: () => void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [shared, setShared] = useState<Shared>(emptyShared());
  const [priv, setPriv] = useState<Private>(emptyPrivate());
  const [error, setError] = useState("");
  const [view, setView] = useState<"main" | "add" | "card" | "dict" | "frags">("main");
  const [focus, setFocus] = useState<string | null>(null);
  const [underlines, setUnderlines] = useState(true);
  const [leftTab, setLeftTab] = useState<"iv" | "codes">("iv");
  const [byCat, setByCat] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const [sel, setSel] = useState<string>("");
  const [original, setOriginal] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const saving = useRef(Promise.resolve());

  useEffect(() => {
    invoke<Loaded>("load_project", { id: props.id })
      .then((r) => {
        setMeta(r.content);
        const s = { ...emptyShared(), ...(r.content.data ?? {}) };
        const p = { ...emptyPrivate(), ...(r.private ?? {}) };
        setShared(s); setPriv(p);
        setSel(s.interviews[0]?.id ?? "");
      })
      .catch((e) => setError(String(e)));
  }, [props.id]);

  /** Every change: recompute replaced texts, show at once, save in order. */
  function commit(s: Shared, p: Private) {
    const rebuilt = rebuild(s, p);
    setShared(rebuilt); setPriv(p);
    saving.current = saving.current.then(() =>
      invoke("save_project", { id: props.id, data: rebuilt, private: p }).then(() => setError(""), (e) => setError(`Не вдалося зберегти: ${e}`)),
    );
  }
  function notify(text: string, undo?: () => void) {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 10_000);
  }
  /** A change that shows "Скасувати" for 10 seconds instead of asking first. */
  function undoable(text: string, s: Shared, p: Private) {
    const before = { s: shared, p: priv };
    commit(s, p);
    notify(text, () => { commit(before.s, before.p); setToast(null); });
  }

  const iv = shared.interviews.find((x) => x.id === sel);
  const allSuspects = useMemo(
    () => suspects(shared.interviews.flatMap((x) => (priv.originals[x.id] ?? []).map((r) => ({ id: x.id, segs: applyDict(r.text, priv.dict, x.id) }))), priv.ignored),
    [shared, priv],
  );
  const flagged = new Set(allSuspects.filter((s) => !iv || s.interviews.includes(iv.id)).map((s) => s.key));
  const ivSuspects = allSuspects.filter((s) => iv && s.interviews.includes(iv.id));

  // ----- add interview -----
  const [file, setFile] = useState("");
  const [raw, setRaw] = useState("");
  const [findSpk, setFindSpk] = useState(true);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [card, setCard] = useState<Card>(emptyCard());
  const [realName, setRealName] = useState("");
  const parsed = useMemo(() => parseTranscript(raw, findSpk), [raw, findSpk]);

  const startAdd = () => { setFile(""); setRaw(""); setFindSpk(true); setRoles({}); setCard(emptyCard()); setRealName(""); setError(""); setView("add"); };
  const pickFile = async () => {
    const p = await open({ title: "Транскрипт інтерв'ю", filters: [{ name: "Текст", extensions: ["docx", "txt"] }] });
    if (typeof p !== "string") return;
    try {
      const text = await invoke<string>("read_transcript", { path: p });
      if (!text.trim()) throw "У файлі не знайдено тексту.";
      setFile(p); setRaw(text);
      const pp = parseTranscript(text, true);
      setRoles(Object.fromEntries(pp.labels.map((l) => [l.label, guessRole(l.label)])));
    } catch (e) {
      const s = String(e);
      setError(s === "bad_docx" ? "Не вдалося прочитати docx: файл пошкоджений або це не документ Word." : s === "unsupported" ? "Підтримуються файли .docx і .txt." : s === "too_big" ? "Файл завеликий (понад 50 МБ)." : s);
    }
  };
  const addMissing = !raw ? "Оберіть файл." : !card.pseudonym.trim() ? "Потрібен псевдонім." : !card.consent ? "Позначте інформовану згоду." : "";
  const saveInterview = () => {
    if (addMissing) return;
    const id = newId();
    const n = Math.max(0, ...shared.interviews.map((x) => x.n)) + 1;
    const originals: OrigReplica[] = parsed.replicas.map((r) => ({ ...r, role: r.label ? roles[r.label] ?? "p" : null }));
    const dict = realName.trim()
      ? [...priv.dict, { id: newId(), kind: "person" as const, from: [realName.trim()], to: card.pseudonym.trim(), scope: id, caps: true }]
      : priv.dict;
    commit(
      { ...shared, interviews: [...shared.interviews, { id, n, card: { ...card, pseudonym: card.pseudonym.trim() }, replicas: [], added: Date.now() }] },
      { ...priv, originals: { ...priv.originals, [id]: originals }, dict },
    );
    setSel(id); setView("main");
    notify(`Інтерв'ю ${pad(n)} · ${card.pseudonym.trim()} додано.`);
  };

  // ----- fields -----
  const addField = (f: Field) => commit({ ...shared, fields: [...shared.fields, f] }, priv);
  const removeField = (f: Field) => undoable(`Поле «${f.name}» прибрано з усіх карток.`, { ...shared, fields: shared.fields.filter((x) => x.id !== f.id) }, priv);

  // ----- edit card -----
  const editCard = () => { setCard(iv!.card); setView("card"); };
  const cardMissing = !card.pseudonym.trim() ? "Потрібен псевдонім." : !card.consent ? "Позначте інформовану згоду." : "";
  const saveCard = () => {
    if (cardMissing) return;
    commit({ ...shared, interviews: shared.interviews.map((x) => (x.id === iv!.id ? { ...x, card: { ...card, pseudonym: card.pseudonym.trim() } } : x)) }, priv);
    setView("main");
  };
  const removeInterview = () => {
    const rest = Object.fromEntries(Object.entries(priv.originals).filter(([k]) => k !== iv!.id));
    const next = shared.interviews.filter((x) => x.id !== iv!.id);
    const notes = Object.fromEntries(Object.entries(shared.notes).filter(([k]) => !k.startsWith(iv!.id + ":")));
    undoable(`Інтерв'ю ${pad(iv!.n)} · ${iv!.card.pseudonym} видалено.`, { ...shared, interviews: next, apps: shared.apps.filter((a) => a.iv !== iv!.id), notes },
      { ...priv, originals: rest, dict: priv.dict.filter((d) => d.scope !== iv!.id) });
    setSel(next[0]?.id ?? "");
  };

  // ----- coding -----
  const me = props.me;
  const act: CodingActions = {
    apply(code, rep, s, e) {
      // The same code on an overlapping piece by the same person: widen it instead of doubling.
      const same = shared.apps.filter((a) => a.code === code && a.iv === iv!.id && a.rep === rep && a.by === me && a.s <= e && a.e >= s);
      const merged = { id: newId(), code, iv: iv!.id, rep, s: Math.min(s, ...same.map((a) => a.s)), e: Math.max(e, ...same.map((a) => a.e)), by: me, at: Date.now() };
      commit({ ...shared, apps: [...shared.apps.filter((a) => !same.includes(a)), merged] }, priv);
    },
    create(name, rep, s, e) {
      const code: Code = { id: newId(), name, color: nextColor(shared.codes.map((c) => c.color)), by: me, at: Date.now() };
      commit({ ...shared, codes: [...shared.codes, code], apps: [...shared.apps, { id: newId(), code: code.id, iv: iv!.id, rep, s, e, by: me, at: Date.now() }] }, priv);
      notify(`Новий код «${name}».`);
    },
    removeApps(ids) {
      undoable(ids.length > 1 ? "Ваші коди з фрагмента прибрано." : "Код із фрагмента прибрано.", { ...shared, apps: shared.apps.filter((a) => !ids.includes(a.id)) }, priv);
    },
    setNote(rep, text) {
      const notes = { ...shared.notes };
      if (text.trim()) notes[noteKey(iv!.id, rep)] = { text, by: me, at: Date.now() };
      else delete notes[noteKey(iv!.id, rep)];
      commit({ ...shared, notes }, priv);
    },
  };
  const patchCode = (id: string, patch: Partial<Code>) => commit({ ...shared, codes: shared.codes.map((c) => (c.id === id ? { ...c, ...patch } : c)) }, priv);
  const removeCode = (c: Code) => {
    setFocus(null);
    undoable(`Код «${c.name}» і всі його позначки прибрано.`, { ...shared, codes: shared.codes.filter((x) => x.id !== c.id), apps: shared.apps.filter((a) => a.code !== c.id) }, priv);
  };
  const status = statuses(shared.interviews, shared.apps);
  const STATUS = { none: "не закодовано", new: "є нові коди", existing: "лише наявні коди" } as const;
  const fragCode = shared.codes.find((c) => c.id === focus);
  const goContext = (ivId: string, rep: number) => { setSel(ivId); setTarget(rep); setView("main"); };

  if (!meta) return <section className="card wide">{error ? <span className="bad">{error}</span> : <span className="small">Відкриваю…</span>}</section>;

  const errorLine = error ? <span className="bad" role="alert">{error}</span> : null;
  const fieldVal = (f: Field, c: Card) => c.values[f.id] || "—";

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row" style={{ gap: "8px 16px" }}>
        <button className="link" style={{ textDecoration: "none", fontSize: 12, fontWeight: 500 }} onClick={view === "main" ? props.onBack : () => setView("main")}>
          ← {view === "main" ? "Мої проєкти" : meta.name}
        </button>
        <div className="grow" />
        <span className="small">{meta.method}{meta.student ? ` · ${meta.student.work} · супервайзер(ка): ${meta.student.supervisor}` : ""}</span>
      </div>

      {view === "main" && (
        <>
          <div className="row" style={{ alignItems: "flex-end", gap: "12px 24px" }}>
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">Дослідження</span>
              <span className="title">{meta.name}</span>
            </div>
            <div className="grow" />
            <button className="btn sm" onClick={() => setView("dict")}>
              Словник замін · {priv.dict.length}{allSuspects.length > 0 && <span className="badge" title="Слова, схожі на імена, ще не замінені">{allSuspects.length}</span>}
            </button>
            <button className="btn sm primary" onClick={startAdd}>+ Додати інтерв'ю</button>
          </div>
          {errorLine}
          {shared.interviews.length === 0 ? (
            <div className="empty">
              <span style={{ fontSize: 15, fontWeight: 500 }}>Інтерв'ю ще немає</span>
              <span className="lead" style={{ maxWidth: 460 }}>Додайте транскрипт (.docx або .txt). Програма розпізнає репліки й мовців, а ви заповните картку учасника(ці).</span>
            </div>
          ) : (
            <div className="split">
              <nav className="ivlist" aria-label="Панель проєкту">
                <div className="seg" role="tablist" style={{ alignSelf: "stretch", marginBottom: 10 }}>
                  <button role="tab" aria-selected={leftTab === "iv"} aria-pressed={leftTab === "iv"} onClick={() => setLeftTab("iv")} style={{ flex: 1 }}>Інтерв'ю · {shared.interviews.length}</button>
                  <button role="tab" aria-selected={leftTab === "codes"} aria-pressed={leftTab === "codes"} onClick={() => setLeftTab("codes")} style={{ flex: 1 }}>Кодування</button>
                </div>
                {leftTab === "codes" && <CodesPanel shared={shared} priv={priv} method={meta.method} commit={commit} undoable={undoable} showFragments={(id) => { setFocus(id); setView("frags"); }} />}
                {leftTab === "iv" && shared.interviews.map((x) => (
                  <button key={x.id} className={"ivrow" + (x.id === sel ? " on" : "")} aria-current={x.id === sel} onClick={() => setSel(x.id)}>
                    <span className="mono">{pad(x.n)}</span><span className="grow">{x.card.pseudonym}</span><span className={"stdot " + status[x.id]} title={STATUS[status[x.id]]} aria-label={STATUS[status[x.id]]} />
                  </button>
                ))}
              </nav>
              {iv && (
                <section aria-label={`Інтерв'ю ${pad(iv.n)}`}>
                  <div className="cardline">
                    <span><b>{iv.card.pseudonym}</b></span>
                    {iv.card.age && <span>{iv.card.age} р.</span>}
                    {iv.card.gender && <span>{iv.card.gender}</span>}
                    {iv.card.date && <span className="mono">{new Date(iv.card.date).toLocaleDateString("uk-UA")}</span>}
                    {shared.fields.map((f) => <span key={f.id}>{f.name}: {fieldVal(f, iv.card)}</span>)}
                    <span className="grow" />
                    <button className="link" style={{ fontSize: 12, minHeight: 28 }} onClick={editCard}>Змінити картку</button>
                  </div>
                  <div className="row" style={{ gap: "8px 16px" }}>
                    <div className="seg" role="group" aria-label="Який текст показувати">
                      <button aria-pressed={!original} onClick={() => setOriginal(false)}>Із замінами</button>
                      <button aria-pressed={original} onClick={() => setOriginal(true)}>Оригінал</button>
                    </div>
                    <span className="small grow">{original ? "Справжні слова бачите лише ви." : "Так текст бачитимуть колеги й супервайзер(ка)."}</span>
                    <div className="seg" role="group" aria-label="Колір підкреслень">
                      <button aria-pressed={!byCat} onClick={() => setByCat(false)}>Мікрокоди</button>
                      <button aria-pressed={byCat} onClick={() => setByCat(true)}>Категорії</button>
                    </div>
                    <label className="check" style={{ fontSize: 12 }}><input type="checkbox" checked={underlines} onChange={(e) => setUnderlines(e.target.checked)} /><span>Підкреслення</span></label>
                  </div>
                  {ivSuspects.length > 0 && (
                    <div className="warnline">Ще не замінено: {ivSuspects.slice(0, 8).map((s) => `«${s.word}»`).join(", ")}{ivSuspects.length > 8 ? "…" : ""}. Колеги бачать ці слова як є.{" "}
                      <button className="link" style={{ fontSize: 12, minHeight: 0 }} onClick={() => setView("dict")}>До словника замін →</button></div>
                  )}
                  {focus && fragCode && (
                    <div className="warnline" style={{ borderStyle: "solid", borderColor: fragCode.color }}>Показано лише код «{fragCode.name}». <button className="link" style={{ fontSize: 12, minHeight: 0 }} onClick={() => setFocus(null)}>Показати всі</button></div>
                  )}
                  <CodingSheet iv={iv} priv={priv} codes={byCat ? shared.codes.map((c) => ({ ...c, color: shared.cats.find((k) => k.id === c.cat)?.color ?? c.color })) : shared.codes} apps={shared.apps} notes={shared.notes} me={me} original={original}
                    underlines={underlines} focus={focus} flagged={flagged} act={act} target={target} />
                  <div className="legend small">
                    <span><mark className="repl">[ім'я]</mark> замінено за словником</span>
                    <span><mark className="orig">Оксана</mark> справжнє слово (лише в «Оригіналі»)</span>
                    <span><mark className="suspect">Андрій</mark> схоже на ім'я, ще не замінено</span>
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}

      {view === "add" && (
        <section className="card wide" aria-label="Додати інтерв'ю" style={{ maxWidth: 760 }}>
          <h2>Додати інтерв'ю</h2>
          <div className="stack" style={{ gap: 10 }}>
            <span className="label">1 · Файл</span>
            <div className="row">
              <span className="mono path">{file || "файл не обрано"}</span>
              <button className="btn sm" onClick={pickFile}>{file ? "Обрати інший…" : "Обрати файл…"}</button>
            </div>
            <span className="small">Готовий транскрипт .docx або .txt. Аудіо й транскрипція — на наступному етапі. Файл лишається там, де був; у проєкт потрапляє лише зашифрований текст.</span>
            {raw && (
              <>
                <label className="check"><input type="checkbox" checked={findSpk} onChange={(e) => setFindSpk(e.target.checked)} /><span>Шукати позначки мовців</span></label>
                <span className="small">
                  Реплік: {parsed.replicas.length}{parsed.timecodes ? ` · таймкодів: ${parsed.timecodes}` : " · таймкодів не знайдено"}
                  {findSpk && !parsed.labels.length ? " · позначок мовців не знайдено — текст збережеться абзацами" : ""}
                </span>
                {parsed.labels.length > 0 && (
                  <div className="panel stack" style={{ gap: 8 }}>
                    <span className="small">Хто є хто? (позначки з файлу бачите лише ви; у тексті для колег — роль або псевдонім)</span>
                    {parsed.labels.map((l) => (
                      <label key={l.label} className="row" style={{ gap: 10 }}>
                        <span className="mono" style={{ minWidth: 120 }}>{l.label}:</span>
                        <span className="small" style={{ minWidth: 70 }}>×{l.count}</span>
                        <select className="input" style={{ height: 34, fontFamily: "inherit" }} value={roles[l.label] ?? "p"} onChange={(e) => setRoles({ ...roles, [l.label]: e.target.value as Role })}>
                          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
                <div className="sheet small-sheet" aria-label="Як програма зрозуміла текст">
                  {parsed.replicas.slice(0, 6).map((r, i) => (
                    <div className="rep" key={i}>
                      <span className="tc">{r.t ?? ""}</span>
                      <span className="who">{r.label ? speaker(roles[r.label] ?? "p", card) : ""}</span>
                      <span className="say">{r.text}</span>
                    </div>
                  ))}
                  {parsed.replicas.length > 6 && <span className="small">… ще {parsed.replicas.length - 6}</span>}
                </div>
              </>
            )}
          </div>
          <div className="rule" style={{ gap: 12 }}>
            <span className="label">2 · Картка учасника(ці)</span>
            <CardForm card={card} setCard={setCard} fields={shared.fields} addField={addField} removeField={removeField} realName={realName} setRealName={setRealName} />
          </div>
          {errorLine}
          <div className="row">
            <button className="btn quiet" onClick={() => setView("main")}>Скасувати</button>
            <button className="btn primary" disabled={!!addMissing} onClick={saveInterview}>Додати інтерв'ю</button>
            <span className="small" aria-live="polite">{addMissing}</span>
          </div>
        </section>
      )}

      {view === "card" && iv && (
        <section className="card wide" aria-label="Картка учасника(ці)">
          <h2>Картка · інтерв'ю {pad(iv.n)}</h2>
          <CardForm card={card} setCard={setCard} fields={shared.fields} addField={addField} removeField={removeField} openDict={() => setView("dict")} />
          {errorLine}
          <div className="row">
            <button className="btn quiet" onClick={() => setView("main")}>Скасувати</button>
            <button className="btn primary" disabled={!!cardMissing} onClick={saveCard}>Зберегти картку</button>
            <span className="small">{cardMissing}</span>
            <div className="grow" />
            <button className="link" style={{ fontSize: 12, color: "var(--bad)" }} onClick={() => { setView("main"); removeInterview(); }}>Видалити інтерв'ю</button>
          </div>
        </section>
      )}

      {view === "main" && leftTab === "iv" && shared.interviews.length > 0 && (
        <Codebook codes={shared.codes} apps={shared.apps} focus={focus} setFocus={setFocus}
          rename={(id, name) => patchCode(id, { name })} recolor={(id, color) => patchCode(id, { color })}
          setNote={(id, note) => patchCode(id, { note })} remove={removeCode} showFragments={(id) => { setFocus(id); setView("frags"); }} />
      )}

      {view === "frags" && fragCode && (
        <section className="stack" style={{ gap: 14, maxWidth: 920 }} aria-label={`Фрагменти коду ${fragCode.name}`}>
          <div className="row">
            <span className="sw lg" style={{ background: fragCode.color }} aria-hidden="true" />
            <span className="title grow">{fragCode.name}</span>
            <button className="btn sm" onClick={() => setView("main")}>← До транскрипту</button>
          </div>
          {fragCode.note && <div className="panel"><span className="label">Попередня інтерпретація</span><p className="mono" style={{ fontSize: 13, lineHeight: 1.7 }}>{fragCode.note}</p></div>}
          {shared.interviews.flatMap((x) => shared.apps.filter((a) => a.code === fragCode.id && a.iv === x.id).sort((a, b) => a.rep - b.rep || a.s - b.s).map((a) => {
            const r = priv.originals[x.id]?.[a.rep];
            if (!r) return null;
            return (
              <div className="frag" key={a.id}>
                <div className="stack" style={{ gap: 3, flex: "0 0 150px" }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{pad(x.n)} · {x.card.pseudonym}</span>
                  <span className="mono small">{r.t ?? ""}</span>
                  <span className="small">{a.by}</span>
                </div>
                <p className="mono grow" style={{ fontSize: 14, lineHeight: 1.8, minWidth: 0 }}>«{quote(segsFor(r.text, priv.dict, x.id), a.s, a.e)}»</p>
                <button className="btn sm quiet" style={{ alignSelf: "flex-start" }} onClick={() => goContext(x.id, a.rep)}>У контексті →</button>
              </div>
            );
          }))}
          {!shared.apps.some((a) => a.code === fragCode.id) && <span className="small">Фрагментів із цим кодом немає.</span>}
        </section>
      )}

      {view === "dict" && (
        <Dictionary shared={shared} priv={priv} sel={sel} setSel={setSel} suspectsAll={allSuspects} commit={commit} undoable={undoable} errorLine={errorLine} />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button className="link" onClick={toast.undo}>Скасувати</button>}
        </div>
      )}
    </div>
  );
}
