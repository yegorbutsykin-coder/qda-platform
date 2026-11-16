import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { applyMerge, planMerge, type MergePlan, type ReturnBody } from "./exchange";
import type { Private, Shared } from "./model";

const said = (e: unknown) => {
  const s = String(e);
  if (s === "wrong") return "Фраза не підходить до цього файлу. Перевірте слова.";
  if (s === "not_a_pack") return "Цей файл не є пакетом Платформи QDA або пошкоджений.";
  if (s === "bad_words:0") return "Фраза — це рівно 6 слів, через пробіл.";
  if (s.startsWith("bad_words:")) return `Слова № ${s.slice(10)} немає у списку — перевірте написання.`;
  return s;
};

/** «Додати зміни від колеги…»: open a package, see what changed, choose code names, add. */
export default function Merge(props: {
  shared: Shared; priv: Private; projectId: string; onBack: () => void; onMerge: (s: Shared, text: string) => void;
}) {
  const [file, setFile] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [take, setTake] = useState<Set<string>>(new Set());

  const pick = async () => {
    const p = await open({ title: "Зміни від колеги", filters: [{ name: "Пакет QDA", extensions: ["qdapack"] }] });
    if (typeof p === "string") { setFile(p); setPlan(null); setError(""); }
  };
  async function read() {
    setBusy(true); setError("");
    try {
      const b = await invoke<ReturnBody | { kind: string; project: { id: string } }>("open_pack", { path: file, phrase });
      if (b.kind !== "return") throw "Це копія проєкту, а не повернення змін. Її відкривають у «Моїх проєктах» → «Відкрити пакет…».";
      if (b.project.id !== props.projectId) throw "Ці зміни зроблено в копії іншого проєкту.";
      setPlan(planMerge(props.shared, props.priv, b as ReturnBody));
      setTake(new Set());
    } catch (e) {
      setError(said(e));
    } finally {
      setBusy(false);
    }
  }

  if (!plan) {
    return (
      <section className="card wide stack" style={{ gap: 14 }} aria-label="Додати зміни від колеги">
        <h2 style={{ margin: 0 }}>Додати зміни від колеги</h2>
        <div className="row">
          <span className="mono path">{file || "файл не обрано"}</span>
          <button className="btn sm quiet" disabled={busy} onClick={pick}>{file ? "Обрати інший файл…" : "Обрати файл…"}</button>
        </div>
        <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); read(); }}>
          <label className="stack" style={{ gap: 4, fontSize: 13 }}>Фраза з 6 слів, яку вам передали окремо від файлу
            <input className="input mono" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
          </label>
          {error && <span className="bad" role="alert">{error}</span>}
          <div className="row" style={{ gap: 10 }}>
            <button className="btn primary" type="submit" disabled={busy || !file || phrase.trim().split(/\s+/).length !== 6}>{busy ? "Відкриваю…" : "Відкрити"}</button>
            <button className="btn quiet" type="button" onClick={props.onBack}>Скасувати</button>
          </div>
        </form>
      </section>
    );
  }

  const repeat = plan.before.apps + plan.before.notes > 0;
  return (
    <section className="card wide stack" style={{ gap: 14 }} aria-label="Що змінилося">
      <h2 style={{ margin: 0 }}>Що змінилося · {plan.from.name}</h2>
      <div className="panel stack" style={{ gap: 6, fontSize: 13 }}>
        <span>Фрагментів кодування: <b>{plan.apps.length}</b> · коментарів: <b>{Object.keys(plan.notes).length}</b> · нових кодів: <b>{plan.newCodes.length}</b></span>
        {plan.newCodes.length > 0 && <span className="small">Нові коди потраплять у «Без категорії»: {plan.newCodes.map((c) => `«${c.name}»`).join(", ")}.</span>}
        <span className="small">Кодування цієї людини стане окремою лінією з ініціалами {plan.from.initials}; ваше кодування не зміниться.</span>
        {repeat && <span className="small">Зміни цієї людини вже додавали раніше ({plan.before.apps} фрагм., {plan.before.notes} коментарів): їх замінять ці, новіші — нічого не подвоїться.</span>}
        {plan.unplaced > 0 && <span className="small accent">Не вдалося розмістити: {plan.unplaced} — ці репліки чи слова ви відтоді видалили.</span>}
      </div>
      {plan.renamed.length > 0 && (
        <fieldset className="stack" style={{ gap: 10, border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 6 }}>Коди, перейменовані по-різному — яку назву залишити?</legend>
          {plan.renamed.map((r) => (
            <div key={r.id} className="row" style={{ gap: 16, fontSize: 13 }} role="radiogroup" aria-label={`Код «${r.mine}»`}>
              <label className="check"><input type="radio" name={r.id} checked={!take.has(r.id)} onChange={() => setTake((t) => { const n = new Set(t); n.delete(r.id); return n; })} /><span>моя: «{r.mine}»</span></label>
              <label className="check"><input type="radio" name={r.id} checked={take.has(r.id)} onChange={() => setTake((t) => new Set(t).add(r.id))} /><span>{plan.from.initials}: «{r.theirs}»</span></label>
            </div>
          ))}
        </fieldset>
      )}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn primary" onClick={() => props.onMerge(applyMerge(props.shared, plan, take), `Додано зміни: ${plan.from.name}.`)}>Додати зміни</button>
        <button className="btn quiet" onClick={props.onBack}>Скасувати</button>
      </div>
    </section>
  );
}
