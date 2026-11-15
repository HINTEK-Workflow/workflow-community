import { z } from "zod";
import { swedishDayKey } from "@/lib/swedish-time";
import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * Serveruppdateringar (2026-10-25: "Detta vill jag även kunna veta från prodadmin. Jag har inget bra sätt att se och
 * uppdatera om det kommer nya patchar för servrarna."): the status file root's cron writes on each server
 * (scripts/ops/host-status.sh, schema 1) read and judged for Installation → Drift och säkerhet → Servrar och
 * uppdateringar. The app only reads the file; installing and restarting are done by a person with the runbook
 *, and the page shows the exact commands. Pure, so the tests read the same rules.
 */

/** A status older than this is no fresh status (the cron writes every hour; a day and a little more is allowed). */
export const HOST_STATUS_STALE_HOURS = 26;
/** Security updates or a restart that waited longer than this give the superadmin a notice; automatic updates off at once. */
export const HOST_STATUS_ALERT_DAYS = 3;
/** The package lists apt counts from: older than this and the numbers may be too low. */
export const HOST_STATUS_LISTS_OLD_DAYS = 2;
/** A file larger than this is not a status file (the script writes about 1–8 kB). */
export const HOST_STATUS_MAX_BYTES = 64 * 1024;
export const HOST_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

const when = z.string().max(40).nullable().catch(null).transform((value) => (value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null));
const text = (max: number) => z.string().max(max).nullable().catch(null);
const flag = z.boolean().catch(false);
const count = z.number().int().min(0).max(100_000).catch(0);
const names = (max: number) => z.array(z.string()).catch([]).transform((list) => list.filter((name) => /^[A-Za-z0-9.+:~_-]{1,120}$/.test(name)).slice(0, max));

export const hostStatusSchema = z.object({
  schema: z.literal(1),
  host: z.string().regex(HOST_NAME_PATTERN),
  generatedAt: z.string().max(40).refine((value) => Number.isFinite(Date.parse(value))).transform((value) => new Date(value).toISOString()),
  os: text(120).default(null),
  kernel: z.object({ running: text(120).default(null), newestInstalled: text(120).default(null), newerInstalled: flag.default(false) }).catch({ running: null, newestInstalled: null, newerInstalled: false }),
  uptimeSeconds: z.number().int().min(0).nullable().catch(null).default(null),
  updates: z.object({
    listOk: flag.default(false), pending: count.default(0), security: count.default(0),
    securityPackages: names(100).default([]), packages: names(200).default([]),
    securitySince: when.default(null), listsUpdatedAt: when.default(null), listsRefresh: z.enum(["ok", "failed"]).nullable().catch(null).default(null),
  }).catch({ listOk: false, pending: 0, security: 0, securityPackages: [], packages: [], securitySince: null, listsUpdatedAt: null, listsRefresh: null }),
  reboot: z.object({ required: flag.default(false), since: when.default(null), packages: names(50).default([]) }).catch({ required: false, since: null, packages: [] }),
  automatic: z.object({
    effective: flag.default(false), enable: text(20).default(null), updatePackageLists: text(20).default(null), unattendedUpgrade: text(20).default(null),
    unattendedInstalled: flag.default(false), timer: text(20).default(null), zeroFiles: names(20).default([]), offSince: when.default(null),
  }).catch({ effective: false, enable: null, updatePackageLists: null, unattendedUpgrade: null, unattendedInstalled: false, timer: null, zeroFiles: [], offSince: null }),
  apt: z.object({ updateSuccess: when.default(null), update: when.default(null), downloadUpgradeable: when.default(null), upgrade: when.default(null), unattendedUpgrades: when.default(null) })
    .catch({ updateSuccess: null, update: null, downloadUpgradeable: null, upgrade: null, unattendedUpgrades: null }),
});
export type HostStatus = z.infer<typeof hostStatusSchema>;

/** The file's text as a status, or null when it is not one (wrong schema, no host or time, too large, not JSON). */
export function parseHostStatus(raw: string): HostStatus | null {
  if (raw.length > HOST_STATUS_MAX_BYTES) return null;
  try {
    const parsed = hostStatusSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type ServerBadge = "SECURITY" | "REBOOT" | "AUTO_OFF" | "PENDING" | "UPDATED" | "STALE";
export const SERVER_BADGE_LABEL: Record<ServerBadge, string> = {
  SECURITY: "Säkerhetsuppdateringar väntar",
  REBOOT: "Omstart krävs",
  AUTO_OFF: "Automatiska uppdateringar avstängda",
  PENDING: "Uppdateringar väntar",
  UPDATED: "Uppdaterad",
  STALE: "Ingen färsk status",
};
export const SERVER_BADGE_TONE: Record<ServerBadge, "success" | "warning" | "danger" | "neutral"> = {
  SECURITY: "danger", REBOOT: "warning", AUTO_OFF: "danger", PENDING: "warning", UPDATED: "success", STALE: "neutral",
};

/** Packages worth naming first among the security updates: the kernel, then what guards the server's doors and data. */
const IMPORTANT = [/^linux-(image|headers|modules|generic|virtual|kvm|aws|azure|gcp|oracle)/, /^(openssl|libssl)/, /^openssh/, /^(libc6|libc-bin)$/, /^sudo/, /^systemd/, /^postgresql/, /^nfs-(kernel-server|common)$/, /^(docker|containerd|runc)/, /^nginx/, /^(curl|libcurl)/, /^(libgnutls|gnutls)/, /^(libpam|polkit|policykit)/, /^(xz-utils|liblzma)/, /^ca-certificates$/];
export function importantPackages(packages: readonly string[], max = 6): string[] {
  const rank = (name: string) => IMPORTANT.findIndex((pattern) => pattern.test(name));
  return packages.filter((name) => rank(name) >= 0).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, max);
}

export type ServerAlert = { kind: "security" | "reboot" | "auto-off"; since: string; days: number };
export type ServerView = {
  host: string;
  /** The status file as read, or null when there is none. */
  status: HostStatus | null;
  fresh: boolean;
  ageHours: number | null;
  /** The badges in order: the first is the card's main state. */
  badges: ServerBadge[];
  rebootNeeded: boolean;
  important: string[];
  listsOld: boolean;
  alerts: ServerAlert[];
};

const daysSince = (iso: string | null, now: Date) => (iso ? Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000) : 0);

/** One server's card: fresh or not, the badges, the important packages and the alerts that are due. */
export function evaluateHostStatus(host: string, status: HostStatus | null, now = new Date()): ServerView {
  if (!status) return { host, status: null, fresh: false, ageHours: null, badges: ["STALE"], rebootNeeded: false, important: [], listsOld: false, alerts: [] };
  const ageHours = Math.max(0, Math.floor((now.getTime() - Date.parse(status.generatedAt)) / 3_600_000));
  const fresh = ageHours <= HOST_STATUS_STALE_HOURS && Date.parse(status.generatedAt) <= now.getTime() + 3_600_000;
  const rebootNeeded = status.reboot.required || status.kernel.newerInstalled;
  const important = importantPackages(status.updates.securityPackages);
  const listsOld = Boolean(status.updates.listsUpdatedAt) && daysSince(status.updates.listsUpdatedAt, now) >= HOST_STATUS_LISTS_OLD_DAYS;
  const badges: ServerBadge[] = [];
  if (!fresh) badges.push("STALE");
  else {
    if (status.updates.security > 0) badges.push("SECURITY");
    if (rebootNeeded) badges.push("REBOOT");
    if (!status.automatic.effective) badges.push("AUTO_OFF");
    if (status.updates.pending > status.updates.security) badges.push("PENDING");
    if (!badges.length) badges.push("UPDATED");
  }
  const alerts: ServerAlert[] = [];
  if (fresh) {
    const firstSeen = (since: string | null) => since ?? status.generatedAt;
    if (status.updates.security > 0) {
      const since = firstSeen(status.updates.securitySince);
      if (daysSince(since, now) > HOST_STATUS_ALERT_DAYS) alerts.push({ kind: "security", since, days: daysSince(since, now) });
    }
    if (rebootNeeded) {
      const since = firstSeen(status.reboot.since);
      if (daysSince(since, now) > HOST_STATUS_ALERT_DAYS) alerts.push({ kind: "reboot", since, days: daysSince(since, now) });
    }
    if (!status.automatic.effective) {
      const since = firstSeen(status.automatic.offSince);
      alerts.push({ kind: "auto-off", since, days: daysSince(since, now) });
    }
  }
  return { host, status, fresh, ageHours, badges, rebootNeeded, important, listsOld, alerts };
}

/**
 * The cards in order: the servers this installation expects (from the instance defaults, so a missing file shows as
 * Ingen färsk status), then any other server that wrote a file. One status per server: the newest.
 */
export function serverViews(expected: readonly string[], statuses: readonly HostStatus[], now = new Date()): ServerView[] {
  const newest = new Map<string, HostStatus>();
  for (const status of statuses) {
    const known = newest.get(status.host);
    if (!known || Date.parse(status.generatedAt) > Date.parse(known.generatedAt)) newest.set(status.host, status);
  }
  const hosts = [...expected.filter((host) => HOST_NAME_PATTERN.test(host)), ...[...newest.keys()].filter((host) => !expected.includes(host)).sort()];
  return [...new Set(hosts)].map((host) => evaluateHostStatus(host, newest.get(host) ?? null, now));
}

const ALERT_TITLE: Record<ServerAlert["kind"], string> = {
  security: "säkerhetsuppdateringar väntar",
  reboot: "omstart krävs",
  "auto-off": "automatiska uppdateringar avstängda",
};
export const SERVER_UPDATES_HREF = "/?view=login_settings&section=servers";

/**
 * The bell's notices for the superadmin (and what notices:send mails or pushes to one who chose the kind): one per server
 * and state. The id carries the day the state began, so the same state is one notice – told once per channel – and a new
 * state (updated, then new security updates) is a new one.
 */
export function serverUpdateNotices(views: readonly ServerView[]): TaskNotification[] {
  return views.flatMap((view) => view.alerts.map((alert): TaskNotification => {
    const day = swedishDayKey(new Date(alert.since));
    const status = view.status!;
    const detail = alert.kind === "security"
      ? `${status.updates.security} ${status.updates.security === 1 ? "säkerhetsuppdatering" : "säkerhetsuppdateringar"} sedan ${day}${view.important.length ? ` (bl.a. ${view.important.slice(0, 3).join(", ")})` : ""}.`
      : alert.kind === "reboot" ? `Omstart har krävts sedan ${day}${status.kernel.newerInstalled ? " – en nyare kärna är installerad" : ""}.`
        : `De automatiska säkerhetsuppdateringarna är avstängda${status.automatic.zeroFiles.length ? ` av ${status.automatic.zeroFiles.join(", ")}` : ""}.`;
    return {
      id: `SERVER_UPDATES:${view.host}:${alert.kind}:${day}`, title: `${view.host}: ${ALERT_TITLE[alert.kind]}`, kind: "SERVER_UPDATES",
      detail: `${detail} Se Drift och säkerhet → Servrar och uppdateringar.`, href: SERVER_UPDATES_HREF, dueDate: day, deadline: null, needsAction: true,
    };
  }));
}

/**
 * Driftlarm om servrarna (2026-10-26: "driftlarm, server, nycklar som går ut osv – sådant måste jag veta"): the lines
 * the daily keys:alerts mails to the operations address while they last – the same states as the notices (security
 * updates or a restart waiting more than three days, automatic updates off) and every expected server without a fresh
 * status (the hourly cron has stopped, or was never installed). Empty when all is well.
 */
/** What to do when a server has no fresh status: one sentence everywhere. */
export const STALE_ADVICE = "Kontrollera att statusjobbet på servern går.";
export function serverAlarmLines(views: readonly ServerView[]): string[] {
  // The same plain words as the card and the bell (kundresa 2026-11-07, L71: developer language and a file path).
  const stale = views.filter((view) => !view.fresh).map((view) => `${serverStaleText(view)}. ${STALE_ADVICE}`);
  return [...serverUpdateNotices(views).map((notice) => `${notice.title}. ${notice.detail}`), ...stale];
}

/** Who may read the servers' status: the superadmin only (the server checks it on every call). */
export type ServerStatusAccess = { ok: true } | { ok: false; status: 401 | 403; message: string };
export function serverStatusAccess(user: { role?: string | null } | null | undefined): ServerStatusAccess {
  if (!user) return { ok: false, status: 401, message: "Logga in för att fortsätta." };
  if (user.role !== "SUPERADMIN") return { ok: false, status: 403, message: "Bara installationens administratör kan göra det." };
  return { ok: true };
}

/** The file that turns the automatic updates back on after a provider's file (sorted after 99-hostup-…, so it wins). */
export const ENABLE_AUTOMATIC_FILE = "/etc/apt/apt.conf.d/99z-hintek-enable-automatic-apt";
export const ENABLE_AUTOMATIC_LINES = ['APT::Periodic::Update-Package-Lists "1";', 'APT::Periodic::Unattended-Upgrade "1";', 'APT::Periodic::Enable "1";'];

export type CommandStep = { label: string; command: string };
/**
 * Kommandon för hand: the exact commands. The first from PowerShell on the administrator's computer, the rest on the server. The
 * database server first, then the app server (CLAUDE.md: backup and a check that it can be read before every change on
 * the app server; docs/drift/SERVERUPPDATERINGAR.md).
 */
export function updateCommands(host: string, commands: Readonly<Record<string, string>> = {}): CommandStep[] {
  const reread = commands[host] ?? `sudo HOST_LABEL=${host} OUT_DIR=./host-status scripts/ops/host-status.sh`;
  return [
    { label: "Logga in på servern (PowerShell)", command: `ssh ${host}` },
    { label: "Se vad som väntar", command: "sudo apt update && apt list --upgradable" },
    { label: "Installera", command: "sudo apt update && sudo apt full-upgrade -y" },
    { label: "Krävs omstart?", command: "cat /var/run/reboot-required.pkgs 2>/dev/null || echo 'Ingen omstart krävs'" },
    { label: "Starta om (bara vid behov)", command: "sudo systemctl reboot" },
    { label: "Slå på automatiska uppdateringar (när de är avstängda)", command: [`sudo tee ${ENABLE_AUTOMATIC_FILE} <<'EOF'`, ...ENABLE_AUTOMATIC_LINES, "EOF", "apt-config dump | grep -E 'APT::Periodic::(Enable|Update-Package-Lists|Unattended-Upgrade) '"].join("\n") },
    { label: "Läs statusen igen", command: reread },
  ];
}

/** "12 d 3 h" for the uptime; null when unknown. */
export function uptimeText(seconds: number | null): string | null {
  if (seconds === null) return null;
  const days = Math.floor(seconds / 86_400), hours = Math.floor((seconds % 86_400) / 3_600);
  return days ? `${days} d ${hours} h` : hours ? `${hours} h ${Math.floor((seconds % 3_600) / 60)} min` : `${Math.floor(seconds / 60)} min`;
}

/**
 * Uppdateringar väntar (2026-11-06: "en notis … som påminner varje gång att det finns uppdatering"): a quieter notice in
 * the bell, beside the alerts above, as soon as a fresh status has updates or a restart waiting – one per server and state.
 * The state is the set of security packages, whether other updates wait and whether a restart is needed, so new security
 * updates give a new notice and the same state stays one. Never mailed (the ops mail already has the alerts above).
 */
export const SERVER_PENDING_KIND = "pending";
export function serverPendingState(view: ServerView): string | null {
  const status = view.status;
  if (!view.fresh || !status || (status.updates.pending <= 0 && !view.rebootNeeded)) return null;
  const text = [status.updates.security, [...status.updates.securityPackages].sort().join(","), status.updates.pending > status.updates.security ? "o" : "", view.rebootNeeded ? "r" : ""].join("|");
  // FNV-1a, 32 bits: short and stable, enough to tell two states of one server apart.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

/** "drift: 12 uppdateringar (3 säkerhet, omstart krävs)" – what waits on one server, or null when nothing does (kundresa 2026-11-07, M45). */
export function serverPendingText(view: ServerView): string | null {
  if (!serverPendingState(view)) return null;
  const status = view.status!;
  const extra = [status.updates.security ? `${status.updates.security} säkerhet` : "", view.rebootNeeded ? "omstart krävs" : ""].filter(Boolean).join(", ");
  if (!status.updates.pending) return `${view.host}: omstart krävs`;
  return `${view.host}: ${status.updates.pending} ${status.updates.pending === 1 ? "uppdatering" : "uppdateringar"}${extra ? ` (${extra})` : ""}`;
}

/** "databas: ingen färsk status" – a server whose state is not known (no status, or one older than the limit), or null. */
export function serverStaleText(view: ServerView): string | null {
  return view.fresh ? null : `${view.host}: ${view.status ? `ingen färsk status (${view.ageHours} h gammal)` : "ingen status"}`;
}

export function serverPendingNotices(views: readonly ServerView[]): TaskNotification[] {
  return views.flatMap((view): TaskNotification[] => {
    // A server whose status stopped coming is told too (kundresa 2026-11-07, M45: the reminder went quiet then), once per last
    // status. A server that never had a status (the job not installed, as on a test machine) is shown on the page and in the
    // morning ops mail only – a bell and a toast on every sign-in would cover the page without saying anything new (N3 2026-11-07).
    if (!view.fresh) {
      if (!view.status) return [];
      const last = swedishDayKey(new Date(view.status.generatedAt));
      return [{
        id: `SERVER_UPDATES:${view.host}:stale:${last}`, title: `${view.host}: läget är okänt`, kind: "SERVER_UPDATES",
        detail: `${serverStaleText(view)}. ${STALE_ADVICE}`, href: SERVER_UPDATES_HREF,
        dueDate: last, deadline: null, needsAction: true,
      }];
    }
    const state = serverPendingState(view);
    if (!state) return [];
    const status = view.status!;
    const since = status.updates.securitySince ?? status.reboot.since ?? status.generatedAt;
    return [{
      id: `SERVER_UPDATES:${view.host}:${SERVER_PENDING_KIND}:${state}`, title: `${view.host}: uppdateringar väntar`, kind: "SERVER_UPDATES",
      detail: `Väntar: ${serverPendingText(view)}. Se Drift och säkerhet → Servrar och uppdateringar.`, href: SERVER_UPDATES_HREF,
      dueDate: swedishDayKey(new Date(since)), deadline: null, needsAction: true,
    }];
  });
}

/**
 * The toast after signing in (2026-11-06): one line for every server with something waiting, or null. A server whose
 * state is unknown is named too (kundresa 2026-11-07, M45), so the reminder never goes quiet only because the status stopped.
 */
export function serverUpdateToastText(views: readonly ServerView[]): string | null {
  const parts = views.map(serverPendingText).filter((part): part is string => Boolean(part));
  // Only a status that stopped coming; a server that never had one is not news at every sign-in (see serverPendingNotices).
  const unknown = views.filter((view) => view.status).map(serverStaleText).filter((part): part is string => Boolean(part));
  const lines = [parts.length ? `Serveruppdateringar väntar: ${parts.join(", ")}.` : "", unknown.length ? `Läget är okänt för ${unknown.join(", ")}.` : ""].filter(Boolean);
  return lines.length ? lines.join(" ") : null;
}

/**
 * Whether the toast is shown: the superadmin only (not while previewing another role), something waits, and this sign-in has
 * not had it closed yet. `login` is the sign-in's own time (a new sign-in shows it again); `closed` is what this browser
 * remembers as closed.
 */
export function serverToastDue(input: { role?: string | null; viewAs?: string | null; text: string | null; login: string | null; closed: string | null }): boolean {
  if (input.role !== "SUPERADMIN" || input.viewAs || !input.text || !input.login) return false;
  return input.closed !== input.login;
}

/**
 * Uppdatera servrarna med ett klick (2026-11-06): the links to a handler on the administrator's own computer, as the
 * page gets them. Only Workflow's installation has one (ee/ops/server-ops.ts); the core shows what it is given, runs nothing.
 */
export type ServerOneClick = { updateAll: string; restart: Record<string, string>; install: string };
