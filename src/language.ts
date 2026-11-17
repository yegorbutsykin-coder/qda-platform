// Stage 4.3: the participants' language — words in context, pronouns and tense, emotional tone.
// These are helper counts by indicator words (Ukrainian and Russian forms, for surzhyk), not measures.

export const words = (t: string) => t.toLowerCase().replace(/[’ʼ`]/g, "'").match(/[\p{L}']+/gu) ?? [];

// ---------- words in context ----------

export type Hit = { left: string; word: string; right: string; at: number };
/** Every word starting with `q` (or exactly `q`), with up to `span` characters around it. */
export function kwic(text: string, q: string, exact: boolean, span = 60): Hit[] {
  const query = q.trim().toLowerCase().replace(/[’ʼ`]/g, "'");
  if (!query) return [];
  const out: Hit[] = [];
  const re = /[\p{L}'’ʼ]+/gu;
  for (let m; (m = re.exec(text)); ) {
    const w = m[0].toLowerCase().replace(/[’ʼ`]/g, "'");
    if (exact ? w !== query : !w.startsWith(query)) continue;
    out.push({ left: text.slice(Math.max(0, m.index - span), m.index), word: m[0], right: text.slice(m.index + m[0].length, m.index + m[0].length + span), at: m.index });
  }
  return out;
}

// Function words that say little about a theme (Ukrainian and Russian).
const STOP = new Set(("і й та а але що як це в у на з із зі до по за від для про при над під не ні так то же ж би б чи ну от ось ще вже лише тільки дуже там тут коли який яка яке які цей ця ці той та те ті " +
  "я ми ти ви він вона воно вони мене мені мною нас нам нами тебе тобі його її їх йому їй їм ним нею ними мій моя моє мої наш наша наше наші свій своя своє свої " +
  "був була було були є бути буде буду можна треба " +
  "и в во на с со к ко по за от для о об при над под не ни так то же бы ли что как это его ее их мы вы он она оно они меня мне нас нам тебя тебе было была были есть быть уже еще очень там тут когда какой").split(" "));

/** Words a category's fragments use much more than the rest (smoothed ratio of shares); at least 2 uses. */
export function characteristic(catText: string, allText: string, top = 8): string[] {
  const count = (t: string) => {
    const m = new Map<string, number>();
    for (const w of words(t)) if (w.length > 2 && !STOP.has(w)) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const c = count(catText), a = count(allText);
  const cn = [...c.values()].reduce((x, y) => x + y, 0) + 1, an = [...a.values()].reduce((x, y) => x + y, 0) + 1;
  return [...c].filter(([, n]) => n >= 2)
    .map(([w, n]) => [w, ((n + 0.5) / cn) / (((a.get(w) ?? n) + 0.5) / an), n] as const)
    .sort((x, y) => (Math.abs(y[1] - x[1]) > 1e-9 ? y[1] - x[1] : 0) || y[2] - x[2] || x[0].localeCompare(y[0], "uk")).slice(0, top).map(([w]) => w);
}

// ---------- pronouns and tense ----------

const PRON: Record<"я" | "ми" | "ти" | "він/вона/вони", string[]> = {
  "я": ["я", "мене", "мені", "мною", "мій", "моя", "моє", "мої", "мого", "моєї", "моїй", "моєму", "моїх", "моїм", "меня", "мне", "мной", "мой", "моя", "моё", "мое", "мои", "моего", "моей"],
  "ми": ["ми", "нас", "нам", "нами", "наш", "наша", "наше", "наші", "нашого", "нашої", "нашій", "нашому", "наших", "нашим", "мы", "наши", "нашей"],
  "ти": ["ти", "тебе", "тобі", "тобою", "твій", "твоя", "твоє", "твої", "ты", "тебя", "тебе", "твой"],
  "він/вона/вони": ["він", "вона", "воно", "вони", "його", "її", "їх", "йому", "їй", "їм", "ним", "нею", "ними", "них", "нього", "неї", "он", "она", "оно", "они", "его", "ее", "её", "их", "ему", "ей", "им", "ней"],
};
export const PRONOUNS = Object.keys(PRON) as (keyof typeof PRON)[];
const PRON_OF = new Map(Object.entries(PRON).flatMap(([k, ws]) => ws.map((w) => [w, k])));

export function pronouns(text: string): Record<string, number> {
  const r: Record<string, number> = Object.fromEntries(PRONOUNS.map((k) => [k, 0]));
  for (const w of words(text)) { const k = PRON_OF.get(w); if (k) r[k]++; }
  return r;
}

export const TENSES = ["минуле", "теперішнє", "майбутнє"] as const;
const PAST_WORDS = new Set(["був", "була", "було", "були", "тоді", "колись", "раніше", "минулого", "минулий", "до", "был", "была", "было", "были", "тогда", "раньше"]);
const NOW_WORDS = new Set(["зараз", "тепер", "сьогодні", "нині", "досі", "сейчас", "теперь", "сегодня", "є"]);
const FUT_WORDS = new Set(["буду", "будеш", "буде", "будемо", "будете", "будуть", "завтра", "згодом", "колись-то", "будет", "будут", "будем", "потом"]);
/** Past by "-в/-ла/-ло/-ли" verb endings and markers; future by "буду…" and "-тиму…"; present by markers. */
export function tenses(text: string): Record<string, number> {
  const r: Record<string, number> = { "минуле": 0, "теперішнє": 0, "майбутнє": 0 };
  for (const w of words(text)) {
    if (FUT_WORDS.has(w) || /тиму$|тимеш$|тиме$|тимемо$|тимете$|тимуть$/.test(w)) r["майбутнє"]++;
    else if (PAST_WORDS.has(w) || (w.length > 4 && /(ла|ло|ли|лася|лося|лися|вся)$/.test(w))) r["минуле"]++;
    else if (NOW_WORDS.has(w)) r["теперішнє"]++;
  }
  return r;
}

// ---------- emotional tone ----------

export type Tone = "neg" | "amb" | "pos" | "neu";
export const TONES: { id: Tone; name: string }[] = [
  { id: "neg", name: "негативне" }, { id: "amb", name: "амбівалентне" }, { id: "pos", name: "позитивне" }, { id: "neu", name: "нейтральне" },
];
const NEG = ["страх", "страш", "бо", "боя", "біль", "болі", "болю", "болить", "сум", "плак", "плач", "жах", "тривог", "самотн", "втрат", "втрати", "смерт", "помер", "загин", "горе", "відчай", "розпач", "злість", "зл", "ненавид", "сором", "винн", "провин", "тяжк", "важк", "погано", "гірк", "туг", "сльоз", "мертв", "порожн", "розгубл", "безнад", "лякає", "боль", "плох", "тяжел", "груст", "ужас", "тоск", "одинок", "больно"];
const POS = ["радіс", "радо", "щаст", "щасл", "любов", "люб", "тепл", "добре", "гарн", "вдяч", "спокій", "спокійн", "наді", "підтрим", "сміял", "сміх", "весел", "легше", "легко", "горд", "вільн", "обійм", "затишн", "хорош", "счаст", "радост", "надежд", "спокойн", "благодар"];
// Short stems only match whole words or as the very start (to keep "бо" = because out).
const hit = (w: string, stems: string[]) => stems.some((s) => (s.length <= 2 ? w === s + "ю" || w === s + "юся" : w.startsWith(s)));

/** A suggestion only: the researcher confirms or rejects it. */
export function suggestTone(text: string): Tone {
  const ws = words(text);
  const n = ws.some((w) => hit(w, NEG)), p = ws.some((w) => hit(w, POS));
  return n && p ? "amb" : n ? "neg" : p ? "pos" : "neu";
}
