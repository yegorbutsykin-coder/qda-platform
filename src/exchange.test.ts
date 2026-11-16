import { describe, expect, it } from "vitest";
import { applyMerge, buildReturn, planMerge, shownToOrig, updateCopy } from "./exchange";
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

describe("supervision through files", () => {
  const student = { id: "st", name: "Олена Коваль", initials: "ОК" };
  const sup = { id: "sv", name: "Єгор Буцикін", initials: "ЄБ" };
  const text = "Мені було страшно.";
  const sPriv: Private = { ...emptyPrivate(), originals: { iv: [{ id: "r1", t: null, label: null, role: "p", text }] } };
  const s0: Shared = {
    ...emptyShared(), people: { st: student },
    interviews: [{ id: "iv", n: 1, card: { pseudonym: "Марта" } as never, replicas: [{ id: "r1", t: null, role: "p", text }], added: 0 }],
    codes: [{ id: "c1", name: "страх", color: "#000", by: "st", at: 1 }],
  };
  const copyOf = (sent: number) => ({ project: "S", from: student, kind: "supervisor" as const, sent, received: sent, blind: false });

  it("remark → fixed with a reply → closed, each side keeping the latest status", () => {
    // The supervisor's copy, with a remark on the replica and one on the code.
    const c1 = updateCopy({ ...emptyShared() }, emptyPrivate(), sup, s0, copyOf(1));
    c1.shared.notes = {
      "iv:0:sv": { text: "Чому тут «страх», а не «тривога»?", by: "sv", at: 10, status: "open", statusAt: 10 },
      "code:c1:sv": { text: "Опишіть межі коду.", by: "sv", at: 11, status: "open", statusAt: 11 },
    };
    // Back to the student.
    const ret1 = buildReturn(c1.shared, c1.priv, sup);
    let s = applyMerge(s0, planMerge(s0, sPriv, ret1), new Set());
    expect(s.notes["iv:0:sv"].status).toBe("open");
    expect(s.notes["code:c1:sv"].text).toBe("Опишіть межі коду.");
    // The student marks it fixed and answers; then sends a new version.
    s = { ...s, notes: { ...s.notes, "iv:0:sv": { ...s.notes["iv:0:sv"], status: "fixed", statusAt: 20, reply: { text: "Перейменувала на «тривога».", by: "st", at: 20 } } } };
    const c2 = updateCopy(c1.shared, c1.priv, sup, s, copyOf(2));
    expect(c2.shared.notes["iv:0:sv"].status).toBe("fixed");
    expect(c2.shared.notes["iv:0:sv"].reply?.text).toBe("Перейменувала на «тривога».");
    expect(c2.shared.notes["code:c1:sv"].status).toBe("open");
    // The supervisor closes it; the student gets "closed".
    c2.shared.notes["iv:0:sv"] = { ...c2.shared.notes["iv:0:sv"], status: "closed", statusAt: 30 };
    const s2 = applyMerge(s, planMerge(s, sPriv, buildReturn(c2.shared, c2.priv, sup)), new Set());
    expect(s2.notes["iv:0:sv"].status).toBe("closed");
    expect(s2.notes["iv:0:sv"].reply?.text).toBe("Перейменувала на «тривога».");
  });

  it("updating a copy keeps the reader's own coding", () => {
    const c1 = updateCopy({ ...emptyShared() }, emptyPrivate(), sup, s0, copyOf(1));
    c1.shared.apps = [{ id: "a", code: "c1", iv: "iv", rep: 0, s: 10, e: 17, by: "sv", at: 5 }];
    const edited = { ...s0, interviews: [{ ...s0.interviews[0], replicas: [{ id: "r1", t: null, role: "p" as const, text: "Мені тоді було страшно." }] }] };
    const c2 = updateCopy(c1.shared, c1.priv, sup, edited, copyOf(2));
    const a = c2.shared.apps.find((x) => x.by === "sv")!;
    expect("Мені тоді було страшно.".slice(a.s, a.e)).toBe("страшно");
    expect(c2.shared.copyOf?.sent).toBe(2);
  });
});
