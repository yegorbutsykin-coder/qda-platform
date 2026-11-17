// Stage 4: the visual analysis window. Figures are SVG drawn here, so they work offline and can be saved.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { agreement, byPerson, codesByCategory, cooccurrence, fragments, matrix, saturationCurve, saturationWords, slice, type Rect } from "./figures";
import { seconds } from "./Player";
import ApaFigure from "./ApaFigure";
import { characteristic, kwic, PRONOUNS, pronouns, suggestTone, TENSES, tenses, TONES, type Tone } from "./language";
import { applyDict } from "./text";
import { LEVELS, quote, type Code } from "./coding";
import { initialsOf, pad, type Private, type Shared } from "./model";

type Tool = "matrix" | "cooc" | "tree" | "strip" | "saturation" | "agreement" | "people" | "tone" | "time" | "kwic" | "groups";
const GROUPS: { title: string; tools: { id: Tool; name: string; step?: string }[] }[] = [
  { title: "Як влаштовані теми", tools: [{ id: "matrix", name: "Матриця «код × учасник(ця)»" }, { id: "cooc", name: "Спільна поява кодів" }, { id: "tree", name: "Ієрархія категорій" }] },
  { title: "Як розгортається розповідь", tools: [{ id: "strip", name: "Смуга інтерв'ю" }, { id: "saturation", name: "Сатурація" }] },
  { title: "Спільне кодування", tools: [{ id: "agreement", name: "Збіг бачення" }, { id: "people", name: "Дослідник(ця) × код" }] },
  { title: "Мова учасників(ць)", tools: [{ id: "kwic", name: "Слова в контексті" }, { id: "time", name: "Час і займенники" }, { id: "tone", name: "Емоційне забарвлення" }] },
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

/** Category colours used in a figure, as APA wants the legend inside the figure. */
function legendPlaces(items: { name: string; color: string }[], width: number) {
  let x = 0, row = 0;
  return items.map((k) => {
    const w = 24 + k.name.length * 6.6;
    if (x > 0 && x + w > width) { x = 0; row++; }
    const at = { ...k, x, row };
    x += w;
    return at;
  });
}
/** Legend rows needed for `width`. */
const legendRows = (items: { name: string; color: string }[], width: number) => (items.length ? Math.max(...legendPlaces(items, width).map((p) => p.row)) + 1 : 0);
function Legend(props: { items: { name: string; color: string }[]; x: number; y: number; width?: number }) {
  return <g>{legendPlaces(props.items, props.width ?? 10000).map((k) => (
    <g key={k.name}><rect x={props.x + k.x} y={props.y - 9 + k.row * 16} width={10} height={10} fill={k.color} /><text x={props.x + k.x + 14} y={props.y + k.row * 16} fontSize={11} fill={MUTED}>{k.name}</text></g>
  ))}</g>;
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

const TONE_COLOR: Record<Tone, string> = { neg: "#9C3B2E", amb: "#B08A3E", pos: "#2E6B4F", neu: "#B9B5AC" };

/** Horizontal bars of shares per row (a participant or a code), with the count in each part. */
function ShareBars(props: { title: string; rows: { label: string; parts: number[] }[]; keys: string[]; colors: string[]; y0?: number }) {
  const LW = 170, BW = 420, RH = 24, top = 34;
  const H = top + props.rows.length * RH + 8, W = LW + BW + 70;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT} role="img" aria-label={props.title}>
      <rect width={W} height={H} fill="#fff" />
      <text x={0} y={13} fontSize={12} fontWeight={600} fill={INK}>{props.title}</text>
      <Legend items={props.keys.map((k, i) => ({ name: k, color: props.colors[i] }))} x={LW} y={13} />
      {props.rows.map((r, i) => {
        const total = r.parts.reduce((a, b) => a + b, 0), y = top + i * RH;
        let x = LW;
        return <g key={r.label}>
          <text x={0} y={y + 14} fontSize={12} fill={INK}>{r.label.length > 24 ? r.label.slice(0, 23) + "…" : r.label}</text>
          {total === 0 ? <text x={LW} y={y + 14} fontSize={11} fill={MUTED}>немає</text> : r.parts.map((v, k) => {
            const w = (v / total) * BW;
            const el = <g key={k}><rect x={x} y={y + 3} width={w} height={RH - 8} fill={props.colors[k]} />{w > 16 && <text x={x + w / 2} y={y + 15} fontSize={11} textAnchor="middle" fill="#fff">{v}</text>}</g>;
            x += w;
            return el;
          })}
          <text x={LW + BW + 8} y={y + 14} fontSize={11} fill={MUTED}>{total}</text>
        </g>;
      })}
    </svg>
  );
}

export default function Analysis(props: { shared: Shared; priv: Private; method: string; me: string; onBack: () => void; goContext: (iv: string, rep: number) => void; setTones: (t: Record<string, Tone>) => void }) {
  const s = props.shared;
  const [tool, setTool] = useState<Tool>("matrix");
  const [ivs, setIvs] = useState<Set<string>>(() => new Set(s.interviews.map((x) => x.id)));
  const [whose, setWhose] = useState("all");
  const [saved, setSaved] = useState("");
  const [picked, setPicked] = useState<number | null>(null); // a mark on the interview strip
  const [apa, setApa] = useState(false);
  const [stripBy, setStripBy] = useState<"code" | "cat">("code");
  const [q, setQ] = useState("");
  const [exact, setExact] = useState(false);
  const [onlyP, setOnlyP] = useState(true);
  const [toneShow, setToneShow] = useState<"todo" | "all">("todo");
  const [toneMax, setToneMax] = useState(40);
  const fig = useRef<HTMLDivElement>(null);
  const coders = [...new Set(s.apps.map((a) => a.by))];
  const order = s.interviews.filter((x) => ivs.has(x.id));
  const apps = useMemo(() => s.apps.filter((a) => ivs.has(a.iv) && (whose === "all" || a.by === whose)), [s.apps, ivs, whose]);
  const used = new Set(apps.map((a) => a.code));
  const groups = codesByCategory(s.codes.filter((c) => used.has(c.id)), s.cats);
  const catOf = (id: string) => s.cats.find((k) => k.id === s.codes.find((c) => c.id === id)?.cat);
  const name = (id: string) => s.codes.find((c) => c.id === id)?.name ?? "?";
  const legendOf = (codes: string[]) => {
    const used = new Set(codes);
    const cats = s.cats.filter((k) => [...used].some((c) => catOf(c)?.id === k.id)).map((k) => ({ name: k.name, color: k.color }));
    return [...cats, ...([...used].some((c) => !catOf(c)) ? [{ name: "без категорії", color: LOOSE }] : [])];
  };
  const label = (x: { n: number; card: { pseudonym: string } }) => `${pad(x.n)} ${x.card.pseudonym}`;
  const toolName = GROUPS.flatMap((g) => g.tools).find((t) => t.id === tool)!.name;

  async function doSave() {
    const svg = fig.current?.querySelector("svg");
    if (!svg) return;
    try { const f = await saveFigure(svg, toolName.replace(/[«»"\\/:*?<>|]/g, "")); if (f) setSaved(`Збережено: ${f}`); }
    catch (e) { setSaved(`Не вдалося зберегти рисунок: ${e}`); }
  }

  // Text as colleagues see it (with replacements); only the participant's voice where asked.
  const shownOf = (iv: string, rep: number) => {
    const r = props.priv.originals[iv]?.[rep];
    return r ? applyDict(r.text, props.priv.dict, iv) : [];
  };
  const voice = (iv: string, rep: number) => props.priv.originals[iv]?.[rep]?.role !== "i";
  const fragText = (f: { iv: string; rep: number; s: number; e: number }) => quote(shownOf(f.iv, f.rep), f.s, f.e);
  const noFigure = tool === "kwic";

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
          <g key={k.id}><rect x={L + i * 130} y={H - 17} width={9} height={9} fill={k.color} /><text x={L + i * 130 + 13} y={H - 9} fontSize={11} fill={MUTED}>{k.name.length > 18 ? k.name.slice(0, 17) + "…" : k.name}</text></g>
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
  if (tool === "cooc") {
    const pairs = [...cooccurrence(apps)].sort((a, b) => b[1] - a[1]);
    const nodes = groups.flatMap((g) => g.codes);
    const frags = fragments(apps);
    const size = new Map(nodes.map((c) => [c.id, frags.filter((f) => f.code === c.id).length]));
    const maxN = Math.max(1, ...size.values()), maxE = Math.max(1, ...pairs.map((p) => p[1]));
    const R = Math.max(110, Math.min(230, nodes.length * 16)), C = { x: R + 170, y: R + 50 };
    const at = (i: number) => { const a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2; return { x: C.x + R * Math.cos(a), y: C.y + R * Math.sin(a), a }; };
    const pos = new Map(nodes.map((c, i) => [c.id, at(i)]));
    const W = 2 * (R + 170), H = 2 * (R + 50) + 24;
    const top = pairs[0];
    body = !pairs.length ? <span className="small">Жодні два коди ще не стоять на тих самих словах.</span> : (
      <svg xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT} role="img" aria-label={toolName}>
        <rect width={W} height={H} fill="#fff" />
        {pairs.map(([k, n]) => {
          const [a, b] = k.split("|").map((id) => pos.get(id)!);
          if (!a || !b) return null;
          // Lines bend towards the centre, so they cross less than straight chords.
          const cx = C.x + ((a.x + b.x) / 2 - C.x) * 0.35, cy = C.y + ((a.y + b.y) / 2 - C.y) * 0.35;
          const mx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x, my = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
          return <g key={k}>
            <path d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`} fill="none" stroke={INK} strokeOpacity={0.25 + 0.6 * (n / maxE)} strokeWidth={1 + 5 * (n / maxE)} />
            <rect x={mx - 7} y={my - 7} width={14} height={14} rx={2} fill="#fff" />
            <text x={mx} y={my + 4} fontSize={11} textAnchor="middle" fill={INK}>{n}</text>
          </g>;
        })}
        <Legend items={legendOf(nodes.map((c) => c.id))} x={20} y={H - 14} />
        {nodes.map((c) => {
          const p = pos.get(c.id)!, r = 4 + 12 * Math.sqrt((size.get(c.id) ?? 0) / maxN), right = Math.cos(p.a) >= 0;
          const lx = C.x + (R + r + 8) * Math.cos(p.a), ly = C.y + (R + r + 8) * Math.sin(p.a);
          return <g key={c.id}>
            <circle cx={p.x} cy={p.y} r={r} fill={catOf(c.id)?.color ?? LOOSE} stroke="#fff" strokeWidth={1.5} />
            <text x={lx} y={ly + 4} fontSize={11} textAnchor={Math.abs(Math.cos(p.a)) < 0.2 ? "middle" : right ? "start" : "end"} fill={INK}>{c.name.length > 24 ? c.name.slice(0, 23) + "…" : c.name} ({size.get(c.id)})</text>
          </g>;
        })}
      </svg>
    );
    note = <>
      {top && <b>Найчастіше разом: «{name(top[0].split("|")[0])}» і «{name(top[0].split("|")[1])}» — {top[1]} {top[1] % 10 === 1 && top[1] % 100 !== 11 ? "раз" : "рази"}.<br /></b>}
      Коло — код (розмір — кількість фрагментів, у дужках; колір — категорія). Лінія — коди на тих самих словах; товщина й число — скільки разів. Фрагменти кількох людей на тих самих словах рахуються один раз.
    </>;
  }
  if (tool === "tree") {
    const frags = fragments(apps);
    const weight = (id: string) => frags.filter((f) => f.code === id).length;
    const lv = s.levels ?? LEVELS[props.method] ?? LEVELS[""];
    const cats = s.cats.map((k) => ({ ...k, codes: s.codes.filter((c) => c.cat === k.id && weight(c.id)) })).filter((k) => k.codes.length);
    const loose = s.codes.filter((c) => (!c.cat || !s.cats.some((k) => k.id === c.cat)) && weight(c.id));
    const tops = [
      ...s.supers.map((u) => ({ id: u.id, name: u.name, cats: cats.filter((k) => k.sup === u.id) })),
      { id: "-", name: `Без рівня «${lv.top}»`, cats: cats.filter((k) => !k.sup || !s.supers.some((u) => u.id === k.sup)) },
      ...(loose.length ? [{ id: "--", name: "Без категорії", cats: [{ id: "--", name: "мікрокоди без категорії", color: LOOSE, codes: loose }] }] : []),
    ].filter((t) => t.cats.length);
    const W = 820, H = 460;
    const sum = (codes: Code[]) => codes.reduce((a, c) => a + weight(c.id), 0);
    const tw = tops.map((t) => t.cats.reduce((a, k) => a + sum(k.codes), 0));
    const inset = (r: Rect, top: number): Rect => ({ x: r.x + 3, y: r.y + top, w: Math.max(0, r.w - 6), h: Math.max(0, r.h - top - 3) });
    const fit = (t: string, w: number) => (t.length * 6.6 > w ? t.slice(0, Math.max(0, Math.floor(w / 6.6) - 1)) + (w > 20 ? "…" : "") : t);
    body = !tops.length ? null : (
      <svg xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT} role="img" aria-label={toolName}>
        <rect width={W} height={H} fill="#fff" />
        {slice({ x: 0, y: 0, w: W, h: H }, tw).map((r, i) => {
          const t = tops[i];
          return <g key={t.id}>
            <rect x={r.x + 1} y={r.y + 1} width={r.w - 2} height={r.h - 2} fill="none" stroke={INK} />
            <text x={r.x + 6} y={r.y + 15} fontSize={12} fontWeight={600} fill={INK}>{fit(t.name, r.w - 12)}</text>
            {slice(inset(r, 20), t.cats.map((k) => sum(k.codes))).map((q, j) => {
              const k = t.cats[j];
              return <g key={k.id}>
                <rect x={q.x} y={q.y} width={q.w} height={q.h} fill={k.color} fillOpacity={0.12} stroke={k.color} />
                {q.h > 16 && <text x={q.x + 4} y={q.y + 13} fontSize={11} fontWeight={600} fill={INK}>{fit(k.name, q.w - 8)}</text>}
                {slice(inset(q, q.h > 34 ? 18 : 2), k.codes.map((c) => weight(c.id))).map((z, m) => (
                  <g key={k.codes[m].id}>
                    <rect x={z.x + 1} y={z.y + 1} width={Math.max(0, z.w - 2)} height={Math.max(0, z.h - 2)} fill={k.color} fillOpacity={0.35} />
                    {z.h > 15 && z.w > 30 && <text x={z.x + 4} y={z.y + 13} fontSize={11} fill={INK}>{fit(`${k.codes[m].name} ${weight(k.codes[m].id)}`, z.w - 8)}</text>}
                  </g>
                ))}
              </g>;
            })}
          </g>;
        })}
      </svg>
    );
    note = <>Площа — кількість фрагментів: великі блоки — {lv.top.toLowerCase()} (рівень 1), усередині — {lv.mid.toLowerCase()} (рівень 2) і мікрокоди з числом фрагментів. Назви, що не вмістилися, видно в матриці. Площа показує, скільки закодовано, а не наскільки тема важлива.</>;
  }
  if (tool === "strip") {
    const frags = fragments(apps);
    const len = (iv: string) => {
      const reps = props.priv.originals[iv] ?? [];
      const sec = Math.max(0, ...reps.map((r) => seconds(r.t) ?? 0));
      return sec > 0 ? { sec: true, total: sec + 30 } : { sec: false, total: Math.max(1, reps.length) };
    };
    // Within a replica, the fragment's place in its text moves it towards the next replica's time.
    const where = (iv: string, rep: number, at: number) => {
      const l = len(iv), reps = props.priv.originals[iv] ?? [], r = reps[rep];
      const k = r?.text.length ? Math.min(1, at / r.text.length) : 0;
      if (!l.sec) return (rep + k) / l.total;
      const t0 = seconds(r?.t ?? null) ?? 0, t1 = seconds(reps[rep + 1]?.t ?? null) ?? t0 + 30;
      return (t0 + k * Math.max(0, t1 - t0)) / l.total;
    };
    const longest = Math.max(1, ...order.map((v) => len(v.id).total));
    const LW = 150, SW = 600, RH = 46, W = LW + SW + 20;
    const usedCodes = [...new Set(list0().map(({ f }) => f.code))];
    const items = stripBy === "code" ? groups.flatMap((g) => g.codes).filter((c) => usedCodes.includes(c.id)).map((c) => ({ name: c.name, color: c.color })) : legendOf(usedCodes);
    const H = 20 + order.length * RH + 14 + legendRows(items, SW) * 16;
    const colorOf = (code: string) => (stripBy === "code" ? s.codes.find((c) => c.id === code)?.color : catOf(code)?.color) ?? LOOSE;
    function list0() { return frags.map((f, i) => ({ f, i })).filter(({ f }) => order.some((v) => v.id === f.iv)); }
    const list = list0();
    const pickedF = picked !== null ? frags[picked] : null;
    body = (
      <div className="stack" style={{ gap: 12 }}>
        <svg xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={FONT} role="img" aria-label={toolName}>
          <rect width={W} height={H} fill="#fff" />
          <Legend items={items} x={LW} y={20 + order.length * RH + 14} width={SW} />
          {order.map((v, k) => {
            const y = 20 + k * RH + RH / 2, w = (len(v.id).total / longest) * SW;
            return <g key={v.id}>
              <text x={0} y={y + 4} fontSize={12} fill={INK}>{label(v)}</text>
              <line x1={LW} x2={LW + w} y1={y} y2={y} stroke={LINE} strokeWidth={2} />
              {list.filter(({ f }) => f.iv === v.id).map(({ f, i }) => ({ f, i, x: LW + where(v.id, f.rep, f.s) * w })).sort((a, b) => a.x - b.x).map(({ f, i, x }, n, all) => {
                // Marks that would cover each other step up and down, so each stays clickable.
                let lvl = 0;
                for (let m = n - 1; m >= 0 && x - all[m].x < 6; m--) lvl++;
                const dy = lvl === 0 ? 0 : (lvl % 2 ? -1 : 1) * Math.ceil(lvl / 2) * 13;
                return <rect key={i} x={x - 3} y={y - 6 + dy} width={6} height={12} fill={colorOf(f.code)} stroke={picked === i ? INK : "none"} strokeWidth={2}
                  tabIndex={0} role="button" aria-label={`${name(f.code)}, інтерв'ю ${pad(v.n)}`} style={{ cursor: "pointer" }}
                  onClick={() => setPicked(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setPicked(i); }} />;
              })}
            </g>;
          })}
        </svg>
        {pickedF && (() => {
          const v = s.interviews.find((x) => x.id === pickedF.iv)!;
          const r = props.priv.originals[pickedF.iv]?.[pickedF.rep];
          const q = r ? quote(applyDict(r.text, props.priv.dict, pickedF.iv), pickedF.s, pickedF.e) : "";
          return (
            <div className="panel stack" style={{ gap: 6 }} role="region" aria-label="Фрагмент">
              <span className="small">«{name(pickedF.code)}» · {label(v)}{r?.t ? ` · ${r.t}` : ""} · {[...pickedF.by].map((b) => initialsOf(s, b)).join(", ")}</span>
              <p className="mono" style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>«{q}»</p>
              <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => props.goContext(pickedF.iv, pickedF.rep)}>Відкрити в транскрипті →</button>
            </div>
          );
        })()}
      </div>
    );
    note = <>Лінія — інтерв'ю на часі запису (без таймкодів — за порядком реплік); позначка — фрагмент, колір — {stripBy === "code" ? "код" : "категорія"}. Натисніть позначку, щоб побачити цитату.</>;
  }
  if (tool === "kwic") {
    const hits = q.trim() ? order.flatMap((v) => (props.priv.originals[v.id] ?? []).flatMap((r, rep) =>
      onlyP && r.role === "i" ? [] : kwic(shownOf(v.id, rep).map((g) => g.text).join(""), q, exact).map((h) => ({ ...h, v, rep, t: r.t })))) : [];
    const frags = fragments(apps).filter((f) => voice(f.iv, f.rep));
    const all = frags.map(fragText).join(" ");
    const perCat = [...s.cats, { id: "", name: "Без категорії", color: LOOSE }].map((k) => ({ k, words: characteristic(frags.filter((f) => (catOf(f.code)?.id ?? "") === k.id).map(fragText).join(" "), all) })).filter((x) => x.words.length);
    body = (
      <div className="stack" style={{ gap: 14 }}>
        <form className="row" style={{ gap: 10 }} onSubmit={(e) => e.preventDefault()}>
          <input className="input mono" style={{ width: 260 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="слово або його початок" aria-label="Слово для пошуку" />
          <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} /><span>лише точне слово</span></label>
          <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={onlyP} onChange={(e) => setOnlyP(e.target.checked)} /><span>лише слова учасників(ць)</span></label>
          {q.trim() && <span className="small">вживань: {hits.length}</span>}
        </form>
        {hits.length > 0 && (
          <div className="kwic" role="list">
            {hits.slice(0, 300).map((h, i) => (
              <div key={i} className="kwicrow" role="listitem">
                <span className="small mono">{pad(h.v.n)}{h.t ? ` ${h.t}` : ""}</span>
                <span className="kl mono">{h.left.length > 48 ? "…" + h.left.slice(-48) : h.left}</span>
                <b className="kw mono">{h.word}</b>
                <span className="kr mono">{h.right}{h.right.length >= 60 ? "…" : ""}</span>
                <button className="link" style={{ fontSize: 12 }} onClick={() => props.goContext(h.v.id, h.rep)} aria-label={`У контексті: інтерв'ю ${pad(h.v.n)}`}>→</button>
              </div>
            ))}
          </div>
        )}
        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Характерні слова категорій — у закодованих фрагментах учасників(ць)</span>
          {perCat.map(({ k, words }) => (
            <div key={k.id || "-"} className="row" style={{ gap: 6 }}>
              <span style={{ fontSize: 13, minWidth: 160 }}><span style={{ display: "inline-block", width: 9, height: 9, background: k.color, marginRight: 6 }} />{k.name}</span>
              {words.map((w) => <button key={w} className="chip" onClick={() => { setQ(w); setExact(true); }}>{w}</button>)}
            </div>
          ))}
          {!perCat.length && <span className="small">Поки замало закодованого тексту.</span>}
        </div>
      </div>
    );
    note = <>Пошук іде по тексту із замінами — як бачать колеги. Характерні слова — ті, що в фрагментах категорії трапляються помітно частіше, ніж у решті закодованого тексту (без службових слів); клік — пошук слова.</>;
  }
  if (tool === "time") {
    const text = (iv: string) => fragments(apps.filter((a) => a.iv === iv)).filter((f) => voice(f.iv, f.rep)).map(fragText).join(" ");
    const pr = order.map((v) => ({ label: label(v), parts: Object.values(pronouns(text(v.id))) }));
    const tn = order.map((v) => ({ label: label(v), parts: Object.values(tenses(text(v.id))) }));
    body = (
      <div className="stack" style={{ gap: 18 }}>
        <ShareBars title="Займенники" rows={pr} keys={[...PRONOUNS]} colors={["#1E1E1C", "#5B7FA6", "#B08A3E", "#B9B5AC"]} />
        <ShareBars title="Час" rows={tn} keys={[...TENSES]} colors={["#6B5B8C", "#2E6B4F", "#C98A12"]} />
      </div>
    );
    note = <>Рахується в закодованих фрагментах учасника(ці) (без реплік інтерв'юера(ки)) за словами-індикаторами українською й російською: займенники в усіх відмінках; минуле — за закінченнями «-ла/-ло/-ли» і словами на кшталт «тоді, колись»; майбутнє — «буду…», «-тиму…»; теперішнє — «зараз, тепер, сьогодні». Це допоміжні числа з похибкою, а не вимір: вони підказують, куди придивитися (зміщення «я → ми», життя в минулому), але висновки — з читання тексту.</>;
  }
  if (tool === "tone") {
    const tones = s.tones ?? {};
    const frags = fragments(apps).filter((f) => voice(f.iv, f.rep));
    const keyOf = (f: { apps: { id: string }[] }) => f.apps[0].id;
    const confirmed = frags.filter((f) => tones[keyOf(f)]);
    const count = (list: typeof frags) => TONES.map((t) => list.filter((f) => tones[keyOf(f)] === t.id).length);
    const byCode = groups.flatMap((g) => g.codes).map((c) => ({ label: c.name, parts: count(confirmed.filter((f) => f.code === c.id)) })).filter((r) => r.parts.some((v) => v));
    const byIv = order.map((v) => ({ label: label(v), parts: count(confirmed.filter((f) => f.iv === v.id)) }));
    const listed = frags.filter((f) => toneShow === "all" || !tones[keyOf(f)]);
    const setTone = (k: string, t: Tone) => {
      const next = { ...tones };
      if (next[k] === t) delete next[k]; else next[k] = t; // a second press on the same tone removes it
      props.setTones(next);
    };
    body = (
      <div className="stack" style={{ gap: 18 }}>
        {confirmed.length ? <>
          <ShareBars title="За кодами" rows={byCode} keys={TONES.map((t) => t.name)} colors={TONES.map((t) => TONE_COLOR[t.id])} />
          <ShareBars title="За учасниками(цями)" rows={byIv} keys={TONES.map((t) => t.name)} colors={TONES.map((t) => TONE_COLOR[t.id])} />
        </> : <span className="small">Ще немає підтверджених позначок — підтвердіть їх у переліку нижче.</span>}
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="label grow">Фрагменти: підтверджено {confirmed.length} з {frags.length}</span>
            <div className="seg" role="group" aria-label="Які фрагменти показувати">
              <button aria-pressed={toneShow === "todo"} onClick={() => setToneShow("todo")}>Непідтверджені</button>
              <button aria-pressed={toneShow === "all"} onClick={() => setToneShow("all")}>Усі</button>
            </div>
          </div>
          {listed.slice(0, toneMax).map((f) => {
            const k = keyOf(f), mine = tones[k], guess = suggestTone(fragText(f)), v = s.interviews.find((x) => x.id === f.iv)!;
            return (
              <div key={k} className="tonerow">
                <span className="small" style={{ minWidth: 150 }}>«{name(f.code)}» · {pad(v.n)}</span>
                <span className="mono grow" style={{ fontSize: 13, lineHeight: 1.6 }}>«{fragText(f)}»</span>
                <div className="row" style={{ gap: 4, flexWrap: "nowrap" }} role="group" aria-label="Забарвлення">
                  {TONES.map((t) => (
                    <button key={t.id} className={"tonebtn" + (mine === t.id ? " on" : !mine && guess === t.id ? " guess" : "")} aria-pressed={mine === t.id}
                      style={{ ["--tc" as string]: TONE_COLOR[t.id] }} title={!mine && guess === t.id ? "пропозиція програми" : undefined} onClick={() => setTone(k, t.id)}>{t.name}</button>
                  ))}
                </div>
              </div>
            );
          })}
          {listed.length > toneMax && <button className="link" style={{ alignSelf: "flex-start", fontSize: 13 }} onClick={() => setToneMax((m) => m + 40)}>Показати ще ({listed.length - toneMax})</button>}
        </div>
      </div>
    );
    note = <>Пунктирна рамка — пропозиція програми за словами-індикаторами (української й російської); натисніть, щоб підтвердити, повторне натискання знімає позначку. Рахуються лише підтверджені. Словники емоцій не розуміють іронії, заперечення («не страшно») і контексту — позначку завжди ставить дослідник(ця).</>;
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
          {!noFigure && <button className="btn sm" onClick={doSave}>Зберегти рисунок…</button>}
          {!noFigure && <button className="btn sm primary" onClick={() => setApa(true)} disabled={!body}>Рисунок для статті (APA 7)…</button>}
        </div>
        {tool === "strip" && (
          <div className="seg" role="group" aria-label="Колір позначок" style={{ alignSelf: "flex-start" }}>
            <button aria-pressed={stripBy === "code"} onClick={() => setStripBy("code")}>Колір: код</button>
            <button aria-pressed={stripBy === "cat"} onClick={() => setStripBy("cat")}>Колір: категорія</button>
          </div>
        )}
        {saved && <span className="small" role="status">{saved}</span>}
        {apa && !noFigure && <ApaFigure key={tool} tool={tool} n={order.length} coders={whose === "all" || tool === "people" ? Math.max(1, coders.length) : 1}
          svg={() => fig.current?.querySelector("svg") ?? null} refresh={`${tool}|${stripBy}|${[...ivs].join()}|${whose}|${apps.length}|${s.codes.length}`} onClose={() => setApa(false)} />}
        <div className="afig" ref={fig}>{body ?? <span className="small">Немає закодованих фрагментів у вибраних інтерв'ю.</span>}</div>
        {note && <p className="small" style={{ lineHeight: 1.7, maxWidth: 760 }}>{note}</p>}
      </section>
    </div>
  );
}
