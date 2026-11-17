import { describe, expect, it } from "vitest";
import { countWords, dropFloat, formatQuote, insertAt, join, moveFloat, numbers, putFloat, putText, settle, split, type Float, journalChanged, resetJournal, sectionDef, sectionsOf, type Article } from "./article";

describe("article", () => {
  it("counts words like a journal: apostrophes and hyphens inside a word", () => {
    expect(countWords("Інтерв'ю з учасницею — пів-години, 2 рази.")).toBe(6);
    expect(countWords("")).toBe(0);
  });
  it("results section is named by method", () => {
    expect(sectionDef("results", "ІФА").name).toBe("Групові досвідні теми");
    expect(sectionDef("results", "РТА").name).toBe("Теми");
    expect(sectionDef("abstract", "Дескр.").limit).toBe(250);
  });
});

describe("journal requirements", () => {
  const a: Article = { title: "", texts: { method: "текст", extra: "дані", empty2: "" }, journal: { name: "Журнал", lang: "uk", other: "", total: 6000, sections: [
    { key: "intro" }, { key: "method", name: "Методологія", limit: 1200 }, { key: "extra", name: "Обмеження" }, { key: "results" }, { key: "empty2" }, { key: "discussion" },
  ] } };
  it("journal names, order and limits over the defaults", () => {
    expect(sectionsOf(a, "ІФА").map((x) => [x.name, x.limit ?? null, x.custom])).toEqual([
      ["Вступ", null, false], ["Методологія", 1200, false], ["Обмеження", null, true], ["Групові досвідні теми", null, false], ["Новий розділ", null, true], ["Обговорення", null, false],
    ]);
    expect(sectionsOf({ ...a, journal: { ...a.journal!, lang: "en" } }, "ІФА")[3].name).toBe("Group Experiential Themes");
  });
  it("reset: APA sections back, added sections with text at the end, empty ones gone, text kept", () => {
    const r = resetJournal(a);
    expect(sectionsOf(r, "РТА").map((x) => x.name)).toEqual(["Анотація", "Вступ", "Метод", "Теми", "Обговорення", "Обмеження"]);
    expect(r.texts).toEqual(a.texts);
    expect(r.journal!.name).toBe("Журнал");
    expect(journalChanged(a)).toBe(true);
    expect(journalChanged(resetJournal({ ...a, texts: {} }))).toBe(false);
  });
});

describe("quotes by APA 7", () => {
  it("short in the line with the source; 40+ words as a block", () => {
    expect(formatQuote("  Мені було   страшно. ", "Марта", 3, "uk")).toEqual({ text: "«Мені було страшно» (Марта, інтерв'ю 03).", block: false });
    expect(formatQuote("I was scared.", "Marta", 12, "en").text).toBe("“I was scared” (Marta, Interview 12).");
    expect(formatQuote("Чому я?", "Ліна", 2, "uk").text).toBe("«Чому я?» (Ліна, інтерв'ю 02)");
    const long = Array(40).fill("слово").join(" ");
    expect(formatQuote(long, "Ліна", 1, "uk")).toEqual({ text: `> ${long} (Ліна, інтерв'ю 01)`, block: true });
  });
  it("inserts with spaces, or as a paragraph of its own", () => {
    expect(insertAt("Як сказала учасниця:", 20, { text: "«так»", block: false })).toEqual({ text: "Як сказала учасниця: «так»", pos: 26 });
    expect(insertAt("Перший абзац. Далі.", 13, { text: "> довга цитата", block: true }).text).toBe("Перший абзац.\n\n> довга цитата\n\nДалі.");
  });
});

describe("figures and tables in the text", () => {
  const fig = { kind: "fig" } as Float, tab = { kind: "tab" } as Float;
  const keys = ["intro", "results"];
  it("a float is a line of its own; split and join are exact", () => {
    for (const t of ["", "a", "a\n⟦fig:x⟧\nb", "\n⟦fig:x⟧\n\n⟦tab:y⟧\n", "a\n\n\n⟦fig:x⟧\n"]) expect(join(split(t))).toBe(t);
    expect(split("a\n⟦fig:x⟧\nb")).toEqual([{ text: "a" }, { kind: "fig", id: "x" }, { text: "b" }]);
    expect(countWords("один\n⟦fig:abc⟧\nдва")).toBe(2);
  });
  it("goes in at the caret, numbered in order of appearance, figures apart from tables", () => {
    let a = { title: "", texts: { intro: "Перше. Друге.", results: "Теми." } } as Parameters<typeof numbers>[0];
    a = putFloat(a, keys, { sec: "intro", seg: 0, pos: 7 }, "f1", fig).article;
    expect(a.texts.intro).toBe("Перше.\n⟦fig:f1⟧\nДруге.");
    a = putFloat(a, keys, null, "t1", tab).article; // no caret: end of results
    a = putFloat(a, keys, { sec: "intro", seg: 0, pos: 0 }, "f0", fig).article;
    expect(a.texts.intro).toBe("\n⟦fig:f0⟧\nПерше.\n⟦fig:f1⟧\nДруге.");
    expect([...numbers(a, keys)]).toEqual([["f0", 1], ["f1", 2], ["t1", 1]]);
  });
  it("references follow the numbers; a removed one becomes «?»", () => {
    const a = { title: "", texts: { intro: "\n⟦fig:a⟧\n\n⟦fig:b⟧\n", results: "Див. Рисунок 2 і рисунку 1; Table 1; Fig. 2" }, floats: { a: fig, b: fig } };
    const swapped = { ...a, texts: { ...a.texts, intro: "\n⟦fig:b⟧\n\n⟦fig:a⟧\n" } };
    expect(settle(a, swapped, keys).texts.results).toBe("Див. Рисунок 1 і рисунку 2; Table 1; Fig. 1");
    expect(dropFloat(a, keys, "a").texts.results).toBe("Див. Рисунок 1 і рисунку ?; Table 1; Fig. 1");
  });
  it("moves a paragraph at a time, then into the next section", () => {
    let a: Article = { title: "", texts: { intro: "A\n\nB\n⟦fig:x⟧\nC", results: "D" }, floats: { x: fig } };
    a = moveFloat(a, keys, "x", -1);
    expect(a.texts.intro).toBe("A\n⟦fig:x⟧\nB\n\nC");
    a = moveFloat(moveFloat(moveFloat(a, keys, "x", 1), keys, "x", 1), keys, "x", 1);
    expect(a.texts).toEqual({ intro: "A\n\nB\n\nC", results: "\n⟦fig:x⟧\nD" });
    expect(moveFloat(moveFloat(a, keys, "x", -1), keys, "x", 1).texts).toEqual(a.texts);
  });
  it("text goes into the piece the caret is in", () => {
    const a = { title: "", texts: { intro: "A\n⟦fig:x⟧\nB", results: "" }, floats: { x: fig } };
    expect(putText(a, keys, { sec: "intro", seg: 1, pos: 1 }, { text: "(див. Рисунок 1)", block: false }).article.texts.intro).toBe("A\n⟦fig:x⟧\nB (див. Рисунок 1)");
  });
});
