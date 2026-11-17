import { describe, expect, it } from "vitest";
import { addRefs, countWords, dropFloat, exportBlocks, refsSorted, rich, sortRefs, formatQuote, insertAt, join, moveFloat, numbers, putFloat, putText, settle, split, type Block, type Float, journalChanged, resetJournal, sectionDef, sectionsOf, type Article } from "./article";

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

describe("export layout by APA 7", () => {
  const fig = { kind: "fig", title: "Т", note: "", svg: "", w: 1, h: 1, landscape: false, bw: false, tool: "matrix", ivs: [], whose: "all", sig: "" } as Float;
  const tab = { kind: "tab", variant: "themes", title: "Т", note: "", showPeople: true, showQuote: false, cols: ["Марта", "Ліна"], n: 2, names: {}, picks: {}, sig: "",
    rows: [{ sup: "С", id: "k1", name: "Втрата", people: ["Марта"], cells: [1, 0] }, { id: "k2", name: "Час", people: ["Марта", "Ліна"], cells: [1, 1] }] } as Float;
  const a: Article = { title: "Назва", texts: { abstract: "Коротко.", intro: "Абзац один.\nАбзац два.\n⟦fig:f⟧\n> Довга цитата.", results: "\n⟦tab:t⟧\nТекст." }, floats: { f: fig, t: tab } };
  it("title page; abstract with keywords on its own page; the text from a new page under the title, without «Вступ»", () => {
    const b = exportBlocks({ ...a, authors: "Ольга Бойко", keywords: "втрата, горе" }, "РТА", "Тема");
    expect(b[0]).toEqual({ k: "front", title: "Назва", authors: "Ольга Бойко", affiliation: "" });
    expect(b.slice(1, 8).map((x) => x.k + ("text" in x ? ":" + x.text : ""))).toEqual(["h1:Анотація", "p:Коротко.", "kw:втрата, горе", "title:Назва", "p:Абзац один.", "p:Абзац два.", "fig"]);
    expect(b[1]).toMatchObject({ brk: true });
    expect(b[2]).toMatchObject({ indent: false });
    expect(b[4]).toMatchObject({ brk: true });
    expect(b[8]).toEqual({ k: "quote", text: "Довга цитата." });
    expect(b[9]).toEqual({ k: "h1", text: "Теми" });
    const t = b[10] as Extract<Block, { k: "tab" }>;
    expect(t.label).toBe("Таблиця 1");
    expect(t.rows).toEqual([{ cells: ["С"], group: true }, { cells: ["Втрата", "Марта (1 з 2)"], group: false }, { cells: ["Інші теми"], group: true }, { cells: ["Час", "Марта, Ліна (2 з 2)"], group: false }]);
  });
  it("at the end: tables, then figures, each from a new page", () => {
    const b = exportBlocks({ ...a, journal: { name: "", lang: "en", other: "", floatsAtEnd: true } }, "РТА", "Тема");
    expect(b.slice(-2).map((x) => ("label" in x ? x.label : x.k))).toEqual(["Table 1", "Figure 1"]);
    expect(b.slice(-2).every((x) => "brk" in x && x.brk)).toBe(true);
    expect(b.filter((x) => x.k === "h1").map((x) => (x as { text: string }).text)).toEqual(["Abstract", "Themes"]);
  });
});

describe("subheadings", () => {
  it("«## » and «### » lines are level 2 and 3 headings", () => {
    const b = exportBlocks({ title: "Т", texts: { results: "## Тема 1: Очікування\nАбзац.\n### Підтема\nЩе." } }, "РТА", "Тема");
    expect(b.slice(3).map((x) => x.k + ":" + ("text" in x ? x.text : ""))).toEqual(["h2:Тема 1: Очікування", "p:Абзац.", "h3:Підтема", "p:Ще."]);
  });
});

describe("reference list", () => {
  const refs = ["Smith, J. (2020). *Grief*.", "Бойко, О. (2019). Втрата.", "Browning, A. (2018). B.", "Brown, J. (2021). A.", "Ґудзь, І. (2020). Г.", "Гнатюк, В. (2020). В."]
    .map((text, i) => ({ id: String(i), text }));
  it("several at once, one per line", () => {
    let n = 0;
    const a = addRefs({ title: "", texts: {} }, "Перше.\n\n  Друге.  \n", () => String(++n));
    expect(a.refs).toEqual([{ id: "1", text: "Перше." }, { id: "2", text: "Друге." }]);
  });
  it("Cyrillic by the Ukrainian alphabet, then Latin; Brown before Browning", () => {
    expect(sortRefs(refs, "cyr").map((r) => r.text.slice(0, 5))).toEqual(["Бойко", "Гнатю", "Ґудзь", "Brown", "Brown", "Smith"]);
    expect(sortRefs(refs, "cyr").slice(3, 5).map((r) => r.text.slice(0, 8))).toEqual(["Brown, J", "Browning"]);
    expect(sortRefs(refs, "one")[0].text.startsWith("Brown, J")).toBe(true);
    expect(refsSorted({ title: "", texts: {}, refs: sortRefs(refs, "cyr") })).toBe(true);
    expect(refsSorted({ title: "", texts: {}, refs })).toBe(false);
  });
  it("italics between asterisks", () => {
    expect(rich("*Grief*, *12*(3), 1–9.")).toEqual([{ text: "Grief", i: true }, { text: ", ", i: false }, { text: "12", i: true }, { text: "(3), 1–9.", i: false }]);
    expect(rich("5 * 3")).toEqual([{ text: "5 * 3", i: false }]);
  });
  it("exported after the text from a new page, before tables and figures at the end", () => {
    const b = exportBlocks({ title: "Т", texts: { intro: "Текст." }, refs: [{ id: "1", text: "Бойко, О. (2019)." }, { id: "2", text: " " }] }, "РТА", "Тема");
    expect(b.slice(-2)).toEqual([{ k: "h1", text: "Список літератури", brk: true }, { k: "ref", text: "Бойко, О. (2019)." }]);
  });
});
