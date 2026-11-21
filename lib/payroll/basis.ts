import { ABSENCE_LABELS, ABSENCE_TYPES, type AbsenceType } from "@/lib/workflow/absence";
import { absenceWorkdays, delimitedText, encodeText, exportCodeOf, formatHours, safeText, type ExportAbsence, type ExportPerson, type ExportTimeEntry } from "./export";
import { MONTH_STATUS_LABELS, monthsBetween, type MonthStatus } from "./periods";

/**
 * Löneunderlag per period (2026-10-30): one summary per person for a month or a chosen period – hours per time type with
 * its payroll code, approved absence per type with its export code (workdays and hours), the totals and the month's status. It
 * is read by a person before the pay run, as a PDF or a CSV; the same rows go to the payroll system by the export. Workflow
 * never computes pay. The reason of an absence is never shown, only its type.
 */
/** `workingTime` false: a type the company does not count as worked time (beslut 8): a row of its own, outside the sum of worked time. */
export type BasisWorked = { timeType: string; code: string; minutes: number; workingTime: boolean };
export type BasisAbsence = { type: AbsenceType; label: string; code: string; days: number; minutes: number };
export type BasisPerson = {
  userId: string; name: string; employeeNumber: string;
  months: { month: string; status: MonthStatus }[];
  worked: BasisWorked[]; absence: BasisAbsence[]; workedMinutes: number; absenceMinutes: number;
  /** Hours of types that are not worked time (travel by default). */
  otherMinutes: number;
};

/** The persons with time or approved absence in the period, by name. Absences already filtered to approved months if asked. */
export function payrollBasis(input: {
  from: string; to: string; people: readonly ExportPerson[]; entries: readonly ExportTimeEntry[]; absences: readonly ExportAbsence[];
  exportCodes?: Partial<Record<AbsenceType, string>>; statusOf: (userId: string, month: string) => MonthStatus; userIds?: readonly string[] | null;
}): BasisPerson[] {
  const people = new Map(input.people.map((person) => [person.userId, person]));
  const included = (userId: string) => people.has(userId) && (!input.userIds?.length || input.userIds.includes(userId));
  const worked = new Map<string, Map<string, BasisWorked>>();
  const absence = new Map<string, Map<AbsenceType, BasisAbsence & { dayKeys: Set<string> }>>();
  for (const entry of input.entries) {
    if (!included(entry.userId) || entry.day < input.from || entry.day > input.to || entry.seconds <= 0) continue;
    const own = worked.get(entry.userId) ?? new Map<string, BasisWorked>();
    const key = `${entry.timeType}|${entry.timeTypeCode}`;
    const current = own.get(key) ?? { timeType: entry.timeType || "Utan tidstyp", code: entry.timeTypeCode, minutes: 0, workingTime: entry.workingTime !== false };
    own.set(key, { ...current, minutes: current.minutes + entry.seconds / 60 });
    worked.set(entry.userId, own);
  }
  for (const item of input.absences) {
    if (!included(item.userId) || item.status !== "APPROVED" || item.to < input.from || item.from > input.to) continue;
    const days = absenceWorkdays(item, people.get(item.userId)!, input.from, input.to);
    if (!days.length) continue;
    const own = absence.get(item.userId) ?? new Map();
    const current = own.get(item.type) ?? { type: item.type, label: ABSENCE_LABELS[item.type], code: exportCodeOf(item, input.exportCodes ?? {}), days: 0, minutes: 0, dayKeys: new Set<string>() };
    for (const day of days) { current.dayKeys.add(day.day); current.minutes += day.minutes ?? 0; }
    current.days = current.dayKeys.size;
    own.set(item.type, current);
    absence.set(item.userId, own);
  }
  const months = monthsBetween(input.from, input.to);
  const userIds = [...new Set([...worked.keys(), ...absence.keys()])];
  return userIds.map((userId) => {
    const person = people.get(userId)!;
    const ownWorked = [...(worked.get(userId)?.values() ?? [])].sort((a, b) => b.minutes - a.minutes || a.timeType.localeCompare(b.timeType, "sv"));
    const ownAbsence = [...(absence.get(userId)?.values() ?? [])].sort((a, b) => ABSENCE_TYPES.indexOf(a.type) - ABSENCE_TYPES.indexOf(b.type)).map(({ dayKeys, ...rest }) => { void dayKeys; return rest; });
    return {
      userId, name: person.name, employeeNumber: (person.employeeNumber ?? "").trim(),
      months: months.map((month) => ({ month, status: input.statusOf(userId, month) })),
      worked: ownWorked, absence: ownAbsence,
      workedMinutes: ownWorked.reduce((sum, item) => sum + (item.workingTime ? item.minutes : 0), 0), absenceMinutes: ownAbsence.reduce((sum, item) => sum + item.minutes, 0),
      otherMinutes: ownWorked.reduce((sum, item) => sum + (item.workingTime ? 0 : item.minutes), 0),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

/** The month's status as one text: "Godkänd", or per month when the period spans several ("2026-10 Godkänd, 2026-11 Öppen"). */
export const basisStatusText = (person: Pick<BasisPerson, "months">) => person.months.length === 1 ? MONTH_STATUS_LABELS[person.months[0].status]
  : person.months.map((item) => `${item.month} ${MONTH_STATUS_LABELS[item.status]}`).join(", ");

/** What a reader checks before the pay run: missing employee numbers and codes. */
export function basisGaps(people: readonly BasisPerson[]) {
  const lines: string[] = [];
  for (const person of people) {
    if (!person.employeeNumber) lines.push(`${person.name} saknar anställningsnummer.`);
    for (const item of person.worked) if (!item.code.trim()) lines.push(`${person.name}: tidstypen ${item.timeType} saknar lönekod.`);
    for (const item of person.absence) if (!item.code.trim()) lines.push(`${person.name}: frånvarotypen ${item.label} saknar exportkod.`);
  }
  return lines;
}

/** What a row of hours is called: worked time, or other time when the company does not count the type as worked time. */
export const basisKind = (item: Pick<BasisWorked, "workingTime">) => item.workingTime ? "Arbetad tid" : "Annan tid";

export const BASIS_CSV_HEADER = ["Anställningsnummer", "Namn", "Månadsstatus", "Slag", "Typ", "Kod", "Dagar", "Timmar"];
/** The rows of the CSV: a line per type, then the person's two totals. Hours with a decimal comma. */
export function basisRows(people: readonly BasisPerson[]) {
  const rows: string[][] = [];
  for (const person of people) {
    const base = [person.employeeNumber, safeText(person.name), basisStatusText(person)];
    for (const item of person.worked) rows.push([...base, basisKind(item), safeText(item.timeType), safeText(item.code), "", formatHours(item.minutes, ",")]);
    for (const item of person.absence) rows.push([...base, "Frånvaro", item.label, safeText(item.code), String(item.days), formatHours(item.minutes, ",")]);
    rows.push([...base, "Summa arbetad tid", "", "", "", formatHours(person.workedMinutes, ",")]);
    if (person.otherMinutes > 0) rows.push([...base, "Summa annan tid", "", "", "", formatHours(person.otherMinutes, ",")]);
    rows.push([...base, "Summa frånvaro", "", "", String(person.absence.reduce((sum, item) => sum + item.days, 0)), formatHours(person.absenceMinutes, ",")]);
  }
  return rows;
}
/** The CSV file: semicolons and UTF-8 with BOM, as a spreadsheet in Swedish opens it. */
export const basisCsv = (people: readonly BasisPerson[]) => encodeText(delimitedText([BASIS_CSV_HEADER, ...basisRows(people)], ";"), "utf-8-bom");
export const basisFileName = (from: string, to: string, extension: "pdf" | "csv") => `loneunderlag-${from}-${to}.${extension}`;
