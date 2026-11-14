// Backuplistan (2026-11-14): the list the database server writes, read by the app's own parser (lib/ops/backup-list.ts).
// The script itself is run against made-up folders in tests/hintek-ops.test.ts (it is Workflow's own and not exported).
import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKUP_LIST_MISSING_TEXT, bytesText, keepText, offsiteKeepText, parseBackupList } from "../lib/ops/backup-list";

const SAMPLE = [
  "schema=1", "host=db-server", "generated=2026-11-14T03:25:01+01:00", "disk.used_percent=42", "disk.free_bytes=52000000000",
  "keep.db.daily=14", "keep.db.weekly=8", "keep.db.predeploy=5", "keep.db.predeploy_max_days=90",
  "keep.files.daily=14", "keep.files.weekly=8", "keep.files.predeploy=5", "keep.files.predeploy_max_days=90",
  "status.db.daily.result=ok", "status.db.daily.time=2026-11-14T02:31:10+01:00", "status.db.daily.file=workflow-2026-11-14T023000.dump.age",
  "status.db.daily.bytes=1200", "status.db.daily.verified=pg_restore", "status.db.daily.tables=87",
  "status.db.predeploy.result=missing",
  "status.files.daily.result=failed", "status.files.daily.step=archive_and_encrypt", "status.files.daily.time=2026-11-14T02:41:00+01:00",
  "file=db|daily|workflow-2026-11-13T023000.dump.age|2026-11-13T02:31:00+01:00|1100",
  "file=db|daily|workflow-2026-11-14T023000.dump.age|2026-11-14T02:31:10+01:00|1200",
  "file=db|weekly|workflow-2026-11-08T023000.dump.age|2026-11-08T02:31:00+01:00|1000",
  "file=files|predeploy|storage-2026-11-12T101010.tar.gz.age|2026-11-12T10:10:20+01:00|5000",
  "file=db|daily|../../etc/passwd|2026-11-14T02:31:10+01:00|1", "file=db|monthly|workflow-x.dump.age|2026-11-14T02:31:10+01:00|1", "file=db|daily|a|b|c|d|e",
  "total.db.daily.count=2", "total.db.daily.bytes=2300", "total.db.weekly.count=1", "total.db.weekly.bytes=1000",
  "total.files.predeploy.count=1", "total.files.predeploy.bytes=5000",
  "status.offsite.result=ok", "status.offsite.time=2026-11-14T03:34:00+01:00", "offsite.configured=1", "offsite.prune_days=",
].join("\n");

test("the list is read: copies, totals, results, what is kept; anything of another shape is left out", () => {
  const list = parseBackupList(SAMPLE);
  assert.ok(list);
  assert.equal(list.host, "db-server");
  assert.equal(list.generatedAt, "2026-11-14T02:25:01.000Z");
  assert.deepEqual(list.disk, { usedPercent: 42, freeBytes: 52_000_000_000 });
  assert.equal(list.copies.length, 4, "a path, an unknown kind and a broken line are left out");
  assert.deepEqual(list.copies.map((copy) => `${copy.part}/${copy.kind}/${copy.name}`), [
    "db/daily/workflow-2026-11-14T023000.dump.age", "db/daily/workflow-2026-11-13T023000.dump.age", "db/weekly/workflow-2026-11-08T023000.dump.age", "files/predeploy/storage-2026-11-12T101010.tar.gz.age",
  ], "newest first per part and kind");
  assert.equal(list.copies[0].verified, "pg_restore", "the newest database backup was read back");
  assert.equal(list.copies[0].tables, 87);
  assert.equal(list.copies[1].verified, null, "an older one has no result of its own in the status");
  assert.deepEqual(list.totals.db.daily, { count: 2, bytes: 2300 });
  assert.deepEqual(list.totals.files.weekly, { count: 0, bytes: 0 });
  assert.equal(list.status["db.predeploy"], null, "missing is no status");
  assert.equal(list.status["files.daily"]?.result, "failed");
  assert.equal(list.status["files.daily"]?.step, "archive and encrypt");
  assert.equal(keepText(list.keep.db), "Sparas: 14 dagliga, 8 veckovisa, 5 före släpp (högst 90 dagar)");
  assert.equal(offsiteKeepText(list.offsite), "Extern kopia: rensas av lagringsplatsen själv (ingen egen gräns satt).");
  assert.equal(offsiteKeepText({ configured: true, pruneDays: 120 }), "Extern kopia: rensas efter 120 dagar.");
  assert.equal(bytesText(1_234_000_000), "1,2 GB");
  assert.equal(bytesText(512), "512 B");
});

test("a file that is not a list is no list", () => {
  assert.equal(parseBackupList(""), null);
  assert.equal(parseBackupList("schema=2\nhost=db-server\ngenerated=2026-11-14T03:25:01+01:00"), null);
  assert.equal(parseBackupList("schema=1\nhost=Hintek DB\ngenerated=2026-11-14T03:25:01+01:00"), null);
  assert.equal(parseBackupList("schema=1\nhost=db-server\ngenerated=igår"), null);
  assert.equal(parseBackupList(`schema=1\nhost=db-server\ngenerated=2026-11-14T03:25:01+01:00\n${"x".repeat(300_000)}`), null);
  assert.equal(BACKUP_LIST_MISSING_TEXT, "Listan saknas än – installeras på databasservern.");
});
