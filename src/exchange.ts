// Stage 3.3: a colleague's changes travel back and join the owner's project.
// Codes in the colleague's copy sit on the text with replacements; the owner's sit on the original.

import { remapApps, type App, type Code } from "./coding";
import { noteKey, type Note, type Person, type Private, type Shared } from "./model";
import { applyDict, joinSegments, type Segment } from "./text";

export type ReturnBody = {
  kind: "return";
  sent: number;
  from: Person & { id: string };
  project: { id: string };
  codes: Code[];
  /** Coding by `from`, placed by replica id. */
  apps: (Omit<App, "iv" | "rep"> & { rid: string })[];
  notes: { rid: string; text: string; at: number; counter?: boolean }[];
  /** The text each replica had in the copy, to follow the owner's later edits. */
  texts: Record<string, string>;
};

/** Everything the colleague did in the copy: their coding, codes and comments (never anyone else's). */
export function buildReturn(s: Shared, p: Private, me: Person & { id: string }): ReturnBody {
  const rid = (iv: string, rep: number) => p.originals[iv]?.[rep]?.id;
  const texts: Record<string, string> = {};
  const used = (iv: string, rep: number) => {
    const r = p.originals[iv]?.[rep];
    if (r?.id) texts[r.id] = r.text;
    return r?.id;
  };
  const apps = s.apps.filter((a) => a.by === me.id && rid(a.iv, a.rep)).map(({ iv, rep, ...a }) => ({ ...a, rid: used(iv, rep)! }));
  const notes = Object.entries(s.notes).flatMap(([k, n]) => {
    if (n.by !== me.id || !n.text.trim()) return [];
    const [iv, rep] = [k.slice(0, k.indexOf(":")), parseInt(k.slice(k.indexOf(":") + 1))];
    const id = used(iv, rep);
    return id ? [{ rid: id, text: n.text, at: n.at, ...(n.counter ? { counter: true } : {}) }] : [];
  });
  return {
    kind: "return", sent: Date.now(), from: me,
    project: { id: s.copyOf!.project },
    codes: s.codes, apps, notes, texts,
  };
}

/** A position in the text with replacements → in the original (inside a replaced word: the whole word). */
export function shownToOrig(segs: Segment[], x: number, end: boolean): number {
  let o = 0, r = 0;
  for (const g of segs) {
    const rl = g.text.length, ol = (g.orig ?? g.text).length;
    if (end ? x <= r + rl : x < r + rl) {
      if (g.orig === undefined) return o + Math.max(0, x - r);
      return end ? (x <= r ? o : o + ol) : o;
    }
    o += ol; r += rl;
  }
  return o;
}

export type MergePlan = {
  from: Person & { id: string };
  newCodes: Code[];
  renamed: { id: string; mine: string; theirs: string }[];
  apps: App[];
  notes: Record<string, Note>;
  unplaced: number;
  /** How much of this person's earlier changes is replaced (a repeated package adds nothing twice). */
  before: { apps: number; notes: number };
};

export function planMerge(s: Shared, p: Private, b: ReturnBody): MergePlan {
  const where = new Map<string, { iv: string; rep: number; segs: Segment[]; shown: string }>();
  for (const [iv, list] of Object.entries(p.originals)) {
    list.forEach((r, rep) => {
      if (!r.id) return;
      const segs = applyDict(r.text, p.dict, iv);
      where.set(r.id, { iv, rep, segs, shown: joinSegments(segs) });
    });
  }
  const mine = new Map(s.codes.map((c) => [c.id, c]));
  const newCodes = b.codes.filter((c) => !mine.has(c.id)).map(({ cat: _cat, ...c }) => c);
  const known = new Set([...mine.keys(), ...newCodes.map((c) => c.id)]);
  const renamed = b.codes.flatMap((c) => {
    const m = mine.get(c.id);
    return m && m.name !== c.name ? [{ id: c.id, mine: m.name, theirs: c.name }] : [];
  });
  let unplaced = 0;
  const apps: App[] = [];
  for (const { rid, ...a } of b.apps) {
    const w = where.get(rid);
    const was = b.texts[rid];
    // The owner may have edited the text since: move the code with its words.
    const moved = !w || was === undefined || was === w.shown ? [{ ...a, iv: "x", rep: 0 }] : remapApps([{ ...a, iv: "x", rep: 0 }], "x", 0, was, w.shown);
    if (!w || !known.has(a.code) || !moved.length) { unplaced++; continue; }
    const st = shownToOrig(w.segs, moved[0].s, false), en = shownToOrig(w.segs, moved[0].e, true);
    if (en <= st) { unplaced++; continue; }
    apps.push({ ...a, iv: w.iv, rep: w.rep, s: st, e: en, by: b.from.id });
  }
  const notes: Record<string, Note> = {};
  for (const n of b.notes) {
    const w = where.get(n.rid);
    if (!w) { unplaced++; continue; }
    const k = `${noteKey(w.iv, w.rep)}:${b.from.id}`;
    notes[k] = notes[k] ? { ...notes[k], text: notes[k].text + "\n\n" + n.text } : { text: n.text, by: b.from.id, at: n.at, ...(n.counter ? { counter: true } : {}) };
  }
  return {
    from: b.from, newCodes, renamed, apps, notes, unplaced,
    before: { apps: s.apps.filter((a) => a.by === b.from.id).length, notes: Object.values(s.notes).filter((n) => n.by === b.from.id).length },
  };
}

/** The owner's project with the colleague's changes; `take`: renamed codes whose new name is accepted. */
export function applyMerge(s: Shared, m: MergePlan, take: Set<string>): Shared {
  const theirs = new Map(m.renamed.map((r) => [r.id, r.theirs]));
  return {
    ...s,
    people: { ...(s.people ?? {}), [m.from.id]: { name: m.from.name, initials: m.from.initials } },
    codes: [...s.codes.map((c) => (take.has(c.id) ? { ...c, name: theirs.get(c.id)! } : c)), ...m.newCodes],
    apps: [...s.apps.filter((a) => a.by !== m.from.id), ...m.apps],
    notes: { ...Object.fromEntries(Object.entries(s.notes).filter(([, n]) => n.by !== m.from.id)), ...m.notes },
  };
}
