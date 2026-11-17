// Stage 4: numbers for the visual analysis window, always from the current coding.
import type { App, Cat, Code } from "./coding";

/** Codes in category order (categories as in the project, then «Без категорії»), with their group name. */
export function codesByCategory(codes: Code[], cats: Cat[]): { cat: Cat | null; codes: Code[] }[] {
  const byName = (a: Code, b: Code) => a.name.localeCompare(b.name, "uk");
  const groups = cats.map((cat) => ({ cat, codes: codes.filter((c) => c.cat === cat.id).sort(byName) }));
  const loose = codes.filter((c) => !c.cat || !cats.some((k) => k.id === c.cat)).sort(byName);
  return [...groups, ...(loose.length ? [{ cat: null, codes: loose }] : [])].filter((g) => g.codes.length);
}

/** Fragments per code and interview. */
export function matrix(apps: App[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const a of apps) {
    const row = m.get(a.code) ?? new Map<string, number>();
    row.set(a.iv, (row.get(a.iv) ?? 0) + 1);
    m.set(a.code, row);
  }
  return m;
}

/** New codes in each interview (in order) and how many codes there are so far. */
export function saturationCurve(order: string[], apps: App[]): { iv: string; fresh: string[]; total: number }[] {
  const seen = new Set<string>();
  return order.map((iv) => {
    const fresh = [...new Set(apps.filter((a) => a.iv === iv).map((a) => a.code))].filter((c) => !seen.has(c));
    fresh.forEach((c) => seen.add(c));
    return { iv, fresh, total: seen.size };
  });
}

/**
 * One "fragment" = the same code on overlapping words, by anyone; for each code:
 * how many such fragments were marked by 3+ / 2 / 1 people.
 */
export function agreement(apps: App[]): Map<string, { three: number; two: number; one: number }> {
  const out = new Map<string, { three: number; two: number; one: number }>();
  const groups = new Map<string, App[]>();
  for (const a of apps) {
    const k = `${a.code}|${a.iv}|${a.rep}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  for (const [k, list] of groups) {
    const code = k.split("|")[0];
    const r = out.get(code) ?? { three: 0, two: 0, one: 0 };
    // Overlapping pieces join into one fragment.
    const sorted = [...list].sort((a, b) => a.s - b.s);
    let end = -1, people = new Set<string>();
    const close = () => { if (people.size) { const n = people.size; if (n >= 3) r.three++; else if (n === 2) r.two++; else r.one++; } };
    for (const a of sorted) {
      if (a.s >= end) { close(); people = new Set(); }
      people.add(a.by);
      end = Math.max(end, a.e);
    }
    close();
    out.set(code, r);
  }
  return out;
}

/** Fragments per person and code; and codes that only one person uses. */
export function byPerson(apps: App[]): { counts: Map<string, Map<string, number>>; solo: Map<string, string> } {
  const counts = new Map<string, Map<string, number>>();
  for (const a of apps) {
    const row = counts.get(a.by) ?? new Map<string, number>();
    row.set(a.code, (row.get(a.code) ?? 0) + 1);
    counts.set(a.by, row);
  }
  const users = new Map<string, Set<string>>();
  for (const a of apps) users.set(a.code, (users.get(a.code) ?? new Set()).add(a.by));
  const solo = new Map([...users].filter(([, s]) => s.size === 1).map(([c, s]) => [c, [...s][0]]));
  return { counts, solo };
}

/** Plain-words conclusion for the saturation curve. */
export function saturationWords(curve: { fresh: string[] }[], names: string[], n: number): string {
  if (!curve.length) return "";
  let last = -1;
  curve.forEach((c, i) => { if (c.fresh.length) last = i; });
  const quiet = curve.length - 1 - last;
  if (last < 0) return "Ще немає закодованих фрагментів.";
  if (quiet >= n) return `Останні нові коди з'явилися в інтерв'ю ${names[last]}; після нього — ${quiet} інтерв'ю без нових кодів.`;
  if (quiet === 0) return `Нові коди з'являються й в останньому інтерв'ю (${names[last]}): кодова книга ще росте.`;
  return `Останні нові коди — в інтерв'ю ${names[last]}; після нього ${quiet} інтерв'ю без нових кодів (позначка — від ${n}).`;
}

export type Frag = { code: string; iv: string; rep: number; s: number; e: number; by: Set<string>; apps: App[] };

/** The same code on overlapping words, by anyone, is one fragment (so two coders do not count twice). */
export function fragments(apps: App[]): Frag[] {
  const groups = new Map<string, App[]>();
  for (const a of apps) {
    const k = `${a.code}|${a.iv}|${a.rep}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const out: Frag[] = [];
  for (const list of groups.values()) {
    let cur: Frag | null = null;
    for (const a of [...list].sort((x, y) => x.s - y.s)) {
      if (cur && a.s < cur.e) { cur.e = Math.max(cur.e, a.e); cur.by.add(a.by); cur.apps.push(a); continue; }
      cur = { code: a.code, iv: a.iv, rep: a.rep, s: a.s, e: a.e, by: new Set([a.by]), apps: [a] };
      out.push(cur);
    }
  }
  return out;
}

/** Pairs of codes whose fragments overlap: "a|b" (a < b) → how many times. */
export function cooccurrence(apps: App[]): Map<string, number> {
  const bySpot = new Map<string, Frag[]>();
  for (const f of fragments(apps)) bySpot.set(`${f.iv}|${f.rep}`, [...(bySpot.get(`${f.iv}|${f.rep}`) ?? []), f]);
  const out = new Map<string, number>();
  for (const list of bySpot.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.code === b.code || a.s >= b.e || b.s >= a.e) continue;
      const k = a.code < b.code ? `${a.code}|${b.code}` : `${b.code}|${a.code}`;
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  }
  return out;
}

export type Rect = { x: number; y: number; w: number; h: number };
/** Splits a rectangle among weights, along its longer side (slice-and-dice: readable, keeps order). */
export function slice(r: Rect, weights: number[]): Rect[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let at = 0;
  return weights.map((w) => {
    const k = w / total;
    const out = r.w >= r.h ? { x: r.x + at * r.w, y: r.y, w: k * r.w, h: r.h } : { x: r.x, y: r.y + at * r.h, w: r.w, h: k * r.h };
    at += k;
    return out;
  });
}

// ---------- figures for an article (APA 7) ----------

export type Lang = "uk" | "en";
const UK_LOC = ["", "одному", "двох", "трьох", "чотирьох", "п'яти", "шести", "семи", "восьми", "дев'яти"];
const EN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
/** APA: numbers below 10 in words. "у семи інтерв'ю" / "Across Seven Interviews". */
export const inN = (n: number, lang: Lang) =>
  lang === "uk" ? `у ${n < 10 ? UK_LOC[n] : n} інтерв'ю` : `Across ${n < 10 ? EN[n][0].toUpperCase() + EN[n].slice(1) : n} Interview${n === 1 ? "" : "s"}`;

const TITLES: Record<string, (n: number, lang: Lang) => string> = {
  matrix: (n, l) => (l === "uk" ? `Кількість закодованих фрагментів за кодами й учасниками(цями) ${inN(n, l)}` : `Coded Segments by Code and Participant ${inN(n, l)}`),
  cooc: (n, l) => (l === "uk" ? `Спільна поява кодів ${inN(n, l)}` : `Code Co-Occurrence ${inN(n, l)}`),
  tree: (_n, l) => (l === "uk" ? "Ієрархія тем і кодів" : "Hierarchy of Themes and Codes"),
  strip: (n, l) => (l === "uk" ? `Розташування закодованих фрагментів ${inN(n, l)}` : `Position of Coded Segments ${inN(n, l)}`),
  saturation: (n, l) => (l === "uk" ? `Нові й накопичені коди ${inN(n, l)}` : `New and Cumulative Codes ${inN(n, l)}`),
  agreement: (_n, l) => (l === "uk" ? "Збіг кодування між дослідниками(цями)" : "Overlap in Coding Between Researchers"),
  people: (_n, l) => (l === "uk" ? "Використання кодів дослідниками(цями)" : "Use of Codes by Researcher"),
  groups: (n, l) => (l === "uk" ? `Частка учасників(ць), в інтерв'ю яких є код, за групами (${n} інтерв'ю)` : `Share of Participants With Each Code, by Group (${n} Interviews)`),
  time: (n, l) => (l === "uk" ? `Займенники й часові маркери в закодованих фрагментах ${inN(n, l)}` : `Pronouns and Tense Markers in Coded Segments ${inN(n, l)}`),
  tone: (n, l) => (l === "uk" ? `Емоційне забарвлення закодованих фрагментів ${inN(n, l)}` : `Emotional Tone of Coded Segments ${inN(n, l)}`),
};
const READ: Record<string, [string, string]> = {
  matrix: ["Число в клітинці — кількість фрагментів; темніший колір — більше фрагментів.", "Cell values show the number of coded segments; darker shading indicates more segments."],
  cooc: ["Розмір кола — кількість фрагментів коду; товщина й число лінії — скільки разів коди позначено на тих самих словах.", "Circle size shows the number of segments per code; line width and labels show how often two codes were applied to the same words."],
  tree: ["Площа блока пропорційна кількості закодованих фрагментів.", "Block area is proportional to the number of coded segments."],
  strip: ["Кожна лінія — інтерв'ю на часі запису; позначка — закодований фрагмент.", "Each line represents an interview along its recording time; marks show coded segments."],
  saturation: ["Угорі — нові коди в кожному інтерв'ю, унизу — накопичена кількість кодів.", "Top: new codes in each interview; bottom: cumulative number of codes."],
  agreement: ["Частка фрагментів, позначених трьома й більше, двома чи одним(ною) дослідником(цею).", "Share of segments coded by three or more, two, or one researcher."],
  people: ["Число — кількість фрагментів, позначених кодом.", "Values show the number of segments coded."],
  groups: ["Число — скільки людей групи мають код в інтерв'ю з усіх людей групи; темніше — більша частка.", "Values show how many participants in each group had the code in their interview; darker shading indicates a larger share."],
  time: ["Частки слів-індикаторів у висловлюваннях учасників(ць); числа — кількість слів. Підрахунок за словниками, допоміжний.", "Shares of indicator words in participants' coded speech; numbers are word counts. Dictionary-based counts are indicative only."],
  tone: ["Враховано лише фрагменти, забарвлення яких підтвердив(ла) дослідник(ця); числа — кількість фрагментів.", "Only segments whose tone was confirmed by a researcher are included; numbers are segment counts."],
};
const PEOPLE_UK = ["", "одного(ї)", "двох", "трьох", "чотирьох", "п'яти", "шести", "семи", "восьми", "дев'яти"];

export function apaTitle(tool: string, n: number, lang: Lang): string {
  return (TITLES[tool] ?? (() => ""))(n, lang);
}

/** General note: sample, whose coding, how to read the figure, pseudonyms. */
export function apaNote(tool: string, n: number, coders: number, lang: Lang): string {
  const who = lang === "uk"
    ? (coders === 1 ? "кодування одного(ї) дослідника(ці)" : `кодування ${coders < 10 ? PEOPLE_UK[coders] : coders} дослідників(ць)`)
    : `coding by ${coders < 10 ? EN[coders] : coders} researcher${coders === 1 ? "" : "s"}`;
  const read = READ[tool]?.[lang === "uk" ? 0 : 1] ?? "";
  return lang === "uk"
    ? `N = ${n} інтерв'ю; ${who}. ${read} Імена учасників(ць) змінено.`
    : `N = ${n} interviews; ${who}. ${read} Participant names are pseudonyms.`;
}

// ---------- groups by participant characteristics (4.4) ----------

/**
 * Splits interviews into groups by a characteristic: each value for choices and text;
 * numbers with more than four values — at the median ("до m" / "понад m"). Empty → «не вказано».
 */
export function groupBy(items: { id: string; value: string }[], numeric: boolean): { name: string; ids: string[] }[] {
  const by = new Map<string, string[]>();
  const add = (k: string, id: string) => by.set(k, [...(by.get(k) ?? []), id]);
  const nums = items.map((x) => ({ ...x, n: parseFloat(x.value.replace(",", ".")) }));
  const known = nums.filter((x) => x.value.trim() && !Number.isNaN(x.n));
  if (numeric && new Set(known.map((x) => x.n)).size > 4) {
    const sorted = known.map((x) => x.n).sort((a, b) => a - b);
    const m = sorted[Math.floor((sorted.length - 1) / 2)];
    for (const x of nums) add(!x.value.trim() || Number.isNaN(x.n) ? "не вказано" : x.n <= m ? `до ${m} включно` : `понад ${m}`, x.id);
    return [...by].map(([name, ids]) => ({ name, ids })).sort((a, b) => (a.name === "не вказано" ? 1 : b.name === "не вказано" ? -1 : a.name.startsWith("до") ? -1 : 1));
  }
  for (const x of items) add(x.value.trim() || "не вказано", x.id);
  const order = (a: string) => (a === "не вказано" ? 1 : 0);
  return [...by].map(([name, ids]) => ({ name, ids }))
    .sort((a, b) => order(a.name) - order(b.name) || (numeric ? parseFloat(a.name) - parseFloat(b.name) : a.name.localeCompare(b.name, "uk")));
}

/** Share of people in a group whose interviews have the code (not fragments: one talkative person counts once). */
export function shareWithCode(apps: App[], code: string, ids: string[]): number {
  const has = new Set(apps.filter((a) => a.code === code).map((a) => a.iv));
  return ids.length ? ids.filter((id) => has.has(id)).length / ids.length : 0;
}
