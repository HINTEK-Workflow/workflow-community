import { swedishParts } from "@/lib/swedish-time";

/**
 * Serverjobb (2026-11-14): every scheduled job of the installation, for Installation → Drift och säkerhet.
 * One typed list: the jobs the app server's cron runs in the app (`app`: they can be paused and started from the page), the
 * jobs that run on the app server's host (`host`: the monitor and the status file, shown only) and the database server's
 * (`db`: backups and its status file, shown only – never controllable from the app). The cron expressions are the cron
 * file's own (ops/cron/hintek-workflow; tests/server-jobs.test.ts asserts that they are exactly the same, so they can never
 * drift), the database server's are its systemd timers and cron (tests/hintek-ops.test.ts). Pure, so the tests read the same rules.
 */
export type ServerJobPlace = "app" | "host" | "db";
export type ServerJobDefinition = {
  key: string;
  name: string;
  description: string;
  place: ServerJobPlace;
  /** Five cron fields in the server's time zone (Europe/Stockholm), or null when it runs on another event (before a release). */
  cron: string | null;
  /** Instead of the cron text, when the schedule is not a plain cron line. */
  scheduleNote?: string;
  /** Kör nu asks first: the job sends mail or touches billing or removes data. */
  confirm?: boolean;
};

export const SERVER_JOBS: readonly ServerJobDefinition[] = [
  { key: "monitor", name: "Övervakning", description: "Kontrollerar appen, certifikaten, disken, backuperna och jobben och larmar per e-post.", place: "host", cron: "*/5 * * * *" },
  { key: "ai:digest", name: "Dagsammanställning", description: "Skickar dagens sammanställning till de företag som valt den.", place: "app", cron: "30 1 * * *", confirm: true },
  { key: "keys:alerts", name: "Driftlarm om nycklar och servrar", description: "Larmar om nycklar som går ut och servrar som behöver uppdateras.", place: "app", cron: "45 6 * * *" },
  { key: "secrets:sync", name: "Centrala nycklar", description: "Kontrollerar nycklarna mot nyckelvalvet och larmar vid avvikelser.", place: "app", cron: "*/10 * * * *" },
  { key: "history:retention", name: "Historik och lagringstid", description: "Rensar historik och loggar efter företagens lagringstid.", place: "app", cron: "30 3 * * *", confirm: true },
  { key: "companies:closure", name: "Radering efter avslut", description: "Besked, påminnelser och radering för företag vars avtal har upphört.", place: "app", cron: "15 4 * * *", confirm: true },
  { key: "rounds:reminders", name: "Påminnelser om ronder", description: "Skickar dagens ronder till den som är ansvarig.", place: "app", cron: "0 6 * * *" },
  { key: "billing:email", name: "Fakturamejl", description: "Skickar fakturornas e-post ur kön.", place: "app", cron: "*/10 * * * *", confirm: true },
  { key: "billing:delinquency", name: "Förfallna fakturor", description: "Påminner om och hanterar fakturor som har förfallit.", place: "app", cron: "0 7 * * *", confirm: true },
  { key: "billing:card-retries", name: "Nya kortförsök", description: "Försöker dra kortbetalningar som misslyckades igen.", place: "app", cron: "0 8 * * *", confirm: true },
  { key: "integrity:check", name: "Integritetskontroll", description: "Kontrollerar att data och filer hänger ihop.", place: "app", cron: "0 5 * * 1" },
  { key: "credits:check", name: "Kreditplånböcker", description: "Stämmer av krediternas saldo och larmar om något inte stämmer.", place: "app", cron: "20 5 * * *" },
  { key: "mailings:send", name: "Utskick", description: "Skickar nyhetsbrev och viktig information ur kön.", place: "app", cron: "*/5 * * * *", confirm: true },
  { key: "notices:send", name: "Notiser", description: "Skickar påminnelser per e-post och push till dem som valt det.", place: "app", cron: "*/15 6-19 * * *", confirm: true },
  { key: "register:sync", name: "Artikelregistret", description: "Hämtar ändringar i det gemensamma artikelregistret.", place: "app", cron: "*/10 * * * *" },
  { key: "machine:rules", name: "Maskinregler", description: "Kontrollerar maskinregler som bara tiden avgör.", place: "app", cron: "*/5 * * * *" },
  { key: "machine:alarms", name: "Maskinlarm", description: "Eskalerar maskinlarm och skickar dem per e-post och push.", place: "app", cron: "*/5 * * * *", confirm: true },
  { key: "host-status", name: "Serverstatus, appservern", description: "Skriver appserverns uppdateringar och omstart till Servrar och uppdateringar.", place: "host", cron: "17 * * * *" },
  { key: "maintenance:plans", name: "Underhållsplaner", description: "Fyller på underhållsplanernas arbetsordrar ett år framåt.", place: "app", cron: "40 5 * * *" },
  { key: "schedule:publish", name: "Schemalagda inlägg", description: "Publicerar inlägg och webbsidor när tiden har kommit.", place: "app", cron: "*/5 * * * *", confirm: true },
  { key: "db-backup", name: "Backup av databasen", description: "Krypterad säkerhetskopia av databasen, kontrollerad innan den sparas.", place: "db", cron: "30 2 * * *" },
  { key: "files-backup", name: "Backup av filerna", description: "Krypterad säkerhetskopia av de uppladdade filerna.", place: "db", cron: "40 2 * * *" },
  { key: "offsite", name: "Kopia till annan plats", description: "Kopierar de krypterade backuperna till en annan plats.", place: "db", cron: "30 3 * * *" },
  { key: "predeploy", name: "Backup före släpp", description: "Databas och filer säkerhetskopieras före varje ny version.", place: "db", cron: null, scheduleNote: "före varje släpp" },
  { key: "db-host-status", name: "Serverstatus, databasservern", description: "Skriver databasserverns uppdateringar och backuplistan.", place: "db", cron: "23 * * * *" },
];

/** The jobs the app may pause and start: run in the app container through scripts/ops/job.ts. */
export const CONTROLLED_JOB_KEYS = SERVER_JOBS.filter((job) => job.place === "app").map((job) => job.key);
export const isControlledJob = (key: string) => CONTROLLED_JOB_KEYS.includes(key);
export const serverJob = (key: string) => SERVER_JOBS.find((job) => job.key === key) ?? null;

/**
 * The monitor's limits (scripts/ops/monitor.sh defaults): shown read-only; they are changed on the server. tests assert the
 * numbers are the script's.
 */
export const MONITOR_THRESHOLDS = [
  { key: "BACKUP_MAX_AGE_HOURS", label: "Nattbackupen får vara högst", value: 26, unit: "timmar" },
  { key: "DISK_MAX_PERCENT", label: "Disken med filerna larmar vid", value: 85, unit: "%" },
  { key: "CERT_MIN_DAYS", label: "Certifikaten larmar när de har kvar", value: 14, unit: "dagar" },
  { key: "DB_CERT_MIN_DAYS", label: "Databasserverns certifikat larmar när det har kvar", value: 60, unit: "dagar" },
  { key: "OFFSITE_MAX_AGE_HOURS", label: "Kopian på den andra platsen får vara högst", value: 168, unit: "timmar" },
] as const;

// ---- Cron ----------------------------------------------------------------------------------------------------------

/** The cron file's jobs: run-job.sh <job> lines, monitor.sh and the host status (the @reboot line is not a schedule). */
export function cronFileJobs(text: string): Map<string, string> {
  const jobs = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+root\s+(.*)$/.exec(line.trim());
    if (!match || line.trim().startsWith("#")) continue;
    const [, fields, command] = match;
    const key = /run-job\.sh (\S+)\s*$/.exec(command)?.[1] ?? (/monitor\.sh\b/.test(command) ? "monitor" : /host-status\.sh\b/.test(command) ? "host-status" : null);
    if (key) jobs.set(key, fields.replace(/\s+/g, " "));
  }
  return jobs;
}

type Field = { any: boolean; values: Set<number> };
function parseField(text: string, min: number, max: number): Field | null {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!match) return null;
    const step = match[4] ? Number(match[4]) : 1;
    const from = match[1] === "*" ? min : Number(match[2]);
    const to = match[1] === "*" ? max : match[3] !== undefined ? Number(match[3]) : match[4] ? max : from;
    if (step < 1 || from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return { any: text === "*", values };
}

export type CronSchedule = { minute: Field; hour: Field; day: Field; month: Field; weekday: Field; text: string };
export function parseCron(text: string): CronSchedule | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, day, month, weekday] = [parseField(parts[0], 0, 59), parseField(parts[1], 0, 23), parseField(parts[2], 1, 31), parseField(parts[3], 1, 12), parseField(parts[4], 0, 7)];
  if (!minute || !hour || !day || !month || !weekday) return null;
  if (weekday.values.has(7)) weekday.values.add(0);
  return { minute, hour, day, month, weekday, text: parts.join(" ") };
}

const WEEKDAYS = ["söndagar", "måndagar", "tisdagar", "onsdagar", "torsdagar", "fredagar", "lördagar"];
const pad = (value: number | string) => String(value).padStart(2, "0");
/** "5:e", "2:a", "1:a", "11:e". */
const ordinal = (value: number) => `${value}:${[1, 2].includes(value % 10) && ![11, 12].includes(value % 100) ? "a" : "e"}`;

/** The schedule in plain Swedish: "var 5:e minut", "varje dag 03:30", "måndagar 05:00", "var 15:e minut kl. 06–19". */
export function scheduleText(cron: string | null, note?: string): string {
  if (!cron) return note ?? "–";
  const parts = cron.trim().split(/\s+/);
  const parsed = parseCron(cron);
  if (!parsed) return cron;
  const [minute, hour, day, month, weekday] = parts;
  const step = /^\*\/(\d+)$/.exec(minute);
  const hours = /^(\d+)-(\d+)$/.exec(hour);
  const calendar = day === "*" && month === "*";
  if (!calendar) return cron;
  const days = weekday === "*" ? "varje dag" : /^\d$/.test(weekday) ? WEEKDAYS[Number(weekday) % 7] : null;
  if (!days) return cron;
  if (minute === "*" && hour === "*") return weekday === "*" ? "varje minut" : `${days}, varje minut`;
  if (step && (hour === "*" || hours)) {
    const every = Number(step[1]) === 1 ? "varje minut" : `var ${ordinal(Number(step[1]))} minut`;
    const within = hours ? ` kl. ${pad(hours[1])}–${pad(hours[2])}` : "";
    return weekday === "*" ? `${every}${within}` : `${days}, ${every}${within}`;
  }
  if (/^\d+$/.test(minute) && hour === "*") return `${weekday === "*" ? "varje timme" : `${days}, varje timme`}, ${minute} minuter över`;
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) return `${days} ${pad(hour)}:${pad(minute)}`;
  return cron;
}

const matches = (field: Field, value: number) => field.values.has(value);
/** Cron's own rule: with both day of month and weekday restricted, either one matching is enough. */
function dayMatches(schedule: CronSchedule, day: number, weekday: number) {
  if (schedule.day.any || schedule.weekday.any) return matches(schedule.day, day) && matches(schedule.weekday, weekday);
  return matches(schedule.day, day) || matches(schedule.weekday, weekday);
}

/** The next time the schedule runs after `from`, in Swedish time (the servers' time zone); null when none within 8 days. */
export function nextCronRun(cron: string | null, from = new Date()): Date | null {
  const schedule = cron ? parseCron(cron) : null;
  if (!schedule) return null;
  let at = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  const end = at + 8 * 86_400_000;
  while (at < end) {
    const parts = swedishParts(new Date(at));
    const weekday = (parts.weekday + 1) % 7; // swedishParts: 0 = Monday; cron: 0 = Sunday
    if (!matches(schedule.month, parts.month) || !dayMatches(schedule, parts.day, weekday)) { at += (24 * 60 - parts.hour * 60 - parts.minute) * 60_000; continue; }
    if (!matches(schedule.hour, parts.hour)) { at += (60 - parts.minute) * 60_000; continue; }
    if (matches(schedule.minute, parts.minute)) return new Date(at);
    at += 60_000;
  }
  return null;
}

// ---- State -------------------------------------------------------------------------------------------------------

export type ServerJobStatus = "ok" | "failed" | "skipped_paused" | "running";
export const SERVER_JOB_STATUS_LABEL: Record<ServerJobStatus, string> = {
  ok: "Lyckades", failed: "Misslyckades", skipped_paused: "Pausat, kördes inte", running: "Pågår",
};
export const SERVER_JOB_STATUS_TONE: Record<ServerJobStatus, "success" | "warning" | "danger" | "neutral"> = {
  ok: "success", failed: "danger", skipped_paused: "neutral", running: "warning",
};

/** How long one run holds the job; renewed every minute while it runs, so a killed run frees it within this time. */
export const JOB_LEASE_MS = 5 * 60_000;
export const JOB_HEARTBEAT_MS = 60_000;
/** Kör nu is refused this long after the last request, so a double click starts one run. */
export const RUN_REQUEST_COOLDOWN_MS = 60_000;

/** The job's last output line, safe to keep: control characters out, at most 300 characters. */
export function jobMessage(output: string): string | null {
  const line = output.split(/\r?\n/).map((text) => text.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).filter(Boolean).pop();
  return line ? line.slice(0, 300) : null;
}

/** "1,2 s", "3 min 4 s". */
export function durationText(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Who may see and control the jobs: the superadmin only, never through an API key (the server checks it on every call). */
export type ServerJobAccess = { ok: true } | { ok: false; status: 401 | 403; message: string };
export function serverJobAccess(user: { role?: string | null } | null | undefined, integration?: unknown): ServerJobAccess {
  if (!user) return { ok: false, status: 401, message: "Logga in för att fortsätta." };
  if (user.role !== "SUPERADMIN" || integration) return { ok: false, status: 403, message: "Bara installationens administratör kan göra det." };
  return { ok: true };
}

export type RunRequestCheck = { ok: true } | { ok: false; message: string };
/** Whether Kör nu may start the job now: a controlled job, not paused, not running and not just requested. */
export function runRequestAllowed(key: string, row: { paused?: boolean; lockedUntil?: Date | null; runRequestedAt?: Date | null; lastStartedAt?: Date | null } | null, now = new Date()): RunRequestCheck {
  if (!isControlledJob(key)) return { ok: false, message: "Jobbet kan inte startas från appen." };
  if (row?.paused) return { ok: false, message: "Jobbet är pausat. Starta det först." };
  if (row?.lockedUntil && row.lockedUntil.getTime() > now.getTime()) return { ok: false, message: "Jobbet körs redan." };
  const requested = row?.runRequestedAt?.getTime() ?? 0;
  const started = row?.lastStartedAt?.getTime() ?? 0;
  if (requested > started && now.getTime() - requested < RUN_REQUEST_COOLDOWN_MS) return { ok: false, message: "Jobbet startas redan. Vänta en stund." };
  return { ok: true };
}
