import { describe, expect, it } from "vitest";
import { countWords, sectionDef } from "./article";

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
