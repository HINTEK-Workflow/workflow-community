import { ABSENCE_LABELS, type AbsenceStatus, type AbsenceType } from "@/lib/workflow/absence";
import { absenceWorkdays, exportCodeOf, type ExportAbsence, type ExportPerson, type ExportTimeEntry } from "./export";

/**
 * PAXml 2.0 (2026-10-30): the writer of the export engine's PAXml format, the open Swedish format for a payroll basis
 * from a time system to a payroll program (paxml.se, the technical description of 2013-03-13 and its schema paxml.xsd).
 * Only what Workflow knows is written: a header and time transactions (`tidtransaktioner`).
 * - Worked time: one `tidtrans` per person, day and time type, the type's payroll code as `tidkod`, the hours as `timmar`.
 * - Absence: one `tidtrans` per workday with the company's export code for the type and the day's hours. A whole day of a person
 *   without fixed hours has no hours: the format then means the whole day after the receiving system's schedule.
 * - The person is `anstid`, the employee number. Personal identity numbers are never written.
 * The schema only accepts the format's own time codes, so a code outside that list – like a person without an employee number
 * or a type without a code – is reported as an error and its rows are not written. Dates are YYYY-MM-DD, hours have a decimal
 * point, the file is ISO-8859-1 as in the format's own examples (a character outside it is written as a character reference).
 */

/** The time codes the schema accepts in `tidkod` (absence, balances, presence and additions), in the format's order. */
export const PAXML_TIME_CODES = [
  "SJK", "SJK_KAR", "SJK_LÖN", "SJK_ERS", "SJK_PEN", "ASK", "HAV", "FPE", "VAB", "SMB", "UTB", "MIL", "SVE", "NÄR", "TJL", "SEM", "SEM_BET", "SEM_SPA", "SEM_OBE", "SEM_FÖR",
  "KOM", "PEM", "PER", "FAC", "ATK", "KON", "PAP", "ATF", "FR1", "FR2", "FR3", "FR4", "FR5", "FR6", "FR7", "FR8", "FR9",
  "FLX", "SCH", "TS1", "TS2", "TS3", "TS4", "TS5", "TS6", "TS7", "TS8", "TS9",
  "TID", "ARB", "MER", "ÖT1", "ÖT2", "ÖT3", "ÖT4", "ÖT5", "ÖK1", "ÖK2", "ÖK3", "ÖK4", "ÖK5",
  "OB1", "OB2", "OB3", "OB4", "OB5", "OS1", "OS2", "OS3", "OS4", "OS5", "JR1", "JR2", "JR3", "JS1", "JS2", "JS3", "BE1", "BE2", "BE3", "BS1", "BS2", "BS3", "RE1", "RE2", "RE3",
  "HLG", "SKI", "LT1", "LT2", "LT3", "LT4", "LT5", "LT6", "LT7", "LT8", "LT9", "NV1", "NV2", "NV3", "NV4", "NV5", "NV6", "NV7", "NV8", "NV9",
] as const;
const TIME_CODES = new Set<string>(PAXML_TIME_CODES);
/** A code as the format writes it (upper case, Swedish letters kept), or null when it is not one of the format's time codes. */
export const paxmlTimeCode = (code: string) => { const value = code.normalize("NFC").trim().toLocaleUpperCase("sv-SE"); return TIME_CODES.has(value) ? value : null; };

/** `minutes` null: a whole day after the receiving system's schedule (no `timmar`). */
export type PaxmlTransaction = { userId: string; name: string; employeeNumber: string; date: string; code: string; minutes: number | null; kind: "worked" | "absence"; label: string };

/**
 * The transactions of a period and what keeps rows out: a person without an employee number, a type without a code, a code that
 * is not one of the format's. Each problem is one line with the number of rows it keeps out.
 */
/** The employee id's length in the format's description (the schema itself has no limit). */
export const PAXML_EMPLOYEE_NUMBER_LENGTH = 12;

export function paxmlTransactions(input: {
  from: string; to: string; people: readonly ExportPerson[]; entries?: readonly ExportTimeEntry[]; absences?: readonly ExportAbsence[];
  exportCodes?: Partial<Record<AbsenceType, string>>; statuses?: readonly AbsenceStatus[]; userIds?: readonly string[] | null;
}): { transactions: PaxmlTransaction[]; errors: string[]; warnings: string[]; problems: string[] } {
  const people = new Map(input.people.map((person) => [person.userId, person]));
  const included = (userId: string) => people.has(userId) && (!input.userIds?.length || input.userIds.includes(userId));
  const statuses = input.statuses ?? ["APPROVED"];
  const problems = new Map<string, number>();
  const problem = (text: string) => problems.set(text, (problems.get(text) ?? 0) + 1);
  const transactions: PaxmlTransaction[] = [];
  // The format's description gives the employee id 12 characters; the schema does not limit it, so a longer one is written
  // and named as a warning – the receiving system may cut or refuse it (2026-10-30).
  const longNumbers = new Set<string>();
  const add = (person: ExportPerson, row: Omit<PaxmlTransaction, "userId" | "name" | "employeeNumber" | "code">, rawCode: string, missing: string, owner: string) => {
    const number = (person.employeeNumber ?? "").trim();
    const code = paxmlTimeCode(rawCode);
    if (!number) problem(`${person.name} saknar anställningsnummer`);
    else if (!rawCode.trim()) problem(missing);
    else if (!code) problem(`Koden ${rawCode.trim()} (${owner}) är ingen tidkod i PAXml`);
    else {
      if (number.length > PAXML_EMPLOYEE_NUMBER_LENGTH) longNumbers.add(person.name);
      transactions.push({ ...row, userId: person.userId, name: person.name, employeeNumber: number, code });
    }
  };

  // Worked time: the day's total per person and type.
  const byDayType = new Map<string, { userId: string; day: string; seconds: number; timeType: string; code: string }>();
  for (const entry of input.entries ?? []) {
    if (!included(entry.userId) || entry.day < input.from || entry.day > input.to || entry.seconds <= 0) continue;
    const key = `${entry.userId}|${entry.day}|${entry.timeType}|${entry.timeTypeCode}`;
    const current = byDayType.get(key) ?? { userId: entry.userId, day: entry.day, seconds: 0, timeType: entry.timeType, code: entry.timeTypeCode };
    byDayType.set(key, { ...current, seconds: current.seconds + entry.seconds });
  }
  for (const item of byDayType.values()) {
    const type = item.timeType || "Utan tidstyp";
    add(people.get(item.userId)!, { date: item.day, minutes: item.seconds / 60, kind: "worked", label: type }, item.code, `Tidstypen ${type} saknar lönekod`, `tidstypen ${type}`);
  }

  // Absence: per workday, with the company's export code (or the code it was imported with).
  for (const absence of input.absences ?? []) {
    if (!included(absence.userId) || !statuses.includes(absence.status) || absence.to < input.from || absence.from > input.to) continue;
    const person = people.get(absence.userId)!;
    const label = ABSENCE_LABELS[absence.type];
    const code = exportCodeOf(absence, input.exportCodes ?? {});
    for (const day of absenceWorkdays(absence, person, input.from, input.to)) add(person, { date: day.day, minutes: day.minutes, kind: "absence", label }, code, `Frånvarotypen ${label} saknar exportkod`, label.toLowerCase());
  }

  const order = (a: PaxmlTransaction, b: PaxmlTransaction) => a.name.localeCompare(b.name, "sv") || a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "worked" ? -1 : 1) || a.code.localeCompare(b.code, "sv");
  const errors = [...problems.entries()].map(([text, count]) => `${text} – ${count} ${count === 1 ? "rad är" : "rader är"} inte med.`).sort((a, b) => a.localeCompare(b, "sv"));
  const warnings = [...longNumbers].sort((a, b) => a.localeCompare(b, "sv")).map((name) => `${name}s anställningsnummer är längre än ${PAXML_EMPLOYEE_NUMBER_LENGTH} tecken – kontrollera att lönesystemet tar emot det.`);
  // The problems themselves without the counts: what keeps the file from being made (exportBlockers in ./export).
  const kept = [...problems.keys()].sort((a, b) => a.localeCompare(b, "sv"));
  return { transactions: transactions.sort(order), errors, warnings, problems: kept };
}

/** Text for an XML element or attribute: the five special characters escaped, characters XML 1.0 forbids removed. */
export function xmlText(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
/** Hours with a decimal point and two decimals (the schema's decimal type). */
export const paxmlHours = (minutes: number) => (Math.round((minutes / 60) * 100) / 100).toFixed(2);

/**
 * The document. `createdAt` is the export's local date and time (YYYY-MM-DDTHH:MM:SS). Transactions without a date or code are
 * never passed here; `paxmlTransactions` keeps them out.
 */
export function paxmlDocument(input: { transactions: readonly PaxmlTransaction[]; createdAt: string; company?: string }) {
  const lines = [
    `<?xml version="1.0" encoding="ISO-8859-1"?>`,
    `<paxml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.paxml.se/2.0/paxml.xsd">`,
    "  <header>",
    "    <format>LÖNIN</format>",
    "    <version>2.0</version>",
    `    <datum>${xmlText(input.createdAt)}</datum>`,
    ...(input.company?.trim() ? [`    <foretagnamn>${xmlText(input.company.trim())}</foretagnamn>`] : []),
    "    <programnamn>Workflow</programnamn>",
    "  </header>",
  ];
  if (input.transactions.length) {
    lines.push("  <tidtransaktioner>");
    for (const item of input.transactions) {
      lines.push(`    <tidtrans anstid="${xmlText(item.employeeNumber)}">`, `      <tidkod>${xmlText(item.code)}</tidkod>`, `      <datum>${xmlText(item.date)}</datum>`);
      if (item.minutes !== null) lines.push(`      <timmar>${paxmlHours(item.minutes)}</timmar>`);
      lines.push("    </tidtrans>");
    }
    lines.push("  </tidtransaktioner>");
  }
  lines.push("</paxml>");
  return lines.join("\r\n") + "\r\n";
}

/** ISO-8859-1 bytes; a character outside it becomes a numeric character reference, which every XML reader resolves. */
export function latin1Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code <= 0xff) out.push(code);
    else for (const byte of `&#${code};`) out.push(byte.charCodeAt(0));
  }
  return Uint8Array.from(out);
}

/** The preview's columns and rows (hours with a decimal comma, as the other previews show them). */
export const PAXML_PREVIEW_HEADER = ["Anställningsnummer", "Namn", "Datum", "Tidkod", "Timmar", "Avser"];
export const paxmlPreviewRows = (transactions: readonly PaxmlTransaction[]) =>
  transactions.map((item) => [item.employeeNumber, item.name, item.date, item.code, item.minutes === null ? "Hel dag" : paxmlHours(item.minutes).replace(".", ","), `${item.kind === "worked" ? "Arbetad tid" : "Frånvaro"}: ${item.label}`]);
