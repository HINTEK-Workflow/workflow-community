import type { AbsenceHours } from "@/lib/workflow/absence";
import type { PayrollSystem } from "./codes";

/**
 * Leverantörsadaptrar (2026-10-29): what a time or payroll system's API must give Workflow, kept apart from the generic absence
 * handling. An adapter only reads (staff, absence, absence codes and, where the system has them, balances it computes itself);
 * Workflow never writes back on its own and never computes a balance. What an adapter returns goes through the same preview and
 * write path as a file (lib/payroll/absence-import.ts), so an API source is locked and keyed exactly like an imported file.
 *
 * Only endpoints that are published and verified may be called. Flex HRM's Web API is not publicly documented (flexhrm.com
 * lists "Webb-API" and refers to support), so its adapter is a switched-off placeholder until Flex provides the documentation
 * and a test account – no endpoint is guessed.
 */
export type ExternalEmployee = { externalId: string; employeeNumber: string; email: string; name: string };
export type ExternalAbsence = {
  externalId: string; employeeNumber: string; code: string; from: string; to: string;
  hours: AbsenceHours | null; status: "APPLIED" | "APPROVED" | "REJECTED" | "WITHDRAWN"; changedAt: string | null;
};
export type ExternalCode = { code: string; name: string };
/** A balance as the master system computed it (hours); Workflow shows it and never computes one. */
export type ExternalBalance = { employeeNumber: string; kind: "vacation_days" | "flex_hours" | "comp_hours"; value: number; asOf: string };
export type AdapterRange = { from: string; to: string };

export interface PayrollAdapter {
  readonly system: PayrollSystem;
  /** False until the provider's API is documented and verified; then the reason is empty. */
  readonly available: boolean;
  readonly unavailableReason: string;
  employees(range: AdapterRange): Promise<ExternalEmployee[]>;
  absences(range: AdapterRange): Promise<ExternalAbsence[]>;
  absenceCodes(): Promise<ExternalCode[]>;
  balances?(asOf: string): Promise<ExternalBalance[]>;
}

export class AdapterUnavailable extends Error {
  constructor(message: string) { super(message); this.name = "AdapterUnavailable"; }
}

const unavailable = (system: PayrollSystem, reason: string): PayrollAdapter => {
  const fail = async (): Promise<never> => { throw new AdapterUnavailable(reason); };
  return { system, available: false, unavailableReason: reason, employees: fail, absences: fail, absenceCodes: fail, balances: fail };
};

/** Flex HRM: prepared, switched off. Needs Flex's API documentation, an API agreement for the customer and a test account. */
export const flexHrmAdapter = (): PayrollAdapter => unavailable("flex_hrm",
  "Flex HRM:s API är inte publikt dokumenterat. Kopplingen slås på när Flex lämnat dokumentation och ett testkonto. Till dess: filer för hand eller via SFTP.");

/** The adapter for a company's system; every system without a verified API is switched off. */
export function adapterFor(system: PayrollSystem): PayrollAdapter {
  if (system === "flex_hrm") return flexHrmAdapter();
  return unavailable(system, "Det finns ingen API-koppling för systemet. Använd filer för hand eller via SFTP.");
}

/** A test adapter with fixed answers, or one that fails like a broken connection (tests only). */
export function mockAdapter(data: { employees?: ExternalEmployee[]; absences?: ExternalAbsence[]; codes?: ExternalCode[]; fail?: "timeout" | "unauthorized" }): PayrollAdapter {
  const answer = async <T,>(value: T): Promise<T> => {
    if (data.fail === "timeout") throw new Error("Tidsgränsen nåddes.");
    if (data.fail === "unauthorized") throw new Error("Nyckeln godtogs inte.");
    return value;
  };
  return { system: "other", available: true, unavailableReason: "", employees: () => answer(data.employees ?? []), absences: () => answer(data.absences ?? []), absenceCodes: () => answer(data.codes ?? []) };
}

/** Absence from an adapter as the rows of a table, so the file path's preview and rules apply unchanged. */
export function adapterAbsencesAsTable(absences: readonly ExternalAbsence[]) {
  return {
    headers: ["Id i systemet", "Anställningsnummer", "Frånvarokod", "Från", "Till och med", "Från klockan", "Till klockan", "Status"],
    rows: absences.map((item) => [item.externalId, item.employeeNumber, item.code, item.from, item.to, item.hours?.start ?? "", item.hours?.end ?? "", item.status === "APPROVED" ? "godkänd" : item.status === "APPLIED" ? "ansökt" : item.status === "REJECTED" ? "avslagen" : "återtagen"]),
  };
}
