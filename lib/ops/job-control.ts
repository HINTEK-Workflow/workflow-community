import { randomUUID } from "node:crypto";
import { JOB_HEARTBEAT_MS, JOB_LEASE_MS, jobMessage, type ServerJobStatus } from "@/lib/ops/server-jobs";

/**
 * Serverjobb (2026-11-14): the control around every job the app server's cron runs in the app (scripts/ops/job.ts).
 * Before the job: a paused job is recorded as skipped and ends with exit 0 (so run-job.sh writes its success marker and
 * monitor.sh never raises a false alarm); a job another run holds ends with exit 0 too, like run-job.sh's own flock. While it
 * runs: a lease in the job's row, renewed every minute, so Kör nu and cron never run the same job twice at once (cron's
 * flock is the host's only). After: the status, the duration and the last output line. The job itself is unchanged – the same
 * script, arguments, output and exit code. The store is passed in, so the tests use a fake one; the app's is prismaJobStore.
 */
export type ClaimResult = { claimed: true } | { claimed: false; reason: "paused" | "busy" };
export type JobStore = {
  claim(key: string, runId: string, now: Date, leaseUntil: Date, trigger: string): Promise<ClaimResult>;
  renew(key: string, runId: string, leaseUntil: Date): Promise<void>;
  finish(key: string, runId: string, result: { status: ServerJobStatus; message: string | null; finishedAt: Date; durationMs: number }): Promise<void>;
  skipped(key: string, now: Date, trigger: string): Promise<void>;
};
export type JobRun = () => Promise<{ code: number; stdout: string; stderr: string }>;
export type ControlledResult = { code: number; outcome: "ran" | "paused" | "busy" | "uncontrolled" };

export const PAUSED_LINE = (key: string) => `${key} – pausat under Installation → Drift och säkerhet; kördes inte`;
export const BUSY_LINE = (key: string) => `${key} – körs redan; den här körningen hoppas över`;

export async function runControlledJob(key: string, run: JobRun, store: JobStore, options: { trigger?: string; now?: () => Date; log?: (line: string) => void; warn?: (line: string) => void } = {}): Promise<ControlledResult> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((line: string) => console.log(line));
  const warn = options.warn ?? ((line: string) => console.error(line));
  const trigger = options.trigger === "manual" ? "manual" : "cron";
  const runId = randomUUID();
  let claim: ClaimResult;
  try {
    const at = now();
    claim = await store.claim(key, runId, at, new Date(at.getTime() + JOB_LEASE_MS), trigger);
  } catch (error) {
    // The control must never stop a job that worked before it (a database not yet migrated, a short outage): it runs as before.
    warn(`${key} – jobbets status kunde inte läsas (${error instanceof Error ? error.name : "fel"}); jobbet körs utan styrning`);
    const result = await run();
    return { code: result.code, outcome: "uncontrolled" };
  }
  if (!claim.claimed) {
    if (claim.reason === "paused") {
      await store.skipped(key, now(), trigger).catch(() => undefined);
      log(PAUSED_LINE(key));
      return { code: 0, outcome: "paused" };
    }
    log(BUSY_LINE(key));
    return { code: 0, outcome: "busy" };
  }
  const started = now().getTime();
  const heartbeat = setInterval(() => { void store.renew(key, runId, new Date(now().getTime() + JOB_LEASE_MS)).catch(() => undefined); }, JOB_HEARTBEAT_MS);
  heartbeat.unref?.();
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await run();
  } catch (error) {
    result = { code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  } finally {
    clearInterval(heartbeat);
  }
  const ok = result.code === 0;
  const message = ok ? jobMessage(result.stdout) : jobMessage(result.stderr) ?? jobMessage(result.stdout) ?? `Avslutades med kod ${result.code}.`;
  await store.finish(key, runId, { status: ok ? "ok" : "failed", message, finishedAt: now(), durationMs: Math.max(0, now().getTime() - started) })
    .catch((error) => warn(`${key} – resultatet kunde inte sparas (${error instanceof Error ? error.name : "fel"})`));
  return { code: result.code, outcome: "ran" };
}

type JobClient = {
  serverJob: {
    createMany(args: { data: { key: string }[]; skipDuplicates: boolean }): Promise<unknown>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    findUnique(args: { where: { key: string } }): Promise<{ paused: boolean } | null>;
  };
};

/** The store in the app's database: one row per job, the lease taken with one conditional update. */
export function prismaJobStore(client: JobClient): JobStore {
  return {
    async claim(key, runId, at, leaseUntil, trigger) {
      // INSERT … ON CONFLICT DO NOTHING: two first runs at the same moment both find the row.
      await client.serverJob.createMany({ data: [{ key }], skipDuplicates: true });
      const taken = await client.serverJob.updateMany({
        where: { key, paused: false, OR: [{ lockedUntil: null }, { lockedUntil: { lt: at } }] },
        data: { runId, lockedUntil: leaseUntil, lastStartedAt: at, lastStatus: "running", lastMessage: null, lastDurationMs: null, lastTrigger: trigger },
      });
      if (taken.count === 1) return { claimed: true };
      const row = await client.serverJob.findUnique({ where: { key } });
      return { claimed: false, reason: row?.paused ? "paused" : "busy" };
    },
    async renew(key, runId, leaseUntil) {
      await client.serverJob.updateMany({ where: { key, runId }, data: { lockedUntil: leaseUntil } });
    },
    async finish(key, runId, result) {
      await client.serverJob.updateMany({ where: { key, runId }, data: {
        lockedUntil: null, runId: null, lastStatus: result.status, lastMessage: result.message, lastFinishedAt: result.finishedAt, lastDurationMs: result.durationMs,
      } });
    },
    async skipped(key, at, trigger) {
      // Only when no run holds the job: a run still going keeps its "Pågår".
      await client.serverJob.updateMany({ where: { key, OR: [{ lockedUntil: null }, { lockedUntil: { lt: at } }] }, data: {
        lastStatus: "skipped_paused", lastStartedAt: at, lastFinishedAt: at, lastDurationMs: 0, lastMessage: "Pausat – kördes inte.", lastTrigger: trigger,
      } });
    },
  };
}
