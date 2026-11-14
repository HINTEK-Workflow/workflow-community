/**
 * Migreringssäkerhet (2026-10-28): what Prisma's own table _prisma_migrations says about the schema. Pure, so the
 * start guard (scripts/ops/schema-guard.ts) and the readiness check (/api/health/ready) judge it the same way.
 *
 * Prisma writes a row when a migration starts (finished_at null), sets finished_at when it is done and logs when it
 * failed; `migrate resolve --rolled-back` sets rolled_back_at. A row with neither finished_at nor rolled_back_at is a
 * failed migration – or one running right now, which is only allowed for IN_PROGRESS_GRACE_MS (longer than the
 * statement_timeout of the migration step) and only while Prisma has not written an error to logs.
 */
export type MigrationRow = {
  migration_name: string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
  has_logs?: boolean | null;
};

export const IN_PROGRESS_GRACE_MS = 15 * 60_000;

const time = (value: Date | string | null) => (value == null ? NaN : new Date(value).getTime());

/** Rows that block: failed (an error in logs, or started longer ago than the grace time). Running ones are left out. */
export function failedMigrations(rows: MigrationRow[], now = Date.now()) {
  return rows.filter((row) => row.finished_at == null && row.rolled_back_at == null)
    .filter((row) => row.has_logs || !(now - time(row.started_at) < IN_PROGRESS_GRACE_MS))
    .map((row) => row.migration_name);
}

export type SchemaVerdict = { ok: boolean; problems: string[]; notes: string[] };

/**
 * Before the app starts: every migration the image ships must be applied and finished, and no migration may be failed
 * or half done. Migrations in the database that the image does not know are allowed (an app rollback to the previous
 * version after an additive migration) and only noted.
 */
export function judgeSchema(localNames: string[], rows: MigrationRow[]): SchemaVerdict {
  const problems: string[] = [];
  const notes: string[] = [];
  const unfinished = rows.filter((row) => row.finished_at == null && row.rolled_back_at == null);
  for (const row of unfinished) problems.push(`migration ${row.migration_name} is not finished (failed or still running)`);
  const finished = new Set(rows.filter((row) => row.finished_at != null && row.rolled_back_at == null).map((row) => row.migration_name));
  for (const name of localNames) if (!finished.has(name)) problems.push(`migration ${name} is not applied`);
  const local = new Set(localNames);
  const newer = [...finished].filter((name) => !local.has(name)).sort();
  if (newer.length) notes.push(`the database has ${newer.length} migration(s) newer than this version (last: ${newer.at(-1)}); allowed for a rollback`);
  return { ok: problems.length === 0, problems, notes };
}
