// T5 torrkörning för de sista jobben (2026-10-24): history:retention, mailings:send, notices:send (and companies:closure,
// which had one) take --dry-run and then only count. These checks keep the argument rule and keep every delete, claim and
// send behind the dry-run branch, so a later edit cannot quietly make a dry run delete. The database side is in
// tests/history-retention.integration.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DRY_RUN_FLAG, jobArguments, jobPrefix } from "../lib/jobs/dry-run";

const read = (file: string) => readFileSync(file, "utf8");
const JOBS = { "history:retention": "scripts/history/run-retention.ts", "mailings:send": "scripts/mail/run-mailings.ts", "notices:send": "scripts/notices/run-notice-delivery.ts", "companies:closure": "scripts/history/run-company-closure.ts", "schedule:publish": "scripts/schedule/run-scheduled.ts", "agents:run": "scripts/agents/run-agents.ts" } as const;

test("the arguments: nothing is a real run, --dry-run a dry run, anything else stops the job before it runs", () => {
  assert.deepEqual(jobArguments([], "history:retention"), { dryRun: false });
  assert.deepEqual(jobArguments([DRY_RUN_FLAG], "history:retention"), { dryRun: true });
  for (const wrong of [["--dryrun"], ["--dry"], ["-n"], [DRY_RUN_FLAG, "--force"], ["dry-run"]])
    assert.throws(() => jobArguments(wrong, "history:retention"), /okänt argument[\s\S]*Inget har körts/, `${wrong.join(" ")} is refused`);
  assert.equal(jobPrefix("mailings:send", true), "mailings:send (provkörning)");
  assert.equal(jobPrefix("mailings:send", false), "mailings:send");
});

test("every job with a dry run reads its arguments through jobArguments and is allowed it by run-job.sh", () => {
  const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
  const runJob = read("scripts/ops/run-job.sh");
  const allowed = /--dry-run\)\n\s*case "\$JOB" in\n\s*([^\n)]+)\)/.exec(runJob)?.[1].split("|").map((job) => job.trim()).sort();
  assert.deepEqual(allowed, Object.keys(JOBS).sort(), "run-job.sh allows --dry-run for exactly these jobs");
  for (const [job, file] of Object.entries(JOBS)) {
    assert.equal(scripts[job], `tsx scripts/ops/job.ts ${job} ${file}`, `${job} runs ${file} through the job control`);
    const source = read(file);
    assert.match(source, /jobArguments\(process\.argv\.slice\(2\), "[a-z:]+"\)/, `${file} refuses unknown arguments`);
    assert.doesNotMatch(source, /process\.argv\.includes/, `${file} has no second way to read the flag`);
  }
  // A dry run through run-job.sh writes no log line and no marker that monitor.sh would read as a real run.
  const dry = runJob.indexOf('if [[ "$MODE" == "--dry-run" ]]');
  assert.ok(dry > 0 && dry < runJob.indexOf("last-success") && dry < runJob.indexOf('>> "$LOG_DIR/$NAME.log" 2>&1'), "the dry run leaves before the log and the markers");
  assert.ok(dry > runJob.indexOf("flock -n 9"), "but under the same lock as the real run");
});

test("history:retention passes the dry run to every step that deletes, and leaves the machine analysis out", () => {
  const script = read(JOBS["history:retention"]);
  for (const call of ["applyRetention(new Date(), retentionCutoff, { dryRun })", "purgeExpiredCredentials(new Date(), { dryRun })", "purgeStaffRegister(new Date(), { dryRun })", "pruneSystemLogs(new Date(), { dryRun })"])
    assert.ok(script.includes(call), `the script calls ${call}`);
  assert.match(script, /if \(dryRun\)[^\n]*maskinanalys hoppas över[^\n]*\n\s*else[^\n]*analyseAllSources/);

  const before = (file: string, guard: string, ...deletes: string[]) => {
    const source = read(file);
    const at = source.indexOf(guard);
    assert.ok(at > 0, `${file} has ${guard}`);
    for (const remove of deletes) assert.ok(source.indexOf(remove, source.indexOf("export async function")) > at, `${file}: ${remove} comes after the dry-run branch`);
  };
  before("lib/workflow/history-retention-server.ts", "if (options.dryRun) {", "await prisma.importedFile.delete(", "await purgeReportArchive(company.id, before)", "await purgeHistory({ organizationId: company.id");
  before("lib/self-inspection/credentials-server.ts", "if (options.dryRun) {", "const removed = await prisma.$transaction(", "await removeStoredFiles(removed.files)");
  before("lib/staff-register/server.ts", "if (options.dryRun) {", "SET LOCAL workflow.staff_register_purge");
  before("lib/self-inspection/retention-server.ts", "if (options.dryRun) {", "await tx.selfInspectionDeviation.deleteMany(", "await tx.selfInspectionDeviation.updateMany(", "await tx.comment.deleteMany(", "(options.removeFile ?? remove)(path)");
  assert.ok(script.includes("purgeExpiredDeviations(new Date(), { dryRun })"), "the deviations follow the dry run");
  // Agentkörningar och AI-förslag (granskningen 2026-11-24): a fixed time for every company.
  before("lib/agents/retention-server.ts", "if (options.dryRun) {", "await tx.agentRun.deleteMany(", "await tx.aiProposal.deleteMany(");
  assert.ok(script.includes("purgeExpiredAgentHistory(new Date(), { dryRun })"), "the agent runs and AI proposals follow the dry run");
  for (const [file, guard] of [["lib/security/rate-limit.ts", "if (options.dryRun) return prisma.rateLimitBucket.count"], ["lib/analytics/store.ts", "if (options.dryRun) return prisma.analyticsCounter.count"]] as const)
    assert.ok(read(file).includes(guard), `${file} counts in a dry run`);
  // pruneSystemLogs and pruneSecurityLog: every delete is the second half of a count-or-delete pair.
  const cleanup = read("lib/workflow/system-cleanup.ts");
  const body = cleanup.slice(cleanup.indexOf("export async function pruneSystemLogs"));
  // A chained log's rows leave through removeChainedRows (Spårbarhet K3, 2026-11-27), counted like the others.
  assert.equal((body.match(/deleteMany\(|removeChainedRows\(/g) ?? []).length, (body.match(/rows\(\(\) => prisma\.\w+\.count\(/g) ?? []).length, "each table in pruneSystemLogs is counted in a dry run");
  assert.match(body, /cleanRateLimits\(now, \{ dryRun \}\)/);
  assert.match(body, /pruneCounters\(now, settings\.retentionMonths, \{ dryRun \}\)/);
  assert.match(body, /pruneSecurityLog\(now, undefined, \{ dryRun \}\)/);
  const securityLog = read("lib/security/security-log.ts");
  assert.match(securityLog, /options\.dryRun \? await Promise\.all\(\[\s*prisma\.userSession\.count/);
  assert.match(securityLog, /pruneSecurityEvents\(now, \{ dryRun: options\.dryRun \}\)/, "the security events follow the dry run through the chain's retention");
  const logRetention = read("lib/traceability/retention-server.ts");
  assert.ok(logRetention.indexOf("if (options.dryRun) {") > 0 && logRetention.indexOf("if (options.dryRun) {") < logRetention.indexOf("await removeChainedRows("), "the log retention counts before it removes");
  assert.ok(script.includes("applyLogRetention(new Date(), { dryRun, logs: [\"admin\", \"change\"] })"), "the administration and change logs follow the dry run");
});

test("mailings:send and notices:send send, queue, claim and draft nothing in a dry run", () => {
  const mailings = read(JOBS["mailings:send"]);
  const dry = mailings.slice(mailings.indexOf("if (dryRun) {"), mailings.indexOf("return;", mailings.indexOf("if (dryRun) {")));
  assert.ok(dry.length > 0, "the dry run returns before the real work");
  assert.doesNotMatch(dry, /runWeeklyDraft\(|processMailings\(|queueDueMailings|sendSystemEmail/);
  assert.ok(mailings.indexOf("await runWeeklyDraft()") > mailings.indexOf("return;"), "the weekly draft only after the dry run has returned");
  const preview = read("lib/mail/mailings.ts");
  const previewBody = preview.slice(preview.indexOf("export async function previewMailings"), preview.indexOf("let running = false"));
  assert.doesNotMatch(previewBody, /update|create|delete|send|\$transaction/i, "previewMailings only reads");
  const weekly = read("lib/mail/release-newsletter-server.ts");
  assert.doesNotMatch(weekly.slice(weekly.indexOf("export async function weeklyDraftDue"), weekly.indexOf("export async function runWeeklyDraft")), /writeWeeklySettings|createReleaseDraft/, "weeklyDraftDue does not mark the slot");

  const notices = read("lib/workflow/notice-delivery.ts");
  assert.equal((notices.match(/deps\.dryRun \|\| !fresh\.length \? new Set<string>\(\) : await claim\(/g) ?? []).length, 2, "neither e-mail nor push claims a notice in a dry run");
  // Without a claim nothing is in toSend: no send, no release, no device forgotten.
  assert.equal((notices.match(/const toSend = fresh\.filter\(\(\{ item \}\) => claimed\.has\(noticeKey\(item\)\)\);/g) ?? []).length, 2);
  assert.match(read(JOBS["notices:send"]), /runNoticeDelivery\(\{ dryRun \}\)/);
});

test("agents:run starts no mission and no run in a dry run", () => {
  const script = read(JOBS["agents:run"]);
  const dry = script.slice(script.indexOf("if (dryRun) {"), script.indexOf("return;", script.indexOf("if (dryRun) {")));
  assert.ok(dry.length > 0, "the dry run returns before the real work");
  assert.doesNotMatch(dry, /runDueAgents\(|update|create/);
});
