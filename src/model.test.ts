import { describe, expect, it } from "vitest";
import { adoptPeople, emptyPrivate, emptyShared, ensureIds, initialsOf } from "./model";

describe("lasting replica ids", () => {
  const rep = (text: string, id?: string) => ({ t: null, label: null, role: null, text, ...(id ? { id } : {}) });
  it("adds missing ids, renews repeated ones, keeps the rest", () => {
    let n = 0;
    const p = { ...emptyPrivate(), originals: { a: [rep("раз", "x"), rep("два"), rep("три", "x")] } };
    const q = ensureIds(p, () => "n" + n++);
    expect(q.originals.a.map((r) => r.id)).toEqual(["x", "n0", "n1"]);
    expect(q.originals.a.map((r) => r.text)).toEqual(["раз", "два", "три"]);
    expect(ensureIds(q)).toBe(q); // nothing to do: the same object, so nothing is rebuilt or saved
  });
});

describe("authors", () => {
  const me = { id: "p1", name: "Єгор Буцикін", initials: "ЄБ" };
  it("older projects: initials become the owner's id, once", () => {
    const s = { ...emptyShared(), codes: [{ id: "c", name: "страх", color: "#000", by: "ЄБ", at: 1 }],
      apps: [{ id: "a", code: "c", iv: "i", rep: 0, s: 0, e: 2, by: "ЄБ", at: 1 }], notes: { "i:0": { text: "т", by: "ЄБ", at: 1 } } };
    const t = adoptPeople(s, me);
    expect([t.codes[0].by, t.apps[0].by, t.notes["i:0"].by]).toEqual(["p1", "p1", "p1"]);
    expect(initialsOf(t, "p1")).toBe("ЄБ");
    expect(adoptPeople(t, me)).toBe(t);
  });
  it("a copy from a colleague: adds me, changes nobody's marks", () => {
    const s = { ...emptyShared(), people: { p1: { name: "Єгор", initials: "ЄБ" } }, apps: [{ id: "a", code: "c", iv: "i", rep: 0, s: 0, e: 2, by: "p1", at: 1 }] };
    const t = adoptPeople(s, { id: "p2", name: "Ірина Бойко", initials: "ЄБ" });
    expect(Object.keys(t.people!)).toEqual(["p1", "p2"]);
    expect(t.apps[0].by).toBe("p1");
  });
});
