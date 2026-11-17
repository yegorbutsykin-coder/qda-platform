// Stage 5: the article — sections by method (APA 7 and JARS–Qual), word counts, quotes, figures and tables.
import type { Shared } from "./model";
import { fragments, type Frag } from "./figures";

export type Method = "ІФА" | "Дескр." | "РТА";
/** One section as the journal wants it; empty fields take the method's default. */
export type SectionConf = { key: string; name?: string; hint?: string; limit?: number };
export type Journal = { name: string; lang: "uk" | "en"; total?: number; other: string; sections?: SectionConf[]; floatsAtEnd?: boolean };
/** A figure from the visual analysis, as it was when put in: the picture and what reproduces it. */
export type FigFloat = {
  kind: "fig"; title: string; note: string; svg: string; w: number; h: number; landscape: boolean; bw: boolean;
  tool: string; ivs: string[]; whose: string; stripBy?: "code" | "cat"; sig: string;
};
export type TabRow = { sup?: string; id: string; name: string; people: string[]; quote?: string; pick?: string; cells?: number[] };
/** The table of themes (supers → categories), as it was when built; own names and picked quotes survive «Оновити». */
export type TabFloat = {
  kind: "tab"; variant: "themes" | "presence"; title: string; note: string; showPeople: boolean; showQuote: boolean;
  cols: string[]; n: number; rows: TabRow[]; names: Record<string, string>; picks: Record<string, string>; sig: string;
};
export type Float = FigFloat | TabFloat;
export type Article = { title: string; format?: Method; texts: Record<string, string>; journal?: Journal; floats?: Record<string, Float> };
export const SECTIONS = ["abstract", "intro", "method", "results", "discussion"] as const;
export type SectionKey = (typeof SECTIONS)[number];
export const TOTAL_LIMIT = 8000; // a common journal limit; the journal's own goes in «Вимоги журналу»

type Def = { name: string; hint: string; limit?: number };
const COMMON: Record<"abstract" | "intro", Def> = {
  abstract: { name: "Анотація", limit: 250, hint: "Мета, учасники(ці) й метод, основні результати й висновок — одним абзацом. Під анотацією — 3–5 ключових слів." },
  intro: { name: "Вступ", hint: "Проблема й чому вона важлива; що відомо з літератури і чого бракує; мета й дослідницьке запитання; чому обрано саме цей якісний підхід (JARS–Qual)." },
};
const BY_METHOD: Record<Method, Record<"method" | "results" | "discussion", Def>> = {
  "ІФА": {
    method: { name: "Метод", hint: "Обґрунтування ІФА: ідіографічність і подвійна герменевтика. Однорідна цільова вибірка — хто й як набраний(а). Збір даних (напівструктуроване інтерв'ю). Аналіз: дослівні коментарі → досвідні твердження → особистісні досвідні теми → групові досвідні теми. Рефлексивність дослідника(ці). Етика." },
    results: { name: "Групові досвідні теми", hint: "Кожна групова тема з підтемами; цитати кількох учасників(ць) з інтерпретацією, а не лише переказом; і спільне, і відмінне між випадками. Таблиця тем — за потреби." },
    discussion: { name: "Обговорення", hint: "Діалог із літературою: що теми додають до наявного розуміння; трансферабельність (а не узагальнення); обмеження; значення для практики." },
  },
  "Дескр.": {
    method: { name: "Метод", hint: "Обґрунтування дескриптивного феноменологічного методу; епохе — як ви виводили за дужки власні уявлення. Учасники(ці) й збір описів. Аналіз за Джорджі: смислові одиниці → психологічні трансформації → загальна структура; уявна варіація. Етика." },
    results: { name: "Загальна структура досвіду", hint: "Спершу загальна структура феномену, далі — сутнісні складники з прикладами з описів учасників(ць) і тим, як складники пов'язані між собою." },
    discussion: { name: "Обговорення", hint: "Що загальна структура додає до розуміння феномену; зв'язок із попередніми дослідженнями; обмеження; значення для практики." },
  },
  "РТА": {
    method: { name: "Метод", hint: "Позиція за Браун і Кларк: рефлексивний тематичний аналіз і ваша теоретична позиція; семантичне чи латентне, індуктивне чи дедуктивне кодування; шість фаз; рефлексивність. Не називайте сатурацію чи згоду кодувальників(ць) критеріями якості." },
    results: { name: "Теми", hint: "Для кожної теми — назва й центральна ідея (одне-два речення), аналітичний наратив, що виходить за межі переказу, і цитати як ілюстрації аргументу." },
    discussion: { name: "Обговорення", hint: "Як теми відповідають на дослідницьке запитання; роль позиції дослідника(ці) в інтерпретації; зв'язок із літературою; обмеження." },
  },
};

export const METHODS: Method[] = ["ІФА", "Дескр.", "РТА"];
export const asMethod = (m: string): Method => (METHODS.includes(m as Method) ? (m as Method) : "РТА");

export function sectionDef(key: SectionKey, method: Method): Def {
  return key === "abstract" || key === "intro" ? COMMON[key] : BY_METHOD[method][key];
}

/** Words as a journal counts them: letters or digits, with apostrophes and hyphens inside. */
export const countWords = (t: string) => (t.replace(MARK_G, "").match(/[\p{L}\p{N}]+(?:['’ʼ-][\p{L}\p{N}]+)*/gu) ?? []).length;

/** A figure or table sits in the text as a line of its own: "\n⟦fig:id⟧\n". */
const MARK_G = /⟦(?:fig|tab):[\w-]+⟧/g;
const SPLIT = /\n⟦((?:fig|tab):[\w-]+)⟧\n/;
export type Piece = { text: string } | { id: string; kind: "fig" | "tab" };
/** Text between floats, and the floats: join(split(t)) === t. */
export function split(t: string): Piece[] {
  return t.split(SPLIT).map((x, i) => (i % 2 ? { kind: x.slice(0, 3) as "fig" | "tab", id: x.slice(4) } : { text: x }));
}
export const join = (ps: Piece[]) => ps.map((p) => ("text" in p ? p.text : `\n⟦${p.kind}:${p.id}⟧\n`)).join("");

export type Caret = { sec: string; seg: number; pos: number };
const segText = (ps: Piece[], seg: number) => { const p = ps[seg * 2]; return p && "text" in p ? p.text : null; };

/** Where something goes: the caret if it is still there, else the end of `fallback`. */
function spot(a: Article, keys: string[], c: Caret | null, fallback: string): Caret {
  if (c && keys.includes(c.sec)) {
    const t = segText(split(a.texts[c.sec] ?? ""), c.seg);
    if (t !== null) return { ...c, pos: Math.min(c.pos, t.length) };
  }
  const ps = split(a.texts[fallback] ?? "");
  const seg = (ps.length - 1) / 2;
  return { sec: fallback, seg, pos: (ps[ps.length - 1] as { text: string }).text.length };
}
export const resultsKey = (keys: string[]) => (keys.includes("results") ? "results" : keys[keys.length - 1]);

/** Quote or reference at the caret (or the end of results); returns where the caret ends up. */
export function putText(a: Article, keys: string[], c: Caret | null, piece: { text: string; block: boolean }): { article: Article; caret: Caret } {
  const at = spot(a, keys, c, resultsKey(keys));
  const ps = split(a.texts[at.sec] ?? "");
  const r = insertAt(segText(ps, at.seg)!, at.pos, piece);
  ps[at.seg * 2] = { text: r.text };
  return { article: { ...a, texts: { ...a.texts, [at.sec]: join(ps) } }, caret: { ...at, pos: r.pos } };
}

/** A figure or table at the caret, between paragraphs. */
export function putFloat(a: Article, keys: string[], c: Caret | null, id: string, f: Float): { article: Article; sec: string } {
  const at = spot(a, keys, c, resultsKey(keys));
  const ps = split(a.texts[at.sec] ?? "");
  const t = segText(ps, at.seg)!;
  const before = t.slice(0, at.pos).replace(/\s+$/, ""), after = t.slice(at.pos).replace(/^\s+/, "");
  ps.splice(at.seg * 2, 1, { text: before }, { kind: f.kind, id }, { text: after });
  return { article: settle(a, { ...a, texts: { ...a.texts, [at.sec]: join(ps) }, floats: { ...a.floats, [id]: f } }, keys), sec: at.sec };
}

/** Figures and tables are numbered separately, in the order they appear. */
export function numbers(a: Article, keys: string[]): Map<string, number> {
  const out = new Map<string, number>(), next = { fig: 0, tab: 0 };
  for (const k of keys) for (const p of split(a.texts[k] ?? "")) if ("id" in p && a.floats?.[p.id] && !out.has(p.id)) out.set(p.id, ++next[p.kind]);
  return out;
}

const REF = /(?<!\p{L})(рисун\p{L}*|рис\.|figure|fig\.|таблиц\p{L}*|табл\.|table)(\s+)(\d+)/giu;
/**
 * After figures or tables move, appear or go, references in the text follow: «Рисунку 3» becomes «Рисунку 2»;
 * a reference to a removed one becomes «?» so it is seen.
 */
export function settle(prev: Article, next: Article, keys: string[]): Article {
  const before = numbers(prev, keys), after = numbers(next, keys);
  const map = { fig: new Map<number, string>(), tab: new Map<number, string>() };
  let changed = false;
  for (const [id, n] of before) {
    const kind = prev.floats![id].kind, m = after.get(id);
    map[kind].set(n, m ? String(m) : "?");
    if (m !== n) changed = true;
  }
  if (!changed) return next;
  const texts = Object.fromEntries(Object.entries(next.texts).map(([k, t]) => [k, t.replace(REF, (all, w: string, sp: string, d: string) => {
    const m = map[/^(рис|fig)/i.test(w) ? "fig" : "tab"].get(Number(d));
    return m ? w + sp + m : all;
  })]));
  return { ...next, texts };
}

/** Moves a float one paragraph up or down; past the section's edge — into the neighbouring section. */
export function moveFloat(a: Article, keys: string[], id: string, dir: -1 | 1): Article {
  type Tok = { p: string } | { m: Piece };
  const toks = (t: string): Tok[] => split(t).flatMap((x): Tok[] => ("text" in x ? (x.text ? x.text.split("\n\n").map((p) => ({ p })) : []) : [{ m: x }]));
  const back = (ts: Tok[]) => {
    const ps: Piece[] = [];
    let buf: string[] = [];
    const flush = () => { ps.push({ text: buf.join("\n\n") }); buf = []; };
    for (const t of ts) { if ("m" in t) { flush(); ps.push(t.m); } else buf.push(t.p); }
    flush();
    return join(ps);
  };
  const isIt = (t: Tok) => "m" in t && "id" in t.m && t.m.id === id;
  const all = keys.map((k) => toks(a.texts[k] ?? ""));
  const si = all.findIndex((ts) => ts.some(isIt));
  if (si < 0) return a;
  const ts = all[si], i = ts.findIndex(isIt), [tok] = ts.splice(i, 1);
  // Blank paragraphs are skipped: a move past one would look like nothing happened.
  const blank = (t?: Tok) => !!t && "p" in t && !t.p.trim();
  let j = dir === -1 ? i - 1 : i;
  while (blank(ts[j])) j += dir;
  if (j < 0 || j >= ts.length) {
    const ni = si + dir;
    if (ni < 0 || ni >= all.length) return a;
    if (dir === -1) all[ni].push(tok); else all[ni].unshift(tok);
  } else ts.splice(dir === -1 ? j : j + 1, 0, tok);
  const texts = { ...a.texts };
  keys.forEach((k, n) => { if (n === si || n === si + dir) texts[k] = back(all[n]); });
  return settle(a, { ...a, texts }, keys);
}

/** Takes a float out of the text (and its data). */
export function dropFloat(a: Article, keys: string[], id: string): Article {
  const texts = Object.fromEntries(Object.entries(a.texts).map(([k, t]) => {
    const ps = split(t), i = ps.findIndex((p) => "id" in p && p.id === id);
    if (i < 0) return [k, t];
    const merged = [(ps[i - 1] as { text: string }).text, (ps[i + 1] as { text: string }).text].filter((x) => x.trim()).join("\n\n");
    ps.splice(i - 1, 3, { text: merged });
    return [k, join(ps)];
  }));
  const floats = { ...a.floats };
  delete floats[id];
  return settle(a, { ...a, texts, floats }, keys);
}

/** A short fingerprint of what figures and tables are made of, to tell when the coding changed after them. */
export function dataSig(s: Pick<Shared, "apps" | "codes" | "cats" | "supers" | "interviews" | "tones">): string {
  const txt = JSON.stringify([s.apps.map((a) => [a.code, a.iv, a.rep, a.s, a.e, a.by]), s.codes.map((c) => [c.id, c.name, c.cat, c.color]), s.cats, s.supers, s.tones ?? {},
    s.interviews.map((x) => [x.id, x.card])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

export const fragKey = (f: { iv: string; rep: number; s: number }) => `${f.iv}|${f.rep}|${f.s}`;

/**
 * Rows of the table of themes: supers (as row groups) → categories; who has the theme; an illustrative quote —
 * the one picked, or the shortest fragment marked by the most people (participants' words only, with replacements).
 */
export function themeTable(s: Shared, t: Omit<TabFloat, "rows" | "cols" | "n" | "sig">, quoteOf: (f: Frag) => string, voice: (f: Frag) => boolean, lang: "uk" | "en"): Pick<TabFloat, "rows" | "cols" | "n"> {
  const ivs = [...s.interviews].sort((a, b) => a.n - b.n);
  const order = [...s.supers.map((x) => ({ sup: x as { id: string; name: string } | null, cats: s.cats.filter((k) => k.sup === x.id) })),
    { sup: null, cats: s.cats.filter((k) => !k.sup || !s.supers.some((x) => x.id === k.sup)) }];
  const rows: TabRow[] = [];
  for (const g of order) for (const k of g.cats) {
    const codes = new Set(s.codes.filter((c) => c.cat === k.id).map((c) => c.id));
    const frags = fragments(s.apps.filter((a) => codes.has(a.code)));
    if (!frags.length) continue;
    const has = (iv: string) => frags.filter((f) => f.iv === iv).length;
    const people = ivs.filter((x) => has(x.id)).map((x) => x.card.pseudonym);
    const cands = frags.filter(voice).map((f) => ({ f, q: quoteOf(f) })).filter((x) => x.q);
    const best = cands.find((x) => fragKey(x.f) === t.picks[k.id])
      ?? [...cands].sort((a, b) => (countWords(a.q) >= 3 ? 0 : 1) - (countWords(b.q) >= 3 ? 0 : 1) || b.f.by.size - a.f.by.size || a.q.length - b.q.length)[0];
    const iv = best && ivs.find((x) => x.id === best.f.iv);
    rows.push({
      ...(g.sup ? { sup: g.sup.name } : {}), id: k.id, name: t.names[k.id]?.trim() || k.name, people,
      ...(best && iv ? { quote: formatQuote(best.q, iv.card.pseudonym, iv.n, lang).text.replace(/^> /, ""), pick: fragKey(best.f) } : {}),
      cells: ivs.map((x) => has(x.id)),
    });
  }
  return { rows, cols: ivs.map((x) => x.card.pseudonym), n: ivs.length };
}

export const emptyArticle = (): Article => ({ title: "", texts: {} });

const EN: Record<string, string> = { abstract: "Abstract", intro: "Introduction", method: "Method", discussion: "Discussion" };
const EN_RESULTS: Record<Method, string> = { "ІФА": "Group Experiential Themes", "Дескр.": "General Structure of the Experience", "РТА": "Themes" };

export type Section = { key: string; name: string; hint: string; limit?: number; custom: boolean };

/** The sections in the journal's order, with its names, requirements and limits over the method's defaults. */
export function sectionsOf(a: Article, method: Method): Section[] {
  const en = a.journal?.lang === "en";
  const conf: SectionConf[] = a.journal?.sections ?? SECTIONS.map((key) => ({ key }));
  return conf.map((c) => {
    const std = (SECTIONS as readonly string[]).includes(c.key) ? sectionDef(c.key as SectionKey, method) : null;
    const stdName = std ? (en ? (c.key === "results" ? EN_RESULTS[method] : EN[c.key]) : std.name) : "Новий розділ";
    return { key: c.key, name: c.name?.trim() || stdName, hint: c.hint?.trim() || std?.hint || "", limit: c.limit ?? std?.limit, custom: !std };
  });
}

/** 0 = no limit. */
export const totalLimit = (a: Article) => a.journal?.total ?? TOTAL_LIMIT;

/**
 * «Скинути вимоги журналу»: APA's sections, hints, limits, order and the 8000 limit; the text stays.
 * Added sections that have text move to the end; empty ones go. The journal's name, language and notes stay.
 */
export function resetJournal(a: Article): Article {
  const added = (a.journal?.sections ?? []).filter((c) => !(SECTIONS as readonly string[]).includes(c.key) && (a.texts[c.key] ?? "").trim());
  const j = a.journal ?? { name: "", lang: "uk" as const, other: "" };
  return { ...a, journal: { name: j.name, lang: j.lang, other: j.other, ...(added.length ? { sections: [...SECTIONS.map((key) => ({ key })), ...added.map((c) => ({ key: c.key, name: c.name }))] } : {}) } };
}

export const journalChanged = (a: Article) => !!a.journal?.sections || (a.journal?.total !== undefined && a.journal.total !== TOTAL_LIMIT);

/**
 * A participant's words as APA 7 wants them: under 40 words in the line, in quotation marks, with the source;
 * 40 and more — a block of its own (marked "> " here; indented in the exported Word), without quotation marks.
 */
export function formatQuote(text: string, pseudonym: string, n: number, lang: "uk" | "en"): { text: string; block: boolean } {
  const t = text.trim().replace(/\s+/g, " ");
  const src = lang === "en" ? `(${pseudonym}, Interview ${String(n).padStart(2, "0")})` : `(${pseudonym}, інтерв'ю ${String(n).padStart(2, "0")})`;
  if (countWords(t) >= 40) return { text: `> ${t} ${src}`, block: true };
  // APA: in the line the full stop moves after the source; ? and ! stay inside.
  const dot = t.endsWith(".") && !t.endsWith("..."), q = dot ? t.slice(0, -1) : t;
  return { text: (lang === "en" ? `“${q}” ${src}` : `«${q}» ${src}`) + (dot ? "." : ""), block: false };
}

/** Puts `piece` at `pos`: a block quote on lines of its own, an inline one with spaces as needed. */
export function insertAt(text: string, pos: number, piece: { text: string; block: boolean }): { text: string; pos: number } {
  const block = piece.block;
  const before = block ? text.slice(0, pos).replace(/[ \t]+$/, "") : text.slice(0, pos), after = block ? text.slice(pos).replace(/^[ \t]+/, "") : text.slice(pos);
  const ins = block
    ? (before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "") + piece.text + (after.startsWith("\n") ? "\n" : "\n\n")
    : (before && !/\s$/.test(before) ? " " : "") + piece.text + (after && !/^[\s.,;:!?)]/.test(after) ? " " : "");
  return { text: before + ins + after, pos: before.length + ins.length };
}
