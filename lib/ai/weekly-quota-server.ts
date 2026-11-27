import "server-only";
import { prisma } from "@/lib/db";
import { absoluteUrl } from "@/lib/env";
import { publicInstance } from "@/lib/instance";
import { parseAiCreditSettings } from "@/lib/ai/credit-settings";
import { getAiSharingPolicy } from "@/lib/ai/sharing-policy";
import { quotaAlarmAction, quotaAlarmText, quotaDecision, quotaView, quotaWeek, weeklyQuotaOre, type QuotaDecision, type QuotaView } from "@/lib/ai/weekly-quota";
import { sendOpsAlarm } from "@/lib/ai/ai-alarms-run";
import { COMPANY_KEY_PRICING_PREFIX } from "@/lib/ai/payer";

/** The provider's cost (öre) of a company's runs this week, from the AI log. */
async function spentThisWeek(organizationId: string, now: Date) {
  // A run on the company's own AI key (2026-11-27) is paid at the company's provider: never a part of Workflow's quota.
  const sum = await prisma.aiRun.aggregate({ where: { organizationId, completedAt: { gte: quotaWeek(now).start }, providerCostOre: { not: null }, NOT: { pricingVersion: { startsWith: COMPANY_KEY_PRICING_PREFIX } } }, _sum: { providerCostOre: true } });
  return sum._sum.providerCostOre ?? 0;
}

/**
 * What the company pays per month (öre): its current Cloud subscription's price (the plan or its price step), or null without one
 * (a trial, Community). Extra users are not counted, so the quota is never larger than the plan itself gives.
 */
async function monthlyPriceOre(organizationId: string) {
  const subscription = await prisma.cloudSubscription.findFirst({
    where: { organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, orderBy: { createdAt: "desc" }, select: { priceAmountOre: true },
  });
  return subscription?.priceAmountOre ?? null;
}

/**
 * Veckokvot (2026-11-21): what a company has used this week and how its next Workflow AI run is made – included, on credits
 * (the admin's choice, only with Workflow's credit system) or paused until Monday 00:00. When the quota is full, Mottagare av driftlarm
 * is told once per company and week.
 */
export async function companyWeeklyQuota(organizationId: string, now = new Date()): Promise<{ view: QuotaView; continueOnCredits: boolean; monthlyPriceOre: number | null; decision: QuotaDecision }> {
  const [row, policy, spentOre, price] = await Promise.all([
    prisma.systemSettings.findUnique({ where: { id: "global" }, select: { ai: true } }), getAiSharingPolicy(organizationId), spentThisWeek(organizationId, now), monthlyPriceOre(organizationId),
  ]);
  // Community runs on the installation's own key and pays its provider itself: no quota there.
  const quota = publicInstance().community ? { quotaOre: 0, source: "minimum" as const } : weeklyQuotaOre({ monthlyPriceOre: price, ownKr: policy.weeklyQuotaKr, settings: parseAiCreditSettings(row?.ai) });
  const view = quotaView({ spentOre, quota, now });
  const decision = quotaDecision({ view, continueOnCredits: policy.continueOnCredits, creditSystem: publicInstance().features.credits });
  if (view.full) void alarmOnce(organizationId, view.quotaOre, now);
  return { view, continueOnCredits: policy.continueOnCredits, monthlyPriceOre: price, decision };
}

async function alarmOnce(organizationId: string, quotaOre: number, now: Date) {
  try {
    const action = quotaAlarmAction(quotaWeek(now).key);
    if (await prisma.administrationEvent.findFirst({ where: { organizationId, action }, select: { id: true } })) return;
    const company = (await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }))?.name ?? "Ett företag";
    // Marked first, so two runs at the same moment do not both mail.
    await prisma.administrationEvent.create({ data: { actorId: "system:ai-week-quota", organizationId, action, detail: "Veckans kvot för Workflow AI är använd." } });
    await sendOpsAlarm(quotaAlarmText({ company, quotaOre, link: absoluteUrl("/?view=customer_companies") }));
  } catch (error) {
    console.error("AI weekly quota alarm failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
  }
}

/** The superadmin sets a company's own quota in kr per week (or removes it: null); metadata only. */
export async function setCompanyWeeklyQuota(organizationId: string, quotaKr: number | null) {
  const current = await getAiSharingPolicy(organizationId);
  const aiPolicy = { ...current, weeklyQuotaKr: quotaKr ?? undefined };
  await prisma.workspaceSettings.upsert({ where: { organizationId }, create: { organizationId, aiPolicy }, update: { aiPolicy } });
}
