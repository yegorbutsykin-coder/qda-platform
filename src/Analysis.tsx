// Stage 4: the visual analysis window. Figures are SVG drawn here, so they work offline and can be saved.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { agreement, byPerson, codesByCategory, matrix, saturationCurve, saturationWords } from "./analysis";
import type { Code } from "./coding";
import { initialsOf, pad, type Shared } from "./model";

type Tool = "matrix" | "cooc" | "tree" | "strip" | "saturation" | "agreement" | "people" | "tone" | "time" | "kwic" | "groups";
const GROUPS: { title: string; tools: { id: Tool; name: string; step?: string }[] }[] = [
  { title: "Як влаштовані теми", tools: [{ id: "matrix", name: "Матриця «код × учасник(ця)»" }, { id: "cooc", name: "Спільна поява кодів", step: "4.2" }, { id: "tree", name: "Ієрархія категорій", step: "4.2" }] },
  { title: "Як розгортається розповідь", tools: [{ id: "strip", name: "Смуга інтерв'ю", step: "4.2" }, { id: "saturation", name: "Сатурація" }] },
  { title: "Спільне кодування", tools: [{ id: "agreement", name: "Збіг бачення" }, { id: "people", name: "Дослідник(ця) × код" }] },
  { title: "Мова учасників(ць)", tools: [{ id: "tone", name: "Емоційне забарвлення", step: "4.3" }, { id: "time", name: "Час і займенники", step: "4.3" }, { id: "kwic", name: "Слова в контексті", step: "4.3" }] },
  { title: "Порівняння груп", tools: [{ id: "groups", name: "Характеристики учасників(ць)", step: "4.4" }] },
];
const FONT = "Inter, Helvetica, Arial, sans-serif";
const INK = "#1E1E1C", MUTED = "#5F5D58", LINE = "#DCD9D1", LOOSE = "#9A968E";

/** Rows of codes grouped by category × columns; darker = more. */
function Heat(props: { groups: { cat: { name: string; color: string } | null; codes: Code[] }[]; cols: { id: string; label: string }[]; value: (code: string, col: string) => number; title: string }) {
  const { groups, cols } = props;
  const LW = 190, CW = 40, RH = 22, TOP = 96;
  const max = Math.max(1, ...groups.flatMap((g) => g.codes.flatMap((c) => cols.map((k) => props.value(c.id, k.id)))));
  let y = TOP;
  const rows: ReactNode[] = [];
  for (const g of groups) {
    rows.push(<g key={"g" + (g.cat?.name ?? "-")}>
      <rect x={0} y={y + 6} width={10} height={10} fill={g.cat?.color ?? LOOSE} />
      <text x={16} y={y + 15} fontSize={12} fontWeight={600} fill={INK}>{g.cat?.name ?? "Без категорії"}</text>
    </g>);
    y += RH;
    for (const c of g.codes) {
      rows.push(<g key={c.id}>
        <text x={16} y={y + 15} fontSize={12} fill={INK}>{c.name.length > 26 ? c.name.slice(0, 25) + "…" : c.name}</text>
        {cols.map((k, j) => {
          const v = props.value(c.id, k.id);
          const t = v / max;
          return <g key={k.id}>
            <rect x={LW + j * CW + 1} y={y + 1} width={CW - 2} height={RH - 2} fill={v ? INK : "none"} fillOpacity={v ? 0.12 + 0.88 * t : 0} stroke={LINE} />
            {v > 0 && <text x={LW + j * CW + CW / 2} y={y + 15} fontSize={11} textAnchor="middle" fill={t > 0.5 ? "#fff" : INK}>{v}</text>}
          </g>;
        })}
      </g>);
      y += RH;
    }
  }
  const W = LW + cols.length * CW + 90; // room for the slanted labels
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={W} height={y + 10} viewBox={`0 0 ${W} ${y + 10}`} fontFamily={FONT} role="img" aria-label={props.title}>
      <rect width={W} height={y + 10} fill="#fff" />
      {cols.map((k, j) => (
        <text key={k.id} transform={`translate(${LW + j * CW + CW / 2 + 4},${TOP - 6}) rotate(-50)`} fontSize={11} fill={INK}>{k.label}</text>
      ))}
      {rows}
    </svg>
  );
}

/** «Зберегти рисунок…»: the SVG as it is, or a PNG three times the screen size (≈ 300 dpi when printed at screen size). */
async function saveFigure(svg: SVGSVGElement, name: string): Promise<string> {
  const path = await save({ title: "Зберегти рисунок", defaultPath: `${name}.svg`, filters: [{ name: "SVG (векторний)", extensions: ["svg"] }, { name: "PNG", extensions: ["png"] }] });
  if (!path) return "";
  const text = new XMLSerializer().serializeToString(svg);
  if (path.toLowerCase().endsWith(".png")) {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
    const k = 3, c = document.createElement("canvas");
    c.width = svg.width.baseVal.value * k; c.height = svg.height.baseVal.value * k;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    await invoke("save_figure", { path, png: c.toDataURL("image/png").split(",")[1] });
  } else {
    await invoke("save_figure", { path: path.toLowerCase().endsWith(".svg") ? path : path + ".svg", svg: `<?xml version="1.0" encoding="UTF-8"?>\n${text}` });
  }
  return path.split(/[\\/]/).pop() ?? path;
}

export default function Analysis(props: { shared: Shared; me: string; onBack: () => void }) {
  const s = props.shared;
  const [tool, setTool] = useState<Tool>("matrix");
  const [ivs, setIvs] = useState<Set<string>>(() => new Set(s.interviews.map((x) => x.id)));
  const [whose, setWhose] = useState("all");
  const [saved, setSaved] = useState("");
  const fig = useRef<HTMLDivElement>(null);
  const coders = [...new Set(s.apps.map((a) => a.by))];
  const order = s.interviews.filter((x) => ivs.has(x.id));
  const apps = useMemo(() => s.apps.filter((a) => ivs.has(a.iv) && (whose === "all" || a.by === whose)), [s.apps, ivs, whose]);
  const used = new Set(apps.map((a) => a.code));
  const groups = codesByCategory(s.codes.filter((c) => used.has(c.id)), s.cats);
  const catOf = (id: string) => s.cats.find((k) => k.id === s.codes.find((c) => c.id === id)?.cat);
  const name = (id: string) => s.codes.find((c) => c.id === id)?.name ?? "?";
  const label = (x: { n: number; card: { pseudonym: string } }) => `${pad(x.n)} ${x.card.pseudonym}`;
  const toolName = GROUPS.flatMap((g) => g.tools).find((t) => t.id === tool)!.name;

  async function doSave() {
    const svg = fig.current?.querySelector("svg");
    if (!svg) return;
    try { const f = await saveFigure(svg, toolName.replace(/[«»"\\/:*?<>|]/g, "")); if (f) setSaved(`Збережено: ${f}`); }
    catch (e) { setSaved(`Не вдалося зберегти рисунок: ${e}`); }
  }

  let body: ReactNode = null;
  let note: ReactNode = null;
  if (tool === "matrix") {
    const m = matrix(apps);
    body = groups.length ? <Heat title={toolName} groups={groups} cols={order.map((x) => ({ id: x.id, label: label(x) }))} value={(c, iv) => m.get(c)?.get(iv) ?? 0} /> : null;
    note = <>Число в клітинці — кількість фрагментів із цим кодом в інтерв'ю. У рефлексивному ТА й ІФА частота не є мірилом важливості теми: матриця показує, де шукати, а не що важливо.</>;
  }
  if (tool === "saturation") {
    const curve = saturationCurve(order.map((x) => x.id), apps);
    const n = curve.length, CW = 44, L = 40, H1 = 150, H2 = 120, GAP = 46;
    const maxNew = Math.max(1, ...curve.map((c) => c.fresh.length));
    const maxTot = Math.max(1, ...curve.map((c) => c.total));
    const W = Math.max(L + n * CW + 20, 420), H = 24 + H1 + GAP + H2 + 52;
    const x = (i: number) => L + i * CW + CW / 2;
    const y2 = (v: number) => 24 + H1 + GAP + H2 - (v / maxTot) * (H2 - 16);
    body = n ? (
      <svg xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT} role="img" aria-label={toolName}>
        <rect width={W} height={H} fill="#fff" />
        <text x={0} y={14} fontSize={12} fontWeight={600} fill={INK}>Нові коди в кожному інтерв'ю</text>
        {curve.map((c, i) => {
          let top = 24 + H1;
          const unit = (H1 - 18) / maxNew;
          return <g key={c.iv}>
            {c.fresh.map((code) => { top -= unit; return <rect key={code} x={x(i) - 13} y={top} width={26} height={unit - 1} fill={catOf(code)?.color ?? LOOSE}><title>{name(code)}</title></rect>; })}
            <text x={x(i)} y={top - 4} fontSize={11} textAnchor="middle" fill={INK}>{c.fresh.length}</text>
          </g>;
        })}
        <line x1={L - 6} x2={W - 10} y1={24 + H1} y2={24 + H1} stroke={LINE} />
        <text x={0} y={24 + H1 + GAP - 10} fontSize={12} fontWeight={600} fill={INK}>Накопичено кодів</text>
        <polyline points={curve.map((c, i) => `${x(i)},${y2(c.total)}`).join(" ")} fill="none" stroke={INK} strokeWidth={1.5} />
        {curve.map((c, i) => <g key={c.iv}><circle cx={x(i)} cy={y2(c.total)} r={3} fill={INK} /><text x={x(i)} y={y2(c.total) - 8} fontSize={11} textAnchor="middle" fill={INK}>{c.total}</text></g>)}
        <line x1={L - 6} x2={W - 10} y1={24 + H1 + GAP + H2} y2={24 + H1 + GAP + H2} stroke={LINE} />
        {[...s.cats.filter((k) => curve.some((c) => c.fresh.some((f) => catOf(f)?.id === k.id))), ...(curve.some((c) => c.fresh.some((f) => !catOf(f))) ? [{ id: "-", name: "без категорії", color: LOOSE }] : [])].map((k, i) => (
          <g key={k.id}><rect x={L + i * 130} y={H - 17} width={9} height={9} fill={k.color} /><text x={L + i * 130 + 13} y={H - 9} fontSize={10} fill={MUTED}>{k.name.length > 18 ? k.name.slice(0, 17) + "…" : k.name}</text></g>
        ))}
        {order.map((v, i) => <text key={v.id} x={x(i)} y={H - 28} fontSize={11} textAnchor="middle" fill={MUTED}>{pad(v.n)}</text>)}
      </svg>
    ) : null;
    note = <>
      <b>{saturationWords(curve, order.map((v) => pad(v.n)), s.satN ?? 3)}</b><br />
      {curve.filter((c) => c.fresh.length).map((c) => { const v = order.find((x) => x.id === c.iv)!; return <span key={c.iv}>{pad(v.n)} — {c.fresh.map((f) => `«${name(f)}»`).join(", ")}<br /></span>; })}
      Колір частини стовпчика — категорія коду. Сатурація — поняття з обґрунтованої теорії; для РТА та ІФА її застосовність критикують, тож крива — допоміжний інструмент, а не критерій достатності вибірки.
    </>;
  }
  if (tool === "agreement") {
    const g = agreement(apps.filter(() => whose === "all"));
    const rows = groups.flatMap((x) => x.codes).filter((c) => g.has(c.id));
    const LW = 190, BW = 320, RH = 24, W = LW + BW + 90, H = 40 + rows.length * RH + 10;
    body = coders.length < 2 ? <span className="small">Збіг бачення має сенс, коли кодують двоє й більше. Зараз у проєкті кодування однієї людини.</span>
      : whose !== "all" ? <span className="small">Цей інструмент порівнює кодування кількох людей — оберіть угорі «Усіх».</span>
      : (
        <svg xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT} role="img" aria-label={toolName}>
          <rect width={W} height={H} fill="#fff" />
          {([["3 і більше", INK], ["двоє", "#8A877F"], ["один(на)", "#D5D2CA"]] as const).map(([t, c], i) => <g key={t}><rect x={LW + i * 110} y={6} width={10} height={10} fill={c} /><text x={LW + i * 110 + 15} y={15} fontSize={11} fill={INK}>{t}</text></g>)}
          {rows.map((c, i) => {
            const r = g.get(c.id)!, total = r.three + r.two + r.one, y = 34 + i * RH;
            let x0 = LW;
            return <g key={c.id}>
              <text x={0} y={y + 14} fontSize={12} fill={INK}>{c.name.length > 26 ? c.name.slice(0, 25) + "…" : c.name}</text>
              {([[r.three, INK], [r.two, "#8A877F"], [r.one, "#D5D2CA"]] as const).map(([v, col], k) => { const w = (v / total) * BW; const el = <rect key={k} x={x0} y={y + 3} width={w} height={RH - 8} fill={col} />; x0 += w; return el; })}
              <text x={LW + BW + 8} y={y + 14} fontSize={11} fill={MUTED}>{r.three}·{r.two}·{r.one}</text>
            </g>;
          })}
        </svg>
      );
    note = <>Фрагмент — той самий код на словах, що перекриваються, хоч від кого. Частка показує, скількома людьми фрагмент позначено. Це привід для розмови про різні прочитання, а не показник надійності: Браун і Кларк відмовляються від згоди кодувальників(ць) як критерію якості в рефлексивному ТА.</>;
  }
  if (tool === "people") {
    const r = byPerson(s.apps.filter((a) => ivs.has(a.iv)));
    const allGroups = codesByCategory(s.codes.filter((c) => s.apps.some((a) => a.code === c.id && ivs.has(a.iv))), s.cats);
    body = coders.length < 2 ? <span className="small">Тут з'явиться порівняння, коли в проєкті кодуватимуть двоє й більше.</span> : (
      <div className="stack" style={{ gap: 14 }}>
        <Heat title={toolName} groups={allGroups} cols={coders.map((c) => ({ id: c, label: `${initialsOf(s, c)} ${s.people?.[c]?.name ?? ""}`.trim() }))} value={(code, p) => r.counts.get(p)?.get(code) ?? 0} />
        {r.solo.size > 0 && <div className="panel" style={{ fontSize: 13, lineHeight: 1.7 }}><b>Коди лише однієї людини</b> — привід обговорити, чи бачать це інші: {[...r.solo].map(([c, p]) => `«${name(c)}» (${initialsOf(s, p)})`).join(", ")}.</div>}
      </div>
    );
    note = <>Число — кількість фрагментів, які людина позначила цим кодом. Фільтр «чиє кодування» тут не діє: інструмент і є порівнянням людей.</>;
  }

  return (
    <div className="analysis">
      <nav className="atools" aria-label="Інструменти візуального аналізу">
        <button className="link" style={{ fontSize: 12, alignSelf: "flex-start" }} onClick={props.onBack}>← До транскрипту</button>
        {GROUPS.map((g) => (
          <div key={g.title} className="stack" style={{ gap: 2 }}>
            <span className="label" style={{ marginTop: 12 }}>{g.title}</span>
            {g.tools.map((t) => (
              <button key={t.id} className={"atool" + (tool === t.id ? " on" : "")} disabled={!!t.step} aria-current={tool === t.id} onClick={() => { setTool(t.id); setSaved(""); }}>
                {t.name}{t.step && <span className="small"> · крок {t.step}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <section className="stack" style={{ gap: 14, minWidth: 0 }} aria-label={toolName}>
        <div className="afilters">
          <div className="row" style={{ gap: 6 }} role="group" aria-label="Які інтерв'ю враховувати">
            <span className="small">Інтерв'ю:</span>
            <button className={"chip" + (ivs.size === s.interviews.length ? " on" : "")} onClick={() => setIvs(new Set(s.interviews.map((x) => x.id)))}>усі</button>
            {s.interviews.map((x) => (
              <button key={x.id} className={"chip" + (ivs.has(x.id) ? " on" : "")} aria-pressed={ivs.has(x.id)} title={x.card.pseudonym}
                onClick={() => setIvs((v) => { const n = new Set(v); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })}>{pad(x.n)}</button>
            ))}
          </div>
          {coders.length > 1 && (
            <div className="seg" role="group" aria-label="Чиє кодування">
              <button aria-pressed={whose === "all"} onClick={() => setWhose("all")}>Усіх</button>
              {coders.map((c) => <button key={c} aria-pressed={whose === c} onClick={() => setWhose(c)}>{c === props.me ? "Моє" : initialsOf(s, c)}</button>)}
            </div>
          )}
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="stack grow" style={{ gap: 2 }}>
            <span className="title">{toolName}</span>
            <span className="small">Враховано: інтерв'ю — {order.length}, фрагментів — {tool === "people" ? s.apps.filter((a) => ivs.has(a.iv)).length : apps.length}{whose !== "all" && tool !== "people" ? ` · лише кодування ${initialsOf(s, whose)}` : ""}</span>
          </div>
          <button className="btn sm" onClick={doSave}>Зберегти рисунок…</button>
        </div>
        {saved && <span className="small" role="status">{saved}</span>}
        <div className="afig" ref={fig}>{body ?? <span className="small">Немає закодованих фрагментів у вибраних інтерв'ю.</span>}</div>
        {note && <p className="small" style={{ lineHeight: 1.7, maxWidth: 760 }}>{note}</p>}
      </section>
    </div>
  );
}
