import { describe, expect, it } from "vitest";
import { addCut, addStep, dropStep, emptyDfa, removeCut, setTr, startId, unitsOf, unitText, wordStart } from "./dfa";

const reps = [
  { role: "i", text: "Що ви відчули?" },
  { role: "p", text: "Спершу страх. Потім порожнечу." },
  { role: "i", text: "А далі?" },
  { role: "p", text: "Далі я чекала Андрія щовечора." },
];

describe("sense units", () => {
  it("a whole description is one unit; the interviewer's replicas are left out", () => {
    const u = unitsOf("iv", reps, []);
    expect(u).toEqual([{ id: startId("iv"), n: 1, parts: [{ rep: 1, s: 0, e: reps[1].text.length }, { rep: 3, s: 0, e: reps[3].text.length }] }]);
  });
  it("boundaries divide it in order; a boundary at a replica's start opens a unit there", () => {
    let d = addCut(emptyDfa(), "iv", 1, 14, reps, "c1", "me");
    d = addCut(d, "iv", 3, 0, reps, "c2", "me");
    d = addCut(d, "iv", 3, 0, reps, "dup", "me"); // not twice in one place
    d = addCut(d, "iv", 0, 3, reps, "no", "me"); // not in the interviewer's words
    const u = unitsOf("iv", reps, d.cuts);
    expect(u.map((x) => [x.id, x.n, unitText(x, reps, [], "iv")])).toEqual([
      ["iv:start", 1, "Спершу страх."], ["c1", 2, "Потім порожнечу."], ["c2", 3, "Далі я чекала Андрія щовечора."],
    ]);
  });
  it("unit text comes with replacements", () => {
    const dict = [{ id: "d", kind: "name", from: ["Андрій"], to: "[чоловік]", caps: true, scope: "all" }] as never;
    expect(unitText(unitsOf("iv", reps, [])[0], reps, dict, "iv")).toContain("чекала [чоловік] щовечора");
  });
  it("a click goes to the start of its word", () => {
    expect(wordStart("Спершу страх. Потім", 9)).toBe(7);
    expect(wordStart("Спершу страх. Потім", 13)).toBe(14); // on a space — the next word
    expect(wordStart("Спершу ", 7)).toBeNull();
  });
  it("removing a boundary joins the unit to the previous one with its transformations", () => {
    let d = addCut(emptyDfa(), "iv", 1, 14, reps, "c1", "me");
    d = addStep(d);
    d = setTr(setTr(d, "iv:start", 0, "Відчуває страх."), "c1", 0, "Потім — порожнечу.");
    d = setTr(d, "c1", 1, "Порожнеча після страху.");
    const r = removeCut(d, "iv", reps, "c1");
    expect(r.cuts).toEqual([]);
    expect(r.tr).toEqual({ "iv:start": ["Відчуває страх.\nПотім — порожнечу.", "Порожнеча після страху."] });
  });
  it("steps: added, and dropped with their column", () => {
    let d = addStep(emptyDfa());
    expect(d.steps).toEqual(["Трансформація 1", "Трансформація 2"]);
    d = setTr(setTr(d, "u", 0, "a"), "u", 1, "b");
    expect(dropStep(d, 0)).toMatchObject({ steps: ["Трансформація 2"], tr: { u: ["b"] } });
  });
});
