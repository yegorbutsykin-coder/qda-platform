import { describe, expect, it } from "vitest";
import { checkList, checkRef } from "./apaCheck";

const msgs = (t: string, order: "cyr" | "one" = "cyr") => checkRef(t, order).map((x) => `${x.level}: ${x.msg}`);

describe("APA 7 check: good entries pass", () => {
  it.each([
    "Smith, J. A., & Lee, K. (2020). Ambiguous loss in families of the missing. *Family Process*, *59*(3), 1–15. https://doi.org/10.1111/famp.12345",
    "Boss, P. (1999). *Ambiguous loss: Learning to live with unresolved grief*. Harvard University Press.",
    "Бойко, О., & Гнатюк, В. (2021). Невизначена втрата в родинах зниклих безвісти. *Український психологічний журнал*, *6*(2), 45–60. https://doi.org/10.17721/upj.2021.2(16).4",
    "Boss, P. (2016). The context and process of theory development. In V. L. Bengtson (Ed.), *Sourcebook of family theory* (pp. 9–43). Sage.",
    "World Health Organization. (2023). *Mental health in emergencies*. https://www.who.int/news-room/fact-sheets/detail/mental-health-in-emergencies",
    "Клименко, І. В. (n.d.). *Горе і втрата*. Видавництво КНУ.",
    "University of California, Berkeley. (2019). *Annual report*. https://www.berkeley.edu/report",
  ])("%s", (t) => expect(msgs(t)).toEqual([]));
});

describe("APA 7 check: mistakes are found", () => {
  const has = (t: string, part: string, order: "cyr" | "one" = "cyr") => expect(msgs(t, order).join("\n")).toContain(part);
  it("authors", () => {
    has("Smith, John, & Lee, K. (2020). Title.", "Ініціали замість повного імені: «Smith, J.»");
    has("Smith, J.A. (2020). Title.", "Пробіл між ініціалами: «J. A.»");
    has("Smith, J. A., and Lee, K. (2020). Title.", "«, &», а не «and»");
    has("Бойко, О., Гнатюк, В. (2020). Назва.", "Перед останнім(ьою) автором(кою) — «, &»");
    has("Smith, J. & Lee, K. (2020). Title.", "Перед «&» — кома");
    has("Smith, J., et al. (2020). Title.", "Без «et al.»");
    has("Бойко, О. та ін. (2020). Назва.", "Без «et al.» / «та ін.»");
    has("APA. (2020). *Manual*.", "Організацію — повною назвою");
  });
  it("date and title", () => {
    has("Smith, J. 2020. Title.", "Немає дати в дужках");
    has("Smith, J. (2020) Title.", "Після дати — крапка");
    has("Smith, J. (in progress). Title.", "in progress");
    has("Smith, J. (2020). Living With Loss After The War.", "реченнєвим регістром");
    has("Smith, J. (2020). *Grief*. (2nd ed.). Sage.", "Видання — «(2nd ed.)»");
    has("Бойко, О. (2020). Втрата. Видавництво.", "транслітерація", "one");
  });
  it("source, DOI and punctuation", () => {
    has("Smith, J. (2020). Title. *Journal*, Vol. 5, No. 2, 10–20. https://doi.org/10.1/x", "без «Vol.»");
    has("Бойко, О. (2020). Назва. *Журнал*, Т. 5, № 2, 10–20.", "без «Vol.» / «No.» / «Т.» / «№»");
    has("Smith, J. (2020). Title. *Journal*, *5* (2), 10–20. https://doi.org/10.1/x", "без пробілу: «12(3)»");
    has("Smith, J. (2020). Title. *Journal*, *5*(2), pp. 10–20. https://doi.org/10.1/x", "без «pp.»");
    has("Smith, J. (2020). Title. *Journal*, *5*(2), 10-20. https://doi.org/10.1/x", "тире «–»");
    has("Smith, J. (2020). Title. In K. Lee (Ed.), *Book* (9–43). Sage.", "«(pp. 9–43)»");
    has("Smith, J. (2020). *Grief*. New York: Sage.", "Місто видання");
    has("Smith, J. (2020). *Grief*. Sage Publications Inc.", "«Inc.»");
    has("Smith, J. (2020). Title. *Journal*, *5*(2), 10–20. doi:10.1/x", "без «doi:»");
    has("Smith, J. (2020). Title. *Journal*, *5*(2), 10–20. http://dx.doi.org/10.1/x", "без «dx.»");
    has("Бойко, О. (2020). *Назва*. Режим доступу: https://site.ua/x", "Режим доступу");
    has("Smith, J. (2020). Title. *Journal*, *5*(2), 10–20. https://doi.org/10.1/x.", "крапка не ставиться");
    has("Smith, J. (2020). Title. *Journal*, *5*(2), 10–20", "Наприкінці — крапка");
    has("Smith, J. (2020). Title.. *Book*. Sage.", "Подвійна крапка");
    has("Smith, J. (2020). Title. Journal, 5(2), 10–20. https://doi.org/10.1/x", "курсивом");
    has("Smith, J. (2020). Title. *Journal*, *5*(2), 10–20.", "без DOI");
  });
  it("a Ukrainian article in the old style gets all its notes", () => {
    const m = msgs("Бойко, О. та Гнатюк, В. (2021). Невизначена втрата. Український психологічний журнал, Т. 6, № 2, с. 45-60.").join("\n");
    for (const part of ["«and» / «та»", "«Т.» / «№»", "без «pp.» / «с.»", "тире «–»", "курсивом", "без DOI"]) expect(m).toContain(part);
    const n = msgs("Smith, John (2018). Living With Loss After The War. New York: Sage Publications Inc.").join("\n");
    for (const part of ["«Smith, J.»", "реченнєвим регістром", "Місто видання", "«Inc.»"]) expect(n).toContain(part);
  });
  it("the whole list: duplicates and one author's works in one year", () => {
    const r = checkList([
      { id: "a", text: "Smith, J. (2020). First. *Book*. Sage." },
      { id: "b", text: "Smith, J. (2020). Second. *Book*. Sage." },
      { id: "c", text: "Smith, J. (2020). First. *Book*. Sage." },
      { id: "d", text: "Lee, K. (2021a). One. *Book*. Sage." },
      { id: "e", text: "Lee, K. (2021b). Two. *Book*. Sage." },
    ], "cyr");
    expect(r.get("b")!.map((x) => x.msg).join()).toContain("«2020a», «2020b»");
    expect(r.get("c")!.map((x) => x.msg).join()).toContain("вже є в списку");
    expect(r.get("d")).toEqual([]);
    expect(r.get("e")).toEqual([]);
  });
});
