// Stage 5: the article — sections by method (APA 7 and JARS–Qual), word counts.

export type Method = "ІФА" | "Дескр." | "РТА";
export type Article = { title: string; format?: Method; texts: Record<string, string> };
export const SECTIONS = ["abstract", "intro", "method", "results", "discussion"] as const;
export type SectionKey = (typeof SECTIONS)[number];
export const TOTAL_LIMIT = 8000; // a common journal limit; the journal's own goes in «Вимоги журналу»

type Def = { name: string; hint: string; limit?: number };
const COMMON: Record<"abstract" | "intro", Def> = {
  abstract: { name: "Анотація", limit: 250, hint: "Мета, учасники(ці) й метод, основні результати й висновок — одним абзацом. Під анотацією — 3–5 ключових слів." },
  intro: { name: "Вступ", hint: "Проблема й чому вона важлива; що відомо з літератури і чого бракує; мета й дослідницьке запитання; чому обрано саме цей якісний підхід (JARS–Qual)." },
};
const BY_METHOD: Record<Method, Record<"method" | "results" | "discussion", Def>> = {
  "ІФА": {
    method: { name: "Метод", hint: "Обґрунтування ІФА: ідіографічність і подвійна герменевтика. Однорідна цільова вибірка — хто й як набраний(а). Збір даних (напівструктуроване інтерв'ю). Аналіз: дослівні коментарі → досвідні твердження → особистісні досвідні теми → групові досвідні теми. Рефлексивність дослідника(ці). Етика." },
    results: { name: "Групові досвідні теми", hint: "Кожна групова тема з підтемами; цитати кількох учасників(ць) з інтерпретацією, а не лише переказом; і спільне, і відмінне між випадками. Таблиця тем — за потреби." },
    discussion: { name: "Обговорення", hint: "Діалог із літературою: що теми додають до наявного розуміння; трансферабельність (а не узагальнення); обмеження; значення для практики." },
  },
  "Дескр.": {
    method: { name: "Метод", hint: "Обґрунтування дескриптивного феноменологічного методу; епохе — як ви виводили за дужки власні уявлення. Учасники(ці) й збір описів. Аналіз за Джорджі: смислові одиниці → психологічні трансформації → загальна структура; уявна варіація. Етика." },
    results: { name: "Загальна структура досвіду", hint: "Спершу загальна структура феномену, далі — сутнісні складники з прикладами з описів учасників(ць) і тим, як складники пов'язані між собою." },
    discussion: { name: "Обговорення", hint: "Що загальна структура додає до розуміння феномену; зв'язок із попередніми дослідженнями; обмеження; значення для практики." },
  },
  "РТА": {
    method: { name: "Метод", hint: "Позиція за Браун і Кларк: рефлексивний тематичний аналіз і ваша теоретична позиція; семантичне чи латентне, індуктивне чи дедуктивне кодування; шість фаз; рефлексивність. Не називайте сатурацію чи згоду кодувальників(ць) критеріями якості." },
    results: { name: "Теми", hint: "Для кожної теми — назва й центральна ідея (одне-два речення), аналітичний наратив, що виходить за межі переказу, і цитати як ілюстрації аргументу." },
    discussion: { name: "Обговорення", hint: "Як теми відповідають на дослідницьке запитання; роль позиції дослідника(ці) в інтерпретації; зв'язок із літературою; обмеження." },
  },
};

export const METHODS: Method[] = ["ІФА", "Дескр.", "РТА"];
export const asMethod = (m: string): Method => (METHODS.includes(m as Method) ? (m as Method) : "РТА");

export function sectionDef(key: SectionKey, method: Method): Def {
  return key === "abstract" || key === "intro" ? COMMON[key] : BY_METHOD[method][key];
}

/** Words as a journal counts them: letters or digits, with apostrophes and hyphens inside. */
export const countWords = (t: string) => (t.match(/[\p{L}\p{N}]+(?:['’ʼ-][\p{L}\p{N}]+)*/gu) ?? []).length;

export const emptyArticle = (): Article => ({ title: "", texts: {} });
