import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import Player, { seconds } from "./Player";
import { open, save } from "@tauri-apps/plugin-dialog";
import { applyDict, guessRole, parseTranscript, segmentsToReplicas, suspects, type Role, type TxSegment } from "./text";
import Compare, { LANGS } from "./Compare";
import Share from "./Share";
import Merge, { PackPicker } from "./Merge";
import { RemarksView, Remark, type RemarkPatch, type RemarkRow } from "./Remarks";
import { updateCopy } from "./exchange";
import CodingSheet, { type CodingActions, type EditActions } from "./CodingSheet";
import Codebook from "./Codebook";
import CodesPanel from "./CodesPanel";
import { dropReplica, nextColor, noteParts, quote, remapApps, sharedFragments, splitReplica, statuses, type Code } from "./coding";
import { applyDict as segsFor } from "./text";
import { adoptPeople, emptyPrivate, emptyShared, ensureIds, initialsOf, type Person, GENDERS, newId, noteKey, pad, rebuild, speaker, type Tx, type Card, type Field, type FieldType, type OrigReplica, type Private, type Shared } from "./model";
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

const NONE = new Set<string>();

export default function ProjectView(props: { id: string; me: Person & { id: string }; onBack: () => void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [shared, setShared] = useState<Shared>(emptyShared());
  const [priv, setPriv] = useState<Private>(emptyPrivate());
  const [error, setError] = useState("");
  const [view, setView] = useState<"main" | "add" | "card" | "dict" | "frags" | "compare" | "share" | "merge" | "remarks" | "update">("main");
  const [focus, setFocus] = useState<string | null>(null);
  const [underlines, setUnderlines] = useState(true);
  const [leftTab, setLeftTab] = useState<"iv" | "codes">("iv");
  const [byCat, setByCat] = useState(false);
  const [audioState, setAudioState] = useState<Record<string, string>>({});
  const [nowRep, setNowRep] = useState<number | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [sel, setSel] = useState<string>("");
  const [original, setOriginal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [whose, setWhose] = useState("all"); // whose coding is shown: "all" or a profile id (blind coding: just mine)
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const saving = useRef(Promise.resolve());

  useEffect(() => {
    invoke<Loaded>("load_project", { id: props.id })
      .then((r) => {
        setMeta(r.content);
        const s0 = { ...emptyShared(), ...(r.content.data ?? {}) };
        const s = adoptPeople(s0, props.me);
        const p0 = { ...emptyPrivate(), ...(r.private ?? {}) };
        const p = ensureIds(p0);
        const s1 = p === p0 ? s : rebuild(s, p);
        setShared(s1); setPriv(p);
        // Older project: keep the new replica ids and authors at once, so they are the same next time.
        if (p !== p0 || s !== s0) invoke("save_project", { id: props.id, data: s1, private: p }).catch((e) => setError(`Не вдалося зберегти: ${e}`));
        setSel(s.interviews[0]?.id ?? "");
        // Recordings stay where they are: check each one and let the window play it.
        for (const [id, a] of Object.entries(p.audio)) {
          invoke<string>("allow_audio", { path: a.path, fingerprint: a.fp })
            .then((st) => setAudioState((m) => ({ ...m, [id]: st })), () => setAudioState((m) => ({ ...m, [id]: "missing" })));
        }
      })
      .catch((e) => setError(String(e)));
  }, [props.id]);

  /** Every change: recompute replaced texts, show at once, save in order. */
  function commit(s: Shared, p0: Private) {
    const p = ensureIds(p0);
    // Texts with replacements depend only on the originals and the dictionary: skip the work otherwise.
    const rebuilt = p === priv && s.interviews === shared.interviews ? s : rebuild(s, p);
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
    [shared.interviews, priv],
  );
  const [fragShow, setFragShow] = useState<"all" | "shared" | "single">("all");
  const fragShared = useMemo(() => (focus ? sharedFragments(shared.apps, focus) : new Map<string, string[]>()), [shared.apps, focus]);
  const fragPeople = new Set(shared.apps.filter((a) => a.code === focus).map((a) => a.by)).size;
  const copy = shared.copyOf;
  function setRemark(key: string, patch: RemarkPatch) {
    const n = shared.notes[key];
    if (n) commit({ ...shared, notes: { ...shared.notes, [key]: { ...n, ...patch, statusAt: Date.now() } } }, priv);
  }
  const who = (by: string) => initialsOf(shared, by);
  const remarkRows: RemarkRow[] = Object.entries(shared.notes).filter(([, n]) => n.status).map(([key, n]) => {
    if (key.startsWith("code:")) {
      const c = shared.codes.find((x) => x.id === key.split(":")[1]);
      return { key, n, where: `код «${c?.name ?? "?"}»`, go: c ? () => { setFocus(c.id); setView("frags"); } : undefined };
    }
    const x = shared.interviews.find((v) => key.startsWith(v.id + ":"));
    const p = x ? noteParts(key, x.id) : null;
    return x && p ? { key, n, where: `${pad(x.n)} · ${x.card.pseudonym}${priv.originals[x.id]?.[p.rep]?.t ? " · " + priv.originals[x.id][p.rep].t : ""}`, go: () => goContext(x.id, p.rep) } : { key, n, where: "—" };
  });
  const openRemarks = remarkRows.filter((r) => r.n.status !== "closed").length;
  // A remark on a code (in a supervisor's copy): one per person, beside the code's fragments.
  function setCodeRemark(code: string, text: string) {
    const key = `code:${code}:${me}`;
    const notes = { ...shared.notes };
    if (text.trim()) notes[key] = { ...notes[key], text, by: me, at: Date.now(), ...(notes[key]?.status ? {} : { status: "open" as const, statusAt: Date.now() }) };
    else delete notes[key];
    commit({ ...shared, notes }, priv);
  }
  const coders = [...new Set([props.me.id, ...shared.apps.map((a) => a.by)])];
  const flagged = new Set(allSuspects.filter((s) => !iv || s.interviews.includes(iv.id)).map((s) => s.key));
  const ivSuspects = allSuspects.filter((s) => iv && s.interviews.includes(iv.id));

  // ----- transcription -----
  type ModelState = { id: string; label: string; mib: number; downloaded: boolean; download: { state: string; pct: number; error?: string } | null };
  type TxStatus = { state: string; pct: number; error?: string; segments?: TxSegment[]; stage: string; detail: string } | null;
  const [models, setModels] = useState<ModelState[]>([]);
  const [model, setModel] = useState("");
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("qda.lang") ?? "auto"; } catch { return "auto"; } });
  const [audioFile, setAudioFile] = useState("");
  const [txPct, setTxPct] = useState<Record<string, number>>({});
  const [txInfo, setTxInfo] = useState<Record<string, { stage: string; detail: string; since: number }>>({});
  const [, setTick] = useState(0);
  const latest = useRef({ shared, priv });
  latest.current = { shared, priv };
  const loadModels = () => invoke<ModelState[]>("models_list").then((ms) => {
    setModels(ms);
    const saved = (() => { try { return localStorage.getItem("qda.model") ?? ""; } catch { return ""; } })();
    setModel((cur) => cur || (ms.some((m) => m.id === saved && m.downloaded) ? saved : ms.find((m) => m.downloaded)?.id || ""));
  });
  const setTx = (id: string, tx: Tx | undefined, originals?: OrigReplica[]) => {
    const { shared: s, priv: p } = latest.current;
    commit({ ...s, interviews: s.interviews.map((x) => (x.id === id ? { ...x, tx } : x)) },
      originals ? { ...p, originals: { ...p.originals, [id]: originals } } : p);
  };
  const running = shared.interviews.filter((x) => x.tx?.state === "running").map((x) => x.id).join(",");
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(async () => {
      for (const id of running.split(",")) {
        const st = await invoke<TxStatus>("transcription_status", { job: id }).catch(() => null);
        const ivx = latest.current.shared.interviews.find((x) => x.id === id);
        if (!ivx?.tx) continue;
        if (!st) setTx(id, { ...ivx.tx, state: "interrupted" });
        else if (st.state === "running") {
          setTxPct((m) => ({ ...m, [id]: st.pct }));
          setTxInfo((m) => ({ ...m, [id]: { stage: st.stage, detail: st.detail, since: m[id]?.since ?? Date.now() } }));
          setTick((n) => n + 1);
        }
        else if (st.state === "done") {
          setTx(id, undefined, segmentsToReplicas(st.segments ?? []).map((r) => ({ ...r, role: null })));
          notify(`Транскрипцію інтерв'ю ${pad(ivx.n)} · ${ivx.card.pseudonym} завершено.`);
        } else setTx(id, { ...ivx.tx, state: "error", error: st.error });
      }
    }, 1500);
    return () => window.clearInterval(t);
  }, [running]);
  const downloading = models.some((m) => m.download?.state === "running");
  useEffect(() => {
    if (!downloading) return;
    const t = window.setInterval(loadModels, 1000);
    return () => window.clearInterval(t);
  }, [downloading]);
  const downloadModel = (id: string) => invoke("download_model", { id }).then(loadModels).catch((e) => setError(String(e)));
  const startTx = async (id: string, path: string, m: string, l: string) => {
    try {
      await invoke("start_transcription", { job: id, path, model: m, language: l });
      setTxPct((x) => ({ ...x, [id]: 0 }));
      setTxInfo((m) => ({ ...m, [id]: { stage: "convert", detail: "", since: Date.now() } }));
      return true;
    } catch (e) {
      setError(String(e) === "no_model" ? "Модель ще не завантажено." : `Не вдалося почати транскрипцію: ${e}`);
      return false;
    }
  };
  const restartTx = async () => {
    if (!iv?.tx || !priv.audio[iv.id]) return;
    if (await startTx(iv.id, priv.audio[iv.id].path, iv.tx.model, iv.tx.lang)) setTx(iv.id, { ...iv.tx, state: "running", error: undefined });
  };
  const txError = (e?: string) =>
    !e ? "" : e.startsWith("no_network") ? "Немає з'єднання з інтернетом." : e === "bad_checksum" ? "Завантажений файл не збігся з контрольною сумою — його видалено; спробуйте ще раз."
      : e === "no_whisper" ? "У програмі бракує модуля транскрипції — перевстановіть програму." : e === "format_windows" ? "На Windows поки що підтримуються лише wav, mp3, ogg, flac."
      : e.startsWith("convert") ? "Не вдалося прочитати аудіофайл." : e === "cancelled" ? "Зупинено." : e;

  const dur = (sec: number) => (sec < 90 ? `${Math.round(sec)} с` : sec < 5400 ? `${Math.round(sec / 60)} хв` : `${(sec / 3600).toFixed(1).replace(".", ",")} год`);

  // ----- add interview -----
  const [file, setFile] = useState("");
  const [raw, setRaw] = useState("");
  const [findSpk, setFindSpk] = useState(true);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [card, setCard] = useState<Card>(emptyCard());
  const [realName, setRealName] = useState("");
  const parsed = useMemo(() => parseTranscript(raw, findSpk), [raw, findSpk]);

  const startAdd = () => { setAudioFile(""); loadModels().catch(() => {}); setFile(""); setRaw(""); setFindSpk(true); setRoles({}); setCard(emptyCard()); setRealName(""); setError(""); setView("add"); };
  const pickFile = async () => {
    const p = await open({ title: "Інтерв'ю: запис або транскрипт", filters: [{ name: "Аудіо або текст", extensions: ["mp3", "m4a", "wav", "mp4", "aac", "ogg", "docx", "txt"] }] });
    if (typeof p !== "string") return;
    if (/\.(mp3|m4a|wav|mp4|aac|ogg)$/i.test(p)) { setAudioFile(p); setFile(p); setRaw(""); setError(""); return; }
    setAudioFile("");
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
  const modelReady = models.some((m) => m.id === model && m.downloaded);
  const addMissing = !raw && !audioFile ? "Оберіть файл." : audioFile && !modelReady ? "Оберіть завантажену модель." : !card.pseudonym.trim() ? "Потрібен псевдонім." : !card.consent ? "Позначте інформовану згоду." : "";
  const saveInterview = async () => {
    if (addMissing) return;
    const id = newId();
    if (audioFile) {
      // Audio: the interview appears at once and fills in when the transcription finishes.
      let fp: string;
      try { fp = await invoke<string>("attach_audio", { path: audioFile }); } catch (e) { setError(`Не вдалося відкрити запис: ${e}`); return; }
      if (!(await startTx(id, audioFile, model, lang))) return;
      const n = Math.max(0, ...shared.interviews.map((x) => x.n)) + 1;
      const dict = realName.trim() ? [...priv.dict, { id: newId(), kind: "person" as const, from: [realName.trim()], to: card.pseudonym.trim(), scope: id, caps: true }] : priv.dict;
      const name = audioFile.split(/[\\/]/).pop() ?? audioFile;
      commit(
        { ...shared, interviews: [...shared.interviews, { id, n, card: { ...card, pseudonym: card.pseudonym.trim() }, replicas: [], added: Date.now(), audio: "kept", tx: { state: "running", model, lang } }] },
        { ...priv, originals: { ...priv.originals, [id]: [] }, dict, audio: { ...priv.audio, [id]: { path: audioFile, fp, name } } },
      );
      setAudioState((m) => ({ ...m, [id]: "ok" }));
      setSel(id); setView("main");
      notify(`Інтерв'ю ${pad(n)} · ${card.pseudonym.trim()} додано; транскрибується на цьому комп'ютері.`);
      return;
    }
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

  // ----- audio -----
  const pickAudio = async () => {
    const path = await open({ title: "Запис інтерв'ю", filters: [{ name: "Аудіо", extensions: ["mp3", "m4a", "wav", "mp4", "aac", "ogg"] }] });
    if (typeof path !== "string" || !iv) return;
    try {
      const fp = await invoke<string>("attach_audio", { path });
      const name = path.split(/[\\/]/).pop() ?? path;
      commit({ ...shared, interviews: shared.interviews.map((x) => (x.id === iv.id ? { ...x, audio: "kept" as const } : x)) },
        { ...priv, audio: { ...priv.audio, [iv.id]: { path, fp, name } } });
      setAudioState((m) => ({ ...m, [iv.id]: "ok" }));
    } catch (e) { setError(String(e) === "not_audio" ? "Це не аудіофайл (mp3, m4a, wav, mp4, aac, ogg)." : `Не вдалося відкрити запис: ${e}`); }
  };
  const audioDeleted = () => {
    if (!iv) return;
    const rest = { ...priv.audio };
    delete rest[iv.id];
    undoable("Позначено: запис видалено після звірки транскрипту.", { ...shared, interviews: shared.interviews.map((x) => (x.id === iv.id ? { ...x, audio: "deleted" as const } : x)) }, { ...priv, audio: rest });
  };
  const seek = (t: string) => {
    const el = audioEl.current, sec = seconds(t);
    if (!el || sec == null) return;
    el.currentTime = sec;
    el.play();
  };
  const onTime = (time: number) => {
    const reps = (iv && priv.originals[iv.id]) || [];
    let k: number | null = null;
    reps.forEach((r, i) => { const sec = seconds(r.t); if (sec != null && sec <= time) k = i; });
    setNowRep((prev) => (prev === k ? prev : k));
  };

  // ----- coding -----
  const me = props.me.id;
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
    remark: setRemark,
    setNote(rep, text, counter) {
      const notes = { ...shared.notes };
      // My comment keeps its key; a replica someone else commented on gets mine beside theirs.
      const base = noteKey(iv!.id, rep);
      const key = Object.keys(notes).find((k) => notes[k].by === me && noteParts(k, iv!.id)?.rep === rep)
        ?? (notes[base] ? `${base}:${me}` : base);
      const flag = counter ?? notes[key]?.counter;
      // In a supervisor's copy every comment is a remark: it starts "open".
      const status = notes[key]?.status ?? (copy?.kind === "supervisor" ? "open" : undefined);
      if (text.trim()) notes[key] = { ...notes[key], text, by: me, at: Date.now(), counter: flag || undefined, ...(status && !notes[key]?.status ? { status, statusAt: Date.now() } : {}) };
      else delete notes[key];
      commit({ ...shared, notes }, priv);
    },
  };
  // ----- editing the transcript -----
  const origs = () => priv.originals[iv!.id] ?? [];
  const setOrigs = (list: OrigReplica[]) => ({ ...priv, originals: { ...priv.originals, [iv!.id]: list } });
  const edit: EditActions = {
    text(rep, text) {
      const before = origs()[rep].text;
      if (text === before) return;
      commit({ ...shared, apps: remapApps(shared.apps, iv!.id, rep, before, text) }, setOrigs(origs().map((r, i) => (i === rep ? { ...r, text } : r))));
    },
    role(rep, role) { commit(shared, setOrigs(origs().map((r, i) => (i === rep ? { ...r, role } : r)))); },
    remove(rep) {
      const r = dropReplica(shared.apps, shared.notes, iv!.id, rep);
      undoable(`Репліку ${rep + 1} видалено разом з її кодами й коментарем.`, { ...shared, ...r }, setOrigs(origs().filter((_, i) => i !== rep)));
    },
    join(rep) {
      const list = origs(), prev = list[rep - 1];
      const r = dropReplica(shared.apps, shared.notes, iv!.id, rep, { offset: prev.text.length + 1 });
      undoable(`Репліку ${rep + 1} приєднано до попередньої.`, { ...shared, ...r },
        setOrigs(list.flatMap((x, i) => (i === rep ? [] : i === rep - 1 ? [{ ...x, text: x.text + " " + list[rep].text }] : [x]))));
    },
    play: priv.audio[iv?.id ?? ""] && audioState[iv?.id ?? ""] === "ok" ? () => {
      const el = audioEl.current;
      if (!el) return;
      // Back 2 s on resume, so the words before the pause are heard again.
      if (el.paused) { el.currentTime = Math.max(0, el.currentTime - 2); el.play(); } else el.pause();
    } : undefined,
    split(rep, text, pos) {
      const list = origs();
      const apps = remapApps(shared.apps, iv!.id, rep, list[rep].text, text);
      const r = splitReplica(apps, shared.notes, iv!.id, rep, text, pos, newId);
      undoable(`Репліку ${rep + 1} розділено на дві. У другої немає таймкоду.`, { ...shared, apps: r.apps, notes: r.notes },
        setOrigs(list.flatMap((x, i) => (i === rep ? [{ ...x, text: r.first }, { ...x, t: null, text: r.second }] : [x]))));
    },
  };

  /** The transcript as on screen (with replacements, or the original) into a Word file. */
  async function exportWord() {
    const x = iv!;
    const reps = original ? origs() : x.replicas;
    const title = `Інтерв'ю ${pad(x.n)} · ${x.card.pseudonym}`;
    const path = await save({ title: "Експорт у Word", defaultPath: `${title}${original ? " (оригінал)" : ""}.docx`.replace(/[\\/:*?"<>|]/g, "-"), filters: [{ name: "Word", extensions: ["docx"] }] });
    if (!path) return;
    const meta = [x.card.age && `${x.card.age} р.`, x.card.gender, x.card.date && new Date(x.card.date).toLocaleDateString("uk-UA"),
      ...shared.fields.map((f) => `${f.name}: ${fieldVal(f, x.card)}`)].filter(Boolean).join(" · ");
    try {
      await invoke("export_docx", { path: path.toLowerCase().endsWith(".docx") ? path : path + ".docx", title, meta,
        lines: reps.map((r) => ({ t: r.t, who: r.role ? speaker(r.role, x.card) : null, text: r.text })) });
      notify(original ? "Збережено в Word — увага: з оригінальними (справжніми) словами." : "Збережено в Word — текст із замінами.");
    } catch (e) {
      setError(`Не вдалося зберегти файл Word: ${e}`);
    }
  }

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
            {remarkRows.length > 0 && <button className="btn sm" onClick={() => setView("remarks")}>Зауваження · {openRemarks}</button>}
            {copy ? (
              <>
                <button className="btn sm" onClick={() => setView("update")}>Оновити копію…</button>
                <button className="btn sm primary" onClick={() => setView("share")}>Надіслати зміни…</button>
              </>
            ) : (
              <>
                <button className="btn sm" onClick={() => setView("merge")}>Додати зміни від колеги…</button>
                <button className="btn sm" onClick={() => setView("share")} disabled={!shared.interviews.length}>Поділитися…</button>
                <button className="btn sm" onClick={() => setView("dict")}>
                  Словник замін · {priv.dict.length}{allSuspects.length > 0 && <span className="badge" title="Слова, схожі на імена, ще не замінені">{allSuspects.length}</span>}
                </button>
                <button className="btn sm primary" onClick={startAdd}>+ Додати інтерв'ю</button>
              </>
            )}
          </div>
          {copy && (
            <div className="warnline" style={{ borderStyle: "solid" }}>
              {copy.kind === "supervisor" ? "Пакет для супервайзера(ки)" : "Копія"} від <b>{copy.from.name}</b>, надіслано {new Date(copy.sent).toLocaleDateString("uk-UA")}{copy.stage ? ` · етап: ${copy.stage}` : ""}{copy.blind ? " · без кодування власника(ці)" : ""}.
              {" "}Тут можна кодувати й коментувати; текст транскриптів і картки змінює лише власник(ця) проєкту.
            </div>
          )}
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
                  <button key={x.id} className={"ivrow" + (x.id === sel ? " on" : "")} aria-current={x.id === sel} onClick={() => { setSel(x.id); setNowRep(null); }}>
                    <span className="mono">{pad(x.n)}</span><span className="grow">{x.card.pseudonym}</span>{x.tx ? <span className={"small" + (x.tx.state === "running" ? "" : " accent")}>{x.tx.state === "running" ? `транскрибується… ${txPct[x.id] ?? 0}%` : x.tx.state === "error" ? "помилка" : "перервано"}</span>
                      : <span className={"stdot " + status[x.id]} title={STATUS[status[x.id]]} aria-label={STATUS[status[x.id]]} />}
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
                    {!iv.tx && !copy && (editing ? <button className="btn sm primary" onClick={() => setEditing(false)}>Готово</button>
                      : <button className="link" style={{ fontSize: 12, minHeight: 28 }} onClick={() => setEditing(true)}>Редагувати текст</button>)}
                    {!iv.tx && <button className="link" style={{ fontSize: 12, minHeight: 28 }} onClick={exportWord}>Експорт у Word</button>}
                    {!copy && <button className="link" style={{ fontSize: 12, minHeight: 28 }} onClick={editCard}>Змінити картку</button>}
                  </div>
                  <div className="row" style={{ gap: "8px 16px" }}>
                    {copy ? <span className="small grow">Текст із замінами — оригіналу в копії немає.</span> : (
                      <>
                        <div className="seg" role="group" aria-label="Який текст показувати">
                          <button aria-pressed={!original} onClick={() => setOriginal(false)}>Із замінами</button>
                          <button aria-pressed={original} onClick={() => setOriginal(true)}>Оригінал</button>
                        </div>
                        <span className="small grow">{original ? "Справжні слова бачите лише ви." : "Так текст бачитимуть колеги й супервайзер(ка)."}</span>
                      </>
                    )}
                    <div className="seg" role="group" aria-label="Колір підкреслень">
                      <button aria-pressed={!byCat} onClick={() => setByCat(false)}>Мікрокоди</button>
                      <button aria-pressed={byCat} onClick={() => setByCat(true)}>Категорії</button>
                    </div>
                    <label className="check" style={{ fontSize: 12 }}><input type="checkbox" checked={underlines} onChange={(e) => setUnderlines(e.target.checked)} /><span>Підкреслення</span></label>
                    {coders.length > 1 && (
                      <div className="seg" role="group" aria-label="Чиє кодування показувати">
                        <button aria-pressed={whose === "all"} onClick={() => setWhose("all")}>Усіх</button>
                        {coders.map((c) => <button key={c} aria-pressed={whose === c} onClick={() => setWhose(c)} title={shared.people?.[c]?.name}>{c === me ? "Моє" : initialsOf(shared, c)}</button>)}
                      </div>
                    )}
                  </div>
                  {ivSuspects.length > 0 && !copy && (
                    <div className="warnline">Ще не замінено: {ivSuspects.slice(0, 8).map((s) => `«${s.word}»`).join(", ")}{ivSuspects.length > 8 ? "…" : ""}. Колеги бачать ці слова як є.{" "}
                      <button className="link" style={{ fontSize: 12, minHeight: 0 }} onClick={() => setView("dict")}>До словника замін →</button></div>
                  )}
                  {copy ? null : iv.audio === "deleted" ? (
                    <div className="audioline">
                      <span className="grow small">Запис видалено після звірки транскрипту.</span>
                      <button className="link" style={{ fontSize: 12 }} onClick={pickAudio}>Вказати файл запису…</button>
                    </div>
                  ) : priv.audio[iv.id] && audioState[iv.id] === "ok" ? (
                    <>
                      <audio ref={audioEl} key={iv.id} src={convertFileSrc(priv.audio[iv.id].path)} preload="metadata" />
                      <Player audio={audioEl} src={priv.audio[iv.id].path} name={priv.audio[iv.id].name} onTime={onTime} />
                      <div className="row small" style={{ gap: "4px 16px" }}>
                        <span>Запис: <span className="mono">{priv.audio[iv.id].name}</span> — лише на цьому комп'ютері.</span>
                        <button className="link" style={{ fontSize: 12, minHeight: 0 }} onClick={pickAudio}>Інший файл…</button>
                        <button className="link" style={{ fontSize: 12, minHeight: 0 }} onClick={audioDeleted}>Запис видалено після звірки</button>
                      </div>
                    </>
                  ) : priv.audio[iv.id] ? (
                    <div className="audioline warn">
                      <span className="grow">{audioState[iv.id] === "changed" ? "За збереженим шляхом тепер інший файл — це не той запис." : audioState[iv.id] ? "Запис не знайдено: файл переміщено, перейменовано чи видалено." : "Перевіряю запис…"} <span className="mono small">{priv.audio[iv.id].path}</span></span>
                      <button className="btn sm" onClick={pickAudio}>Вказати знову…</button>
                      <button className="link" style={{ fontSize: 12 }} onClick={audioDeleted}>Запис видалено після звірки</button>
                    </div>
                  ) : (
                    <div className="audioline">
                      <span className="grow small">Аудіо не вказано. Запис не копіюється в проєкт: програма лише відтворює його з того місця, де він лежить, і таймкоди стають кнопками.</span>
                      <button className="btn sm" onClick={pickAudio}>Вказати файл запису…</button>
                    </div>
                  )}
                  {focus && fragCode && (
                    <div className="warnline" style={{ borderStyle: "solid", borderColor: fragCode.color }}>Показано лише код «{fragCode.name}». <button className="link" style={{ fontSize: 12, minHeight: 0 }} onClick={() => setFocus(null)}>Показати всі</button></div>
                  )}
                  {iv.tx ? (
                    <div className="txpanel">
                      {iv.tx.state === "running" ? (
                        <>
                          <span style={{ fontWeight: 500 }}>Транскрибується на цьому комп'ютері… {txPct[iv.id] ?? 0}%</span>
                          <div className="txbar" aria-hidden="true"><div style={{ width: `${txPct[iv.id] ?? 0}%` }} /></div>
                          <span className="small">
                            {({ convert: "1/3 · Перетворюю запис", load: "2/3 · Завантажую модель", recognize: "3/3 · Розпізнаю мовлення" } as Record<string, string>)[txInfo[iv.id]?.stage ?? "convert"] ?? "Готуюся"}
                            {txInfo[iv.id] ? ` · минуло ${dur((Date.now() - txInfo[iv.id].since) / 1000)}` : ""}
                            {txInfo[iv.id] && (txPct[iv.id] ?? 0) >= 2 ? ` · залишилося ≈ ${dur(((Date.now() - txInfo[iv.id].since) / 1000) * (100 - txPct[iv.id]) / txPct[iv.id])}` : ""}
                          </span>
                          {txInfo[iv.id]?.detail && <span className="mono small" style={{ overflowWrap: "anywhere" }}>{txInfo[iv.id].detail}</span>}
                          <span className="small">Запис нікуди не надсилається. Тим часом можна працювати з іншими інтерв'ю. Якщо закрити програму, транскрипцію доведеться почати знову.</span>
                          <button className="btn sm quiet" style={{ alignSelf: "flex-start" }} onClick={() => invoke("cancel_transcription", { job: iv.id })}>Зупинити</button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontWeight: 500 }}>{iv.tx.state === "error" ? "Транскрипція не вдалася." : "Транскрипцію перервано (програму закривали)."}</span>
                          {iv.tx.error && <span className="small">{txError(iv.tx.error)}</span>}
                          <div className="row"><button className="btn sm primary" disabled={audioState[iv.id] !== "ok"} onClick={restartTx}>Почати знову</button>
                            {audioState[iv.id] !== "ok" && <span className="small">Спершу вкажіть файл запису (вище).</span>}</div>
                        </>
                      )}
                    </div>
                  ) : (
                  <CodingSheet iv={iv} priv={priv} codes={byCat ? shared.codes.map((c) => ({ ...c, color: shared.cats.find((k) => k.id === c.cat)?.color ?? c.color })) : shared.codes} apps={whose === "all" ? shared.apps : shared.apps.filter((a) => a.by === whose)} notes={shared.notes} me={me} people={shared.people} original={original}
                    underlines={underlines} focus={focus} flagged={copy ? NONE : flagged} act={act} target={target}
                    seek={priv.audio[iv.id] && audioState[iv.id] === "ok" ? seek : undefined} nowRep={nowRep} edit={editing ? edit : undefined} />
                  )}
                  {!copy && <div className="legend small">
                    <span><mark className="repl">[ім'я]</mark> замінено за словником</span>
                    <span><mark className="orig">Оксана</mark> справжнє слово (лише в «Оригіналі»)</span>
                    <span><mark className="suspect">Андрій</mark> схоже на ім'я, ще не замінено</span>
                  </div>}
                </section>
              )}
            </div>
          )}
        </>
      )}

      {view === "share" && (
        <Share shared={shared} priv={priv} projectId={props.id} name={meta.name} method={meta.method} me={props.me}
          suspects={allSuspects.map((x) => x.word)} onBack={() => setView("main")} toDict={() => setView("dict")} />
      )}
      {view === "remarks" && (
        <RemarksView rows={remarkRows} me={me} who={who} set={setRemark} onBack={() => setView("main")} />
      )}
      {view === "update" && copy && (
        <PackPicker title="Оновити копію новою версією" onBack={() => setView("main")} use={(b) => {
          if (b.kind !== copy.kind) return b.kind === "return" ? "Це повернення змін, а не нова версія проєкту." : "Цей пакет іншого виду, ніж ваша копія.";
          if (b.project.id !== copy.project) return "Це пакет іншого проєкту. Його відкривають у «Моїх проєктах» → «Відкрити пакет…».";
          if (b.sent <= copy.sent) return "Ця версія не новіша за вашу копію.";
          const r = updateCopy(shared, priv, props.me, b.data, { project: b.project.id, from: b.from, kind: b.kind, stage: b.stage, sent: b.sent, received: Date.now(), blind: b.blind });
          undoable(`Копію оновлено до версії від ${new Date(b.sent).toLocaleDateString("uk-UA")}; ваше кодування й коментарі збережено${r.unplaced ? `, крім ${r.unplaced} — їхніх слів у новій версії немає` : ""}.`, r.shared, r.priv);
          setView("main");
        }} />
      )}
      {view === "merge" && (
        <Merge shared={shared} priv={priv} projectId={props.id} onBack={() => setView("main")}
          onMerge={(s, text) => { undoable(text, s, priv); setView("main"); }} />
      )}
      {view === "compare" && audioFile && (
        <Compare path={audioFile} models={models} onBack={() => setView("add")}
          onChoose={(m, l) => {
            setModel(m); setLang(l);
            try { localStorage.setItem("qda.model", m); localStorage.setItem("qda.lang", l); } catch { /* only a convenience */ }
            setView("add");
            notify("Модель і мову обрано; на цьому комп'ютері вони пропонуватимуться й надалі.");
          }} />
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
            <span className="small">Запис (mp3, m4a, wav, mp4) або готовий транскрипт (.docx, .txt). Файл лишається там, де був: запис не копіюється й нікуди не надсилається — програма транскрибує його на цьому комп'ютері; у проєкт потрапляє лише зашифрований текст.</span>
            {audioFile && (
              <div className="panel stack" style={{ gap: 10 }}>
                <span className="label">Транскрипція на цьому комп'ютері</span>
                <div className="stack" role="radiogroup" aria-label="Модель розпізнавання" style={{ gap: 6 }}>
                  {models.map((m) => (
                    <div key={m.id} className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                      <label className="row grow" style={{ gap: 8, fontSize: 13, flexWrap: "nowrap", opacity: m.downloaded ? 1 : 0.7 }}>
                        <input type="radio" name="model" disabled={!m.downloaded} checked={model === m.id} onChange={() => setModel(m.id)} />
                        <span className="grow">{m.label} <span className="small mono">· {m.mib} МБ</span></span>
                      </label>
                      {m.downloaded ? <span className="small">завантажено</span>
                        : m.download?.state === "running" ? <span className="small mono">завантажується… {m.download.pct}%</span>
                        : <button className="btn sm quiet" onClick={() => downloadModel(m.id)}>Завантажити</button>}
                    </div>
                  ))}
                  {models.filter((m) => m.download?.state === "error").map((m) => <span key={m.id} className="bad" style={{ fontSize: 12 }}>{m.label}: {txError(m.download!.error)}</span>)}
                </div>
                <span className="small">Модель завантажується один раз з офіційного сховища whisper.cpp (huggingface.co) і перевіряється за контрольною сумою. Аудіо при цьому нікуди не надсилається. Далі транскрипція працює без інтернету.</span>
                <label className="row" style={{ gap: 8, fontSize: 13 }}>Мова запису
                  <select className="input" style={{ height: 34, fontFamily: "inherit" }} value={lang} onChange={(e) => setLang(e.target.value)}>
                    {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></label>
                <span className="small">Мовців програма не розрізняє: репліки ділить за паузами, а хто говорить, позначите ви в «Редагувати текст».</span>
                <button className="link" style={{ alignSelf: "flex-start", fontSize: 13 }} disabled={!models.some((m) => m.downloaded)} onClick={() => setView("compare")}>
                  Не знаєте, яку модель і мову обрати? Порівняти на фрагменті цього запису →</button>
              </div>
            )}
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

      {view === "main" && shared.interviews.length > 0 && (
        <Codebook people={shared.people} codes={shared.codes} apps={shared.apps} focus={focus} setFocus={setFocus}
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
          {(copy?.kind === "supervisor" || Object.keys(shared.notes).some((k) => k.startsWith(`code:${fragCode.id}:`))) && (
            <div className="panel stack" style={{ gap: 8 }}>
              <span className="label">Зауваження до коду</span>
              {Object.entries(shared.notes).filter(([k, n]) => k.startsWith(`code:${fragCode.id}:`) && n.by !== me).map(([k, n]) => (
                <div key={k} className="stack" style={{ gap: 4 }}>
                  <span className="mono" style={{ fontSize: 13, lineHeight: 1.7 }}><span className="small">{who(n.by)}</span> {n.text}</span>
                  <Remark n={n} me={me} who={who} set={(p) => setRemark(k, p)} />
                </div>
              ))}
              {copy?.kind === "supervisor" && (
                <>
                  <textarea key={fragCode.id} className="input mono" rows={3} defaultValue={shared.notes[`code:${fragCode.id}:${me}`]?.text ?? ""}
                    placeholder="Зауваження до коду: межі, назва, чи пасує до фрагментів…" aria-label="Зауваження до коду"
                    onBlur={(e) => { if (e.currentTarget.value !== (shared.notes[`code:${fragCode.id}:${me}`]?.text ?? "")) setCodeRemark(fragCode.id, e.currentTarget.value); }} />
                  {shared.notes[`code:${fragCode.id}:${me}`] && <Remark n={shared.notes[`code:${fragCode.id}:${me}`]} me={me} who={who} set={(p) => setRemark(`code:${fragCode.id}:${me}`, p)} />}
                </>
              )}
            </div>
          )}
          {fragPeople > 1 && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 12 }}>
                <div className="seg" role="group" aria-label="Які фрагменти показувати">
                  {(["all", "shared", "single"] as const).map((k) => <button key={k} aria-pressed={fragShow === k} onClick={() => setFragShow(k)}>{{ all: "Усі", shared: "Лише спільні", single: "Лише одиничні" }[k]}</button>)}
                </div>
                <span className="small">Спільних: {[...fragShared.values()].filter((v) => v.length).length} з {fragShared.size}</span>
              </div>
              <span className="small">Спільний — коли хтось іще дав цей код тим самим словам. Це привід для розмови, а не показник надійності: у рефлексивному ТА розбіжності в кодуванні — частина аналізу (Браун і Кларк).</span>
            </div>
          )}
          {shared.interviews.flatMap((x) => shared.apps.filter((a) => a.code === fragCode.id && a.iv === x.id && (fragShow === "all" || (fragShow === "shared") === !!fragShared.get(a.id)?.length)).sort((a, b) => a.rep - b.rep || a.s - b.s).map((a) => {
            const r = priv.originals[x.id]?.[a.rep];
            if (!r) return null;
            return (
              <div className="frag" key={a.id}>
                <div className="stack" style={{ gap: 3, flex: "0 0 150px" }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{pad(x.n)} · {x.card.pseudonym}</span>
                  <span className="mono small">{r.t ?? ""}</span>
                  <span className="small">{initialsOf(shared, a.by)}{fragShared.get(a.id)?.length ? ` · спільний з ${fragShared.get(a.id)!.map((p) => initialsOf(shared, p)).join(", ")}` : ""}</span>
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
