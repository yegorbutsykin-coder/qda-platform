// Descriptive phenomenological analysis (Giorgi): the participant's description divided into sense units,
// each transformed step by step, then essential constituents and the general structure.
// A boundary between units is a mark on the original text, like a code, so the same remapping keeps it
// on its word when the transcript is edited, split or joined.
import { quote, type App } from "./coding";
import { applyDict, type DictEntry } from "./text";

export type Constituent = { id: string; name: string; desc?: string };
export type Dfa = {
  on?: boolean;
  /** Names of the transformation steps (columns), as many as the researcher wants. */
  steps: string[];
  /** Boundaries: a unit starts at `s` (e = s + 1 only so code remapping keeps it). */
  cuts: App[];
  /** Transformations per unit id, one text per step. */
  tr: Record<string, string[]>;
  cons?: Constituent[];
  /** Unit id → constituent id. */
  of?: Record<string, string>;
  structure?: string;
};
export const emptyDfa = (): Dfa => ({ steps: ["Трансформація 1"], cuts: [], tr: {} });
export const CUT = "/";

type Rep = { role: string | null; text: string };
export type Unit = { id: string; n: number; parts: { rep: number; s: number; e: number }[] };
/** The first unit of an interview starts with no boundary. */
export const startId = (iv: string) => `${iv}:start`;

/** Units of one interview, in order: the participant's text from boundary to boundary; the interviewer's replicas are left out. */
export function unitsOf(iv: string, reps: Rep[], cuts: App[]): Unit[] {
  const mine = cuts.filter((c) => c.iv === iv);
  const out: Unit[] = [];
  let cur: Unit = { id: startId(iv), n: 0, parts: [] };
  const close = () => { if (cur.parts.some((p) => reps[p.rep].text.slice(p.s, p.e).trim())) out.push({ ...cur, n: out.length + 1 }); };
  reps.forEach((r, rep) => {
    if (r.role === "i") return;
    let at = 0;
    for (const c of mine.filter((x) => x.rep === rep && x.s < r.text.length).sort((a, b) => a.s - b.s)) {
      if (c.s > at) cur.parts.push({ rep, s: at, e: c.s });
      close();
      cur = { id: c.id, n: 0, parts: [] };
      at = c.s;
    }
    if (r.text.length > at) cur.parts.push({ rep, s: at, e: r.text.length });
  });
  close();
  return out;
}

/** A unit's words as colleagues see them: with replacements from the dictionary. */
export const unitText = (u: Unit, reps: Rep[], dict: DictEntry[], iv: string) =>
  u.parts.map((p) => quote(applyDict(reps[p.rep].text, dict, iv), p.s, p.e).trim()).filter(Boolean).join(" ");

/** A click lands inside a word: the boundary goes before that word (on a space — before the next word). */
export function wordStart(text: string, o: number): number | null {
  let x = Math.max(0, Math.min(o, text.length));
  if (x < text.length && /\s/.test(text[x])) { while (x < text.length && /\s/.test(text[x])) x++; }
  else while (x > 0 && !/\s/.test(text[x - 1])) x--;
  return x < text.length ? x : null;
}

/** A new boundary (not in an interviewer's replica, not twice in one place). */
export function addCut(d: Dfa, iv: string, rep: number, s: number, reps: Rep[], id: string, by: string): Dfa {
  if (reps[rep]?.role === "i" || d.cuts.some((c) => c.iv === iv && c.rep === rep && c.s === s)) return d;
  return { ...d, cuts: [...d.cuts, { id, code: CUT, iv, rep, s, e: s + 1, by, at: Date.now() }] };
}

/** A boundary goes: its unit joins the previous one, and so do its transformations (nothing written is lost). */
export function removeCut(d: Dfa, iv: string, reps: Rep[], cutId: string): Dfa {
  const units = unitsOf(iv, reps, d.cuts), i = units.findIndex((u) => u.id === cutId);
  const tr = { ...d.tr }, of = { ...d.of };
  const prev = i > 0 ? units[i - 1].id : null, mine = tr[cutId];
  if (prev && mine?.some((t) => t.trim())) {
    const p = tr[prev] ?? [];
    tr[prev] = d.steps.map((_, k) => [p[k] ?? "", mine[k] ?? ""].map((t) => t.trim()).filter(Boolean).join("\n"));
  }
  delete tr[cutId];
  delete of[cutId];
  return { ...d, cuts: d.cuts.filter((c) => c.id !== cutId), tr, of };
}

export const setTr = (d: Dfa, unit: string, step: number, text: string): Dfa => {
  const row = [...(d.tr[unit] ?? [])];
  while (row.length < d.steps.length) row.push("");
  row[step] = text;
  return { ...d, tr: { ...d.tr, [unit]: row } };
};
export const addStep = (d: Dfa): Dfa => ({ ...d, steps: [...d.steps, `Трансформація ${d.steps.length + 1}`] });
/** A step (column) goes with what was written in it. */
export const dropStep = (d: Dfa, k: number): Dfa => ({
  ...d, steps: d.steps.filter((_, i) => i !== k),
  tr: Object.fromEntries(Object.entries(d.tr).map(([u, row]) => [u, row.filter((_, i) => i !== k)])),
});
export const stepUsed = (d: Dfa, k: number) => Object.values(d.tr).some((row) => row[k]?.trim());
