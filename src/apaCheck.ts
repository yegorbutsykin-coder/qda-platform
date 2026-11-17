// Stage 6.2: a heuristic check of reference entries by APA 7 (ТЗ 3.7). Plain text: *between asterisks* is italics.
// Rules from APA Style pages (reference elements, DOIs and URLs, basic principles, 21+ authors, works in other languages).
import type { Ref, RefOrder } from "./article";

export type Issue = { level: "error" | "warn"; msg: string };

const DATE = /\((\d{4}[a-zа-я]?(?:,\s*[^()]+)?|n\.\s?d\.|б\.\s?д\.|in press|у друці|друкується)\)/i;
const BAD_DATE = /\((in progress|submitted for publication|submitted)\)/i;
const URL_RE = /https?:\/\/\S+/g;
const INITIALS = /^(\p{Lu}\p{Ll}?\.(?:(?:\s|-)\p{Lu}\p{Ll}?\.)*)$/u;
const CITIES = /\b(New York|London|Oxford|Cambridge|Thousand Oaks|Washington, DC|Kyiv|Київ|Харків|Львів|Одеса|Дніпро|Москва|Moscow)\s*:/;

/** The authors' part, the date and what follows, or null when there is no date in brackets. */
export function parts(t: string) {
  const m = DATE.exec(t);
  if (!m) return null;
  return { authors: t.slice(0, m.index).trim(), date: m[1], after: t.slice(m.index + m[0].length) };
}

function checkAuthors(raw: string, out: Issue[]) {
  const a = raw.replace(/\((?:Eds?|Ред|Упоряд)\.\)\.?/gi, "").trim();
  if (/\bet al\.|(?<!\p{L})(та|і) ін\./iu.test(a)) out.push({ level: "error", msg: "Без «et al.» / «та ін.»: у списку — усі автори(ки) до 20; від 21 — перші 19, «. . .», останній(я)." });
  const tokens = a.replace(/(^|,)\s*&\s*/g, ",").replace(/\.\s?\.\s?\./g, ",").split(/\s*,\s*/).filter(Boolean);
  // People: some initials, or "Surname, Name" (one-word surname — organisations have spaces: "University of California, Berkeley").
  const personal = tokens.length > 1 && (tokens.some((x) => INITIALS.test(x) || /^\p{Lu}\.?\s?\p{Lu}\.?$/u.test(x))
    || (/^\p{Lu}[\p{L}'’-]+$/u.test(tokens[0]) && /^\p{Lu}\p{Ll}+$/u.test(tokens[1])));
  if (!personal) {
    if (tokens.length === 1 && /^\p{Lu}{2,6}\.?$/u.test(tokens[0])) out.push({ level: "error", msg: "Організацію — повною назвою, без абревіатури (напр., American Psychological Association, а не APA)." });
    return;
  }
  for (let i = 1; i < tokens.length; i += 2) {
    const x = tokens[i];
    if (INITIALS.test(x) || /^(Jr|Sr|II|III)\.?$/.test(x)) continue;
    if (/^\p{Lu}\p{Ll}+$/u.test(x)) out.push({ level: "error", msg: `Ініціали замість повного імені: «${tokens[i - 1]}, ${x[0]}.».` });
    else if (/^(\p{Lu}\.){2,}$/u.test(x)) out.push({ level: "error", msg: `Пробіл між ініціалами: «${x.split(".").filter(Boolean).join(". ")}.».` });
    else if (/^\p{Lu}(\s\p{Lu})*$/u.test(x)) out.push({ level: "error", msg: `Після кожного ініціала — крапка: «${x.split(/\s/).join(". ")}.».` });
  }
  const n = Math.ceil(tokens.length / 2), ellipsis = /\.\s\.\s\./.test(a);
  if (/\s(and|та|і|й)\s/.test(a)) out.push({ level: "error", msg: "Перед останнім(ьою) автором(кою) — «, &», а не «and» / «та»." });
  else if (ellipsis && /&/.test(a)) out.push({ level: "error", msg: "У формі для 21+ авторів(ок) після «. . .» — останній(я) автор(ка) без «&»." });
  else if (n >= 2 && !ellipsis && !/&/.test(a)) out.push({ level: "error", msg: "Перед останнім(ьою) автором(кою) — «, &»: «Smith, J., & Lee, K.»." });
  else if (/[^,\s]\s*&/.test(a)) out.push({ level: "error", msg: "Перед «&» — кома: «Smith, J., & Lee, K.»." });
  if (n > 20 && !ellipsis) out.push({ level: "error", msg: "21 і більше авторів(ок): перші 19, «. . .», останній(я)." });
  if (/\(Ed\.\)/.test(raw) && n >= 2) out.push({ level: "error", msg: "Кілька редакторів(ок) — «(Eds.)»." });
}

/** "Mostly capitalised" English title → sentence case is wanted. */
function titleCase(title: string): boolean {
  if (/\p{Script=Cyrillic}/u.test(title)) return false;
  const words = title.replace(/:\s*\S+/g, ":").split(/\s+/).slice(1).filter((w) => /^\p{L}{4,}/u.test(w));
  return words.length >= 3 && words.filter((w) => /^\p{Lu}/u.test(w)).length > words.length / 2;
}

export function checkRef(text: string, order: RefOrder): Issue[] {
  const out: Issue[] = [];
  const t = text.trim();
  const urls = t.match(URL_RE) ?? [];
  const bare = t.replace(URL_RE, " ");

  const p = parts(t);
  if (BAD_DATE.test(t)) out.push({ level: "error", msg: "Замість «in progress» / «submitted» — (n.d.) або (in press), якщо прийнято до друку." });
  else if (!p) out.push({ level: "error", msg: "Немає дати в дужках після автора(ки): (2020). / (2020, August 26). / (n.d.). / (б. д.). / (in press)." });
  if (p) {
    if (!p.authors) out.push({ level: "error", msg: "Перед датою — автор(ка); якщо автора немає, на його місці — назва." });
    else checkAuthors(p.authors, out);
    if (!/^\s*\./.test(p.after)) out.push({ level: "error", msg: `Після дати — крапка: «(${p.date}).».` });
    const rest = p.after.replace(/^\s*\.\s*/, "");
    const title = rest.startsWith("*") ? rest.slice(1, rest.indexOf("*", 1) > 0 ? rest.indexOf("*", 1) : undefined) : rest.split(/(?<=[.?!])\s|\s\*|\[/)[0];
    if (!title.replace(/[.\s]/g, "")) out.push({ level: "error", msg: "Немає назви праці після дати." });
    else if (titleCase(title)) out.push({ level: "warn", msg: "Назва — реченнєвим регістром: з великої лише перше слово, перше слово після двокрапки й власні назви (назву журналу це не стосується)." });
  }

  if (/\.\s*\(\d+(st|nd|rd|th|-ге|-тє)\s*(ed|вид)\.\)/i.test(t)) out.push({ level: "error", msg: "Видання — «(2nd ed.)» одразу після назви, без крапки перед ним." });
  if (order === "one" && /\p{Script=Cyrillic}/u.test(t)) out.push({ level: "error", msg: "У «Одній абетці» кириличне джерело подають латиницею: транслітерація й переклад назви в [квадратних дужках]." });

  // A journal article: volume(issue), "volume, pages", or the old "Vol./No./Т./№" forms.
  const journal = /\*?\d+\*?\s?\(\d+[^)]*\)|,\s*\*?\d+\*?,\s*\d+[–-]\d+|\b(Vol|No)\.\s*\d|(?<!\p{L})Т\.\s*\d|№\s*\d/u.test(bare);
  if (/\b(Vol|No)\.\s*\d|(?<!\p{L})Т\.\s*\d|№\s*\d/u.test(bare)) out.push({ level: "error", msg: "Том і випуск — «12(3)», без «Vol.» / «No.» / «Т.» / «№»." });
  if (/\b\d+\*?\s+\(\d+\)/.test(bare.replace(DATE, ""))) out.push({ level: "error", msg: "Том(випуск) — без пробілу: «12(3)»." });
  const chapter = /(?<!\p{L})(In|У|В)\s.*\((Eds?|Ред)\.\)/u.test(bare);
  if (journal && !chapter && /\bpp?\.\s*\d|(?<!\p{L})с\.\s*\d/u.test(bare)) out.push({ level: "error", msg: "У статтях журналу сторінки — без «pp.» / «с.»: «45–60»." });
  if (chapter && /\d+[–-]\d+/.test(bare) && !/\((pp|с)\.\s*\d+[–-]\d+\)/.test(bare)) out.push({ level: "error", msg: "У розділі книги сторінки — у дужках: «(pp. 9–43)»." });
  if (/\d+-\d+/.test(bare.replace(DATE, ""))) out.push({ level: "error", msg: "У діапазоні — тире «–», а не дефіс «-»." });
  if (CITIES.test(bare) || /\b\p{Lu}\p{Ll}+, [A-Z]{2}:/u.test(bare)) out.push({ level: "error", msg: "Місто видання в APA 7 не потрібне — лише видавництво." });
  if (/\b(Inc|Ltd|LLC|Co)\.?(?=[\s.,]|$)|(?<!\p{L})ТОВ(?!\p{L})/u.test(bare)) out.push({ level: "error", msg: "Без «Inc.», «Ltd.», «LLC», «ТОВ» у назві видавництва." });
  if (journal && !t.includes("*")) out.push({ level: "warn", msg: "Назву журналу й том — курсивом: *Журнал*, *12*(3)." });

  if (/\bdoi:\s*10\./i.test(t)) out.push({ level: "error", msg: "DOI — як посилання: https://doi.org/10.…, без «doi:»." });
  if (/dx\.doi\.org/i.test(t)) out.push({ level: "error", msg: "DOI — https://doi.org/…, без «dx.»." });
  if (/Retrieved from|Режим доступу|URL:/i.test(t)) out.push({ level: "error", msg: "Без «Retrieved from» / «Режим доступу» — просто посилання (дату звернення — лише для сторінок, що змінюються: «Retrieved May 5, 2024, from»)." });
  const doi = urls.some((u) => /doi\.org\/10\./i.test(u)) || /\b10\.\d{4,}\//.test(t);
  if (doi && urls.some((u) => !/doi\.org/i.test(u))) out.push({ level: "warn", msg: "Якщо є DOI, звичайне посилання не потрібне." });
  if (journal && !doi) out.push({ level: "warn", msg: "Стаття в журналі без DOI — перевірте на doi.org, чи його справді немає." });

  if (/https?:\/\/\S+\.$/.test(t)) out.push({ level: "error", msg: "Після DOI чи посилання крапка не ставиться." });
  else if (!/[.?!]\*?$|https?:\/\/\S+$/.test(t)) out.push({ level: "error", msg: "Наприкінці — крапка (крім випадку, коли опис закінчується DOI чи посиланням)." });
  if (/(?<![.\s])\.\.(?!\.)/.test(bare)) out.push({ level: "error", msg: "Подвійна крапка." });
  return out;
}

const norm = (t: string) => t.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Every entry's issues, with the ones that need the whole list: duplicates, one author's works in one year. */
export function checkList(refs: Ref[], order: RefOrder): Map<string, Issue[]> {
  const out = new Map(refs.map((r) => [r.id, checkRef(r.text, order)]));
  const seen = new Map<string, string>();
  const byAuthorYear = new Map<string, Ref[]>();
  for (const r of refs) {
    const k = norm(r.text);
    if (seen.has(k)) out.get(r.id)!.push({ level: "warn", msg: "Таке саме джерело вже є в списку." });
    else seen.set(k, r.id);
    const p = parts(r.text);
    const year = p?.date.match(/^\d{4}/)?.[0];
    if (p?.authors && year) {
      const key = `${norm(p.authors)}|${year}`;
      byAuthorYear.set(key, [...(byAuthorYear.get(key) ?? []), r]);
    }
  }
  for (const list of byAuthorYear.values()) {
    if (list.length < 2 || new Set(list.map((r) => norm(r.text))).size < 2) continue;
    for (const r of list) {
      if (!/^\d{4}[a-zа-я]/.test(parts(r.text)!.date)) out.get(r.id)!.push({ level: "error", msg: "Кілька праць тих самих авторів(ок) за один рік — «2020a», «2020b» (і так само в посиланнях у тексті)." });
    }
  }
  return out;
}
