import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/kfid/server";
import { BACKUP_LIST_FILE, BACKUP_LIST_MAX_BYTES, parseBackupList, type BackupList } from "@/lib/ops/backup-list";
import { HOST_STATUS_STORAGE_FOLDER, hostStatusFolders, readHostStatusFolder } from "@/lib/ops/host-status-server";
import {
  isControlledJob, MONITOR_THRESHOLDS, nextCronRun, runRequestAllowed, scheduleText, serverJob, SERVER_JOBS,
  type ServerJobPlace, type ServerJobStatus,
} from "@/lib/ops/server-jobs";

/**
 * Serverjobb (2026-11-14): what Installation → Drift och säkerhet → Serverjobb shows, and its two actions.
 * Pausa/Starta and Kör nu only for the jobs that run in the app (lib/ops/server-jobs.ts); the host's and the database
 * server's jobs are read from the status files their root writes, read-only. Kör nu starts the job's own npm script from the
 * fixed list – never a command from the request – detached in the app server, and returns at once; the job's control
 * (scripts/ops/job.ts) records the run.
 */
export type ServerJobView = {
  key: string; name: string; description: string; place: ServerJobPlace; schedule: string; confirm: boolean; controllable: boolean;
  nextRunAt: string | null; paused: boolean; pausedAt: string | null; running: boolean; requestedAt: string | null;
  last: { status: ServerJobStatus | null; startedAt: string | null; finishedAt: string | null; message: string | null; durationMs: number | null; trigger: string | null } | null;
};

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

/** The backup list in the storage's .host-status/, or null when there is none (not installed yet) or it is not a list. */
export async function readBackupList(): Promise<BackupList | null> {
  const file = path.resolve(env.STORAGE_ROOT, HOST_STATUS_STORAGE_FOLDER, BACKUP_LIST_FILE);
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > BACKUP_LIST_MAX_BYTES) return null;
    return parseBackupList(await readFile(file, "utf8"));
  } catch { return null; }
}

export async function readServerJobs(now = new Date()) {
  const [rows, backups, appHost, dbHost] = await Promise.all([
    prisma.serverJob.findMany(),
    readBackupList(),
    readHostStatusFolder(hostStatusFolders()[0]).catch(() => []),
    readHostStatusFolder(hostStatusFolders()[1]).catch(() => []),
  ]);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const newest = (list: { generatedAt: string }[]) => list.map((status) => status.generatedAt).sort().pop() ?? null;
  const fileRun = (at: string | null): ServerJobView["last"] => (at ? { status: "ok", startedAt: at, finishedAt: at, message: null, durationMs: null, trigger: null } : null);
  const statusRun = (status: BackupList["status"]["db.daily"]): ServerJobView["last"] => (status ? {
    status: status.result === "ok" ? "ok" : "failed", startedAt: status.time, finishedAt: status.time,
    message: status.result === "ok" ? null : `Misslyckades${status.step ? ` vid ${status.step}` : ""}.`, durationMs: null, trigger: null,
  } : null);
  const newestOf = (...items: (ServerJobView["last"])[]) => items.filter(Boolean).sort((a, b) => (b!.finishedAt ?? "").localeCompare(a!.finishedAt ?? ""))[0] ?? null;
  const jobs: ServerJobView[] = SERVER_JOBS.map((job) => {
    const row = byKey.get(job.key);
    const controllable = job.place === "app";
    let last: ServerJobView["last"] = null;
    if (controllable && row?.lastStatus) last = { status: row.lastStatus as ServerJobStatus, startedAt: iso(row.lastStartedAt), finishedAt: iso(row.lastFinishedAt), message: row.lastMessage, durationMs: row.lastDurationMs, trigger: row.lastTrigger };
    else if (job.key === "host-status") last = fileRun(newest(appHost));
    else if (job.key === "db-host-status") last = fileRun(newest(dbHost));
    else if (job.key === "db-backup") last = statusRun(backups?.status["db.daily"] ?? null);
    else if (job.key === "files-backup") last = statusRun(backups?.status["files.daily"] ?? null);
    else if (job.key === "offsite") last = statusRun(backups?.status.offsite ?? null);
    else if (job.key === "predeploy") last = newestOf(statusRun(backups?.status["db.predeploy"] ?? null), statusRun(backups?.status["files.predeploy"] ?? null));
    const running = Boolean(controllable && row?.lockedUntil && row.lockedUntil.getTime() > now.getTime());
    return {
      key: job.key, name: job.name, description: job.description, place: job.place, schedule: scheduleText(job.cron, job.scheduleNote),
      confirm: Boolean(job.confirm), controllable, nextRunAt: controllable && row?.paused ? null : iso(nextCronRun(job.cron, now)),
      paused: Boolean(controllable && row?.paused), pausedAt: controllable ? iso(row?.pausedAt) : null, running,
      requestedAt: controllable ? iso(row?.runRequestedAt) : null,
      last: running && last ? { ...last, status: "running" } : last,
    };
  });
  return { jobs, backups, thresholds: MONITOR_THRESHOLDS, readAt: now.toISOString() };
}

export async function setJobPaused(input: { key: string; paused: boolean; actorId: string; organizationId: string }) {
  const job = serverJob(input.key);
  if (!job || !isControlledJob(job.key)) throw new ApiError(400, "Jobbet kan inte pausas från appen.");
  await prisma.serverJob.upsert({
    where: { key: job.key },
    create: { key: job.key, paused: input.paused, pausedAt: input.paused ? new Date() : null, pausedById: input.paused ? input.actorId : null },
    update: { paused: input.paused, pausedAt: input.paused ? new Date() : null, pausedById: input.paused ? input.actorId : null },
  });
  await prisma.administrationEvent.create({ data: {
    actorId: input.actorId, organizationId: input.organizationId, action: input.paused ? "server_job_pause" : "server_job_resume",
    detail: `${input.paused ? "Pausade" : "Startade"} serverjobbet ${job.name} (${job.key}).`,
  } });
}

/** Starts the job's npm script from the fixed list, detached; the job's own control takes the lease and records the run. */
export function startJobProcess(key: string) {
  if (!isControlledJob(key)) throw new ApiError(400, "Jobbet kan inte startas från appen.");
  const child = spawn("npm", ["run", "--silent", key], {
    cwd: process.cwd(), detached: true, stdio: "ignore", shell: process.platform === "win32",
    env: { ...process.env, WORKFLOW_JOB_TRIGGER: "manual" },
  });
  child.on("error", (error) => console.error("server job start failed", key, error.name));
  child.unref();
}

export async function requestJobRun(input: { key: string; actorId: string; organizationId: string }, start: (key: string) => void = startJobProcess, now = new Date()) {
  const job = serverJob(input.key);
  if (!job) throw new ApiError(400, "Okänt jobb.");
  const row = await prisma.serverJob.findUnique({ where: { key: job.key } });
  const check = runRequestAllowed(job.key, row, now);
  if (!check.ok) throw new ApiError(409, check.message);
  // One request at a time: the row is claimed for the request only when nobody else just claimed it.
  await prisma.serverJob.createMany({ data: [{ key: job.key }], skipDuplicates: true });
  const claimed = await prisma.serverJob.updateMany({
    where: { key: job.key, paused: false, runRequestedAt: row?.runRequestedAt ?? null },
    data: { runRequestedAt: now, runRequestedById: input.actorId },
  });
  if (claimed.count !== 1) throw new ApiError(409, "Jobbet startas redan. Vänta en stund.");
  start(job.key);
  await prisma.administrationEvent.create({ data: {
    actorId: input.actorId, organizationId: input.organizationId, action: "server_job_run", detail: `Körde serverjobbet ${job.name} (${job.key}) nu.`,
  } });
  return { ok: true, requestedAt: now.toISOString() };
}
