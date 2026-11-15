// Coding: codes are anchored to the ORIGINAL text of a replica (which never changes),
// so editing the replacement dictionary never shifts them. Display maps them onto
// either view. Pure functions: tested in coding.test.ts.
import type { Segment } from "./text";

export type Code = { id: string; name: string; color: string; by: string; at: number; note?: string };
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
