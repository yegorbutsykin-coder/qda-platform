import { describe, expect, it } from "vitest";
import { agreement, byPerson, codesByCategory, cooccurrence, fragments, matrix, saturationCurve, saturationWords, slice } from "./figures";
import type { App, Code } from "./coding";

const A = (id: string, code: string, iv: string, s: number, e: number, by = "p1", rep = 0): App => ({ id, code, iv, rep, s, e, by, at: 0 });
const C = (id: string, name: string, cat?: string): Code => ({ id, name, color: "#000", by: "p1", at: 0, cat });

describe("visual analysis numbers", () => {
  it("groups codes by category, loose ones last", () => {
    const g = codesByCategory([C("1", "страх", "k"), C("2", "пустота"), C("3", "біль", "k")], [{ id: "k", name: "Втрата", color: "#111" }]);
    expect(g.map((x) => [x.cat?.name ?? null, x.codes.map((c) => c.name)])).toEqual([["Втрата", ["біль", "страх"]], [null, ["пустота"]]]);
  });
  it("counts fragments per code and interview", () => {
    const m = matrix([A("1", "a", "i1", 0, 1), A("2", "a", "i1", 2, 3), A("3", "a", "i2", 0, 1)]);
    expect([m.get("a")!.get("i1"), m.get("a")!.get("i2")]).toEqual([2, 1]);
  });
  it("saturation curve and words", () => {
    const c = saturationCurve(["i1", "i2", "i3", "i4"], [A("1", "a", "i1", 0, 1), A("2", "b", "i2", 0, 1), A("3", "a", "i3", 0, 1), A("4", "b", "i4", 0, 1)]);
    expect(c.map((x) => [x.fresh, x.total])).toEqual([[["a"], 1], [["b"], 2], [[], 2], [[], 2]]);
    expect(saturationWords(c, ["01", "02", "03", "04"], 2)).toBe("Останні нові коди з'явилися в інтерв'ю 02; після нього — 2 інтерв'ю без нових кодів.");
  });
  it("agreement joins overlapping marks by different people into one fragment", () => {
    const g = agreement([A("1", "a", "i", 0, 10, "p1"), A("2", "a", "i", 5, 12, "p2"), A("3", "a", "i", 8, 9, "p3"), A("4", "a", "i", 20, 30, "p1"), A("5", "a", "i", 22, 25, "p2"), A("6", "a", "i", 40, 50, "p1")]);
    expect(g.get("a")).toEqual({ three: 1, two: 1, one: 1 });
  });
  it("codes used by one person only", () => {
    const r = byPerson([A("1", "a", "i", 0, 1, "p1"), A("2", "a", "i", 0, 1, "p2"), A("3", "b", "i", 0, 1, "p2")]);
    expect([...r.solo]).toEqual([["b", "p2"]]);
    expect(r.counts.get("p2")!.get("b")).toBe(1);
  });
});

describe("connections", () => {
  it("one fragment per code and place, whoever marked it", () => {
    const f = fragments([A("1", "a", "i", 0, 10, "p1"), A("2", "a", "i", 5, 12, "p2"), A("3", "a", "i", 20, 25, "p1")]);
    expect(f.map((x) => [x.s, x.e, [...x.by].sort()])).toEqual([[0, 12, ["p1", "p2"]], [20, 25, ["p1"]]]);
  });
  it("codes on overlapping words count once per meeting", () => {
    const m = cooccurrence([A("1", "a", "i", 0, 10, "p1"), A("2", "a", "i", 2, 8, "p2"), A("3", "b", "i", 5, 15), A("4", "c", "i", 30, 40), A("5", "b", "i", 0, 9, "p1", 1), A("6", "a", "i", 0, 9, "p1", 1)]);
    expect(Object.fromEntries(m)).toEqual({ "a|b": 2 });
  });
  it("slices a rectangle by weight along the longer side", () => {
    expect(slice({ x: 0, y: 0, w: 100, h: 50 }, [1, 3])).toEqual([{ x: 0, y: 0, w: 25, h: 50 }, { x: 25, y: 0, w: 75, h: 50 }]);
  });
});
