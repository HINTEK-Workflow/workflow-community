// Framåtkompatibla migreringar (K4.7, 2026-11-28): the forward-only gate in scripts/qa/migration-check.cjs. It runs here over
// the repository's migrations, so it is part of `npm test` and therefore of the release gates.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const load = createRequire(__filename);
const hasTool = existsSync(path.join(__dirname, "../scripts/qa/migration-check.cjs"));
const noTool = !hasTool && "needs scripts/qa (not in the Community export)";
type Lock = { cutoff: string; count: number; sha256: string };
type Report = { results: { file: string; errors: string[] }[]; errorCount: number; checked: number; grandfathered: number };
const check = (hasTool ? load("../scripts/qa/migration-check.cjs") : null) as {
  checkForwardOnlySql(sql: string, options?: { knownVersions?: Set<string> }): { errors: string[] };
  checkForwardOnly(options?: { dir?: string; lock?: Lock; knownVersions?: Set<string> }): Report;
  readLock(): Lock;
};

const wrapped = (sql: string) => `BEGIN;\n${sql}\nCOMMIT;`;
const digest = (names: string[]) => createHash("sha256").update([...names].sort().map((name) => `${name}\n`).join("")).digest("hex");

test("forward-only: destructive changes need the transition marker", { skip: noTool }, () => {
  const cases = [
    'DROP TABLE "Site";',
    'DROP TABLE IF EXISTS "Site";',
    'ALTER TABLE "Control" DROP COLUMN "siteId";',
    'ALTER TABLE "Control" DROP "siteId";',
    'ALTER TABLE "Control" RENAME COLUMN "a" TO "b";',
    'ALTER TABLE "Control" RENAME TO "Check";',
    'ALTER TABLE "Control" ALTER COLUMN "a" TYPE INTEGER;',
    'ALTER TABLE "Control" ALTER COLUMN "a" SET DATA TYPE VARCHAR(20);',
    'ALTER TYPE "Role" RENAME TO "Role_old";',
    'ALTER TYPE "Role" RENAME VALUE \'A\' TO \'B\';',
    'DROP TYPE "Role_old";',
    'DROP VIEW "Overview";',
  ];
  for (const sql of cases) {
    const result = check.checkForwardOnlySql(wrapped(sql));
    assert.equal(result.errors.length, 1, sql);
    assert.match(result.errors[0], /^forward-only: /, sql);
    assert.deepEqual(check.checkForwardOnlySql(`-- forward-only: övergång v0.88.0\n${wrapped(sql)}`).errors, [], `${sql}: allowed with the marker`);
    assert.deepEqual(check.checkForwardOnlySql(`-- forward-only: övergång 0.88.0\n${wrapped(sql)}`).errors, [], `${sql}: the v is optional`);
    assert.equal(check.checkForwardOnlySql(`-- forward-only: övergång\n${wrapped(sql)}`).errors.length, 1, `${sql}: a version is required`);
    assert.equal(check.checkForwardOnlySql(`-- forward-only: övergång senare\n${wrapped(sql)}`).errors.length, 1, `${sql}: the version must be X.Y.Z`);
  }
});

test("forward-only: additive changes, indexes, constraints and objects created in the same file pass", { skip: noTool }, () => {
  const sql = `ALTER TABLE "WorkflowTask" ADD COLUMN "note" TEXT;
CREATE TABLE "Thing" ("id" TEXT NOT NULL, CONSTRAINT "Thing_pkey" PRIMARY KEY ("id"));
ALTER TABLE "Thing" RENAME COLUMN "id" TO "key";
DROP TABLE "Thing";
CREATE TEMP TABLE scratch AS SELECT 1 AS a;
DROP TABLE scratch;
CREATE TYPE "Kind" AS ENUM ('A');
DROP TYPE "Kind";
ALTER INDEX "old_name" RENAME TO "new_name";
DROP INDEX "old_idx";
ALTER TABLE "WorkflowTask" DROP CONSTRAINT "x_fkey";
ALTER TYPE "Role" ADD VALUE 'X';
-- DROP TABLE "Site";
UPDATE "WorkflowTask" SET "note" = 'DROP TABLE x' WHERE "note" IS NULL;`;
  assert.deepEqual(check.checkForwardOnlySql(wrapped(sql)).errors, []);
});

test("forward-only: the transition version must be a released tag when tags are known", { skip: noTool }, () => {
  const sql = `-- forward-only: övergång v0.88.0\n${wrapped('ALTER TABLE "Control" DROP COLUMN "a";')}`;
  assert.deepEqual(check.checkForwardOnlySql(sql, { knownVersions: new Set(["v0.88.0", "v0.89.0"]) }).errors, []);
  const errors = check.checkForwardOnlySql(sql, { knownVersions: new Set(["v0.89.0"]) }).errors;
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not a released version/);
});

test("forward-only: locked migrations are grandfathered, new ones are checked, an old-dated addition is caught", { skip: noTool }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "forward-only-"));
  try {
    const add = (name: string, sql: string) => { mkdirSync(path.join(dir, name)); writeFileSync(path.join(dir, name, "migration.sql"), wrapped(sql)); };
    add("20260101000000_old_drop", 'ALTER TABLE "A" DROP COLUMN "b";');
    add("20260102000000_old_add", 'ALTER TABLE "A" ADD COLUMN "c" TEXT;');
    const lock = { cutoff: "20260102000000_old_add", count: 2, sha256: digest(["20260101000000_old_drop", "20260102000000_old_add"]) };
    assert.equal(check.checkForwardOnly({ dir, lock }).errorCount, 0, "the old drop is grandfathered");

    add("20261201000000_new_drop", 'ALTER TABLE "A" DROP COLUMN "c";');
    const report = check.checkForwardOnly({ dir, lock });
    assert.equal(report.checked, 1);
    assert.equal(report.errorCount, 1);
    assert.match(report.results[0].file, /20261201000000_new_drop/);

    writeFileSync(path.join(dir, "20261201000000_new_drop", "migration.sql"), `-- forward-only: övergång v0.95.0\n${wrapped('ALTER TABLE "A" DROP COLUMN "c";')}`);
    assert.equal(check.checkForwardOnly({ dir, lock }).errorCount, 0, "allowed with the marker");

    add("20260101500000_sneaked_in", 'ALTER TABLE "A" ADD COLUMN "d" TEXT;');
    const sneaked = check.checkForwardOnly({ dir, lock });
    assert.equal(sneaked.errorCount, 1, "a new migration dated before the cutoff breaks the lock");
    assert.match(sneaked.results[0].errors[0], /not the 2 locked ones/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("forward-only: the repository's migrations pass (existing ones are locked)", { skip: noTool }, () => {
  const lock = check.readLock();
  assert.match(lock.cutoff, /^\d{14}_/);
  const report = check.checkForwardOnly();
  const errors = report.results.flatMap((item) => item.errors.map((error) => `${item.file}: ${error}`));
  assert.deepEqual(errors, [], "keep the old object until a released version no longer uses it, then mark the file");
  assert.equal(report.grandfathered, lock.count);
});
