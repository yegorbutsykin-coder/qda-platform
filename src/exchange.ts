// Stage 3.3: a colleague's changes travel back and join the owner's project.
// Codes in the colleague's copy sit on the text with replacements; the owner's sit on the original.

import { remapApps, type App, type Code } from "./coding";
import { adoptPeople, noteKey, type CopyOf, type Note, type Person, type Private, type Shared } from "./model";
import { applyDict, joinSegments, type Segment } from "./text";

export type ReturnBody = {
  kind: "return";
  sent: number;
  from: Person & { id: string };
  project: { id: string };
  codes: Code[];
  /** Coding by `from`, placed by replica id. */
  apps: (Omit<App, "iv" | "rep"> & { rid: string })[];
  /** Comments on replicas (`rid`) or on codes (`code`), with their supervision status. */
  notes: (Omit<Note, "by"> & { rid?: string; code?: string })[];
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
  const notes = Object.entries(s.notes).flatMap(([k, { by: _by, ...n }]): ReturnBody["notes"] => {
    if (_by !== me.id || !n.text.trim()) return [];
    if (k.startsWith("code:")) return [{ ...n, code: k.split(":")[1] }];
    const [iv, rep] = [k.slice(0, k.indexOf(":")), parseInt(k.slice(k.indexOf(":") + 1))];
    const id = used(iv, rep);
    return id ? [{ ...n, rid: id }] : [];
  });
  return {
    kind: "return", sent: Date.now(), from: me,
    project: { id: s.copyOf?.project ?? "" },
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
  for (const { rid, code, ...n } of b.notes) {
    const w = rid ? where.get(rid) : undefined;
    const k = code ? (known.has(code) ? `code:${code}:${b.from.id}` : "") : w ? `${noteKey(w.iv, w.rep)}:${b.from.id}` : "";
    if (!k) { unplaced++; continue; }
    notes[k] = notes[k] ? { ...notes[k], text: notes[k].text + "\n\n" + n.text } : { ...n, by: b.from.id };
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
    notes: {
      ...Object.fromEntries(Object.entries(s.notes).filter(([, n]) => n.by !== m.from.id)),
      // The text is the author's; the status is whoever changed it last (the student marks "fixed" here).
      ...Object.fromEntries(Object.entries(m.notes).map(([k, n]) => [k, laterStatus(n, s.notes[k])])),
    },
  };
}

/** Of two versions of one remark: the incoming text, with the status changed most recently. */
export function laterStatus(incoming: Note, here?: Note): Note {
  if (!here?.status || (incoming.statusAt ?? 0) >= (here.statusAt ?? 0)) return incoming;
  return { ...incoming, status: here.status, statusAt: here.statusAt, reply: here.reply };
}

/** A copy's private part: its "originals" are the texts with replacements. */
export const copyPrivate = (data: Shared): Private => ({
  originals: Object.fromEntries(data.interviews.map((x) => [x.id, x.replicas.map((r) => ({ id: r.id, t: r.t, label: null, role: r.role, text: r.text }))])),
  dict: [], ignored: [], audio: {},
});

/**
 * A newer package of the same project replaces a copy; this person's own work in the old copy
 * (coding, codes, comments, remark statuses) is laid onto it the same way as when changes return.
 */
export function updateCopy(old: Shared, oldPriv: Private, me: Person & { id: string }, data: Shared, copyOf: CopyOf): { shared: Shared; priv: Private; unplaced: number } {
  const priv = copyPrivate(data);
  const fresh = adoptPeople({ ...data, copyOf }, me);
  const plan = planMerge(fresh, priv, buildReturn(old, oldPriv, me));
  // Remarks of others whose status was changed here (e.g. the student marked "fixed") keep the later status.
  const merged = applyMerge(fresh, plan, new Set());
  const notes = Object.fromEntries(Object.entries(merged.notes).map(([k, n]) => [k, n.by === me.id ? n : laterStatus(n, old.notes[k])]));
  return { shared: { ...merged, notes }, priv, unplaced: plan.unplaced };
}
