import { describe, expect, it } from "vitest";
import { labDistance, nextColor, pieces, quote, snap, statuses, type App } from "./coding";
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
