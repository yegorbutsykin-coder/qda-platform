import { useState } from "react";
import { CAT_COLORS, LEVELS, mergeCodes, type Cat, type Code, type Levels, type Super } from "./coding";
import { newId, type Private, type Shared } from "./model";

type Edit = { kind: "cat" | "sup"; id: string; what: "name" | "color" | "desc" | "move" } | null;

function Colors(props: { value: string; set: (c: string) => void }) {
  return (
    <div className="row" role="group" aria-label="Колір" style={{ gap: 6 }}>
      {CAT_COLORS.map((c) => (
        <button key={c} type="button" className={"swbtn" + (props.value === c ? " on" : "")} style={{ background: c }} aria-label={`Колір ${c}`} aria-pressed={props.value === c} onClick={() => props.set(c)} />
      ))}
      <label className={"swbtn plus" + (CAT_COLORS.includes(props.value) ? "" : " on")} title="Будь-який колір" style={CAT_COLORS.includes(props.value) ? {} : { background: props.value }}>
        <span aria-hidden="true">+</span>
        <input type="color" value={props.value} aria-label="Обрати будь-який колір зі спектра" onChange={(e) => props.set(e.target.value.toUpperCase())} />
      </label>
    </div>
  );
}

export default function CodesPanel(props: {
  shared: Shared; priv: Private; method: string;
  commit: (s: Shared, p: Private) => void; undoable: (text: string, s: Shared, p: Private) => void;
  showFragments: (codeId: string) => void;
}) {
  const { shared, priv, commit, undoable } = props;
  const levels: Levels = shared.levels ?? LEVELS[props.method] ?? LEVELS[""];
  const [picking, setPicking] = useState(false);
  const [pickedCodes, setPickedCodes] = useState<string[]>([]);
  const [pickedCats, setPickedCats] = useState<string[]>([]);
  const [action, setAction] = useState<"cat" | "merge" | "sup">("cat");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState(CAT_COLORS[0]);
  const [into, setInto] = useState("");
  const [keep, setKeep] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit>(null);
  const [val, setVal] = useState("");
  const [folded, setFolded] = useState<string[]>([]);
  const [levelsOpen, setLevelsOpen] = useState(false);

  const count = (codeId: string) => shared.apps.filter((a) => a.code === codeId).length;
  const codesOf = (cat?: string) => shared.codes.filter((c) => (c.cat ?? "") === (cat ?? "") || (cat === undefined && c.cat && !shared.cats.some((k) => k.id === c.cat))).sort((a, b) => a.name.localeCompare(b.name, "uk"));
  const total = (cat: string) => codesOf(cat).reduce((n, c) => n + count(c.id), 0);
  const save = (s: Partial<Shared>) => commit({ ...shared, ...s }, priv);
  const stop = () => { setPicking(false); setAction("cat"); setPickedCodes([]); setPickedCats([]); setName(""); setDesc(""); setInto(""); setKeep(""); };
  const toggle = (list: string[], set: (l: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  // ----- actions on picked -----
  const canCat = pickedCodes.length >= 1, canMerge = pickedCodes.length >= 2, canSup = pickedCats.length >= 1;
  const act = canCat && action === "cat" ? "cat" : canMerge && action === "merge" ? "merge" : canSup && action === "sup" ? "sup" : canCat ? "cat" : canSup ? "sup" : null;
  const toCategory = () => {
    let cats = shared.cats, target = into;
    if (!target) {
      if (!name.trim()) return;
      const c: Cat = { id: newId(), name: name.trim(), color };
      cats = [...cats, c]; target = c.id;
    }
    save({ cats, codes: shared.codes.map((c) => (pickedCodes.includes(c.id) ? { ...c, cat: target } : c)) });
    stop();
  };
  const merge = () => {
    const k = keep || pickedCodes[0];
    const finalName = name.trim() || shared.codes.find((c) => c.id === k)!.name;
    const r = mergeCodes(shared.codes, shared.apps, pickedCodes, k, finalName);
    undoable(`${pickedCodes.length} коди об'єднано в «${finalName}».`, { ...shared, ...r }, priv);
    stop();
  };
  const toSuper = () => {
    let supers = shared.supers, target = into;
    if (!target) {
      if (!name.trim()) return;
      const s: Super = { id: newId(), name: name.trim(), desc: desc.trim() };
      supers = [...supers, s]; target = s.id;
    }
    save({ supers, cats: shared.cats.map((c) => (pickedCats.includes(c.id) ? { ...c, sup: target } : c)) });
    stop();
  };

  // ----- menus -----
  const startEdit = (e: Edit, v: string) => { setMenu(null); setEdit(e); setVal(v); };
  const saveEdit = () => {
    if (!edit) return;
    if (edit.kind === "cat") {
      const patch = edit.what === "name" ? { name: val.trim() } : edit.what === "color" ? { color: val } : { sup: val || undefined };
      if (edit.what === "name" && !val.trim()) return;
      save({ cats: shared.cats.map((c) => (c.id === edit.id ? { ...c, ...patch } : c)) });
    } else {
      if (edit.what === "name" && !val.trim()) return;
      save({ supers: shared.supers.map((s) => (s.id === edit.id ? { ...s, [edit.what === "name" ? "name" : "desc"]: val.trim() } : s)) });
    }
    setEdit(null);
  };
  const disbandCat = (c: Cat) => {
    setMenu(null);
    undoable(`«${c.name}» розформовано: коди перейшли в «Без категорії».`,
      { ...shared, cats: shared.cats.filter((x) => x.id !== c.id), codes: shared.codes.map((k) => (k.cat === c.id ? { ...k, cat: undefined } : k)) }, priv);
  };
  const disbandSup = (s: Super) => {
    setMenu(null);
    undoable(`«${s.name}» розформовано: категорії лишилися.`,
      { ...shared, supers: shared.supers.filter((x) => x.id !== s.id), cats: shared.cats.map((c) => (c.sup === s.id ? { ...c, sup: undefined } : c)) }, priv);
  };

  const editor = (e: NonNullable<Edit>) => edit && edit.id === e.id && edit.kind === e.kind && edit.what === e.what;

  const catBlock = (c: Cat) => (
    <div className="catblock" key={c.id}>
      <div className="cathead" style={{ background: c.color }}>
        {picking && <input type="checkbox" checked={pickedCats.includes(c.id)} aria-label={`Обрати «${c.name}»`} onChange={() => toggle(pickedCats, setPickedCats, c.id)} />}
        <span className="grow">{c.name}</span>
        <span className="mono" style={{ fontSize: 11 }}>{total(c.id)}</span>
        <button className="menubtn" aria-label={`Дії з «${c.name}»`} aria-expanded={menu === c.id} onClick={() => setMenu(menu === c.id ? null : c.id)}>⋯</button>
        {menu === c.id && (
          <div className="menu" role="menu">
            <button role="menuitem" onClick={() => startEdit({ kind: "cat", id: c.id, what: "name" }, c.name)}>Перейменувати</button>
            <button role="menuitem" onClick={() => startEdit({ kind: "cat", id: c.id, what: "color" }, c.color)}>Змінити колір</button>
            <button role="menuitem" onClick={() => startEdit({ kind: "cat", id: c.id, what: "move" }, c.sup ?? "")}>Перенести в рівень «{levels.top}»…</button>
            <button role="menuitem" className="danger" onClick={() => disbandCat(c)}>Розформувати</button>
          </div>
        )}
      </div>
      {editor({ kind: "cat", id: c.id, what: "name" }) && (
        <div className="row inl"><input className="input grow" autoFocus value={val} aria-label="Нова назва" onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
          <button className="btn sm primary" onClick={saveEdit}>Зберегти</button><button className="x" aria-label="Скасувати" onClick={() => setEdit(null)}>✕</button></div>
      )}
      {editor({ kind: "cat", id: c.id, what: "color" }) && (
        <div className="row inl"><Colors value={val} set={setVal} /><button className="btn sm primary" onClick={saveEdit}>Готово</button></div>
      )}
      {editor({ kind: "cat", id: c.id, what: "move" }) && (
        <div className="row inl">
          <select className="input grow" style={{ height: 32 }} value={val} onChange={(e) => setVal(e.target.value)} aria-label={levels.top}>
            <option value="">— не входить —</option>
            {shared.supers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn sm primary" onClick={saveEdit}>Зберегти</button>
          {!shared.supers.length && <span className="small">Новий рівень «{levels.top}» створюють через «Обрати».</span>}
        </div>
      )}
      {codesOf(c.id).map(codeRow)}
    </div>
  );

  const codeRow = (k: Code) => (
    <button key={k.id} className="coderow" aria-pressed={picking ? pickedCodes.includes(k.id) : undefined}
      onClick={() => (picking ? toggle(pickedCodes, setPickedCodes, k.id) : props.showFragments(k.id))}>
      {picking && <span className={"box" + (pickedCodes.includes(k.id) ? " on" : "")} aria-hidden="true">{pickedCodes.includes(k.id) ? "✓" : ""}</span>}
      <span className="sw" style={{ background: k.color }} aria-hidden="true" />
      <span className="grow">{k.name}</span>
      <span className="mono small">{count(k.id)}</span>
    </button>
  );

  const loose = shared.cats.filter((c) => !c.sup || !shared.supers.some((s) => s.id === c.sup));
  const noCat = codesOf(undefined);

  return (
    <div className="stack codespanel" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="label">Коди й категорії · {shared.codes.length}</span>
        <button className={"btn sm" + (picking ? " primary" : "")} onClick={() => { if (picking) stop(); else { setPicking(true); setColor(CAT_COLORS.find((c) => !shared.cats.some((k) => k.color === c)) ?? CAT_COLORS[shared.cats.length % CAT_COLORS.length]); } }}>{picking ? "Готово" : "Обрати"}</button>
      </div>
      <button className="link" style={{ fontSize: 12, alignSelf: "flex-start", minHeight: 0, textAlign: "left" }} onClick={() => setLevelsOpen(!levelsOpen)}>Назви рівнів: {levels.top} / {levels.mid}</button>
      {levelsOpen && (
        <div className="panel stack" style={{ gap: 8 }}>
          <label className="field"><span className="small">Верхній рівень</span><input className="input" style={{ height: 34 }} value={levels.top} onChange={(e) => save({ levels: { ...levels, top: e.target.value } })} /></label>
          <label className="field"><span className="small">Середній рівень</span><input className="input" style={{ height: 34 }} value={levels.mid} onChange={(e) => save({ levels: { ...levels, mid: e.target.value } })} /></label>
          <div className="row" style={{ gap: 4 }}>
            {Object.entries(LEVELS).map(([m, l]) => <button key={m || "std"} className="pill" onClick={() => save({ levels: l })}>{m || "Стандарт"}</button>)}
          </div>
        </div>
      )}
      {!shared.codes.length && <span className="small">Кодів ще немає. Виділіть фрагмент у транскрипті й назвіть код.</span>}

      {shared.supers.map((s) => (
        <div className="supblock" key={s.id}>
          <div className="suphead">
            <button className="fold" aria-expanded={!folded.includes(s.id)} aria-label={folded.includes(s.id) ? "Розгорнути" : "Згорнути"} onClick={() => toggle(folded, setFolded, s.id)}>{folded.includes(s.id) ? "▸" : "▾"}</button>
            <span className="grow stack" style={{ gap: 0 }}><b>{s.name}</b>{s.desc && <span className="small">{s.desc}</span>}</span>
            <button className="menubtn" aria-label={`Дії з «${s.name}»`} aria-expanded={menu === s.id} onClick={() => setMenu(menu === s.id ? null : s.id)}>⋯</button>
            {menu === s.id && (
              <div className="menu" role="menu">
                <button role="menuitem" onClick={() => startEdit({ kind: "sup", id: s.id, what: "name" }, s.name)}>Перейменувати</button>
                <button role="menuitem" onClick={() => startEdit({ kind: "sup", id: s.id, what: "desc" }, s.desc)}>Змінити опис</button>
                <button role="menuitem" className="danger" onClick={() => disbandSup(s)}>Розформувати</button>
              </div>
            )}
          </div>
          {(editor({ kind: "sup", id: s.id, what: "name" }) || editor({ kind: "sup", id: s.id, what: "desc" })) && (
            <div className="row inl"><input className="input grow" autoFocus value={val} aria-label={edit!.what === "name" ? "Нова назва" : "Опис"} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
              <button className="btn sm primary" onClick={saveEdit}>Зберегти</button><button className="x" aria-label="Скасувати" onClick={() => setEdit(null)}>✕</button></div>
          )}
          {!folded.includes(s.id) && shared.cats.filter((c) => c.sup === s.id).map(catBlock)}
        </div>
      ))}
      {loose.map(catBlock)}
      {noCat.length > 0 && (
        <div className="catblock">
          <div className="cathead nocat"><span className="grow">Без категорії</span><span className="mono" style={{ fontSize: 11 }}>{noCat.reduce((n, c) => n + count(c.id), 0)}</span></div>
          {noCat.map(codeRow)}
        </div>
      )}

      {picking && (
        <div className="pickbar">
          <span className="small">Обрано кодів: {pickedCodes.length} · категорій: {pickedCats.length}</span>
          <div className="seg" role="group" aria-label="Що зробити з обраними">
            <button disabled={!canCat} aria-pressed={act === "cat"} onClick={() => setAction("cat")}>У категорію</button>
            <button disabled={!canMerge} aria-pressed={act === "merge"} onClick={() => setAction("merge")}>Об'єднати коди</button>
            <button disabled={!canSup} aria-pressed={act === "sup"} onClick={() => setAction("sup")}>Рівень «{levels.top}»</button>
          </div>
          {!act && <span className="small">Позначте коди (для категорії чи злиття) або категорії (для рівня «{levels.top}»).</span>}
          {act === "cat" && (
            <>
              <label className="field"><span className="small">Назва нової категорії (рівень «{levels.mid}»)</span>
                <input className="input" style={{ height: 34 }} value={name} disabled={!!into} placeholder="Напр.: Час, що зупинився" onChange={(e) => setName(e.target.value)} /></label>
              {!into && <Colors value={color} set={setColor} />}
              {shared.cats.length > 0 && (
                <label className="field"><span className="small">…або до наявної</span>
                  <select className="input" style={{ height: 34 }} value={into} onChange={(e) => setInto(e.target.value)}>
                    <option value="">— нова —</option>{shared.cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></label>
              )}
              <button className="btn sm primary" disabled={!into && !name.trim()} onClick={toCategory}>Об'єднати в категорію</button>
            </>
          )}
          {act === "merge" && (
            <>
              <span className="label">Яку назву залишити</span>
              {pickedCodes.map((id) => {
                const c = shared.codes.find((x) => x.id === id)!;
                return (
                  <label key={id} className="row" style={{ gap: 8, fontSize: 13, flexWrap: "nowrap" }}>
                    <input type="radio" name="keep" checked={(keep || pickedCodes[0]) === id} onChange={() => setKeep(id)} />
                    <span className="sw" style={{ background: c.color }} aria-hidden="true" /><span className="grow">{c.name}</span><span className="mono small">{count(id)}</span>
                  </label>
                );
              })}
              <label className="field"><span className="small">…або нова назва</span><input className="input" style={{ height: 34 }} value={name} placeholder="Залиште порожнім, щоб узяти обрану" onChange={(e) => setName(e.target.value)} /></label>
              <span className="small">Усі фрагменти, нотатки й кодування всіх дослідників(ць) перейдуть до об'єднаного коду.</span>
              <button className="btn sm primary" onClick={merge}>Об'єднати {pickedCodes.length} коди</button>
            </>
          )}
          {act === "sup" && (
            <>
              <label className="field"><span className="small">Назва (рівень «{levels.top}»)</span>
                <input className="input" style={{ height: 34 }} value={name} disabled={!!into} onChange={(e) => setName(e.target.value)} /></label>
              <label className="field"><span className="small">Короткий опис</span>
                <input className="input" style={{ height: 34 }} value={desc} disabled={!!into} onChange={(e) => setDesc(e.target.value)} /></label>
              {shared.supers.length > 0 && (
                <label className="field"><span className="small">…або до наявної</span>
                  <select className="input" style={{ height: 34 }} value={into} onChange={(e) => setInto(e.target.value)}>
                    <option value="">— нова —</option>{shared.supers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></label>
              )}
              <button className="btn sm primary" disabled={!into && !name.trim()} onClick={toSuper}>Зберегти</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
