import { z } from "zod";
import type { FormDocument, FormLimitValue, FormValues } from "./form-document";

/**
 * Limit profiles (2026-09-28): a company's own limit values for one form at one facility – and, when the form names
 * an object field (`limitObjectKey`, e.g. "Aggregat"), for one object there. The form only says what each limit is
 * and where its value comes from; the numbers belong to the facility (its permit, the manufacturer's instructions),
 * so they are never hard-coded. Cloud stores profiles per organisation (`FormLimitProfile`), Local in the `.hwf` file.
 */
const number = z.number().finite().nullable().default(null);
export const limitProfileValueSchema = z.object({ low: number, high: number, warnLow: number, warnHigh: number, source: z.string().trim().max(300).default("") });
export type LimitProfileValue = z.infer<typeof limitProfileValueSchema>;

export const formLimitProfileInputSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  version: z.number().int().min(0).optional(),
  /** The form family: a HINTEK original's id also for a company's version of it, so the values follow the form. */
  templateId: z.string().min(1).max(100),
  facilityId: z.string().min(1).max(100),
  objectName: z.string().trim().max(120).default(""),
  values: z.record(z.string().max(40), limitProfileValueSchema).default({}),
}).superRefine((profile, context) => {
  for (const [key, value] of Object.entries(profile.values)) {
    if (value.low !== null && value.high !== null && value.low > value.high) context.addIssue({ code: "custom", path: ["values", key], message: "Den nedre larmgränsen är större än den övre." });
    if (value.warnLow !== null && value.warnHigh !== null && value.warnLow > value.warnHigh) context.addIssue({ code: "custom", path: ["values", key], message: "Den nedre varningsgränsen är större än den övre." });
  }
});
export type FormLimitProfileInput = z.infer<typeof formLimitProfileInputSchema>;
export type FormLimitProfile = FormLimitProfileInput & { id: string; version: number; updatedAt?: string; updatedByName?: string };

const filled = (value: LimitProfileValue | undefined) => Boolean(value && (value.low !== null || value.high !== null || value.warnLow !== null || value.warnHigh !== null));

/**
 * The limits a protocol is filled in against: per limit the object's profile, else the facility's, else the form's own
 * values. The result is stored in the protocol (`values.limits`) so it keeps the limits that applied.
 */
export function resolveFormLimits(document: FormDocument, profiles: Pick<FormLimitProfile, "facilityId" | "objectName" | "values">[], facilityId: string | null, objectName = ""): Record<string, FormLimitValue> {
  const facility = facilityId ? profiles.find((profile) => profile.facilityId === facilityId && !profile.objectName) : undefined;
  const object = facilityId && objectName.trim() ? profiles.find((profile) => profile.facilityId === facilityId && profile.objectName.trim().toLowerCase() === objectName.trim().toLowerCase()) : undefined;
  const result: Record<string, FormLimitValue> = {};
  for (const limit of document.limits) {
    const own = object?.values[limit.key];
    const shared = facility?.values[limit.key];
    if (filled(own)) result[limit.key] = { ...own!, source: own!.source || limit.source, origin: "object" };
    else if (filled(shared)) result[limit.key] = { ...shared!, source: shared!.source || limit.source, origin: "facility" };
    else result[limit.key] = { low: limit.low, high: limit.high, warnLow: limit.warnLow, warnHigh: limit.warnHigh, source: limit.source, origin: "form" };
  }
  return result;
}

/** The object a protocol is about, from the form's object field ("G1"), or "". */
export function formLimitObject(document: FormDocument, values: FormValues) {
  if (!document.limitObjectKey) return "";
  const value = values.fields[document.limitObjectKey];
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/** Whether two sets of limits are the same, so an unchanged protocol is not marked as changed. */
export function sameLimits(a: Record<string, FormLimitValue>, b: Record<string, FormLimitValue>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => {
    const x = a[key]; const y = b[key];
    return Boolean(x && y) && x.low === y.low && x.high === y.high && x.warnLow === y.warnLow && x.warnHigh === y.warnHigh && x.source === y.source && x.origin === y.origin;
  });
}
