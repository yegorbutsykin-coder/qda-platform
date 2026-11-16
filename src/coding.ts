// Coding: codes are anchored to the ORIGINAL text of a replica, so editing the
// replacement dictionary never shifts them; editing the text itself goes through remapApps. Display maps them onto
// either view. Pure functions: tested in coding.test.ts.
import type { Segment } from "./text";

export type Code = { id: string; name: string; color: string; by: string; at: number; note?: string; cat?: string };
export type Cat = { id: string; name: string; color: string; sup?: string };
export type Super = { id: string; name: string; desc: string };
export type Levels = { top: string; mid: string };

/** Names of the two upper levels by method; editable in the project. */
export const LEVELS: Record<string, Levels> = {
  "ІФА": { top: "Групова досвідна тема", mid: "Підтема" },
  "РТА": { top: "Загальна тема", mid: "Тема" },
  "Дескр.": { top: "Складник структури", mid: "Аспект" },
  "": { top: "Супертема", mid: "Тема" },
};
export const CAT_COLORS = ["#2E5E8C", "#B3401A", "#3D7A3A", "#7A4A9A", "#A87900", "#2F7F7F"];

/**
 * Merges codes into `keep` (renamed to `name`): every application moves over; one person's
 * overlapping pieces of the merged code on the same replica become one; notes are joined.
 */
export function mergeCodes(codes: Code[], apps: App[], ids: string[], keep: string, name: string): { codes: Code[]; apps: App[] } {
  const gone = new Set(ids.filter((id) => id !== keep));
  const notes = codes.filter((c) => ids.includes(c.id) && c.note?.trim()).map((c) => c.note!.trim());
  const nextCodes = codes.filter((c) => !gone.has(c.id)).map((c) => (c.id === keep ? { ...c, name, note: notes.join("\n\n") || undefined } : c));
  const moved = apps.map((a) => (gone.has(a.code) ? { ...a, code: keep } : a));
  const others = moved.filter((a) => a.code !== keep);
  const mine = moved.filter((a) => a.code === keep).sort((a, b) => a.iv.localeCompare(b.iv) || a.rep - b.rep || a.by.localeCompare(b.by) || a.s - b.s);
  const out: App[] = [];
  for (const a of mine) {
    const last = out[out.length - 1];
    if (last && last.iv === a.iv && last.rep === a.rep && last.by === a.by && a.s <= last.e) last.e = Math.max(last.e, a.e);
    else out.push({ ...a });
  }
  return { codes: nextCodes, apps: [...others, ...out] };
}
export type App = { id: string; code: string; iv: string; rep: number; s: number; e: number; by: string; at: number };
export type Piece = { o: number; len: number; text: string; kind: "plain" | "repl" | "orig"; codes: string[] };

/** Original-text ranges of the dictionary pieces of one replica. */
function ranges(segs: Segment[]) {
  let o = 0;
  return segs.map((s) => {
    const len = s.orig === undefined ? s.text.length : s.orig.length;
    const r = { o, len, seg: s };
    o += len;
    return r;
  });
}

/** Moves a range outwards so it never cuts through a replaced word. */
export function snap(segs: Segment[], s: number, e: number): [number, number] {
  for (const r of ranges(segs)) {
    if (r.seg.orig === undefined) continue;
    if (s > r.o && s < r.o + r.len) s = r.o;
    if (e > r.o && e < r.o + r.len) e = r.o + r.len;
  }
  return [s, e];
}

/** Cuts a replica into pieces with the codes that cover each, for either view. */
export function pieces(segs: Segment[], apps: App[], original: boolean): Piece[] {
  const rs = ranges(segs);
  const spans = apps.map((a) => ({ a, r: snap(segs, a.s, a.e) }));
  const cuts = new Set<number>();
  spans.forEach(({ r }) => { cuts.add(r[0]); cuts.add(r[1]); });
  const out: Piece[] = [];
  for (const r of rs) {
    const bounds = [r.o, ...[...cuts].filter((c) => c > r.o && c < r.o + r.len && r.seg.orig === undefined).sort((x, y) => x - y), r.o + r.len];
    for (let i = 0; i < bounds.length - 1; i++) {
      const o = bounds[i], len = bounds[i + 1] - o;
      if (!len) continue;
      const codes = spans.filter(({ r: [s, e] }) => s <= o && e >= o + len).map(({ a }) => a.code);
      const text = r.seg.orig === undefined ? r.seg.text.slice(o - r.o, o - r.o + len) : original ? r.seg.orig : r.seg.text;
      out.push({ o, len, text, kind: r.seg.orig === undefined ? "plain" : original ? "orig" : "repl", codes: [...new Set(codes)] });
    }
  }
  return out;
}

/** The text of a range as colleagues see it (with replacements). */
export function quote(segs: Segment[], s: number, e: number): string {
  return pieces(segs, [{ id: "", code: "", iv: "", rep: 0, s, e, by: "", at: 0 }], false)
    .filter((p) => p.codes.length)
    .map((p) => p.text)
    .join("")
    .trim();
}

/** Status of each interview: no codes; brings new codes (first used here); only existing codes. */
export function statuses(order: { id: string }[], apps: App[]): Record<string, "none" | "new" | "existing"> {
  const first = new Map<string, number>();
  const pos = new Map(order.map((iv, i) => [iv.id, i]));
  for (const a of apps) {
    const p = pos.get(a.iv) ?? Infinity;
    if (p < (first.get(a.code) ?? Infinity)) first.set(a.code, p);
  }
  return Object.fromEntries(order.map((iv, i) => {
    const mine = apps.filter((a) => a.iv === iv.id);
    return [iv.id, !mine.length ? "none" : mine.some((a) => first.get(a.code) === i) ? "new" : "existing"];
  }));
}

// ---------- colours ----------

function lab(hex: string): [number, number, number] {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92));
  const [x, y, z] = [
    (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047,
    c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722,
    (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883,
  ].map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function hsl(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

// Mid-dark tones only: an underline must stay visible on the light paper.
const CANDIDATES = Array.from({ length: 36 }, (_, i) => i * 10).flatMap((h) => [hsl(h, 0.62, 0.42), hsl(h, 0.5, 0.3)]);
const PAPER = ["#FBFAF6", "#FFFFFF"];

/** The candidate colour farthest (CIE Lab) from all colours already in use. */
export function nextColor(used: string[]): string {
  const taken = [...used, ...PAPER].map(lab);
  let best = CANDIDATES[0], bestD = -1;
  for (const c of CANDIDATES) {
    const l = lab(c);
    const d = Math.min(...taken.map((t) => Math.hypot(l[0] - t[0], l[1] - t[1], l[2] - t[2])));
    if (d > bestD) { bestD = d; best = c; }
  }
  return best;
}

export const labDistance = (a: string, b: string) => {
  const x = lab(a), y = lab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

/**
 * After the original text of a replica is edited, keeps every code on the same words:
 * the changed stretch is found from the common start and end; codes after it move,
 * codes inside it stretch or shrink with it. A code whose words were all deleted disappears.
 */
export function remapApps(apps: App[], iv: string, rep: number, before: string, after: string): App[] {
  let a = 0;
  while (a < before.length && a < after.length && before[a] === after[a]) a++;
  let bEnd = before.length, aEnd = after.length;
  while (bEnd > a && aEnd > a && before[bEnd - 1] === after[aEnd - 1]) { bEnd--; aEnd--; }
  const delta = aEnd - bEnd;
  const move = (x: number, isEnd: boolean) => (x <= a ? x : x >= bEnd ? x + delta : isEnd ? aEnd : a);
  return apps
    .map((x) => (x.iv !== iv || x.rep !== rep ? x : { ...x, s: move(x.s, false), e: move(x.e, true) }))
    .filter((x) => x.e > x.s);
}

/**
 * Replica `rep` goes away: deleted with its codes and comment, or, with `into`, glued onto
 * the end of the previous replica (its codes move by `offset`, comments are joined).
 * Later replicas move up by one.
 */
export function dropReplica(
  apps: App[], notes: Record<string, { text: string }>, iv: string, rep: number, into?: { offset: number },
): { apps: App[]; notes: Record<string, any> } {
  const out = apps.flatMap((a) => {
    if (a.iv !== iv || a.rep < rep) return [a];
    if (a.rep > rep) return [{ ...a, rep: a.rep - 1 }];
    return into ? [{ ...a, rep: rep - 1, s: a.s + into.offset, e: a.e + into.offset }] : [];
  });
  const key = (r: number) => `${iv}:${r}`;
  const next: Record<string, any> = {};
  for (const [k, n] of Object.entries(notes)) {
    const r = k.startsWith(iv + ":") ? Number(k.slice(iv.length + 1)) : -1;
    if (r < rep) next[k] = n;
    else if (r > rep) next[key(r - 1)] = n;
    else if (into) next[key(rep - 1)] = next[key(rep - 1)] ? { ...n, text: next[key(rep - 1)].text + "\n\n" + n.text } : n;
  }
  return { apps: out, notes: next };
}

/**
 * Replica `rep` (text `text`) is cut at `pos` into two; spaces at the cut are dropped.
 * Codes go with their words (a code across the cut becomes two), the comment stays
 * with the first part, later replicas move down by one.
 */
export function splitReplica(
  apps: App[], notes: Record<string, any>, iv: string, rep: number, text: string, pos: number, newId: () => string,
): { first: string; second: string; apps: App[]; notes: Record<string, any> } {
  const first = text.slice(0, pos).trimEnd();
  const k = pos + (text.slice(pos).length - text.slice(pos).trimStart().length);
  const second = text.slice(k);
  const out = apps.flatMap((a): App[] => {
    if (a.iv !== iv || a.rep < rep) return [a];
    if (a.rep > rep) return [{ ...a, rep: a.rep + 1 }];
    const one = { ...a, e: Math.min(a.e, first.length) };
    const two = { ...a, rep: rep + 1, s: Math.max(0, a.s - k), e: a.e - k };
    if (two.e <= two.s) return [one];
    return one.e > one.s ? [one, { ...two, id: newId() }] : [two];
  });
  const next: Record<string, any> = {};
  for (const [key, n] of Object.entries(notes)) {
    const r = key.startsWith(iv + ":") ? Number(key.slice(iv.length + 1)) : -1;
    next[r > rep ? `${iv}:${r + 1}` : key] = n;
  }
  return { first, second, apps: out, notes: next };
}
