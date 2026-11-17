// Stage 6.3: citations in the text (Author, year) by APA 7, and checking them against the reference list.
import { parts } from "./apaCheck";
import { split, type Article } from "./article";

const cyr = (t: string) => /\p{Script=Cyrillic}/u.test(t);
const INITIALS = /^(\p{Lu}\p{Ll}?\.(?:(?:\s|-)\p{Lu}\p{Ll}?\.)*)$/u;

/** Surnames of a reference's authors; an organisation is one name. */
export function surnames(authors: string): string[] {
  const a = authors.replace(/\((?:Eds?|Ред|Упоряд)\.\)\.?/gi, "").trim();
  // "&", and also the "and" / "та" of a not-yet-fixed entry, separate authors.
  const tokens = a.replace(/(^|,)\s*&\s*/g, ",").replace(/\s+(?:&|and|та|і|й)\s+/g, ",").replace(/\.\s?\.\s?\./g, ",").split(/\s*,\s*/).filter(Boolean);
  const personal = tokens.length > 1 && (tokens.some((x, i) => i % 2 === 1 && (INITIALS.test(x) || /^\p{Lu}\.?(\s?\p{Lu}\.?)*$/u.test(x)))
    || (/^\p{Lu}[\p{L}'’-]+$/u.test(tokens[0]) && /^\p{Lu}\p{Ll}+$/u.test(tokens[1]))); // "Smith, John": full name instead of initials
  if (!personal) return [a.replace(/\.$/, "").trim()];
  return tokens.filter((_, i) => i % 2 === 0);
}

/** "(Бойко & Гнатюк, 2021)" and "Бойко та Гнатюк (2021)"; three and more — «та ін.» / "et al." (by the source's script). */
export function citeOf(ref: string): { paren: string; narr: string; key: string } | null {
  const p = parts(ref.trim());
  if (!p?.authors) return null;
  const names = surnames(p.authors), year = p.date.replace(/,.*$/, "").trim();
  const latin = !cyr(names[0]);
  const who = (and: string) => names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} ${and} ${names[1]}` : `${names[0]} ${latin ? "et al." : "та ін."}`;
  return { paren: `(${who("&")}, ${year})`, narr: `${who(latin ? "and" : "та")} (${year})`, key: keyOf(names[0], year) };
}

const keyOf = (first: string, year: string) => `${first.split(/\s+/)[0].toLowerCase()}|${year.toLowerCase().replace(/\s/g, "")}`;
const YEAR = /\d{4}[a-zа-я]?|n\.\s?d\.|б\.\s?д\.|in press|у друці/gi;
const SKIP = /^(див|see|e\.g|наприклад|cf|також|also|у|в|and|та|і|й|et|al|ін)$/i;

/** Citations in a text: parenthetical "(Boss, 1999; Бойко & Гнатюк, 2021a)" and narrative "Boss (1999)". */
export function citationsIn(text: string): { key: string; shown: string }[] {
  const out: { key: string; shown: string }[] = [];
  for (const m of text.matchAll(/\(([^()]*?(?:\d{4}[a-zа-я]?|n\.\s?d\.|б\.\s?д\.)[^()]*)\)/giu)) {
    for (const part of m[1].split(";")) {
      const first = part.match(/\p{Lu}[\p{L}'’-]+/gu)?.find((w) => !SKIP.test(w));
      const years = part.match(YEAR);
      if (!first || !years || !/,/.test(part)) continue; // "(2021)" alone belongs to a narrative citation
      for (const y of years) out.push({ key: keyOf(first, y), shown: `${first}, ${y}` });
    }
  }
  for (const m of text.matchAll(/(\p{Lu}[\p{L}'’-]+)(?:\s+(?:&|and|та|і)\s+\p{Lu}[\p{L}'’-]+|\s+(?:et al\.|та ін\.))?\s+\((\d{4}[a-zа-я]?|n\.\s?d\.|б\.\s?д\.)\)/gu)) {
    if (!SKIP.test(m[1])) out.push({ key: keyOf(m[1], m[2]), shown: `${m[1]} (${m[2]})` });
  }
  return out;
}

/** What the text cites that the list lacks (with the section), and list entries the text never cites. */
export function audit(a: Article, sections: { key: string; name: string }[]): { missing: { shown: string; sec: string }[]; unused: Set<string> } {
  const refs = (a.refs ?? []).map((r) => ({ id: r.id, c: citeOf(r.text) }));
  const have = new Set(refs.map((r) => r.c?.key).filter(Boolean));
  const cited = new Set<string>();
  const missing: { shown: string; sec: string }[] = [];
  for (const s of sections) {
    const text = split(a.texts[s.key] ?? "").map((p) => ("text" in p ? p.text : "")).join("\n");
    for (const c of citationsIn(text)) {
      cited.add(c.key);
      if (!have.has(c.key) && !missing.some((m) => m.shown === c.shown && m.sec === s.name)) missing.push({ shown: c.shown, sec: s.name });
    }
  }
  return { missing, unused: new Set(refs.filter((r) => r.c && !cited.has(r.c.key)).map((r) => r.id)) };
}
