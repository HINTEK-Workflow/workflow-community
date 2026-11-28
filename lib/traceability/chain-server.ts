import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  CHAIN_BREAK_TEXT, CHAIN_LOGS, CHAIN_TABLES, canonicalRow, chainVerifier, PLATFORM_CHAIN, verifyLinks,
  type ChainBreakReason, type ChainCheck, type ChainGap, type ChainLink, type ChainLog,
} from "./chain";

/**
 * Manipulationsskyddad logg (K3.1) on the server: the nightly check of every chain, its status for the company's admin and the
 * superadmin, and the ways a row may leave a chain without breaking it – a person's erasure, a cleanup and the retention keep
 * the row's links as a gap (hashes only); a text rewritten on purpose (the erasure's names) is marked as redacted. The rows'
 * links themselves are written by the database (migration 20261128210000_traceability). Raw SQL throughout: the tables are
 * new and read the same with any generated client.
 */
type Db = Prisma.TransactionClient | typeof prisma;
const PAGE = 2000;

const table = (log: ChainLog) => Prisma.raw(`"${CHAIN_TABLES[log]}"`);
/** The rows of one chain: the company's, or the security events without a company. */
export const chainWhere = (log: ChainLog, chainKey: string) =>
  log === "security" && chainKey === PLATFORM_CHAIN ? Prisma.sql`"organizationId" IS NULL` : Prisma.sql`"organizationId" = ${chainKey}`;

type Head = { log: ChainLog; chainKey: string; organizationId: string | null; lastSeq: number; lastHash: string; brokenAt: Date | null };

async function readRows(db: Db, log: ChainLog, chainKey: string, from: number, to: number): Promise<ChainLink[]> {
  const where = Prisma.sql`${chainWhere(log, chainKey)} AND "chainSeq" BETWEEN ${from} AND ${to}`;
  if (log === "admin") {
    const rows = await db.$queryRaw<{ id: string; organizationId: string; actorId: string; action: string; detail: string; createdAt: Date; chainSeq: number; prevHash: string | null; rowHash: string | null }[]>`
      SELECT "id", "organizationId", "actorId", "action", "detail", "createdAt", "chainSeq", "prevHash", "rowHash" FROM "AdministrationEvent" WHERE ${where} ORDER BY "chainSeq"`;
    return rows.map((row) => ({ seq: row.chainSeq, prevHash: row.prevHash, rowHash: row.rowHash, canonical: canonicalRow({ log, row }) }));
  }
  if (log === "security") {
    const rows = await db.$queryRaw<{ id: string; type: string; userId: string | null; actorId: string | null; organizationId: string | null; platform: boolean; client: string; ipHash: string | null; detail: string; createdAt: Date; chainSeq: number; prevHash: string | null; rowHash: string | null }[]>`
      SELECT "id", "type", "userId", "actorId", "organizationId", "platform", "client", "ipHash", "detail", "createdAt", "chainSeq", "prevHash", "rowHash" FROM "SecurityEvent" WHERE ${where} ORDER BY "chainSeq"`;
    return rows.map((row) => ({ seq: row.chainSeq, prevHash: row.prevHash, rowHash: row.rowHash, canonical: canonicalRow({ log, row }) }));
  }
  const rows = await db.$queryRaw<{ id: string; organizationId: string; entityType: string; entityId: string; action: string; actorId: string | null; changes: string; createdAt: Date; chainSeq: number; prevHash: string | null; rowHash: string | null }[]>`
    SELECT "id", "organizationId", "entityType", "entityId", "action", "actorId", "changes", "createdAt", "chainSeq", "prevHash", "rowHash" FROM "RecordChange" WHERE ${where} ORDER BY "chainSeq"`;
  return rows.map((row) => ({ seq: row.chainSeq, prevHash: row.prevHash, rowHash: row.rowHash, canonical: canonicalRow({ log, row }) }));
}

/**
 * Checks one chain from its newest checkpoint to its head, in one consistent snapshot (REPEATABLE READ), a page of rows at a
 * time. Reads only.
 */
export async function checkChain(log: ChainLog, chainKey: string): Promise<ChainCheck & { lastSeq: number }> {
  return prisma.$transaction(async (tx) => {
    const [head] = await tx.$queryRaw<{ lastSeq: number; lastHash: string }[]>`SELECT "lastSeq", "lastHash" FROM "AuditChainHead" WHERE "log" = ${log} AND "chainKey" = ${chainKey}`;
    if (!head) return { ok: true as const, checked: 0, lastSeq: 0 };
    const [start] = await tx.$queryRaw<{ throughSeq: number; hash: string }[]>`
      SELECT "throughSeq", "hash" FROM "AuditChainCheckpoint" WHERE "log" = ${log} AND "chainKey" = ${chainKey} ORDER BY "throughSeq" DESC LIMIT 1`;
    const verifier = chainVerifier(start ? { seq: start.throughSeq, hash: start.hash } : null);
    for (let from = (start?.throughSeq ?? 0) + 1; from <= head.lastSeq && !verifier.broken; from += PAGE) {
      const to = Math.min(from + PAGE - 1, head.lastSeq);
      const [rows, gaps] = await Promise.all([
        readRows(tx, log, chainKey, from, to),
        tx.$queryRaw<ChainGap[]>`SELECT "seq", "prevHash", "rowHash", "kind" FROM "AuditChainGap" WHERE "log" = ${log} AND "chainKey" = ${chainKey} AND "seq" BETWEEN ${from} AND ${to} ORDER BY "seq"`,
      ]);
      verifyLinks(verifier, rows, gaps, to);
    }
    return { ...verifier.finish(head), lastSeq: head.lastSeq };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 600_000, maxWait: 30_000 });
}

export type ChainResult = { log: ChainLog; chainKey: string; organizationId: string | null; ok: boolean; checked: number; newlyBroken: boolean; seq?: number; reason?: ChainBreakReason };

/**
 * The nightly check (history:retention, before anything is removed): every chain of a company that still exists, and the
 * platform chain. The result is written on the chain's head – verified, or broken with where and why (the first time it is
 * found broken is kept, so the alarm goes once). A chain that checks whole again is no longer marked broken.
 */
export async function verifyAllChains(now = new Date(), options: { dryRun?: boolean } = {}): Promise<ChainResult[]> {
  const heads = await prisma.$queryRaw<Head[]>`
    SELECT h."log", h."chainKey", h."organizationId", h."lastSeq", h."lastHash", h."brokenAt" FROM "AuditChainHead" h
    WHERE h."organizationId" IS NULL OR EXISTS (SELECT 1 FROM "Organization" o WHERE o."id" = h."organizationId")
    ORDER BY h."log", h."chainKey"`;
  const results: ChainResult[] = [];
  for (const head of heads) {
    if (!(CHAIN_LOGS as readonly string[]).includes(head.log)) continue;
    const check = await checkChain(head.log, head.chainKey);
    // A dry run (history:retention -- --dry-run) checks and tells, and writes nothing.
    if (options.dryRun) {
      results.push(check.ok ? { log: head.log, chainKey: head.chainKey, organizationId: head.organizationId, ok: true, checked: check.checked, newlyBroken: false }
        : { log: head.log, chainKey: head.chainKey, organizationId: head.organizationId, ok: false, checked: check.checked, newlyBroken: !head.brokenAt, seq: check.break.seq, reason: check.break.reason });
      continue;
    }
    if (check.ok) {
      await prisma.$executeRaw`UPDATE "AuditChainHead" SET "verifiedAt" = ${now}, "verifiedSeq" = ${check.lastSeq}, "brokenAt" = NULL, "brokenSeq" = NULL, "brokenReason" = NULL WHERE "log" = ${head.log} AND "chainKey" = ${head.chainKey}`;
      results.push({ log: head.log, chainKey: head.chainKey, organizationId: head.organizationId, ok: true, checked: check.checked, newlyBroken: false });
      continue;
    }
    await prisma.$executeRaw`UPDATE "AuditChainHead" SET "verifiedAt" = ${now}, "verifiedSeq" = NULL,
      "brokenAt" = COALESCE("brokenAt", ${now}), "brokenSeq" = COALESCE("brokenSeq", ${check.break.seq}), "brokenReason" = COALESCE("brokenReason", ${check.break.reason})
      WHERE "log" = ${head.log} AND "chainKey" = ${head.chainKey}`;
    results.push({ log: head.log, chainKey: head.chainKey, organizationId: head.organizationId, ok: false, checked: check.checked, newlyBroken: !head.brokenAt, seq: check.break.seq, reason: check.break.reason });
  }
  return results;
}

// ---------- status ----------

export const CHAIN_LOG_LABEL: Record<ChainLog, string> = { admin: "Administrationsloggen", security: "Säkerhetsloggen", change: "Ändringshistoriken" };

export type ChainStatusView = { log: ChainLog; label: string; rows: number; verifiedAt: string | null; broken: null | { at: string; seq: number | null; text: string } };
type StatusRow = { log: ChainLog; lastSeq: number; verifiedAt: Date | null; brokenAt: Date | null; brokenSeq: number | null; brokenReason: string | null };

const statusView = (row: StatusRow): ChainStatusView => ({
  log: row.log, label: CHAIN_LOG_LABEL[row.log], rows: row.lastSeq, verifiedAt: row.verifiedAt?.toISOString() ?? null,
  broken: row.brokenAt ? { at: row.brokenAt.toISOString(), seq: row.brokenSeq, text: CHAIN_BREAK_TEXT[row.brokenReason as ChainBreakReason] ?? "Kedjan stämmer inte." } : null,
});

/** The company's own chains (its admin's view): numbers, times and reasons, never a row. */
export async function companyChainStatus(organizationId: string): Promise<ChainStatusView[]> {
  const rows = await prisma.$queryRaw<StatusRow[]>`
    SELECT "log", "lastSeq", "verifiedAt", "brokenAt", "brokenSeq", "brokenReason" FROM "AuditChainHead" WHERE "chainKey" = ${organizationId} ORDER BY "log"`;
  return rows.filter((row) => (CHAIN_LOGS as readonly string[]).includes(row.log)).map(statusView);
}

export type PlatformChainView = ChainStatusView & { chainKey: string; company: string | null };

/**
 * The superadmin's view (metadata only, never a company's rows): how many chains were checked last night, and every broken
 * one with the company's name, which log and where.
 */
export async function platformChainStatus() {
  const [summary] = await prisma.$queryRaw<{ chains: number; broken: number; lastVerified: Date | null }[]>`
    SELECT count(*)::int AS chains, count("brokenAt")::int AS broken, max("verifiedAt") AS "lastVerified" FROM "AuditChainHead"`;
  const broken = await prisma.$queryRaw<(StatusRow & { chainKey: string; company: string | null })[]>`
    SELECT h."log", h."chainKey", h."lastSeq", h."verifiedAt", h."brokenAt", h."brokenSeq", h."brokenReason", o."name" AS company
    FROM "AuditChainHead" h LEFT JOIN "Organization" o ON o."id" = h."organizationId"
    WHERE h."brokenAt" IS NOT NULL ORDER BY h."brokenAt" DESC LIMIT 50`;
  return {
    chains: summary?.chains ?? 0, brokenCount: summary?.broken ?? 0, lastVerified: summary?.lastVerified?.toISOString() ?? null,
    broken: broken.map((row): PlatformChainView => ({ ...statusView(row), chainKey: row.chainKey, company: row.chainKey === PLATFORM_CHAIN ? "Installationen" : row.company })),
  };
}

// ---------- leaving a chain without breaking it ----------

export type GapKind = "erased" | "removed" | "retention";

/** Keeps the links of the chained rows that match (hashes only, never content) before they are deleted or rewritten. */
async function keepLinks(db: Db, log: ChainLog, where: Prisma.Sql, kind: GapKind | "redacted") {
  const key = log === "security" ? Prisma.sql`COALESCE("organizationId", ${PLATFORM_CHAIN})` : Prisma.sql`"organizationId"`;
  // A row that leaves after its text was rewritten keeps its gap, now as deleted.
  const conflict = kind === "redacted" ? Prisma.sql`DO NOTHING` : Prisma.sql`DO UPDATE SET "kind" = EXCLUDED."kind"`;
  return db.$executeRaw`
    INSERT INTO "AuditChainGap" ("log", "chainKey", "seq", "organizationId", "prevHash", "rowHash", "kind")
    SELECT ${log}, ${key}, "chainSeq", "organizationId", "prevHash", "rowHash", ${kind} FROM ${table(log)}
    WHERE "chainSeq" IS NOT NULL AND "prevHash" IS NOT NULL AND "rowHash" IS NOT NULL AND (${where})
    ON CONFLICT ("log", "chainKey", "seq") ${conflict}`;
}

/**
 * Deletes log rows and keeps their links, so the chain stays checkable: a person's erasure (`erased`), a cleanup (`removed`)
 * or the retention (`retention`). `where` is SQL on the log's own table. Returns the number of rows deleted.
 */
export async function removeChainedRows(db: Db, log: ChainLog, where: Prisma.Sql, kind: GapKind) {
  await keepLinks(db, log, where, kind);
  return db.$executeRaw`DELETE FROM ${table(log)} WHERE ${where}`;
}

/** Before a row's text is rewritten on purpose (the erasure's names): the hash it was written with is kept and trusted. */
export async function markRedacted(db: Db, log: ChainLog, where: Prisma.Sql) {
  return keepLinks(db, log, where, "redacted");
}

/**
 * After rows left a chain: the run of deleted links right after the newest checkpoint becomes a new checkpoint (the last
 * removed row's hash), and those gaps and the older checkpoints go. The table stays small; the chain is checked from there.
 */
export async function compactChain(db: Db, log: ChainLog, chainKey: string, organizationId: string | null) {
  const [start] = await db.$queryRaw<{ throughSeq: number }[]>`
    SELECT "throughSeq" FROM "AuditChainCheckpoint" WHERE "log" = ${log} AND "chainKey" = ${chainKey} ORDER BY "throughSeq" DESC LIMIT 1`;
  if (!start) return 0;
  const [run] = await db.$queryRaw<{ seq: number | null }[]>`
    SELECT max("seq")::int AS seq FROM (
      SELECT "seq", "seq" - row_number() OVER (ORDER BY "seq") AS grp FROM "AuditChainGap"
      WHERE "log" = ${log} AND "chainKey" = ${chainKey} AND "seq" > ${start.throughSeq} AND "kind" IN ('erased', 'removed', 'retention')
    ) t WHERE grp = ${start.throughSeq}`;
  const through = run?.seq ?? null;
  if (!through) return 0;
  // A row still there inside the run (it never should be) stops the compaction: nothing is guessed.
  const [inside] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM ${table(log)} WHERE ${chainWhere(log, chainKey)} AND "chainSeq" > ${start.throughSeq} AND "chainSeq" <= ${through}`;
  if (inside?.n) return 0;
  const [last] = await db.$queryRaw<{ rowHash: string }[]>`SELECT "rowHash" FROM "AuditChainGap" WHERE "log" = ${log} AND "chainKey" = ${chainKey} AND "seq" = ${through}`;
  if (!last) return 0;
  await db.$executeRaw`INSERT INTO "AuditChainCheckpoint" ("id", "log", "chainKey", "organizationId", "throughSeq", "hash", "kind") VALUES (gen_random_uuid()::text, ${log}, ${chainKey}, ${organizationId}, ${through}, ${last.rowHash}, 'retention')`;
  await db.$executeRaw`DELETE FROM "AuditChainGap" WHERE "log" = ${log} AND "chainKey" = ${chainKey} AND "seq" <= ${through}`;
  await db.$executeRaw`DELETE FROM "AuditChainCheckpoint" WHERE "log" = ${log} AND "chainKey" = ${chainKey} AND "throughSeq" < ${through}`;
  return through - start.throughSeq;
}

/** The chains the rows matching `where` belong to (for compacting after a removal across chains). */
export async function chainsOf(db: Db, log: ChainLog, where: Prisma.Sql) {
  const key = log === "security" ? Prisma.sql`COALESCE("organizationId", ${PLATFORM_CHAIN})` : Prisma.sql`"organizationId"`;
  return db.$queryRaw<{ chainKey: string; organizationId: string | null }[]>`SELECT DISTINCT ${key} AS "chainKey", "organizationId" FROM ${table(log)} WHERE "chainSeq" IS NOT NULL AND (${where})`;
}
