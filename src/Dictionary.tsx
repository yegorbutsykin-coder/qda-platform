import { useMemo, useState, type ReactNode } from "react";
import { formsFound, READY, wordKey, type DictEntry, type Kind, type Suspect } from "./text";
import { newId, pad, type Private, type Shared } from "./model";
import { Transcript } from "./Transcript";

const KINDS: [Kind, string][] = [["person", "людина"], ["place", "місце"], ["org", "установа"], ["other", "інше"]];
const kindName = (k: Kind) => KINDS.find((x) => x[0] === k)![1];
const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function Dictionary(props: {
  shared: Shared; priv: Private; sel: string; setSel: (id: string) => void; suspectsAll: Suspect[];
  commit: (s: Shared, p: Private) => void; undoable: (text: string, s: Shared, p: Private) => void; errorLine: ReactNode;
}) {
  const { shared, priv, commit, undoable } = props;
  const [kind, setKind] = useState<Kind>("person");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [scope, setScope] = useState("all");
  const [caps, setCaps] = useState(true);
  const [original, setOriginal] = useState(true);

  const texts = useMemo(
    () => shared.interviews.flatMap((iv) => (priv.originals[iv.id] ?? []).map((r) => ({ id: iv.id, text: r.text }))),
    [shared, priv],
  );
  const ivName = (id: string) => {
    const iv = shared.interviews.find((x) => x.id === id);
    return iv ? `інтерв'ю ${pad(iv.n)} · ${iv.card.pseudonym}` : "видалене інтерв'ю";
  };
  const forms = (e: DictEntry) => {
    const f = formsFound(e, texts);
    const list = Object.entries(f);
    return list.length ? list.map(([w, n]) => `${w} ×${n}`).join(" · ") : "не знайдено";
  };

  const draft: DictEntry = { id: "draft", kind, from: split(from), to, scope, caps };
  const duplicate = draft.from.find((w) => priv.dict.some((d) => d.scope === scope && d.from.some((x) => x.toLowerCase() === w.toLowerCase())));
  const missing = !draft.from.length ? "Впишіть, як слово написано в записі." : !to.trim() ? "Впишіть заміну." : duplicate ? `«${duplicate}» уже є в словнику для цієї області.` : "";
  const add = () => {
    if (missing) return;
    commit(shared, { ...priv, dict: [...priv.dict, { ...draft, id: newId(), to: to.trim() }] });
    setFrom(""); setTo("");
  };
  const update = (id: string, patch: Partial<DictEntry>) => commit(shared, { ...priv, dict: priv.dict.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const remove = (e: DictEntry) => undoable(`Заміну «${e.from.join(", ")}» видалено: слово знову видно в транскриптах.`, shared, { ...priv, dict: priv.dict.filter((d) => d.id !== e.id) });

  const toDict = (s: Suspect) => undoable(
    `«${s.word}» додано в словник як ${READY[s.kind][0]}.`, shared,
    { ...priv, dict: [...priv.dict, { id: newId(), kind: s.kind, from: [s.word], to: READY[s.kind][0], scope: "all", caps: true }] },
  );
  const leave = (s: Suspect) => undoable(`«${s.word}» залишено як є: колеги бачитимуть це слово.`, shared, { ...priv, ignored: [...priv.ignored, wordKey(s.word)] });

  const iv = shared.interviews.find((x) => x.id === props.sel) ?? shared.interviews[0];

  return (
    <div className="split">
      <section aria-label="Словник замін" style={{ gap: 18 }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Анонімізація</span>
          <span className="title">Словник замін</span>
          <span className="small">Один словник на весь проєкт. Діє в усіх транскриптах одразу; шукає й відмінкові форми (Оксана → Оксані, Оксаною).</span>
        </div>
        {props.errorLine}

        <div className="suspects">
          <span className="label" style={{ color: "var(--ink)" }}>Схоже на справжні імена чи місця · {props.suspectsAll.length}</span>
          {props.suspectsAll.length === 0 ? (
            <span className="small">Нових слів, схожих на імена чи місця, у транскриптах не знайдено.</span>
          ) : (
            props.suspectsAll.slice(0, 30).map((s) => (
              <div className="srow" key={s.key}>
                <span className="grow"><b>{s.word}</b> <span className="small">· {kindName(s.kind)}? · ×{s.count} · {s.interviews.map((id) => pad(shared.interviews.find((x) => x.id === id)?.n ?? 0)).join(", ")}</span></span>
                <button className="btn sm" onClick={() => toDict(s)}>У словник як {READY[s.kind][0]}</button>
                <button className="btn sm quiet" onClick={() => leave(s)}>Залишити як є</button>
              </div>
            ))
          )}
          <span className="small">Це підказка, а не перевірка: імена з малої літери, прізвиська й описи («та, що з аптеки») програма не помітить, тож транскрипт однаково варто прочитати.</span>
        </div>

        <div className="panel stack" style={{ gap: 12 }}>
          <span className="label">Нова заміна</span>
          <div className="row" role="group" aria-label="Тип" style={{ gap: 6 }}>
            {KINDS.map(([k, l]) => <button key={k} className={"pill" + (kind === k ? " on" : "")} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
          </div>
          <div className="grid2">
            <label className="field"><span>Як у записі</span>
              <input className="input" value={from} placeholder="Оксана, Ксюша" autoComplete="off" onChange={(e) => setFrom(e.target.value)} />
              <span className="small">Кілька написань — через кому.</span></label>
            <label className="field"><span>Заміна</span>
              <input className="input mono" value={to} onChange={(e) => setTo(e.target.value)} />
              <span className="row" style={{ gap: 4 }}>{READY[kind].map((r) => <button key={r} type="button" className="pill mono" onClick={() => setTo(r)}>{r}</button>)}</span></label>
          </div>
          <div className="row" style={{ gap: "8px 20px" }}>
            <label className="row" style={{ gap: 8, fontSize: 13 }}>Де замінювати
              <select className="input" style={{ height: 34, fontFamily: "inherit" }} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">усі інтерв'ю</option>
                {shared.interviews.map((x) => <option key={x.id} value={x.id}>лише {ivName(x.id)}</option>)}
              </select></label>
            <label className="check"><input type="checkbox" checked={caps} onChange={(e) => setCaps(e.target.checked)} /><span>Лише з великої літери</span></label>
          </div>
          {draft.from.length > 0 && <span className="small">Знайдено: {forms(draft)}</span>}
          <span className="small">Радимо заміну в квадратних дужках: її не треба відмінювати, і читач(ка) одразу бачить, що текст змінено. «Лише з великої літери» — для імен, що водночас є словами: Надія / надія, Віра / віра.</span>
          <div className="row">
            <button className="btn sm primary" disabled={!!missing} onClick={add}>Додати заміну</button>
            <span className="small">{missing}</span>
          </div>
        </div>

        <div className="stack" style={{ gap: 0 }}>
          <span className="label" style={{ marginBottom: 8 }}>Заміни · {priv.dict.length}</span>
          {priv.dict.map((d) => (
            <div className="drow" key={d.id}>
              <span className="small" style={{ minWidth: 64 }}>{kindName(d.kind)}</span>
              <input className="input" aria-label="Як у записі" defaultValue={d.from.join(", ")} onBlur={(e) => split(e.target.value).length && update(d.id, { from: split(e.target.value) })} />
              <span aria-hidden="true">→</span>
              <input className={"input mono" + (d.to.trim() ? "" : " empty-repl")} aria-label="Заміна" defaultValue={d.to} onBlur={(e) => update(d.id, { to: e.target.value })} />
              <button className="btn sm quiet" aria-label={`Видалити заміну ${d.from.join(", ")}`} onClick={() => remove(d)}>✕</button>
              <span className="small full">
                {d.scope === "all" ? "усі інтерв'ю" : `лише ${ivName(d.scope)}`} · {d.caps ? "з великої літери" : "будь-яка літера"} · {d.to.trim() ? forms(d) : <span className="bad" style={{ fontSize: 12 }}>заміна порожня: слово зараз видно всім</span>}
              </span>
            </div>
          ))}
        </div>

        <div className="panel small" style={{ lineHeight: 1.7 }}>
          <b style={{ color: "var(--ink)" }}>Хто що бачить.</b> Словник і оригінальний текст — лише власник(ця) проєкту. Колеги й супервайзер(ка) отримають транскрипти вже із замінами; цитати й експорт — завжди із замінами. Усе зберігається лише в зашифрованому файлі проєкту.
        </div>
      </section>

      {iv && (
        <aside style={{ flex: "1 1 420px", gap: 10 }} aria-label="Перегляд транскрипту">
          <div className="row">
            <select className="input" style={{ height: 32, fontFamily: "inherit", fontSize: 12 }} value={iv.id} onChange={(e) => props.setSel(e.target.value)}>
              {shared.interviews.map((x) => <option key={x.id} value={x.id}>{ivName(x.id)}</option>)}
            </select>
            <div className="seg" role="group" aria-label="Який текст показувати">
              <button aria-pressed={!original} onClick={() => setOriginal(false)}>Із замінами</button>
              <button aria-pressed={original} onClick={() => setOriginal(true)}>Оригінал</button>
            </div>
          </div>
          <Transcript iv={iv} priv={priv} original={original} flagged={new Set(props.suspectsAll.filter((s) => s.interviews.includes(iv.id)).map((s) => s.key))} />
        </aside>
      )}
    </div>
  );
}
