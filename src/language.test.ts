import { describe, expect, it } from "vitest";
import { characteristic, kwic, pronouns, suggestTone, tenses } from "./language";

describe("participants' language", () => {
  it("words in context: word starts, or the exact word", () => {
    const t = "Мені було страшно. Страх приходив уночі, і страху не було кінця.";
    expect(kwic(t, "страх", false).map((h) => h.word)).toEqual(["Страх", "страху"]);
    expect(kwic(t, "страх", true).map((h) => h.word)).toEqual(["Страх"]);
    expect(kwic(t, "страш", false)[0].left).toBe("Мені було ");
  });
  it("characteristic words of a category", () => {
    const cat = "тиша тиша вдома тиша порожньо порожньо";
    const all = cat + " родина родина мама тато мама робота робота школа";
    expect(characteristic(cat, all).slice(0, 2)).toEqual(["тиша", "порожньо"]);
  });
  it("pronouns, Ukrainian and Russian forms", () => {
    expect(pronouns("Я думала, що ми впораємося, але мене ніхто не чув. Они говорили, що він повернеться.")).toEqual({ "я": 2, "ми": 1, "ти": 0, "він/вона/вони": 2 });
  });
  it("tense markers", () => {
    expect(tenses("Тоді я плакала. Зараз уже легше, але я буду пам'ятати і чекатиму.")).toEqual({ "минуле": 2, "теперішнє": 1, "майбутнє": 2 });
  });
  it("tone suggestion; «бо» is not «боюся»", () => {
    expect(suggestTone("Мені було страшно і боляче")).toBe("neg");
    expect(suggestTone("Я боюся")).toBe("neg");
    expect(suggestTone("Прийшла, бо треба було")).toBe("neu");
    expect(suggestTone("Сумно, але з надією")).toBe("amb");
    expect(suggestTone("Нам було тепло й спокійно")).toBe("pos");
  });
});
