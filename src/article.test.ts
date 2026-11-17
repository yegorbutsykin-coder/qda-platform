import { describe, expect, it } from "vitest";
import { countWords, formatQuote, insertAt, journalChanged, resetJournal, sectionDef, sectionsOf, type Article } from "./article";

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
