// HINTEK AI answers rule-first (Daniel 2026-09-30): ordinary questions about the person's own work are answered with
// the same tools as the API and MCP (search, lists, lookups) – no AI model, no credits. Only questions that need
// interpretation, summarising or analysis go to the AI model. Pure functions: no database, no tools, no provider.

import { addSwedishDays, swedishDayKey, swedishMonday, startOfSwedishMonth } from "@/lib/swedish-time";
import type { ToolName } from "@/lib/tools/catalog";

export type RulePlan =
  | { kind: "help" }
  | { kind: "tool"; tool: ToolName; input: Record<string, unknown>; heading: string }
  | { kind: "ai"; reason: "interpretation" | "open-question"; searchQuery: string | null };

const normalize = (text: string) => text.toLowerCase().normalize("NFC").replace(/[?!.]+$/g, "").replace(/\s+/g, " ").trim();

/** Words that ask for interpretation, summarising or analysis – those go to the AI model. */
// Stems without a closing \b: JavaScript's \b treats å, ä and ö as non-word characters ("föreslå" would never match).
const AI_WORDS = /\b(sammanfatta|sammanställ|analysera|analys|jämför|förklara|varför|hur kommer det sig|föreslå|förslag|skriv|formulera|bedöm|tolka|resonera|vad tycker du|rekommendera)/;
const STOP_WORDS = new Set(["jag", "du", "vi", "min", "mitt", "mina", "en", "ett", "den", "det", "de", "om", "för", "på", "i", "till", "med", "och", "eller", "som", "vad", "hur", "var", "när", "vilka", "vilken", "vilket", "är", "har", "kan", "ska", "finns", "alla", "någon", "något", "visa", "sök", "hitta", "leta", "efter", "lista"]);

/** The period a question names (Swedish days), for time and planning. */
export function periodOf(text: string, now = new Date()): { from: string; to: string; label: string } {
  const t = normalize(text);
  const today = swedishDayKey(now);
  if (/\b(i ?morgon|imorgon)\b/.test(t)) { const day = swedishDayKey(addSwedishDays(now, 1)); return { from: day, to: day, label: "i morgon" }; }
  if (/\bi ?går\b/.test(t)) { const day = swedishDayKey(addSwedishDays(now, -1)); return { from: day, to: day, label: "i går" }; }
  if (/\b(i ?dag|idag)\b/.test(t)) return { from: today, to: today, label: "i dag" };
  if (/\bförra veckan\b/.test(t)) { const monday = addSwedishDays(swedishMonday(now), -7); return { from: swedishDayKey(monday), to: swedishDayKey(addSwedishDays(monday, 6)), label: "förra veckan" }; }
  if (/\bnästa vecka\b/.test(t)) { const monday = addSwedishDays(swedishMonday(now), 7); return { from: swedishDayKey(monday), to: swedishDayKey(addSwedishDays(monday, 6)), label: "nästa vecka" }; }
  if (/\b(förra månaden|förra månad)\b/.test(t)) { const start = startOfSwedishMonth(now, -1); return { from: swedishDayKey(start), to: swedishDayKey(addSwedishDays(startOfSwedishMonth(now), -1)), label: "förra månaden" }; }
  if (/\b(denna månad|den här månaden|i månaden|månaden)\b/.test(t)) return { from: swedishDayKey(startOfSwedishMonth(now)), to: swedishDayKey(addSwedishDays(startOfSwedishMonth(now, 1), -1)), label: "den här månaden" };
  const monday = swedishMonday(now);
  return { from: swedishDayKey(monday), to: swedishDayKey(addSwedishDays(monday, 6)), label: "den här veckan" };
}

/** The words worth searching for in a free question. */
export function searchTerms(text: string) {
  const words = normalize(text).replace(/["'”“]/g, "").split(" ").filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  return words.join(" ").slice(0, 100).trim();
}

/**
 * Decides how a question is answered. The order matters: explicit requests for interpretation go to AI first, then the
 * rule answers, then a plain search for short questions, and everything else to AI with a search as context.
 */
export function planAnswer(question: string, now = new Date()): RulePlan {
  const t = normalize(question);
  if (!t || /^(hjälp|help|vad kan du( göra)?|hej|hallå|tjena)$/.test(t)) return { kind: "help" };
  if (AI_WORDS.test(t)) return { kind: "ai", reason: "interpretation", searchQuery: searchTerms(t) || null };

  const quoted = /["”“](.{2,80})["”“]/.exec(question)?.[1];
  const explicitSearch = /^(sök|sök efter|hitta|leta efter|leta|var finns|visa)\s+(.{2,})$/.exec(t);
  if (quoted || explicitSearch) {
    const query = (quoted ?? explicitSearch![2]).trim();
    if (/^kund(en|er)?\s+/.test(query)) return { kind: "tool", tool: "list_customers", input: { query: query.replace(/^kund(en|er)?\s+/, ""), limit: 10 }, heading: "Kunder" };
    return { kind: "tool", tool: "search", input: { query: query.slice(0, 100) }, heading: `Sökresultat för ”${query.slice(0, 100)}”` };
  }
  if (/\b(försen|förfall|notis|påminn|missad|följa upp|följ upp)/.test(t))
    return { kind: "tool", tool: "list_notifications", input: {}, heading: "Aktuella påminnelser" };
  if (/\b(min|mina|rapporterad|rapporterat|jobbat|arbetat)\b.*\b(tid|timmar|tidrapport)\b|\bhur mycket tid\b|\btidrapport(en)?\b/.test(t)) {
    const period = periodOf(t, now);
    return { kind: "tool", tool: "list_time_entries", input: { from: period.from, to: period.to }, heading: `Din rapporterade tid ${period.label}` };
  }
  if (/\b(planer|planering|planerat|kalender|bokat|bokning|vad händer)/.test(t)) {
    const period = periodOf(t, now);
    return { kind: "tool", tool: "list_planned_activities", input: { from: period.from, to: period.to }, heading: `Planering ${period.label}` };
  }
  if (/\b(mina|min)\s+(\S+\s+)?(uppgifter|arbetsordrar|arbetsorder|jobb|kontroller|protokoll)\b|\bvad (ska|behöver|bör) jag göra\b|\batt göra\b|\bmitt arbete\b/.test(t)) {
    const filter = /\b(slutförda|klara|färdiga)\b/.test(t) ? "done" : /\bpågående\b/.test(t) ? "active" : /\bplanerade\b/.test(t) ? "planned" : "open";
    return { kind: "tool", tool: "list_my_work", input: { filter }, heading: filter === "done" ? "Dina slutförda uppgifter" : "Dina uppgifter" };
  }
  const project = /^(projekt(et)?|projekten)\s+(.{2,})$/.exec(t);
  if (project) return { kind: "tool", tool: "list_projects", input: { state: "ongoing", query: project[3] }, heading: `Projekt som matchar ”${project[3]}”` };
  if (/\b(pågående|alla|mina|vilka)?\s*projekt(en)?\b/.test(t) && t.split(" ").length <= 4) {
    const state = /\b(avslutade|stängda)\b/.test(t) ? "closed" : /\barkiverade\b/.test(t) ? "archived" : "ongoing";
    return { kind: "tool", tool: "list_projects", input: { state }, heading: state === "ongoing" ? "Pågående projekt" : state === "closed" ? "Avslutade projekt" : "Arkiverade projekt" };
  }
  const customer = /^(kund(en)?|kunder(na)?)\s+(.{2,})$/.exec(t);
  if (customer) return { kind: "tool", tool: "list_customers", input: { query: customer[4], limit: 10 }, heading: `Kunder som matchar ”${customer[4]}”` };
  if (/^(kunder(na)?|kundregistret|mina kunder)$/.test(t)) return { kind: "tool", tool: "list_customers", input: { limit: 25 }, heading: "Kunder" };
  // A short question without a question word is a search.
  const words = t.split(" ");
  if (words.length <= 4 && !/\b(vad|hur|varför|när|kan|ska|borde)\b/.test(t)) {
    const query = searchTerms(t) || t;
    return { kind: "tool", tool: "search", input: { query: query.slice(0, 100) }, heading: `Sökresultat för ”${query.slice(0, 100)}”` };
  }
  return { kind: "ai", reason: "open-question", searchQuery: searchTerms(t) || null };
}

export const HELP_ANSWER = [
  "Jag är HINTEK AI. Utan AI-krediter kan jag direkt svara på det här – med dina egna behörigheter:",
  "• ”Mina uppgifter” eller ”vad ska jag göra?”",
  "• ”Vad är försenat?” eller ”påminnelser”",
  "• ”Min tid den här veckan” (eller i dag, förra veckan, den här månaden)",
  "• ”Planering i morgon” eller ”planering nästa vecka”",
  "• ”Pågående projekt” eller ”projekt Strömgatan”",
  "• ”Kund Elvägen” eller ”sök Centralen”",
  "Frågor som kräver tolkning, sammanfattning eller analys besvaras av AI-modellen när företaget har aktiverat HINTEK AI.",
].join("\n");

export type RuleCitation = { resourceType: string; resourceId: string; title: string; description: string; href: string; citationLabel: string };
type Row = Record<string, unknown>;

const KIND_LABEL: Record<string, string> = { WORK_ORDER: "Arbetsorder", RISK_ASSESSMENT: "Riskbedömning", FORM: "Protokoll", COMMISSIONING_CONTROL: "Kontroll", ROUND: "Rond", FOLLOW_UP: "Följ upp" };
const STATUS_LABEL: Record<string, string> = { PLANNED: "planerad", IN_PROGRESS: "pågår", PAUSED: "pausad", NEEDS_ACTION: "behöver åtgärdas", COMPLETED: "slutförd", DRAFT: "utkast", CANCELED: "inställd" };
const taskHref = (row: Row) => row.kind === "COMMISSIONING_CONTROL" ? `/?view=new&id=${encodeURIComponent(String(row.id))}` : `/?view=workflow_task&taskId=${encodeURIComponent(String(row.id))}&taskType=${String(row.kind)}`;
const hours = (seconds: number) => { const minutes = Math.round(seconds / 60); return `${Math.floor(minutes / 60)} h ${minutes % 60} min`; };
const time = (value: unknown) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(String(value)));
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
  lines.push(`${heading}:`);
  if (tool === "list_my_work") {
    const items = (result.items as Row[]) ?? [];
    list(items, (row) => `${row.title} – ${KIND_LABEL[String(row.kind)] ?? "Uppgift"}, ${STATUS_LABEL[String(row.status)] ?? String(row.status).toLowerCase()}${row.projectName ? ` (${row.projectName})` : ""}`,
      (row) => cite("TASK", row, String(row.title), taskHref(row)), "Du har inga uppgifter här just nu.");
    if (Number(result.total) > items.length) lines.push(`Totalt ${result.total} – se Mina uppgifter.`);
  } else if (tool === "list_notifications") {
    list((result.items as Row[]) ?? [], (row) => `${row.title} – ${KIND_LABEL[String(row.kind)] ?? ""}${row.deadline === "OVERDUE" ? ", förfallen" : row.deadline === "DUE_SOON" ? `, klart senast ${row.dueDate}` : row.needsAction ? ", behöver åtgärdas" : ""}`,
      (row) => cite("NOTIFICATION", row, String(row.title), String(row.href)), "Inga aktuella påminnelser. Inget är försenat.");
  } else if (tool === "list_time_entries") {
    const entries = (result.entries as Row[]) ?? [];
    lines[0] = `${heading}: ${hours(Number(result.totalDurationSec ?? 0))}`;
    const byTask = new Map<string, { title: string; seconds: number; id: string }>();
    for (const entry of entries) { const key = String(entry.taskId); const current = byTask.get(key) ?? { title: String(entry.taskTitle), seconds: 0, id: key }; current.seconds += Number(entry.durationSec ?? 0); byTask.set(key, current); }
    list([...byTask.values()].sort((a, b) => b.seconds - a.seconds) as unknown as Row[], (row) => `${row.title}: ${hours(Number(row.seconds))}`, () => null, "Ingen tid rapporterad under perioden.");
  } else if (tool === "list_planned_activities") {
    list(((result.activities as Row[]) ?? []).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))), (row) => `${time(row.startsAt)}–${new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" }).format(new Date(String(row.endsAt)))} ${row.title}${row.assignedToName ? ` (${row.assignedToName})` : ""}`,
      () => null, "Inget planerat under perioden.");
    citations.push({ resourceType: "VIEW", resourceId: "planning", title: "Planering", description: "", href: "/?view=planning", citationLabel: "Öppna planeringen" });
  } else if (tool === "list_projects") {
    list((result.projects as Row[]) ?? [], (row) => `${row.name}${row.dueDate ? ` – klart ${row.dueDate}` : ""}`,
      (row) => cite("PROJECT", row, String(row.name), `/?view=project&projectId=${encodeURIComponent(String(row.id))}`), "Inga projekt matchar.");
  } else if (tool === "list_customers") {
    list((result.customers as Row[]) ?? [], (row) => `${row.name}${row.company ? `, ${row.company}` : ""}${row.city ? ` – ${row.city}` : ""}${row.phone ? ` · ${row.phone}` : ""}`,
      (row) => cite("CUSTOMER", row, String(row.name), `/?view=customers&customerId=${encodeURIComponent(String(row.id))}`), "Inga kunder matchar.");
  } else if (tool === "search") {
    const groups: [string, Row[], (row: Row) => string, (row: Row) => RuleCitation][] = [
      ["Projekt", (result.projects as Row[]) ?? [], (row) => String(row.name), (row) => cite("PROJECT", row, String(row.name), `/?view=project&projectId=${encodeURIComponent(String(row.id))}`)],
      ["Uppgifter", (result.tasks as Row[]) ?? [], (row) => `${row.title} – ${KIND_LABEL[String(row.kind)] ?? "Uppgift"}, ${STATUS_LABEL[String(row.status)] ?? ""}`, (row) => cite("TASK", row, String(row.title), taskHref(row))],
      ["Kontroller", (result.controls as Row[]) ?? [], (row) => `${row.title}${row.date ? ` (${row.date})` : ""}`, (row) => cite("CONTROL", row, String(row.title), `/?view=new&id=${encodeURIComponent(String(row.id))}`)],
      ["Kunder", (result.customers as Row[]) ?? [], (row) => `${row.name}${row.company ? `, ${row.company}` : ""}`, (row) => cite("CUSTOMER", row, String(row.name), `/?view=customers&customerId=${encodeURIComponent(String(row.id))}`)],
      ["Filer", (result.files as Row[]) ?? [], (row) => `${row.filename} (${row.ownerTitle})`, (row) => cite("DOCUMENT", row, String(row.filename), String(row.href))],
    ];
    const total = groups.reduce((sum, [, rows]) => sum + rows.length, 0);
    if (!total) lines.push("Inget hittades som du har behörighet att se.");
    for (const [label, rows, line, link] of groups) if (rows.length) { lines.push(`${label}:`); for (const row of rows.slice(0, 5)) { lines.push(`• ${line(row)}`); citations.push({ ...link(row), description: `${label}: ${line(row)}` }); } }
  }
  return { answer: lines.join("\n"), citations: citations.slice(0, 12) };
}
