// Driftlarm för Workflow AI (2026-11-21, F5): reads Workflow's own AI log, sends to Mottagare av driftlarm and remembers what
// was told in SystemSettings.aiProvider.alarms. Used by the server after Azure calls and by the nightly job keys:alerts (which runs
// outside Next, hence no "server-only" here). Never throws to its caller: an alarm that cannot be sent must not stop an AI answer.
import { prisma } from "@/lib/db";
import { absoluteUrl } from "@/lib/env";
import { publicInstance } from "@/lib/instance";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { mailConfig } from "@/lib/mail/settings-server";
import { parseAiCreditSettings } from "@/lib/ai/credit-settings";
import {
  aiAlarmStateSchema, azureRefusalWorthAlarm, budgetAlarmText, dueBudgetThresholds, refusalAlarmText, refusalDue, spikeAlarmText, spikeDue,
  type AiAlarmState,
} from "@/lib/ai/ai-alarms";
import { addSwedishDays, startOfSwedishDay, startOfSwedishMonth, swedishDayKey } from "@/lib/swedish-time";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function readState(): Promise<{ raw: Record<string, unknown>; state: AiAlarmState }> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { aiProvider: true } });
  const raw = row?.aiProvider && typeof row.aiProvider === "object" && !Array.isArray(row.aiProvider) ? row.aiProvider as Record<string, unknown> : {};
  return { raw, state: aiAlarmStateSchema.parse(raw.alarms ?? {}) };
}

/** Only `alarms` is written: everything else in the row stays exactly as read. */
async function saveState(patch: Partial<AiAlarmState>) {
  const { raw, state } = await readState();
  const next = { ...raw, alarms: { ...state, ...patch } };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { aiProvider: next }, create: { id: "global", aiProvider: next } });
}

/** Sends to Mottagare av driftlarm when alarms are on; false when nothing could be sent. */
export const sendOpsAlarm = (mail: { subject: string; text: string }) => sendAlarm(mail);
async function sendAlarm(mail: { subject: string; text: string }) {
  const config = await mailConfig();
  if (config.blockedReason || !config.delivery.alerts || !config.alertEmail) return false;
  await sendSystemEmail({ to: config.alertEmail, subject: `[${publicInstance().name}] ${mail.subject}`, text: mail.text, html: `<pre style="font-family:monospace">${escape(mail.text)}</pre>` });
  return true;
}

/** The provider's cost (öre) of the runs completed since a moment, from the AI log. */
async function costSince(from: Date, to?: Date) {
  const sum = await prisma.aiRun.aggregate({ where: { completedAt: { gte: from, ...(to ? { lt: to } : {}) }, providerCostOre: { not: null } }, _sum: { providerCostOre: true } });
  return sum._sum.providerCostOre ?? 0;
}

/**
 * The month's cost against Månadsbudget för AI (50, 80 and 100 %, each once a month) and an unusually expensive day (once a day).
 * Returns what was found, for the job's log line.
 */
export async function checkAiBudget(now = new Date()) {
  try {
    const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { ai: true } });
    const settings = parseAiCreditSettings(row?.ai);
    const month = swedishDayKey(now).slice(0, 7);
    const day = swedishDayKey(now);
    const today = startOfSwedishDay(now);
    const [spentOre, todayOre, lastSevenDaysOre, { state }] = await Promise.all([
      costSince(startOfSwedishMonth(now)), costSince(today), costSince(addSwedishDays(today, -7), today), readState(),
    ]);
    const due = dueBudgetThresholds({ spentOre, budgetKr: settings.monthlyBudgetKr, month, state });
    let mails = 0;
    if (due.length) {
      const threshold = due[due.length - 1];
      if (await sendAlarm(budgetAlarmText({ threshold, spentOre, budgetKr: settings.monthlyBudgetKr, link: absoluteUrl("/?view=ai_admin") }))) mails++;
      const sent = state.budget?.month === month ? state.budget.sent : [];
      await saveState({ budget: { month, sent: [...new Set([...sent, ...due])] } });
    }
    if (spikeDue({ todayOre, lastSevenDaysOre, day, state })) {
      if (await sendAlarm(spikeAlarmText({ todayOre, lastSevenDaysOre, link: absoluteUrl("/?view=ai_admin") }))) mails++;
      await saveState({ spikeDay: day });
    }
    return { spentOre, budgetKr: settings.monthlyBudgetKr, mails };
  } catch (error) {
    console.error("AI budget alarm failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return { spentOre: 0, budgetKr: 0, mails: 0 };
  }
}

/**
 * The first refused Azure call (key, quota, deployment) is told at once, then once a day while it lasts (2026-11-21). Before,
 * such a failure was first noticed when a customer got it. Only the status and Azure's code are read, never its text or the key.
 */
export async function reportAzureRefusal(error: unknown, deployment: string, now = new Date()) {
  try {
    if (!azureRefusalWorthAlarm(error)) return false;
    const day = swedishDayKey(now);
    const { state } = await readState();
    if (!refusalDue(state, day)) return false;
    const mail = refusalAlarmText({ error, deployment, link: absoluteUrl("/?view=server_keys&section=ai-azure") });
    // Remembered first, so two calls failing at the same moment do not both mail.
    await saveState({ refusalDay: day, refusal: mail.reason.slice(0, 300) });
    return await sendAlarm(mail);
  } catch (failure) {
    console.error("AI refusal alarm failed", failure instanceof Error ? failure.message.slice(0, 200) : "unknown");
    return false;
  }
}

// After Azure calls the budget is looked at, at most every quarter of an hour per process, so a busy day is told the same day.
let lastBudgetCheck = 0;
const BUDGET_CHECK_MS = 15 * 60_000;
export function checkAiBudgetSoon(now = Date.now()) {
  if (now - lastBudgetCheck < BUDGET_CHECK_MS) return;
  lastBudgetCheck = now;
  void checkAiBudget(new Date(now));
}
