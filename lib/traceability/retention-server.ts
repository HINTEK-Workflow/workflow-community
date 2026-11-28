import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { securityLogCutoff } from "@/lib/security/security-log-core";
import { CHAIN_LOGS, CHAIN_TABLES, PLATFORM_CHAIN, type ChainLog } from "./chain";
import { chainWhere, compactChain, removeChainedRows } from "./chain-server";
import { logRetentionCutoff, logRetentionYears } from "./log-retention";

/**
 * Lagringstid för loggar (K3.3, 2026-11-27) – the nightly part of history:retention. Each company's security,
 * administration and change log loses the rows older than the company's chosen time (1, 2, 5 or 10 years); the security
 * events without a company keep the installation's 12 months. A removed row's links stay as a gap, and the run of removed
 * rows at the start of the chain becomes a checkpoint (compactChain), so the rest is checked exactly as before. Rows from
 * before the chain existed are simply removed (they are bound by the anchor only). A chain found broken is left as it is:
 * the evidence is kept until the superadmin has looked at it.
 * `dryRun` counts and changes nothing.
 */
export type LogRetentionResult = { log: ChainLog; chainKey: string; organizationId: string | null; rows: number; skipped?: "broken" };

const table = (log: ChainLog) => Prisma.raw(`"${CHAIN_TABLES[log]}"`);

export async function applyLogRetention(now = new Date(), options: { dryRun?: boolean; logs?: readonly ChainLog[] } = {}): Promise<LogRetentionResult[]> {
  const logs = options.logs ?? CHAIN_LOGS;
  const companies = new Map((await prisma.$queryRaw<{ id: string; years: number | null }[]>`SELECT "id", "logRetentionYears" AS years FROM "Organization"`).map((row) => [row.id, logRetentionYears(row.years)]));
  // Every chain, and the companies with rows from before the chains (they have a head from the migration's anchor).
  const heads = await prisma.$queryRaw<{ log: ChainLog; chainKey: string; organizationId: string | null; brokenAt: Date | null }[]>`
    SELECT "log", "chainKey", "organizationId", "brokenAt" FROM "AuditChainHead" WHERE "log" = ANY(${[...logs]}) ORDER BY "log", "chainKey"`;
  const results: LogRetentionResult[] = [];
  for (const head of heads) {
    const platform = head.chainKey === PLATFORM_CHAIN;
    const years = platform ? null : companies.get(head.chainKey);
    if (!platform && years === undefined) continue;
    const before = platform ? securityLogCutoff(now) : logRetentionCutoff(years!, now);
    const where = Prisma.sql`${chainWhere(head.log, head.chainKey)} AND "createdAt" < ${before}`;
    if (head.brokenAt) {
      const [found] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM ${table(head.log)} WHERE ${where}`;
      if (found?.n) results.push({ log: head.log, chainKey: head.chainKey, organizationId: head.organizationId, rows: 0, skipped: "broken" });
      continue;
    }
    if (options.dryRun) {
      const [found] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM ${table(head.log)} WHERE ${where}`;
      if (found?.n) results.push({ log: head.log, chainKey: head.chainKey, organizationId: head.organizationId, rows: found.n });
      continue;
    }
    const rows = await prisma.$transaction(async (tx) => {
      const chained = await removeChainedRows(tx, head.log, Prisma.sql`${where} AND "chainSeq" IS NOT NULL`, "retention");
      const legacy = await tx.$executeRaw`DELETE FROM ${table(head.log)} WHERE ${where} AND "chainSeq" IS NULL`;
      await compactChain(tx, head.log, head.chainKey, head.organizationId);
      return chained + legacy;
    }, { timeout: 300_000 });
    if (rows) results.push({ log: head.log, chainKey: head.chainKey, organizationId: head.organizationId, rows });
  }
  return results;
}

/** The security log's part (lib/security/security-log.ts pruneSecurityLog): the number of rows removed, or counted in a dry run. */
export async function pruneSecurityEvents(now = new Date(), options: { dryRun?: boolean } = {}) {
  return (await applyLogRetention(now, { dryRun: options.dryRun, logs: ["security"] })).reduce((sum, row) => sum + row.rows, 0);
}
