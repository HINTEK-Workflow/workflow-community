// Migreringssäkerhet (2026-10-28): the migration check (scripts/qa/migration-check.cjs, also run here against the
// repository's migrations since v0.25.0, so it is part of the "unit" gate), the migration timeouts for Prisma's CLI,
// the schema verdicts of the start guard and the readiness check, and the wiring in deploy.sh / container-start.sh /
// the backup script.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { withMigrationTimeouts } from "../lib/database-url";
import { failedMigrations, IN_PROGRESS_GRACE_MS, judgeSchema } from "../lib/migration-state";

const load = createRequire(__filename);
const hasTool = existsSync(path.join(__dirname, "../scripts/qa/migration-check.cjs"));
const noTool = !hasTool && "needs scripts/qa (not in the Community export)";
const check = (hasTool ? load("../scripts/qa/migration-check.cjs") : null) as {
  checkMigrationSql(sql: string): { errors: string[]; warnings: string[] };
  checkSince(tag?: string): { tag: string; results: { file: string; errors: string[]; warnings: string[] }[]; errorCount: number };
};
const root = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

// Every migration is its own transaction (Prisma runs a file statement by statement): BEGIN first, COMMIT last.
const wrapped = (sql: string) => `BEGIN;\n${sql}\nCOMMIT;`;

test("migration check: additive changes pass", { skip: noTool }, () => {
  const sql = `-- AlterTable
ALTER TABLE "WorkflowTask" ADD COLUMN "note" TEXT, ADD COLUMN "count" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "Thing" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, CONSTRAINT "Thing_pkey" PRIMARY KEY ("id"));
ALTER TABLE "Thing" ADD COLUMN "other" TEXT NOT NULL;
CREATE INDEX "Thing_name_idx" ON "Thing"("name");
ALTER TABLE "Thing" ADD CONSTRAINT "Thing_fk" FOREIGN KEY ("other") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER INDEX "old_name" RENAME TO "new_name";
ALTER TABLE "WorkflowTask" DROP CONSTRAINT "x_fkey";
UPDATE "WorkflowTask" SET "note" = 'a;b' WHERE "note" IS NULL;`;
  assert.deepEqual(check.checkMigrationSql(wrapped(sql)), { errors: [], warnings: [] });
});

test("migration check: breaking changes are errors unless approved with a reason", { skip: noTool }, () => {
  const cases = [
    'DROP TABLE "Site";',
    'ALTER TABLE "Control" DROP COLUMN "siteId";',
    'ALTER TABLE "Control" DROP "siteId";',
    'ALTER TABLE "Control" RENAME COLUMN "a" TO "b";',
    'ALTER TABLE "Control" RENAME TO "Check";',
    'ALTER TABLE "Control" ALTER COLUMN "a" TYPE INTEGER;',
    'ALTER TABLE "Control" ALTER COLUMN "a" SET DATA TYPE BIGINT;',
    'ALTER TABLE "Control" ALTER COLUMN "a" SET NOT NULL;',
    'ALTER TABLE "Control" ADD COLUMN "a" TEXT NOT NULL;',
    'ALTER TYPE "Role" RENAME VALUE \'A\' TO \'B\';',
    'DROP TYPE "Role";',
    'TRUNCATE "Control";',
    'DELETE FROM "Control";',
  ];
  for (const sql of cases) {
    const result = check.checkMigrationSql(wrapped(sql));
    assert.equal(result.errors.length, 1, sql);
    assert.match(result.errors[0], /^breaking: /, sql);
    assert.deepEqual(check.checkMigrationSql(`-- migration-check: breaking-approved (old app never reads it)\n${wrapped(sql)}`).errors, [], sql);
    assert.equal(check.checkMigrationSql(`-- migration-check: breaking-approved ()\n${wrapped(sql)}`).errors.length, 1, `${sql}: a reason is required`);
  }
  assert.deepEqual(check.checkMigrationSql(wrapped('DELETE FROM "Control" WHERE "id" = \'x\';')).errors, []);
  assert.deepEqual(check.checkMigrationSql(wrapped("-- DROP TABLE \"Site\";\nSELECT 1;")).errors, [], "comments are ignored");
});

test("migration check: a file must be its own transaction; CONCURRENTLY is flagged; large-table indexes warn", { skip: noTool }, () => {
  assert.deepEqual(check.checkMigrationSql(wrapped("SELECT 1;")).errors, [], "BEGIN first and COMMIT last");
  for (const sql of ["SELECT 1;", "BEGIN;\nSELECT 1;", "SELECT 1;\nCOMMIT;", wrapped("COMMIT;\nBEGIN;\nSELECT 1;"), wrapped('CREATE INDEX CONCURRENTLY "i" ON "WorkflowTask"("a");'), 'DROP INDEX CONCURRENTLY "i";']) {
    assert.ok(check.checkMigrationSql(sql).errors.length >= 1, sql);
    assert.ok(check.checkMigrationSql(sql).errors.every((error) => error.startsWith("transaction: ")), sql);
  }
  assert.deepEqual(check.checkMigrationSql('-- migration-check: non-transactional-approved (single statement)\nDROP INDEX CONCURRENTLY "i";').errors, [], "exempt with a reason");
  assert.equal(check.checkMigrationSql(wrapped('CREATE INDEX "i" ON "WorkflowTask"("a");')).warnings.length, 1);
  assert.equal(check.checkMigrationSql(wrapped('CREATE UNIQUE INDEX "i" ON "Customer"("a");')).warnings.length, 0, "small tables do not warn");
  assert.equal(check.checkMigrationSql(wrapped('ALTER TYPE "Role" ADD VALUE \'X\';')).warnings.length, 1);
});

test("migration check: the repository's migrations since v0.25.0 are safe for the old app", { skip: noTool }, (t) => {
  try { execFileSync("git", ["rev-parse", "--verify", "v0.25.0^{commit}"], { cwd: root, stdio: "ignore" }); } catch {
    t.skip("no git repository or no tag v0.25.0 here (e.g. the copy without ee/)");
    return;
  }
  const report = check.checkSince("v0.25.0");
  const errors = report.results.flatMap((item) => item.errors.map((error) => `${item.file}: ${error}`));
  assert.deepEqual(errors, [], "see docs/drift/MIGRERING-OCH-ATERSTALLNING.md, or mark an approved change in the file");
});

test("migration timeouts: passed to Postgres through the options parameter, only when asked", () => {
  const url = "postgresql://u:p@db:5432/workflow?schema=public";
  assert.equal(withMigrationTimeouts(url, {}), url);
  const withTimeouts = new URL(withMigrationTimeouts(url, { MIGRATE_LOCK_TIMEOUT: "10s", MIGRATE_STATEMENT_TIMEOUT: "5min" }));
  assert.equal(withTimeouts.searchParams.get("options"), "-c lock_timeout=10s -c statement_timeout=5min");
  assert.equal(withTimeouts.searchParams.get("schema"), "public");
  const kept = new URL(withMigrationTimeouts(`${url}&options=-c%20search_path%3Dx`, { MIGRATE_LOCK_TIMEOUT: "10s" }));
  assert.equal(kept.searchParams.get("options"), "-c search_path=x -c lock_timeout=10s");
  assert.throws(() => withMigrationTimeouts(url, { MIGRATE_LOCK_TIMEOUT: "10 s; DROP" }), /MIGRATE_LOCK_TIMEOUT/);
  assert.match(read("prisma.config.ts"), /withMigrationTimeouts\(prismaCliUrl\(process\.env\.DATABASE_URL\)\)/);
});

test("schema verdicts: failed or half-done migrations block, a newer database is allowed", () => {
  const done = (name: string) => ({ migration_name: name, started_at: "2026-10-01", finished_at: "2026-10-01", rolled_back_at: null });
  assert.deepEqual(judgeSchema(["a", "b"], [done("a"), done("b")]), { ok: true, problems: [], notes: [] });
  const newer = judgeSchema(["a"], [done("a"), done("b")]);
  assert.equal(newer.ok, true);
  assert.match(newer.notes[0], /newer than this version/);
  assert.equal(judgeSchema(["a", "b"], [done("a")]).ok, false, "a migration of the image is missing");
  const failed = { migration_name: "b", started_at: "2026-10-01", finished_at: null, rolled_back_at: null };
  assert.equal(judgeSchema(["a", "b"], [done("a"), failed]).ok, false);
  assert.equal(judgeSchema(["a", "b"], [done("a"), { ...failed, rolled_back_at: "2026-10-02" }, done("b")]).ok, true, "resolved and applied again");

  const now = Date.parse("2026-10-28T12:00:00Z");
  const running = { migration_name: "c", started_at: new Date(now - 60_000), finished_at: null, rolled_back_at: null, has_logs: false };
  assert.deepEqual(failedMigrations([running], now), [], "a migration running right now is not a failure");
  assert.deepEqual(failedMigrations([{ ...running, has_logs: true }], now), ["c"], "an error in logs is a failure");
  assert.deepEqual(failedMigrations([{ ...running, started_at: new Date(now - IN_PROGRESS_GRACE_MS - 1) }], now), ["c"], "too old to still run");
});

