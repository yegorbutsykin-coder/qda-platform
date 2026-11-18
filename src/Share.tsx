import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { Person, Private, Shared } from "./model";
import { buildReturn } from "./exchange";

export const STAGES = ["Етика", "Інтерв'ю", "Транскрипція", "Кодування", "Категорії", "Стаття", "Подано"];

/** What travels in a package: the shared part only — never originals, the dictionary or audio. */
export type PackBody = {
  kind: "copy" | "supervisor";
  sent: number;
  from: Person & { id: string };
  project: { id: string; name: string; method: string };
  stage?: string;
  blind: boolean;
  data: Shared;
};

const stem = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 80) || "Проєкт";

/** «Поділитися…»: a copy for a colleague or a package for the supervisor, locked by 6 words or the sender's own phrase. */
export default function Share(props: {
  shared: Shared; priv: Private; projectId: string; name: string; method: string; me: Person & { id: string };
  suspects: string[]; onBack: () => void; toDict: () => void;
}) {
  const copy = props.shared.copyOf;
  const [kind, setKind] = useState<"copy" | "supervisor">("copy");
  const [blind, setBlind] = useState(false);
  const [stage, setStage] = useState(STAGES[3]);
  const [words, setWords] = useState<string[] | null>(null);
  const [file, setFile] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [own, setOwn] = useState(false); // the sender's own phrase instead of 6 random words
  const [own1, setOwn1] = useState(""), [own2, setOwn2] = useState("");
  const ownOk = [...own1.trim()].length >= 10 && own1 === own2;
  const s = props.shared;
  const transcribing = s.interviews.filter((x) => x.tx).length;

  const back = copy ? buildReturn(s, props.priv, props.me) : null;
  const lockChoice = (
      <div className="stack" style={{ gap: 8 }}>
      <span style={{ fontSize: 13 }}>Чим замкнути пакет</span>
      <div className="seg" role="group" aria-label="Чим замкнути пакет">
        <button type="button" aria-pressed={!own} onClick={() => setOwn(false)}>6 випадкових слів (надійніше)</button>
        <button type="button" aria-pressed={own} onClick={() => setOwn(true)}>Своє кодове слово чи фраза</button>
      </div>
      {!own ? <span className="small">Програма покаже 6 слів після збереження файлу.</span> : (
        <>
          <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
            <label className="field" style={{ flex: "1 1 220px" }}><span>Кодове слово чи фраза</span>
              <input className="input" type="password" autoComplete="new-password" value={own1} onChange={(e) => setOwn1(e.target.value)} />
              <span className={[...own1.trim()].length >= 10 ? "ok" : "small"} aria-live="polite">{[...own1.trim()].length >= 10 ? "✓ Достатньо довга" : `Щонайменше 10 символів · зараз ${[...own1.trim()].length}`}</span></label>
            <label className="field" style={{ flex: "1 1 220px" }}><span>Ще раз</span>
              <input className="input" type="password" autoComplete="new-password" value={own2} onChange={(e) => setOwn2(e.target.value)} />
              <span className={own2 && own1 !== own2 ? "bad" : "ok"} aria-live="polite">{!own2 ? "" : own1 === own2 ? "✓ Збігаються" : "Не збігаються"}</span></label>
          </div>
          <span className="small">Файл із даними дослідження може потрапити до чужих рук разом із листом, тож одне слово чи ім'я легко вгадати. Краще кілька слів, відомих лише вам двом. Великі літери й зайві пробіли не враховуються.</span>
        </>
      )}
    </div>
  );

  async function make() {
    setError("");
    const path = await save({
      title: "Зберегти пакет",
      defaultPath: `${stem(props.name)} — ${copy ? `зміни від ${props.me.name}` : kind === "copy" ? "для колеги" : "для супервайзера(ки)"}.qdapack`,
      filters: [{ name: "Пакет QDA", extensions: ["qdapack"] }],
    });
    if (!path) return;
    const mine = (by: string) => blind && by === props.me.id;
    const body: PackBody = {
      kind, blind, sent: Date.now(), from: props.me,
      project: { id: props.projectId, name: props.name, method: props.method },
      ...(kind === "supervisor" ? { stage } : {}),
      data: {
        ...s,
        // Unfinished transcriptions and local recording marks stay home.
        interviews: s.interviews.filter((x) => !x.tx).map(({ tx: _tx, audio: _audio, ...x }) => x),
        apps: s.apps.filter((a) => !mine(a.by)),
        notes: Object.fromEntries(Object.entries(s.notes).filter(([, n]) => !mine(n.by))),
        people: { ...(s.people ?? {}), [props.me.id]: { name: props.me.name, initials: props.me.initials } },
      },
    };
    try {
      const p = path.toLowerCase().endsWith(".qdapack") ? path : path + ".qdapack";
      setWords(await invoke<string[]>("make_pack", { path: p, body: back ?? body, phrase: own ? own1 : null }));
      setOwn1(""); setOwn2("");
      setFile(p.split(/[\\/]/).pop() ?? p);
    } catch (e) {
      setError(`Не вдалося створити пакет: ${e}`);
    }
  }

  if (words && !words.length) {
    return (
      <section className="card wide stack" style={{ gap: 16 }} aria-label="Пакет створено">
        <h2 style={{ margin: 0 }}>Пакет створено</h2>
        <span className="lead">Файл <span className="mono">{file}</span> відкривається лише вашим кодовим словом чи фразою. Повідомте їх одержувачу(ці) <b>окремо від файлу</b>: дзвінком чи в месенджері, не в тому самому листі.</span>
        <span className="small">Програма фразу не зберігає. Забули — просто створіть пакет ще раз.</span>
        <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={props.onBack}>Готово</button>
      </section>
    );
  }

  if (words) {
    return (
      <section className="card wide stack" style={{ gap: 16 }} aria-label="Фраза до пакета">
        <h2 style={{ margin: 0 }}>Пакет створено</h2>
        <span className="lead">Файл <span className="mono">{file}</span> відкривається лише цією фразою. Передайте її <b>окремо від файлу</b>: дзвінком чи в месенджері, не в тому самому листі.</span>
        <ol className="keygrid" aria-label="Фраза з 6 слів">
          {words.map((w, i) => <li key={i}><span>{String(i + 1).padStart(2, "0")}</span><span>{w}</span></li>)}
        </ol>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn sm" onClick={() => navigator.clipboard?.writeText(words.join(" ")).then(() => setCopied(true), () => {})}>
            {copied ? "Скопійовано" : "Скопіювати фразу"}</button>
          <span className="small">Програма фразу не зберігає. Загубили — просто створіть пакет ще раз.</span>
        </div>
        <button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={props.onBack}>Готово</button>
      </section>
    );
  }

  if (back && copy) {
    return (
      <section className="card wide stack" style={{ gap: 16 }} aria-label="Надіслати зміни">
        <h2 style={{ margin: 0 }}>Надіслати зміни власнику(ці) — {copy.from.name}</h2>
        <div className="panel stack" style={{ gap: 6, fontSize: 13 }}>
          <span><b>У пакеті лише ваше:</b> фрагментів кодування — {back.apps.length}, нових кодів — {back.codes.filter((c) => c.by === props.me.id).length}, коментарів — {back.notes.length}{back.codes.some((c) => c.by !== props.me.id) ? "; а також назви кодів, якщо ви їх змінювали" : ""}.</span>
          <span className="small">Власник(ця) додасть зміни до свого проєкту й сам(а) вирішить, чи брати нові назви кодів. Надсилати можна скільки завгодно разів: щоразу йде все ваше кодування, нічого не подвоюється.</span>
        </div>
        {!back.apps.length && !back.notes.length && <span className="small">Ви ще нічого не закодували й не прокоментували.</span>}
        {lockChoice}
        {error && <span className="bad" role="alert">{error}</span>}
        <div className="row" style={{ gap: 10 }}>
          <button className="btn primary" onClick={make} disabled={own && !ownOk}>Створити пакет змін…</button>
          <button className="btn quiet" onClick={props.onBack}>Скасувати</button>
        </div>
      </section>
    );
  }

  return (
    <section className="card wide stack" style={{ gap: 16 }} aria-label="Поділитися">
      <h2 style={{ margin: 0 }}>Поділитися проєктом</h2>
      <div className="stack" role="radiogroup" aria-label="Для кого пакет" style={{ gap: 8 }}>
        <label className="check"><input type="radio" name="kind" checked={kind === "copy"} onChange={() => setKind("copy")} /><span><b>Копія для колеги</b> — співдослідник(ця) кодує й коментує у своїй програмі.</span></label>
        <label className="check"><input type="radio" name="kind" checked={kind === "supervisor"} onChange={() => setKind("supervisor")} /><span><b>Для супервайзера(ки)</b> — те саме, з позначкою етапу роботи. Що й коли надсилати, вирішуєте ви.</span></label>
      </div>
      {kind === "supervisor" && (
        <label className="row" style={{ gap: 8, fontSize: 13 }}>Етап роботи
          <select className="input" style={{ height: 34, fontFamily: "inherit" }} value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
      )}
      <label className="check"><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
        <span>Без мого кодування й коментарів — для сліпого кодування (кодова книга лишається).</span></label>

      <div className="panel stack" style={{ gap: 6, fontSize: 13 }}>
        <span><b>У пакеті:</b> транскрипти лише із замінами, картки учасників(ць), коди, категорії, супертеми{blind ? "" : ", кодування й коментарі"}.</span>
        <span><b>Ніколи не потрапляють:</b> оригінал транскриптів, словник замін, аудіо.</span>
        {transcribing > 0 && <span className="small">Інтерв'ю, що ще транскрибуються або з перерваною транскрипцією ({transcribing}), не потраплять у пакет.</span>}
      </div>

      {props.suspects.length > 0 && (
        <div className="warnline">У транскриптах ще є слова, схожі на імена: {props.suspects.slice(0, 8).map((w) => `«${w}»`).join(", ")}{props.suspects.length > 8 ? "…" : ""}. Колега побачить їх як є.{" "}
          <button className="link" style={{ fontSize: 12, minHeight: 0 }} onClick={props.toDict}>Перевірити словник замін →</button></div>
      )}
      {lockChoice}
      {error && <span className="bad" role="alert">{error}</span>}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn primary" onClick={make} disabled={own && !ownOk}>Створити пакет…</button>
        <button className="btn quiet" onClick={props.onBack}>Скасувати</button>
      </div>
    </section>
  );
}
