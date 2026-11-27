import "server-only";
import { prisma } from "@/lib/db";
import { publicInstance } from "@/lib/instance";
import { addSwedishDays } from "@/lib/swedish-time";
import { quotaWeek } from "@/lib/ai/weekly-quota";
import { companyWeeklyQuota } from "@/lib/ai/weekly-quota-server";
import { aiRunPayer, type AiPayer } from "@/lib/ai/payer";

/** Weeks shown on Användning, this one included. */
export const USAGE_WEEKS = 8;

export type AiUsageView = {
  week: { usedPercent: number; warn: boolean; full: boolean; opensAt: string; quotaOre?: number; spentOre?: number; source?: string; monthlyPriceOre?: number | null };
  continueOnCredits: boolean;
  /** Oldest first: the week's Monday, the answers in the chat (one number: direct and AI answers alike), the share of the quota, credits used. */
  weeks: { start: string; answers: number; usedPercent: number; credits: number }[];
  credits: { system: boolean; balance: number; usedThisWeek: number };
  /** This week's questions per person (counts only, never a question); `self` for a member, everyone for the admin, none for the superadmin. */
  people: { name: string; questions: number; self: boolean }[];
  askers: number;
  /** This week's AI runs by who pays: Ingår, Krediter, Företagets nyckel (lib/ai/payer.ts). */
  payers: Record<AiPayer, number>;
};

/**
 * Användning (2026-11-21: "kunden ska ju kunna följa användningen på ett ställe under Inställningar"): the week's quota as a
 * share (never the provider's cost for the customer), the last weeks, the answers per week as one number (the chat is one chat:
 * direct answers and AI answers are not told apart), credits, and questions per person – counts only. The company's admin sees
 * everyone; a member sees their own count; the superadmin sees the company's metadata with the cost, never the people.
 */
export async function companyAiUsage(organizationId: string, viewer: { userId: string; kind: "admin" | "member" | "superadmin" }, now = new Date()): Promise<AiUsageView> {
  const { start: thisWeek } = quotaWeek(now);
  const from = addSwedishDays(thisWeek, -7 * (USAGE_WEEKS - 1));
  const [quota, answers, runs, wallet, questions] = await Promise.all([
    companyWeeklyQuota(organizationId, now),
    prisma.aiMessage.findMany({ where: { organizationId, role: "ASSISTANT", createdAt: { gte: from } }, select: { createdAt: true }, take: 50_000 }),
    prisma.aiRun.findMany({ where: { organizationId, completedAt: { gte: from } }, select: { completedAt: true, providerCostOre: true, chargedCredits: true, pricingVersion: true, reservedCredits: true }, take: 50_000 }),
    prisma.creditWallet.findUnique({ where: { organizationId }, select: { balance: true } }),
    prisma.aiMessage.groupBy({ by: ["authorId"], where: { organizationId, role: "USER", createdAt: { gte: thisWeek }, authorId: { not: null } }, _count: { _all: true } }),
  ]);
  const starts = Array.from({ length: USAGE_WEEKS }, (_, index) => addSwedishDays(from, 7 * index));
  const weekIndex = (at: Date) => { for (let index = starts.length - 1; index >= 0; index--) if (at >= starts[index]) return index; return -1; };
  const weeks = starts.map((start) => ({ start: start.toISOString(), answers: 0, cost: 0, credits: 0 }));
  for (const answer of answers) { const index = weekIndex(answer.createdAt); if (index >= 0) weeks[index].answers++; }
  const payers: Record<AiPayer, number> = { included: 0, credits: 0, company: 0 };
  for (const run of runs) {
    if (!run.completedAt) continue;
    const index = weekIndex(run.completedAt);
    if (index < 0) continue;
    const payer = aiRunPayer(run);
    if (index === starts.length - 1) payers[payer] += 1;
    // A run on the company's own key is paid by the company at its provider: never a part of Workflow's weekly quota.
    if (payer !== "company") weeks[index].cost += run.providerCostOre ?? 0;
    weeks[index].credits += run.chargedCredits ?? 0;
  }
  // Earlier weeks against this week's quota: the share is what the customer sees, the cost only the superadmin.
  const percent = (cost: number) => (quota.view.quotaOre > 0 ? Math.floor((cost * 100) / quota.view.quotaOre) : 0);
  const names = viewer.kind === "superadmin" ? [] : await prisma.user.findMany({ where: { id: { in: questions.flatMap((row) => (row.authorId ? [row.authorId] : [])) } }, select: { id: true, name: true, email: true } });
  const name = new Map(names.map((user) => [user.id, user.name || user.email]));
  const people = viewer.kind === "superadmin" ? [] : questions
    .filter((row) => viewer.kind === "admin" || row.authorId === viewer.userId)
    .map((row) => ({ name: name.get(row.authorId ?? "") ?? "Okänd", questions: row._count._all, self: row.authorId === viewer.userId }))
    .sort((a, b) => b.questions - a.questions);
  const { view } = quota;
  return {
    week: {
      usedPercent: view.usedPercent, warn: view.warn, full: view.full, opensAt: view.opensAt,
      ...(viewer.kind === "superadmin" ? { quotaOre: view.quotaOre, spentOre: view.spentOre, source: view.source, monthlyPriceOre: quota.monthlyPriceOre } : {}),
    },
    continueOnCredits: quota.continueOnCredits,
    weeks: weeks.map((week) => ({ start: week.start, answers: week.answers, usedPercent: percent(week.cost), credits: week.credits })),
    credits: { system: publicInstance().features.credits, balance: wallet?.balance ?? 0, usedThisWeek: weeks[weeks.length - 1].credits },
    people,
    askers: questions.length,
    payers,
  };
}
