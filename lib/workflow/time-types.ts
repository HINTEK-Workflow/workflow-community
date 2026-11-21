import { z } from "zod";
import { clockOfMinutes } from "./work-schedule";
import { parseAmount } from "./expenses";

/**
 * Tidstyper (2026-10-29): what kind of time an entry is – ordinary time, overtime, travel, on-call. There is no standard,
 * since every company has its own agreements, so the company owns its list (name, an optional payroll code for the export,
 * active or not, and the order); an administrator changes it. A new company starts with a short neutral list it may change.
 * No agreement names, percentages or compensation rules: Workflow never calculates pay or balances – the payroll system does.
 *
 * An entry without a type (every entry from before, a timer, an API call that names none) is the company's standard type. The
 * standard type cannot be deactivated or removed, and which type is the standard does not change, so an old entry never
 * changes meaning. The same rules run in Cloud (app/api/workflow-time, lib/payroll/server.ts) and the demo.
 */
export const TIME_TYPE_NAME_MAX = 40;
export const TIME_TYPE_CODE_MAX = 20;
export const TIME_TYPES_MAX = 30;

export type TimeTypeView = { id: string; name: string; payrollCode: string; active: boolean; isDefault: boolean; sortOrder: number; policy?: TimeTypePolicy };

// ---------- billing and working time per type (beslut 8, 2026-11-01) ----------

/**
 * What the company has decided for each type of time. Billing: "company" = on the job's labour line at the company's hourly
 * rate, "own" = a line of its own at the type's own price (a blank price stays blank, so the line says it lacks a price rather
 * than billing a wrong sum), "none" = never on an invoice basis. workingTime: whether the hours count as worked time against
 * the ordinary day and in the pay basis's sum; they go to the payroll system either way, on a row of their own.
 * Stored per type in WorkspaceSettings.priceSettings (timeTypePolicies), since the price is a business secret.
 */
export const TIME_TYPE_BILLINGS = ["company", "own", "none"] as const;
export type TimeTypeBilling = (typeof TIME_TYPE_BILLINGS)[number];
export const TIME_TYPE_BILLING_LABELS: Record<TimeTypeBilling, string> = { company: "Företagets timpris", own: "Eget pris, egen rad", none: "Faktureras inte" };
export type TimeTypePolicy = { billing: TimeTypeBilling; price: string; workingTime: boolean };
export type TimeTypePolicies = Record<string, TimeTypePolicy>;

export const timeTypePolicySchema = z.object({
  billing: z.enum(TIME_TYPE_BILLINGS),
  price: z.string().trim().max(20).default("").refine((value) => !value || (parseAmount(value) ?? -1) >= 0, "Skriv priset som ett tal."),
  workingTime: z.boolean(),
});

const TRAVEL_NAMES = new Set(["restid", "resa", "resor", "resetid"]);
const isTravelName = (name: string) => TRAVEL_NAMES.has(name.trim().toLocaleLowerCase("sv-SE"));

/** A type nobody has decided on: travel is a line of its own with its own price and is not worked time; the rest stay as they were. */
export const defaultTimeTypePolicy = (name: string): TimeTypePolicy => isTravelName(name)
  ? { billing: "own", price: "", workingTime: false }
  : { billing: "company", price: "", workingTime: true };

/** The stored policies; what cannot be read is left out, so the type falls back to its default. */
export function timeTypePoliciesOf(priceSettings: unknown): TimeTypePolicies {
  const stored = priceSettings && typeof priceSettings === "object" ? (priceSettings as { timeTypePolicies?: unknown }).timeTypePolicies : null;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  return Object.fromEntries(Object.entries(stored).flatMap(([id, value]) => {
    const parsed = timeTypePolicySchema.safeParse(value);
    return parsed.success ? [[id, parsed.data] as const] : [];
  }));
}

/** One short line on the type's row: what it costs the customer and whether it counts as worked time. */
export function timeTypePolicyText(policy: TimeTypePolicy): string {
  const billing = policy.billing === "own" ? (policy.price ? `Eget pris ${policy.price} kr/h` : "Eget pris") : TIME_TYPE_BILLING_LABELS[policy.billing];
  return `${billing} · ${policy.workingTime ? "Arbetstid" : "Inte arbetstid"}`;
}

export const policyOfTimeType = (policies: TimeTypePolicies, type: Pick<TimeTypeView, "id" | "name">): TimeTypePolicy => policies[type.id] ?? defaultTimeTypePolicy(type.name);

/** The types with what the company has decided; the price only for someone who may see prices. */
export const timeTypesWithPolicy = <T extends TimeTypeView>(types: readonly T[], policies: TimeTypePolicies, seePrices: boolean): T[] => types.map((type) => {
  const policy = policyOfTimeType(policies, type);
  return { ...type, policy: seePrices ? policy : { ...policy, price: "" } };
});

/** One entry's type, as the invoice basis needs it. An entry without a type is the standard type. */
export type TimeBilling = { typeId: string; name: string; billing: TimeTypeBilling; price: string };
export type TimeBillingLookup = (timeTypeId: string | null | undefined) => TimeBilling;
export function timeBillingLookup(types: readonly TimeTypeView[], policies: TimeTypePolicies): TimeBillingLookup {
  return (timeTypeId) => {
    const type = resolveTimeType(types, timeTypeId);
    if (!type) return { typeId: "", name: "", billing: "company", price: "" };
    const policy = policyOfTimeType(policies, type);
    return { typeId: type.id, name: type.name, billing: policy.billing, price: policy.price };
  };
}

/** Whether an entry's hours count as worked time. */
export function timeCountsAsWork(types: readonly TimeTypeView[], policies: TimeTypePolicies, timeTypeId: string | null | undefined): boolean {
  const type = resolveTimeType(types, timeTypeId);
  return type ? policyOfTimeType(policies, type).workingTime : true;
}

/** The ids of the types that are never billed, and whether time without a type is among them (for a list in the database). */
export function unbilledTimeTypes(types: readonly TimeTypeView[], policies: TimeTypePolicies) {
  const never = types.filter((type) => policyOfTimeType(policies, type).billing === "none");
  return { ids: never.map((type) => type.id), standard: never.some((type) => type.isDefault) };
}

/** The neutral starting list of a new company: plain words, no codes, nothing from any agreement. */
export const STARTING_TIME_TYPES: readonly { name: string; isDefault: boolean }[] = [
  { name: "Ordinarie", isDefault: true },
  { name: "Övertid", isDefault: false },
  { name: "Restid", isDefault: false },
  { name: "Jour", isDefault: false },
];

/** A payroll code is short plain text: letters, digits, space, dot, dash, underscore and slash (it goes into a file). */
export const timeTypeInputSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  name: z.string().trim().min(1, "Ge tidstypen ett namn.").max(TIME_TYPE_NAME_MAX, `Namnet får vara högst ${TIME_TYPE_NAME_MAX} tecken.`),
  payrollCode: z.string().trim().max(TIME_TYPE_CODE_MAX, `Koden får vara högst ${TIME_TYPE_CODE_MAX} tecken.`)
    .regex(/^[\p{L}\p{N} ._\-/]*$/u, "Koden får bara innehålla bokstäver, siffror, mellanslag, punkt, bindestreck, understreck och snedstreck.").default(""),
  active: z.boolean().default(true),
  /** Left out: what the type has stays. */
  policy: timeTypePolicySchema.optional(),
});
export type TimeTypeInput = z.infer<typeof timeTypeInputSchema>;

export const orderedTimeTypes = <T extends Pick<TimeTypeView, "sortOrder" | "name">>(types: readonly T[]) =>
  [...types].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "sv"));

export const defaultTimeType = <T extends Pick<TimeTypeView, "isDefault" | "sortOrder" | "name">>(types: readonly T[]) =>
  types.find((type) => type.isDefault) ?? orderedTimeTypes(types)[0];

/** The type of an entry: its own, else (none, or one that is gone) the company's standard type. */
export function resolveTimeType<T extends Pick<TimeTypeView, "id" | "isDefault" | "sortOrder" | "name">>(types: readonly T[], id: string | null | undefined): T | undefined {
  return (id ? types.find((type) => type.id === id) : undefined) ?? defaultTimeType(types);
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("sv-SE") === b.trim().toLocaleLowerCase("sv-SE");

/** Why a type cannot be saved as given (admins only reach this), or null. */
export function timeTypeSaveProblem(types: readonly TimeTypeView[], input: TimeTypeInput): string | null {
  const current = input.id ? types.find((type) => type.id === input.id) : undefined;
  if (input.id && !current) return "Tidstypen finns inte.";
  if (!input.id && types.length >= TIME_TYPES_MAX) return `Högst ${TIME_TYPES_MAX} tidstyper.`;
  if (types.some((type) => type.id !== input.id && sameName(type.name, input.name))) return "Det finns redan en tidstyp med det namnet.";
  if (current?.isDefault && !input.active) return "Standardtypen används för tid utan vald typ och kan inte stängas av.";
  return null;
}

/** Why a type cannot be removed: the standard type, or one that time is reported on (deactivate it instead). */
export function timeTypeRemoveProblem(type: Pick<TimeTypeView, "isDefault"> | undefined, usedBy: number): string | null {
  if (!type) return "Tidstypen finns inte.";
  if (type.isDefault) return "Standardtypen kan inte tas bort.";
  if (usedBy > 0) return "Det finns rapporterad tid med den här typen. Stäng av typen i stället, så står den kvar på tiden.";
  return null;
}

/** The new order after moving one type a step up (-1) or down (1): every type's sortOrder, 0, 1, 2 … */
export function movedTimeTypeOrder(types: readonly TimeTypeView[], id: string, step: -1 | 1): { id: string; sortOrder: number }[] {
  const list = orderedTimeTypes(types);
  const index = list.findIndex((type) => type.id === id);
  const target = index + step;
  if (index >= 0 && target >= 0 && target < list.length) [list[index], list[target]] = [list[target], list[index]];
  return list.map((type, sortOrder) => ({ id: type.id, sortOrder }));
}

/**
 * Whether a person may put this type on an entry: a type of the company, active – or the type the entry already has (an old
 * entry keeps a deactivated type until someone picks another). `undefined`/null means the standard type and is always allowed.
 */
export function timeTypeChoiceProblem(types: readonly Pick<TimeTypeView, "id" | "active">[], chosen: string | null | undefined, current?: string | null): string | null {
  if (!chosen) return null;
  const type = types.find((item) => item.id === chosen);
  if (!type) return "Tidstypen finns inte.";
  if (!type.active && chosen !== current) return "Tidstypen används inte längre. Välj en annan.";
  return null;
}

/** The types a picker offers: the active ones in order, plus the entry's own type if it has since been deactivated. */
export const selectableTimeTypes = <T extends TimeTypeView>(types: readonly T[], current?: string | null) =>
  orderedTimeTypes(types).filter((type) => type.active || type.id === current);

// ---------- time reported afterwards (2026-10-29: counted BACK from now) ----------

/**
 * Which end of the range stays put when the length changes. "now": nothing touched – the end is now and the start is now minus
 * the length; "end": the person set the end – it stays and the start moves; "start": the person set the start – it stays and the
 * end moves. A timer started now and stopped later is not affected by any of this.
 */
export type RangeAnchor = "now" | "end" | "start";

/** A length chosen (a quick choice): the new start and end. */
export function rangeForLength(input: { start: Date | null; end: Date | null; hours: number; anchor: RangeAnchor; now: Date }): { start: Date; end: Date } | null {
  const length = Math.round(input.hours * 3_600_000);
  if (!(length > 0)) return null;
  if (input.anchor === "start") return input.start ? { start: input.start, end: new Date(input.start.getTime() + length) } : null;
  const end = input.anchor === "now" ? input.now : input.end;
  return end ? { start: new Date(end.getTime() - length), end } : null;
}

/**
 * The range a new entry is saved with: untouched ("now"), it is moved so it ends at the moment of saving and keeps its length –
 * a form left open for a while still means "the last hours up to now". Otherwise what the person entered.
 */
export function rangeAtSave(input: { start: Date; end: Date; anchor: RangeAnchor; now: Date }): { start: Date; end: Date } {
  if (input.anchor !== "now") return { start: input.start, end: input.end };
  const length = input.end.getTime() - input.start.getTime();
  return { start: new Date(input.now.getTime() - length), end: input.now };
}

/**
 * A new entry on another day (from the calendar) has no "now": it starts at the company's workday start (2026-10-30,
 * before a fixed 08:00) and is an hour long, inside that Swedish day – as the form's datetime-local values. Today keeps
 * "ends now, counts backwards" (rangeForLength).
 */
export function otherDayInputs(day: string, workdayStartMinutes: number): { start: string; end: string } {
  const start = Math.min(Math.max(0, Math.round(workdayStartMinutes)), 1439);
  return { start: `${day}T${clockOfMinutes(start)}`, end: `${day}T${clockOfMinutes(Math.min(start + 60, 1439))}` };
}
