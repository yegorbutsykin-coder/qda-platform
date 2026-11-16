import { describe, expect, it } from "vitest";
import { labDistance, mergeCodes, nextColor, pieces, dropReplica, quote, remapApps, snap, statuses, type App, type Code } from "./coding";
import { applyDict, type DictEntry } from "./text";

const dict: DictEntry[] = [{ id: "d", kind: "person", from: ["Оксана"], to: "[ім'я]", scope: "all", caps: true }];
const text = "Ми з Оксаною поїхали до міста.";
const segs = applyDict(text, dict, "1");
const app = (s: number, e: number, code = "c1"): App => ({ id: code + s, code, iv: "1", rep: 0, s, e, by: "ЄБ", at: 0 });

describe("anchoring codes", () => {
  it("snaps ranges out of replaced words", () => {
    expect(snap(segs, 7, 20)).toEqual([5, 20]); // started inside "Оксаною"
    expect(snap(segs, 0, 8)).toEqual([0, 12]);
  });

  it("pieces show codes in both views", () => {
    const ps = pieces(segs, [app(0, 20)], false);
    expect(ps.map((p) => [p.text, p.codes.length])).toEqual([["Ми з ", 1], ["[ім'я]", 1], [" поїхали", 1], [" до міста.", 0]]);
    const po = pieces(segs, [app(0, 20)], true);
    expect(po.map((p) => p.text).join("")).toBe(text);
    expect(po[1]).toMatchObject({ kind: "orig", text: "Оксаною", o: 5, len: 7 });
  });

  it("overlapping codes", () => {
    const ps = pieces(segs, [app(0, 20, "a"), app(13, 29, "b")], false);
    expect(ps.map((p) => [p.text, p.codes.join("+")])).toEqual([
      ["Ми з ", "a"], ["[ім'я]", "a"], [" ", "a"], ["поїхали", "a+b"], [" до міста", "b"], [".", ""],
    ]);
  });

  it("quotes with replacements only", () => {
    expect(quote(segs, 0, 20)).toBe("Ми з [ім'я] поїхали");
  });

  it("interview statuses", () => {
    const order = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const apps: App[] = [{ ...app(0, 5, "a"), iv: "1" }, { ...app(0, 5, "a"), iv: "2" }, { ...app(0, 5, "b"), iv: "2" }];
    expect(statuses(order, apps)).toEqual({ "1": "new", "2": "new", "3": "none" });
    expect(statuses(order, apps.slice(0, 2))).toEqual({ "1": "new", "2": "existing", "3": "none" });
  });
});

describe("colours", () => {
  it("each new colour is far from the ones in use", () => {
    const used: string[] = [];
    for (let i = 0; i < 8; i++) used.push(nextColor(used));
    expect(new Set(used).size).toBe(8);
    for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) expect(labDistance(used[i], used[j])).toBeGreaterThan(15);
    expect(labDistance(used[0], "#FBFAF6")).toBeGreaterThan(40);
  });
});

describe("merging codes", () => {
  const code = (id: string, note?: string): Code => ({ id, name: id, color: "#000000", by: "ЄБ", at: 0, note, cat: id === "a" ? "cat1" : undefined });
  it("moves every fragment, joins overlaps and notes", () => {
    const apps: App[] = [
      { ...app(0, 10, "a"), id: "1" }, { ...app(5, 20, "b"), id: "2" }, { ...app(40, 50, "b"), id: "3" },
      { ...app(0, 10, "b"), id: "4", by: "ОК" }, { ...app(0, 5, "c"), id: "5" },
    ];
    const r = mergeCodes([code("a", "перша"), code("b", "друга"), code("c")], apps, ["a", "b"], "a", "Очікування");
    expect(r.codes.map((c) => [c.id, c.name, c.cat])).toEqual([["a", "Очікування", "cat1"], ["c", "c", undefined]]);
    expect(r.codes[0].note).toBe("перша\n\nдруга");
    const merged = r.apps.filter((x) => x.code === "a").map((x) => [x.by, x.s, x.e]);
    expect(merged).toEqual([["ЄБ", 0, 20], ["ЄБ", 40, 50], ["ОК", 0, 10]]);
    expect(r.apps.filter((x) => x.code === "c")).toHaveLength(1);
  });
});

describe("editing text keeps codes on their words", () => {
  const at = (t: string, w: string): [number, number] => [t.indexOf(w), t.indexOf(w) + w.length];
  const before = "Ну, це було в березні. Ми тоді ще жили в місті.";
  const apps: App[] = [
    { ...app(...at(before, "в березні"), "a"), id: "1" },
    { ...app(...at(before, "жили в місті"), "b"), id: "2" },
    { ...app(...at(before, "Ну"), "c"), id: "3" },
  ];
  it("insert before, inside and delete", () => {
    const after = "Ну, це було, мабуть, в березні. Ми тоді ще жили у місті.";
    const r = remapApps(remapApps(apps, "1", 0, before, "Ну, це було, мабуть, в березні. Ми тоді ще жили в місті."), "1", 0, "Ну, це було, мабуть, в березні. Ми тоді ще жили в місті.", after);
    const text = (x: App) => after.slice(x.s, x.e);
    expect(r.map(text)).toEqual(["в березні", "жили у місті", "Ну"]);
    const cut = "Ми тоді ще жили в місті.";
    expect(remapApps(apps, "1", 0, before, cut).map((x) => cut.slice(x.s, x.e))).toEqual(["жили в місті"]);
    expect(remapApps(apps, "1", 1, before, cut)).toEqual(apps); // another replica: untouched
  });
});

describe("deleting and joining replicas", () => {
  const apps: App[] = [
    { ...app(0, 3, "a"), rep: 0, id: "1" }, { ...app(0, 4, "b"), rep: 1, id: "2" }, { ...app(2, 5, "c"), rep: 2, id: "3" },
  ];
  const notes = { "1:0": { text: "раз" }, "1:1": { text: "два" }, "1:2": { text: "три" }, "x:5": { text: "інше" } };
  it("delete moves later replicas up and drops the deleted one's codes", () => {
    const r = dropReplica(apps, notes, "1", 1);
    expect(r.apps.map((a) => [a.id, a.rep])).toEqual([["1", 0], ["3", 1]]);
    expect(r.notes).toEqual({ "1:0": { text: "раз" }, "1:1": { text: "три" }, "x:5": { text: "інше" } });
  });
  it("join keeps codes on their words and joins comments", () => {
    const r = dropReplica(apps, notes, "1", 1, { offset: 10 });
    expect(r.apps.map((a) => [a.id, a.rep, a.s, a.e])).toEqual([["1", 0, 0, 3], ["2", 0, 10, 14], ["3", 1, 2, 5]]);
    expect(r.notes["1:0"].text).toBe("раз\n\nдва");
  });
});
