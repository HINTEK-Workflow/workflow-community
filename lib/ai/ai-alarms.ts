import { z } from "zod";
import { azureErrorMessage } from "@/lib/ai/azure-settings";

/**
 * Driftlarm för Workflow AI (2026-11-21, F5). Azure never stops when a budget is passed: the cost is billed afterwards. So
 * Workflow tells Mottagare av driftlarm itself, from its own AI log (the provider's cost is stored per run):
 * - the month's cost against Månadsbudget för AI, at 50, 80 and 100 %, each threshold once a month;
 * - an unusually expensive day (more than three times an ordinary day of the last week), once a day;
 * - the first refused Azure call (wrong key, quota, missing deployment), once a day while it lasts.
 * Pure rules here; lib/ai/ai-alarms-run.ts reads the log, sends and remembers.
 */

const kr = (ore: number) => `${(ore / 100).toFixed(2).replace(".", ",")} kr`;

export const BUDGET_THRESHOLDS = [50, 80, 100] as const;
export type BudgetThreshold = (typeof BUDGET_THRESHOLDS)[number];
/** A day counts as unusual above this many times the last week's ordinary day … */
export const SPIKE_FACTOR = 3;
/** … and only from this cost (öre), so a quiet week's first questions are never an alarm. */
export const SPIKE_FLOOR_ORE = 2_000;

/** What is remembered between checks (SystemSettings.aiProvider.alarms). */
export const aiAlarmStateSchema = z.object({
  /** The month (YYYY-MM, Swedish time) and the thresholds already told that month. */
  budget: z.object({ month: z.string().max(7), sent: z.array(z.number().int()).max(3) }).optional(),
  /** The Swedish day an unusual day was last told. */
  spikeDay: z.string().max(10).optional(),
  /** The Swedish day a refused call was last told, and what it said. */
  refusalDay: z.string().max(10).optional(),
  refusal: z.string().max(300).optional(),
}).catch({});
export type AiAlarmState = z.infer<typeof aiAlarmStateSchema>;

/** The thresholds the month's cost has reached that were not told yet this month; the mail names the highest. */
export function dueBudgetThresholds(input: { spentOre: number; budgetKr: number; month: string; state: AiAlarmState }): BudgetThreshold[] {
  if (!(input.budgetKr > 0)) return [];
  const sent = input.state.budget?.month === input.month ? input.state.budget.sent : [];
  return BUDGET_THRESHOLDS.filter((threshold) => input.spentOre * 100 >= input.budgetKr * 100 * threshold && !sent.includes(threshold));
}

/** Whether today is unusual: more than SPIKE_FACTOR times the last seven days' average day, and above the floor. */
export function spikeDue(input: { todayOre: number; lastSevenDaysOre: number; day: string; state: AiAlarmState }): boolean {
  if (input.state.spikeDay === input.day) return false;
  if (input.todayOre < SPIKE_FLOOR_ORE) return false;
  return input.todayOre > (SPIKE_FACTOR * input.lastSevenDaysOre) / 7;
}

/**
 * Whether an Azure failure is one Workflow must act on (the key, the quota or a deployment), as opposed to a time-out or Azure's own
 * passing fault. Only the HTTP status is read, never Azure's text.
 */
export function azureRefusalWorthAlarm(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === 401 || status === 403 || status === 404 || status === 429;
}

/** Whether a refusal is told now: once per Swedish day while it lasts. */
export const refusalDue = (state: AiAlarmState, day: string) => state.refusalDay !== day;

export function budgetAlarmText(input: { threshold: BudgetThreshold; spentOre: number; budgetKr: number; link: string }) {
  const over = input.threshold >= 100;
  return {
    subject: over ? "Workflow AI har nått månadsbudgeten" : `Workflow AI har använt ${input.threshold} % av månadsbudgeten`,
    text: `AI-kostnaden den här månaden är ${kr(input.spentOre)} av budgeten ${input.budgetKr} kr (${input.threshold} %). Siffran kommer från Workflows egen AI-logg; Azures faktura kan skilja sig något.\n`
      + `${over ? "Azure stoppar inte av sig själv när budgeten är nådd. Veckokvoten per företag gäller som vanligt. " : ""}Budgeten ändras under Installation → Priser → Kostnad per AI-svar:\n${input.link}`,
  };
}

export function spikeAlarmText(input: { todayOre: number; lastSevenDaysOre: number; link: string }) {
  return {
    subject: "Workflow AI används ovanligt mycket i dag",
    text: `AI-kostnaden i dag är ${kr(input.todayOre)}. En vanlig dag den senaste veckan kostade ${kr(Math.round(input.lastSevenDaysOre / 7))}.\nSe vilka företag och funktioner det gäller under Installation → AI-användning:\n${input.link}`,
  };
}

/** The refusal in plain Swedish (azureErrorMessage reads only the status and Azure's error code). */
export function refusalAlarmText(input: { error: unknown; deployment: string; link: string }) {
  const reason = azureErrorMessage(input.error, input.deployment);
  return {
    reason,
    subject: "Workflow AI svarar inte (Azure)",
    text: `Azure nekar Workflow AI: ${reason}\nKontrollera under Installation → Tjänster och nycklar → Workflow AI (Azure):\n${input.link}\nLarmet kommer en gång per dygn så länge felet finns.`,
  };
}
