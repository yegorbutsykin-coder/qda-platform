// Transcript parsing and anonymisation. Pure functions: tested in text.test.ts.

export type Role = "i" | "p" | "o"; // інтерв'юер(ка), учасник(ця), інше
export type Replica = { t: string | null; label: string | null; text: string };
export type Parsed = { replicas: Replica[]; labels: { label: string; count: number }[]; timecodes: number };

const TIMECODE = /^\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d+)?[\])]?\s*[-–—]?\s*/;
const SPEAKER = /^([^\s:][^:\n]{0,29}?)\s*:\s+/;
const LETTER = "\\p{L}\\p{M}";

/** One paragraph per replica; finds timecodes and speaker labels ("Інтерв'юер:", "Р:", "Speaker 1:") if present. */
export function parseTranscript(raw: string, findSpeakers = true): Parsed {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((line) => {
    const tc = TIMECODE.exec(line);
    const rest = tc ? line.slice(tc[0].length) : line;
    const sp = SPEAKER.exec(rest);
    const label = sp && sp[1].split(/\s+/).length <= 4 && !/[.!?…,;]$/.test(sp[1]) ? sp[1].trim() : null;
    return { t: tc ? tc[1] : null, label, rest, text: label ? rest.slice(sp![0].length) : rest };
  });
  const counts = new Map<string, number>();
  rows.forEach((r) => r.label && counts.set(r.label, (counts.get(r.label) ?? 0) + 1));
  // A label must repeat, and labelled lines must be a real share of the text, or it is just a colon in speech.
  const labels = [...counts].filter(([, n]) => n >= 2).map(([label, count]) => ({ label, count }));
  const labelled = rows.filter((r) => r.label && counts.get(r.label)! >= 2).length;
  const useSpeakers = findSpeakers && labels.length > 0 && labelled >= rows.length * 0.3;

  const replicas: Replica[] = [];
  for (const r of rows) {
    const known = useSpeakers && r.label !== null && counts.get(r.label)! >= 2;
    const prev = replicas[replicas.length - 1];
    if (useSpeakers && !known && !r.t && prev) prev.text += "\n" + r.rest; // continuation of the same speaker
    else replicas.push({ t: r.t, label: known ? r.label : useSpeakers && prev ? prev.label : null, text: known ? r.text : r.rest });
  }
  return { replicas, labels: useSpeakers ? labels : [], timecodes: rows.filter((r) => r.t).length };
}

/** A first guess of who a label is; the person confirms or changes it. */
export function guessRole(label: string): Role {
  const l = label.toLowerCase();
  if (/^(і|i|q|інт|інтерв|interv|досл|питання|ведуч)/.test(l)) return "i";
  return "p";
}

// ---------- replacement dictionary ----------

export type Kind = "person" | "place" | "org" | "other";
export type DictEntry = { id: string; kind: Kind; from: string[]; to: string; scope: string; caps: boolean };
export type Segment = { text: string; orig?: string; entry?: string };

const ENDINGS = "аяоеєіїиуюьй";

/** Stems of a word for finding its case forms: Оксана → Оксан; Київ → Київ, Києв; Львів → Львів, Львов. */
export function stems(word: string): string[] {
  const w = word.trim();
  if (w.length < 4) return [w];
  const out = [ENDINGS.includes(w.slice(-1).toLowerCase()) ? w.slice(0, -1) : w];
  const pre = w.slice(-2, -1).toLowerCase();
  if ((pre === "і" || pre === "ї") && !ENDINGS.includes(w.slice(-1).toLowerCase())) {
    for (const v of pre === "ї" ? ["є"] : ["о", "е"]) out.push(w.slice(0, -2) + v + w.slice(-1));
  }
  return out;
}

const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
function chars(s: string, firstExact: boolean) {
  return [...s].map((c, i) => (i === 0 && firstExact) || c.toLowerCase() === c.toUpperCase() ? esc(c) : `[${esc(c.toLowerCase())}${esc(c.toUpperCase())}]`).join("");
}

function variantPattern(v: string, caps: boolean): string {
  const words = v.trim().split(/\s+/);
  return words
    .map((w, i) => {
      const exact = i === 0 && caps;
      const ss = stems(w);
      if (ss[0].length < 3) return chars(w, exact); // short words only as written
      return `(?:${ss.map((s) => chars(s, exact)).join("|")})[${LETTER}'’ʼ]{0,4}`;
    })
    .join("\\s+");
}

const compiled = new Map<string, RegExp | null>();

/** Compiled once per spelling list: a big project runs the dictionary over thousands of replicas. */
export function entryRegex(e: DictEntry): RegExp | null {
  const key = `${e.caps}|${e.from.join("|")}`;
  if (!compiled.has(key)) {
    const vs = e.from.map((v) => v.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
    compiled.set(key, vs.length ? new RegExp(`(?<![${LETTER}'’ʼ])(?:${vs.map((v) => variantPattern(v, e.caps)).join("|")})(?![${LETTER}])`, "gu") : null);
  }
  const re = compiled.get(key)!;
  if (re) re.lastIndex = 0;
  return re;
}

const applies = (e: DictEntry, interview: string) => e.scope === "all" || e.scope === interview;

/** Splits text into plain and replaced pieces. An entry with an empty replacement leaves the word visible. */
export function applyDict(text: string, dict: DictEntry[], interview: string): Segment[] {
  const hits: { start: number; end: number; e: DictEntry }[] = [];
  for (const e of dict) {
    if (!applies(e, interview) || !e.to.trim()) continue;
    const re = entryRegex(e);
    if (!re) continue;
    for (const m of text.matchAll(re)) hits.push({ start: m.index!, end: m.index! + m[0].length, e });
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const segs: Segment[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue; // overlaps an earlier, longer match
    if (h.start > at) segs.push({ text: text.slice(at, h.start) });
    segs.push({ text: h.e.to.trim(), orig: text.slice(h.start, h.end), entry: h.e.id });
    at = h.end;
  }
  if (at < text.length) segs.push({ text: text.slice(at) });
  return segs;
}

export const joinSegments = (segs: Segment[]) => segs.map((s) => s.text).join("");

/** Forms found in the texts for one entry, e.g. { "Оксана": 1, "Оксані": 2 }. */
export function formsFound(e: DictEntry, texts: { id: string; text: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  const re = entryRegex(e);
  if (!re) return out;
  for (const t of texts) {
    if (!applies(e, t.id)) continue;
    for (const m of t.text.matchAll(re)) out[m[0]] = (out[m[0]] ?? 0) + 1;
  }
  return out;
}

// ---------- words that look like real names ----------

export type Suspect = { word: string; kind: Kind; count: number; interviews: string[]; key: string };

const PLACE_PREP = /(?:^|\s)(в|у|до|під|біля|через)\s+$/i;
const PLACE_END = /(поль|полі|ськ|цьк|град|город|піль|ів|їв|ове|ине)$/i;
const NOT_NAMES = new Set(["я", "бог", "господи", "боже", "мамо", "тато", "ок"]);

/** Groups forms of one name: Андрій, Андрієм → "андрі". */
export const wordKey = (w: string) => w.toLowerCase().slice(0, Math.max(5, w.length - 3));

/** Capitalised words in mid-sentence that the dictionary does not cover yet. A hint, not a check. */
export function suspects(texts: { id: string; segs: Segment[] }[], ignored: string[]): Suspect[] {
  const skip = new Set(ignored.map((w) => w.toLowerCase()));
  const found = new Map<string, Suspect & { forms: Record<string, number> }>();
  const re = new RegExp(`(?<![${LETTER}'’ʼ-])(\\p{Lu}[\\p{Ll}'’ʼ-]*\\p{Ll}|\\p{Lu}{2,6})(?![${LETTER}])`, "gu");
  for (const t of texts) {
    let before = "";
    for (const seg of t.segs) {
      if (seg.orig !== undefined) { before += seg.text; continue; }
      for (const m of seg.text.matchAll(re)) {
        const ctx = (before + seg.text.slice(0, m.index)).replace(/["«»„“”'()\s—–-]+$/u, "");
        if (!ctx || /[.!?…:\n]$/.test(ctx)) continue; // start of a sentence or line
        const w = m[1];
        const key = wordKey(w);
        if (NOT_NAMES.has(w.toLowerCase()) || skip.has(key)) continue;
        const kind: Kind = /^\p{Lu}{2,6}$/u.test(w) ? "org" : PLACE_PREP.test(before + seg.text.slice(0, m.index)) || PLACE_END.test(w) ? "place" : "person";
        const s = found.get(key) ?? { word: w, kind, count: 0, interviews: [], key, forms: {} };
        s.count++;
        s.forms[w] = (s.forms[w] ?? 0) + 1;
        if (!s.interviews.includes(t.id)) s.interviews.push(t.id);
        found.set(key, s);
      }
      before += seg.text;
    }
  }
  return [...found.values()]
    .map(({ forms, ...s }) => ({ ...s, word: Object.entries(forms).sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.count - a.count);
}

export const READY: Record<Kind, string[]> = {
  person: ["[ім'я]", "[донька]", "[син]", "[сестра]", "[чоловік]"],
  place: ["[місто]", "[село]", "[область]", "[країна]"],
  org: ["[установа]", "[організація]", "[військова частина]"],
  other: ["[приховано]", "[дата]"],
};
