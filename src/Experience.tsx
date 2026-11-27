// The experience book of descriptive phenomenological analysis: sense units and their transformations,
// in the floating window (one interview) and as a full table (unit → step 1 → step 2 → …).
import { Fragment } from "react";
import { unitText, type Dfa, type Unit } from "./dfa";
import type { DictEntry } from "./text";
import type { Interview } from "./model";

type Rep = { role: string | null; text: string };
export type BookProps = {
  dfa: Dfa; units: Unit[]; reps: Rep[]; dict: DictEntry[]; iv: string; ro: boolean;
  focus: string | null; pick: (unit: string | null) => void; setTr: (unit: string, step: number, text: string) => void; toText: (u: Unit) => void;
};

const cell = (d: Dfa, u: string, k: number) => d.tr[u]?.[k] ?? "";
const short = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

/** One step's field; saved when the cursor leaves it. */
function StepField(p: { d: Dfa; u: string; k: number; ro: boolean; rows: number; label?: string; setTr: BookProps["setTr"] }) {
  const v = cell(p.d, p.u, p.k);
  return (
    <textarea key={p.u + p.k + v} className="input" rows={p.rows} defaultValue={v} readOnly={p.ro} aria-label={p.label ?? p.d.steps[p.k]}
      onBlur={(e) => e.target.value !== v && p.setTr(p.u, p.k, e.target.value)} />
  );
}

/** In the floating window: this interview's units; the one clicked opens its steps right under it. */
export function UnitList(p: BookProps & { openTable: () => void }) {
  if (!p.units.length) return <span className="small">У цьому інтерв'ю ще немає тексту учасника(ці): позначте мовців у «Редагувати текст».</span>;
  return (
    <>
      <span className="small">Одиниць: {p.units.length}. Межа — клік на слово в транскрипті; клік на одиницю — її трансформації.</span>
      {p.units.map((u) => {
        const t = unitText(u, p.reps, p.dict, p.iv), on = p.focus === u.id;
        const done = p.dfa.steps.filter((_, k) => cell(p.dfa, u.id, k).trim()).length;
        return (
          <Fragment key={u.id}>
            <button className={"coderow" + (on ? " on" : "")} aria-pressed={on} aria-expanded={on} onClick={() => p.pick(on ? null : u.id)}>
              <span className="unitno static" aria-hidden="true">{u.n}</span>
              <span className="grow">{short(t, 90)}</span>
              <span className="mono small" title="Заповнено кроків трансформації">{done}/{p.dfa.steps.length}</span>
            </button>
            {on && (
              <div className="cbcard">
                <p className="mono" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>«{t}»</p>
                {p.dfa.steps.map((name, k) => (
                  <label key={k} className="field"><span className="label">{name}</span>
                    <StepField d={p.dfa} u={u.id} k={k} ro={p.ro} rows={3} setTr={p.setTr} /></label>
                ))}
                <div className="row" style={{ gap: 8 }}>
                  <button className="link" style={{ fontSize: 12 }} onClick={() => p.toText(u)}>У тексті →</button>
                  <button className="btn sm" onClick={p.openTable}>Таблиця трансформацій →</button>
                </div>
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/** The whole book of one interview: unit → step 1 → step 2 → …; steps are added, renamed and removed here. */
export function DfaTable(p: BookProps & {
  interviews: Interview[]; setIv: (id: string) => void; onBack: () => void;
  renameStep: (k: number, name: string) => void; addStep: () => void; dropStep: (k: number) => void;
}) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <section className="stack" style={{ gap: 14 }} aria-label="Досвідна книга">
      <div className="row" style={{ gap: 12 }}>
        <span className="title grow">Досвідна книга</span>
        <button className="btn sm" onClick={p.onBack}>← До транскрипту</button>
      </div>
      <span className="small">Дескриптивний феноменологічний аналіз: сенсові одиниці кожного опису й їхня феноменологічна трансформація, крок за кроком. Кроки — це колонки: додайте стільки, скільки потрібно, і назвіть їх (напр., «Мовою дослідника(ці)», «Психологічно чутлива»). Текст одиниць — із замінами зі словника.</span>
      <div className="seg" role="group" aria-label="Інтерв'ю" style={{ flexWrap: "wrap" }}>
        {p.interviews.map((x) => <button key={x.id} aria-pressed={x.id === p.iv} onClick={() => p.setIv(x.id)}>{pad(x.n)} · {x.card.pseudonym}</button>)}
      </div>
      {!p.units.length ? <span className="small">У цьому інтерв'ю ще немає тексту учасника(ці).</span> : (
        <div className="dfawrap">
          <table className="dfatable">
            <thead>
              <tr>
                <th style={{ width: 36 }}>№</th>
                <th>Сенсова одиниця</th>
                {p.dfa.steps.map((name, k) => (
                  <th key={k}>
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      <input key={name} className="input stepname" defaultValue={name} readOnly={p.ro} aria-label={`Назва кроку ${k + 1}`}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== name) p.renameStep(k, v); else e.target.value = name; }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                      {!p.ro && p.dfa.steps.length > 1 && <button className="x" onClick={() => p.dropStep(k)} aria-label={`Прибрати крок «${name}»`}>×</button>}
                    </div>
                  </th>
                ))}
                {!p.ro && <th style={{ width: 120 }}><button className="btn sm" onClick={p.addStep}>+ Крок</button></th>}
              </tr>
            </thead>
            <tbody>
              {p.units.map((u) => (
                <tr key={u.id} className={p.focus === u.id ? "on" : ""}>
                  <td className="mono">{u.n}</td>
                  <td className="mono unitcell">
                    {unitText(u, p.reps, p.dict, p.iv)}
                    <button className="link" style={{ fontSize: 12, display: "block", marginTop: 4 }} onClick={() => p.toText(u)}>У тексті →</button>
                  </td>
                  {p.dfa.steps.map((name, k) => (
                    <td key={k}><StepField d={p.dfa} u={u.id} k={k} ro={p.ro} rows={4} setTr={p.setTr} label={`Одиниця ${u.n}: ${name}`} /></td>
                  ))}
                  {!p.ro && <td />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
