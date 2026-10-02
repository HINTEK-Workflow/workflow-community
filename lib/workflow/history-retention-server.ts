import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emptyCounts, purgeDetail, type HistoryCategory, type HistoryCounts } from "@/lib/workflow/history-retention";

type Db = Prisma.TransactionClient | typeof prisma;
type Statement = { count: Prisma.Sql; remove: Prisma.Sql };

// A table whose rows carry the company directly.
const direct = (table: string, org: string, before: Date): Statement => ({
  count: Prisma.sql`SELECT count(*)::int AS n FROM ${Prisma.raw(`"${table}"`)} WHERE "organizationId" = ${org} AND "createdAt" < ${before}`,
  remove: Prisma.sql`DELETE FROM ${Prisma.raw(`"${table}"`)} WHERE "organizationId" = ${org} AND "createdAt" < ${before}`,
});
// Older versions of a task or control: the latest version of each object is always kept.
const versions = (table: string, owner: string, key: string, org: string, before: Date): Statement => {
  const where = Prisma.sql`r.${Prisma.raw(`"${key}"`)} IN (SELECT o.id FROM ${Prisma.raw(`"${owner}"`)} o WHERE o."organizationId" = ${org})
    AND r."createdAt" < ${before}
    AND r.version < (SELECT max(x.version) FROM ${Prisma.raw(`"${table}"`)} x WHERE x.${Prisma.raw(`"${key}"`)} = r.${Prisma.raw(`"${key}"`)})`;
  return {
    count: Prisma.sql`SELECT count(*)::int AS n FROM ${Prisma.raw(`"${table}"`)} r WHERE ${where}`,
    remove: Prisma.sql`DELETE FROM ${Prisma.raw(`"${table}"`)} r WHERE ${where}`,
  };
};

// Every statement is bound to one company.
const statements: Record<HistoryCategory, (org: string, before: Date) => Statement[]> = {
  versions: (org, before) => [versions("WorkflowTaskRevision", "WorkflowTask", "taskId", org, before), versions("ControlRevision", "Control", "controlId", org, before)],
  project: (org, before) => [direct("ProjectEvent", org, before)],
  planning: (org, before) => [direct("PlannedActivityEvent", org, before)],
  time: (org, before) => [direct("WorkflowTimeEntryEvent", org, before)],
  // Whole AI conversations (messages follow); one with a pending or reviewed proposal is kept as its evidence.
  ai: (org, before) => [{
    count: Prisma.sql`SELECT count(*)::int AS n FROM "AiConversation" c WHERE c."organizationId" = ${org} AND coalesce(c."lastMessageAt", c."createdAt") < ${before} AND NOT EXISTS (SELECT 1 FROM "AiProposal" p WHERE p."conversationId" = c.id)`,
    remove: Prisma.sql`DELETE FROM "AiConversation" c WHERE c."organizationId" = ${org} AND coalesce(c."lastMessageAt", c."createdAt") < ${before} AND NOT EXISTS (SELECT 1 FROM "AiProposal" p WHERE p."conversationId" = c.id)`,
  }, {
    // The nightly digests: old ones say nothing about how things stand now.
    count: Prisma.sql`SELECT count(*)::int AS n FROM "AiDailyDigest" d WHERE d."organizationId" = ${org} AND d."createdAt" < ${before}`,
    remove: Prisma.sql`DELETE FROM "AiDailyDigest" d WHERE d."organizationId" = ${org} AND d."createdAt" < ${before}`,
  }, {
    // Proposals made on a page (no conversation): what was proposed and what the person did with it.
    count: Prisma.sql`SELECT count(*)::int AS n FROM "AiProposal" p WHERE p."organizationId" = ${org} AND p."conversationId" IS NULL AND p."createdAt" < ${before}`,
    remove: Prisma.sql`DELETE FROM "AiProposal" p WHERE p."organizationId" = ${org} AND p."conversationId" IS NULL AND p."createdAt" < ${before}`,
  }],
  administration: (org, before) => [
    direct("AdministrationEvent", org, before),
    direct("WorkScheduleEvent", org, before),
    {
      count: Prisma.sql`SELECT count(*)::int AS n FROM "FormTemplateEvent" e WHERE e."templateId" IN (SELECT f.id FROM "FormTemplate" f WHERE f."organizationId" = ${org}) AND e."createdAt" < ${before}`,
      remove: Prisma.sql`DELETE FROM "FormTemplateEvent" e WHERE e."templateId" IN (SELECT f.id FROM "FormTemplate" f WHERE f."organizationId" = ${org}) AND e."createdAt" < ${before}`,
    },
  ],
};

export async function countHistory(organizationId: string, before: Date, categories: HistoryCategory[], db: Db = prisma): Promise<HistoryCounts> {
  const counts = emptyCounts();
  for (const category of categories)
    for (const statement of statements[category](organizationId, before)) {
      const [row] = await db.$queryRaw<{ n: number }[]>(statement.count);
      counts[category] += row?.n ?? 0;
    }
  return counts;
}

/**
 * Deletes the company's history before the cutoff in one transaction and writes one line with the counts to the
 * administration history afterwards (so the line itself survives the deletion).
 */
export async function purgeHistory(input: { organizationId: string; before: Date; categories: HistoryCategory[]; actorId: string; kind: "manual" | "retention" }) {
  return prisma.$transaction(async (tx) => {
    const counts = emptyCounts();
    for (const category of input.categories)
      for (const statement of statements[category](input.organizationId, input.before))
        counts[category] += await tx.$executeRaw(statement.remove);
    await tx.administrationEvent.create({ data: {
      actorId: input.actorId, organizationId: input.organizationId,
      action: input.kind === "manual" ? "history_purge" : "history_retention", detail: purgeDetail(input.kind, input.before, counts),
    } });
    return counts;
  }, { timeout: 120_000 });
}

/** The nightly job: every company with a chosen retention time, all categories, older than the cutoff. */
export async function applyRetention(now = new Date(), cutoffFor: (months: number, now: Date) => Date) {
  const companies = await prisma.organization.findMany({ where: { historyRetentionMonths: { not: null } }, select: { id: true, historyRetentionMonths: true } });
  const results: { organizationId: string; counts: HistoryCounts }[] = [];
  for (const company of companies) {
    const before = cutoffFor(company.historyRetentionMonths!, now);
    const pending = await countHistory(company.id, before, Object.keys(emptyCounts()) as HistoryCategory[]);
    if (!Object.values(pending).some(Boolean)) continue;
    results.push({ organizationId: company.id, counts: await purgeHistory({ organizationId: company.id, before, categories: Object.keys(emptyCounts()) as HistoryCategory[], actorId: "system:history-retention", kind: "retention" }) });
  }
  return results;
}
