// Project data as the window keeps it. `Shared` goes into the project's main part (and, from step 3,
// into packages for colleagues); `Private` holds originals and the dictionary and stays with the owner.
import { applyDict, joinSegments, type DictEntry, type Replica, type Role } from "./text";
import type { App, Cat, Code, Levels, Super } from "./coding";

export type FieldType = "text" | "number" | "choice";
export type Field = { id: string; name: string; type: FieldType; options?: string[] };
export type Card = { pseudonym: string; age: string; gender: string; date: string; values: Record<string, string>; consent: boolean };
export type SharedReplica = { t: string | null; role: Role | null; text: string };
export type Interview = { id: string; n: number; card: Card; replicas: SharedReplica[]; added: number };
export type Note = { text: string; by: string; at: number };
export type Shared = { fields: Field[]; interviews: Interview[]; codes: Code[]; apps: App[]; notes: Record<string, Note>; cats: Cat[]; supers: Super[]; levels?: Levels };
export type OrigReplica = Replica & { role: Role | null };
export type Private = { originals: Record<string, OrigReplica[]>; dict: DictEntry[]; ignored: string[] };

export const emptyShared = (): Shared => ({ fields: [], interviews: [], codes: [], apps: [], notes: {}, cats: [], supers: [] });
export const noteKey = (iv: string, rep: number) => `${iv}:${rep}`;
export const emptyPrivate = (): Private => ({ originals: {}, dict: [], ignored: [] });
export const newId = () => crypto.randomUUID();
export const GENDERS = ["жінка", "чоловік", "інше", "не вказано"];

/** Texts with replacements are always recomputed from the originals, never edited by hand. */
export function rebuild(shared: Shared, priv: Private): Shared {
  return {
    ...shared,
    interviews: shared.interviews.map((iv) => ({
      ...iv,
      replicas: (priv.originals[iv.id] ?? []).map((r) => ({ t: r.t, role: r.role, text: joinSegments(applyDict(r.text, priv.dict, iv.id)) })),
    })),
  };
}

export const pad = (n: number) => String(n).padStart(2, "0");
export const speaker = (role: Role | null, card: Card) => (role === "i" ? "І" : role === "p" ? card.pseudonym || "Уч." : role === "o" ? "Інше" : "");
