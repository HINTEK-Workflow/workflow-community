// Serverjobb (2026-11-14): every scheduled job that runs in the app goes through here (package.json:
// "<job>": "tsx scripts/ops/job.ts <job> <script>"), from cron's run-job.sh and from Kör nu alike. A paused job is recorded
// and ends with exit 0; a job another run holds ends with exit 0; otherwise the script runs unchanged in a child process –
// the same arguments, output and exit code – and its status, duration and last line are kept (lib/ops/job-control.ts).
// A dry run (--dry-run) is passed straight through: it changes nothing and is not recorded.
// Run: npm run <job> [-- --dry-run]
import "dotenv/config";
import { spawn } from "node:child_process";
import { prisma } from "../../lib/db";
import { prismaJobStore, runControlledJob } from "../../lib/ops/job-control";
import { isControlledJob } from "../../lib/ops/server-jobs";

const SCRIPT = /^(ee\/)?scripts\/[a-z0-9/-]+\.ts$/;
const KEEP = 8_192;

function runScript(script: string, args: string[], capture: boolean) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    // The same loader as this process (tsx's own flags in execArgv), so the script runs exactly as "tsx <script>" did.
    const child = spawn(process.execPath, [...process.execArgv, script, ...args], { stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit", env: process.env });
    let stdout = "", stderr = "";
    const keep = (text: string, chunk: Buffer) => (text + chunk.toString("utf8")).slice(-KEEP);
    child.stdout?.on("data", (chunk: Buffer) => { process.stdout.write(chunk); stdout = keep(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { process.stderr.write(chunk); stderr = keep(stderr, chunk); });
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on("close", (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr }));
  });
}

async function main() {
  const [key, script, ...args] = process.argv.slice(2);
  if (!key || !isControlledJob(key) || !script || !SCRIPT.test(script)) {
    console.error("Användning: tsx scripts/ops/job.ts <jobb> <skript> [--dry-run]");
    return 2;
  }
  if (args.includes("--dry-run")) return (await runScript(script, args, false)).code;
  const result = await runControlledJob(key, () => runScript(script, args, true), prismaJobStore(prisma), { trigger: process.env.WORKFLOW_JOB_TRIGGER });
  return result.code;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => undefined));
