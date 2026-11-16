import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import Player from "./Player";
import { segmentsToReplicas, type TxSegment } from "./text";

export type ModelInfo = { id: string; label: string; mib: number; downloaded: boolean };
export const LANGS: Record<string, string> = { auto: "визначити автоматично", uk: "українська", ru: "російська", en: "англійська" };

type Run = { key: string; model: string; lang: string; state: "waiting" | "running" | "done" | "error"; pct: number; ms: number; segs: TxSegment[]; error?: string };

const took = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} с` : `${Math.floor(ms / 60_000)} хв ${Math.round((ms % 60_000) / 1000)} с`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Model comparison (step 2.3): the same fragment of a recording through several models and languages,
 * texts side by side with the time each took. Nothing of it is saved: the texts may hold real names.
 */
export default function Compare(props: {
  path: string; models: ModelInfo[]; onChoose: (model: string, lang: string) => void; onBack: () => void;
}) {
  const ready = props.models.filter((m) => m.downloaded);
  const [picked, setPicked] = useState<string[]>(ready.filter((m) => m.id !== "tiny").map((m) => m.id).slice(0, 3));
  const [lang, setLang] = useState("uk");
  const [start, setStart] = useState("0:00");
  const [len, setLen] = useState(120);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [canPlay, setCanPlay] = useState(false);
  const busy = runs.some((r) => r.state === "waiting" || r.state === "running");
  const stop = useRef(false);
  const current = useRef("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const name = props.path.split(/[\\/]/).pop() ?? props.path;

  const startMs = (() => {
    const m = start.trim().match(/^(\d{1,3})(?::([0-5]\d))?$/);
    return m ? (Number(m[1]) * 60 + Number(m[2] ?? 0)) * 1000 : null;
  })();

  useEffect(() => {
    invoke<string>("attach_audio", { path: props.path })
      .then((fp) => invoke<string>("allow_audio", { path: props.path, fingerprint: fp }))
      .then((st) => setCanPlay(st === "ok"), () => setCanPlay(false));
    return () => {
      stop.current = true;
      if (current.current) invoke("cancel_transcription", { job: current.current }).catch(() => {});
    };
  }, [props.path]);

  const patch = (key: string, p: Partial<Run>) => setRuns((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function compare() {
    if (startMs === null) { setError("Початок фрагмента — у форматі хв:с, наприклад 12:30."); return; }
    setError("");
    stop.current = false;
    const batch: Run[] = picked.map((model) => ({ key: `cmp-${Date.now().toString(36)}-${model.replace(/[^a-z0-9]/gi, "")}`, model, lang, state: "waiting", pct: 0, ms: 0, segs: [] }));
    setRuns((rs) => [...batch, ...rs]);
    // One after another: several models at once would share the processor and each take longer.
    for (const r of batch) {
      if (stop.current) { patch(r.key, { state: "error", error: "Зупинено." }); continue; }
      const t0 = Date.now();
      current.current = r.key;
      patch(r.key, { state: "running" });
      try {
        await invoke("start_transcription", { job: r.key, path: props.path, model: r.model, language: r.lang, offsetMs: startMs, durationMs: len * 1000 });
      } catch (e) {
        patch(r.key, { state: "error", error: String(e) });
        continue;
      }
      for (;;) {
        await sleep(1000);
        const st = await invoke<{ state: string; pct: number; error?: string; segments?: TxSegment[] } | null>("transcription_status", { job: r.key }).catch(() => null);
        if (!st) { patch(r.key, { state: "error", error: "Перервано." }); break; }
        if (st.state === "running") { patch(r.key, { pct: st.pct, ms: Date.now() - t0 }); continue; }
        if (st.state === "done") patch(r.key, { state: "done", pct: 100, ms: Date.now() - t0, segs: st.segments ?? [] });
        else patch(r.key, { state: "error", ms: Date.now() - t0, error: st.error === "cancelled" ? "Зупинено." : st.error === "fragment_past_end" ? "Запис коротший, ніж початок фрагмента." : st.error });
        break;
      }
      current.current = "";
    }
  }

  function stopAll() {
    stop.current = true;
    if (current.current) invoke("cancel_transcription", { job: current.current }).catch(() => {});
  }

  const label = (id: string) => props.models.find((m) => m.id === id)?.label ?? id;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <button className="link" style={{ alignSelf: "flex-start" }} onClick={props.onBack}>← До додавання інтерв'ю</button>
      <div className="stack" style={{ gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>Порівняти моделі на фрагменті запису</h2>
        <span className="small">Той самий фрагмент <span className="mono">{name}</span> розпізнається кожною обраною моделлю по черзі; тексти стануть поруч, з часом роботи. Усе — на цьому комп'ютері. Результати порівняння ніде не зберігаються.</span>
      </div>

      <div className="panel stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 18, alignItems: "flex-end" }}>
          <label className="stack" style={{ gap: 4, fontSize: 13 }}>Початок фрагмента (хв:с)
            <input className="input mono" style={{ width: 110 }} value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={startMs === null} />
          </label>
          <label className="stack" style={{ gap: 4, fontSize: 13 }}>Довжина
            <select className="input" style={{ height: 38, fontFamily: "inherit" }} value={len} onChange={(e) => setLen(Number(e.target.value))}>
              <option value={60}>1 хвилина</option><option value={120}>2 хвилини</option><option value={300}>5 хвилин</option>
            </select>
          </label>
          <label className="stack" style={{ gap: 4, fontSize: 13 }}>Мова запису
            <select className="input" style={{ height: 38, fontFamily: "inherit" }} value={lang} onChange={(e) => setLang(e.target.value)}>
              {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <span className="small">Оберіть місце, де говорить учасник(ця), — найкраще з суржиком, діалектом чи нечіткою мовою: там різниця між моделями видна найкраще. Щоб порівняти мови, запустіть порівняння ще раз з іншою мовою — нові результати стануть поруч.</span>
        <fieldset className="stack" style={{ gap: 6, border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 6 }}>Моделі</legend>
          {ready.map((m) => (
            <label key={m.id} className="check" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={picked.includes(m.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m.id] : p.filter((x) => x !== m.id)))} />
              <span>{m.label} <span className="small mono">· {m.mib} МБ</span></span>
            </label>
          ))}
          {ready.length < props.models.length && <span className="small">Інші моделі спершу завантажте на попередньому екрані.</span>}
        </fieldset>
        {canPlay && (
          <div className="stack" style={{ gap: 4 }}>
            <audio ref={audio} src={convertFileSrc(props.path)} preload="metadata"
              onLoadedMetadata={(e) => { if (startMs !== null) e.currentTarget.currentTime = startMs / 1000; }} />
            <Player audio={audio} src={props.path} name={name} onTime={() => {}} />
            <button className="link" style={{ fontSize: 12, alignSelf: "flex-start" }} disabled={startMs === null}
              onClick={() => { if (audio.current && startMs !== null) { audio.current.currentTime = startMs / 1000; audio.current.play(); } }}>Слухати з початку фрагмента</button>
          </div>
        )}
        {error && <span className="bad" role="alert" style={{ fontSize: 13 }}>{error}</span>}
        <div className="row" style={{ gap: 10 }}>
          <button className="btn primary" disabled={busy || !picked.length} onClick={compare}>Порівняти {picked.length > 1 ? `${picked.length} моделі` : ""}</button>
          {busy && <button className="btn quiet" onClick={stopAll}>Зупинити</button>}
        </div>
      </div>

      {runs.length > 0 && (
        <div className="cmpgrid">
          {runs.map((r) => (
            <section key={r.key} className="panel stack" style={{ gap: 8, minWidth: 0 }} aria-busy={r.state === "running"}>
              <span style={{ fontWeight: 500, fontSize: 14 }}>{label(r.model)}</span>
              <span className="small">{LANGS[r.lang]} · {
                r.state === "waiting" ? "у черзі" : r.state === "running" ? `розпізнається… ${r.pct}% · ${took(r.ms)}`
                  : r.state === "done" ? `${took(r.ms)} на ${len >= 120 ? `${len / 60} хв` : "1 хв"} запису` : r.error}</span>
              {r.state === "done" && (
                <>
                  <div className="cmptext mono">
                    {r.segs.length ? segmentsToReplicas(r.segs).map((x, i) => <p key={i}><span className="tc">{x.t}</span> {x.text}</p>)
                      : <p className="small">Мовлення не розпізнано.</p>}
                  </div>
                  <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => props.onChoose(r.model, r.lang)}>Обрати цю модель і мову</button>
                </>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
