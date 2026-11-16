// Project data as the window keeps it. `Shared` goes into the project's main part (and, from step 3,
// into packages for colleagues); `Private` holds originals and the dictionary and stays with the owner.
import { applyDict, joinSegments, type DictEntry, type Replica, type Role } from "./text";
import type { App, Cat, Code, Levels, Super } from "./coding";

export type FieldType = "text" | "number" | "choice";
export type Field = { id: string; name: string; type: FieldType; options?: string[] };
export type Card = { pseudonym: string; age: string; gender: string; date: string; values: Record<string, string>; consent: boolean };
/** `id`: stays with the replica through edits, so codes and comments from colleagues land in the right place (stage 3). */
export type SharedReplica = { id?: string; t: string | null; role: Role | null; text: string };
export type Tx = { state: "running" | "error" | "interrupted"; model: string; lang: string; error?: string };
export type Interview = { id: string; n: number; card: Card; replicas: SharedReplica[]; added: number; audio?: "kept" | "deleted"; tx?: Tx };
export type AudioRef = { path: string; fp: string; name: string };
/** `counter`: marked as a counter-intuitive reading (stage 3.4). */
export type Note = {
  text: string; by: string; at: number; counter?: boolean;
  /** Supervision (stage 3.5): a remark goes open → fixed (by the student, maybe with a reply) → closed or reopened. */
  status?: "open" | "fixed" | "closed"; statusAt?: number; reply?: { text: string; by: string; at: number };
};
/** A researcher in the project: codes, coding and comments carry their profile id in `by`. */
export type Person = { name: string; initials: string };
export type Shared = { fields: Field[]; interviews: Interview[]; codes: Code[]; apps: App[]; notes: Record<string, Note>; cats: Cat[]; supers: Super[]; levels?: Levels; people?: Record<string, Person>; copyOf?: CopyOf;
  /** Saturation mark: this many coded interviews in a row without new codes (stage 3.6). */
  satN?: number };
/** Set in a project made from a received package: whose project it copies, and when it came. */
export type CopyOf = { project: string; from: Person & { id: string }; kind: "copy" | "supervisor"; stage?: string; sent: number; received: number; blind: boolean };
export type OrigReplica = Replica & { role: Role | null; id?: string };
export type Private = { originals: Record<string, OrigReplica[]>; dict: DictEntry[]; ignored: string[]; audio: Record<string, AudioRef> };

export const emptyShared = (): Shared => ({ fields: [], interviews: [], codes: [], apps: [], notes: {}, cats: [], supers: [] });
export const noteKey = (iv: string, rep: number) => `${iv}:${rep}`;
export const emptyPrivate = (): Private => ({ originals: {}, dict: [], ignored: [], audio: {} });
export const newId = () => crypto.randomUUID();
export const GENDERS = ["жінка", "чоловік", "інше", "не вказано"];

/** Texts with replacements are always recomputed from the originals, never edited by hand. */
export function rebuild(shared: Shared, priv: Private): Shared {
  return {
    ...shared,
    interviews: shared.interviews.map((iv) => ({
      ...iv,
      replicas: (priv.originals[iv.id] ?? []).map((r) => ({ id: r.id, t: r.t, role: r.role, text: joinSegments(applyDict(r.text, priv.dict, iv.id)) })),
    })),
  };
}

export const pad = (n: number) => String(n).padStart(2, "0");
export const speaker = (role: Role | null, card: Card) => (role === "i" ? "І" : role === "p" ? card.pseudonym || "Уч." : role === "o" ? "Інше" : "");

/**
 * Every replica gets a lasting id (older projects get theirs on opening; a repeated id — e.g. both
 * halves of a split — gets a new one). Returns the same object when nothing was missing.
 */
export function ensureIds(priv: Private, make: () => string = newId): Private {
  let changed = false;
  const originals: Record<string, OrigReplica[]> = {};
  for (const [iv, list] of Object.entries(priv.originals)) {
    const seen = new Set<string>();
    originals[iv] = list.map((r) => {
      if (r.id && !seen.has(r.id)) { seen.add(r.id); return r; }
      changed = true;
      const id = make();
      seen.add(id);
      return { ...r, id };
    });
  }
  return changed ? { ...priv, originals } : priv;
}

/**
 * Puts the current person into `people`. Projects from before stage 3 marked authorship with initials:
 * all of it is the owner's, so those marks become the owner's profile id. Same object if nothing changed.
 */
export function adoptPeople(s: Shared, me: Person & { id: string }): Shared {
  if (s.people?.[me.id]) return s;
  const people = { ...(s.people ?? {}), [me.id]: { name: me.name, initials: me.initials } };
  if (s.people) return { ...s, people };
  const fix = <T extends { by: string }>(x: T): T => (x.by === me.initials ? { ...x, by: me.id } : x);
  return {
    ...s, people,
    codes: s.codes.map(fix), apps: s.apps.map(fix),
    notes: Object.fromEntries(Object.entries(s.notes).map(([k, n]) => [k, fix(n)])),
  };
}

/** Initials to show for an author. */
export const initialsOf = (s: Pick<Shared, "people">, by: string) => s.people?.[by]?.initials ?? by;
