import { actionAnswer, formatRuleAnswer, GREETING_ANSWER, HELP_ANSWER, nearestRulePlan, OUTSIDE_ANSWER, planAnswer, singleMatch, THANKS_ANSWER, type RuleCitation, type RulePlan } from "@/lib/ai/assistant-rules";
import { ToolError } from "@/lib/tools/call-route";
import { runTool } from "@/lib/tools/registry";
import type { AliasMap } from "@/lib/ai/alias";

type Row = Record<string, unknown>;
type RuleAnswer = { answer: string; citations: RuleCitation[] };

const DETAIL_TOOL = { project: "get_project", customer: "get_customer", task: "get_task" } as const;
const DETAIL_ID = { project: "projectId", customer: "customerId", task: "taskId" } as const;

/**
 * The rule-first half of Workflow AI (2026-09-30): runs the same tools as the API and MCP in the person's own
 * session, so the answer holds exactly what the person may see. No AI model, no credits, nothing leaves Workflow.
 * Since 2026-10-01 a lookup by name answers with the details of one project, customer or task when the search has
 * one clear match, and otherwise with the search results.
 */
export async function answerWithRules(plan: Exclude<RulePlan, { kind: "ai" }>): Promise<RuleAnswer> {
  if (plan.kind === "help") return { answer: HELP_ANSWER, citations: [] };
  if (plan.kind === "greeting") return { answer: GREETING_ANSWER, citations: [] };
  if (plan.kind === "thanks") return { answer: THANKS_ANSWER, citations: [] };
  if (plan.kind === "outside") return { answer: OUTSIDE_ANSWER, citations: [] };
  if (plan.kind === "action") return actionAnswer(plan.what);
  try {
    if (plan.kind === "lookup") return await lookup(plan.query, plan.prefer, plan.heading);
    const result = await runTool(plan.tool, plan.input);
    return formatRuleAnswer(plan.tool, plan.heading, result as Row);
  } catch (error) {
    if (error instanceof ToolError) return { answer: error.status === 403 ? "Du har inte behörighet att se det här i Workflow." : error.message, citations: [] };
    throw error;
  }
}

/** One thing by name: the shared search, then the details of the one clear match, otherwise the search results. */
export async function lookup(query: string, prefer: "project" | "customer" | "task" | "any", heading: string): Promise<RuleAnswer> {
  const found = await runTool("search", { query: query.slice(0, 100) }) as Row;
  const match = singleMatch(query, found, prefer);
  if (match) {
    try {
      const detail = await runTool(DETAIL_TOOL[match.kind], { [DETAIL_ID[match.kind]]: match.id }) as Row;
      return formatRuleAnswer(DETAIL_TOOL[match.kind], heading, detail);
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
    }
  }
  // A customer or project asked for by name but not found by the broad search: the list tools match more loosely.
  if (prefer === "customer") return formatRuleAnswer("list_customers", heading, await runTool("list_customers", { query, limit: 10 }) as Row);
  if (prefer === "project") return formatRuleAnswer("list_projects", heading, await runTool("list_projects", { state: "ongoing", query }) as Row);
  return formatRuleAnswer("search", heading, found);
}

export { planAnswer };

/** Sources for an AI answer: the same search tool, minimised to title, a short description and the link. */
export async function searchSources(query: string | null) {
  if (!query || query.length < 2) return [];
  try {
    const { citations } = formatRuleAnswer("search", "Sök", await runTool("search", { query: query.slice(0, 100) }) as Row);
    return citations.slice(0, 6);
  } catch (error) {
    if (error instanceof ToolError) return [];
    throw error;
  }
}

/**
 * The best the rules can do with an open question when the AI model is off: the one clear match's details, otherwise
 * what the search found on the question's words.
 */
export async function answerWithoutAi(searchQuery: string | null, reason: string, question = ""): Promise<RuleAnswer> {
  const intro = `Den här frågan behöver AI för att tolkas. ${reason}`;
  // What the question is about, answered directly (projects, delays, time, tasks …), before a search on its words.
  const nearest = question ? nearestRulePlan(question) : null;
  if (nearest) {
    const direct = await answerWithRules(nearest);
    return { answer: [intro, "Det här kan jag svara direkt ur Workflow:", direct.answer].join("\n"), citations: direct.citations };
  }
  if (!searchQuery) return { answer: [intro, "Pröva en kortare fråga, t.ex. ”mina uppgifter”, ”vad är försenat” eller ”status på <projekt>”. Skriv ”hjälp” för fler."].join("\n"), citations: [] };
  try {
    const found = await lookup(searchQuery, "any", "Det här hittade jag på orden i frågan");
    if (found.citations.length) return { answer: `${intro}\n${found.answer}`, citations: found.citations };
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
  }
  return { answer: [intro, "Jag hittade inget på orden i frågan. Pröva en kortare fråga, t.ex. ”mina uppgifter”, ”vad är försenat” eller ”sök …”. Skriv ”hjälp” för fler."].join("\n"), citations: [] };
}

const WORK_KIND: Record<string, string> = { WORK_ORDER: "arbetsorder", RISK_ASSESSMENT: "riskbedömning", FORM: "protokoll", COMMISSIONING_CONTROL: "kontroll" };

/**
 * The person's own work for the AI model (2026-10-01: "Jag saknar åtkomst till uppgifter om dina
 * arbetsordrar"): counts per state and kind and the ten most recent open items, read with the same tool as Mina
 * uppgifter in the person's own session. Projects and controls (named after their place) are registered as aliases
 * first, so the model sees placeholders. Only sent when the company shares tasks with Workflow AI.
 */
export async function workContext(alias: AliasMap) {
  try {
    const open = await runTool("list_my_work", { filter: "open" }) as Row;
    const countsByKind: Record<string, unknown> = {};
    for (const [label, query] of [["arbetsordrar", "arbetsorder"], ["kontroller", "kontroll"], ["riskbedömningar", "riskbedömning"]] as const)
      countsByKind[label] = ((await runTool("list_my_work", { filter: "open", query })) as Row).counts;
    const mostRecent = ((open.items as Row[]) ?? []).slice(0, 10).map((row) => {
      const kind = String(row.kind ?? ("completion" in row ? "COMMISSIONING_CONTROL" : ""));
      if (row.projectName) alias.add("Projekt", String(row.projectName));
      if (kind === "COMMISSIONING_CONTROL") alias.add("Anläggning", String(row.title));
      return { kind: WORK_KIND[kind] ?? "uppgift", title: String(row.title), status: String(row.status), project: row.projectName || null, progress: row.progress ?? row.completion ?? null };
    });
    // The ongoing projects too (2026-10-01: "sammanfatta läget i mina projekt" had no projects to go on): name as an
    // alias, frame and status – never the responsible person's name.
    const today = new Date().toISOString().slice(0, 10);
    const projects = await runTool("list_projects", { state: "ongoing" }) as Row;
    const ongoingProjects = ((projects.projects as Row[]) ?? []).slice(0, 10).map((row) => {
      alias.add("Projekt", String(row.name));
      const status = row.status as Row | string | null | undefined;
      return { name: String(row.name), startDate: row.startDate || null, dueDate: row.dueDate || null, pastDueDate: Boolean(row.dueDate && String(row.dueDate) < today), status: status && typeof status === "object" ? status.label ?? null : status ?? null };
    });
    return { today, counts: open.counts, countsByKind, mostRecentOpen: mostRecent, ongoingProjects, ongoingProjectCount: Number(projects.total ?? ongoingProjects.length) };
  } catch (error) {
    if (error instanceof ToolError) return undefined;
    throw error;
  }
}

/** The step the person stands on, from the progress line: what the page sent, checked and short. */
export type PageContext = { kind: string; label?: string; step: string | null; hint: string | null; steps: { label: string; state: string }[]; tip: string | null; missing?: string[]; source?: "tip" | "page" | "summary"; draft?: string; taskId?: string };

/** Help with the current step without the AI model: the step, what to do and the tip, straight from Workflow's rules. */
export function answerForPage(page: PageContext, reason: string): RuleAnswer {
  const marks: Record<string, string> = { done: "klart", current: "nu", upcoming: "kommer", skipped: "hoppades över" };
  const current = page.steps.findIndex((step) => step.state === "current");
  const lines = [
    page.step ? `${page.label ? `${page.label}: d` : "D"}u står i steg ${current + 1} av ${page.steps.length}, ${page.step}.` : `${page.label ? `${page.label}: a` : "A"}lla steg är klara.`,
    ...(page.hint ? [page.hint] : []),
    ...(page.missing?.length ? ["Kvar innan den kan slutföras:", ...page.missing.slice(0, 8).map((item) => `• ${item}`), ...(page.missing.length > 8 ? [`… och ${page.missing.length - 8} till.`] : [])] : []),
    ...(page.tip ? [`Tips: ${page.tip}`] : []),
    `Stegen: ${page.steps.map((step) => `${step.label} (${marks[step.state] ?? step.state})`).join(" → ")}.`,
    "Klicka på ett steg på linjen eller på Slutför, så leder Workflow dig till det som saknas.",
    ...(reason ? [reason] : []),
  ];
  return { answer: lines.join("\n"), citations: reason ? [{ resourceType: "VIEW", resourceId: "ai-settings", title: "Workflow AI-behörigheter", description: "", href: "/?view=ai_settings", citationLabel: "Workflow AI-behörigheter" }] : [] };
}
