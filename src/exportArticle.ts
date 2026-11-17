// Stage 5.5: the article out of the app — Word by APA 7, figures as separate files. PDF goes through printing (ArticleView).
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { rasterize } from "./ApaFigure";
import { exportBlocks, type Article, type Method } from "./article";

const EMU_PER_IN = 914400, DPI = 300;
const svgOf = (text: string) => new DOMParser().parseFromString(text, "image/svg+xml").documentElement as unknown as SVGSVGElement;
const png = async (svg: string, inches: number) => (await rasterize(svgOf(svg), inches * DPI)).data.split(",")[1];
const fileName = (s: string) => s.replace(/[«»"\\/:*?<>|\n]/g, "").trim().slice(0, 80) || "Стаття";

/** Word by APA 7; returns the file name or "" if cancelled. */
export async function saveDocx(a: Article, method: Method, mid: string): Promise<string> {
  const path = await save({ title: "Стаття у Word", defaultPath: `${fileName(a.title)}.docx`, filters: [{ name: "Word", extensions: ["docx"] }] });
  if (!path) return "";
  const noteLabel = a.journal?.lang === "en" ? "Note." : "Примітка.";
  const images: string[] = [];
  const blocks = [];
  for (const b of exportBlocks(a, method, mid)) {
    if (b.k === "fig") {
      images.push(await png(b.f.svg, b.f.w));
      blocks.push({ k: "fig", label: b.label, title: b.f.title, note_label: noteLabel, note: b.f.note, img: images.length - 1,
        w_emu: Math.round(b.f.w * EMU_PER_IN), h_emu: Math.round(b.f.h * EMU_PER_IN), landscape: b.f.landscape, brk: b.brk });
    } else if (b.k === "tab") {
      blocks.push({ k: "tab", label: b.label, title: b.t.title, note_label: noteLabel, note: b.t.note, head: b.head, rows: b.rows, landscape: wideTable(b.head.length), brk: b.brk });
    } else blocks.push(b);
  }
  const file = path.toLowerCase().endsWith(".docx") ? path : path + ".docx";
  await invoke("save_article_docx", { path: file, blocks, images });
  return file.split(/[\\/]/).pop()!;
}

/** A presence matrix of 10+ participants (12+ columns) goes on a landscape page. */
export const wideTable = (cols: number) => cols >= 12;

/** Every figure as «Рисунок N.png» (300 dpi) and «Рисунок N.svg» in a folder; returns how many. */
export async function saveFigures(a: Article, method: Method): Promise<number> {
  const figs = exportBlocks(a, method, "").filter((b) => b.k === "fig");
  if (!figs.length) return 0;
  const dir = await open({ directory: true, title: "Тека для рисунків" });
  if (!dir || Array.isArray(dir)) return -1;
  for (const b of figs) {
    if (b.k !== "fig") continue;
    const base = `${dir}/${fileName(b.label)}`;
    await invoke("save_figure", { path: `${base}.png`, png: await png(b.f.svg, b.f.w) });
    await invoke("save_figure", { path: `${base}.svg`, svg: `<?xml version="1.0" encoding="UTF-8"?>\n${b.f.svg}` });
  }
  return figs.length;
}
