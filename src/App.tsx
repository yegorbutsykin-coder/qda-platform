import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

type Profile = { id: string; name: string; initials: string; autolock_min: number };
type Screen =
  | "loading" | "welcome" | "you" | "pass" | "key" | "keycheck" | "disk"
  | "login" | "recover" | "recoverPass" | "locked" | "projects" | "changePass";

const MIN = 10;
const SETUP_STEPS = ["1 · Ви", "2 · Пароль", "3 · Ключ відновлення", "4 · Захист диска"];
const STEP_OF: Partial<Record<Screen, number>> = { you: 0, pass: 1, key: 2, keycheck: 2, disk: 3 };

const err = (e: unknown) => String(e);
const initialsOf = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase();

function PasswordPair(props: { a: string; b: string; setA: (v: string) => void; setB: (v: string) => void; labelA?: string; labelB?: string }) {
  const { a, b } = props;
  const long = [...a].length >= MIN;
  const match = b.length > 0 && a === b;
  return (
    <>
      <label className="field">
        <span>{props.labelA ?? "Пароль"}</span>
        <input className="input" type="password" autoComplete="new-password" value={a} onChange={(e) => props.setA(e.target.value)} />
        <span className={a && long ? "ok" : "small"} aria-live="polite">
          {!a ? `Щонайменше ${MIN} символів.` : long ? "✓ Достатньо довгий" : `Щонайменше ${MIN} символів · зараз ${[...a].length}`}
        </span>
      </label>
      <label className="field">
        <span>{props.labelB ?? "Пароль ще раз"}</span>
        <input className="input" type="password" autoComplete="new-password" value={b} onChange={(e) => props.setB(e.target.value)} />
        <span className={b && !match ? "bad" : "ok"} aria-live="polite">
          {!b ? "" : match ? "✓ Паролі збігаються" : "Паролі не збігаються"}
        </span>
      </label>
    </>
  );
}
const pairOk = (a: string, b: string) => [...a].length >= MIN && a === b;

function Form(props: { onSubmit: () => void; className?: string; label?: string; children: ReactNode }) {
  const submit = (e: FormEvent) => { e.preventDefault(); props.onSubmit(); };
  return <form className={props.className ?? "card"} aria-label={props.label} onSubmit={submit}>{props.children}</form>;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [me, setMe] = useState<Profile | null>(null);
  const [sel, setSel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");

  // creation
  const [name, setName] = useState("");
  const [ini, setIni] = useState("");
  const [iniEdited, setIniEdited] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [check, setCheck] = useState<number[]>([]);
  const [answers, setAnswers] = useState(["", "", ""]);
  const [saved, setSaved] = useState(false);
  const [disk, setDisk] = useState<boolean | null>(null);

  // login, recovery, change
  const [lpw, setLpw] = useState("");
  const [waitUntil, setWaitUntil] = useState(0);
  const [wrong, setWrong] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [cur, setCur] = useState("");
  const [, tick] = useState(0);

  const go = (s: Screen) => { setError(""); setScreen(s); };
  const selected = profiles.find((p) => p.id === sel) ?? me;

  async function refresh(): Promise<Profile[]> {
    const ps = await invoke<Profile[]>("list_profiles");
    setProfiles(ps);
    return ps;
  }

  useEffect(() => {
    refresh().then((ps) => { if (ps.length) { setSel(ps[0].id); go("login"); } else go("welcome"); }).catch((e) => setError(err(e)));
    invoke<boolean | null>("disk_encryption").then(setDisk).catch(() => setDisk(null));
  }, []);

  // countdown for the pause after wrong passwords
  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [waitUntil]);
  const wait = Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));

  // autolock after inactivity
  const lastActive = useRef(Date.now());
  const inApp = screen === "projects" || screen === "changePass";
  useEffect(() => {
    if (!inApp || !me) return;
    const mark = () => { lastActive.current = Date.now(); };
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    mark();
    const t = setInterval(() => { if (Date.now() - lastActive.current > me.autolock_min * 60_000) lockNow(); }, 10_000);
    return () => { clearInterval(t); events.forEach((e) => window.removeEventListener(e, mark)); };
  }, [inApp, me?.autolock_min]);

  function enter(p: Profile, message = "") {
    setMe(p); setSel(p.id); setMsg(message); setNote("");
    setLpw(""); setPw(""); setPw2(""); setCur(""); setPhrase(""); setWrong(false); setWaitUntil(0);
    refresh();
    go("projects");
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(err(e)); } finally { setBusy(false); }
  }

  function lockNow() {
    invoke("lock");
    setLpw(""); setWrong(false); setMsg("");
    go("locked");
  }

  function startSetup() {
    invoke("cancel_profile");
    setName(""); setIni(""); setIniEdited(false); setPw(""); setPw2(""); setWords([]); setAnswers(["", "", ""]); setSaved(false);
    go("you");
  }

  const toPassword = () => go("pass");
  const makeKey = () => run(async () => {
    const r = await invoke<{ words: string[]; check: number[] }>("begin_profile", { name, initials: ini, password: pw });
    setWords(r.words); setCheck(r.check); setSaved(false);
    go("key");
  });
  const confirmKey = () => run(async () => {
    try {
      await invoke<Profile>("confirm_profile", { answers }).then((p) => { setMe(p); setSel(p.id); });
      go("disk");
    } catch (e) {
      const s = err(e);
      if (!s.startsWith("mismatch:")) throw e;
      setError(`Не збігається: слово № ${s.slice(9).split(",").join(", № ")}. Звірте записаний ключ з екраном.`);
    }
  });
  const finishSetup = () => { setWords([]); enter(me!, "Профіль створено. Пароль і ключ відновлення відмикають усі ваші майбутні проєкти."); };

  const tryUnlock = (id: string) => run(async () => {
    if (!lpw || wait > 0) return;
    try {
      enter(await invoke<Profile>("unlock", { id, password: lpw }));
    } catch (e) {
      const s = err(e);
      setLpw("");
      if (s.startsWith("wait:")) { setWaitUntil(Date.now() + Number(s.slice(5)) * 1000); setWrong(false); }
      else if (s === "wrong") setWrong(true);
      else throw e;
    }
  });
  const loginError = wait > 0 ? `Забагато невдалих спроб поспіль. Наступна спроба — через ${wait} с.`
    : wrong ? "Пароль не підходить. Перевірте розкладку клавіатури й Caps Lock." : "";

  const recWords = phrase.split(/[\s,]+/).filter(Boolean);
  const checkPhrase = () => run(async () => {
    try {
      await invoke("check_recovery", { id: sel, phrase });
      setPw(""); setPw2(""); go("recoverPass");
    } catch (e) {
      const s = err(e);
      if (s === "bad_words") setError("Це не схоже на ключ відновлення: перевірте написання кожного слова.");
      else if (s === "wrong_key") setError(`Ключ не підходить до профілю «${selected?.name}». Перевірте порядок слів.`);
      else throw e;
    }
  });
  const recover = () => run(async () => {
    enter(await invoke<Profile>("recover", { id: sel, phrase, password: pw }), "Новий пароль задано. Ключ відновлення лишається той самий — зберігайте його й далі.");
  });

  const changePassword = () => run(async () => {
    try {
      await invoke("change_password", { current: cur, password: pw });
      setCur(""); setPw(""); setPw2("");
      setMsg("Пароль змінено. Ключ відновлення лишається той самий.");
      go("projects");
    } catch (e) {
      if (err(e) === "wrong") setError("Поточний пароль не підходить.");
      else throw e;
    }
  });

  const setAutolock = (minutes: number) => run(async () => {
    await invoke("set_autolock", { minutes });
    setMe({ ...me!, autolock_min: minutes });
  });

  const step = STEP_OF[screen];
  const youMissing = !name.trim() ? "Потрібне ім'я та прізвище." : !ini.trim() ? "Потрібні ініціали." : "";
  const diskLine = disk === true ? "увімкнено" : disk === false ? "вимкнено" : "не вдалося перевірити";
  const errorLine = error ? <span className="bad" role="alert">{error.startsWith("io:") ? `Не вдалося записати файл профілю: ${error.slice(3)}` : error}</span> : null;

  return (
    <>
      <div className="app">
        <header className="bar">
          <div className="brand"><span className="dot" aria-hidden="true" />QDA</div>
          {inApp && me && (
            <>
              <div className="grow" />
              <div className="row"><span className="circle" aria-hidden="true">{me.initials}</span><span style={{ fontSize: 13, fontWeight: 500 }}>{me.name}</span></div>
              <button className="btn sm quiet" onClick={lockNow}>Замкнути</button>
            </>
          )}
        </header>

        <main>
          {screen === "welcome" && (
            <section className="card" aria-label="Вітання">
              <div className="stack">
                <h1>Платформа QDA</h1>
                <p className="lead">Програма для феноменологічних якісних досліджень: транскрипти, кодування, аналіз і стаття.</p>
              </div>
              <div className="points">
                <div><span>01</span><span>Усі дані лежать лише на цьому комп'ютері, у зашифрованих файлах.</span></div>
                <div><span>02</span><span>Один пароль відмикає всі ваші проєкти. Окремих паролів для проєктів немає.</span></div>
                <div><span>03</span><span>Інтернет для роботи не потрібен.</span></div>
              </div>
              <p className="lead">Спершу створімо ваш профіль: ім'я, пароль і ключ відновлення. Це займе кілька хвилин; знадобляться папір і ручка або принтер.</p>
              <div className="row">
                <button className="btn primary" onClick={startSetup}>Створити профіль</button>
                {profiles.length > 0 && <button className="link" onClick={() => go("login")}>Назад до входу</button>}
              </div>
              {errorLine}
            </section>
          )}

          {step !== undefined && (
            <section className="card" aria-label="Створення профілю">
              <ol className="steps" aria-label="Кроки створення профілю">
                {SETUP_STEPS.map((s, i) => (
                  <li key={s} className={i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>{s}</li>
                ))}
              </ol>

              {screen === "you" && (
                <Form className="stack" onSubmit={() => !youMissing && toPassword()}>
                  <div className="stack" style={{ gap: 18 }}>
                    <div className="stack">
                      <h2>Хто працюватиме в програмі</h2>
                      <p className="lead">Ім'я бачитимуть колеги й супервайзер(ка) у файлах, які ви їм надішлете. Ініціалами підписуються ваші коди, коментарі й правки.</p>
                    </div>
                    <label className="field">
                      <span>Ім'я та прізвище</span>
                      <input className="input" value={name} autoComplete="name" maxLength={100}
                        onChange={(e) => { setName(e.target.value); if (!iniEdited) setIni(initialsOf(e.target.value)); }} />
                    </label>
                    <label className="field" style={{ maxWidth: 160 }}>
                      <span>Ініціали</span>
                      <input className="input mono" value={ini} maxLength={3} onChange={(e) => { setIni(e.target.value.toUpperCase()); setIniEdited(true); }} />
                    </label>
                    <span className="small">Ініціали заповнюються з імені; їх можна змінити (до 3 літер).</span>
                    <div className="row">
                      <button type="submit" className="btn primary" disabled={!!youMissing}>Далі</button>
                      {profiles.length > 0 && <button type="button" className="btn quiet" onClick={() => go("login")}>Скасувати</button>}
                      <span className="small" aria-live="polite">{youMissing}</span>
                    </div>
                  </div>
                </Form>
              )}

              {screen === "pass" && (
                <Form className="stack" onSubmit={() => pairOk(pw, pw2) && !busy && makeKey()}>
                  <div className="stack" style={{ gap: 18 }}>
                    <div className="stack">
                      <h2>Пароль входу</h2>
                      <p className="lead">Цей пароль відмикає програму і водночас є ключем до всіх ваших проєктів. Він ніде не зберігається, тож нагадати його неможливо: ні програма, ні розробник(ця), ні супервайзер(ка) цього не зроблять.</p>
                    </div>
                    <PasswordPair a={pw} b={pw2} setA={setPw} setB={setPw2} />
                    <p className="note">Найлегше запам'ятати кілька слів поспіль, напр. «зелений чайник читає вірші». Довжина важить більше, ніж цифри й знаки.</p>
                    {errorLine}
                    <div className="row">
                      <button type="button" className="btn quiet" onClick={() => { invoke("cancel_profile"); setWords([]); go("you"); }}>Назад</button>
                      <button type="submit" className="btn primary" disabled={!pairOk(pw, pw2) || busy}>{busy ? "Створюю ключі…" : "Далі"}</button>
                    </div>
                  </div>
                </Form>
              )}

              {screen === "key" && (
                <>
                  <div className="stack">
                    <h2>Ключ відновлення профілю</h2>
                    <p className="lead">Якщо ви забудете пароль, лише ці 12 слів дозволять відкрити ваші проєкти й задати новий пароль. Ключ показується тільки зараз.</p>
                  </div>
                  <ol className="keygrid" aria-label="Ключ відновлення, 12 слів">
                    {words.map((w, i) => <li key={i}><span>{String(i + 1).padStart(2, "0")}</span><span>{w}</span></li>)}
                  </ol>
                  <div className="stack" style={{ fontSize: 13, lineHeight: 1.6 }}>
                    <span>Запишіть слова від руки або роздрукуйте й зберігайте <b style={{ fontWeight: 600 }}>окремо від комп'ютера</b>.</span>
                    <span className="lead">Не фотографуйте ключ і не зберігайте його в хмарі поруч із резервними копіями проєктів: хто має і копію, і ключ, той відкриє проєкти.</span>
                  </div>
                  <div className="row">
                    <button className="btn" onClick={() => invoke("print_page").catch((e) => setError(err(e)))}>Роздрукувати</button>
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                    <span>Я записав(ла) або роздрукував(ла) ключ і зберігатиму його окремо від комп'ютера</span>
                  </label>
                  {errorLine}
                  <div className="row">
                    <button className="btn quiet" onClick={() => { invoke("cancel_profile"); setWords([]); go("pass"); }}>Назад</button>
                    <button className="btn primary" disabled={!saved} onClick={() => { setAnswers(["", "", ""]); go("keycheck"); }}>Далі: перевірити запис</button>
                  </div>
                </>
              )}

              {screen === "keycheck" && (
                <Form className="stack" onSubmit={() => answers.every((a) => a.trim()) && !busy && confirmKey()}>
                  <div className="stack" style={{ gap: 18 }}>
                    <div className="stack">
                      <h2>Перевірка запису</h2>
                      <p className="lead">Впишіть три слова з того, що ви записали, а не з екрана. Так ми переконаємося, що ключ записано правильно.</p>
                    </div>
                    <div className="row" style={{ alignItems: "stretch" }}>
                      {check.map((n, i) => (
                        <label key={n} className="field" style={{ flex: "1 1 140px" }}>
                          <span>Слово № {n}</span>
                          <input className="input mono" autoComplete="off" spellCheck={false} value={answers[i]}
                            onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} />
                        </label>
                      ))}
                    </div>
                    {errorLine}
                    <div className="row">
                      <button type="button" className="btn quiet" onClick={() => go("key")}>Показати ключ ще раз</button>
                      <button type="submit" className="btn primary" disabled={!answers.every((a) => a.trim()) || busy}>Перевірити</button>
                    </div>
                  </div>
                </Form>
              )}

              {screen === "disk" && (
                <>
                  <div className="stack">
                    <h2>Захист усього диска</h2>
                    <p className="lead">Програма шифрує файли проєктів. Але аудіозаписи інтерв'ю й експортовані статті лежать на диску звичайними файлами. Тому радимо ввімкнути вбудоване шифрування диска — так їх не прочитають, навіть якщо ноутбук загубиться.</p>
                  </div>
                  {disk !== null && (
                    <div className="status">
                      <span>На цьому Mac FileVault:</span>
                      <span style={{ fontWeight: 600, color: disk ? "var(--ink)" : "var(--bad)" }}>{diskLine}</span>
                    </div>
                  )}
                  <p style={{ fontSize: 13, lineHeight: 1.6 }}>
                    На Mac: <span className="mono" style={{ fontSize: 12 }}>Системні параметри → Приватність і безпека → FileVault → Увімкнути</span>. macOS теж покаже ключ відновлення — його варто зберегти так само, як ключ програми.
                  </p>
                  <p className="small">На Windows це BitLocker або «Шифрування пристрою» (Параметри → Конфіденційність і захист). Порада лишиться в «Профілі», доки програма не побачить, що шифрування ввімкнено.</p>
                  {errorLine}
                  <div className="row">
                    {disk !== true && <button className="btn" onClick={() => invoke("open_disk_settings").catch((e) => setError(err(e)))}>Відкрити налаштування шифрування</button>}
                    <button className="btn primary" onClick={finishSetup}>Перейти до програми</button>
                  </div>
                </>
              )}
            </section>
          )}

          {screen === "login" && (
            <section className="login" aria-label="Вхід">
              <h1 style={{ fontSize: 22 }}>Хто працює?</h1>
              <div className="tiles" role="radiogroup" aria-label="Профіль">
                {profiles.map((p) => (
                  <button key={p.id} className="tile" role="radio" aria-checked={p.id === sel} onClick={() => { setSel(p.id); setLpw(""); setWrong(false); }}>
                    <span className="circle">{p.initials}</span>{p.name}
                  </button>
                ))}
              </div>
              <Form onSubmit={() => tryUnlock(sel)}>
                <label className="field">
                  <span>Пароль для «{selected?.name}»</span>
                  <input className="input" type="password" autoComplete="current-password" autoFocus value={lpw} onChange={(e) => setLpw(e.target.value)} />
                </label>
                <span className="bad" aria-live="polite">{loginError}</span>
                {errorLine}
                <div className="row" style={{ gap: "8px 16px" }}>
                  <button type="submit" className="btn primary" disabled={!lpw || wait > 0 || busy}>{busy ? "Перевіряю…" : "Увійти"}</button>
                  <button type="button" className="link" onClick={() => { setPhrase(""); go("recover"); }}>Забули пароль?</button>
                </div>
              </Form>
              <button className="link" style={{ alignSelf: "flex-start" }} onClick={() => go("welcome")}>+ Новий профіль на цьому комп'ютері</button>
              <span className="small">Кожен профіль має свій пароль і бачить лише свої проєкти.</span>
            </section>
          )}

          {screen === "recover" && (
            <Form label="Відновлення доступу" onSubmit={() => recWords.length === 12 && !busy && checkPhrase()}>
              <span className="label">Забули пароль · {selected?.name}</span>
              <div className="stack">
                <h2>Ключ відновлення профілю</h2>
                <p className="lead">Впишіть 12 слів ключа, який ви записали під час створення профілю, через пробіл, у тому самому порядку.</p>
              </div>
              <label className="field">
                <span>12 слів</span>
                <textarea className="input mono" rows={3} spellCheck={false} autoComplete="off" value={phrase} onChange={(e) => { setPhrase(e.target.value); setError(""); }} />
                <span className="small" aria-live="polite">Слів: {recWords.length} з 12</span>
              </label>
              {errorLine}
              <div className="row">
                <button type="button" className="btn quiet" onClick={() => go("login")}>Назад</button>
                <button type="submit" className="btn primary" disabled={recWords.length !== 12 || busy}>{busy ? "Перевіряю…" : "Далі"}</button>
              </div>
              <span className="small">Немає ні пароля, ні ключа? Тоді проєкти профілю відкрити неможливо. Студентський проєкт можна буде відкрити двома половинами ключа проєкту — вашою й супервайзера(ки).</span>
            </Form>
          )}

          {screen === "recoverPass" && (
            <Form label="Новий пароль" onSubmit={() => pairOk(pw, pw2) && !busy && recover()}>
              <span className="label">Ключ підійшов · {selected?.name}</span>
              <h2>Новий пароль</h2>
              <PasswordPair a={pw} b={pw2} setA={setPw} setB={setPw2} labelA="Новий пароль" labelB="Новий пароль ще раз" />
              <span className="lead">Ключ відновлення лишається той самий — зберігайте його й далі.</span>
              {errorLine}
              <div className="row">
                <button type="submit" className="btn primary" disabled={!pairOk(pw, pw2) || busy}>{busy ? "Зберігаю…" : "Задати пароль і увійти"}</button>
              </div>
            </Form>
          )}

          {screen === "locked" && me && (
            <Form className="card narrow" label="Програму замкнено" onSubmit={() => tryUnlock(me.id)}>
              <div className="row">
                <span className="circle lg" aria-hidden="true">{me.initials}</span>
                <div className="stack" style={{ gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Програму замкнено</span>
                  <span className="small">{me.name} · усе збережено.</span>
                </div>
              </div>
              <label className="field">
                <span>Пароль</span>
                <input className="input" type="password" autoComplete="current-password" autoFocus value={lpw} onChange={(e) => setLpw(e.target.value)} />
              </label>
              <span className="bad" aria-live="polite">{loginError}</span>
              {errorLine}
              <div className="row" style={{ gap: "8px 16px" }}>
                <button type="submit" className="btn primary" disabled={!lpw || wait > 0 || busy}>Відімкнути</button>
                <button type="button" className="link" onClick={() => { setSel(me.id); setPhrase(""); go("recover"); }}>Забули пароль?</button>
                <button type="button" className="link" onClick={() => { setMe(null); go("login"); }}>Інший профіль</button>
              </div>
            </Form>
          )}

          {screen === "projects" && me && (
            <>
              {msg && (
                <div className="msg" role="status">
                  <span className="grow">{msg}</span>
                  <button className="link" style={{ minHeight: 32 }} onClick={() => setMsg("")} aria-label="Закрити повідомлення">✕</button>
                </div>
              )}
              <div className="split">
                <section aria-label="Мої проєкти">
                  <div className="row" style={{ alignItems: "flex-end", gap: "12px 24px" }}>
                    <div className="stack" style={{ gap: 4 }}>
                      <span className="label">Мої проєкти</span>
                      <span className="title">0 проєктів</span>
                    </div>
                    <div className="grow" />
                    <button className="btn sm" onClick={() => setNote("Відкриття резервної копії з'явиться на кроці 1.2.")}>Відкрити резервну копію</button>
                    <button className="btn sm primary" onClick={() => setNote("Створення проєктів з'явиться на кроці 1.2.")}>+ Новий проєкт</button>
                  </div>
                  <div className="empty">
                    <span style={{ fontSize: 15, fontWeight: 500 }}>Проєктів ще немає</span>
                    <span className="lead" style={{ maxWidth: 440 }}>Створіть новий проєкт або відкрийте резервну копію чи файл, який вам надіслали. Кожен проєкт — один зашифрований файл у теці «Документи / QDA».</span>
                    <span className="small" aria-live="polite">{note}</span>
                  </div>
                </section>
                <aside aria-label="Профіль">
                  <span className="label">Профіль</span>
                  <div className="kv"><span>Ініціали</span><span className="mono">{me.initials}</span></div>
                  <div className="kv"><span>Ключ відновлення</span><span className="mono">створено</span></div>
                  <label className="kv">
                    <span>Замикати після бездіяльності</span>
                    <select className="input" value={me.autolock_min} onChange={(e) => setAutolock(Number(e.target.value))}>
                      {[5, 15, 30, 60].map((m) => <option key={m} value={m}>{m} хв</option>)}
                    </select>
                  </label>
                  {errorLine}
                  <div className="rule">
                    <button className="btn sm" style={{ textAlign: "left" }} onClick={() => { setCur(""); setPw(""); setPw2(""); setMsg(""); go("changePass"); }}>Змінити пароль</button>
                    <button className="btn sm quiet" style={{ textAlign: "left" }} onClick={() => { invoke("lock"); setMe(null); setLpw(""); refresh(); go("login"); }}>Вийти · інший профіль</button>
                  </div>
                  {disk !== true && (
                    <div className="rule" style={{ gap: 6 }}>
                      <span style={{ fontSize: 13 }}><span className="dot" style={{ display: "inline-block", width: 8, height: 8, marginRight: 8 }} aria-hidden="true" />Шифрування диска: {diskLine}</span>
                      <span className="small">Аудіо й експортовані файли на диску можуть бути незашифровані. На Mac: Системні параметри → Приватність і безпека → FileVault.</span>
                    </div>
                  )}
                </aside>
              </div>
            </>
          )}

          {screen === "changePass" && (
            <Form label="Змінити пароль" onSubmit={() => cur && pairOk(pw, pw2) && !busy && changePassword()}>
              <h2>Змінити пароль</h2>
              <label className="field">
                <span>Поточний пароль</span>
                <input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
              </label>
              <PasswordPair a={pw} b={pw2} setA={setPw} setB={setPw2} labelA="Новий пароль" labelB="Новий пароль ще раз" />
              {errorLine}
              <span className="lead">Зміна миттєва: проєкти не перешифровуються, перезамикається лише ваша «в'язка ключів». Ключ відновлення лишається той самий.</span>
              <div className="row">
                <button type="button" className="btn quiet" onClick={() => { setPw(""); setPw2(""); go("projects"); }}>Скасувати</button>
                <button type="submit" className="btn primary" disabled={!cur || !pairOk(pw, pw2) || busy}>{busy ? "Зберігаю…" : "Змінити пароль"}</button>
              </div>
            </Form>
          )}

          {screen === "loading" && errorLine}
        </main>
      </div>

      {screen === "key" && (
        <div className="print-only">
          <h1>Платформа QDA · ключ відновлення профілю «{name}»</h1>
          <ol>{words.map((w, i) => <li key={i}>{w}</li>)}</ol>
          <p>Зберігайте окремо від комп'ютера. Хто має цей ключ, може відкрити ваші проєкти.</p>
        </div>
      )}
    </>
  );
}
