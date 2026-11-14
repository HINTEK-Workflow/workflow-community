import { z } from "zod";
import { ABSENCE_LABELS, ABSENCE_STATUSES, ABSENCE_STATUS_LABELS, isWorkday, type AbsenceHours, type AbsenceStatus, type AbsenceType } from "@/lib/workflow/absence";

/**
 * Export till lön och tid (2026-10-29): one generic engine for files to a time or payroll system. A template says which records
 * (absence or worked time), which columns in which order with which headings, and how the file is written (CSV/TSV/Excel,
 * delimiter, encoding, date format, decimal sign). No vendor's file specification is built in: the receiving system's import
 * template is set up to match (Flex HRM, for example, reads CSV/TXT/TSV through an import template the customer defines –
 * knowledge.flexhrm.com). New formats are new templates or a new writer here, never a second engine.
 *
 * Kept apart, never added together: absence (from the absence register), worked time per entry (project and work order time)
 * and worked time per day (the day's total, a payroll basis). One file holds one kind, so nothing is counted twice.
 *
 * Tidstyper (2026-10-29): worked time carries the entry's type (the company's own list) and the type's payroll code, so
 * a receiving system's import template can read the code column. "Per person, dag och tidstyp" gives one row per person, day
 * and type – the shape a time import in a payroll system usually wants. Workflow never computes pay; the codes say what it is.
 *
 * PAXml (2026-10-30): a third way to write the same data – an XML file in the open PAXml 2.0 format (paxml.se) that
 * systems which import PAXml read. Its writer is lib/payroll/paxml.ts. A PAXml file holds worked time and absence together:
 * the format keeps them apart by their time codes, so nothing is counted twice.
 */
export const EXPORT_KINDS = ["absence", "worked_time"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const EXPORT_KIND_LABELS: Record<ExportKind, string> = { absence: "Frånvaro", worked_time: "Arbetad tid" };

export const ABSENCE_EXPORT_FIELDS = {
  employeeNumber: "Anställningsnummer", name: "Namn", email: "E-post", code: "Tidkod", type: "Typ", from: "Från", to: "Till och med", date: "Datum",
  hours: "Timmar", startTime: "Från klockan", endTime: "Till klockan", extent: "Omfattning %", status: "Status", source: "Källa", fixed: "Fast text",
} as const;
export const WORKED_EXPORT_FIELDS = {
  employeeNumber: "Anställningsnummer", name: "Namn", email: "E-post", date: "Datum", hours: "Timmar", timeTypeCode: "Lönekod", timeType: "Tidstyp", project: "Projekt", workOrder: "Arbetsorder", customer: "Kund", fixed: "Fast text",
} as const;
export type ExportField = keyof typeof ABSENCE_EXPORT_FIELDS | keyof typeof WORKED_EXPORT_FIELDS;

export const EXPORT_FORMATS = ["csv", "xlsx", "paxml"] as const;
export const EXPORT_FORMAT_LABELS: Record<(typeof EXPORT_FORMATS)[number], string> = { csv: "Textfil (CSV/TSV)", xlsx: "Excel för granskning", paxml: "PAXml 2.0 (tid och frånvaro)" };
export const DATE_FORMATS =["YYYY-MM-DD", "YYYYMMDD", "YYMMDD", "DD.MM.YYYY", "DD/MM/YYYY"] as const;
export const ENCODINGS = ["utf-8", "utf-8-bom", "windows-1252"] as const;
export const ENCODING_LABELS: Record<(typeof ENCODINGS)[number], string> = { "utf-8": "UTF-8", "utf-8-bom": "UTF-8 med BOM", "windows-1252": "ANSI (Windows-1252)" };
export const DELIMITERS = [";", ",", "\t", "|"] as const;
export const DELIMITER_LABELS: Record<(typeof DELIMITERS)[number], string> = { ";": "Semikolon", ",": "Komma", "\t": "Tabb", "|": "Lodstreck" };

const columnSchema = z.object({ field: z.string().min(1).max(30), header: z.string().max(60).default(""), value: z.string().max(60).default("") });
export const exportTemplateSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1, "Ge mallen ett namn.").max(80),
  kind: z.enum(EXPORT_KINDS),
  /** paxml: the file's shape is the format's own (worked time per person, day and type, and absence per day); the columns and
   * the text settings only shape the preview. */
  format: z.enum(EXPORT_FORMATS).default("csv"),
  delimiter: z.enum(DELIMITERS).default(";"),
  encoding: z.enum(ENCODINGS).default("utf-8-bom"),
  dateFormat: z.enum(DATE_FORMATS).default("YYYY-MM-DD"),
  decimal: z.enum([",", "."]).default(","),
  header: z.boolean().default(true),
  /** absence: one row per absence (within the period) or one per workday; worked time: per entry, per person and day, or per
   * person, day and time type ("dayType"). */
  rowsPer: z.enum(["period", "day", "entry", "dayType"]).default("period"),
  statuses: z.array(z.enum(ABSENCE_STATUSES)).max(4).default(["APPROVED"]),
  extension: z.enum(["csv", "txt", "tsv"]).default("csv"),
  columns: z.array(columnSchema).min(1, "Välj minst en kolumn.").max(30),
}).superRefine((value, issues) => {
  const fields: Record<string, string> = value.kind === "absence" ? ABSENCE_EXPORT_FIELDS : WORKED_EXPORT_FIELDS;
  value.columns.forEach((column, index) => { if (!(column.field in fields)) issues.addIssue({ code: "custom", path: ["columns", index, "field"], message: "Okänd kolumn." }); });
  if (value.kind === "worked_time" && value.rowsPer === "period") issues.addIssue({ code: "custom", path: ["rowsPer"], message: "Arbetad tid exporteras per post eller per dag." });
  if (value.kind === "absence" && (value.rowsPer === "entry" || value.rowsPer === "dayType")) issues.addIssue({ code: "custom", path: ["rowsPer"], message: "Frånvaro exporteras per period eller per dag." });
  if (value.format === "paxml" && (value.kind !== "worked_time" || value.rowsPer !== "dayType")) issues.addIssue({ code: "custom", path: ["format"], message: "PAXml skrivs som tid per person, dag och tidstyp." });
});
export type ExportTemplate = z.infer<typeof exportTemplateSchema>;

const col = (field: ExportField, header?: string) => ({ field, header: header ?? (ABSENCE_EXPORT_FIELDS as Record<string, string>)[field] ?? (WORKED_EXPORT_FIELDS as Record<string, string>)[field], value: "" });
/** Workflow's own starting templates: general, to be adapted to the receiver's import template (not any vendor's format). */
export const PRESET_TEMPLATES: ExportTemplate[] = [
  { id: "preset-absence-period", name: "Frånvaro per period (CSV)", kind: "absence", format: "csv", delimiter: ";", encoding: "utf-8-bom", dateFormat: "YYYY-MM-DD", decimal: ",", header: true, rowsPer: "period", statuses: ["APPROVED"], extension: "csv",
    columns: [col("employeeNumber"), col("name"), col("code"), col("type"), col("from"), col("to"), col("hours"), col("startTime"), col("endTime")] },
  { id: "preset-absence-day", name: "Frånvaro per dag (TSV)", kind: "absence", format: "csv", delimiter: "\t", encoding: "utf-8", dateFormat: "YYYY-MM-DD", decimal: ",", header: true, rowsPer: "day", statuses: ["APPROVED"], extension: "txt",
    columns: [col("employeeNumber"), col("code"), col("date"), col("hours")] },
  { id: "preset-worked-day", name: "Arbetad tid per dag (CSV)", kind: "worked_time", format: "csv", delimiter: ";", encoding: "utf-8-bom", dateFormat: "YYYY-MM-DD", decimal: ",", header: true, rowsPer: "day", statuses: ["APPROVED"], extension: "csv",
    columns: [col("employeeNumber"), col("name"), col("date"), col("hours")] },
  // For a time import in a payroll system (2026-10-29): one row per person, day and type, the type's code. The receiver's
  // import template is set up to read it (in Flex HRM: the customer's own import template – delimiter, date format, field order).
  { id: "preset-worked-day-type", name: "Tid per dag och typ (för import i lönesystem)", kind: "worked_time", format: "csv", delimiter: ";", encoding: "utf-8-bom", dateFormat: "YYYY-MM-DD", decimal: ",", header: true, rowsPer: "dayType", statuses: ["APPROVED"], extension: "csv",
    columns: [col("employeeNumber"), col("date"), col("timeTypeCode"), col("hours")] },
  { id: "preset-worked-entry", name: "Projekttid per post (CSV)", kind: "worked_time", format: "csv", delimiter: ";", encoding: "utf-8-bom", dateFormat: "YYYY-MM-DD", decimal: ",", header: true, rowsPer: "entry", statuses: ["APPROVED"], extension: "csv",
    columns: [col("employeeNumber"), col("name"), col("date"), col("hours"), col("timeType"), col("timeTypeCode"), col("project"), col("workOrder"), col("customer")] },
  { id: "preset-absence-review", name: "Frånvaro för granskning (Excel)", kind: "absence", format: "xlsx", delimiter: ";", encoding: "utf-8", dateFormat: "YYYY-MM-DD", decimal: ",", header: true, rowsPer: "period", statuses: ["APPROVED", "APPLIED"], extension: "csv",
    columns: [col("employeeNumber"), col("name"), col("type"), col("code"), col("from"), col("to"), col("hours"), col("status"), col("source")] },
  // PAXml 2.0 (2026-10-30): worked time per person, day and type with the type's payroll code, and approved absence per
  // day with the company's export code, in one file for systems that import PAXml.
  { id: "preset-paxml", name: "Löneunderlag (PAXml)", kind: "worked_time", format: "paxml", delimiter: ";", encoding: "utf-8", dateFormat: "YYYY-MM-DD", decimal: ".", header: true, rowsPer: "dayType", statuses: ["APPROVED"], extension: "csv",
    columns: [col("employeeNumber"), col("date"), col("timeTypeCode"), col("hours")] },
];

/** `noFixedHours`: Ingen fast arbetstid (hourly staff) – a whole day of absence has no hours of its own then. */
export type ExportPerson = { userId: string; name: string; email: string; employeeNumber: string | null; weeklyWorkMinutes: number; noFixedHours?: boolean };
export type ExportAbsence = { userId: string; type: AbsenceType; note: string; from: string; to: string; hours: AbsenceHours | null; status: AbsenceStatus; sourceLabel: string; externalCode: string | null };
/** `timeType` and `timeTypeCode`: the entry's type (the standard type when it has none) and the type's payroll code. */
export type ExportTimeEntry = {
  userId: string; day: string; seconds: number; project: string; workOrder: string; customer: string; timeType: string; timeTypeCode: string;
  /** Beslut 8 (2026-11-01): false when the company does not count the type as worked time (travel by default); left out = it does. */
  workingTime?: boolean;
};

export function formatDate(value: string, format: ExportTemplate["dateFormat"]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-");
  return format === "YYYYMMDD" ? `${year}${month}${day}` : format === "YYMMDD" ? `${year.slice(2)}${month}${day}` : format === "DD.MM.YYYY" ? `${day}.${month}.${year}` : format === "DD/MM/YYYY" ? `${day}/${month}/${year}` : value;
}
export const formatHours = (minutes: number, decimal: "," | ".") => (Math.round((minutes / 60) * 100) / 100).toFixed(2).replace(".", decimal);
const minutesOf = (clock: string) => { const [hour, minute] = clock.split(":").map(Number); return hour * 60 + minute; };
export const nextDay = (value: string) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
/** A free text that a spreadsheet would read as a formula starts with an apostrophe (names come from people). */
export const safeText = (text: string) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);

/**
 * The workdays of an absence within the period and the minutes of each, counted as the files per day count them: the person's
 * own day (a fifth of the weekly time), part of a day as its hours. `minutes` is null for a whole day of a person without fixed
 * hours – there is no day of Workflow's own to count, so the receiving system's schedule decides.
 */
export function absenceWorkdays(absence: Pick<ExportAbsence, "from" | "to" | "hours">, person: Pick<ExportPerson, "weeklyWorkMinutes" | "noFixedHours">, from: string, to: string) {
  const dayMinutes = person.noFixedHours ? 0 : Math.max(0, Math.round(person.weeklyWorkMinutes / 5));
  const days: { day: string; minutes: number | null; whole: boolean }[] = [];
  const start = absence.from < from ? from : absence.from;
  const end = absence.to > to ? to : absence.to;
  for (let day = start, guard = 0; day <= end && guard < 400; day = nextDay(day), guard += 1) {
    if (!isWorkday(day)) continue;
    if (absence.hours) {
      const minutes = Math.max(0, minutesOf(absence.hours.end) - minutesOf(absence.hours.start));
      if (minutes) days.push({ day, minutes: Math.min(dayMinutes || 1440, minutes), whole: false });
    } else if (dayMinutes) days.push({ day, minutes: dayMinutes, whole: true });
    else if (person.noFixedHours) days.push({ day, minutes: null, whole: true });
  }
  return days;
}

/** The time code of an absence: the company's export code for the type, else the code it was imported with, else empty. */
export const exportCodeOf = (absence: Pick<ExportAbsence, "type" | "externalCode">, exportCodes: Partial<Record<AbsenceType, string>>) => exportCodes[absence.type] || absence.externalCode || "";

/** Whether a worked-time file says which type of time each row is: a column with the type's name or its code. */
const namesTimeType = (template: Pick<ExportTemplate, "columns">) => template.columns.some((column) => column.field === "timeType" || column.field === "timeTypeCode");

/**
 * Beslut 8 (2026-11-01): time the company does not count as worked time (travel by default) stays out of a day's total. A file
 * with a column for the type gets it as a row of its own with its code. A file without one could not tell the rows apart and a
 * payroll import would add them to the worked time, so that time is left out and exportLeftOut says so in the preview.
 */
const leftOutOfFile = (template: Pick<ExportTemplate, "columns">, entry: Pick<ExportTimeEntry, "workingTime">) => entry.workingTime === false && !namesTimeType(template);

/** The lines the preview shows when a template leaves time out: the type and its hours, and what to do about it. */
export function exportLeftOut(input: { template: ExportTemplate; from: string; to: string; people: readonly ExportPerson[]; entries?: readonly ExportTimeEntry[]; userIds?: readonly string[] | null }): string[] {
  if (input.template.kind !== "worked_time" || input.template.format === "paxml") return [];
  const known = new Set(input.people.map((person) => person.userId));
  const seconds = new Map<string, number>();
  for (const entry of input.entries ?? []) {
    if (!known.has(entry.userId) || (input.userIds?.length && !input.userIds.includes(entry.userId)) || entry.day < input.from || entry.day > input.to || entry.seconds <= 0 || !leftOutOfFile(input.template, entry)) continue;
    const name = entry.timeType || "Utan tidstyp";
    seconds.set(name, (seconds.get(name) ?? 0) + entry.seconds);
  }
  return [...seconds].sort(([a], [b]) => a.localeCompare(b, "sv")).map(([name, total]) => `${name} (${formatHours(total / 60, ",")} h) räknas inte som arbetad tid och finns inte med i filen. Välj en mall med kolumnen Tidstyp eller Lönekod för att få med den.`);
}

/** The rows of a file (without the heading): absence clipped to the period, or worked time per entry or day. */
export function exportRows(input: {
  template: ExportTemplate; from: string; to: string; people: readonly ExportPerson[];
  absences?: readonly ExportAbsence[]; entries?: readonly ExportTimeEntry[]; exportCodes?: Partial<Record<AbsenceType, string>>; userIds?: readonly string[] | null;
}): string[][] {
  const { template } = input;
  const people = new Map(input.people.map((person) => [person.userId, person]));
  const included = (userId: string) => people.has(userId) && (!input.userIds?.length || input.userIds.includes(userId));
  const date = (value: string) => formatDate(value, template.dateFormat);
  const rows: { userId: string; sort: string; values: Record<string, string> }[] = [];
  const personValues = (person: ExportPerson) => ({ employeeNumber: person.employeeNumber ?? "", name: safeText(person.name), email: person.email });
  if (template.kind === "absence") {
    for (const absence of input.absences ?? []) {
      if (!included(absence.userId) || !template.statuses.includes(absence.status) || absence.to < input.from || absence.from > input.to) continue;
      const person = people.get(absence.userId)!;
      const dayMinutes = Math.max(0, Math.round(person.weeklyWorkMinutes / 5));
      const minutesOn = (day: string) => !isWorkday(day) ? 0 : absence.hours ? Math.min(dayMinutes || 1440, Math.max(0, minutesOf(absence.hours.end) - minutesOf(absence.hours.start))) : dayMinutes;
      const from = absence.from < input.from ? input.from : absence.from;
      const to = absence.to > input.to ? input.to : absence.to;
      const base = { ...personValues(person), code: exportCodeOf(absence, input.exportCodes ?? {}), type: absence.type === "OTHER" && absence.note ? safeText(absence.note) : ABSENCE_LABELS[absence.type],
        startTime: absence.hours?.start ?? "", endTime: absence.hours?.end ?? "", status: ABSENCE_STATUS_LABELS[absence.status], source: absence.sourceLabel,
        extent: absence.hours && dayMinutes ? String(Math.round((minutesOn(absence.from) / dayMinutes) * 100)) : "100" };
      if (template.rowsPer === "day") {
        for (let day = from, guard = 0; day <= to && guard < 400; day = nextDay(day), guard += 1) {
          const minutes = minutesOn(day);
          if (!minutes) continue;
          rows.push({ userId: absence.userId, sort: day, values: { ...base, from: date(day), to: date(day), date: date(day), hours: formatHours(minutes, template.decimal) } });
        }
      } else {
        let minutes = 0;
        for (let day = from, guard = 0; day <= to && guard < 400; day = nextDay(day), guard += 1) minutes += minutesOn(day);
        rows.push({ userId: absence.userId, sort: from, values: { ...base, from: date(from), to: date(to), date: date(from), hours: formatHours(minutes, template.decimal) } });
      }
    }
  } else {
    // Per day: the day's total (the type only when the whole day is one type). Per day and type: one row per type.
    const byDay = new Map<string, { userId: string; day: string; seconds: number; types: Set<string>; timeType: string; timeTypeCode: string }>();
    for (const entry of input.entries ?? []) {
      if (!included(entry.userId) || entry.day < input.from || entry.day > input.to || entry.seconds <= 0 || leftOutOfFile(template, entry)) continue;
      const person = people.get(entry.userId)!;
      if (template.rowsPer === "day" || template.rowsPer === "dayType") {
        const typeKey = `${entry.timeType}|${entry.timeTypeCode}`;
        // A day's total holds worked time only; a type that is not worked time keeps a row of its own, with its code, so it still reaches the payroll system.
        const key = template.rowsPer === "day" && entry.workingTime !== false ? `${entry.userId}|${entry.day}` : `${entry.userId}|${entry.day}|${typeKey}`;
        const current = byDay.get(key) ?? { userId: entry.userId, day: entry.day, seconds: 0, types: new Set<string>(), timeType: entry.timeType, timeTypeCode: entry.timeTypeCode };
        current.types.add(typeKey);
        byDay.set(key, { ...current, seconds: current.seconds + entry.seconds });
      } else rows.push({ userId: entry.userId, sort: `${entry.day}|${entry.timeType}`, values: { ...personValues(person), date: date(entry.day), hours: formatHours(entry.seconds / 60, template.decimal),
        timeType: safeText(entry.timeType), timeTypeCode: safeText(entry.timeTypeCode), project: safeText(entry.project), workOrder: safeText(entry.workOrder), customer: safeText(entry.customer) } });
    }
    for (const item of byDay.values()) {
      const oneType = item.types.size === 1;
      rows.push({ userId: item.userId, sort: `${item.day}|${item.timeType}`, values: { ...personValues(people.get(item.userId)!), date: date(item.day), hours: formatHours(item.seconds / 60, template.decimal),
        timeType: oneType ? safeText(item.timeType) : "", timeTypeCode: oneType ? safeText(item.timeTypeCode) : "", project: "", workOrder: "", customer: "" } });
    }
  }
  const nameOf = (userId: string) => people.get(userId)?.name ?? "";
  rows.sort((a, b) => nameOf(a.userId).localeCompare(nameOf(b.userId), "sv") || a.sort.localeCompare(b.sort));
  return rows.map((row) => template.columns.map((column) => column.field === "fixed" ? column.value : row.values[column.field] ?? ""));
}

/** What the preview warns about: rows without an employee number, and rows without a payroll code for the time type. */
export function exportGaps(template: ExportTemplate, rows: readonly (readonly string[])[]) {
  const empty = (field: ExportField) => { const index = template.columns.findIndex((column) => column.field === field); return index >= 0 ? rows.filter((row) => !row[index]).length : 0; };
  return { withoutNumber: empty("employeeNumber"), withoutCode: template.kind === "worked_time" ? empty("timeTypeCode") : 0 };
}

export const headerRow = (template: ExportTemplate) => template.columns.map((column) => column.header || (template.kind === "absence" ? (ABSENCE_EXPORT_FIELDS as Record<string, string>) : (WORKED_EXPORT_FIELDS as Record<string, string>))[column.field] || column.field);

/** A delimited text: quoted only where needed (the delimiter, a quote or a line break), CRLF line ends. */
export function delimitedText(rows: readonly (readonly string[])[], delimiter: string) {
  const quote = (value: string) => (value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value);
  return rows.map((row) => row.map(quote).join(delimiter)).join("\r\n") + (rows.length ? "\r\n" : "");
}

// Windows-1252's characters 0x80–0x9F (the rest of 0x00–0xFF is Latin-1).
const CP1252: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };

/** Text → bytes in the template's encoding; a character Windows-1252 lacks becomes "?". */
export function encodeText(text: string, encoding: ExportTemplate["encoding"]): Uint8Array {
  if (encoding !== "windows-1252") {
    const bytes = new TextEncoder().encode(text);
    if (encoding !== "utf-8-bom") return bytes;
    const out = new Uint8Array(bytes.length + 3); out.set([0xef, 0xbb, 0xbf]); out.set(bytes, 3); return out;
  }
  const out = new Uint8Array(text.length);
  let length = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    out[length++] = code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : CP1252[code] ?? 0x3f;
  }
  return out.slice(0, length);
}

/** A template's name as a file name part: lower case a–z, digits and hyphens, Swedish letters spelled out, at most 48 characters. */
export const templateSlug = (name: string) => name.toLocaleLowerCase("sv-SE").replace(/[åä]/g, "a").replace(/ö/g, "o").normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "") || "export";

/**
 * Filnamn per mall, format och period (användartest 2026-10-31: två mallar gav samma namn, arbetad-tid-<period>.csv): the
 * template's own name, the period and the format's ending – "projekttid-per-post-csv-2026-11-01-2026-11-30.csv". Two templates
 * of a company never share a name part (templateNameClash), so two files of the same period never share one either.
 */
export const exportFileName = (template: ExportTemplate, from: string, to: string) =>
  `${templateSlug(template.name)}-${from}-${to}.${template.format === "paxml" ? "xml" : template.format === "xlsx" ? "xlsx" : template.extension}`;

/** The template whose file name a template would share (the same name part), or null: an own template is saved only without one. */
export function templateNameClash<T extends Pick<ExportTemplate, "id" | "name">>(template: Pick<ExportTemplate, "id" | "name">, others: readonly T[]): T | null {
  const slug = templateSlug(template.name);
  return others.find((item) => item.id !== template.id && templateSlug(item.name) === slug) ?? null;
}

/**
 * Spärrar i löneexporten (2026-10-31, användartest S5/F5): a file to the payroll system is made only when it can be
 * imported as it is. `empty`: nothing in the period – no file at all (it used to download a file with only a heading).
 * `problems`: one line per person without an employee number and per time type without a payroll code among the period's
 * records – the file is refused until they are fixed. PAXml's own problems (also an absence type without an export code, a
 * code that is no PAXml time code) come from paxmlTransactions. The Excel file is for review, so only an empty one is
 * stopped; a column the template does not have is never asked for.
 */
export function exportBlockers(input: Parameters<typeof exportRows>[0] & { rowCount: number; paxmlProblems?: readonly string[] }): { empty: boolean; problems: string[] } {
  const { template } = input;
  if (template.format === "paxml") {
    const problems = [...(input.paxmlProblems ?? [])];
    return { empty: !input.rowCount && !problems.length, problems };
  }
  if (template.format === "xlsx") return { empty: !input.rowCount, problems: [] };
  const people = new Map(input.people.map((person) => [person.userId, person]));
  const included = (userId: string) => people.has(userId) && (!input.userIds?.length || input.userIds.includes(userId));
  const used = new Set<string>();
  const typesWithoutCode = new Set<string>();
  if (template.kind === "absence") {
    for (const absence of input.absences ?? []) {
      if (included(absence.userId) && template.statuses.includes(absence.status) && absence.to >= input.from && absence.from <= input.to) used.add(absence.userId);
    }
  } else {
    for (const entry of input.entries ?? []) {
      if (!included(entry.userId) || entry.day < input.from || entry.day > input.to || entry.seconds <= 0 || leftOutOfFile(template, entry)) continue;
      used.add(entry.userId);
      if (!entry.timeTypeCode.trim()) typesWithoutCode.add(entry.timeType || "Utan tidstyp");
    }
  }
  const has = (field: ExportField) => template.columns.some((column) => column.field === field);
  const byName = (a: string, b: string) => a.localeCompare(b, "sv");
  const problems = [
    ...(has("employeeNumber") ? [...used].map((userId) => people.get(userId)!).filter((person) => !(person.employeeNumber ?? "").trim()).map((person) => `${person.name} saknar anställningsnummer`).sort(byName) : []),
    ...(template.kind === "worked_time" && has("timeTypeCode") ? [...typesWithoutCode].sort(byName).map((type) => `Tidstypen ${type} saknar lönekod`) : []),
  ];
  return { empty: !input.rowCount && !problems.length, problems };
}

/** Where employee numbers and payroll codes are set, named in the refusal. */
export const PAYROLL_SETTINGS_PLACE = "Tid → Lön och export";

/** The message when no file is made, or null when it may be: what is missing, one line each (the first 20), and where it is fixed. */
export function exportRefusal(block: { empty: boolean; problems: readonly string[] }): string | null {
  if (block.problems.length) {
    const shown = block.problems.slice(0, 20).map((line) => `– ${line}.`);
    if (block.problems.length > 20) shown.push(`– och ${block.problems.length - 20} till.`);
    return ["Ingen fil skapades. Lönesystemet kan inte läsa filen förrän det här är rättat:", ...shown, `Rätta under ${PAYROLL_SETTINGS_PLACE}.`].join("\n");
  }
  return block.empty ? "Inget att exportera för perioden. Ingen fil skapades." : null;
}
