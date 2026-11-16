import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import ProjectView from "./ProjectView";
import { emptyPrivate, type CopyOf, type Person } from "./model";
import type { PackBody } from "./Share";

type Student = { work: string; supervisor: string };
type Entry = { id: string; name: string; method: string; student: Student | null; path: string; modified: number; last_backup: number | null; exists: boolean };
type Inspected = { kind: "mine" | "other"; owner_name: string; owner_here: boolean; has_halves: boolean; name: string | null; modified: number | null; in_list: boolean };
type View = "list" | "new" | "studentKey" | "opened" | "backup" | "restore" | "pack";

const WEEK = 7 * 86400;
const METHODS = [["ІФА", "інтерпретативний феноменологічний аналіз"], ["Дескр.", "дескриптивний феноменологічний аналіз"], ["РТА", "рефлексивний тематичний аналіз"]];
const WORKS = [["курсова", "Курсова"], ["бакалаврська", "Бакалаврська"], ["магістерська", "Магістерська"]];
const SNOOZE = "qda-backup-snooze";

const nowSec = () => Date.now() / 1000;
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD in local time
const fmt = (t: number) => new Date(t * 1000).toLocaleDateString("uk-UA");
const stem = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 80) || "Без назви";
const stale = (e: Entry) => !e.last_backup || nowSec() - e.last_backup > WEEK;
const workLabel = (s: Student) => (WORKS.find((w) => w[0] === s.work)?.[1] ?? s.work) + " робота";
function ago(t: number | null) {
  if (!t) return "ще не робили";
  const d = Math.floor((nowSec() - t) / 86400);
  return d <= 0 ? "сьогодні" : d === 1 ? "вчора" : `${d} дн. тому`;
}
function snoozed() {
  try { return Number(localStorage.getItem(SNOOZE) ?? 0) > Date.now(); } catch { return false; }
}
function message(e: unknown): string {
  const s = String(e);
  const known: Record<string, string> = {
    not_a_project: "Цей файл не є проєктом Платформи QDA або пошкоджений.",
    wrong: "Не підходить. Перевірте й спробуйте ще раз.",
    bad_words: "Це не схоже на 12 слів ключа: перевірте написання кожного слова.",
    wrong_key: "Ці 12 слів не підходять до профілю, якому належить копія.",
    half_mismatch: "Цей файл половини ключа належить іншому проєкту.",
    already_in_list: "Цей проєкт уже є у списку.",
    backup_unreadable: "Копію записано, але вона не відкривається. Спробуйте зберегти в інше місце.",
    bad_input: "Перевірте заповнені поля.",
    not_a_pack: "Цей файл не є пакетом Платформи QDA або пошкоджений.",
  };
  if (s === "bad_words:0") return "Фраза — це рівно 6 слів, через пробіл.";
  if (s.startsWith("bad_words:")) return `Слова № ${s.slice(10)} немає у списку — перевірте написання.`;
  if (s.startsWith("missing:")) return `Файл проєкту не знайдено: ${s.slice(8)}. Можливо, його перемістили чи видалили; відкрийте резервну копію.`;
  if (s.startsWith("io:")) return `Не вдалося записати файл: ${s.slice(3)}`;
  return known[s] ?? s;
}

function Choice(props: { on: boolean; onClick: () => void; children: ReactNode; role?: string }) {
  return (
    <button type="button" className={"choice" + (props.on ? " on" : "")} role={props.role} aria-pressed={props.role ? undefined : props.on}
      aria-checked={props.role ? props.on : undefined} onClick={props.onClick}>{props.children}</button>
  );
}

export default function Projects(props: { me: Person & { id: string }; aside: ReactNode; msg: string; setMsg: (m: string) => void }) {
  const { msg, setMsg } = props;
  const [view, setView] = useState<View>("list");
  const [list, setList] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(!snoozed());

  // new project
  const [name, setName] = useState("");
  const [method, setMethod] = useState("ІФА");
  const [isStudent, setIsStudent] = useState(false);
  const [work, setWork] = useState("курсова");
  const [sup, setSup] = useState("");
  const [folder, setFolder] = useState("");
  const [defaultFolder, setDefaultFolder] = useState("");

  // student key
  const [created, setCreated] = useState<Entry | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [halfSaved, setHalfSaved] = useState(false);
  const [supFile, setSupFile] = useState("");

  // opened, backup, restore
  const [opened, setOpened] = useState<string>("");
  const [target, setTarget] = useState<Entry | null>(null);
  const [file, setFile] = useState("");
  const [info, setInfo] = useState<Inspected | null>(null);
  const [mode, setMode] = useState<"replace" | "separate">("replace");
  const [way, setWay] = useState<"password" | "words" | "halves">("password");
  const [secret, setSecret] = useState("");
  const [halfFile, setHalfFile] = useState("");

  async function refresh() { setList(await invoke<Entry[]>("list_projects")); }
  useEffect(() => {
    refresh().catch((e) => setError(message(e)));
    invoke<string>("default_folder").then(setDefaultFolder).catch(() => {});
  }, []);

  const go = (v: View) => { setError(""); setView(v); };
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const submit = (fn: () => void) => (e: FormEvent) => { e.preventDefault(); fn(); };
  const errorLine = error ? <span className="bad" role="alert">{error}</span> : null;

  // ----- package from a colleague or a student (step 3.2) -----
  const [packFile, setPackFile] = useState("");
  const [phrase, setPhrase] = useState("");
  const [pack, setPack] = useState<PackBody | null>(null);
  const pickPack = async () => {
    const p = await open({ title: "Пакет від колеги", filters: [{ name: "Пакет QDA", extensions: ["qdapack"] }] });
    if (typeof p === "string") { setPackFile(p); setPack(null); setError(""); }
  };
  const startPack = () => { setPackFile(""); setPhrase(""); setPack(null); setMsg(""); go("pack"); pickPack(); };
  const openPack = () => run(async () => {
    const body = await invoke<PackBody>("open_pack", { path: packFile, phrase });
    if (body.kind !== "copy" && body.kind !== "supervisor") throw "Це пакет змін для власника(ці) проєкту: його додають у самому проєкті.";
    setPack(body);
  });
  const addPack = () => run(async () => {
    const b = pack!;
    const copyOf: CopyOf = { project: b.project.id, from: b.from, kind: b.kind, stage: b.stage, sent: b.sent, received: Date.now(), blind: b.blind };
    // The copy's "originals" are the texts with replacements: the real words never leave the owner.
    const priv = { ...emptyPrivate(), originals: Object.fromEntries(b.data.interviews.map((x) => [x.id, x.replicas.map((r) => ({ id: r.id, t: r.t, label: null, role: r.role, text: r.text }))])) };
    const e = await invoke<Entry>("create_copy_project", { name: b.project.name, method: b.project.method, data: { ...b.data, copyOf }, private: priv });
    setPhrase("");
    await refresh();
    setOpened(e.id); go("opened");
  });

  // ----- list -----
  const due = list.filter(stale);
  const startNew = () => { setName(""); setMethod("ІФА"); setIsStudent(false); setWork("курсова"); setSup(""); setFolder(""); setMsg(""); go("new"); };
  const openProject = (e: Entry) => { setOpened(e.id); setMsg(""); go("opened"); };
  const snooze = () => { try { localStorage.setItem(SNOOZE, String(Date.now() + 86400_000)); } catch { /* per-session only */ } setBanner(false); };
  const backupAll = () => run(async () => {
    const dir = await open({ directory: true, title: "Куди зберегти копії всіх проєктів" });
    if (typeof dir !== "string") return;
    for (const e of list.filter((x) => x.exists)) {
      await invoke("backup_project", { id: e.id, dest: await join(dir, `${stem(e.name)} — копія ${today()}.qda`) });
    }
    await refresh();
    setBanner(false);
    setMsg(`Копії ${list.filter((x) => x.exists).length} проєктів збережено в ${dir}. Перевірено: кожна копія відкривається.`);
  });

  // ----- new -----
  const missing = !name.trim() ? "Потрібна назва." : isStudent && !sup.trim() ? "Потрібне ім'я супервайзера(ки)." : "";
  const chooseFolder = async () => {
    const d = await open({ directory: true, title: "Де зберігати проєкт", defaultPath: folder || defaultFolder });
    if (typeof d === "string") setFolder(d);
  };
  const create = () => run(async () => {
    if (missing) return;
    const r = await invoke<{ entry: Entry; words: string[] | null }>("create_project", {
      name, method, work: isStudent ? work : null, supervisor: isStudent ? sup : null, folder: folder || null,
    });
    await refresh();
    if (r.words) { setCreated({ ...r.entry, exists: true }); setWords(r.words); setHalfSaved(false); setSupFile(""); go("studentKey"); }
    else { setOpened(r.entry.id); go("opened"); }
  });

  // ----- student key -----
  const saveSupFile = () => run(async () => {
    const p = await save({
      title: "Половина ключа для супервайзера(ки)",
      defaultPath: `${stem(created!.name)} — половина ключа для супервайзера(ки).qdakey`,
      filters: [{ name: "Половина ключа QDA", extensions: ["qdakey"] }],
    });
    if (!p) return;
    await invoke("save_supervisor_half", { path: p });
    setSupFile(p);
  });
  const studentMissing = !halfSaved ? "Позначте, що записали свою половину." : !supFile ? "Збережіть файл для супервайзера(ки)." : "";
  const finishStudent = () => run(async () => {
    await invoke("forget_supervisor_half");
    setOpened(created!.id);
    setWords([]);
    go("opened");
  });

  // ----- backup -----
  const doBackup = () => run(async () => {
    const p = await save({
      title: "Зберегти резервну копію",
      defaultPath: `${stem(target!.name)} — копія ${today()}.qda`,
      filters: [{ name: "Проєкт QDA", extensions: ["qda"] }],
    });
    if (!p) return;
    await invoke("backup_project", { id: target!.id, dest: p.endsWith(".qda") ? p : p + ".qda" });
    await refresh();
    setMsg(`Копію «${target!.name}» збережено: ${p}. Перевірено: файл відкривається.`);
    go("list");
  });

  // ----- restore -----
  const pickBackup = () => run(async () => {
    const p = await open({ title: "Відкрити резервну копію", filters: [{ name: "Проєкт QDA", extensions: ["qda"] }] });
    if (typeof p !== "string") return;
    setFile(p); setInfo(null); setSecret(""); setHalfFile(""); setMode("replace");
    const i = await invoke<Inspected>("inspect_backup", { path: p });
    setInfo(i);
    setWay(i.kind === "other" && i.owner_here && i.has_halves ? "halves" : "password");
  });
  const startRestore = () => { setFile(""); setInfo(null); setMsg(""); go("restore"); pickBackup(); };
  const pickHalf = async () => {
    const p = await open({ title: "Половина ключа супервайзера(ки)", filters: [{ name: "Половина ключа QDA", extensions: ["qdakey"] }] });
    if (typeof p === "string") setHalfFile(p);
  };
  const done = async (m: string) => { await refresh(); setMsg(m); go("list"); };
  const restoreMine = () => run(async () => {
    const e = await invoke<Entry>("restore_mine", { path: file, mode, today: today() });
    await done(info!.in_list && mode === "replace"
      ? `Копію відновлено. Попередню версію збережено поруч як «… — перед відновленням ${today()}.qda».`
      : `Проєкт «${e.name}» додано до списку.`);
  });
  const restoreOther = () => run(async () => {
    if (way === "halves") {
      const e = await invoke<Entry>("restore_halves", { path: file, words: secret, half: halfFile });
      await done(`Проєкт «${e.name}» відкрито двома половинами ключа й додано до вашого профілю.`);
    } else {
      const owner = await invoke<string>("restore_foreign", { path: file, secret, way });
      await done(`Профіль «${owner}» і його проєкт відновлено на цьому комп'ютері. Щоб працювати з ним, увійдіть як «${owner}».`);
    }
  });
  const otherReady = way === "halves" ? secret.trim().split(/\s+/).length === 12 && !!halfFile : !!secret.trim();

  return (
    <>
      {view === "list" && (
        <>
          {msg && (
            <div className="msg" role="status">
              <span className="grow">{msg}</span>
              <button className="link" style={{ minHeight: 32 }} onClick={() => setMsg("")} aria-label="Закрити повідомлення">✕</button>
            </div>
          )}
          {banner && due.length > 0 && (
            <div className="status" role="status">
              <span className="dot" style={{ width: 8, height: 8 }} aria-hidden="true" />
              <span className="grow">
                Резервних копій не робили понад тиждень: {due.map((e) => `«${e.name}» — ${ago(e.last_backup)}`).join(", ")}.
              </span>
              <button className="btn sm primary" disabled={busy} onClick={backupAll}>Зробити копії всіх проєктів</button>
              <button className="link" style={{ fontSize: 12 }} onClick={snooze}>Нагадати завтра</button>
            </div>
          )}
          <div className="split">
            <section aria-label="Мої проєкти">
              <div className="row" style={{ alignItems: "flex-end", gap: "12px 24px" }}>
                <div className="stack" style={{ gap: 4 }}>
                  <span className="label">Мої проєкти</span>
                  <span className="title">Проєктів: {list.length}</span>
                </div>
                <div className="grow" />
                <button className="btn sm" onClick={startPack}>Відкрити пакет…</button>
                <button className="btn sm" onClick={startRestore}>Відкрити резервну копію</button>
                <button className="btn sm primary" onClick={startNew}>+ Новий проєкт</button>
              </div>
              {errorLine}
              {list.length === 0 ? (
                <div className="empty">
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Проєктів ще немає</span>
                  <span className="lead" style={{ maxWidth: 440 }}>Створіть новий проєкт або відкрийте резервну копію чи файл, який вам надіслали. Кожен проєкт — один зашифрований файл у теці «Документи / QDA».</span>
                </div>
              ) : (
                <ul className="plist">
                  {list.map((e) => (
                    <li key={e.id}>
                      <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                        <span className="pname">{e.name}</span>
                        <span className="small">
                          {e.method} · {e.student ? `${workLabel(e.student)} · супервайзер(ка): ${e.student.supervisor}` : "Власне дослідження"}
                          {" · "}{e.exists ? `змінено ${fmt(e.modified)}` : "файл не знайдено"}
                        </span>
                        <span className={stale(e) ? "accent" : "small"}>Резервна копія: {ago(e.last_backup)}</span>
                      </div>
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <button className="btn sm quiet" disabled={!e.exists} onClick={() => { setTarget(e); setMsg(""); go("backup"); }}>Копія</button>
                        <button className="btn sm primary" disabled={!e.exists || busy} onClick={() => openProject(e)}>Відкрити →</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <span className="small">Кожен проєкт — один зашифрований файл. Відкривається вашим паролем входу, окремого пароля немає.</span>
            </section>
            {props.aside}
          </div>
        </>
      )}

      {view === "new" && (
        <form className="card wide" aria-label="Новий проєкт" onSubmit={submit(() => !missing && !busy && create())}>
          <h2>Новий проєкт</h2>
          <label className="field">
            <span>Назва дослідження</span>
            <input className="input" value={name} maxLength={200} autoFocus placeholder="Напр.: Досвід очікування" onChange={(e) => setName(e.target.value)} />
            <span className="small">Назву видно в списку проєктів і в назві файлу. Не вписуйте сюди імен учасників(ць).</span>
          </label>
          <div className="field">
            <span id="mlabel">Метод</span>
            <div className="row" role="group" aria-labelledby="mlabel" style={{ gap: 6 }}>
              {METHODS.map(([m, long]) => (
                <Choice key={m} on={method === m} onClick={() => setMethod(m)}><b>{m}</b><small>{long}</small></Choice>
              ))}
            </div>
            <span className="small">Від методу залежать назви рівнів тем і розділи статті.</span>
          </div>
          <div className="field">
            <span id="klabel">Чий це проєкт</span>
            <div className="row" role="group" aria-labelledby="klabel" style={{ gap: 6 }}>
              <Choice on={!isStudent} onClick={() => setIsStudent(false)}>Власне дослідження</Choice>
              <Choice on={isStudent} onClick={() => setIsStudent(true)}>Студентська робота</Choice>
            </div>
          </div>
          {isStudent && (
            <div className="stack" style={{ gap: 14, padding: 16, border: "1px solid var(--line2)", background: "#fff" }}>
              <label className="field">
                <span>Тип роботи</span>
                <select className="input" style={{ height: 40, fontFamily: "inherit", fontSize: 14 }} value={work} onChange={(e) => setWork(e.target.value)}>
                  {WORKS.map(([v, l]) => <option key={v} value={v}>{l} робота</option>)}
                </select>
              </label>
              <label className="field">
                <span>Супервайзер(ка)</span>
                <input className="input" value={sup} maxLength={100} placeholder="Ім'я та прізвище" onChange={(e) => setSup(e.target.value)} />
              </label>
              <span className="small">Для студентської роботи програма створить ще й ключ відновлення проєкту з двох половин: одна — у вас, друга — у супервайзера(ки). Відкрити проєкт ними можна лише разом.</span>
            </div>
          )}
          <div className="field">
            <span>Де зберігати</span>
            <div className="row">
              <span className="mono path">{folder || defaultFolder}</span>
              <button type="button" className="btn sm quiet" onClick={chooseFolder}>Змінити теку…</button>
            </div>
          </div>
          {errorLine}
          <div className="row">
            <button type="button" className="btn quiet" onClick={() => go("list")}>Скасувати</button>
            <button type="submit" className="btn primary" disabled={!!missing || busy}>{busy ? "Створюю…" : "Створити проєкт"}</button>
            <span className="small" aria-live="polite">{missing}</span>
          </div>
        </form>
      )}

      {view === "studentKey" && created && (
        <section className="card wide" aria-label="Ключ відновлення проєкту">
          <span className="label">{created.name} · {created.student && workLabel(created.student)}</span>
          <div className="stack">
            <h2>Ключ відновлення проєкту — дві половини</h2>
            <p className="lead">Це запасний шлях на випадок, якщо ви втратите і пароль, і ключ відновлення профілю. Кожна половина окремо нічого не відкриває: супервайзер(ка) зі своєю половиною не зможе прочитати ваш проєкт, а ви зі своєю — тільки разом із його/її.</p>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <span className="label">1 · Ваша половина</span>
            <ol className="keygrid" aria-label="Ваша половина ключа, 12 слів">
              {words.map((w, i) => <li key={i}><span>{String(i + 1).padStart(2, "0")}</span><span>{w}</span></li>)}
            </ol>
            <div className="row">
              <button className="btn sm" onClick={() => invoke("print_page").catch((e) => setError(message(e)))}>Роздрукувати</button>
              <label className="check">
                <input type="checkbox" checked={halfSaved} onChange={(e) => setHalfSaved(e.target.checked)} />
                <span>Я записав(ла) свою половину й зберігатиму її окремо від комп'ютера</span>
              </label>
            </div>
          </div>
          <div className="rule" style={{ gap: 10 }}>
            <span className="label">2 · Половина для супервайзера(ки) · {created.student?.supervisor}</span>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>Збережіть її файлом і передайте супервайзерові(ці) будь-яким способом — поштою, у месенджері, на флешці. У файлі немає нічого з проєкту, лише половина ключа.</p>
            <div className="row">
              <button className="btn sm" disabled={busy} onClick={saveSupFile}>Зберегти файл для супервайзера(ки)…</button>
              <span className={supFile ? "ok" : "small"} aria-live="polite">{supFile ? `✓ Збережено: ${supFile}` : "Ще не збережено."}</span>
            </div>
          </div>
          {errorLine}
          <div className="rule row" style={{ flexDirection: "row" }}>
            <button className="btn primary" disabled={!!studentMissing || busy} onClick={finishStudent}>Готово — відкрити проєкт</button>
            <span className="small" aria-live="polite">{studentMissing}</span>
          </div>
          {createPortal(
            <div className="print-only">
              <h1>Платформа QDA · «{created.name}» · половина ключа відновлення проєкту (студент(ка))</h1>
              <ol>{words.map((w, i) => <li key={i}>{w}</li>)}</ol>
              <p>Відкриває проєкт лише разом із файлом половини, який зберігає супервайзер(ка). Зберігайте окремо від комп'ютера.</p>
            </div>,
            document.body,
          )}
        </section>
      )}

      {view === "opened" && opened && <ProjectView id={opened} me={props.me} onBack={() => { refresh(); go("list"); }} />}

      {view === "backup" && target && (
        <section className="card wide" aria-label="Резервна копія">
          <h2>Резервна копія · {target.name}</h2>
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>Копія — один зашифрований файл з усім проєктом, зокрема з оригіналом транскриптів і словником замін. Аудіо в копію не потрапляє.</p>
          <p className="lead">Тримайте копію не на цьому комп'ютері: на флешці чи в хмарі. Хмара бачить лише нечитабельний файл. Відкрити копію можна вашим паролем або ключем відновлення профілю — і на цьому, і на новому комп'ютері.</p>
          {errorLine}
          <div className="row">
            <button className="btn quiet" onClick={() => go("list")}>Скасувати</button>
            <button className="btn primary" disabled={busy} onClick={doBackup}>{busy ? "Зберігаю й перевіряю…" : "Обрати, куди зберегти…"}</button>
          </div>
          <span className="small">Нагадування про копії — раз на тиждень для кожного проєкту.</span>
        </section>
      )}

      {view === "pack" && (
        <section className="card wide" aria-label="Відкрити пакет">
          <h2>Відкрити пакет</h2>
          <div className="row">
            <span className="mono path">{packFile || "файл не обрано"}</span>
            <button className="btn sm quiet" disabled={busy} onClick={pickPack}>{packFile ? "Обрати інший файл…" : "Обрати файл…"}</button>
          </div>
          {!pack ? (
            <form className="stack" style={{ gap: 10 }} onSubmit={submit(openPack)}>
              <label className="stack" style={{ gap: 4, fontSize: 13 }}>Фраза з 6 слів, яку вам передали окремо від файлу
                <input className="input mono" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="six words like this one here" />
              </label>
              {errorLine}
              <div className="row" style={{ gap: 10 }}>
                <button className="btn primary" type="submit" disabled={busy || !packFile || phrase.trim().split(/\s+/).length !== 6}>{busy ? "Відкриваю…" : "Відкрити"}</button>
                <button className="btn quiet" type="button" onClick={() => go("list")}>Скасувати</button>
              </div>
            </form>
          ) : (
            <div className="stack" style={{ gap: 12, fontSize: 13, lineHeight: 1.6 }}>
              <span>{pack.kind === "supervisor" ? "Пакет для супервайзера(ки)" : "Копія проєкту"} <b style={{ fontWeight: 600 }}>«{pack.project.name}»</b> ({pack.project.method}) від <b style={{ fontWeight: 600 }}>{pack.from.name}</b>, надіслано {new Date(pack.sent).toLocaleDateString("uk-UA")}{pack.stage ? `, етап: ${pack.stage}` : ""}.</span>
              <span>Інтерв'ю: {pack.data.interviews.length} · кодів: {pack.data.codes.length}{pack.blind ? " · без кодування власника(ці) — для сліпого кодування" : ""}.</span>
              <span className="small">Копія стане вашим проєктом, зашифрованим вашим паролем. У ній транскрипти лише із замінами; кодувати й коментувати можна, змінювати текст — лише власник(ця).</span>
              {errorLine}
              <div className="row" style={{ gap: 10 }}>
                <button className="btn primary" disabled={busy} onClick={addPack}>Додати до моїх проєктів</button>
                <button className="btn quiet" onClick={() => go("list")}>Скасувати</button>
              </div>
            </div>
          )}
        </section>
      )}
      {view === "restore" && (
        <section className="card wide" aria-label="Відкрити резервну копію">
          <h2>Відкрити резервну копію</h2>
          <div className="row">
            <span className="mono path">{file || "файл не обрано"}</span>
            <button className="btn sm quiet" disabled={busy} onClick={pickBackup}>{file ? "Обрати інший файл…" : "Обрати файл…"}</button>
          </div>
          {errorLine}

          {info?.kind === "mine" && (
            <>
              <div className="stack" style={{ fontSize: 13, lineHeight: 1.6 }}>
                <span>Це ваш проєкт <b style={{ fontWeight: 600 }}>«{info.name}»</b>, збережений {info.modified ? fmt(info.modified) : ""}.</span>
                {info.in_list && <span className="lead">Такий проєкт уже є у вашому списку. Як відновити копію?</span>}
              </div>
              {info.in_list && (
                <div className="stack" role="radiogroup" aria-label="Як відновити" style={{ gap: 8 }}>
                  <Choice role="radio" on={mode === "replace"} onClick={() => setMode("replace")}>
                    <b>Замінити поточну версію копією</b><small>Поточна версія спершу збережеться окремим файлом поруч — на випадок, якщо копію обрано помилково.</small>
                  </Choice>
                  <Choice role="radio" on={mode === "separate"} onClick={() => setMode("separate")}>
                    <b>Відкрити як окремий проєкт</b><small>У списку з'явиться «{info.name} (копія {today()})»; поточна версія не зміниться.</small>
                  </Choice>
                </div>
              )}
              <div className="row">
                <button className="btn quiet" onClick={() => go("list")}>Скасувати</button>
                <button className="btn primary" disabled={busy} onClick={restoreMine}>{info.in_list ? "Відновити" : "Додати до списку"}</button>
              </div>
            </>
          )}

          {info?.kind === "other" && (
            <form className="stack" style={{ gap: 14 }} onSubmit={submit(() => otherReady && !busy && restoreOther())}>
              <div className="stack" style={{ fontSize: 13, lineHeight: 1.6 }}>
                <span>Копія проєкту належить профілю <b style={{ fontWeight: 600 }}>«{info.owner_name}»</b>{info.owner_here ? ", який є на цьому комп'ютері." : ", якого немає на цьому комп'ютері."}</span>
                <span className="lead">
                  {info.owner_here
                    ? `Щоб працювати з цим проєктом, увійдіть як «${info.owner_name}».${info.has_halves ? " Якщо пароль і ключ того профілю втрачено, студентський проєкт можна відкрити двома половинами ключа — тоді він перейде до вашого профілю." : ""}`
                    : "Так буває після переходу на новий комп'ютер. Якщо це ваш профіль, введіть його пароль або 12 слів ключа відновлення — програма відновить і профіль, і проєкт. Чужу копію без цього відкрити неможливо."}
                </span>
              </div>
              {!(info.owner_here && !info.has_halves) && (
                <>
                  <div className="seg" role="group" aria-label="Чим відкрити">
                    {!info.owner_here && <button type="button" aria-pressed={way === "password"} onClick={() => { setWay("password"); setSecret(""); }}>Пароль профілю</button>}
                    {!info.owner_here && <button type="button" aria-pressed={way === "words"} onClick={() => { setWay("words"); setSecret(""); }}>12 слів ключа профілю</button>}
                    {info.has_halves && <button type="button" aria-pressed={way === "halves"} onClick={() => { setWay("halves"); setSecret(""); }}>Дві половини ключа проєкту</button>}
                  </div>
                  {way === "password" && (
                    <label className="field"><span>Пароль профілю «{info.owner_name}»</span>
                      <input className="input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
                  )}
                  {way === "words" && (
                    <label className="field"><span>12 слів ключа відновлення профілю</span>
                      <textarea className="input mono" rows={2} spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
                  )}
                  {way === "halves" && (
                    <>
                      <label className="field"><span>Ваша половина — 12 слів</span>
                        <textarea className="input mono" rows={2} spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
                      <div className="field"><span>Половина супервайзера(ки) — файл</span>
                        <div className="row">
                          <button type="button" className="btn sm" onClick={pickHalf}>Обрати файл…</button>
                          <span className="mono small">{halfFile || "файл не обрано"}</span>
                        </div>
                      </div>
                      <span className="small">Проєкт перейде до профілю, у якому ви зараз працюєте.</span>
                    </>
                  )}
                  <div className="row">
                    <button type="button" className="btn quiet" onClick={() => go("list")}>Скасувати</button>
                    <button type="submit" className="btn primary" disabled={!otherReady || busy}>
                      {busy ? "Перевіряю…" : way === "halves" ? "Відкрити проєкт" : "Відновити профіль і проєкт"}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}
          {!info && !busy && <button className="link" style={{ alignSelf: "flex-start" }} onClick={() => go("list")}>← Мої проєкти</button>}
        </section>
      )}
    </>
  );
}
