import { describe, expect, it } from "vitest";
import { applyMerge, buildReturn, planMerge, shownToOrig } from "./exchange";
import { emptyPrivate, emptyShared, type Private, type Shared } from "./model";
import { applyDict } from "./text";

const dict = [{ id: "d", kind: "person" as const, from: ["Оксана"], to: "[ім'я]", scope: "all", caps: true }];
const owner = { id: "p1", name: "Єгор Буцикін", initials: "ЄБ" };
const colleague = { id: "p2", name: "Ірина Бойко", initials: "ІБ" };

describe("positions with replacements", () => {
  const segs = applyDict("Мене звати Оксана, я з Києва.", dict, "iv");
  it("maps plain text and whole replaced words", () => {
    // shown: "Мене звати [ім'я], я з Києва."
    expect(shownToOrig(segs, 0, false)).toBe(0);
    expect(shownToOrig(segs, 11, false)).toBe(11); // start of [ім'я] → start of Оксана
    expect(shownToOrig(segs, 13, false)).toBe(11); // inside → start of the word
    expect(shownToOrig(segs, 17, true)).toBe(17); // end of [ім'я] (6 chars) → end of Оксана (6 chars)
    expect(shownToOrig(segs, 14, true)).toBe(17); // inside → whole word
    expect(shownToOrig(segs, 29, true)).toBe(29);
  });
});

describe("a colleague's changes come back", () => {
  const text = "Мене звати Оксана, я з Києва.";
  const ownerPriv: Private = { ...emptyPrivate(), dict, originals: { iv: [{ id: "r1", t: null, label: null, role: "p", text }] } };
  const ownerShared: Shared = {
    ...emptyShared(), people: { p1: owner },
    interviews: [{ id: "iv", n: 1, card: { pseudonym: "Марта" } as never, replicas: [], added: 0 }],
    codes: [{ id: "c1", name: "місце", color: "#000", by: "p1", at: 1 }],
  };
  // The colleague's copy: the "original" there is the text with replacements.
  const shown = "Мене звати [ім'я], я з Києва.";
  const copyPriv: Private = { ...emptyPrivate(), originals: { iv: [{ id: "r1", t: null, label: null, role: "p", text: shown }] } };
  const at = (w: string) => ({ s: shown.indexOf(w), e: shown.indexOf(w) + w.length });
  const copyShared: Shared = {
    ...ownerShared, people: { p1: owner, p2: colleague }, copyOf: { project: "P", from: owner, kind: "copy", sent: 1, received: 2, blind: false },
    codes: [{ id: "c1", name: "місто", color: "#000", by: "p1", at: 1 }, { id: "c2", name: "ім'я як опора", color: "#111", by: "p2", at: 3, cat: "k" }],
    apps: [
      { id: "a1", code: "c2", iv: "iv", rep: 0, ...at("[ім'я], я з Києва"), by: "p2", at: 4 },
      { id: "a2", code: "c1", iv: "iv", rep: 0, ...at("з Києва"), by: "p2", at: 5 },
      { id: "a3", code: "c1", iv: "iv", rep: 0, ...at("Мене"), by: "p1", at: 1 }, // the owner's: not sent back
    ],
    notes: { "iv:0": { text: "власника", by: "p1", at: 1 }, "iv:0:p2": { text: "думка колеги", by: "p2", at: 6 } },
  };
  const body = buildReturn(copyShared, copyPriv, colleague);

  it("sends only the colleague's own work", () => {
    expect(body.apps.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(body.notes.map((n) => n.text)).toEqual(["думка колеги"]);
    expect(body.project.id).toBe("P");
  });

  it("lands on the owner's original words, following an edit made since", () => {
    const edited = "Мене звати Оксана, я родом з Києва.";
    const priv2 = { ...ownerPriv, originals: { iv: [{ ...ownerPriv.originals.iv[0], text: edited }] } };
    const plan = planMerge(ownerShared, priv2, body);
    expect(plan.apps.map((a) => edited.slice(a.s, a.e))).toEqual(["Оксана, я родом з Києва", "з Києва"]);
    expect(plan.newCodes.map((c) => [c.name, c.cat])).toEqual([["ім'я як опора", undefined]]);
    expect(plan.renamed).toEqual([{ id: "c1", mine: "місце", theirs: "місто" }]);
    expect(plan.unplaced).toBe(0);
    const merged = applyMerge(ownerShared, plan, new Set());
    expect(merged.codes.map((c) => c.name)).toEqual(["місце", "ім'я як опора"]);
    expect(merged.notes["iv:0:p2"].text).toBe("думка колеги");
    expect(merged.people!.p2.name).toBe("Ірина Бойко");
    // The same package again adds nothing twice; accepting the rename takes their name.
    const again = applyMerge(merged, planMerge(merged, priv2, body), new Set(["c1"]));
    expect(again.apps.length).toBe(2);
    expect(again.codes.map((c) => c.name)).toEqual(["місто", "ім'я як опора"]);
  });

  it("counts what cannot be placed (replica deleted since)", () => {
    const plan = planMerge(ownerShared, { ...ownerPriv, originals: { iv: [] } }, body);
    expect(plan.apps.length).toBe(0);
    expect(plan.unplaced).toBe(3);
  });
});
