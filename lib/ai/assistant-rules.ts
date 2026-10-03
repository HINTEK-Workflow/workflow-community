// Workflow AI answers rule-first (2026-09-30): ordinary questions about the person's own work are answered with
// the same tools as the API and MCP (search, lists, lookups) – no AI model, no credits. Only questions that need
// interpretation, summarising or analysis go to the AI model. Pure functions: no database, no tools, no provider.
// Widened (2026-10-01: "ger dåliga svar"): weekdays and week numbers, counts, a kind filter for my work,
// details of one project, customer or task ("status på Strömgatan", "vem är ansvarig för …"), greetings and thanks, and
// a helpful answer with links when someone asks the assistant to create or change something.

import { addSwedishDays, swedishDate, swedishDayKey, swedishMonday, swedishParts, startOfSwedishMonth } from "@/lib/swedish-time";
import type { ToolName } from "@/lib/tools/catalog";

export type RulePlan =
  | { kind: "help" }
  | { kind: "greeting" }
  | { kind: "thanks" }
  /** A question about something else than work in Workflow (weather, news, sport …): answered for free, never by AI. */
  | { kind: "outside" }
  | { kind: "tool"; tool: ToolName; input: Record<string, unknown>; heading: string }
  /** One thing by name: the engine searches and, with one clear match, answers with its details. */
  | { kind: "lookup"; query: string; prefer: "project" | "customer" | "task" | "any"; heading: string }
  /** A request to create or change something: the assistant does not change data; it says where to do it. */
  | { kind: "action"; what: "work_order" | "project" | "customer" | "planning" | "time" | "task" | "form" | "other" }
  | { kind: "ai"; reason: "interpretation" | "open-question"; searchQuery: string | null };

const normalize = (text: string) => text.toLowerCase().normalize("NFC").replace(/[?!.]+$/g, "").replace(/\s+/g, " ").trim();

/** Words that ask for interpretation, summarising or analysis – those go to the AI model. */
// Stems without a closing \b: JavaScript's \b treats å, ä and ö as non-word characters ("föreslå" would never match).
const AI_WORDS = /\b(sammanfatta|sammanställ|analysera|analys|jämför|förklara|varför|hur kommer det sig|föreslå|förslag|skriv|formulera|bedöm|tolka|resonera|vad tycker du|rekommendera|utvärdera|granska)/;
const ACTION_WORDS = /^(skapa|lägg till|lägg in|registrera|boka|planera in|starta|ändra|uppdatera|rätta|ta bort|radera|flytta|avsluta|slutför|signera)\b/;
const STOP_WORDS = new Set(["jag", "du", "vi", "min", "mitt", "mina", "en", "ett", "den", "det", "de", "om", "för", "på", "i", "till", "med", "och", "eller", "som", "vad", "hur", "var", "när", "vilka", "vilken", "vilket", "är", "har", "kan", "ska", "finns", "alla", "någon", "något", "visa", "sök", "hitta", "leta", "efter", "lista", "status", "läget", "info", "information", "berätta", "ge", "mig", "gärna", "snälla", "tack"]);
/** Everyday topics that are not work in Workflow. */
const OUTSIDE_WORKFLOW = /\b(väder|vädret|väderprognos|prognos(en)?|regn|regnar|snö|snöar|blåsigt|temperatur(en)? ute|grader ute|soligt|nyhet(er|erna)?|sport|fotboll|hockey|matchen|resultat(et)? i|aktie|aktier|börs(en)?|bitcoin|valuta(kurs)?|recept|middag|lunch|restaurang|film|filmer|serie|serier|musik|låt(en)?|skämt|vits|dikt|horoskop|lotto|trav|semester|flyg|tåg(et)?|hotell|vem vann|vem är kung|huvudstad|översätt)\b/;
/** Words about work, places of work and electrical installations – a question with any of them may need AI. */
const WORK_DOMAIN = /\b(uppgift|arbetsorder|arbetsordrar|projekt|kund|kontroll|protokoll|risk|tid|timmar|planering|anläggning|central|elcentral|kabel|säkring|jordfel|isolation|mätning|spänning|ström|installation|el|elarbete|elsäkerhet|arbetsplats|bygg|montage|service|rond|formulär|rapport)/;
const WEEKDAYS = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];

/**
 * Words the rules understand, for spelling mistakes (2026-10-01: "Hur många arbetsordar jag har?" went to the
 * AI model and cost credits). A word of five letters or more that is not one of these but one typo away (two for long
 * words) is read as the nearest one, so the rules answer it directly and for free.
 */
const VOCABULARY = ["arbetsorder", "arbetsordrar", "arbetsordern", "arbetsordrarna", "uppgift", "uppgifter", "uppgiften", "uppgifterna", "kontroll", "kontroller", "kontrollen", "kontrollerna", "protokoll", "protokollet", "riskbedömning", "riskbedömningar", "projekt", "projektet", "projekten", "kunder", "kunden", "kunderna", "kundregistret", "planering", "planeringen", "planerat", "planerade", "påminnelser", "påminnelse", "försenat", "försenade", "förfallna", "förfallen", "tidrapport", "tidrapporten", "timmar", "pågående", "slutförda", "slutföra", "slutför", "färdigställa", "färdigställd", "avslutade", "arkiverade", "veckan", "vecka", "månaden", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag", "imorgon", "ansvarig", "status", "statusen", "notiser", "många", "rapporterad", "rapporterat", "behöver", "åtgärdas", "driftronder", "ronder"];
const VOCABULARY_SET = new Set(VOCABULARY);

/** Optimal string alignment distance, stopping early above the limit. */
function distance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      best = Math.min(best, rows[i][j]);
    }
    if (best > limit) return limit + 1;
  }
  return rows[a.length][b.length];
}

/** The question with obvious misspellings of Workflow's own words corrected; names and numbers are left alone. */
export function correctTypos(text: string) {
  return text.split(" ").map((word) => {
    if (word.length < 5 || VOCABULARY_SET.has(word) || STOP_WORDS.has(word) || /[\d"'”“]/.test(word)) return word;
    // An inflection of a known word ("måndags", "projektets") is not a typo.
    if (VOCABULARY.some((value) => word.startsWith(value) && word.length - value.length <= 3)) return word;
    const limit = word.length >= 9 ? 2 : 1;
    let best: { value: string; cost: number } | null = null;
    for (const value of VOCABULARY) {
      const cost = distance(word, value, limit);
      if (cost <= limit && (!best || cost < best.cost)) best = { value, cost };
    }
    return best?.value ?? word;
  }).join(" ");
}

/** The period a question names (Swedish days), for time and planning: days, weekdays, weeks, week numbers and months. */
export function periodOf(text: string, now = new Date()): { from: string; to: string; label: string } {
  const t = normalize(text);
  const today = swedishDayKey(now);
  const day = (value: Date, label: string) => { const key = swedishDayKey(value); return { from: key, to: key, label }; };
  if (/\b(i ?morgon|imorgon)\b/.test(t)) return day(addSwedishDays(now, 1), "i morgon");
  if (/\bi ?övermorgon\b/.test(t)) return day(addSwedishDays(now, 2), "i övermorgon");
  if (/\bi ?går\b/.test(t)) return day(addSwedishDays(now, -1), "i går");
  if (/\b(i ?dag|idag)\b/.test(t)) return { from: today, to: today, label: "i dag" };
  // "på fredag" is the coming Friday (today counts); "i fredags" the last one.
  const weekday = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}(s|en)?\\b`).test(t));
  if (weekday >= 0) {
    const past = new RegExp(`\\bi ${WEEKDAYS[weekday]}s\\b`).test(t) || /\bförra\b/.test(t);
    const current = swedishParts(now).weekday;
    const delta = past ? -((current - weekday + 7) % 7 || 7) : (weekday - current + 7) % 7;
    return day(addSwedishDays(now, delta), past ? `i ${WEEKDAYS[weekday]}s` : `på ${WEEKDAYS[weekday]}`);
  }
  const week = /\b(?:vecka|v\.?)\s?(\d{1,2})\b/.exec(t);
  if (week) {
    const number = Number(week[1]);
    if (number >= 1 && number <= 53) {
      // ISO week: the Monday of week 1 is the Monday of the week with 4 January.
      const parts = swedishParts(now);
      const monday1 = swedishMonday(swedishDate(parts.year, 1, 4));
      const monday = addSwedishDays(monday1, (number - 1) * 7);
      return { from: swedishDayKey(monday), to: swedishDayKey(addSwedishDays(monday, 6)), label: `vecka ${number}` };
    }
  }
  if (/\bförra veckan\b/.test(t)) { const monday = addSwedishDays(swedishMonday(now), -7); return { from: swedishDayKey(monday), to: swedishDayKey(addSwedishDays(monday, 6)), label: "förra veckan" }; }
  if (/\bnästa vecka\b/.test(t)) { const monday = addSwedishDays(swedishMonday(now), 7); return { from: swedishDayKey(monday), to: swedishDayKey(addSwedishDays(monday, 6)), label: "nästa vecka" }; }
  if (/\b(förra månaden|förra månad)\b/.test(t)) { const start = startOfSwedishMonth(now, -1); return { from: swedishDayKey(start), to: swedishDayKey(addSwedishDays(startOfSwedishMonth(now), -1)), label: "förra månaden" }; }
  if (/\bnästa månad\b/.test(t)) { const start = startOfSwedishMonth(now, 1); return { from: swedishDayKey(start), to: swedishDayKey(addSwedishDays(startOfSwedishMonth(now, 2), -1)), label: "nästa månad" }; }
  if (/\b(denna månad|den här månaden|i månaden|månaden)\b/.test(t)) return { from: swedishDayKey(startOfSwedishMonth(now)), to: swedishDayKey(addSwedishDays(startOfSwedishMonth(now, 1), -1)), label: "den här månaden" };
  const monday = swedishMonday(now);
  return { from: swedishDayKey(monday), to: swedishDayKey(addSwedishDays(monday, 6)), label: "den här veckan" };
}

/** The words worth searching for in a free question. */
export function searchTerms(text: string) {
  const words = normalize(text).replace(/["'”“]/g, "").split(" ").filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  return words.join(" ").slice(0, 100).trim();
}

/** The kind of work a question names, as the search words Mina uppgifter understands ("arbetsorder" finds work orders). */
function kindWord(t: string) {
  if (/\barbetsord(er|rar|ern|rarna)?\b/.test(t)) return "arbetsorder";
  if (/\briskbedömning(ar|en|arna)?\b/.test(t)) return "riskbedömning";
  if (/\bkontroll(er|en|erna)?\b|\bprotokoll(et|en)?\b/.test(t)) return "kontroll";
  return "";
}

/**
 * Decides how a question is answered. The order matters: greetings and help, then explicit requests to create or
 * change (answered with where to do it), then explicit requests for interpretation (AI), then the rule answers, then a
 * lookup or a plain search for short questions, and everything else to AI with a search as context.
 */
export function planAnswer(question: string, now = new Date()): RulePlan {
  const t = correctTypos(normalize(question));
  if (!t || /^(hjälp|help|vad kan du( göra| hjälpa (mig )?med)?|vad gör du|hur fungerar du)$/.test(t)) return { kind: "help" };
  if (/^(hej|hejsan|hallå|tjena|tja|god morgon|god kväll|hej hej|hello|hi)( hintek( ai)?)?$/.test(t)) return { kind: "greeting" };
  if (/^(tack|tackar|tack så mycket|tack för hjälpen|toppen|bra|perfekt|ok|okej)( tack)?$/.test(t)) return { kind: "thanks" };
  // Outside Workflow (2026-10-01: "vad blir det för väder i Holsbybrunn idag?" cost 5 credits): answered
  // directly for free. Only when nothing in the question is about work, places of work or electrical installations.
  if (OUTSIDE_WORKFLOW.test(t) && !WORK_DOMAIN.test(t)) return { kind: "outside" };
  if (ACTION_WORDS.test(t)) {
    const what = /\barbetsorder\b/.test(t) ? "work_order" : /\bprojekt/.test(t) ? "project" : /\bkund/.test(t) ? "customer" : /\b(planering|aktivitet|möte|boka|planera)/.test(t) ? "planning"
      : /\b(tid|timmar|tidrapport)\b/.test(t) ? "time" : /\b(formulär|kontrolltyp|uppgiftstyp)/.test(t) ? "form" : /\b(uppgift|kontroll|riskbedömning|protokoll)/.test(t) ? "task" : "other";
    return { kind: "action", what };
  }
  if (AI_WORDS.test(t)) return { kind: "ai", reason: "interpretation", searchQuery: searchTerms(t) || null };

  const quoted = /["”“](.{2,80})["”“]/.exec(question)?.[1];
  const explicitSearch = /^(sök|sök efter|hitta|leta efter|leta|var finns|visa|öppna)\s+(.{2,})$/.exec(t);
  if (quoted || explicitSearch) {
    const query = (quoted ?? explicitSearch![2]).trim();
    if (/^kund(en|er)?\s+/.test(query)) return { kind: "lookup", query: query.replace(/^kund(en|er)?\s+/, "").slice(0, 100), prefer: "customer", heading: "Kunder" };
    if (/^projekt(et)?\s+/.test(query)) return { kind: "lookup", query: query.replace(/^projekt(et)?\s+/, "").slice(0, 100), prefer: "project", heading: "Projekt" };
    if (/^(mina |alla )?(uppgifter|arbetsordrar|arbetsorder|projekt|kunder|påminnelser|notiser)$/.test(query)) return planAnswer(query, now);
    // "Visa X" wants the thing itself; "sök X" wants the list.
    if (explicitSearch && /^(visa|öppna)$/.test(explicitSearch[1])) return { kind: "lookup", query: query.slice(0, 100), prefer: "any", heading: `Sökresultat för ”${query.slice(0, 100)}”` };
    return { kind: "tool", tool: "search", input: { query: query.slice(0, 100) }, heading: `Sökresultat för ”${query.slice(0, 100)}”` };
  }
  if (/\b(försen|förfall|notis|påminn|missad|följa upp|följ upp|driftrond|ronder|rond)/.test(t))
    return { kind: "tool", tool: "list_notifications", input: {}, heading: "Aktuella påminnelser" };
  // "Hur mycket tid har vi lagt på projektet" is about the whole project, not the person's own week (2026-10-02): the model reads the project.
  if (/\bhur mycket tid\b/.test(t) && /\b(vi|vår|vårt|våra|projektet|kunden|teamet|alla)\b/.test(t)) return { kind: "ai", reason: "open-question", searchQuery: searchTerms(t) || null };
  if (/\b(min|mina|rapporterad|rapporterat|jobbat|arbetat)\b.*\b(tid|timmar|tidrapport)\b|\bhur mycket tid\b|\btidrapport(en)?\b|\bhur många timmar\b/.test(t)) {
    const period = periodOf(t, now);
    return { kind: "tool", tool: "list_time_entries", input: { from: period.from, to: period.to }, heading: `Din rapporterade tid ${period.label}` };
  }
  if (/\b(planer|planering|planerat|kalender|bokat|bokning|vad händer|schema)/.test(t) && !/\bprojekt\b.*\b(status|läget)\b/.test(t)) {
    const period = periodOf(t, now);
    return { kind: "tool", tool: "list_planned_activities", input: { from: period.from, to: period.to }, heading: `Planering ${period.label}` };
  }
  const counting = /\bhur många\b|\bantal\b/.test(t);
  const workNoun = /\b(uppgifter|uppgift|arbetsordrar|arbetsorder|jobb|kontroller|kontroll|protokoll|riskbedömningar|riskbedömning)\b/;
  if (/\b(mina|min)\s+(\S+\s+)?(uppgifter|arbetsordrar|arbetsorder|jobb|kontroller|protokoll|riskbedömningar)\b|\bvad (ska|behöver|bör) jag göra\b|\batt göra\b|\bmitt arbete\b/.test(t)
    || ((counting || /\bhar jag (några|någon|något)\b/.test(t)) && workNoun.test(t) && !/\bprojekt/.test(t))) {
    const filter = /\b(slutförda|klara|färdiga|avslutade)\b/.test(t) ? "done" : /\bpågående\b/.test(t) ? "active" : /\bplanerade\b/.test(t) ? "planned" : /\b(åtgärd|behöver åtgärdas)\b/.test(t) ? "action" : counting && /\b(alla|totalt|sammanlagt)\b/.test(t) ? "all" : "open";
    const query = kindWord(t);
    const noun = query === "arbetsorder" ? "arbetsordrar" : query === "riskbedömning" ? "riskbedömningar" : query === "kontroll" ? "kontroller och protokoll" : "uppgifter";
    const heading = counting ? `Antal ${noun}` : filter === "done" ? `Dina slutförda ${noun}` : filter === "action" ? `${noun[0].toUpperCase()}${noun.slice(1)} som behöver åtgärdas` : `Dina ${noun}`;
    return { kind: "tool", tool: "list_my_work", input: { filter, ...(query ? { query } : {}) }, heading: counting ? `${heading}|${filter}` : heading };
  }
  // One thing by name: "status på Strömgatan", "vem är ansvarig för Centralen", "projektet Elvägen", "kund Elkraft".
  const named = /^(?:vad är |hur är |vad händer med |hur går det (?:med|för) |vad gäller för )?(?:status|läget|statusen)(?: på| för| i| med)?\s+(.{2,})$|^vem (?:är ansvarig|ansvarar|har hand om|är projektledare)(?: för| i| på)?\s+(.{2,})$|^(?:visa|öppna|ge mig|berätta om|info om|information om)\s+(.{2,})$/.exec(t);
  if (named) {
    const raw = (named[1] ?? named[2] ?? named[3]).trim();
    const prefer = /^projekt(et)?\s+/.test(raw) ? "project" : /^kund(en)?\s+/.test(raw) ? "customer" : /^(uppgift(en)?|arbetsorder[n]?|kontroll(en)?|protokoll(et)?)\s+/.test(raw) ? "task" : "any";
    const query = raw.replace(/^(projekt(et)?|kund(en)?|uppgift(en)?|arbetsorder[n]?|kontroll(en)?|protokoll(et)?)\s+/, "");
    return { kind: "lookup", query: query.slice(0, 100), prefer, heading: `Om ”${query.slice(0, 100)}”` };
  }
  const project = /^(projekt(et)?|projekten)\s+(.{2,})$/.exec(t);
  if (project) return { kind: "lookup", query: project[3].slice(0, 100), prefer: "project", heading: `Projekt som matchar ”${project[3].slice(0, 100)}”` };
  if (/\b(pågående|alla|mina|vilka|avslutade|stängda|arkiverade)?\s*projekt(en)?\b/.test(t) && t.split(" ").length <= 5) {
    const state = /\b(avslutade|stängda)\b/.test(t) ? "closed" : /\barkiverade\b/.test(t) ? "archived" : "ongoing";
    return { kind: "tool", tool: "list_projects", input: { state }, heading: counting ? "Antal projekt" : state === "ongoing" ? "Pågående projekt" : state === "closed" ? "Avslutade projekt" : "Arkiverade projekt" };
  }
  const customer = /^(kund(en)?|kunder(na)?)\s+(.{2,})$/.exec(t);
  if (customer) return { kind: "lookup", query: customer[4].slice(0, 100), prefer: "customer", heading: `Kunder som matchar ”${customer[4].slice(0, 100)}”` };
  if (/^(kunder(na)?|kundregistret|mina kunder|alla kunder|vilka kunder har vi|hur många kunder( har vi)?)$/.test(t)) return { kind: "tool", tool: "list_customers", input: { limit: 25 }, heading: counting ? "Antal kunder" : "Kunder" };
  // A short question without a question word is a lookup: one clear match gives details, otherwise the search results.
  const words = t.split(" ");
  if (words.length <= 4 && !/\b(vad|hur|varför|när|kan|ska|borde)\b/.test(t)) {
    const query = searchTerms(t) || t;
    return { kind: "lookup", query: query.slice(0, 100), prefer: "any", heading: `Sökresultat för ”${query.slice(0, 100)}”` };
  }
  return { kind: "ai", reason: "open-question", searchQuery: searchTerms(t) || null };
}

/**
 * The nearest direct answer to a question that needs AI, for when the AI model cannot be used (off, or no credits):
 * what the question is about – projects, delays, time, planning, tasks or customers – answered from Workflow
 * (2026-10-01: "Sammanfatta läget i mina projekt" answered "jag hittade inget").
 */
export function nearestRulePlan(question: string, now = new Date()): Exclude<RulePlan, { kind: "ai" }> | null {
  const t = correctTypos(normalize(question));
  if (/\b(försen|förfall|påminn)/.test(t)) return { kind: "tool", tool: "list_notifications", input: {}, heading: "Aktuella påminnelser" };
  if (/\bprojekt/.test(t)) return { kind: "tool", tool: "list_projects", input: { state: "ongoing" }, heading: "Pågående projekt" };
  if (/\b(tid|timmar|tidrapport)\b/.test(t)) { const period = periodOf(t, now); return { kind: "tool", tool: "list_time_entries", input: { from: period.from, to: period.to }, heading: `Din rapporterade tid ${period.label}` }; }
  if (/\b(planering|kalender|schema|bokning)/.test(t)) { const period = periodOf(t, now); return { kind: "tool", tool: "list_planned_activities", input: { from: period.from, to: period.to }, heading: `Planering ${period.label}` }; }
  if (/\b(uppgift|arbetsorder|arbetsordrar|kontroll|protokoll|riskbedömning|jobb|prioriter)/.test(t)) { const query = kindWord(t); return { kind: "tool", tool: "list_my_work", input: { filter: "open", ...(query ? { query } : {}) }, heading: "Dina öppna uppgifter" }; }
  if (/\bkund/.test(t)) return { kind: "tool", tool: "list_customers", input: { limit: 25 }, heading: "Kunder" };
  return null;
}

export const HELP_ANSWER = [
  "Jag är Workflow AI. Det här svarar jag på direkt ur Workflow, utan krediter och med dina egna behörigheter:",
  "• ”Mina uppgifter”, ”mina arbetsordrar” eller ”vad ska jag göra?”",
  "• ”Vad är försenat?”, ”påminnelser” eller ”ronder i dag”",
  "• ”Min tid den här veckan” – eller i dag, i går, på fredag, vecka 41, förra månaden",
  "• ”Planering i morgon”, ”planering nästa vecka” eller ”vad händer på torsdag”",
  "• ”Pågående projekt”, ”projekt Strömgatan” eller ”status på Strömgatan”",
  "• ”Kund Elvägen”, ”vem är ansvarig för Centralen” eller ”sök Transformator T2”",
  "Frågor som kräver tolkning, sammanfattning eller analys besvaras av AI-modellen när företaget har aktiverat Workflow AI.",
].join("\n");

/**
 * A question about the page the person is on (2026-10-01: "Hur fyller jag i den här kontrollen?"): how to fill it in,
 * what is missing or left, the next step. Answered from the page's own rules when the page is known.
 */
export function isPageQuestion(question: string) {
  const t = correctTypos(normalize(question));
  return /(den här|denna|detta|det här|här på sidan|på sidan|sidan)/.test(t) && /(fyll|gör|göra|saknas|kvar|återstår|nästa|klar|slutför|färdigställ|steg|hjälp|hur)/.test(t)
    || /^(hur fyller jag i|vad saknas|vad är kvar|vad återstår|vad ska jag göra nu|vad gör jag nu|nästa steg|hur går jag vidare|hur blir jag klar|varför kan jag inte (slutföra|färdigställa))/.test(t);
}

export const OUTSIDE_ANSWER = "Jag svarar bara på frågor om arbetet i Workflow – uppgifter, projekt, kunder, tid och planering – och, när AI-modellen är på, på frågor om el och kontroller. Väder och andra allmänna ämnen ingår inte. Frågan kostade inga krediter.";
export const GREETING_ANSWER = "Hej! Fråga om ditt arbete i Workflow – till exempel ”mina uppgifter”, ”vad är försenat?” eller ”status på <projekt>”. Skriv ”hjälp” för fler exempel.";
export const THANKS_ANSWER = "Varsågod! Säg till om du vill veta mer.";

/** Where a person does what the assistant was asked to do – the assistant never changes data on its own. */
export function actionAnswer(what: Extract<RulePlan, { kind: "action" }>["what"]): { answer: string; citations: RuleCitation[] } {
  const view = (resourceId: string, title: string, href: string, description: string): RuleCitation => ({ resourceType: "VIEW", resourceId, title, description, href, citationLabel: title });
  const places: Record<typeof what, { text: string; links: RuleCitation[] }> = {
    work_order: { text: "Jag skapar och ändrar inget själv – det gör du i Workflow så att allt sparas med din signatur och historik. Ny arbetsorder öppnar du här:", links: [view("new-work-order", "Ny arbetsorder", "/?view=workflow_task&taskType=WORK_ORDER", "Skapa en arbetsorder")] },
    project: { text: "Jag skapar och ändrar inget själv. Projekt skapar och ändrar du under Nytt projekt och Mina projekt:", links: [view("new-project", "Nytt projekt", "/?view=new_project", ""), view("projects", "Mina projekt", "/?view=projects", "")] },
    customer: { text: "Jag skapar och ändrar inget själv. Kunder och anläggningar hanterar du i kundregistret:", links: [view("customers", "Kundregister", "/?view=customers", "")] },
    planning: { text: "Jag bokar inget själv. Planering gör du i kalendern, där du också ser krockar:", links: [view("planning", "Planering", "/?view=planning", "")] },
    time: { text: "Jag registrerar ingen tid själv. Starta tid i uppgiftens sidhuvud eller registrera i tidrapporten:", links: [view("time", "Tidrapport", "/?view=time", "")] },
    task: { text: "Jag skapar och ändrar inget själv. Nya uppgifter börjar under Ny uppgift; befintliga hittar du under Mina uppgifter:", links: [view("new-task", "Ny uppgift", "/?view=new_task", ""), view("tasks", "Mina uppgifter", "/?view=tasks", "")] },
    form: { text: "Formulär och kontrolltyper byggs under Skapa formulär (företagsadmin):", links: [view("forms", "Skapa formulär", "/?view=forms", "")] },
    other: { text: "Jag skapar och ändrar inget själv – det gör du i Workflow. Säg vad det gäller (arbetsorder, projekt, kund, planering eller tid) så visar jag var.", links: [] },
  };
  const place = places[what];
  return { answer: [place.text, ...place.links.map((link) => `• ${link.title}`)].join("\n"), citations: place.links };
}

export type RuleCitation = { resourceType: string; resourceId: string; title: string; description: string; href: string; citationLabel: string };
type Row = Record<string, unknown>;

const KIND_LABEL: Record<string, string> = { WORK_ORDER: "Arbetsorder", RISK_ASSESSMENT: "Riskbedömning", FORM: "Protokoll", COMMISSIONING_CONTROL: "Kontroll", ROUND: "Rond", FOLLOW_UP: "Följ upp" };
const STATUS_LABEL: Record<string, string> = { PLANNED: "planerad", IN_PROGRESS: "pågår", PAUSED: "pausad", NEEDS_ACTION: "behöver åtgärdas", COMPLETED: "slutförd", DRAFT: "utkast", CANCELED: "inställd" };
// Mina uppgifter lists a control without a kind (it has a completion instead), so a missing kind is a control.
const taskHref = (row: Row) => row.kind === "COMMISSIONING_CONTROL" || (row.kind === undefined && "completion" in row) ? `/?view=new&id=${encodeURIComponent(String(row.id))}` : `/?view=workflow_task&taskId=${encodeURIComponent(String(row.id))}&taskType=${String(row.kind)}`;
const projectHref = (id: unknown) => `/?view=project&projectId=${encodeURIComponent(String(id))}`;
const customerHref = (id: unknown) => `/?view=customers&customerId=${encodeURIComponent(String(id))}`;
const hours = (seconds: number) => { const minutes = Math.round(seconds / 60); return `${Math.floor(minutes / 60)} h ${minutes % 60} min`; };
const time = (value: unknown) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(String(value)));
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const cite = (resourceType: string, row: Row, title: string, href: string, description = ""): RuleCitation => ({ resourceType, resourceId: String(row.id), title, description, href, citationLabel: title.slice(0, 60) });

/** Turns a tool's answer into a short Swedish reply with links; at most ten rows, the rest counted. */
export function formatRuleAnswer(tool: ToolName, heading: string, result: Row): { answer: string; citations: RuleCitation[] } {
  const lines: string[] = [];
  const citations: RuleCitation[] = [];
  const list = (rows: Row[], line: (row: Row) => string, link: (row: Row) => RuleCitation | null, empty: string) => {
    if (!rows.length) { lines.push(empty); return; }
    for (const row of rows.slice(0, 10)) { lines.push(`• ${line(row)}`); const item = link(row); if (item) citations.push(item); }
    if (rows.length > 10) lines.push(`… och ${rows.length - 10} till.`);
  };
  const counting = /^Antal /.test(heading);
  // A count carries its filter after a bar ("Antal arbetsordrar|open"), so the number can say what it counts.
  const [title, countFilter = "open"] = heading.split("|");
  heading = title;
  lines.push(`${heading}:`);
  if (tool === "list_my_work") {
    const items = (result.items as Row[]) ?? [];
    const total = Number(result.total ?? items.length);
    const counts = result.counts as Record<string, unknown> | undefined;
    if (counting) {
      // The number first, then how it splits (2026-10-01: "Hur många arbetsordrar har jag?").
      const filterLabel: Record<string, string> = { open: "ej slutförda", active: "pågående", planned: "planerade", action: "som behöver åtgärdas", done: "slutförda", all: "totalt" };
      lines[0] = `${heading}: ${total} ${filterLabel[countFilter] ?? ""}`.trim();
      if (counts) lines.push(`• Pågående: ${Number(counts.active ?? 0)} · Planerade: ${Number(counts.planned ?? 0)} · Behöver åtgärdas: ${Number(counts.action ?? 0)} · Slutförda: ${Number(counts.done ?? 0)}`);
      if (items.length) lines.push("De senast ändrade:");
    }
    // A count shows a few examples and the total, never "… och N till" on top of it.
    if (counting) {
      for (const row of items.slice(0, 5)) { lines.push(`• ${row.title} – ${KIND_LABEL[String(row.kind ?? ("completion" in row ? "COMMISSIONING_CONTROL" : ""))] ?? "Uppgift"}, ${STATUS_LABEL[String(row.status)] ?? String(row.status).toLowerCase()}`); citations.push(cite("TASK", row, String(row.title), taskHref(row))); }
      if (total > 5) lines.push(`Alla ${total} finns under Mina uppgifter.`);
      return { answer: lines.join("\n"), citations: citations.slice(0, 12) };
    }
    list(items, (row) => `${row.title} – ${KIND_LABEL[String(row.kind ?? ("completion" in row ? "COMMISSIONING_CONTROL" : ""))] ?? "Uppgift"}, ${STATUS_LABEL[String(row.status)] ?? String(row.status).toLowerCase()}${row.projectName ? ` (${row.projectName})` : ""}`,
      (row) => cite("TASK", row, String(row.title), taskHref(row)), "Du har inga uppgifter här just nu.");
    if (total > items.length) lines.push(`Totalt ${total} – se Mina uppgifter.`);
  } else if (tool === "list_notifications") {
    list((result.items as Row[]) ?? [], (row) => `${row.title} – ${KIND_LABEL[String(row.kind)] ?? ""}${row.deadline === "OVERDUE" ? ", förfallen" : row.deadline === "DUE_SOON" ? `, klart senast ${row.dueDate}` : row.needsAction ? ", behöver åtgärdas" : ""}${row.detail ? ` · ${row.detail}` : ""}`,
      (row) => cite("NOTIFICATION", row, String(row.title), String(row.href)), "Inga aktuella påminnelser om förfallna eller snart förfallande uppgifter. Projektens egen status kan du se under Projekt.");
  } else if (tool === "list_time_entries") {
    const entries = (result.entries as Row[]) ?? [];
    lines[0] = `${heading}: ${hours(Number(result.totalDurationSec ?? 0))}`;
    const byTask = new Map<string, { title: string; seconds: number; id: string }>();
    for (const entry of entries) { const key = String(entry.taskId); const current = byTask.get(key) ?? { title: String(entry.taskTitle), seconds: 0, id: key }; current.seconds += Number(entry.durationSec ?? 0); byTask.set(key, current); }
    list([...byTask.values()].sort((a, b) => b.seconds - a.seconds) as unknown as Row[], (row) => `${row.title}: ${hours(Number(row.seconds))}`, () => null, "Ingen tid rapporterad under perioden.");
    citations.push({ resourceType: "VIEW", resourceId: "time", title: "Tidrapport", description: "", href: "/?view=time", citationLabel: "Öppna tidrapporten" });
  } else if (tool === "list_planned_activities") {
    list(((result.activities as Row[]) ?? []).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))), (row) => `${time(row.startsAt)}–${new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" }).format(new Date(String(row.endsAt)))} ${row.title}${row.assignedToName ? ` (${row.assignedToName})` : ""}`,
      () => null, "Inget planerat under perioden.");
    citations.push({ resourceType: "VIEW", resourceId: "planning", title: "Planering", description: "", href: "/?view=planning", citationLabel: "Öppna planeringen" });
  } else if (tool === "list_projects") {
    const projects = (result.projects as Row[]) ?? [];
    if (counting) lines[0] = `${heading}: ${Number(result.total ?? projects.length)}`;
    list(projects, (row) => `${row.name}${row.dueDate ? ` – klart ${row.dueDate}` : ""}${row.responsibleName ? ` · ${row.responsibleName}` : ""}`,
      (row) => cite("PROJECT", row, String(row.name), projectHref(row.id)), "Inga projekt matchar.");
    if (Number(result.total) > projects.length) lines.push(`Totalt ${result.total} – se Mina projekt.`);
  } else if (tool === "list_customers") {
    const customers = (result.customers as Row[]) ?? [];
    if (counting) lines[0] = `${heading}: ${customers.length}${customers.length >= 25 ? " eller fler" : ""}`;
    list(customers, (row) => `${row.name}${row.company ? `, ${row.company}` : ""}${row.city ? ` – ${row.city}` : ""}${row.phone ? ` · ${row.phone}` : ""}`,
      (row) => cite("CUSTOMER", row, String(row.name), customerHref(row.id)), "Inga kunder matchar.");
  } else if (tool === "get_project") {
    const tasks = (result.tasks as Row[]) ?? [];
    const status = result.status as Row | string | null | undefined;
    const statusLabel = status && typeof status === "object" ? text(status.label) : text(status);
    const open = tasks.filter((task) => task.status !== "COMPLETED");
    const customer = result.customer as Row | null | undefined;
    lines[0] = `Projektet ${result.name}:`;
    const facts = [statusLabel && `Status: ${statusLabel}`, result.startDate || result.dueDate ? `Tidsram: ${result.startDate ?? "?"} – ${result.dueDate ?? "?"}` : "", customer?.name && `Kund: ${customer.name}${customer.company ? `, ${customer.company}` : ""}`,
      result.responsibleName && `Ansvarig: ${result.responsibleName}`, result.workSite && `Arbetsplats: ${result.workSite}`, result.reference && `Referens: ${result.reference}`].filter(Boolean) as string[];
    lines.push(...facts.map((fact) => `• ${fact}`));
    lines.push(`Uppgifter: ${tasks.length}, varav ${open.length} öppna${tasks.length ? ":" : "."}`);
    for (const task of open.slice(0, 8)) lines.push(`• ${task.title} – ${KIND_LABEL[String(task.kind)] ?? "Uppgift"}, ${STATUS_LABEL[String(task.status)] ?? String(task.status).toLowerCase()}${task.dueDate ? `, klart ${task.dueDate}` : ""}${task.assignedToName ? ` (${task.assignedToName})` : ""}`);
    if (open.length > 8) lines.push(`… och ${open.length - 8} öppna till.`);
    citations.push(cite("PROJECT", result, String(result.name), projectHref(result.id)));
    for (const task of open.slice(0, 5)) citations.push(cite("TASK", task, String(task.title), taskHref(task)));
  } else if (tool === "get_customer") {
    const customer = (result.customer as Row) ?? {};
    const facilities = (result.facilities as Row[]) ?? [];
    const projects = (result.projects as Row[]) ?? [];
    const counts = (result.counts as Row) ?? {};
    lines[0] = `Kunden ${customer.name}${customer.company ? ` (${customer.company})` : ""}:`;
    const contact = [customer.email, customer.phone || customer.mobile, [customer.address, customer.postalCode, customer.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    if (contact) lines.push(`• Kontakt: ${contact}`);
    if (facilities.length) lines.push(`• Anläggningar: ${facilities.slice(0, 6).map((facility) => facility.name).join(", ")}${facilities.length > 6 ? ` … (${facilities.length})` : ""}`);
    const workCount = Object.values(counts).reduce<number>((sum, value) => sum + Number(value ?? 0), 0);
    lines.push(`• Projekt: ${projects.length} · Uppgifter: ${workCount}`);
    for (const project of projects.slice(0, 5)) { const status = project.status as Row | undefined; lines.push(`• ${project.name}${status?.label ? ` – ${status.label}` : ""}${project.dueDate ? `, klart ${project.dueDate}` : ""}`); citations.push(cite("PROJECT", project, String(project.name), projectHref(project.id))); }
    citations.unshift(cite("CUSTOMER", customer, String(customer.name), customerHref(customer.id)));
  } else if (tool === "get_task") {
    const project = result.project as Row | null | undefined;
    const customer = result.customer as Row | null | undefined;
    lines[0] = `${KIND_LABEL[String(result.kind)] ?? "Uppgiften"} ${result.title}:`;
    const facts = [`Status: ${STATUS_LABEL[String(result.status)] ?? String(result.status).toLowerCase()}${typeof result.progress === "number" ? ` · ${result.progress} % klart` : ""}`, result.dueDate && `Klart senast: ${result.dueDate}`,
      result.assignedToName && `Ansvarig: ${result.assignedToName}`, project?.name && `Projekt: ${project.name}`, customer?.name && `Kund: ${customer.name}`,
      Number(result.totalDurationSec) > 0 && `Rapporterad tid: ${hours(Number(result.totalDurationSec))}`, Array.isArray(result.attachments) && result.attachments.length ? `Bilagor: ${result.attachments.length}` : ""].filter(Boolean) as string[];
    lines.push(...facts.map((fact) => `• ${fact}`));
    const description = text(result.description);
    if (description) lines.push(`Beskrivning: ${description.slice(0, 300)}${description.length > 300 ? "…" : ""}`);
    citations.push(cite("TASK", result, String(result.title), taskHref(result)));
    if (project?.id) citations.push(cite("PROJECT", project, String(project.name), projectHref(project.id)));
  } else if (tool === "search") {
    const groups: [string, Row[], (row: Row) => string, (row: Row) => RuleCitation][] = [
      ["Projekt", (result.projects as Row[]) ?? [], (row) => String(row.name), (row) => cite("PROJECT", row, String(row.name), projectHref(row.id))],
      ["Uppgifter", (result.tasks as Row[]) ?? [], (row) => `${row.title} – ${KIND_LABEL[String(row.kind)] ?? "Uppgift"}, ${STATUS_LABEL[String(row.status)] ?? ""}`, (row) => cite("TASK", row, String(row.title), taskHref(row))],
      ["Kontroller", (result.controls as Row[]) ?? [], (row) => `${row.title}${row.date ? ` (${row.date})` : ""}`, (row) => cite("CONTROL", row, String(row.title), `/?view=new&id=${encodeURIComponent(String(row.id))}`)],
      ["Kunder", (result.customers as Row[]) ?? [], (row) => `${row.name}${row.company ? `, ${row.company}` : ""}`, (row) => cite("CUSTOMER", row, String(row.name), customerHref(row.id))],
      ["Filer", (result.files as Row[]) ?? [], (row) => `${row.filename} (${row.ownerTitle})`, (row) => cite("DOCUMENT", row, String(row.filename), String(row.href))],
    ];
    const total = groups.reduce((sum, [, rows]) => sum + rows.length, 0);
    if (!total) lines.push("Inget hittades som du har behörighet att se.");
    for (const [label, rows, line, link] of groups) if (rows.length) { lines.push(`${label}:`); for (const row of rows.slice(0, 5)) { lines.push(`• ${line(row)}`); citations.push({ ...link(row), description: `${label}: ${line(row)}` }); } }
  }
  return { answer: lines.join("\n"), citations: citations.slice(0, 12) };
}

/**
 * The one clear match of a search, if any: a hit whose name contains the whole query, when no other kind has such a
 * hit. The engine then answers with that thing's details instead of a list.
 */
export function singleMatch(query: string, result: Row, prefer: "project" | "customer" | "task" | "any"): { kind: "project" | "customer" | "task"; id: string } | null {
  const q = normalize(query);
  const contains = (value: unknown) => normalize(String(value ?? "")).includes(q);
  const projects = ((result.projects as Row[]) ?? []).filter((row) => contains(row.name));
  const customers = ((result.customers as Row[]) ?? []).filter((row) => contains(row.name) || contains(row.company));
  // Controls of the older editor have no detail tool, so a control hit keeps the list.
  const tasks = ((result.tasks as Row[]) ?? []).filter((row) => contains(row.title));
  const controls = ((result.controls as Row[]) ?? []).filter((row) => contains(row.title));
  const pick = (rows: Row[], kind: "project" | "customer" | "task") => (rows.length === 1 ? { kind, id: String(rows[0].id) } : null);
  if (prefer === "project") return pick(projects, "project");
  if (prefer === "customer") return pick(customers, "customer");
  if (prefer === "task") return controls.length ? null : pick(tasks, "task");
  const kinds = [projects.length && "project", customers.length && "customer", (tasks.length || controls.length) && "task"].filter(Boolean);
  if (controls.length) return null;
  if (kinds.length !== 1) return null;
  return pick(projects, "project") ?? pick(customers, "customer") ?? pick(tasks, "task");
}
