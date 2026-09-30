import { formatRuleAnswer, HELP_ANSWER, planAnswer, type RuleCitation, type RulePlan } from "@/lib/ai/assistant-rules";
import { ToolError } from "@/lib/tools/call-route";
import { runTool } from "@/lib/tools/registry";

/**
 * The rule-first half of HINTEK AI (Daniel 2026-09-30): runs the same tools as the API and MCP in the person's own
 * session, so the answer holds exactly what the person may see. No AI model, no credits, nothing leaves Workflow.
 */
export async function answerWithRules(plan: Exclude<RulePlan, { kind: "ai" }>): Promise<{ answer: string; citations: RuleCitation[] }> {
  if (plan.kind === "help") return { answer: HELP_ANSWER, citations: [] };
  try {
    const result = await runTool(plan.tool, plan.input);
    return formatRuleAnswer(plan.tool, plan.heading, result as Record<string, unknown>);
  } catch (error) {
    if (error instanceof ToolError) return { answer: error.status === 403 ? "Du har inte behörighet att se det här i Workflow." : error.message, citations: [] };
    throw error;
  }
}

export { planAnswer };

/** Sources for an AI answer: the same search tool, minimised to title, a short description and the link. */
export async function searchSources(query: string | null) {
  if (!query || query.length < 2) return [];
  try {
    const { citations } = formatRuleAnswer("search", "Sök", await runTool("search", { query: query.slice(0, 100) }) as Record<string, unknown>);
    return citations.slice(0, 6);
  } catch (error) {
    if (error instanceof ToolError) return [];
    throw error;
  }
}
