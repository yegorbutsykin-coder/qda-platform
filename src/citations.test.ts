import { describe, expect, it } from "vitest";
import { audit, citationsIn, citeOf, surnames } from "./citations";

describe("citations by APA 7", () => {
  it("surnames of people; an organisation as one name", () => {
    expect(surnames("Smith, J. A., & Lee, K.")).toEqual(["Smith", "Lee"]);
    expect(surnames("World Health Organization.")).toEqual(["World Health Organization"]);
    expect(surnames("Bengtson, V. L. (Ed.).")).toEqual(["Bengtson"]);
    // entries not fixed yet still give a proper citation
    expect(surnames("Бойко, О. та Гнатюк, В.")).toEqual(["Бойко", "Гнатюк"]);
    expect(surnames("Smith, John")).toEqual(["Smith"]);
    expect(surnames("University of California, Berkeley.")).toEqual(["University of California, Berkeley"]);
  });
  it("one, two, three and more authors; script decides «та ін.» or et al.", () => {
    expect(citeOf("Boss, P. (1999). *Ambiguous loss*. Harvard University Press.")).toMatchObject({ paren: "(Boss, 1999)", narr: "Boss (1999)" });
    expect(citeOf("Бойко, О., & Гнатюк, В. (2021a). Назва.")).toMatchObject({ paren: "(Бойко & Гнатюк, 2021a)", narr: "Бойко та Гнатюк (2021a)" });
    expect(citeOf("Smith, J., Lee, K., & Brown, A. (2020, May 3). Title.")).toMatchObject({ paren: "(Smith et al., 2020)", narr: "Smith et al. (2020)" });
    expect(citeOf("Бойко, О., Гнатюк, В., & Ткач, І. (n.d.). Назва.")).toMatchObject({ paren: "(Бойко та ін., n.d.)" });
    expect(citeOf("World Health Organization. (2023). *Report*.")).toMatchObject({ paren: "(World Health Organization, 2023)" });
    expect(citeOf("No date here.")).toBeNull();
  });
  it("finds citations in text, both kinds, several in one bracket; leaves out quotes and figure references", () => {
    const t = "Як зазначає Boss (1999), втрата триває (Бойко & Гнатюк, 2021a; Smith et al., 2020, p. 5). «Так» (Марта, інтерв'ю 03). (див. Рисунок 2). У 2022 році (див. Boss, 2006, 2016).";
    expect(citationsIn(t).map((c) => c.key).sort()).toEqual(["boss|1999", "boss|2006", "boss|2016", "smith|2020", "бойко|2021a"].sort());
  });
  it("text against the list: missing and never cited", () => {
    const a = { title: "", texts: { intro: "Див. (Boss, 1999) і (Ткач, 2019).", results: "Smith et al. (2020) пише." },
      refs: [{ id: "1", text: "Boss, P. (1999). Title." }, { id: "2", text: "Smith, J., Lee, K., & Brown, A. (2020). Title." }, { id: "3", text: "Бойко, О. (2021). Назва." }] };
    const r = audit(a, [{ key: "intro", name: "Вступ" }, { key: "results", name: "Теми" }]);
    expect(r.missing).toEqual([{ shown: "Ткач, 2019", sec: "Вступ" }]);
    expect([...r.unused]).toEqual(["3"]);
  });
});
