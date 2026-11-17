import { describe, expect, it } from "vitest";
import { countWords, journalChanged, resetJournal, sectionDef, sectionsOf, type Article } from "./article";

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
