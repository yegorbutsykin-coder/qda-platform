// A figure for an article, by APA 7: number, title, picture, note; black-and-white for print; Word file.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { apaNote, apaTitle, type Lang } from "./figures";

const EMU_PER_IN = 914400;
// A4 with 1-inch margins (APA): text area 6.27 × 9.69 in; on a landscape page 9.69 × 6.27 in.
const AREA = { portrait: { w: 6.27, h: 7.2 }, landscape: { w: 9.69, h: 4.6 } };
const DPI = 300;

/** Colours become grey patterns (journals often print in greys); greys and white stay. */
export function forPrint(svg: SVGSVGElement): SVGSVGElement {
  const out = svg.cloneNode(true) as SVGSVGElement;
  const NS = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(NS, "defs");
  out.insertBefore(defs, out.firstChild);
  const grey = (c: string) => {
    const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
    if (!m) return true; // "none", "url(...)", named colours: leave
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b) < 18;
  };
  const lum = (c: string) => { const n = parseInt(c.slice(1), 16); return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255; };
  // As different from each other as possible: diagonal, dots, horizontal, cross, vertical, back-diagonal.
  const KINDS = ["M0,6 L6,0", "dots", "M0,3 L6,3", "M0,6 L6,0 M0,0 L6,6", "M3,0 L3,6", "M0,0 L6,6"];
  const ids = new Map<string, string>();
  const pattern = (c: string) => {
    if (ids.has(c)) return ids.get(c)!;
    const i = ids.size, id = `print${i}`, p = document.createElementNS(NS, "pattern");
    p.setAttribute("id", id); p.setAttribute("width", "6"); p.setAttribute("height", "6"); p.setAttribute("patternUnits", "userSpaceOnUse");
    const shade = Math.round(150 + lum(c) * 90).toString(16).padStart(2, "0");
    p.innerHTML = `<rect width="6" height="6" fill="#${shade}${shade}${shade}"/>` + (KINDS[i % KINDS.length] === "dots"
      ? `<circle cx="3" cy="3" r="1.2" fill="#1E1E1C"/>` : `<path d="${KINDS[i % KINDS.length]}" stroke="#1E1E1C" stroke-width="0.9"/>`);
    defs.appendChild(p);
    ids.set(c, id);
    return id;
  };
  out.querySelectorAll<SVGElement>("[fill], [stroke]").forEach((el) => {
    const f = el.getAttribute("fill"), st = el.getAttribute("stroke");
    if (st && !grey(st)) el.setAttribute("stroke", "#1E1E1C");
    if (!f || grey(f)) return;
    if (el.tagName === "text") { el.setAttribute("fill", "#1E1E1C"); return; }
    // Faint background tints become a plain light grey; real colour marks get a pattern.
    if (Number(el.getAttribute("fill-opacity") ?? 1) < 0.3) { el.setAttribute("fill", "#F1F1F1"); el.removeAttribute("fill-opacity"); return; }
    el.setAttribute("fill", `url(#${pattern(f)})`);
    el.removeAttribute("fill-opacity");
  });
  return out;
}

/** The figure as a PNG `width` pixels wide (white background). */
export async function rasterize(svg: SVGSVGElement, width: number): Promise<{ data: string; w: number; h: number }> {
  const text = new XMLSerializer().serializeToString(svg);
  const sw = svg.width.baseVal.value, sh = svg.height.baseVal.value;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
    const c = document.createElement("canvas");
    c.width = Math.round(width); c.height = Math.round((width * sh) / sw);
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/png"), w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Size on the page: as on screen (96 px per inch) but no wider or taller than the text area. */
function pageSize(svg: SVGSVGElement, landscape: boolean) {
  const a = AREA[landscape ? "landscape" : "portrait"];
  const sw = svg.width.baseVal.value, sh = svg.height.baseVal.value;
  const k = Math.min(1, (a.w * 96) / sw, (a.h * 96) / sh);
  const smallest = Math.min(...[...svg.querySelectorAll("text")].map((t) => Number(t.getAttribute("font-size") ?? 12)));
  return { win: (sw * k) / 96, hin: (sh * k) / 96, minPt: smallest * 0.75 * k };
}

type Made = { title: string; note: string; svg: string; w: number; h: number; landscape: boolean; bw: boolean };

export default function ApaFigure(props: {
  svg: () => SVGSVGElement | null; tool: string; n: number; coders: number; refresh: string; onClose: () => void;
  lang: Lang; init?: { title: string; note: string; bw: boolean; landscape: boolean }; replaceN?: number; toArticle?: (f: Made, replace: boolean) => void;
}) {
  const [lang, setLang] = useState<Lang>(props.lang);
  const [num, setNum] = useState(props.replaceN ?? 1);
  const [title, setTitle] = useState(() => props.init?.title ?? apaTitle(props.tool, props.n, props.lang));
  const [note, setNote] = useState(() => props.init?.note ?? apaNote(props.tool, props.n, props.coders, props.lang));
  const [bw, setBw] = useState(props.init?.bw ?? false);
  const [landscape, setLandscape] = useState(props.init?.landscape ?? false);
  const [preview, setPreview] = useState("");
  const [size, setSize] = useState<{ win: number; hin: number; minPt: number } | null>(null);
  const [msg, setMsg] = useState("");
  const L = lang === "uk" ? { fig: "Рисунок", note: "Примітка." } : { fig: "Figure", note: "Note." };
  const reset = (l: Lang) => { setTitle(apaTitle(props.tool, props.n, l)); setNote(apaNote(props.tool, props.n, props.coders, l)); };

  const final = () => { const s = props.svg(); return s ? (bw ? forPrint(s) : s) : null; };
  useEffect(() => {
    const s = final();
    if (!s) return;
    const z = pageSize(s, landscape);
    setSize(z);
    rasterize(s, z.win * 150).then((r) => setPreview(r.data), () => setPreview(""));
  }, [bw, landscape, props.refresh]);

  async function toWord() {
    const s = final();
    if (!s) return;
    const path = await save({ title: "Рисунок для статті", defaultPath: `${L.fig} ${num}.docx`, filters: [{ name: "Word", extensions: ["docx"] }] });
    if (!path) return;
    const z = pageSize(s, landscape);
    const r = await rasterize(s, z.win * DPI);
    try {
      await invoke("save_figure_docx", {
        path: path.toLowerCase().endsWith(".docx") ? path : path + ".docx", png: r.data.split(",")[1],
        widthEmu: Math.round(z.win * EMU_PER_IN), heightEmu: Math.round(z.hin * EMU_PER_IN),
        label: `${L.fig} ${num}`, title: title.trim(), noteLabel: L.note, note: note.trim(), landscape,
      });
      setMsg(`Збережено: ${path.split(/[\\/]/).pop()}. Відкрийте у Word і скопіюйте рисунок разом із підписами у статтю.`);
    } catch (e) { setMsg(`Не вдалося зберегти: ${e}`); }
  }
  function toArticle(replace: boolean) {
    const s = final();
    if (!s) return;
    const z = pageSize(s, landscape);
    props.toArticle!({ title: title.trim(), note: note.trim(), svg: new XMLSerializer().serializeToString(s), w: z.win, h: z.hin, landscape, bw }, replace);
  }
  async function toImage() {
    const s = final();
    if (!s) return;
    const path = await save({ title: "Рисунок окремим файлом", defaultPath: `${L.fig} ${num}.png`, filters: [{ name: "PNG, 300 dpi", extensions: ["png"] }, { name: "SVG (векторний)", extensions: ["svg"] }] });
    if (!path) return;
    try {
      if (path.toLowerCase().endsWith(".svg")) await invoke("save_figure", { path, svg: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(s)}` });
      else {
        const r = await rasterize(s, pageSize(s, landscape).win * DPI);
        await invoke("save_figure", { path: path.toLowerCase().endsWith(".png") ? path : path + ".png", png: r.data.split(",")[1] });
      }
      setMsg(`Збережено: ${path.split(/[\\/]/).pop()}`);
    } catch (e) { setMsg(`Не вдалося зберегти: ${e}`); }
  }

  return (
    <div className="panel stack" style={{ gap: 12 }} role="region" aria-label="Рисунок для статті">
      <div className="row" style={{ gap: 16 }}>
        <span className="label grow">Рисунок для статті · APA 7</span>
        <div className="seg" role="group" aria-label="Мова підписів">
          {(["uk", "en"] as const).map((l) => <button key={l} aria-pressed={lang === l} onClick={() => { setLang(l); reset(l); }}>{l === "uk" ? "Українська" : "English"}</button>)}
        </div>
        <button className="link" style={{ fontSize: 12 }} onClick={props.onClose}>Закрити</button>
      </div>
      <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
        <label className="stack" style={{ gap: 4, fontSize: 13 }}>Номер
          <input className="input mono" type="number" min={1} max={99} style={{ width: 70 }} value={num} onChange={(e) => setNum(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label className="stack grow" style={{ gap: 4, fontSize: 13 }}>Назва — коротка й пояснювальна{lang === "en" ? " (Title Case)" : " (з великої лише перше слово й власні назви)"}
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      </div>
      <label className="stack" style={{ gap: 4, fontSize: 13 }}>Загальна примітка — що не видно з назви й легенди
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="row" style={{ gap: 18 }}>
        <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={bw} onChange={(e) => setBw(e.target.checked)} /><span>Чорно-білий (для друку): сірі відтінки й штрихування замість кольорів</span></label>
        <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)} /><span>Альбомна сторінка</span></label>
        <button className="link" style={{ fontSize: 12 }} onClick={() => reset(lang)}>Повернути заготовку</button>
      </div>
      {size && size.minPt < 8 && (
        <div className="warnline">Найдрібніші підписи на сторінці будуть ≈{size.minPt.toFixed(1)} пт, а APA радить 8–14 пт.{!landscape ? " Спробуйте альбомну сторінку або" : ""} зменште кількість інтерв'ю чи кодів у фільтрах.</div>
      )}
      <div className="apapage" aria-label="Як рисунок виглядатиме в статті">
        <p className="apanum">{L.fig} {num}</p>
        <p className="apatitle">{title}</p>
        {preview ? <img src={preview} alt={title} style={{ width: `${(size?.win ?? 6) * 72}px`, maxWidth: "100%" }} /> : <span className="small">Готую…</span>}
        {note.trim() && <p className="apanote"><i>{L.note}</i> {note.startsWith("N ") ? <><i>N</i>{note.slice(1)}</> : note}</p>}
      </div>
      <div className="row" style={{ gap: 10 }}>
        {props.toArticle && props.replaceN !== undefined && <button className="btn primary" onClick={() => toArticle(true)}>↳ Замінити Рисунок {props.replaceN} у статті</button>}
        {props.toArticle && <button className={"btn" + (props.replaceN === undefined ? " primary" : "")} onClick={() => toArticle(false)}>↳ Вставити в статтю{props.replaceN !== undefined ? " як новий" : " як рисунок"}</button>}
        <button className={"btn" + (props.toArticle ? "" : " primary")} onClick={toWord}>Зберегти у Word (.docx)…</button>
        <button className="btn" onClick={toImage}>Рисунок окремим файлом (PNG 300 dpi / SVG)…</button>
      </div>
      {msg && <span className="small" role="status">{msg}</span>}
      <span className="small">У статті рисунок стане туди, де востаннє стояв курсор (або в кінець розділу результатів); номер ставиться сам за порядком. Рисунок зберігає дані на момент вставлення. Розміщення в кінці статті — у «Вимогах журналу».</span>
    </div>
  );
}
