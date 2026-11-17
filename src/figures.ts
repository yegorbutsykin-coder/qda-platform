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

type Frag = { code: string; iv: string; rep: number; s: number; e: number; by: Set<string>; apps: App[] };

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
