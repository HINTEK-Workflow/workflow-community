// Serverjobb (2026-11-14): the jobs' list against the cron file, the schedule in words, the next run, the control around
// every job (paused, already running, the result) and the route's checks. Nothing here touches a server or the database.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { BUSY_LINE, PAUSED_LINE, runControlledJob, type ClaimResult, type JobStore } from "../lib/ops/job-control";
import {
  CONTROLLED_JOB_KEYS, cronFileJobs, durationText, jobMessage, MONITOR_THRESHOLDS, monitorThresholdsFor, nextCronRun, parseCron, runRequestAllowed, scheduleText, serverJobAccess, SERVER_JOBS, serverJobsFor,
} from "../lib/ops/server-jobs";

const read = (file: string) => readFileSync(file, "utf8");
const hasCron = existsSync("ops/cron/hintek-workflow");

test("the list names every job of the cron file with exactly its schedule, and nothing the cron file does not have", { skip: !hasCron && "needs ops/ (not in the Community export)" }, () => {
  const cron = cronFileJobs(read("ops/cron/hintek-workflow"));
  const listed = new Map(serverJobsFor(true).filter((job) => job.place !== "db").map((job) => [job.key, job.cron]));
  assert.deepEqual([...listed.keys()].sort(), [...cron.keys()].sort(), "the same jobs");
  for (const [key, fields] of cron) assert.equal(listed.get(key), fields, `${key}: the cron file's schedule`);
  assert.equal(cron.get("monitor"), "*/5 * * * *");
  assert.equal(cron.get("host-status"), "17 * * * *");
});

test("every job the app runs goes through the control, with the cron file's allow-list unchanged", { skip: !hasCron && "needs ops/ (Community has no billing scripts)" }, () => {
  const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
  const allowed = (/case "\$JOB" in\s*\n\s*([^\n)]+)\)/.exec(read("scripts/ops/run-job.sh"))?.[1] ?? "").split("|").map((job) => job.trim()).sort();
  assert.deepEqual([...CONTROLLED_JOB_KEYS].sort(), allowed, "the controllable jobs are exactly run-job.sh's");
  for (const key of CONTROLLED_JOB_KEYS) assert.match(scripts[key], new RegExp(`^tsx scripts/ops/job\\.ts ${key} (ee/)?scripts/[a-z0-9/-]+\\.ts( --[a-z-]+)*$`), `${key} runs through scripts/ops/job.ts`);
  // A paused or busy job ends with exit 0, so run-job.sh writes the success marker and monitor.sh raises no alarm.
  const job = read("scripts/ops/job.ts");
  assert.match(job, /args\.includes\("--dry-run"\)/, "a dry run is passed straight through");
  assert.match(read("scripts/ops/monitor.sh"), /\[\[ "\$failure" -nt "\$success" \]\]/, "the monitor alarms only on a failure newer than the success");
});

// The Community edition (2026-11-15): only its own jobs, exactly the cron block of its installation guide, with its schedule.
const communityGuide = ["community/overlay/INSTALLATION.md", "INSTALLATION.md"].find((file) => existsSync(file) && /run-job\.sh register:sync/.test(read(file)));
test("the Community edition lists exactly the jobs its installation guide puts in cron, with the guide's schedule", { skip: !communityGuide && "needs the installation guide" }, () => {
  const guide = read(communityGuide!);
  const block = /\x60{3}\r?\nSHELL=\/bin\/bash[\s\S]*?\x60{3}/.exec(guide)?.[0] ?? "";
  const cron = cronFileJobs(block);
  const community = serverJobsFor(false);
  assert.deepEqual(community.map((job) => job.key).sort(), [...cron.keys()].sort(), "the same jobs as the guide");
  for (const [key, fields] of cron) assert.equal(community.find((job) => job.key === key)?.cron, fields, key + ": the guide's schedule");
  for (const key of ["billing:email", "billing:delinquency", "billing:card-retries", "credits:check", "companies:closure", "offsite", "db-backup", "files-backup", "predeploy", "db-host-status", "backup-list", "host-status"])
    assert.equal(community.some((job) => job.key === key), false, key + " is Workflow's own");
  const secrets = community.find((job) => job.key === "secrets:sync")!;
  assert.doesNotMatch(secrets.description, /valv/, "no key vault in the Community edition");
  assert.equal(secrets.cron, "10 4 * * *");
  assert.ok(community.every((job) => !job.edition || job.edition === "community"));
  assert.equal(monitorThresholdsFor(false).some((limit) => limit.key === "DB_CERT_MIN_DAYS"), false, "no database server");
  assert.equal(monitorThresholdsFor(true).length, MONITOR_THRESHOLDS.length);
});

test("Workflow's list keeps its own texts and has no Community-only job", () => {
  const cloud = serverJobsFor(true);
  assert.equal(cloud.some((job) => job.key === "nightly-backup"), false);
  assert.match(cloud.find((job) => job.key === "secrets:sync")!.description, /nyckelvalvet/);
  assert.equal(cloud.find((job) => job.key === "secrets:sync")!.cron, "*/10 * * * *");
  assert.ok(cloud.some((job) => job.key === "backup-list" && job.cron === "25 * * * *" && job.alsoCron === "50 3 * * *"));
});

test("the page: Senast says Inte inställd for a copy to another place that is not set up, and the database server only in Workflow's edition", () => {
  const server = read("lib/ops/server-jobs-server.ts");
  assert.match(server, /const offsiteOff = job\.key === "offsite" && backups !== null && !backups\.offsite\.configured;/);
  assert.match(server, /lastNote: offsiteOff \? OFFSITE_NOT_SET_UP/);
  assert.match(server, /backups: EE_PRESENT \? backups : null, databaseServer: EE_PRESENT/);
  assert.match(server, /const editionJob = \(key: string\)/);
  assert.match(read("features/workflow/server-jobs.tsx"), /if \(!last\) return job\.lastNote \?\? "Inte kört än";/);
});

test("the monitor's limits are the script's own defaults", () => {
  const monitor = read("scripts/ops/monitor.sh");
  for (const limit of MONITOR_THRESHOLDS) assert.match(monitor, new RegExp(`readonly ${limit.key}="\\$\\{${limit.key}:-${limit.value}\\}"`), limit.key);
});

test("the schedule in plain Swedish", () => {
  assert.equal(scheduleText("*/5 * * * *"), "var 5:e minut");
  assert.equal(scheduleText("*/10 * * * *"), "var 10:e minut");
  assert.equal(scheduleText("*/15 6-19 * * *"), "var 15:e minut kl. 06–19");
  assert.equal(scheduleText("30 3 * * *"), "varje dag 03:30");
  assert.equal(scheduleText("0 5 * * 1"), "måndagar 05:00");
  assert.equal(scheduleText("17 * * * *"), "varje timme, 17 minuter över");
  assert.equal(scheduleText("*/2 * * * *"), "var 2:a minut");
  assert.equal(scheduleText(null, "före varje släpp"), "före varje släpp");
  assert.equal(scheduleText("0 0 1 * *"), "0 0 1 * *", "an unusual schedule is shown as it is");
  for (const job of SERVER_JOBS) {
    if (!job.cron) continue;
    assert.ok(parseCron(job.cron), `${job.key}: a valid schedule`);
    assert.doesNotMatch(scheduleText(job.cron), /\*/, `${job.key} in words`);
  }
});

test("the next run in Swedish time, across the weekday and the night", () => {
  const at = (iso: string) => new Date(iso);
  // 2026-11-14 is a Saturday; Swedish time is UTC+1 in November.
  assert.equal(nextCronRun("*/5 * * * *", at("2026-11-14T10:02:30Z"))?.toISOString(), "2026-11-14T10:05:00.000Z");
  assert.equal(nextCronRun("30 3 * * *", at("2026-11-14T10:00:00Z"))?.toISOString(), "2026-11-15T02:30:00.000Z");
  assert.equal(nextCronRun("0 5 * * 1", at("2026-11-14T10:00:00Z"))?.toISOString(), "2026-11-16T04:00:00.000Z", "Monday 05:00");
  assert.equal(nextCronRun("*/15 6-19 * * *", at("2026-11-14T19:00:00Z"))?.toISOString(), "2026-11-15T05:00:00.000Z", "after 19:45 the next is 06:00");
  assert.equal(nextCronRun("*/15 6-19 * * *", at("2026-11-14T08:00:00Z"))?.toISOString(), "2026-11-14T08:15:00.000Z");
  assert.equal(nextCronRun("30 1 * * *", at("2026-07-01T00:00:00Z"))?.toISOString(), "2026-07-01T23:30:00.000Z", "summer time");
  assert.equal(nextCronRun(null), null);
});

test("Kör nu: only a controlled job, not paused, not running, not just requested", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  assert.deepEqual(runRequestAllowed("billing:email", null, now), { ok: true });
  assert.equal(runRequestAllowed("monitor", null, now).ok, false, "the host's job");
  assert.equal(runRequestAllowed("db-backup", null, now).ok, false, "the database server's job");
  assert.equal(runRequestAllowed("rm -rf /", null, now).ok, false);
  assert.match((runRequestAllowed("billing:email", { paused: true }, now) as { message: string }).message, /pausat/);
  assert.match((runRequestAllowed("billing:email", { lockedUntil: new Date(now.getTime() + 60_000) }, now) as { message: string }).message, /körs redan/);
  assert.equal(runRequestAllowed("billing:email", { lockedUntil: new Date(now.getTime() - 1) }, now).ok, true, "an expired lease is free");
  assert.equal(runRequestAllowed("billing:email", { runRequestedAt: new Date(now.getTime() - 10_000) }, now).ok, false, "a double click");
  assert.equal(runRequestAllowed("billing:email", { runRequestedAt: new Date(now.getTime() - 10_000), lastStartedAt: new Date(now.getTime() - 5_000) }, now).ok, true, "the request has started");
});

test("who may see and control the jobs: the superadmin only, never through an API key", () => {
  assert.deepEqual(serverJobAccess(null), { ok: false, status: 401, message: "Logga in för att fortsätta." });
  assert.equal((serverJobAccess({ role: "USER" }) as { status: number }).status, 403);
  assert.equal((serverJobAccess({ role: "ADMIN" }) as { status: number }).status, 403);
  assert.equal((serverJobAccess({ role: "SUPERADMIN" }, { keyId: "k" }) as { status: number }).status, 403, "an API key");
  assert.deepEqual(serverJobAccess({ role: "SUPERADMIN" }), { ok: true });
  const route = read("app/api/superadmin/server-jobs/route.ts");
  assert.match(route, /serverJobAccess\(ctx\.user, ctx\.integration\)/);
  for (const method of ["PATCH", "POST"]) {
    const body = route.slice(route.indexOf(`export async function ${method}`));
    assert.ok(body.indexOf("checkOrigin(request)") >= 0 && body.indexOf("checkOrigin(request)") < body.indexOf("superadmin()"), `${method}: the Origin first (a request from another site is refused)`);
  }
  assert.match(route, /z\.enum\(CONTROLLED_JOB_KEYS/, "only the known jobs, never a command");
  const server = read("lib/ops/server-jobs-server.ts");
  assert.match(server, /spawn\("npm", \["run", "--silent", key\]/, "the job's own npm script");
  assert.ok(server.indexOf("isControlledJob(key)") < server.indexOf('spawn("npm"'), "checked against the list before it starts");
  assert.match(server, /action: "server_job_run"/);
  assert.match(server, /"server_job_pause" : "server_job_resume"/);
});

test("the output line kept and the duration in words", () => {
  assert.equal(jobMessage("first\nsecond line\n\n"), "second line");
  assert.equal(jobMessage("a\u0007b"), "a b");
  assert.equal(jobMessage(""), null);
  assert.equal(jobMessage("x".repeat(400))?.length, 300);
  assert.equal(durationText(420), "420 ms");
  assert.equal(durationText(1234), "1,2 s");
  assert.equal(durationText(125_000), "2 min 5 s");
  assert.equal(durationText(null), null);
});

function fakeStore(claim: ClaimResult | Error) {
  const calls: string[] = [];
  const finished: unknown[] = [];
  const store: JobStore = {
    async claim(key, runId, at, lease, trigger) { calls.push(`claim:${key}:${trigger}:${lease.getTime() - at.getTime()}`); if (claim instanceof Error) throw claim; return claim; },
    async renew() { calls.push("renew"); },
    async finish(key, runId, result) { calls.push(`finish:${result.status}`); finished.push(result); },
    async skipped(key) { calls.push(`skipped:${key}`); },
  };
  return { store, calls, finished };
}
const quiet = { log: () => undefined, warn: () => undefined };

test("the control: a paused job is recorded as skipped, runs nothing and ends with exit 0", async () => {
  const { store, calls } = fakeStore({ claimed: false, reason: "paused" });
  let ran = false;
  const lines: string[] = [];
  const result = await runControlledJob("billing:email", async () => { ran = true; return { code: 0, stdout: "", stderr: "" }; }, store, { log: (line) => lines.push(line) });
  assert.deepEqual(result, { code: 0, outcome: "paused" });
  assert.equal(ran, false);
  assert.deepEqual(calls, ["claim:billing:email:cron:300000", "skipped:billing:email"]);
  assert.deepEqual(lines, [PAUSED_LINE("billing:email")]);
});

test("the control: a job another run holds is not run twice and ends with exit 0", async () => {
  const { store, calls } = fakeStore({ claimed: false, reason: "busy" });
  const lines: string[] = [];
  const result = await runControlledJob("mailings:send", async () => { throw new Error("must not run"); }, store, { log: (line) => lines.push(line), trigger: "manual" });
  assert.deepEqual(result, { code: 0, outcome: "busy" });
  assert.deepEqual(calls, ["claim:mailings:send:manual:300000"]);
  assert.deepEqual(lines, [BUSY_LINE("mailings:send")]);
});

test("the control: the job's exit code, the result and the last line are kept", async () => {
  const ok = fakeStore({ claimed: true });
  let clock = 1_000;
  const now = () => new Date(clock);
  const done = await runControlledJob("rounds:reminders", async () => { clock += 2_500; return { code: 0, stdout: "start\n{\"reminders\":3}\n", stderr: "" }; }, ok.store, { ...quiet, now });
  assert.deepEqual(done, { code: 0, outcome: "ran" });
  assert.deepEqual(ok.finished[0], { status: "ok", message: "{\"reminders\":3}", finishedAt: new Date(3_500), durationMs: 2_500 });

  const failed = fakeStore({ claimed: true });
  const result = await runControlledJob("rounds:reminders", async () => ({ code: 3, stdout: "half\n", stderr: "RoundReminderWorkerError\n" }), failed.store, quiet);
  assert.deepEqual(result, { code: 3, outcome: "ran" }, "the same exit code, so run-job.sh writes the failure marker as before");
  assert.equal((failed.finished[0] as { status: string; message: string }).status, "failed");
  assert.equal((failed.finished[0] as { message: string }).message, "RoundReminderWorkerError");

  const thrown = fakeStore({ claimed: true });
  assert.equal((await runControlledJob("rounds:reminders", async () => { throw new Error("spawn failed"); }, thrown.store, quiet)).code, 1);
  assert.equal((thrown.finished[0] as { message: string }).message, "spawn failed");
});

test("the control never stops a job when its own state cannot be read: the job runs as before", async () => {
  const { store, calls } = fakeStore(new Error("table missing"));
  const warnings: string[] = [];
  const result = await runControlledJob("credits:check", async () => ({ code: 0, stdout: "ok", stderr: "" }), store, { log: () => undefined, warn: (line) => warnings.push(line) });
  assert.deepEqual(result, { code: 0, outcome: "uncontrolled" });
  assert.deepEqual(calls, ["claim:credits:check:cron:300000"]);
  assert.match(warnings[0], /körs utan styrning/);
});

test("the page: shared parts, the app's own dialog, no native dialogs, in Drift och säkerhet", () => {
  const page = read("features/workflow/server-jobs.tsx");
  assert.match(page, /useConfirm\(\)/);
  assert.doesNotMatch(page, /window\.(confirm|alert|prompt)\(/);
  assert.match(page, /from "@\/features\/kfid\/ui"/);
  assert.match(page, /if \(job\.confirm\)/, "Kör nu asks first for the jobs that send or remove");
  for (const key of ["billing:email", "billing:delinquency", "billing:card-retries", "mailings:send", "notices:send", "companies:closure", "history:retention"])
    assert.equal(SERVER_JOBS.find((job) => job.key === key)?.confirm, true, `${key} asks first`);
  const workspace = read("features/kfid/workspace.tsx");
  assert.ok(workspace.indexOf('<SettingsPart id="jobs"><ServerJobs') > workspace.indexOf('<SettingsPart id="servers"><ServerUpdates'), "beside Servrar och uppdateringar");
});
