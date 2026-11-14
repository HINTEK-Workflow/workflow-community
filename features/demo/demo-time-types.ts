import { movedTimeTypeOrder, orderedTimeTypes, STARTING_TIME_TYPES, timeBillingLookup, timeCountsAsWork, timeTypeChoiceProblem, timeTypeInputSchema, timeTypeRemoveProblem, timeTypesWithPolicy, timeTypeSaveProblem, type TimeTypeView } from "@/lib/workflow/time-types";
import type { DemoDatabase } from "./demo-data";

/**
 * Tidstyper i demon (2026-10-29): the company's list in memory, changed with the same rules as Cloud (lib/workflow/time-types.ts)
 * – only an administrator changes it, the standard type stays active, a type with time on it is switched off, not removed.
 */
export class DemoTimeTypeError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function demoTimeTypes(db: DemoDatabase): TimeTypeView[] {
  db.timeTypes ??= STARTING_TIME_TYPES.map((type, sortOrder) => ({ id: `demo-time-type-${sortOrder}`, name: type.name, payrollCode: "", active: true, isDefault: type.isDefault, sortOrder }));
  return orderedTimeTypes(db.timeTypes);
}

/** The list with what the company has decided per type (beslut 8, 2026-11-01); the price only for someone who may see prices. */
export const demoTimeTypesWithPolicy = (db: DemoDatabase, seePrices: boolean) => timeTypesWithPolicy(demoTimeTypes(db), db.timeTypePolicies ?? {}, seePrices);
export const demoTimeBilling = (db: DemoDatabase) => timeBillingLookup(demoTimeTypes(db), db.timeTypePolicies ?? {});
export const demoCountsAsWork = (db: DemoDatabase, id: string | null | undefined) => timeCountsAsWork(demoTimeTypes(db), db.timeTypePolicies ?? {}, id);

/** The type chosen for an entry: undefined keeps the entry's own, null is the standard type. */
export function demoCheckedTimeTypeId(db: DemoDatabase, chosen: unknown, current?: string | null): string | null | undefined {
  if (chosen === undefined) return undefined;
  if (chosen === null || chosen === "") return null;
  if (typeof chosen !== "string") throw new DemoTimeTypeError(422, "Tidstypen finns inte.");
  const problem = timeTypeChoiceProblem(demoTimeTypes(db), chosen, current);
  if (problem) throw new DemoTimeTypeError(422, problem);
  return chosen;
}

let sequence = 0;
export function demoTimeTypeAction(db: DemoDatabase, admin: boolean, input: { action?: unknown; type?: unknown; id?: unknown; step?: unknown }) {
  if (!admin) throw new DemoTimeTypeError(403, "Företagsadministratör krävs.");
  const types = demoTimeTypes(db);
  if (input.action === "time_type_save") {
    const value = timeTypeInputSchema.parse(input.type);
    const problem = timeTypeSaveProblem(types, value);
    if (problem) throw new DemoTimeTypeError(422, problem);
    const current = value.id ? db.timeTypes.find((type) => type.id === value.id) : undefined;
    if (value.policy) {
      const target = current ?? { id: `demo-time-type-new-${sequence + 1}` };
      (db.timeTypePolicies ??= {})[target.id] = value.policy;
    }
    if (current) Object.assign(current, { name: value.name, payrollCode: value.payrollCode, active: value.active });
    else db.timeTypes.push({ id: `demo-time-type-new-${++sequence}`, name: value.name, payrollCode: value.payrollCode, active: value.active, isDefault: false, sortOrder: Math.max(-1, ...types.map((type) => type.sortOrder)) + 1 });
  } else if (input.action === "time_type_move") {
    if (!types.some((type) => type.id === input.id)) throw new DemoTimeTypeError(404, "Tidstypen finns inte.");
    for (const item of movedTimeTypeOrder(types, String(input.id), input.step === -1 ? -1 : 1)) { const type = db.timeTypes.find((entry) => entry.id === item.id); if (type) type.sortOrder = item.sortOrder; }
  } else {
    const type = types.find((item) => item.id === input.id);
    const problem = timeTypeRemoveProblem(type, db.timeEntries.filter((entry) => entry.timeTypeId === input.id).length);
    if (problem) throw new DemoTimeTypeError(type ? 409 : 404, problem);
    db.timeTypes = db.timeTypes.filter((item) => item.id !== input.id);
  }
  return { ok: true, timeTypes: demoTimeTypesWithPolicy(db, true) };
}
