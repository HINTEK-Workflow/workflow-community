import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

// Granskning 2026-10-20: the scheduled jobs are named in four places – the cron file on the app server, the allow-list in
// run-job.sh, the markers monitor.sh watches and the npm scripts that run them. A job added to one and forgotten in
// another either never runs, is refused, or fails without an alarm.
// The cron file is Workflow's own and not in the Community export (its cron is in INSTALLATION.md); there these tests have nothing to read.
const hasCron = existsSync("ops/cron/hintek-workflow");
const noCron = !hasCron && "needs ops/ (not in the Community export)";
const cron = hasCron ? readFileSync("ops/cron/hintek-workflow", "utf8") : "";
const runJob = readFileSync("scripts/ops/run-job.sh", "utf8");
const monitor = readFileSync("scripts/ops/monitor.sh", "utf8");
const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;

const cronJobs = [...cron.matchAll(/^(?!#)\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+root\s+.*run-job\.sh (\S+)\s*$/gm)].map((match) => match[1]).sort();
const allowed = (/case "\$JOB" in\s*\n\s*([^\n)]+)\)/.exec(runJob)?.[1] ?? "").split("|").map((job) => job.trim()).sort();
const watched = (/for job in \$backup_jobs ([^;]+); do/.exec(monitor)?.[1] ?? "").trim().split(/\s+/).sort();

test("the cron file, run-job.sh, monitor.sh and package.json name the same jobs", { skip: noCron }, () => {
  assert.ok(cronJobs.length >= 12, `cron jobs found: ${cronJobs}`);
  assert.deepEqual(cronJobs, allowed, "every cron job is allowed by run-job.sh and nothing else is");
  assert.deepEqual(watched, allowed.map((job) => job.replaceAll(":", "-")).sort(), "monitor.sh watches the marker of every job");
  for (const job of allowed) assert.ok(scripts[job], `package.json has the script ${job}`);
  for (const job of allowed) assert.equal(cronJobs.filter((name) => name === job).length, 1, `${job} is scheduled once`);
});

test("every cron line runs in the production directory, with a valid five-field schedule and the monitor every five minutes", { skip: noCron }, () => {
  const lines = cron.split("\n").filter((line) => /^[\d*]/.test(line));
  for (const line of lines) {
    const [minute, hour, day, month, weekday] = line.split(/\s+/);
    for (const [field, max] of [[minute, 59], [hour, 23], [day, 31], [month, 12], [weekday, 7]] as const) {
      assert.match(field, /^(\*|\d+(-\d+)?)(\/\d+)?(,\d+(-\d+)?)*$/, `${line}: field ${field}`);
      assert.ok(field.split(/[^\d]+/).filter(Boolean).every((n) => Number(n) <= max), `${line}: ${field} > ${max}`);
    }
    assert.match(line, /\broot\s+cd \/opt\/hintek-workflow\/production && /, line);
  }
  assert.ok(lines.some((line) => /^\*\/5 \* \* \* \*\s+root .*monitor\.sh/.test(line)), "monitor.sh every five minutes");
  // No job in the hour that is skipped in March or repeated in October (02:00–02:59 Swedish time).
  for (const line of lines) assert.notEqual(line.split(/\s+/)[1], "2", `${line} runs in the daylight-saving hour`);
});
