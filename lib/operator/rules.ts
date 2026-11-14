import { z } from "zod";
import { swedishParts } from "@/lib/swedish-time";
import { isCommonWord } from "@/lib/operator/common-passwords";

/**
 * Operatörssidan och operatörskonton (2026-10-30), the rules without a database or network so they can be tested
 * alone and shared by the server, the page and the demo.
 *
 * An operator account is never a person in Workflow (never a User): it signs in on the operator page of its own company,
 * reports faults on the machines the admin chose, sees those machines' status and its own reports – nothing else. Its
 * password rules are milder than an ordinary account's (8 characters instead of 12, no two-step requirement) but it is
 * checked against common passwords, the tries are limited and locked for a while, the session belongs to the device and
 * ends after the company's inactivity time.
 */

// ---------- passwords ----------

export const OPERATOR_PASSWORD_MIN = 8;
export const OPERATOR_PASSWORD_MAX = 200;
/** Ordinary accounts (features/auth/actions.ts), for the admin's comparison text. */
export const ORDINARY_PASSWORD_MIN = 12;

const KEYBOARD_ROWS = ["1234567890", "qwertyuiopå", "asdfghjklöä", "zxcvbnm", "abcdefghijklmnopqrstuvwxyz"];
const isSequence = (value: string) => {
  const lower = value.toLowerCase();
  return KEYBOARD_ROWS.some((row) => row.includes(lower) || [...row].reverse().join("").includes(lower));
};

/**
 * Why a password may not be used for an operator account, or "" when it may. `username` and `company` are refused inside
 * the password too (a terminal named "Press 4" never gets "press4press4").
 */
export function operatorPasswordProblem(password: string, context: { username?: string; company?: string } = {}): string {
  if (password.length < OPERATOR_PASSWORD_MIN) return `Minst ${OPERATOR_PASSWORD_MIN} tecken.`;
  if (password.length > OPERATOR_PASSWORD_MAX) return `Högst ${OPERATOR_PASSWORD_MAX} tecken.`;
  const lower = password.toLowerCase();
  const compact = lower.replace(/\s+/g, "");
  if (new Set(compact).size < 4) return "För enkelt. Använd fler olika tecken.";
  if (isSequence(compact)) return "För enkelt. Undvik tangent- och sifferföljder.";
  // A common word, also with a year, a few digits or a sign after it ("Sommar2026!", "password1").
  const base = compact.replace(/[\d!?.#*@_\-+]{0,6}$/, "");
  if (isCommonWord(compact) || (base.length >= 3 && isCommonWord(base))) return "Lösenordet är för vanligt. Välj ett annat.";
  // The username whole, the company's name without its legal form, and each longer word of the company's name.
  const letters = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const company = (context.company ?? "").replace(/\s+(ab|hb|kb|aktiebolag|handelsbolag|kommanditbolag)\.?$/i, "");
  const words = [context.username ?? "", company, ...company.split(/\s+/).filter((word) => letters(word).length >= 5)];
  for (const word of words) {
    const key = letters(word);
    if (key.length >= 3 && letters(compact).includes(key)) return "Lösenordet får inte innehålla användarnamnet eller företagets namn.";
  }
  return "";
}

/** The rules as the admin sees them (Administration › Operatörskonton). */
export const OPERATOR_PASSWORD_RULES = [
  `Minst ${OPERATOR_PASSWORD_MIN} tecken (vanliga konton: minst ${ORDINARY_PASSWORD_MIN}).`,
  "Inte ett vanligt lösenord, en följd eller användarnamnet.",
  "Fem fel i rad spärrar kontot i 15 minuter.",
  "Ingen tvåstegsverifiering.",
  "Inloggningen gäller bara enheten och slutar efter en tid utan aktivitet.",
] as const;

// ---------- usernames ----------

export const USERNAME_MAX = 80;
const USERNAME_CHARS = /^[\p{L}\p{N} .\-_@+'&()/]+$/u;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The name as written (spaces tidied) and its key (lower case); a colon is never allowed (Microsoft accounts' keys have one). */
export function normalizeUsername(value: string): { ok: true; username: string; key: string; email: boolean } | { ok: false; error: string } {
  const username = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (username.length < 2) return { ok: false, error: "Skriv ett användarnamn med minst 2 tecken." };
  if (username.length > USERNAME_MAX) return { ok: false, error: `Högst ${USERNAME_MAX} tecken.` };
  if (!USERNAME_CHARS.test(username)) return { ok: false, error: "Använd bokstäver, siffror, mellanslag och . - _ @." };
  const email = username.includes("@");
  if (email && !EMAIL.test(username)) return { ok: false, error: "E-postadressen ser inte rätt ut." };
  return { ok: true, username, key: username.toLowerCase(), email };
}

export const microsoftUsernameKey = (oid: string) => `microsoft:${oid.toLowerCase()}`;

// ---------- sign-in limits and sessions ----------

/** Fem fel i rad per konto ger en spärr på 15 minuter (RateLimitBucket, lib/security/rate-limit.ts). */
export const OPERATOR_LOCK_TRIES = 5;
export const OPERATOR_LOCK_MINUTES = 15;
/** A wider net per IP address, so one place cannot walk many accounts' names. */
export const OPERATOR_IP_TRIES = 40;
export const OPERATOR_SESSION_MAX_HOURS = 24;
export const INACTIVITY_MIN = 5;
export const INACTIVITY_MAX = 720;
export const INACTIVITY_DEFAULT = 15;
/** "15 minuter", "1 timme", "8 timmar", "1 timme och 30 minuter" (kundresa 2026-11-07, M10: "480 minuter"). */
export function inactivityText(minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (!hours) return `${minutes} minuter`;
  const hourText = hours === 1 ? "1 timme" : `${hours} timmar`;
  return rest ? `${hourText} och ${rest} minuter` : hourText;
}
/** lastSeenAt is written at most this often (seconds), so a busy page does not write on every request. */
export const OPERATOR_TOUCH_SECONDS = 30;

export type OperatorSessionRow = { revokedAt: Date | null; createdAt: Date; lastSeenAt: Date; deviceHash: string };
export type OperatorSessionCheck = {
  row: OperatorSessionRow | null;
  deviceHash: string | null;
  inactivityMinutes: number;
  account: { active: boolean; sessionsRevokedAt: Date | null } | null;
  now?: number;
};

/** Whether a session still holds: same device, not revoked, account active, within the inactivity time and the max age. */
export function operatorSessionValid(input: OperatorSessionCheck): boolean {
  const now = input.now ?? Date.now();
  const { row, account } = input;
  if (!row || !account || !account.active || row.revokedAt) return false;
  if (!input.deviceHash || input.deviceHash !== row.deviceHash) return false;
  if (account.sessionsRevokedAt && row.createdAt.getTime() <= account.sessionsRevokedAt.getTime()) return false;
  if (row.createdAt.getTime() + OPERATOR_SESSION_MAX_HOURS * 3_600_000 < now) return false;
  const minutes = Math.min(INACTIVITY_MAX, Math.max(INACTIVITY_MIN, input.inactivityMinutes));
  return row.lastSeenAt.getTime() + minutes * 60_000 >= now;
}

export const operatorSessionNeedsTouch = (lastSeenAt: Date, now = Date.now()) => now - lastSeenAt.getTime() >= OPERATOR_TOUCH_SECONDS * 1000;

// ---------- the operator page's address ----------

/** `/operator/<pageKey>`: a random key (never the company's name); `demo` is the public demo's page. */
export const OPERATOR_DEMO_KEY = "demo";
export const PAGE_KEY_PATTERN = /^[a-z0-9]{16,40}$/;
export const isPageKey = (value: string) => PAGE_KEY_PATTERN.test(value);
export const operatorPagePath = (pageKey: string, machineId?: string | null) => `/operator/${encodeURIComponent(pageKey)}${machineId ? `?maskin=${encodeURIComponent(machineId)}` : ""}`;

// ---------- the operator role: only the operator endpoints ----------
export { OPERATOR_API_PREFIX, OPERATOR_BASE_PATH, OPERATOR_DEVICE_COOKIE, OPERATOR_ONLY_REFUSAL, OPERATOR_SESSION_COOKIE, operatorRequestRefused } from "@/lib/operator/guard";

// ---------- causes, severity and intake ----------

export const DEFAULT_CAUSES = ["Läckage", "Ovanligt ljud", "Stannar", "Överhettning", "Larm på panelen", "Annat"] as const;
export const CAUSE_MAX = 60;
export const CAUSES_MAX = 20;
export const causesSchema = z.array(z.string().trim().min(1, "En orsak kan inte vara tom.").max(CAUSE_MAX, `Högst ${CAUSE_MAX} tecken per orsak.`))
  .min(1, "Ange minst en orsak.").max(CAUSES_MAX, `Högst ${CAUSES_MAX} orsaker.`)
  .refine((list) => new Set(list.map((item) => item.toLowerCase())).size === list.length, "Varje orsak får bara finnas en gång.");

/** The company's causes, or the defaults when none are saved (or the saved value is broken). */
export function causesOf(value: unknown): string[] {
  const parsed = causesSchema.safeParse(value);
  return parsed.success ? parsed.data : [...DEFAULT_CAUSES];
}

export const SEVERITIES = ["LOW", "NORMAL", "HIGH", "ACUTE"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, string> = { LOW: "Låg", NORMAL: "Normal", HIGH: "Hög", ACUTE: "Akut" };
export const SEVERITY_TONE = { LOW: "neutral", NORMAL: "info", HIGH: "warning", ACUTE: "danger" } as const;
/** The work order's maintenance priority (lib/workflow/maintenance.ts) for each severity. */
export const SEVERITY_PRIORITY: Record<Severity, "LOW" | "NORMAL" | "HIGH" | "URGENT"> = { LOW: "LOW", NORMAL: "NORMAL", HIGH: "HIGH", ACUTE: "URGENT" };

export const INTAKES = ["order", "approval"] as const;
export type Intake = (typeof INTAKES)[number];
export const INTAKE_LABELS: Record<Intake, string> = {
  order: "Ny arbetsorder direkt",
  approval: "Godkännandelistan först",
};

export const REPORTER_NAME_MAX = 80;
export const REPORT_TEXT_MAX = 1000;
export const REPORT_PHOTO_LIMIT = 5;

/** What the operator sends (the photos come beside it in the same form). The cause is checked against the company's list. */
export const faultReportInputSchema = z.object({
  machineId: z.string().trim().min(1, "Välj maskin.").max(120),
  cause: z.string().trim().min(1, "Välj orsak.").max(CAUSE_MAX),
  text: z.string().trim().max(REPORT_TEXT_MAX, `Högst ${REPORT_TEXT_MAX} tecken.`).default(""),
  severity: z.enum(SEVERITIES, { error: "Välj hur allvarligt det är." }),
  reporterName: z.string().trim().max(REPORTER_NAME_MAX, `Högst ${REPORTER_NAME_MAX} tecken.`).default(""),
});
export type FaultReportInput = z.infer<typeof faultReportInputSchema>;

// ---------- on call ----------

/** Monday–Friday within the company's workday (Organization.workdayStartMinutes/EndMinutes), in Swedish time. */
export function withinWorkday(now: Date, workday: { startMinutes: number; endMinutes: number }) {
  const parts = swedishParts(now);
  if (parts.weekday >= 5) return false;
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= workday.startMinutes && minutes < workday.endMinutes;
}

/** Jouren kontaktas vid Akut, och vid Hög utanför arbetstid. */
export function callsOnCall(severity: Severity, now: Date, workday: { startMinutes: number; endMinutes: number }) {
  return severity === "ACUTE" || (severity === "HIGH" && !withinWorkday(now, workday));
}

export const ON_CALL_NOTE = "Jouren kontaktas vid Akut, och vid Hög utanför arbetstid.";
export const NOT_AN_ALARM_SYSTEM = "Workflow är inget larm- eller säkerhetssystem. Vid fara: följ företagets rutin.";

export type OnCallState = { state: "none" } | { state: "waiting" } | { state: "acknowledged"; at: string };
export function onCallState(report: { onCall: boolean; acknowledgedAt: Date | string | null }): OnCallState {
  if (!report.onCall) return { state: "none" };
  if (!report.acknowledgedAt) return { state: "waiting" };
  return { state: "acknowledged", at: new Date(report.acknowledgedAt).toISOString() };
}

// ---------- what the operator sees of a report ----------

export type ReportStatusLabel = "Väntar på godkännande" | "Avvisad" | "Mottagen" | "Pågår" | "Åtgärdad" | "Utgår";
export const REPORT_STATUS_TONE: Record<ReportStatusLabel, "info" | "warning" | "success" | "neutral" | "danger"> = {
  "Väntar på godkännande": "neutral", Avvisad: "neutral", Mottagen: "info", Pågår: "warning", Åtgärdad: "success", Utgår: "neutral",
};

/** The report's state in plain words, from its own status and its work order's (null when there is none or it is gone). */
export function reportStatusLabel(status: string, taskStatus: string | null): ReportStatusLabel {
  if (status === "pending") return "Väntar på godkännande";
  if (status === "rejected") return "Avvisad";
  if (taskStatus === "COMPLETED") return "Åtgärdad";
  if (taskStatus === "CANCELLED") return "Utgår";
  if (taskStatus === "IN_PROGRESS" || taskStatus === "PAUSED" || taskStatus === "NEEDS_ACTION") return "Pågår";
  return "Mottagen";
}

/** The machine's status for "Mina maskiner": an open fault report first, then the machine's own run state. */
export type MachineStatusLabel = { label: string; tone: "danger" | "warning" | "success" | "neutral" };
export function operatorMachineStatus(input: { openReports: number; operatingState: string; runState: "running" | "stopped" | null }): MachineStatusLabel {
  if (input.operatingState === "OUT_OF_SERVICE") return { label: "Ur drift", tone: "danger" };
  if (input.openReports) return { label: input.openReports === 1 ? "Felanmäld" : `Felanmäld (${input.openReports})`, tone: "warning" };
  if (input.runState === "stopped") return { label: "Stoppad", tone: "warning" };
  if (input.runState === "running" || input.operatingState === "IN_SERVICE") return { label: "I drift", tone: "success" };
  return { label: "Ingen anmälan", tone: "neutral" };
}

/** The work order's title and description for a fault report (the corrective maintenance item). */
/**
 * The work order's title and description from a fault report. `label` is the number the operator's receipt shows
 * ("AO-LKNQGS", lib/operator/maintenance-adapter.ts orderLabel): it stands in the title and the description, so the
 * company finds the order by it in the list and the search when the operator calls (användartest 2026-10-31, A1).
 */
export function faultOrderText(input: { machineLabel: string; cause: string; text: string; severity: Severity; reporter: string; accountName: string; label?: string }) {
  const title = `Felanmälan${input.label ? ` ${input.label}` : ""}: ${input.cause} – ${input.machineLabel}`.slice(0, 200);
  const by = input.reporter ? `${input.reporter} (${input.accountName})` : input.accountName;
  const description = [input.label ? `Operatörens nummer: ${input.label}.` : "", `Felanmält av ${by} på operatörssidan.`, `Allvarlighet: ${SEVERITY_LABELS[input.severity]}.`, input.text ? `Vad hände: ${input.text}` : ""].filter(Boolean).join("\n");
  return { title, description, fault: `${input.cause}${input.text ? `: ${input.text}` : ""}`.slice(0, 500), priority: SEVERITY_PRIORITY[input.severity] };
}

// ---------- AI troubleshooting ----------

/** Prepared, off: shown and called only when both the product owner's and the company's switch are on. */
export const aiTroubleshootingOn = (input: { product: boolean; company: boolean }) => input.product && input.company;
export const AI_SUGGESTION_NOTE = "Bara ett förslag. Säkerhetsbeslut tas av en person.";
