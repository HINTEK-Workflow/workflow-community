import { SEARCH_COMMANDS, type SearchAccess } from "@/lib/search/commands";
import { RELEASE_NOTES } from "@/lib/release-notes";
import { WORKFLOW_KNOWLEDGE_PARTS } from "@/lib/ai/knowledge/workflow-knowledge";
import { GUIDE_SECTIONS, GUIDE_WORK_ORDER, GUIDE_WORK_ORDER_KEY, type GuideStep } from "@/lib/help/guide-steps";
import { FILM_TEXTS } from "@/lib/help/film-texts";

/**
 * Hjälpsökningen search_help (Workflow AI-utredningen 2026-11-21, hjälpare 12 "Hur gör jag i Workflow?"): a rule-based search –
 * no AI model, no cost, nothing leaves Workflow – over the app's own help: the pages and their search words (lib/search/commands.ts),
 * the chapter Så fungerar arbetsflödet (lib/help/guide-steps.ts), the knowledge package, the release notes ("Nytt i Workflow") and the
 * film manuscripts (lib/help/film-texts.ts). It answers with short excerpts and links to the right page, and with "Se filmen" where
 * a published film covers it. Pure: the caller hands it what the person may open (the same rules as Sök) and the film page's address.
 * The chat uses it for "hur gör jag …" questions (rules first), the API and MCP as the tool search_help.
 */
export type HelpSource = "page" | "guide" | "knowledge" | "release" | "film";
export type HelpDoc = {
  id: string; source: HelpSource; title: string; text: string; href: string;
  /** Extra search words (a page's keywords, a film's name). */
  words?: string;
  /** The title the search weighs most, when it is not the shown one (a film scene's own title). */
  match?: string;
  /** Where the text sits (a film's name and line): counts a little, so the scene that says it itself comes first. */
  context?: string;
  /** A published film that covers this text. */
  film?: { key: string; title: string; number: number } | null;
  /** How much this source counts (1 = full). */
  weight: number;
};
export type HelpHit = { source: HelpSource; title: string; text: string; href: string; film: { title: string; href: string } | null; score: number };
export type HelpAnswer = { query: string; hits: HelpHit[]; confident: boolean; filmsPage: string | null };

const SOURCE_LABEL: Record<HelpSource, string> = { page: "Sida", guide: "Hjälp", knowledge: "Så fungerar Workflow", release: "Nytt i Workflow", film: "Film" };
export const helpSourceLabel = (source: HelpSource) => SOURCE_LABEL[source];

// ---------- words ----------

const STOP = new Set(["jag", "du", "man", "vi", "ni", "hur", "var", "vart", "vad", "när", "kan", "får", "ska", "skall", "gör", "göra", "görs", "en", "ett", "den", "det", "de", "som", "och", "eller", "i", "in", "ut", "upp", "på", "till", "med", "för", "om", "av", "från", "att", "är", "har", "min", "mitt", "mina", "vår", "vårt", "våra", "sin", "sitt", "sina", "där", "här", "hittar", "hitta", "finns", "fungerar", "funkar", "workflow", "appen", "något", "någon", "några", "alla", "inte", "så", "mig", "dig", "oss", "nu", "vill", "vilken", "vilket", "vilka", "går", "gå", "ny", "nytt", "nya", "ställer", "ställa", "ändrar", "ändra", "kommer", "sätter", "sätta", "behöver", "måste", "brukar", "byter", "byta", "byt", "slår", "slå", "använder", "använda"]);
// Endings taken off before two words are compared ("arbetsordrar" and "arbetsordern" both become "arbetsord", "exporterar" "export").
const ENDINGS = ["erarna", "eringen", "arnas", "ernas", "ornas", "erade", "erad", "erar", "erat", "arna", "erna", "orna", "ande", "ende", "aren", "ens", "ets", "era", "are", "ar", "er", "or", "en", "et", "na", "an", "n", "s", "t", "a", "e"];

const fold = (value: string) => value.toLocaleLowerCase("sv").normalize("NFC");
export function stem(word: string) {
  // "Arbetsordrar" drops a vowel against "arbetsorder": the plural is read as the word itself first.
  word = word.replace(/ordr(ar|arna|arnas)$/, "order").replace(/order(n|ns|s)$/, "order");
  for (const ending of ENDINGS) if (word.length - ending.length >= 3 && word.endsWith(ending)) return word.slice(0, -ending.length);
  return word;
}
const split = (value: string) => fold(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** The words of a question that say what it is about, stemmed. */
export function helpTerms(query: string) {
  return [...new Set(split(query).filter((word) => word.length >= 2 && !STOP.has(word)).map(stem))].slice(0, 12);
}
/** Whether a term is found among the stems of a text: the same stem, a word that starts with it, or a compound that ends with it ("tidrapport"). */
function found(term: string, stems: ReadonlySet<string>, joined: string) {
  if (stems.has(term)) return true;
  // Stems of one word can differ by a letter ("godkänn" and "godkän"): one starting with the other is the same word.
  if (term.length >= 3) for (const word of stems) if (word.startsWith(term) || (word.length >= 4 && term.startsWith(word) && term.length - word.length <= 2)) return true;
  return term.length >= 5 && joined.includes(term);
}

// ---------- the corpus ----------

const pageHref = (key: string) => `/?view=help&step=${key}`;
/** How many of the newest versions' notes are searched. */
export const RELEASE_NOTES_SEARCHED = 15;
const stepText = (step: GuideStep) => [step.what, step.choices ?? "", step.result].filter(Boolean).join(" ");

/** Every help text, built once (pure data from the code). */
export function helpCorpus(): HelpDoc[] {
  const docs: HelpDoc[] = [];
  for (const command of SEARCH_COMMANDS) docs.push({ id: `page:${command.id}`, source: "page", title: command.label, text: `Öppna sidan ${command.label}.`, words: command.keywords, href: command.href, weight: 1.1 });
  for (const step of GUIDE_WORK_ORDER) docs.push({ id: `guide:${GUIDE_WORK_ORDER_KEY}:${step.name}`, source: "guide", title: `Arbetsordern: ${step.name.replace(/^\d+\.\s*/, "")}`, text: stepText(step), href: pageHref(GUIDE_WORK_ORDER_KEY), weight: 1 });
  for (const section of GUIDE_SECTIONS) for (const step of section.steps) docs.push({ id: `guide:${section.key}:${step.name}`, source: "guide", title: `${section.title}: ${step.name}`, text: stepText(step), href: pageHref(section.key), weight: 1 });
  WORKFLOW_KNOWLEDGE_PARTS.slice(1).forEach((part, index) => docs.push({ id: `knowledge:${index}`, source: "knowledge", title: knowledgeTitle(part), text: part, href: pageHref("modell"), weight: 0.9 }));
  // Only the newest versions: an old note may say how it used to be. The newest count most.
  RELEASE_NOTES.slice(0, RELEASE_NOTES_SEARCHED).forEach((note, order) => note.items.forEach((item, index) => docs.push({
    id: `release:${note.version}:${index}`, source: "release", title: `Nytt i version ${note.version}`, text: item, href: pageHref("nytt"),
    weight: 0.8 - order * 0.03,
  })));
  for (const film of FILM_TEXTS) film.scenes.forEach(([scene, text], index) => docs.push({
    id: `film:${film.key}:${index}`, source: "film", title: scene ? `${film.title}: ${scene}` : film.title, match: scene, text, context: `${film.title} ${film.subtitle}`, href: film.page,
    film: film.recorded ? { key: film.key, title: film.title, number: film.number } : null, weight: film.recorded ? 1 : 0.85,
  }));
  return docs;
}

/** A knowledge paragraph's title: its first words up to the first colon or full stop. */
function knowledgeTitle(part: string) {
  const head = part.split(/[:.]/)[0].trim();
  return head.length <= 60 ? head : `${head.slice(0, 57).trim()}…`;
}

type Field = { set: Set<string>; joined: string };
type Indexed = { doc: HelpDoc; title: Field; words: Field; body: Field; context: Field };
let indexed: Indexed[] | null = null;
function index(): Indexed[] {
  if (indexed) return indexed;
  const stems = (value: string): Field => { const list = split(value).map(stem); return { set: new Set(list), joined: ` ${list.join(" ")} ` }; };
  indexed = helpCorpus().map((doc) => ({ doc, title: stems(doc.match ?? doc.title), words: stems(doc.words ?? ""), body: stems(doc.text), context: stems(doc.context ?? "") }));
  return indexed;
}
/** How strongly a text holds a term: in its title 3, its search words 2, its text 1, only where it sits 0.5. */
const strength = (item: Indexed, term: string) => (found(term, item.title.set, item.title.joined) ? 3 : found(term, item.words.set, item.words.joined) ? 2
  : found(term, item.body.set, item.body.joined) ? 1 : found(term, item.context.set, item.context.joined) ? 0.5 : 0);

// ---------- who may open what ----------

const COMMAND_BY_HREF = new Map(SEARCH_COMMANDS.map((command) => [command.href, command]));
/** Whether the person may open the page a help text leads to: a page Sök would not offer is not offered here either. */
export function helpHrefShown(href: string, access: SearchAccess | null) {
  if (!access) return true;
  const command = COMMAND_BY_HREF.get(href);
  return !command || command.shown(access);
}

// ---------- the search ----------

/** The sentence of a text that holds most of the terms, at most `max` characters. */
function excerpt(text: string, terms: string[], max = 260) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const count = (sentence: string) => { const words = split(sentence).map(stem); const joined = ` ${words.join(" ")} `; return terms.filter((term) => found(term, new Set(words), joined)).length; };
  const best = sentences.map((sentence, at) => ({ sentence, at, n: count(sentence) })).sort((a, b) => b.n - a.n || a.at - b.at)[0];
  if (!best) return text.slice(0, max);
  // The best sentence and, while there is room, the one after it.
  let out = best.sentence;
  const next = sentences[best.at + 1];
  if (next && out.length + next.length + 1 <= max) out = `${out} ${next}`;
  return out.length > max ? `${out.slice(0, max - 1).trim()}…` : out;
}

export type HelpSearchOptions = {
  /** What the person may open (lib/search/commands.ts); null in a test means everything. */
  access?: SearchAccess | null;
  /** The public film page ("…/filmer"), or null where the installation has none (Community): then no film links. */
  filmsPage?: string | null;
  limit?: number;
  /** Only these kinds of source. */
  sources?: HelpSource[];
};

/**
 * The best help texts for a question, ranked: every word of the question is looked for in the title (counts most), the search
 * words and the text, stem by stem. `confident` is the rules' own judgement that the answer is good enough to give without the
 * AI model: most of the question's words found in one text, and at least one of them in its title or search words.
 */
export function searchHelp(query: string, options: HelpSearchOptions = {}): HelpAnswer {
  const terms = splitCompounds(helpTerms(query));
  const filmsPage = options.filmsPage ?? null;
  if (!terms.length) return { query, hits: [], confident: false, filmsPage };
  const allowed = options.sources ? new Set(options.sources) : null;
  const all = index();
  const where = all.map((item) => terms.map((term) => strength(item, term)));
  // A rare word says more than a common one ("timpris" against "inställning"): each term weighs by how few texts hold it.
  const rarity = terms.map((_, at) => Math.log((all.length + 1) / (1 + where.filter((row) => row[at] > 0).length)) + 0.1);
  const total = rarity.reduce((sum, value) => sum + value, 0);
  const scored: { doc: HelpDoc; score: number; coverage: number; inTitle: boolean }[] = [];
  all.forEach((item, at) => {
    if (allowed && !allowed.has(item.doc.source)) return;
    if (!helpHrefShown(item.doc.href, options.access ?? null)) return;
    let score = 0, covered = 0, inTitle = false, matched = 0;
    where[at].forEach((field, term) => {
      if (!field) return;
      matched += 1;
      covered += rarity[term] * Math.min(1, field);
      score += field * rarity[term];
      if (field >= 2) inTitle = true;
    });
    if (!matched) return;
    const coverage = covered / total;
    // A text that holds only the common words of a question is noise.
    if (terms.length >= 2 && coverage < 0.34) return;
    // Every word in the title or the search words: the text is about exactly this.
    const whole = where[at].every((field) => field >= 2) ? 1.3 : 1;
    scored.push({ doc: item.doc, score: score * coverage * item.doc.weight * whole, coverage, inTitle });
  });
  scored.sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id));
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const hits: HelpHit[] = [];
  const seen = new Set<string>();
  for (const { doc, score } of scored) {
    // One text per page and source, so five hits are five different answers.
    const key = `${doc.source}:${doc.href}:${doc.film?.key ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ source: doc.source, title: doc.title, text: doc.source === "page" ? doc.text : excerpt(doc.text, terms), href: doc.href, film: filmLink(doc, filmsPage), score: Math.round(score * 100) / 100 });
    if (hits.length >= limit) break;
  }
  // A page or text without a film gets the film of its page when one covers it (Se filmen beside the page link).
  for (const hit of hits) if (!hit.film && filmsPage) { const film = FILM_TEXTS.find((item) => item.recorded && item.page === hit.href); if (film) hit.film = { title: film.title, href: filmsPage }; }
  const best = scored[0];
  const confident = Boolean(best && best.coverage >= 0.7 && best.inTitle);
  return { query, hits, confident, filmsPage };
}

/**
 * A compound no help text holds ("maskinlarm") is looked for as its two parts ("maskin", "larm") when both are words the help
 * uses, so a question in the person's own words still finds the page.
 */
function splitCompounds(terms: string[]) {
  const all = index();
  const known = (term: string) => all.some((item) => strength(item, term) > 0);
  return [...new Set(terms.flatMap((term) => {
    if (term.length < 7 || known(term)) return [term];
    for (let at = 3; at <= term.length - 3; at += 1) {
      const head = term.slice(0, at), tail = stem(term.slice(at));
      if (known(head) && known(tail)) return [head, tail];
    }
    return [term];
  }))];
}

const filmLink = (doc: HelpDoc, filmsPage: string | null) => (doc.film && filmsPage ? { title: doc.film.title, href: filmsPage } : null);
