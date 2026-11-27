import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { INSTANCE_DEFAULTS } from "@/lib/instance-defaults";
import { HOST_NAME_PATTERN, HOST_STATUS_MAX_BYTES, parseHostStatus, serverPendingNotices, serverUpdateNotices, serverViews, type HostStatus, type ServerView } from "@/lib/ops/host-status";
import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * Serveruppdateringar (2026-10-25): reads the servers' status files, read-only. Two folders: the app server's own,
 * mounted read-only into the container (HOST_STATUS_DIR, docker-compose.yml), and the database server's in the storage
 * (STORAGE_ROOT/.host-status, written by the database server's root straight into the NFS share). Only regular files named
 * <server>.json whose server name matches the file are read; nothing is ever written, run or followed further.
 */
export const HOST_STATUS_STORAGE_FOLDER = ".host-status";
const MAX_FILES_PER_FOLDER = 10;

export function hostStatusFolders() {
  return [path.resolve(env.HOST_STATUS_DIR), path.resolve(env.STORAGE_ROOT, HOST_STATUS_STORAGE_FOLDER)];
}

export async function readHostStatusFolder(folder: string): Promise<HostStatus[]> {
  let entries: string[];
  try { entries = await readdir(folder); } catch { return []; }
  const files = entries.filter((name) => name.endsWith(".json") && HOST_NAME_PATTERN.test(name.slice(0, -5))).sort().slice(0, MAX_FILES_PER_FOLDER);
  const found: HostStatus[] = [];
  for (const name of files) {
    const file = path.join(folder, name);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.size > HOST_STATUS_MAX_BYTES) continue;
      const status = parseHostStatus(await readFile(file, "utf8"));
      if (status && status.host === name.slice(0, -5)) found.push(status);
    } catch { /* a file that cannot be read is no status */ }
  }
  return found;
}

/** Every server's card, in the installation's order (lib/instance-defaults.ts serverStatusHosts), then the others. */
export async function readServerViews(now = new Date()): Promise<ServerView[]> {
  const statuses = (await Promise.all(hostStatusFolders().map(readHostStatusFolder))).flat();
  return serverViews(INSTANCE_DEFAULTS.serverStatusHosts, statuses, now);
}

/**
 * The superadmin's notices about the servers: security updates or a restart waiting > 3 days, automatic updates off, and
 * (the bell only, 2026-11-06) updates or a restart waiting at all – `pending: false` for mail and push, which keep
 * to the alerts.
 */
export async function serverUpdateNoticeList(now = new Date(), options: { pending?: boolean } = {}): Promise<TaskNotification[]> {
  try {
    const views = await readServerViews(now);
    return [...serverUpdateNotices(views), ...(options.pending === false ? [] : serverPendingNotices(views))];
  } catch { return []; }
}
