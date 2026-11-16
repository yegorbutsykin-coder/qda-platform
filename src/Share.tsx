import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { Person, Shared } from "./model";

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

/** «Поділитися…»: a copy for a colleague or a package for the supervisor, locked by 6 words. */
export default function Share(props: {
  shared: Shared; projectId: string; name: string; method: string; me: Person & { id: string };
  suspects: string[]; onBack: () => void; toDict: () => void;
}) {
  const [kind, setKind] = useState<"copy" | "supervisor">("copy");
  const [blind, setBlind] = useState(false);
  const [stage, setStage] = useState(STAGES[3]);
  const [words, setWords] = useState<string[] | null>(null);
  const [file, setFile] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const s = props.shared;
  const transcribing = s.interviews.filter((x) => x.tx).length;

  async function make() {
    setError("");
    const path = await save({
      title: "Зберегти пакет",
      defaultPath: `${stem(props.name)} — ${kind === "copy" ? "для колеги" : "для супервайзера(ки)"}.qdapack`,
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
      setWords(await invoke<string[]>("make_pack", { path: p, body }));
      setFile(p.split(/[\\/]/).pop() ?? p);
    } catch (e) {
      setError(`Не вдалося створити пакет: ${e}`);
    }
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
      <span className="small">Пакет замикається одноразовою фразою з 6 слів — програма покаже її після збереження файлу.</span>
      {error && <span className="bad" role="alert">{error}</span>}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn primary" onClick={make}>Створити пакет…</button>
        <button className="btn quiet" onClick={props.onBack}>Скасувати</button>
      </div>
    </section>
  );
}
