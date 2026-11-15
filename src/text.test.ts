import { describe, expect, it } from "vitest";
import { applyDict, formsFound, guessRole, joinSegments, parseTranscript, stems, suspects, type DictEntry } from "./text";

const entry = (from: string, to = "[ім'я]", extra: Partial<DictEntry> = {}): DictEntry =>
  ({ id: from, kind: "person", from: from.split(",").map((s) => s.trim()), to, scope: "all", caps: true, ...extra });

describe("parseTranscript", () => {
  it("finds labels and timecodes", () => {
    const p = parseTranscript("[00:00:05] Інтерв'юер: Розкажіть.\n[00:00:09] Учасниця: Ну, це було в березні.\nа потім ще\nІнтерв'юер: Так?\nУчасниця: Так.");
    expect(p.labels.map((l) => l.label)).toEqual(["Інтерв'юер", "Учасниця"]);
    expect(p.timecodes).toBe(2);
    expect(p.replicas).toHaveLength(4);
    expect(p.replicas[1]).toEqual({ t: "00:00:09", label: "Учасниця", text: "Ну, це було в березні.\nа потім ще" });
  });

  it("short labels, blank lines and Windows line ends", () => {
    const p = parseTranscript("І: Добрий день.\r\n\r\nР: Добрий.\r\n\r\nІ: Як ви?\r\nР: Нормально.");
    expect(p.labels).toEqual([{ label: "І", count: 2 }, { label: "Р", count: 2 }]);
    expect(p.replicas.map((r) => r.label)).toEqual(["І", "Р", "І", "Р"]);
  });

  it("a colon in speech is not a speaker", () => {
    const p = parseTranscript("Вона сказала мені: не йди.\nА я пішла.\nПотім було важко.");
    expect(p.labels).toEqual([]);
    expect(p.replicas).toHaveLength(3);
    expect(p.replicas[0].label).toBeNull();
  });

  it("can ignore labels on request", () => {
    expect(parseTranscript("І: а\nР: б\nІ: в\nР: г", false).replicas[0]).toEqual({ t: null, label: null, text: "І: а" });
  });

  it("guesses roles", () => {
    expect(guessRole("Інтерв'юер")).toBe("i");
    expect(guessRole("І")).toBe("i");
    expect(guessRole("Р")).toBe("p");
    expect(guessRole("Оксана")).toBe("p");
  });
});

describe("dictionary", () => {
  it("stems cover common case forms", () => {
    expect(stems("Оксана")).toEqual(["Оксан"]);
    expect(stems("Київ")).toEqual(["Київ", "Києв"]);
    expect(stems("Львів")).toEqual(["Львів", "Львов", "Львев"]);
  });

  it("replaces case forms and keeps the rest", () => {
    const segs = applyDict("Оксана прийшла. Я дала Оксані хліб, а з Оксаною пішла в Мелітополь.", [entry("Оксана"), entry("Мелітополь", "[місто]", { kind: "place" })], "1");
    expect(joinSegments(segs)).toBe("[ім'я] прийшла. Я дала [ім'я] хліб, а з [ім'я] пішла в [місто].");
    expect(segs.filter((s) => s.orig).map((s) => s.orig)).toEqual(["Оксана", "Оксані", "Оксаною", "Мелітополь"]);
  });

  it("capital-letter-only protects ordinary words", () => {
    const text = "Віра казала, що віра і вірити — різне. Віри не стало.";
    expect(joinSegments(applyDict(text, [entry("Віра")], "1"))).toBe("[ім'я] казала, що віра і вірити — різне. [ім'я] не стало.");
    expect(joinSegments(applyDict("віра", [entry("Віра", "[ім'я]", { caps: false })], "1"))).toBe("[ім'я]");
  });

  it("does not touch words that only contain the name", () => {
    expect(joinSegments(applyDict("Роксана й Оксанка", [entry("Оксана")], "1"))).toBe("Роксана й [ім'я]");
  });

  it("several spellings, multi-word names, scope, empty replacement", () => {
    const d = [entry("Оксана, Ксюша"), entry("Нова Каховка", "[місто]"), entry("Андрій", "[син]", { scope: "2" }), entry("Петро", "")];
    expect(joinSegments(applyDict("Ксюша з Нової Каховки, Андрій, Петро", d, "1"))).toBe("[ім'я] з [місто], Андрій, Петро");
    expect(joinSegments(applyDict("Андрієві", d, "2"))).toBe("[син]");
  });

  it("counts forms", () => {
    expect(formsFound(entry("Оксана"), [{ id: "1", text: "Оксана, Оксані" }, { id: "2", text: "Оксані" }])).toEqual({ "Оксана": 1, "Оксані": 2 });
  });
});

describe("suspects", () => {
  const segs = (text: string, dict: DictEntry[] = []) => [{ id: "3", segs: applyDict(text, dict, "3") }];

  it("finds mid-sentence capitals, skips sentence starts and covered words", () => {
    const s = suspects(segs("Ми з Андрієм поїхали до Харкова. Потім Андрій сказав, що Оксана чекає. Я знала."), []);
    expect(s.map((x) => [x.word, x.kind])).toEqual([["Андрієм", "person"], ["Харкова", "place"], ["Оксана", "person"]]);
    expect(s[0].count).toBe(2);
    expect(suspects(segs("Ми з Андрієм були.", [entry("Андрій")]), [])).toEqual([]);
    expect(suspects(segs("Ми з Андрієм були."), ["андрі"])).toEqual([]);
  });

  it("all-caps short words look like organisations", () => {
    expect(suspects(segs("Я працювала в АТБ два роки."), [])[0]).toMatchObject({ word: "АТБ", kind: "org" });
  });
});
