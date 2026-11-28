import { createHash } from "node:crypto";

/**
 * Manipulationsskyddad logg (K3.1, 2026-11-27). The security log (SecurityEvent), the administration log
 * (AdministrationEvent) and the change history (RecordChange) are hash-chained per company: every row carries the previous
 * row's hash and its own, SHA-256 over the previous hash, its number in the chain and a canonical text of its columns.
 *
 * The database writes the links (the trigger audit_chain_* in migration 20261128210000_traceability, under a row lock on the
 * chain's head, so two writers never take the same number). This file is the same rule in TypeScript, for the nightly check:
 * it must give exactly the trigger's text, character for character – tests/traceability.test.ts holds both to it.
 *
 * Canonical text: "v1|<log>", then one line per column, "<name>=<value>", where a value is "-" for null and otherwise
 * "<number of UTF-8 bytes>:<text>" (so no text can pretend to be two columns). Times are ISO 8601 in UTC with milliseconds.
 * Hash: hex(SHA-256("<previous hash>\n<number>\n<canonical text>")). A new chain starts at a genesis hash; rows from before
 * the chain existed are anchored by one hash over them (the migration), and the rows the retention removed by a checkpoint.
 */
export const CHAIN_LOGS = ["admin", "security", "change"] as const;
export type ChainLog = (typeof CHAIN_LOGS)[number];
export const PLATFORM_CHAIN = "platform";

/** The table of each log. */
export const CHAIN_TABLES: Record<ChainLog, "AdministrationEvent" | "SecurityEvent" | "RecordChange"> = {
  admin: "AdministrationEvent", security: "SecurityEvent", change: "RecordChange",
};

export const chainKeyOf = (organizationId: string | null | undefined) => organizationId || PLATFORM_CHAIN;

export function canonicalValue(value: string | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

/** The trigger's to_char(…, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') of a timestamp(3) stored in UTC. */
export const canonicalTime = (value: Date) => value.toISOString();

export type AdminRow = { id: string; organizationId: string; actorId: string; action: string; detail: string; createdAt: Date };
export type SecurityRow = { id: string; type: string; userId: string | null; actorId: string | null; organizationId: string | null; platform: boolean; client: string; ipHash: string | null; detail: string; createdAt: Date };
export type ChangeRow = { id: string; organizationId: string; entityType: string; entityId: string; action: string; actorId: string | null; changes: string; createdAt: Date };
export type ChainRowContent = { log: "admin"; row: AdminRow } | { log: "security"; row: SecurityRow } | { log: "change"; row: ChangeRow };

function lines(log: ChainLog, fields: [string, string | null][]) {
  return [`v1|${log}`, ...fields.map(([name, value]) => `${name}=${canonicalValue(value)}`)].join("\n");
}

/** The canonical text of one row, in the column order the trigger uses. */
export function canonicalRow(content: ChainRowContent): string {
  if (content.log === "admin") {
    const row = content.row;
    return lines("admin", [["id", row.id], ["organizationId", row.organizationId], ["actorId", row.actorId], ["action", row.action], ["detail", row.detail], ["createdAt", canonicalTime(row.createdAt)]]);
  }
  if (content.log === "security") {
    const row = content.row;
    return lines("security", [["id", row.id], ["type", row.type], ["userId", row.userId], ["actorId", row.actorId], ["organizationId", row.organizationId],
      ["platform", row.platform ? "true" : "false"], ["client", row.client], ["ipHash", row.ipHash], ["detail", row.detail], ["createdAt", canonicalTime(row.createdAt)]]);
  }
  const row = content.row;
  return lines("change", [["id", row.id], ["organizationId", row.organizationId], ["entityType", row.entityType], ["entityId", row.entityId], ["action", row.action],
    ["actorId", row.actorId], ["changes", row.changes], ["createdAt", canonicalTime(row.createdAt)]]);
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The link of row number `seq` after `prevHash`. */
export const chainHash = (prevHash: string, seq: number, canonical: string) => sha256(`${prevHash}\n${seq}\n${canonical}`);

/** Where a new chain starts (the trigger's audit_chain_genesis). */
export const genesisHash = (log: ChainLog, chainKey: string) => sha256(`hintek-workflow-audit-chain-v1\n${log}\n${chainKey}`);

/**
 * The anchor of the rows written before the chain existed (the migration): one hash over each row's own hash, in the order
 * createdAt, id. Kept as the chain's first checkpoint, so the older rows are bound without being rewritten.
 */
export const anchorHash = (log: ChainLog, chainKey: string, canonicalRows: string[]) =>
  sha256(`hintek-workflow-audit-anchor-v1\n${log}\n${chainKey}\n${canonicalRows.length}\n${canonicalRows.map(sha256).join("\n")}`);

// ---------- checking a chain ----------

/** A stored row as the check reads it. */
export type ChainLink = { seq: number; prevHash: string | null; rowHash: string | null; canonical: string };
/** A link kept without its row (erased, removed, retention) or a row rewritten on purpose (redacted). */
export type ChainGap = { seq: number; prevHash: string; rowHash: string; kind: string };
export const DELETED_GAP_KINDS = ["erased", "removed", "retention"] as const;
export const isDeletedGap = (kind: string) => (DELETED_GAP_KINDS as readonly string[]).includes(kind);

export type ChainBreak = { seq: number; reason: ChainBreakReason };
export type ChainBreakReason = "changed" | "missing" | "link" | "tail" | "start";
/** The reasons in the company's and the superadmin's words. */
export const CHAIN_BREAK_TEXT: Record<ChainBreakReason, string> = {
  changed: "En rad har ändrats efter att den skrevs.",
  missing: "En rad saknas i kedjan.",
  link: "En rad pekar inte på raden före den.",
  tail: "Rader saknas i slutet av kedjan.",
  start: "Kedjans startpunkt saknas.",
};

export type ChainCheck = { ok: true; checked: number; lastSeq: number } | { ok: false; checked: number; break: ChainBreak };

/**
 * Checks a chain from a start (the newest checkpoint) to its head, one link at a time. Rows and gaps come in seq order
 * (several pages may be fed); `finish` compares the end with the head. Pure, so the tests read the same rule.
 */
export function chainVerifier(start: { seq: number; hash: string } | null) {
  let expected = (start?.seq ?? 0) + 1;
  let previous = start?.hash ?? null;
  let checked = 0;
  let broken: ChainBreak | null = start ? null : { seq: 1, reason: "start" };
  const fail = (seq: number, reason: ChainBreakReason) => { if (!broken) broken = { seq, reason }; };
  return {
    /** One position: the row (if it is still there) and its gap entry (if there is one). */
    step(row: ChainLink | null, gap: ChainGap | null) {
      if (broken) return;
      const seq = row?.seq ?? gap?.seq ?? expected;
      if (seq !== expected) return fail(expected, "missing");
      expected += 1;
      if (row) {
        if (row.prevHash !== previous) return fail(seq, "link");
        // A row rewritten on purpose (the erasure's names) keeps the hash it was written with; its text is not compared.
        if (gap && gap.kind === "redacted") {
          if (gap.rowHash !== row.rowHash) return fail(seq, "changed");
        } else if (chainHash(previous!, seq, row.canonical) !== row.rowHash) return fail(seq, "changed");
        previous = row.rowHash;
        checked += 1;
        return;
      }
      if (!gap || !isDeletedGap(gap.kind)) return fail(seq, "missing");
      if (gap.prevHash !== previous) return fail(seq, "link");
      previous = gap.rowHash;
    },
    get broken() { return broken; },
    get expected() { return expected; },
    finish(head: { lastSeq: number; lastHash: string }): ChainCheck {
      if (!broken && (expected - 1 !== head.lastSeq || previous !== head.lastHash)) fail(Math.min(expected, head.lastSeq + 1), expected - 1 < head.lastSeq ? "tail" : "link");
      return broken ? { ok: false, checked, break: broken } : { ok: true, checked, lastSeq: head.lastSeq };
    },
  };
}

/**
 * Feeds rows and gaps (each sorted by seq, both above the start) through the verifier in seq order, up to `through`.
 * A position with neither is passed as empty, so a missing row is found.
 */
export function verifyLinks(verifier: ReturnType<typeof chainVerifier>, rows: ChainLink[], gaps: ChainGap[], through: number) {
  const rowAt = new Map(rows.map((row) => [row.seq, row]));
  const gapAt = new Map(gaps.map((gap) => [gap.seq, gap]));
  while (!verifier.broken && verifier.expected <= through) {
    const seq = verifier.expected;
    verifier.step(rowAt.get(seq) ?? null, gapAt.get(seq) ?? null);
  }
}
