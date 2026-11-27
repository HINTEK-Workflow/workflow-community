// The rules for Workflow AI as the expert on Workflow (2026-11-21): "hur gör jag …" goes to the help search, and the common
// questions about invoicing, quotes, maintenance and machine alarms are answered by the read tools – no AI model, no credits.
// Pure, like lib/ai/assistant-rules.ts, which calls these two functions.

import type { ToolName } from "@/lib/tools/catalog";

type Row = Record<string, unknown>;
type Citation = { resourceType: string; resourceId: string; title: string; description: string; href: string; citationLabel: string };
type Plan = { kind: "tool"; tool: ToolName; input: Record<string, unknown>; heading: string };
type Period = (text: string, now?: Date) => { from: string; to: string; label: string };

/** "Hur gör jag …", "hur skapar man …", "var ställer jag in …": a question about how Workflow is used. */
// The question as the typo correction left it: "rapporterar" may read "rapporterad".
const HOW_TO = /^(hur (gör|skapar|lägger|ställer|startar|stoppar|pausar|bokar|planerar|rapporterar|rapporterad|skriver|registrerar|kopplar|ansluter|bjuder|byter|ändrar|tar bort|hittar|exporterar|importerar|skickar|delar|slår|fyller|signerar|färdigställer|godkänner|fastställer|öppnar|stänger|raderar|arkiverar|återställer|flyttar|kopierar|bygger|publicerar|laddar|installerar|uppdaterar|loggar|aktiverar) (jag|man|vi|ni|du)\b|var (hittar|ställer|ändrar|lägger|gör|skapar|bjuder|kopplar|startar|bokar|ser) (jag|man|vi|ni)\b|vart (hittar|går) (jag|man|vi)\b|hur fungerar (det med|tidplanen|kalendern|kapaciteten|riskbedömning|egenkontroll|driftronder|tavlor|fakturaunderlag|offerter|underhåll|import|krediter|veckokvoten))/;
/** Electrical knowledge, measuring and safety are for the model's marked general knowledge, never the help search. */
const ELECTRICAL = /(isolation|megg|mäting|följelin|jordfel|jfb|mätvärde|mäta|mäter|mätning|spänning|ström|impedans|kortslut|provspän|selektiv|dimensioner|kabelarea|säkringsstorlek|\bzs\b|ohm|volt|ampere|säkert att|spänningssätt)/;

export function isHowToQuestion(t: string) {
  return HOW_TO.test(t) && !ELECTRICAL.test(t);
}

/** "Hur gör jag …" to the help search; it comes before the words that ask the model to write ("hur skriver jag …"). */
export function helpPlan(t: string, question = t): Plan | null {
  // The search gets the person's own words; the corrected text only decides.
  return isHowToQuestion(t) ? { kind: "tool", tool: "search_help", input: { query: (question.trim() || t).slice(0, 200) }, heading: "Så här gör du i Workflow" } : null;
}

/**
 * The plan for a question about invoicing, quotes, maintenance or alarms that the read tools answer directly, or null. Asked after
 * the words that want interpretation ("sammanfatta …" goes to the model). `t` is the normalised, corrected question.
 */
export function knowledgePlan(t: string, now: Date, periodOf: Period): Plan | null {
  if (/\b(vad|vilka|vilket|finns det)\b.*\b(fakturer|ofakturer)|\b(ofakturerat|ofakturerad|att fakturera|klart att fakturera|väntar på fakturering)\b/.test(t) && !/\b(arbetsordern|projektet|jobbet)\s+\S/.test(t))
    return { kind: "tool", tool: "get_invoicing_overview", input: {}, heading: "Att fakturera" };
  if (/\b(utkast till fakturaunderlag|fakturaunderlag som väntar|fakturaunderlagen)\b/.test(t)) return { kind: "tool", tool: "list_company_invoice_bases", input: { status: "DRAFT" }, heading: "Fakturaunderlag som väntar" };
  if (/\b(offert|offerter|offerten|offerterna)\b/.test(t) && /\b(väntar|svar|skickade|öppna|går ut|accepterade|avböjda|utkast)\b/.test(t) && t.split(" ").length <= 9) {
    const status = /\baccepterade\b/.test(t) ? "ACCEPTED" : /\bavböjda\b/.test(t) ? "DECLINED" : /\butkast\b/.test(t) ? "DRAFT" : /\b(väntar|svar|skickade)\b/.test(t) ? "SENT" : "open";
    return { kind: "tool", tool: "list_quotes", input: { status }, heading: status === "SENT" ? "Offerter som väntar på svar" : status === "ACCEPTED" ? "Accepterade offerter" : status === "DECLINED" ? "Avböjda offerter" : status === "DRAFT" ? "Offertutkast" : "Öppna offerter" };
  }
  if (/\b(maskinlarm|larmen|larm)\b/.test(t) && /\b(vilka|aktiva|senaste|finns|har|visa|lista)\b/.test(t) && !/\b(förklara|varför|betyder)\b/.test(t))
    return { kind: "tool", tool: "list_machine_alarms", input: {}, heading: "Maskinlarm" };
  if (/\bunderhåll/.test(t) && /\b(ska göras|att göra|försenat|försenade|kommande|planerat|denna vecka|den här veckan|nästa vecka|i dag|idag|i morgon|månaden|vilket|vilka)\b/.test(t)) {
    const period = /\b(försenat|försenade)\b/.test(t) ? null : periodOf(t, now);
    return { kind: "tool", tool: "list_maintenance_due", input: period ? { from: period.from, to: period.to } : {}, heading: period ? `Underhåll ${period.label}` : "Underhåll som ska göras" };
  }
  return null;
}

export const KNOWLEDGE_RULE_TOOLS = new Set<string>(["search_help", "get_invoicing_overview", "list_company_invoice_bases", "list_quotes", "get_quote", "list_machine_alarms", "list_maintenance_due", "list_maintenance_parts", "get_maintenance_part"]);

const kr = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? `${Math.round(value).toLocaleString("sv-SE")} kr` : "");
const hoursOf = (seconds: unknown) => { const minutes = Math.round(Number(seconds ?? 0) / 60); return `${Math.floor(minutes / 60)} h ${minutes % 60} min`; };
const view = (id: string, title: string, href: string, description = ""): Citation => ({ resourceType: "VIEW", resourceId: id, title, description, href, citationLabel: title.slice(0, 60) });
const rowsOf = (value: unknown) => (Array.isArray(value) ? (value as Row[]) : []);
const STATE_LABEL: Record<string, string> = { late: "försenat", due: "att göra", dormant: "vilande", started: "påbörjat", done: "klart", cancelled: "utgått" };
const QUOTE_STATUS: Record<string, string> = { DRAFT: "utkast", SENT: "skickad", ACCEPTED: "accepterad", DECLINED: "avböjd", EXPIRED: "utgången" };
const SEVERITY: Record<string, string> = { info: "info", warning: "varning", fault: "fel", critical: "kritiskt" };
const time = (value: unknown) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(String(value)));

/** A knowledge tool's answer as a short Swedish reply with links; the same shape as formatRuleAnswer's. */
export function formatKnowledgeAnswer(tool: ToolName, heading: string, result: Row): { answer: string; citations: Citation[] } {
  const lines: string[] = [heading ? `${heading}:` : ""];
  const citations: Citation[] = [];
  const more = (shown: number, total: number) => { if (total > shown) lines.push(`… och ${total - shown} till.`); };
  if (tool === "search_help") {
    const hits = rowsOf(result.hits);
    if (!hits.length) return { answer: "Jag hittar inget om det i hjälpen. Under Hjälp i profilmenyn finns kapitlen om hur Workflow fungerar.", citations: [view("help", "Hjälp", "/?view=help")] };
    for (const hit of hits.slice(0, 3)) {
      lines.push(`• ${hit.title}: ${hit.text}`);
      citations.push(view(`help:${hit.url}`, String(hit.title), String(hit.url), String(hit.source ?? "")));
    }
    const film = hits.map((hit) => hit.film as Row | undefined).find(Boolean);
    if (film) { lines.push(`Se filmen ${film.title}.`); citations.push({ ...view(`film:${film.title}`, `Se filmen: ${film.title}`, String(film.url)), citationLabel: `Se filmen: ${String(film.title)}`.slice(0, 60) }); }
  } else if (tool === "get_invoicing_overview") {
    const drafts = result.drafts as Row | null;
    const unbilled = result.unbilled as Row | null;
    const quotes = result.quotes as Row | null;
    if (drafts && Number(drafts.count) > 0) lines.push(`• Utkast till fakturaunderlag som väntar: ${drafts.count}${kr(drafts.net) ? `, ${kr(drafts.net)} exkl. moms` : ""}.`);
    if (unbilled) {
      const rows = rowsOf(unbilled.rows);
      lines.push(`• Färdigt arbete som inte är fakturerat: ${hoursOf(unbilled.totalSeconds)}${Number(unbilled.materialRows) ? ` och ${unbilled.materialRows} material- eller utgiftsrader` : ""}${kr(unbilled.totalEstimate) ? `, uppskattat ${kr(unbilled.totalEstimate)} exkl. moms` : ""}.`);
      for (const row of rows.slice(0, 6)) { lines.push(`  – ${row.title}${row.customer ? ` (${row.customer})` : ""}: ${hoursOf(row.seconds)}${Number(row.materialRows) ? `, ${row.materialRows} rader` : ""}${kr(row.estimate) ? `, cirka ${kr(row.estimate)}` : ""}`); citations.push(view(`unbilled:${row.kind}:${row.id}`, String(row.title), String(row.url))); }
      more(Math.min(rows.length, 6), rows.length + Number(unbilled.more ?? 0));
    }
    if (quotes) {
      const awaiting = quotes.awaiting as Row | undefined;
      if (awaiting && Number(awaiting.count) > 0) lines.push(`• Offerter som väntar på svar: ${awaiting.count}${kr(awaiting.net) ? `, ${kr(awaiting.net)} exkl. moms` : ""}.`);
      const expiring = rowsOf(quotes.expiring);
      if (expiring.length) lines.push(`• Går snart ut: ${expiring.slice(0, 3).map((row) => `${row.label} ${row.title} (${row.days} dagar)`).join(", ")}.`);
      for (const row of expiring.slice(0, 3)) citations.push(view(`quote:${row.id}`, `${row.label} ${row.title}`, String(row.url)));
      const won = rowsOf(quotes.withoutWorkOrder);
      if (won.length) lines.push(`• Accepterade offerter utan arbetsorder: ${won.length}.`);
    }
    if (lines.length === 1) lines.push("Inget väntar på fakturering just nu.");
    citations.unshift(view("invoice-bases", "Fakturaunderlag", "/?view=invoice_bases"));
  } else if (tool === "list_company_invoice_bases") {
    const bases = rowsOf(result.bases);
    if (!bases.length) lines.push("Inga fakturaunderlag här.");
    for (const basis of bases.slice(0, 10)) lines.push(`• ${basis.label} ${basis.title} – ${basis.status === "DRAFT" ? "utkast" : "fakturerat"}${kr(basis.net) ? `, ${kr(basis.net)} exkl. moms` : ""}${basis.customerName ? ` · ${basis.customerName}` : ""}${Number(basis.unpriced) ? ` (${basis.unpriced} rader utan pris)` : ""}`);
    more(Math.min(bases.length, 10), Number(result.total ?? bases.length));
    citations.push(view("invoice-bases", "Fakturaunderlag", "/?view=invoice_bases"));
  } else if (tool === "list_quotes") {
    const quotes = rowsOf(result.quotes ?? result.items);
    if (!quotes.length) lines.push("Inga offerter matchar.");
    for (const quote of quotes.slice(0, 10)) {
      lines.push(`• ${quote.label} ${quote.title} – ${QUOTE_STATUS[String(quote.status)] ?? String(quote.status ?? "").toLowerCase()}${kr(quote.net) ? `, ${kr(quote.net)} exkl. moms` : ""}${quote.customerName ? ` · ${quote.customerName}` : ""}${quote.validUntil ? `, giltig till ${quote.validUntil}` : ""}`);
      citations.push(view(`quote:${quote.id}`, `${quote.label} ${quote.title}`, `/?view=quote&quoteId=${encodeURIComponent(String(quote.id))}`));
    }
    more(Math.min(quotes.length, 10), Number(result.total ?? quotes.length));
  } else if (tool === "get_quote") {
    const quote = (result.quote ?? result) as Row;
    lines[0] = `Offerten ${quote.label} ${quote.title}:`;
    lines.push(`• Status: ${QUOTE_STATUS[String(quote.status)] ?? String(quote.status ?? "")}${quote.validUntil ? `, giltig till ${quote.validUntil}` : ""}`);
    citations.push(view(`quote:${quote.id}`, `${quote.label} ${quote.title}`, `/?view=quote&quoteId=${encodeURIComponent(String(quote.id))}`));
  } else if (tool === "list_maintenance_due") {
    const items = rowsOf(result.occurrences);
    if (!items.length) lines.push("Inget underhåll är planerat under perioden.");
    for (const item of items.slice(0, 10)) { lines.push(`• ${item.date} ${item.title}${item.partName ? ` (${item.partName})` : ""} – ${STATE_LABEL[String(item.state)] ?? item.state}${item.assignedToName ? ` · ${item.assignedToName}` : ""}`); citations.push(view(`task:${item.id}`, String(item.title), String(item.url))); }
    more(Math.min(items.length, 10), Number(result.total ?? items.length));
    citations.push(view("maintenance", "Underhåll", "/?view=maintenance"));
  } else if (tool === "list_maintenance_parts") {
    const parts = rowsOf(result.parts);
    if (!parts.length) lines.push("Inga maskiner eller delar matchar.");
    for (const part of parts.slice(0, 10)) { lines.push(`• ${part.path ? `${part.path} › ` : ""}${part.name}${part.marking ? ` (${part.marking})` : ""}${Number(part.reported) ? `, ${part.reported} felanmälda` : ""}${Number(part.openItems) ? `, ${part.openItems} öppna poster` : ""}`); citations.push(view(`part:${part.id}`, String(part.name), String(part.url))); }
    more(Math.min(parts.length, 10), Number(result.total ?? parts.length));
  } else if (tool === "get_maintenance_part") {
    const part = (result.part ?? {}) as Row;
    lines[0] = `${part.name}${part.path ? ` (${part.path})` : ""}:`;
    for (const plan of rowsOf(result.plans).slice(0, 5)) { const next = rowsOf(plan.coming)[0]; lines.push(`• Plan ${plan.name}: ${plan.intervalText}${next ? `, nästa ${next.due} (${STATE_LABEL[String(next.state)] ?? next.state})` : ""}`); }
    const open = rowsOf(result.openWorkOrders);
    if (open.length) lines.push(`• Öppna arbetsordrar: ${open.length}`);
    citations.push(view(`part:${part.id}`, String(part.name), String(part.url)));
  } else if (tool === "list_machine_alarms") {
    const raised = rowsOf(result.raised);
    const observations = rowsOf(result.observations);
    lines.push(raised.length ? `Aktiva larm: ${raised.length}.` : "Inga aktiva larm.");
    for (const alarm of raised.slice(0, 8)) { lines.push(`• ${alarm.partPath || alarm.sourceName}: ${alarm.code}${alarm.text ? ` ${alarm.text}` : ""} (${SEVERITY[String(alarm.severity)] ?? alarm.severity}, ${time(alarm.occurredAt)})`); if (alarm.url) citations.push(view(`part:${alarm.partId}`, String(alarm.partPath || alarm.sourceName), String(alarm.url))); }
    if (observations.length) lines.push(`Reglernas observationer: ${observations.slice(0, 3).map((row) => row.title).join("; ")}.`);
    citations.push(view("maintenance", "Underhåll", "/?view=maintenance"));
  }
  return { answer: lines.filter(Boolean).join("\n"), citations: dedupe(citations).slice(0, 12) };
}

function dedupe(citations: Citation[]) {
  const seen = new Set<string>();
  return citations.filter((item) => { const key = `${item.resourceId}|${item.href}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
