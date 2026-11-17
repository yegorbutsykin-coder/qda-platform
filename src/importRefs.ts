// Stage 6.4: sources from Zotero, Mendeley or Google Scholar (RIS or BibTeX) → reference entries by APA 7.
type Person = { family: string; given: string };
export type Item = {
  type: "article" | "book" | "chapter" | "other";
  authors: Person[]; editors: Person[]; year: string; title: string; container: string;
  volume: string; issue: string; pages: string; publisher: string; doi: string; url: string; edition: string;
};
const empty = (): Item => ({ type: "other", authors: [], editors: [], year: "", title: "", container: "", volume: "", issue: "", pages: "", publisher: "", doi: "", url: "", edition: "" });

/** "Smith, John A." or "John A. Smith"; one word or a braced name is an organisation. */
function person(raw: string): Person {
  const t = raw.trim().replace(/\s+/g, " ");
  if (/^\{.*\}$/.test(t)) return { family: t.slice(1, -1), given: "" };
  if (t.includes(",")) { const [f, ...g] = t.split(","); return { family: f.trim(), given: g.join(" ").trim() }; }
  const w = t.split(" ");
  return w.length === 1 ? { family: t, given: "" } : { family: w[w.length - 1], given: w.slice(0, -1).join(" ") };
}

/** "John Albert" → "J. A."; "Jean-Paul" → "J.-P."; initials already there stay. */
export const initials = (given: string) => given.split(/\s+/).filter(Boolean).map((w) => w.split("-").map((p) => (p[0] ? p[0].toUpperCase() + "." : "")).join("-")).join(" ");

function names(ps: Person[]): string {
  const one = (p: Person) => (p.given ? `${p.family}, ${initials(p.given)}` : p.family);
  if (ps.length === 1) return one(ps[0]);
  if (ps.length <= 20) return ps.slice(0, -1).map(one).join(", ") + ", & " + one(ps[ps.length - 1]);
  return ps.slice(0, 19).map(one).join(", ") + ", . . . " + one(ps[ps.length - 1]);
}
const editorsIn = (ps: Person[]) => {
  const one = (p: Person) => (p.given ? `${initials(p.given)} ${p.family}` : p.family);
  const list = ps.length <= 2 ? ps.map(one).join(" & ") : ps.slice(0, -1).map(one).join(", ") + ", & " + one(ps[ps.length - 1]);
  return `${list} (${ps.length > 1 ? "Eds." : "Ed."})`;
};
const end = (t: string) => (/[.?!]$/.test(t) ? t : t + "."); // a title ending in ? or ! takes no full stop
const pages = (p: string) => p.replace(/\s*-{1,2}\s*|\s*–\s*/g, "–");
const doiUrl = (d: string) => (d ? "https://doi.org/" + d.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, "").trim() : "");

/** One source as APA 7 wants it; *between asterisks* is italics. */
export function apa(it: Item): string {
  const date = `(${it.year || "n.d."}).`;
  const link = doiUrl(it.doi) || it.url;
  const title = it.title.trim(), ed = it.edition ? ` (${it.edition}${/ed\.?$/.test(it.edition) ? "" : " ed."})` : "";
  let work: string, source = "";
  if (it.type === "article") {
    work = end(title);
    const vol = it.volume ? `, *${it.volume}*${it.issue ? `(${it.issue})` : ""}` : "";
    source = `*${it.container}*${vol}${it.pages ? `, ${pages(it.pages)}` : ""}.`;
  } else if (it.type === "chapter") {
    work = end(title);
    const eds = it.editors.length ? `${editorsIn(it.editors)}, ` : "";
    source = `In ${eds}*${it.container}*${it.pages ? ` (pp. ${pages(it.pages)})` : ""}.${it.publisher ? ` ${end(it.publisher)}` : ""}`;
  } else {
    work = `*${title.replace(/[.]$/, "")}*${ed}.`;
    source = it.publisher ? end(it.publisher) : it.container ? end(it.container) : "";
  }
  // No author: the title moves to the author's place.
  const head = it.authors.length ? `${end(names(it.authors))} ${date} ${work}` : `${work} ${date}`;
  return [head, source, link].filter(Boolean).join(" ").replace(/\.\./g, ".").replace(/\s+/g, " ").trim();
}

const RIS_TYPE: Record<string, Item["type"]> = { JOUR: "article", JFULL: "article", MGZN: "article", NEWS: "article", EJOUR: "article", BOOK: "book", EBOOK: "book", EDBOOK: "book", CHAP: "chapter", ECHAP: "chapter" };

/** RIS: "TY  - JOUR" … "ER  -". */
export function parseRIS(text: string): Item[] {
  const out: Item[] = [];
  let cur: Item | null = null, sp = "", ep = "";
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, tag, v0] = m, v = v0.trim();
    if (tag === "TY") { cur = { ...empty(), type: RIS_TYPE[v] ?? "other" }; sp = ep = ""; continue; }
    if (!cur) continue;
    if (tag === "ER") { if (sp) cur.pages = ep ? `${sp}–${ep}` : sp; out.push(cur); cur = null; continue; }
    if (["AU", "A1"].includes(tag)) cur.authors.push(person(v));
    else if (["ED", "A2", "A3"].includes(tag) && cur.type === "chapter") cur.editors.push(person(v));
    else if (["PY", "Y1", "DA"].includes(tag) && !cur.year) cur.year = v.match(/\d{4}/)?.[0] ?? "";
    else if (["TI", "T1"].includes(tag)) cur.title = v;
    else if (["T2", "JO", "JF", "JA", "BT"].includes(tag) && !cur.container) cur.container = v;
    else if (tag === "VL") cur.volume = v;
    else if (tag === "IS") cur.issue = v;
    else if (tag === "SP") sp = v;
    else if (tag === "EP") ep = v;
    else if (tag === "PB") cur.publisher = v;
    else if (tag === "DO") cur.doi = v;
    else if (tag === "UR" && !cur.url) cur.url = v;
    else if (tag === "ET") cur.edition = v;
  }
  return out;
}

const TEX: [RegExp, string][] = [[/\\["]\{?([aouAOU])\}?/g, "$1̈"], [/\\'\{?(\w)\}?/g, "$1́"], [/\\`\{?(\w)\}?/g, "$1̀"], [/\\\^\{?(\w)\}?/g, "$1̂"], [/\\~\{?(\w)\}?/g, "$1̃"], [/\\c\{?(\w)\}?/g, "$1̧"], [/\\&/g, "&"], [/---/g, "—"], [/--/g, "–"]];
const untex = (v: string) => TEX.reduce((t, [re, r]) => t.replace(re, r), v).normalize("NFC").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
const BIB_TYPE: Record<string, Item["type"]> = { article: "article", book: "book", incollection: "chapter", inbook: "chapter" };

/** BibTeX: @article{key, author = {…}, year = 2020, …}. */
export function parseBibTeX(text: string): Item[] {
  const out: Item[] = [];
  const re = /@(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (/^(comment|string|preamble)$/i.test(m[1])) continue;
    // The entry runs to its matching brace.
    let depth = 1, i = re.lastIndex;
    for (; i < text.length && depth; i++) depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0;
    const body = text.slice(re.lastIndex, i - 1);
    re.lastIndex = i;
    const f: Record<string, string> = {};
    const fre = /(\w+)\s*=\s*/g;
    let fm: RegExpExecArray | null;
    while ((fm = fre.exec(body))) {
      let j = fre.lastIndex, v = "";
      if (body[j] === "{") { let d = 0, k = j; for (; k < body.length; k++) { d += body[k] === "{" ? 1 : body[k] === "}" ? -1 : 0; if (!d) break; } v = body.slice(j + 1, k); j = k + 1; }
      else if (body[j] === '"') { // ends at a quote outside braces: {\"u} is an umlaut, not the end
        let d = 0, k = j + 1;
        for (; k < body.length; k++) { if (body[k] === "{") d++; else if (body[k] === "}") d--; else if (body[k] === '"' && !d && body[k - 1] !== "\\") break; }
        v = body.slice(j + 1, k); j = k + 1;
      }
      else { const k = body.slice(j).search(/[,\n}]/); v = body.slice(j, k < 0 ? undefined : j + k); j += v.length; }
      f[fm[1].toLowerCase()] = v;
      fre.lastIndex = j;
    }
    // Authors split on " and " outside braces: "{World Health Organization}" stays whole.
    const people = (v = "") => v.split(/\s+and\s+(?![^{]*\})/).filter((x) => x.trim()).map((x) => { const p = person(x.trim()); return { family: untex(p.family), given: untex(p.given) }; });
    out.push({
      ...empty(), type: BIB_TYPE[m[1].toLowerCase()] ?? "other",
      authors: people(f.author), editors: people(f.editor), year: (f.year ?? f.date ?? "").match(/\d{4}/)?.[0] ?? "",
      title: untex(f.title ?? ""), container: untex(f.journal ?? f.journaltitle ?? f.booktitle ?? ""), volume: untex(f.volume ?? ""), issue: untex(f.number ?? f.issue ?? ""),
      pages: untex(f.pages ?? ""), publisher: untex(f.publisher ?? ""), doi: untex(f.doi ?? ""), url: untex(f.url ?? ""), edition: untex(f.edition ?? ""),
    });
  }
  return out;
}

/** Whatever the file is: RIS if it has "TY  -", otherwise BibTeX. */
export const parseRefs = (text: string) => (/^\s*TY\s{1,2}-/m.test(text) ? parseRIS(text) : parseBibTeX(text)).filter((x) => x.title || x.authors.length).map(apa);
