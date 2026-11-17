import { describe, expect, it } from "vitest";
import { checkRef } from "./apaCheck";
import { initials, parseRefs } from "./importRefs";

const RIS = `TY  - JOUR
AU  - Smith, John Albert
AU  - Lee, Kim
PY  - 2020///
TI  - Ambiguous loss in families of the missing
T2  - Family Process
VL  - 59
IS  - 3
SP  - 1
EP  - 15
DO  - 10.1111/famp.12345
ER  -
TY  - BOOK
AU  - Boss, Pauline
PY  - 1999
TI  - Ambiguous loss: Learning to live with unresolved grief
PB  - Harvard University Press
ER  -
TY  - CHAP
AU  - Boss, Pauline
A2  - Bengtson, Vern L.
PY  - 2016
TI  - The context and process of theory development
T2  - Sourcebook of family theory
SP  - 9
EP  - 43
PB  - Sage
ER  - `;

const BIB = `@article{boyko2021,
  author = {Бойко, Олена and Гнатюк, Віра},
  title = {Невизначена втрата в родинах зниклих безвісти},
  journal = {Український психологічний журнал},
  year = 2021, volume = {6}, number = {2}, pages = {45--60},
  doi = {https://doi.org/10.17721/upj.2021.2.4}
}
@book{who2023, author = {{World Health Organization}}, title = {Mental health in emergencies}, year = {2023}, publisher = {WHO}}
@article{kr, author = "K{\\"u}bler-Ross, Elisabeth", title = {On death and dying?}, journal = {Omega}, year = 1969, volume = 1}`;

describe("import from Zotero", () => {
  it("initials", () => {
    expect(initials("John Albert")).toBe("J. A.");
    expect(initials("Jean-Paul")).toBe("J.-P.");
    expect(initials("Олена")).toBe("О.");
  });
  it("RIS: article, book, chapter by APA 7 — and they pass the APA check", () => {
    const r = parseRefs(RIS);
    expect(r).toEqual([
      "Smith, J. A., & Lee, K. (2020). Ambiguous loss in families of the missing. *Family Process*, *59*(3), 1–15. https://doi.org/10.1111/famp.12345",
      "Boss, P. (1999). *Ambiguous loss: Learning to live with unresolved grief*. Harvard University Press.",
      "Boss, P. (2016). The context and process of theory development. In V. L. Bengtson (Ed.), *Sourcebook of family theory* (pp. 9–43). Sage.",
    ]);
    for (const x of r) expect(checkRef(x, "cyr")).toEqual([]);
  });
  it("BibTeX: Cyrillic, an organisation, accents, a title ending in «?»", () => {
    expect(parseRefs(BIB)).toEqual([
      "Бойко, О., & Гнатюк, В. (2021). Невизначена втрата в родинах зниклих безвісти. *Український психологічний журнал*, *6*(2), 45–60. https://doi.org/10.17721/upj.2021.2.4",
      "World Health Organization. (2023). *Mental health in emergencies*. WHO.",
      "Kübler-Ross, E. (1969). On death and dying? *Omega*, *1*.",
    ]);
  });
});
