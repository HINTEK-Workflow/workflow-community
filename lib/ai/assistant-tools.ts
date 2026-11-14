import { z } from "zod";
import { AliasMap, type AliasKind } from "@/lib/ai/alias";
import { formatRuleAnswer, type RuleCitation } from "@/lib/ai/assistant-rules";
import { aiMay, sharesWork, sourceAllowed, type AiSharingPolicy } from "@/lib/ai/sharing-policy";
import { isChatProposalTool } from "@/lib/ai/chat-proposals";
import type { ProviderTool } from "@/lib/ai/structured-provider";
import { isToolName, TOOL_CATALOG, type ToolName } from "@/lib/tools/catalog";
import { withoutMaterialPrices } from "@/lib/workflow/material-prices";
import type { MaterialRow } from "@/lib/workflow/expenses";

/**
 * The read tools Workflow AI may call while it answers (plan 2026-10-01, fas 1): the same small tools as the API and
 * MCP, run in the person's own session, so an answer never holds more than the person may see. Only reading – the
 * list is fixed here, and a tool that creates, changes or removes can never be added to it by a model. What a tool
 * returns goes to the model as data with names as aliases, cut to a bounded size, and each row gets a source key the
 * answer can cite.
 */
// list_notifications since 2026-10-05: "what is late or needs following up" in an open question had no tool.
// search_articles and get_article_price_history since 2026-10-08: the company's own prices (catalogue read right, Cloud only).
// list_team_work since 2026-10-09 (AI-beslut 3): the team's late and waiting work, under the admin's switch Lagöversikt.
export const ASSISTANT_READ_TOOLS = ["search", "get_task", "get_project", "get_customer", "list_my_work", "list_notifications", "list_projects", "list_planned_activities", "list_time_entries", "search_articles", "get_article_price_history", "list_team_work"] as const satisfies readonly ToolName[];
export type AssistantToolName = (typeof ASSISTANT_READ_TOOLS)[number];

/** How many tool calls one answer may make, and how much of a tool's answer the model gets. */
export const ASSISTANT_MAX_TOOL_CALLS = 3;
export const TOOL_OUTPUT_MAX_CHARS = 6_000;
const LIST_MAX = 12;
/** The first source key a tool may hand out; the keys before it belong to the sources sent with the question. */
const FIRST_TOOL_SOURCE = 7;
const LAST_SOURCE = 20;

/** Which of the company's sharing choices a tool needs (each choice governs only its own sources). */
function toolShared(policy: AiSharingPolicy, name: AssistantToolName) {
  if (name === "get_customer") return policy.shareCustomers;
  if (name === "search") return policy.shareCustomers || policy.shareDocuments || sharesWork(policy);
  if (name === "list_team_work") return sharesWork(policy) && aiMay(policy, "teamOverview");
  // Artiklar och priser: the material of the company's work, under the same choice as tasks and projects. Only what
  // the tool returns (at most 20 articles or 50 price rows) – a price file itself never goes to the AI.
  return sharesWork(policy);
}

/** The tools this company's choices allow, in a fixed order (so the provider's prompt cache holds). */
export function assistantToolNames(policy: AiSharingPolicy): AssistantToolName[] {
  return ASSISTANT_READ_TOOLS.filter((name) => toolShared(policy, name));
}

type JsonSchema = { type?: string | string[]; enum?: unknown[]; properties?: Record<string, JsonSchema>; required?: string[]; description?: string };

/**
 * A tool's input as a strict function schema: every field is listed as required and an optional one may be null.
 * Only the type and the allowed values are kept – lengths and formats are checked by the tool's own schema when the
 * call is run, so the provider never has to understand them.
 */
export function strictToolParameters(name: ToolName): Record<string, unknown> {
  const schema = z.toJSONSchema(TOOL_CATALOG[name].input, { io: "input" }) as JsonSchema;
  const required = new Set(schema.required ?? []);
  const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => {
    const type = typeof value.type === "string" ? value.type : "string";
    const optional = !required.has(key);
    return [key, {
      type: optional ? [type, "null"] : type,
      ...(value.enum ? { enum: optional ? [...value.enum, null] : value.enum } : {}),
    }];
  }));
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

/**
 * What Workflow AI is told beyond the shared description (2026-10-05): when to pick the tool and what its answer
 * holds, so the model reaches the right data in one call instead of guessing or searching twice. Fixed text, so the
 * provider's prompt cache holds.
 */
export const AI_TOOL_HINTS: Partial<Record<AssistantToolName, string>> = {
  search: "Använd för ett namn, ett ordernummer eller en plats. Ge 1–3 utmärkande ord, inte hela frågan.",
  get_task: "job är jobbets läge enligt Workflows egna regler: riskStep, completeBlockedBy (vad som saknas för Färdigställ, i ordning), startTimeBlockedBy (varför tiden inte kan startas), nextStep, bookings, cancelled (Utgått) och schedule – återge dem, gissa inte. Ett protokoll har results: avsnitt med kolumner och enheter, mätvärden per rad, gränser (limits) och reglernas bedömning (validation.deviations = utanför gräns, validation.missing = saknas). Återge reglernas bedömning, gör ingen egen.",
  get_project: "Ger projektets alla uppgifter med status, klart-datum och framsteg; använd för frågor om vad som återstår i ett projekt.",
  list_my_work: "Bara användarens egna uppgifter. filter action = behöver åtgärdas (avvikelser), active = pågående, planned = planerade, done = slutförda.",
  list_notifications: "Det som är förfallet, snart ska vara klart, behöver åtgärdas eller följas upp, och ronder att göra.",
  list_planned_activities: "Ange from och to (ÅÅÅÅ-MM-DD) räknat från today i indatan.",
  list_time_entries: "Ange from och to (ÅÅÅÅ-MM-DD) räknat från today i indatan.",
  search_articles: "För frågor om vad en artikel kostar eller vilket artikel- eller E-nummer den har. Ge 1–3 ord ur benämningen eller numret. Ange pris exkl. moms med prisdatum, bekräftat datum och leverantör; gissa aldrig ett pris som inte finns i svaret.",
  get_article_price_history: "När användaren frågar hur ett pris har ändrats; articleId från search_articles.",
  list_team_work: "För arbetsledarens frågor om hela lagets arbete: vad som är förfallet, snart ska vara klart, behöver åtgärdas eller väntar. Säg vad som stoppar och vem som är ansvarig, aldrig omdömen om personer.",
};

export function assistantToolDefinitions(policy: AiSharingPolicy): ProviderTool[] {
  return assistantToolNames(policy).map((name) => ({ name, description: [TOOL_CATALOG[name].description, AI_TOOL_HINTS[name]].filter(Boolean).join(" "), parameters: strictToolParameters(name) }));
}

// ---------- What a tool returns, as the model sees it ----------
type Row = Record<string, unknown>;

/** Fields that always name a person, a customer or a place, whatever tool returned them. */
const FIELD_KIND: Record<string, AliasKind> = {
  assignedToName: "Person", responsibleName: "Person", contactPerson: "Person", performer: "Person", createdByName: "Person", userName: "Person",
  company: "Kund", client: "Kund", customerName: "Kund",
  projectName: "Projekt", project: "Projekt",
  address: "Adress", workSite: "Plats", city: "Plats", postalCode: "Postnummer",
  email: "E-post", phone: "Telefon", mobile: "Telefon",
};
/** What a "name" is, by the list or object it sits in. */
// A work order's signature names the person who signed (2026-10-05: it used to reach the model as plain text).
const NAME_KIND: Record<string, AliasKind> = { signature: "Person", customers: "Kund", customer: "Kund", projects: "Projekt", project: "Projekt", facilities: "Anläggning", facility: "Anläggning", members: "Person", users: "Person" };
const TOOL_NAME_KIND: Partial<Record<AssistantToolName, AliasKind>> = { get_customer: "Kund", get_project: "Projekt", list_projects: "Projekt" };

/** Names and places become placeholders, lists are cut, everything else is masked by pattern. */
function aliased(alias: AliasMap, tool: AssistantToolName, value: unknown, parent: string, key: string): unknown {
  if (Array.isArray(value)) {
    const rows = value.slice(0, LIST_MAX).map((item) => aliased(alias, tool, item, key || parent, ""));
    return value.length > LIST_MAX ? [...rows, `… och ${value.length - LIST_MAX} till`] : rows;
  }
  if (value && typeof value === "object") {
    // A nested object named after what it is ("customer", "project") gives its "name" the right kind.
    const row = value as Row;
    const scope = key || parent;
    return Object.fromEntries(Object.entries(row).map(([field, item]) => [field, aliased(alias, tool, item, scope, field)]));
  }
  if (typeof value !== "string" || !value.trim()) return value;
  const kind = key === "name" ? NAME_KIND[parent] ?? (parent ? undefined : TOOL_NAME_KIND[tool]) : FIELD_KIND[key];
  // Links carry ids, not names; they are not sent at all.
  if (key === "url" || key === "href") return undefined;
  return kind ? alias.add(kind, value) : alias.text(value);
}

/**
 * What the model reads of a tool's answer: a protocol's raw values (keyed by the form's internal ids, with signatures)
 * are left out when its readable results are there – fewer tokens and the meaning the model needs (2026-10-05).
 */
export function modelView(tool: AssistantToolName, result: Row): Row {
  // Priser på materialraden (2026-10-09): a work order's purchase prices and markup never go to the AI provider, also
  // when the person may see them (docs/proposals/material-pris-offert-2026-10-09.md, section 7).
  if (tool === "get_task" && result?.details && typeof result.details === "object" && Array.isArray((result.details as Row).materials))
    result = { ...result, details: { ...(result.details as Row), materials: withoutMaterialPrices((result.details as { materials: MaterialRow[] }).materials) } };
  if (tool !== "get_task" || !result || !result.results || !result.details || typeof result.details !== "object") return result;
  const details = { ...(result.details as Row) };
  delete details.values;
  // The rules' judgement and the limits first: a long protocol is cut at the end, which is then only table rows.
  const { protocol, validation, limits, comment, fields, sections, ...rest } = result.results as Row;
  return { ...result, details, results: { protocol, validation, limits, comment, fields, ...rest, sections } };
}

/** What the company's choices keep of a search (each choice governs only its own kind of source). */
function allowedSearch(policy: AiSharingPolicy, result: Row): Row {
  const work = sharesWork(policy);
  return {
    ...(work ? { projects: result.projects ?? [], tasks: result.tasks ?? [] } : {}),
    ...(policy.shareCustomers ? { customers: result.customers ?? [] } : {}),
    ...(policy.shareDocuments ? { files: result.files ?? [] } : {}),
  };
}

const hasHits = (result: Row) => Object.values(result).some((rows) => Array.isArray(rows) && rows.length > 0);
/** How many narrower searches are tried when the first one finds nothing. */
const NARROWER_SEARCHES = 5;

/**
 * Workflow's search matches the whole phrase, so one word too many ("kunden Elbolaget") finds nothing. When that
 * happens the rules try shorter phrases – a word dropped from either end, then the most distinctive single words –
 * instead of the model spending another call on it. The result says what was finally searched for.
 */
async function searchNarrowing(policy: AiSharingPolicy, run: (name: ToolName, input: unknown) => Promise<unknown>, query: string): Promise<Row> {
  const first = allowedSearch(policy, await run("search", { query }) as Row);
  const words = query.split(/\s+/).filter(Boolean);
  if (hasHits(first) || words.length < 2) return first;
  const phrases: string[] = [];
  for (let size = words.length - 1; size >= 2; size -= 1)
    for (let start = 0; start + size <= words.length; start += 1) phrases.push(words.slice(start, start + size).join(" "));
  // A word with a digit (an order number, a marking) says most; then the longest ones.
  const single = words.filter((word) => word.length >= 3).sort((a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a)) || b.length - a.length).slice(0, 2);
  for (const narrower of [...phrases.slice(0, NARROWER_SEARCHES - single.length), ...single].slice(0, NARROWER_SEARCHES)) {
    const found = allowedSearch(policy, await run("search", { query: narrower }) as Row);
    if (hasHits(found)) return { ...found, searchedFor: narrower };
  }
  return first;
}

export type ToolCallRecord = { name: string; ok: boolean; preloaded?: boolean };

/**
 * Runs the model's tool calls for one answer. Everything is checked here, on the server, whatever the model asked
 * for: the tool must be one of the read tools the company's choices allow, the input must pass the tool's own schema,
 * and the number of calls is bounded. A refused call is answered with a short text (data to the model, never an
 * error that stops the answer) and is never run.
 */
export function createAssistantToolRunner(options: {
  policy: AiSharingPolicy;
  alias: AliasMap;
  /** The tool layer shared with the API and MCP (`runTool`), in the person's own session. */
  run: (name: ToolName, input: unknown) => Promise<unknown>;
  maxCalls?: number;
  /**
   * Förslag från chatten (AI-beslut 1 och 4, 2026-10-09): the proposal tools this answer may use and the server's own
   * handler, which checks the input, the person's permission and the links and only saves an `AiProposal`. `seenIds`
   * are the ids the tools of this answer returned (and the open task's), so a proposal can only link to what the
   * server itself read in the person's session.
   */
  proposer?: { allowed: readonly string[]; handle(name: string, input: Row, seenIds: ReadonlySet<string>): Promise<Row> };
}) {
  const allowed = new Set<string>(assistantToolNames(options.policy));
  const proposals = new Set<string>(options.proposer?.allowed ?? []);
  const seenIds = new Set<string>();
  const maxCalls = options.maxCalls ?? ASSISTANT_MAX_TOOL_CALLS;
  const calls: ToolCallRecord[] = [];
  const citations = new Map<string, RuleCitation>();
  const keyOf = new Map<string, string>();
  const refuse = (name: string, text: string) => { calls.push({ name: name.slice(0, 64), ok: false }); return JSON.stringify({ error: text }); };

  // Calls the server made before the model was asked (preload) do not count against the model's own limit.
  let preloaded = 0;

  async function callTool(name: string, argumentsJson: string): Promise<string> {
    if (calls.length - preloaded >= maxCalls) return refuse(name, "Gränsen för verktygsanrop är nådd. Svara med det du har.");
    return execute(name, argumentsJson);
  }

  /**
   * The server's own call before the model is asked (2026-10-05: the task the person has open was always
   * fetched by the model first, one whole extra round trip). Same checks as a model's call; the result goes with the
   * question, and the model's own limit is untouched.
   */
  async function preload(name: AssistantToolName, input: Row): Promise<string> {
    const before = calls.length;
    const text = await execute(name, JSON.stringify(input));
    for (const call of calls.slice(before)) call.preloaded = true;
    preloaded += calls.length - before;
    return text;
  }

  async function propose(name: string, argumentsJson: string): Promise<string> {
    let input: Row;
    try {
      const parsed = JSON.parse(argumentsJson || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      input = restoreDeep(options.alias, parsed) as Row;
    } catch { return refuse(name, "Förslagets indata gick inte att läsa."); }
    try {
      const result = await options.proposer!.handle(name, input, seenIds);
      calls.push({ name, ok: !("error" in result) });
      return JSON.stringify(options.alias.deep(result)).slice(0, TOOL_OUTPUT_MAX_CHARS);
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      return refuse(name, typeof status === "number" && error instanceof Error ? error.message.slice(0, 200) : "Förslaget kunde inte tas fram.");
    }
  }

  async function execute(name: string, argumentsJson: string): Promise<string> {
    if (options.proposer && isChatProposalTool(name) && proposals.has(name)) return propose(name, argumentsJson);
    if (!isToolName(name) || !allowed.has(name)) return refuse(name, "Verktyget är inte tillåtet här.");
    const tool = name as AssistantToolName;
    let input: Row;
    try {
      const parsed = JSON.parse(argumentsJson || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      // A null is the model's way of leaving an optional field out.
      input = Object.fromEntries(Object.entries(parsed as Row).filter(([, value]) => value !== null));
    } catch { return refuse(name, "Verktygets indata gick inte att läsa."); }
    // Names the model saw as placeholders are turned back before the search, so it can ask for "[Kund 1]".
    input = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === "string" ? options.alias.restore(value) : value]));
    let result: Row;
    try {
      result = tool === "search" ? await searchNarrowing(options.policy, options.run, String(input.query ?? "")) : await options.run(tool, input) as Row;
    } catch (error) {
      // The route's own refusal (not found, not permitted, invalid input) in its own words; anything else stays inside.
      const status = (error as { status?: unknown }).status;
      return refuse(name, typeof status === "number" && error instanceof Error ? error.message.slice(0, 200) : "Verktyget kunde inte köras.");
    }
    calls.push({ name, ok: true });
    if (proposals.size) collectIds(result, seenIds);
    const view = modelView(tool, result);
    // A first pass registers every name, so a name inside a free text or a source title is replaced as well.
    aliased(options.alias, tool, view, "", "");
    const data = aliased(options.alias, tool, view, "", "");
    // The rows as sources the answer may cite, by the same rules as the direct answers.
    const sources: { key: string; title: string }[] = [];
    for (const citation of formatRuleAnswer(tool, "", result).citations.filter((item) => sourceAllowed(options.policy, item.resourceType))) {
      const id = `${citation.resourceType}:${citation.resourceId}`;
      let key = keyOf.get(id);
      if (!key) {
        const next = FIRST_TOOL_SOURCE + citations.size;
        if (next > LAST_SOURCE) break;
        key = `source-${next}`;
        keyOf.set(id, key);
        citations.set(key, citation);
      }
      sources.push({ key, title: options.alias.text(citation.title) });
    }
    // The source keys first, so a long answer that is cut still lets the model cite what it read (2026-10-05).
    const text = JSON.stringify({ sources, data });
    return text.length > TOOL_OUTPUT_MAX_CHARS ? `${text.slice(0, TOOL_OUTPUT_MAX_CHARS)}…(avkortat)` : text;
  }

  return { callTool, preload, calls, citations, maxCalls };
}

export type AssistantToolRunner = ReturnType<typeof createAssistantToolRunner>;

const ID_KEYS = new Set(["id", "taskId", "projectId", "customerId", "facilityId", "workOrderId", "workflowTaskId"]);
/** Every id a tool's answer holds, so a proposal can only link to records the server read in the person's session. */
export function collectIds(value: unknown, into: Set<string>, depth = 0) {
  if (depth > 6 || !value || typeof value !== "object") return into;
  if (Array.isArray(value)) { for (const item of value.slice(0, 200)) collectIds(item, into, depth + 1); return into; }
  for (const [key, item] of Object.entries(value as Row)) {
    if (ID_KEYS.has(key) && typeof item === "string" && item) into.add(item);
    else if (item && typeof item === "object") collectIds(item, into, depth + 1);
  }
  return into;
}

/** Placeholders the model used turned back into the real names, everywhere in a proposal's input; nulls left out at the top. */
function restoreDeep(alias: AliasMap, value: unknown, depth = 0): unknown {
  if (typeof value === "string") return alias.restore(value);
  if (Array.isArray(value)) return value.map((item) => restoreDeep(alias, item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Row).filter(([, item]) => depth > 0 || item !== null).map(([key, item]) => [key, restoreDeep(alias, item, depth + 1)]));
  return value;
}

/** A preloaded tool answer as it goes with the question: the parsed data, the cut text as it is, nothing on a refusal. */
export function preloadedTask(text: string | null | undefined): unknown {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as Row;
    return parsed && typeof parsed === "object" && "error" in parsed ? undefined : parsed;
  } catch {
    return text;
  }
}

/**
 * Whether the question is about the person's own work as a whole ("läget", "mina projekt", "vad ska jag göra idag").
 * Then the short overview is sent with the question, which is cheaper than several tool calls; otherwise it is left
 * out and the model fetches what it needs.
 */
export function isOwnWorkQuestion(question: string) {
  const text = ` ${question.toLocaleLowerCase("sv")} `;
  return [" mina ", " mitt ", " min ", " läget", " status", "försen", "förfall", "pågå", "sammanfatta", "översikt", "prioriter", " idag", " i dag", " imorgon", " i morgon", "veckan", "vad ska jag", "vad bör jag"].some((word) => text.includes(word));
}
