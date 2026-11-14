import { z } from "zod";
import { normalizeOrgNumber, formatOrgNumber } from "@/lib/kfid/org-number";
import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { swedishDate, swedishParts, swedishRepeatedHour } from "@/lib/swedish-time";

/**
 * Personalliggare, steg 1 (2026-10-09: "klarar kraven men inte mer", docs/proposals/personalliggare-krav-2026-10-11.md).
 * The pure rules, shared by the server, the page and the tests: identity numbers, who may do what, how corrections are
 * read, who is on site, the time format of the register and the CSV export, and the retention time.
 */

// ---- Identity numbers ----

/** A person's identity in the register: Swedish personnummer/samordningsnummer, or a foreign number (SFF 9 kap. 5 §). */
export type IdNumber = { kind: "PERSONNUMMER" | "SAMORDNINGSNUMMER"; value: string } | { kind: "FOREIGN"; value: string };

export const ID_NUMBER_ERROR = "Skriv personnummer eller samordningsnummer med tolv siffror, till exempel 19800101-1234.";
export const FOREIGN_ID_ERROR = "Skriv det utländska id-numret med 4–30 tecken (bokstäver, siffror och bindestreck).";

function luhn(digits: string) {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let part = Number(digits[index]) * (index % 2 === 0 ? 2 : 1);
    if (part > 9) part -= 9;
    sum += part;
  }
  return sum % 10 === 0;
}

/**
 * A Swedish personnummer or samordningsnummer (day + 60), written with twelve digits (YYYYMMDD-NNNN) or ten
 * (YYMMDD-NNNN, "+" for a hundred or more years), checked with its Luhn digit. Returns the twelve digits, or null.
 */
export function parseSwedishIdNumber(input: string, today = new Date()): { kind: "PERSONNUMMER" | "SAMORDNINGSNUMMER"; digits: string } | null {
  const trimmed = input.trim();
  if (!/^\d{6}(\d{2})?[-+ ]?\d{4}$/.test(trimmed)) return null;
  const centenarian = trimmed.includes("+");
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    const year = Number(digits.slice(0, 2));
    const now = swedishParts(today).year;
    let century = Math.floor(now / 100) * 100;
    if (century + year > now) century -= 100;
    if (centenarian) century -= 100;
    digits = `${century + year}`.padStart(4, "0") + digits.slice(2);
  }
  if (digits.length !== 12 || centenarian && trimmed.replace(/\D/g, "").length === 12) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const rawDay = Number(digits.slice(6, 8));
  const coordination = rawDay > 60;
  const day = coordination ? rawDay - 60 : rawDay;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1880 || month < 1 || month > 12 || day < 1 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (!luhn(digits.slice(2))) return null;
  return { kind: coordination ? "SAMORDNINGSNUMMER" : "PERSONNUMMER", digits };
}

/** The value kept for a person: twelve digits for a Swedish number, the cleaned text for a foreign one. */
export function idNumberFrom(input: { idNumber: string; foreign?: boolean }, today = new Date()): IdNumber {
  if (input.foreign) {
    const value = input.idNumber.trim().toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9-]{4,30}$/.test(value)) throw new StaffRegisterError(400, FOREIGN_ID_ERROR);
    return { kind: "FOREIGN", value };
  }
  const parsed = parseSwedishIdNumber(input.idNumber, today);
  if (!parsed) throw new StaffRegisterError(400, ID_NUMBER_ERROR);
  return { kind: parsed.kind, value: parsed.digits };
}

/** How the number is written in full (the Kontrollvy and the export): 19800101-1234, or the foreign number as is. */
export function formatIdNumber(id: IdNumber) {
  return id.kind === "FOREIGN" ? id.value : `${id.value.slice(0, 8)}-${id.value.slice(8)}`;
}

/** How the number is shown everywhere else: the birth date only (19800101-••••), or the last two of a foreign number. */
export function maskIdNumber(id: IdNumber) {
  return id.kind === "FOREIGN" ? `••••${id.value.slice(-2)}` : `${id.value.slice(0, 8)}-••••`;
}

/** The stored (sealed) form: the kind and the value, so the full number can be written back exactly. */
export const serializeIdNumber = (id: IdNumber) => `${id.kind}:${id.value}`;
export function deserializeIdNumber(value: string): IdNumber | null {
  const [kind, ...rest] = value.split(":");
  const text = rest.join(":");
  if (!text) return null;
  if (kind === "FOREIGN") return { kind, value: text };
  if (kind === "PERSONNUMMER" || kind === "SAMORDNINGSNUMMER") return { kind, value: text };
  return null;
}

/** The employer's organisation number: a Swedish org.nr (or a sole trader's personnummer), formatted NNNNNN-NNNN. */
export function employerOrgNumber(input: string) {
  const digits = normalizeOrgNumber(input);
  if (digits) return formatOrgNumber(digits);
  const person = parseSwedishIdNumber(input);
  if (person) return `${person.digits.slice(2, 8)}-${person.digits.slice(8)}`;
  throw new StaffRegisterError(400, "Skriv arbetsgivarens organisationsnummer, till exempel 556677-8899.");
}

export class StaffRegisterError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
/** Your own identity number is missing: the page asks for it once, then checks in. */
export const NEEDS_ID_NUMBER = "NEEDS_ID_NUMBER";

// ---- Input ----

const text = (max: number, label: string) => z.string().trim().min(1, `Skriv ${label}.`).max(max, `${label[0].toUpperCase()}${label.slice(1)} får vara högst ${max} tecken.`);
export const personInputSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  /** A member: their own row (name and employer follow the member and the company). */
  userId: z.string().min(1).max(100).optional(),
  name: text(120, "namnet").optional(),
  idNumber: z.string().trim().min(1, "Skriv personnummer eller samordningsnummer.").max(40),
  foreign: z.boolean().default(false),
  employerName: text(160, "arbetsgivarens namn").optional(),
  employerOrgNo: z.string().trim().max(20).optional(),
});
export type PersonInput = z.infer<typeof personInputSchema>;

export const REASON_MAX = 300;
export const reasonSchema = z.string().trim().max(REASON_MAX, `Skälet får vara högst ${REASON_MAX} tecken.`);
/** A registration later than this after the work period started or ended counts as late and needs a reason. */
export const LATE_AFTER_MINUTES = 15;

// ---- Access ----

/**
 * Who may do what (checked on the server for every call). Everyone who may read the project may check themselves in
 * and out and correct their own rows; `staff-register:edit` registers and corrects others and adds people who are not
 * members; `staff-register:read` opens the Kontrollvy and the export, where identity numbers are shown in full.
 * Company admins may do everything. Superadmin is not a member of the company and never reaches any of it.
 * The project's responsible person (Project.responsibleUserId, "Ansvarig") also opens the Kontrollvy and the export of
 * that project, and only of that project (2026-10-09). Pass the project to get its answer; without a project
 * the answer is the company-wide right alone.
 */
export type StaffRegisterCaller = { organizationId: string; userId: string; userName: string; admin: boolean; permissions: WorkflowPermissionProfile; storageMode: string };
export type StaffRegisterProject = { responsibleUserId: string | null };
export function staffRegisterAccess(caller: Pick<StaffRegisterCaller, "admin" | "permissions"> & { userId?: string }, project?: StaffRegisterProject) {
  const can = (subject: "projects" | "staff-register", action: "read" | "edit") => caller.admin || hasWorkflowPermission(caller.permissions, subject, action);
  const responsible = Boolean(caller.userId && project?.responsibleUserId && project.responsibleUserId === caller.userId);
  return { self: can("projects", "read"), control: can("staff-register", "read") || responsible, others: can("staff-register", "edit") };
}

/**
 * "Visa för Skatteverket" (2026-10-10): at a kontrollbesök the register must be shown at once, and often only the
 * workers are on site. A person who is checked in right now on a building site may open that site's Kontrollvy for today
 * only – every row registered there today (all persons, identity numbers in full, as the Kontrollvy shows) and who is on
 * site now – never another day, another site or the export. Each such opening is written to the company's administration
 * history (onSiteViewAuditDetail). Those with the Kontrollvy right (staffRegisterAccess control) keep the full view.
 * Returns "full", "today", or throws 403.
 */
export const ON_SITE_VIEW_DENIED = "Du saknar behörighet att öppna personalliggarens kontrollvy.";
export const ON_SITE_VIEW_TODAY_ONLY = "Du kan bara visa dagens registreringar för byggarbetsplatsen där du är incheckad.";
export const ON_SITE_VIEW_NO_EXPORT = "Bara den som har rätt till kontrollvyn kan exportera personalliggaren.";
export function controlScope(input: { control: boolean; checkedInHere: boolean; exporting: boolean; startAt: Date; endAt: Date; today: { startAt: Date; endAt: Date } }): "full" | "today" {
  if (input.control) return "full";
  if (!input.checkedInHere) throw new StaffRegisterError(403, ON_SITE_VIEW_DENIED);
  if (input.exporting) throw new StaffRegisterError(403, ON_SITE_VIEW_NO_EXPORT);
  if (input.startAt.getTime() !== input.today.startAt.getTime() || input.endAt.getTime() !== input.today.endAt.getTime()) throw new StaffRegisterError(403, ON_SITE_VIEW_TODAY_ONLY);
  return "today";
}
/** The history line of an opening on site: the site, the day and the count – never names or numbers. */
export function onSiteViewAuditDetail(input: { siteId: string; day: string; rows: number }) {
  return `Personalliggarens kontrollvy visades på plats (Visa för Skatteverket) av en incheckad person: byggarbetsplats ${input.siteId || "utan id-nummer"}, ${input.day}, ${input.rows} ${input.rows === 1 ? "rad" : "rader"}.`;
}

/**
 * The payment block (2026-10-09 evening): "Undantaget från betalningsspärren: bara vid förfallen faktura." New
 * rows (check-in/out, corrections, people) are allowed when Cloud writing is available or paused only for an overdue
 * invoice; any other reason – e.g. the Cloud agreement has ended ("läs och exportera kvar") – stops them. Reading, the
 * Kontrollvy and the export never follow the block. `access` is the extension's answer (CloudWriteAccess).
 */
export function staffRegisterWriteAllowed(access: { allowed: boolean; reason: string }) {
  return access.allowed || access.reason === "PAYMENT_OVERDUE";
}
/**
 * "Personalliggare på begäran" (2026-10-09 evening): a company that is erased or switched off by the product
 * owner gets no login ("avstängt är avstängt"); its register rows stay locked for the retention time and Workflow hands
 * them out on request. Only the installation's superadmin, only for an inactive company, always with a written reason
 * that is kept in the company's administration history together with the count – never names or numbers.
 */
export const DISCLOSURE_REASON_MIN = 10;
export const disclosureInputSchema = z.object({
  organizationId: z.string().min(1).max(100),
  projectId: z.string().min(1).max(100),
  reason: z.string().trim().min(DISCLOSURE_REASON_MIN, `Skriv varför liggaren lämnas ut (minst ${DISCLOSURE_REASON_MIN} tecken), t.ex. vem som begärde den.`).max(REASON_MAX, `Skälet får vara högst ${REASON_MAX} tecken.`),
});
export function disclosureRefusal(input: { superadmin: boolean; companyActive: boolean }) {
  if (!input.superadmin) return "Systemadministratör krävs.";
  if (input.companyActive) return "Företaget är aktivt. Dess egen administratör hämtar liggaren i Kontrollvyn.";
  return null;
}
export function disclosureAuditDetail(input: { rows: number; siteId: string; reason: string }) {
  return `Personalliggaren lämnades ut på begäran av installationens superadmin: ${input.rows} ${input.rows === 1 ? "rad" : "rader"} för byggarbetsplats ${input.siteId || "utan id-nummer"}. Skäl: ${input.reason.replace(/\s+/g, " ").trim()}`;
}
export const STAFF_REGISTER_WRITE_PAUSED ="Företaget har inget giltigt Cloud-avtal. Personalliggaren kan läsas och exporteras under bevarandetiden, men inga nya registreringar görs.";

// ---- Reading the register ----

export type RegisterEventKind = "IN" | "OUT" | "VOID";
export type RegisterEvent = {
  id: string; personId: string; personName: string; idNumber: string; employerName: string; employerOrgNo: string;
  kind: RegisterEventKind; occurredAt: Date; registeredAt: Date; registeredByName: string; correctsId: string | null; reason: string; siteId: string;
};

/**
 * The register as it reads after corrections: each original row replaced by its latest correction (by registration
 * time), a VOID correction removing it. The originals and corrections themselves are never changed or hidden in the
 * Kontrollvy and export; this is only for "who is on site" and the work periods.
 */
export function effectiveEvents<T extends Pick<RegisterEvent, "id" | "kind" | "occurredAt" | "registeredAt" | "correctsId">>(events: T[]): T[] {
  const latest = new Map<string, T>();
  for (const event of events) {
    if (!event.correctsId) continue;
    const current = latest.get(event.correctsId);
    if (!current || current.registeredAt < event.registeredAt) latest.set(event.correctsId, event);
  }
  return events.filter((event) => !event.correctsId).flatMap((event) => {
    const correction = latest.get(event.id);
    if (!correction) return [event];
    return correction.kind === "VOID" ? [] : [{ ...event, kind: correction.kind, occurredAt: correction.occurredAt }];
  }).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.registeredAt.getTime() - b.registeredAt.getTime());
}

/** Each person's latest effective row; on site when it is a check-in. */
export function onSite<T extends Pick<RegisterEvent, "id" | "personId" | "kind" | "occurredAt" | "registeredAt" | "correctsId">>(events: T[], now = new Date()): T[] {
  const last = new Map<string, T>();
  for (const event of effectiveEvents(events)) if (event.occurredAt <= now) last.set(event.personId, event);
  return [...last.values()].filter((event) => event.kind === "IN").sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/** Whether the person is checked in (and since when), from their own rows. */
export function personState(events: Pick<RegisterEvent, "id" | "personId" | "kind" | "occurredAt" | "registeredAt" | "correctsId">[], personId: string, now = new Date()) {
  const here = onSite(events.filter((event) => event.personId === personId), now)[0];
  return here ? { onSite: true as const, since: here.occurredAt } : { onSite: false as const, since: null };
}

/** A check-in when already in, or a check-out when not in, is refused (a double tap never makes two rows). */
export function checkProblem(state: { onSite: boolean }, kind: "IN" | "OUT", self: boolean) {
  if (kind === "IN" && state.onSite) return self ? "Du är redan incheckad." : "Personen är redan incheckad.";
  if (kind === "OUT" && !state.onSite) return self ? "Du är inte incheckad." : "Personen är inte incheckad.";
  return null;
}

/** A late registration (or a time that is not now) needs a reason, so the register shows why. */
export function isLate(occurredAt: Date, registeredAt: Date) {
  return registeredAt.getTime() - occurredAt.getTime() > LATE_AFTER_MINUTES * 60_000;
}

// ---- Time format and export ----

const pad = (value: number) => String(value).padStart(2, "0");
/**
 * SKVFS 2015:6 12 §: date and time as ÅÅÅÅ:MM:DD TT:MM:SS, in Swedish time. In the hour the clock shows twice the night
 * summer time ends, the row says which of the two it is, so the order 02:55 → 02:02 can be understood (2026-10-21).
 */
export function registerTime(value: Date) {
  const parts = swedishParts(value);
  const repeated = swedishRepeatedHour(value);
  return `${parts.year}:${pad(parts.month)}:${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${repeated ? ` (${repeated === "summer" ? "sommartid" : "vintertid"})` : ""}`;
}

export const KIND_LABEL: Record<RegisterEventKind, string> = { IN: "In", OUT: "Ut", VOID: "Struken" };

/** The rows of the Kontrollvy and the export: every row, originals and corrections, oldest first. */
export function controlRows(events: RegisterEvent[]) {
  // Rows are numbered in the order they were registered, so a correction always has a higher number than its original.
  const ordinal = new Map([...events].sort((a, b) => a.registeredAt.getTime() - b.registeredAt.getTime() || a.id.localeCompare(b.id)).map((event, index) => [event.id, index + 1]));
  // A correction is listed right under the row it corrects.
  const byId = new Map(events.map((event) => [event.id, event]));
  const anchor = (event: RegisterEvent) => (event.correctsId && byId.get(event.correctsId)?.occurredAt) || event.occurredAt;
  const root = (event: RegisterEvent) => event.correctsId && byId.has(event.correctsId) ? event.correctsId : event.id;
  return [...events].sort((a, b) => anchor(a).getTime() - anchor(b).getTime() || root(a).localeCompare(root(b)) || a.registeredAt.getTime() - b.registeredAt.getTime()).map((event) => ({
    id: event.id,
    personId: event.personId,
    correctsId: event.correctsId,
    corrected: events.some((other) => other.correctsId === event.id),
    number: ordinal.get(event.id) ?? 0,
    siteId: event.siteId,
    name: event.personName,
    idNumber: event.idNumber,
    employer: event.employerName,
    employerOrgNo: event.employerOrgNo,
    kind: KIND_LABEL[event.kind],
    time: registerTime(event.occurredAt),
    registered: registerTime(event.registeredAt),
    registeredBy: event.registeredByName,
    corrects: event.correctsId ? String(ordinal.get(event.correctsId) ?? "") : "",
    reason: event.reason,
  }));
}

export const CONTROL_HEADERS = ["Nr", "Byggarbetsplatsens id-nr", "Namn", "Personnummer / samordningsnummer", "Arbetsgivare", "Arbetsgivarens org.nr", "Händelse", "Tidpunkt", "Registrerad", "Registrerad av", "Rättar rad", "Skäl"];

/** CSV with semicolons (Excel in Swedish), quoted cells and a leading "'" on anything that could run as a formula. */
export function controlCsv(head: { company: string; companyOrgNo: string; siteId: string; project: string; from: string; to: string }, events: RegisterEvent[]) {
  const cell = (value: string | number) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [
    ["Personalliggare", head.project],
    ["Näringsidkare", `${head.company}${head.companyOrgNo ? `, org.nr ${head.companyOrgNo}` : ""}`],
    ["Byggarbetsplatsens id-nr", head.siteId],
    ["Period", `${head.from} – ${head.to}`],
    [],
    CONTROL_HEADERS,
    ...controlRows(events).map((row) => [row.number, row.siteId, row.name, row.idNumber, row.employer, row.employerOrgNo, row.kind, row.time, row.registered, row.registeredBy, row.corrects, row.reason]),
  ];
  return `﻿${lines.map((line) => line.map(cell).join(";")).join("\r\n")}\r\n`;
}

// ---- The period of a Kontrollvy ----

/** "YYYY-MM-DD" days in Swedish time; at most 92 days at a time, so one view stays quick. */
export const CONTROL_MAX_DAYS = 92;
export function controlPeriod(from: string | null, to: string | null, today: string) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const start = from && day.test(from) ? from : today;
  const end = to && day.test(to) ? to : start;
  if (end < start) throw new StaffRegisterError(400, "Slutdatumet ligger före startdatumet.");
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  const startAt = swedishDate(y1, m1, d1);
  const endAt = swedishDate(y2, m2, d2 + 1);
  if ((endAt.getTime() - startAt.getTime()) / 86_400_000 > CONTROL_MAX_DAYS + 1) throw new StaffRegisterError(400, `Välj högst ${CONTROL_MAX_DAYS} dagar åt gången.`);
  return { from: start, to: end, startAt, endAt };
}

// ---- Retention ----

/**
 * SFF 9 kap. 5 §: kept for two years after the end of the calendar year in which the tax year ended. With a calendar
 * tax year a row from 2026 is kept through 2028; with a broken (or extended first) tax year it can be one year more.
 * Workflow does not know the company's tax year, so it keeps every row until 1 January of the third year after the
 * row's year, in Swedish time: a row from 2026 is purged on 1 January 2030. The database refuses earlier deletion.
 */
export const RETENTION_EXTRA_YEARS = 3;
export function retentionCutoff(now = new Date()) {
  return swedishDate(swedishParts(now).year - RETENTION_EXTRA_YEARS, 1, 1);
}
