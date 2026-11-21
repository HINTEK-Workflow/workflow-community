import { createHash } from "node:crypto";
import { normalizeDate, normalizeTime, type ExtractedFile } from "@/lib/import/detect";
import { ABSENCE_LABELS, ABSENCE_STATUS_LABELS, countsInPlanning, isWorkday, type AbsenceHours, type AbsenceStatus, type AbsenceType } from "@/lib/workflow/absence";
import { normalizeCode, statusOf, typeOfCode, type CodeMap } from "./codes";

/**
 * Frånvaro från fil (2026-10-29): an absence file from a time or payroll system, read on the Import page like every other table.
 * Pure: the rows are read with the person's column choice, people are matched by employee number or e-mail (never by name
 * alone), codes become types through the company's saved mapping, and the result is compared with what Workflow already has:
 * new, changed, unchanged, a conflict with another absence (a person chooses), or an error. Rules that keep data safe:
 * - the same file again changes nothing (each record has a stable key: the file's id, or one made from person, code and start);
 * - a record is never removed because a later file does not have it;
 * - only approved absence affects planning; applied absence is kept, rejected and withdrawn take a known record out of planning;
 * - no free text is read from the file (a comment could hold a diagnosis); "Annan orsak" gets the code itself as its text.
 */
export { ABSENCE_FIELDS, EMPLOYEE_NUMBER_FIELDS } from "./fields";

export const MAX_ABSENCE_ROWS = 1000;
/** Some hours without a clock time are placed from the start of the day. */
export const DAY_START = "07:00";
/** At most this many days of part-time absence are split into days (a longer one is an error to fix in the file). */
const MAX_SPLIT_DAYS = 62;

export type AbsenceRow = {
  index: number; employeeNumber: string; email: string; name: string; code: string;
  from: string | null; to: string | null; startTime: string | null; endTime: string | null;
  /** Hours per day (from Timmar or Omfattning), null = not given. */
  hoursPerDay: number | null; extent: number | null;
  status: AbsenceStatus | null; externalId: string; issues: string[];
};

const cell = (file: ExtractedFile, row: string[], mapping: Record<string, string | null>, field: string) => {
  const header = mapping[field];
  if (!header) return "";
  const index = (file.headers ?? []).indexOf(header);
  return index >= 0 ? String(row[index] ?? "").trim() : "";
};
const number = (text: string) => { const value = Number(text.replace(/\s/g, "").replace(",", ".").replace(/%$/, "")); return text && Number.isFinite(value) ? value : null; };

/** The file's rows as absence rows, with what could not be read. */
export function readAbsenceRows(file: ExtractedFile, mapping: Record<string, string | null>): AbsenceRow[] {
  const rows: AbsenceRow[] = [];
  (file.rows ?? []).slice(0, MAX_ABSENCE_ROWS).forEach((cells, index) => {
    if (!cells.some((value) => value && value.trim())) return;
    const get = (field: string) => cell(file, cells, mapping, field);
    const issues: string[] = [];
    const employeeNumber = get("employeeNumber").slice(0, 40); const email = get("email").slice(0, 254).toLowerCase();
    if (!employeeNumber && !email) issues.push("saknar anställningsnummer och e-post");
    const code = get("code").slice(0, 60);
    if (!code) issues.push("saknar frånvarokod");
    const from = normalizeDate(get("from"));
    if (!from) issues.push(get("from") ? `datumet ”${get("from").slice(0, 20)}” kan inte läsas` : "saknar Från");
    const toText = get("to");
    const to = toText ? normalizeDate(toText) : from;
    if (toText && !to) issues.push(`datumet ”${toText.slice(0, 20)}” kan inte läsas`);
    if (from && to && to < from) issues.push("Till och med är före Från");
    if (from && to && Date.parse(to) - Date.parse(from) > 366 * 86_400_000) issues.push("högst ett år per rad");
    const startText = get("startTime"); const endText = get("endTime");
    const startTime = startText ? normalizeTime(startText) : null; const endTime = endText ? normalizeTime(endText) : null;
    if ((startText && !startTime) || (endText && !endTime)) issues.push("klockslaget kan inte läsas");
    if (startTime && endTime && endTime <= startTime) issues.push("sluttiden är före starttiden");
    if ((startTime || endTime) && !(startTime && endTime)) issues.push("ange både från och till klockan");
    const hoursPerDay = number(get("hours")); const extent = number(get("extent"));
    if (get("hours") && (hoursPerDay === null || hoursPerDay < 0 || hoursPerDay > 24)) issues.push("timmarna kan inte läsas");
    if (get("extent") && (extent === null || extent < 0 || extent > 100)) issues.push("omfattningen ska vara 0–100 %");
    const status = statusOf(get("status"));
    if (!status) issues.push(`statusen ”${get("status").slice(0, 20)}” känns inte igen`);
    rows.push({ index, employeeNumber, email, name: get("name").slice(0, 120), code, from, to, startTime, endTime, hoursPerDay, extent, status, externalId: get("externalId").slice(0, 120), issues });
  });
  return rows;
}

export type ImportMember = { userId: string; name: string; email: string; employeeNumber: string | null; weeklyWorkMinutes: number };
export type ExistingAbsence = {
  id: string; userId: string; type: AbsenceType; note: string; from: string; to: string; hours: AbsenceHours | null; status: AbsenceStatus;
  source: string; externalSystem: string | null; externalKey: string | null; externalHash: string | null;
};
export type AbsenceUnit = { key: string; userId: string; type: AbsenceType; note: string; from: string; to: string; hours: AbsenceHours | null; status: AbsenceStatus; code: string; hash: string };
export type PreviewAction = "new" | "changed" | "unchanged" | "conflict" | "ignored" | "error";
export type PreviewRow = {
  index: number; key: string; action: PreviewAction; personName: string; employeeNumber: string; code: string;
  typeLabel: string; from: string; to: string; hours: AbsenceHours | null; statusLabel: string; issues: string[];
  /** A conflict: the other absence (manual or from another key), for the person to choose. */
  conflict?: { id: string; label: string; manual: boolean } | null;
  existingId?: string | null;
  unit?: AbsenceUnit;
};
export type AbsencePreview = {
  rows: PreviewRow[];
  counts: Record<PreviewAction, number>;
  /** Codes the company has not mapped (with a suggestion from their words), for the person to map. */
  unknownCodes: { code: string; suggestion: AbsenceType | null; rows: number }[];
  /** Codes read through a suggestion (not yet saved in the company's mapping). */
  suggestedCodes: { code: string; type: AbsenceType }[];
  total: number;
};

const minutesOf = (clock: string) => { const [hour, minute] = clock.split(":").map(Number); return hour * 60 + minute; };
const clockOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const nextDay = (value: string) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
export const unitHash = (unit: Omit<AbsenceUnit, "hash" | "key">) =>
  createHash("sha256").update(JSON.stringify([unit.userId, unit.type, unit.note, unit.from, unit.to, unit.hours?.start ?? "", unit.hours?.end ?? "", unit.status, normalizeCode(unit.code)])).digest("hex");

/**
 * A row as absences: one for whole days or given clock times; hours per day (Timmar or Omfattning) under the person's ordinary
 * day become hours from 07:00 – split into one per workday when the row spans several days (varying working time: the
 * person's own weekly time decides the day's length).
 */
export function unitsOfRow(row: AbsenceRow, member: ImportMember, type: AbsenceType, systemKey: string): { units: AbsenceUnit[]; issues: string[] } {
  if (!row.from || !row.to || !row.status) return { units: [], issues: [] };
  const issues: string[] = [];
  const base = row.externalId ? `id:${row.externalId}` : `row:${row.employeeNumber || row.email}|${normalizeCode(row.code)}|${row.from}|${row.startTime ?? ""}`;
  const key = `${systemKey}:${base}`.slice(0, 300);
  const note = type === "OTHER" ? row.code.slice(0, 120) : "";
  const make = (from: string, to: string, hours: AbsenceHours | null, suffix = ""): AbsenceUnit => {
    const unit = { userId: member.userId, type, note, from, to, hours, status: row.status!, code: row.code };
    return { ...unit, key: `${key}${suffix}`, hash: unitHash(unit) };
  };
  if (row.startTime && row.endTime) {
    if (row.from !== row.to) { issues.push("klockslag gäller en dag – raden läses som hela dagar"); return { units: [make(row.from, row.to, null)], issues }; }
    return { units: [make(row.from, row.to, { start: row.startTime, end: row.endTime })], issues };
  }
  const dayMinutes = Math.max(60, Math.round(member.weeklyWorkMinutes / 5));
  const partMinutes = row.hoursPerDay !== null ? Math.round(row.hoursPerDay * 60) : row.extent !== null ? Math.round((row.extent / 100) * dayMinutes) : null;
  if (partMinutes === null || partMinutes >= dayMinutes) return { units: [make(row.from, row.to, null)], issues };
  if (partMinutes <= 0) { issues.push("0 timmar – påverkar inte planeringen"); return { units: [], issues }; }
  const hours = { start: DAY_START, end: clockOf(Math.min(23 * 60 + 59, minutesOf(DAY_START) + partMinutes)) };
  if (row.from === row.to) return { units: [make(row.from, row.to, hours)], issues };
  const units: AbsenceUnit[] = [];
  for (let value = row.from, guard = 0; value <= row.to; value = nextDay(value), guard += 1) {
    if (guard > MAX_SPLIT_DAYS) { issues.push(`delvis frånvaro längre än ${MAX_SPLIT_DAYS} dagar – dela upp raden`); return { units: [], issues }; }
    if (isWorkday(value)) units.push(make(value, value, hours, `@${value}`));
  }
  return { units, issues };
}

const overlaps = (a: { from: string; to: string; hours: AbsenceHours | null }, b: { from: string; to: string; hours: AbsenceHours | null }) => {
  if (a.from > b.to || b.from > a.to) return false;
  if (a.hours && b.hours && a.from === b.from) return a.hours.start < b.hours.end && b.hours.start < a.hours.end;
  return true;
};
const describe = (absence: { type: AbsenceType; note: string; from: string; to: string; hours: AbsenceHours | null }) =>
  `${absence.type === "OTHER" && absence.note ? absence.note : ABSENCE_LABELS[absence.type]} ${absence.from === absence.to ? absence.from : `${absence.from}–${absence.to}`}${absence.hours ? ` ${absence.hours.start}–${absence.hours.end}` : ""}`;

/**
 * The preview: every row compared with the company's absences. `existing` must hold the matched people's absences that can
 * meet the file (by key or by dates); `systemKey` is the source system's key. Nothing is written here.
 */
export function previewAbsenceImport(input: { rows: AbsenceRow[]; members: readonly ImportMember[]; existing: readonly ExistingAbsence[]; codeMap: CodeMap; systemKey: string }): AbsencePreview {
  const byNumber = new Map(input.members.filter((member) => member.employeeNumber).map((member) => [normalizeCode(member.employeeNumber!), member]));
  const byEmail = new Map(input.members.map((member) => [member.email.trim().toLowerCase(), member]));
  const byKey = new Map(input.existing.filter((item) => item.externalKey && item.externalSystem === input.systemKey).map((item) => [item.externalKey!, item]));
  const seen = new Set<string>();
  const unknown = new Map<string, { code: string; suggestion: AbsenceType | null; rows: number }>();
  const suggested = new Map<string, AbsenceType>();
  // Absences this import already places, so two rows of the same file that overlap are said as well.
  const placed: { userId: string; from: string; to: string; hours: AbsenceHours | null; key: string }[] = [];
  const rows: PreviewRow[] = [];
  for (const row of input.rows) {
    const member = row.employeeNumber ? byNumber.get(normalizeCode(row.employeeNumber)) : row.email ? byEmail.get(row.email) : undefined;
    const base = { index: row.index, key: "", personName: member?.name ?? row.name, employeeNumber: row.employeeNumber, code: row.code, typeLabel: "", from: row.from ?? "", to: row.to ?? "", hours: null, statusLabel: row.status ? ABSENCE_STATUS_LABELS[row.status] : "" };
    const issues = [...row.issues];
    if (!member && (row.employeeNumber || row.email)) issues.push(row.employeeNumber ? `anställningsnummer ${row.employeeNumber} finns inte bland medarbetarna` : `e-posten ${row.email} är inte en aktiv medarbetare`);
    const mapped = row.code ? typeOfCode(row.code, input.codeMap) : { type: null, suggested: false };
    if (row.code && !mapped.type) {
      const known = unknown.get(normalizeCode(row.code)) ?? { code: row.code, suggestion: null, rows: 0 };
      unknown.set(normalizeCode(row.code), { ...known, rows: known.rows + 1 });
      issues.push(`koden ”${row.code}” är inte kopplad till någon typ`);
    }
    if (mapped.type && mapped.suggested && mapped.type !== "IGNORE") suggested.set(normalizeCode(row.code), mapped.type);
    if (issues.length || !member || !mapped.type) { rows.push({ ...base, action: "error", issues }); continue; }
    if (mapped.type === "IGNORE") { rows.push({ ...base, action: "ignored", typeLabel: "Hoppas över", issues: ["koden hoppas över enligt företagets koppling"] }); continue; }
    const { units, issues: unitIssues } = unitsOfRow(row, member, mapped.type, input.systemKey);
    if (!units.length) { rows.push({ ...base, action: unitIssues.some((issue) => issue.startsWith("0 timmar")) ? "ignored" : "error", issues: unitIssues }); continue; }
    for (const unit of units) {
      const shown = { ...base, key: unit.key, typeLabel: unit.type === "OTHER" ? unit.note : ABSENCE_LABELS[unit.type], from: unit.from, to: unit.to, hours: unit.hours, issues: [...unitIssues], unit };
      if (seen.has(unit.key)) { rows.push({ ...shown, action: "error", issues: [...shown.issues, "samma post finns två gånger i filen – den första används"] }); continue; }
      seen.add(unit.key);
      const current = byKey.get(unit.key);
      if (current && current.externalHash === unit.hash) { rows.push({ ...shown, action: "unchanged", existingId: current.id }); continue; }
      // Applied, rejected and withdrawn absence is not in planning, so it meets no other absence.
      const conflictWith = countsInPlanning(unit) ? input.existing.find((item) => item.id !== current?.id && item.userId === unit.userId && countsInPlanning(item) && overlaps(item, unit)) : undefined;
      const twin = countsInPlanning(unit) ? placed.find((item) => item.userId === unit.userId && overlaps(item, unit)) : undefined;
      if (twin) { rows.push({ ...shown, action: "error", issues: [...shown.issues, "överlappar en annan rad i filen för samma person"] }); continue; }
      if (countsInPlanning(unit)) placed.push({ userId: unit.userId, from: unit.from, to: unit.to, hours: unit.hours, key: unit.key });
      // Applied absence is kept (it may be approved later); rejected or withdrawn absence Workflow never had is not stored.
      if (!current && (unit.status === "REJECTED" || unit.status === "WITHDRAWN")) { rows.push({ ...shown, action: "ignored", issues: [...shown.issues, `${ABSENCE_STATUS_LABELS[unit.status].toLowerCase()} – påverkar inte planeringen`] }); continue; }
      if (conflictWith) {
        rows.push({ ...shown, action: "conflict", existingId: current?.id ?? null, conflict: { id: conflictWith.id, label: `${describe(conflictWith)} (${conflictWith.source === "MANUAL" ? "inlagd i Workflow" : "importerad tidigare"})`, manual: conflictWith.source === "MANUAL" } });
        continue;
      }
      rows.push({ ...shown, action: current ? "changed" : "new", existingId: current?.id ?? null });
    }
  }
  const counts: Record<PreviewAction, number> = { new: 0, changed: 0, unchanged: 0, conflict: 0, ignored: 0, error: 0 };
  for (const row of rows) counts[row.action] += 1;
  for (const [key, item] of unknown) { const guess = typeOfCode(item.code, {}); unknown.set(key, { ...item, suggestion: guess.type && guess.type !== "IGNORE" ? guess.type : null }); }
  return { rows, counts, unknownCodes: [...unknown.values()], suggestedCodes: [...suggested.entries()].map(([code, type]) => ({ code, type })), total: input.rows.length };
}

/** What the person decided for the conflicts: replace the other absence (it is withdrawn, never deleted) or keep it. */
export type ConflictChoice = "replace" | "keep";

/** The rows to write: new and changed ones, and conflicts the person chose to replace. */
export function rowsToWrite(preview: AbsencePreview, choices: Record<string, ConflictChoice>, skip: ReadonlySet<string> = new Set()) {
  return preview.rows.filter((row) => row.unit && !skip.has(row.key) && (row.action === "new" || row.action === "changed" || (row.action === "conflict" && choices[row.key] === "replace")));
}

/** Rows of a staff file as employee numbers for members, by e-mail; a number another member already has is a conflict. */
export function previewEmployeeNumbers(file: ExtractedFile, mapping: Record<string, string | null>, members: readonly ImportMember[]) {
  const byEmail = new Map(members.map((member) => [member.email.trim().toLowerCase(), member]));
  const taken = new Map(members.filter((member) => member.employeeNumber).map((member) => [normalizeCode(member.employeeNumber!), member]));
  const used = new Set<string>();
  return (file.rows ?? []).slice(0, MAX_ABSENCE_ROWS).flatMap((cells, index) => {
    if (!cells.some((value) => value && value.trim())) return [];
    const number = cell(file, cells, mapping, "employeeNumber").slice(0, 40); const email = cell(file, cells, mapping, "email").toLowerCase();
    const member = byEmail.get(email);
    const issues: string[] = [];
    if (!number) issues.push("saknar anställningsnummer");
    if (!member) issues.push(email ? `${email} är inte en aktiv medarbetare` : "saknar e-post");
    const other = number ? taken.get(normalizeCode(number)) : undefined;
    if (other && member && other.userId !== member.userId) issues.push(`numret används redan av ${other.name}`);
    if (number && used.has(normalizeCode(number))) issues.push("numret finns två gånger i filen");
    if (number) used.add(normalizeCode(number));
    const action: "new" | "changed" | "unchanged" | "error" = issues.length || !member ? "error" : member.employeeNumber === number ? "unchanged" : member.employeeNumber ? "changed" : "new";
    return [{ index, userId: member?.userId ?? "", personName: member?.name ?? cell(file, cells, mapping, "name"), email, employeeNumber: number, previous: member?.employeeNumber ?? null, action, issues }];
  });
}
