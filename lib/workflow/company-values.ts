import { z } from "zod";
import type { FormDocument } from "./form-document";
import { HINTEK_LIMIT_SUGGESTIONS } from "./limit-suggestions";

/**
 * Värden och referenser (2026-10-06): Workflow is a standards-neutral framework. Workflow delivers the forms and
 * the calculations; the company enters the standard-dependent values it works to – once, for every form that declares
 * the same limit key – and may name where each value comes from (a standard, a document, a version). The values are
 * the company's own data: Cloud keeps them per organisation (`CompanyReferenceValue`), Local in the `.hwf` file. They
 * are never global, never part of a form file, and never readable by another company or the product owner.
 */
const number = z.number().finite().nullable().default(null);
// A limit's key has no dot. The one namespace with dots is `kabel.…`, reserved for the Räkneverktyg's own values (
// 2026-10-07, lib/calculators/company-data.ts), so a form's limit can never be mistaken for one of them.
export const companyValueKeySchema = z.string().trim().toLowerCase().max(40).regex(/^(?:[a-zåäö][a-zåäö0-9_]{0,39}|kabel(?:\.[a-z0-9_]{1,24}){1,4})$/, "Ogiltig nyckel.");
const companyValueFields = {
  key: companyValueKeySchema,
  low: number, high: number, warnLow: number, warnHigh: number,
  /** Where the value comes from – a standard, an instruction, the company's own routine. */
  source: z.string().trim().max(300).default(""),
  /** The version or date of that source. */
  reference: z.string().trim().max(120).default(""),
};
const ranges = (value: { low: number | null; high: number | null; warnLow: number | null; warnHigh: number | null }, context: z.RefinementCtx) => {
  if (value.low !== null && value.high !== null && value.low > value.high) context.addIssue({ code: "custom", path: ["low"], message: "Det lägsta värdet är större än det högsta." });
  if (value.warnLow !== null && value.warnHigh !== null && value.warnLow > value.warnHigh) context.addIssue({ code: "custom", path: ["warnLow"], message: "Den nedre varningsgränsen är större än den övre." });
};
export const companyValueInputSchema = z.object({ ...companyValueFields, version: z.number().int().min(0).optional() }).superRefine(ranges);
export type CompanyValueInput = z.infer<typeof companyValueInputSchema>;
/** One save: the rows changed on the page (or filled in from the suggestions). */
export const companyValuesSaveSchema = z.object({ values: z.array(companyValueInputSchema).min(1).max(200) });
/** A stored value, as Cloud returns it and the Local file keeps it. */
export const storedCompanyValueSchema = z.object({ ...companyValueFields, version: z.number().int().positive().default(1), updatedAt: z.string().max(40).optional(), updatedByName: z.string().max(200).default("") });
export type CompanyValue = z.infer<typeof storedCompanyValueSchema>;

const NUMBERS = ["low", "high", "warnLow", "warnHigh"] as const;
/** Whether the company has given the limit a number. */
export const companyValueFilled = (value: Pick<CompanyValue, (typeof NUMBERS)[number]> | undefined) => Boolean(value && NUMBERS.some((field) => value[field] !== null));
/** A row with neither a number nor a source is removed rather than kept empty. */
export const companyValueBlank = (value: Pick<CompanyValue, (typeof NUMBERS)[number] | "source" | "reference">) => !companyValueFilled(value) && !value.source && !value.reference;
/** The source as one line in the protocol: "SS 436 40 00, utgåva 4" – the company's words, never ours. */
export const companyValueSource = (value: Pick<CompanyValue, "source" | "reference">) => [value.source, value.reference].filter(Boolean).join(", ").slice(0, 300);

/**
 * Saves rows into a list (Local, the demo): a newer version elsewhere is a conflict, a blank row removes the value.
 * Cloud does the same in app/api/company-values/route.ts.
 */
export function mergeCompanyValues(current: CompanyValue[], inputs: CompanyValueInput[], actorName: string, now = new Date().toISOString()): CompanyValue[] {
  let next = [...current];
  for (const input of inputs.map((item) => companyValueInputSchema.parse(item))) {
    const existing = next.find((item) => item.key === input.key);
    if (existing && input.version !== undefined && existing.version !== input.version) throw new Error("Värdena har ändrats av någon annan. Läs in sidan på nytt.");
    const { version: _version, ...fields } = input; // eslint-disable-line @typescript-eslint/no-unused-vars
    next = next.filter((item) => item.key !== input.key);
    if (!companyValueBlank(fields)) next.push({ ...fields, version: (existing?.version ?? 0) + 1, updatedAt: now, updatedByName: actorName });
  }
  return next.sort((a, b) => a.key.localeCompare(b.key, "sv"));
}

/** A form a limit is used in; the id lets a link (?form=<id>) and a card's shortcut name it. */
export type CatalogFormRef = { id: string; name: string; /** The Workflow original this form is the company's own version of. */ baseId?: string | null };
/** One limit as the page lists it: what it is, its unit, its help, and the forms that use it. */
export type CompanyValueRow = { key: string; label: string; unit: string; help: string; usedIn: string[]; forms: CatalogFormRef[]; suggestion: { low: number | null; high: number | null } | null };
export type CompanyValueGroup = { title: string; rows: CompanyValueRow[] };
export type CatalogForm = { id?: string; baseId?: string | null; name: string; document: Pick<FormDocument, "limits"> };

/**
 * The limits the company's forms declare, once per key and grouped (2026-10-06): a key used by several forms is one row
 * ("Används i: Kontroll före idrifttagning, Isolationsmätning – kabelnät") among the shared ones; the rest under the
 * form that declares them. The first form's label and unit name the row.
 */
export function companyValueCatalog(forms: CatalogForm[]): CompanyValueGroup[] {
  const rows = new Map<string, CompanyValueRow>();
  for (const form of [...forms].sort((a, b) => a.name.localeCompare(b.name, "sv"))) for (const limit of form.document.limits) {
    const row = rows.get(limit.key) ?? { key: limit.key, label: limit.label, unit: limit.unit, help: limit.help, usedIn: [], forms: [], suggestion: HINTEK_LIMIT_SUGGESTIONS[limit.key] ?? null };
    if (!row.usedIn.includes(form.name)) row.usedIn.push(form.name);
    if (form.id && !row.forms.some((item) => item.id === form.id)) row.forms.push({ id: form.id, name: form.name, ...(form.baseId ? { baseId: form.baseId } : {}) });
    rows.set(limit.key, row);
  }
  const groups = new Map<string, CompanyValueRow[]>();
  for (const row of rows.values()) {
    const title = row.usedIn.length > 1 ? SHARED_GROUP : row.usedIn[0];
    groups.set(title, [...(groups.get(title) ?? []), row]);
  }
  return [...groups.entries()].map(([title, items]) => ({ title, rows: items }))
    .sort((a, b) => (a.title === SHARED_GROUP ? -1 : b.title === SHARED_GROUP ? 1 : a.title.localeCompare(b.title, "sv")));
}
export const SHARED_GROUP = "Gemensamma för flera formulär";

/** The source a suggestion is saved with until the company writes its own, so a protocol never hides where it came from. */
export const SUGGESTION_SOURCE = "Förslag från Workflow";

/** "Använd förslagen": Workflow's suggestion for every listed row that has no number yet – nothing else is touched. */
export function suggestionInputs(groups: CompanyValueGroup[], values: CompanyValue[]): CompanyValueInput[] {
  return groups.flatMap((group) => group.rows).filter((row) => row.suggestion && !companyValueFilled(values.find((value) => value.key === row.key))).map((row) => {
    const existing = values.find((value) => value.key === row.key);
    return { key: row.key, low: row.suggestion!.low, high: row.suggestion!.high, warnLow: existing?.warnLow ?? null, warnHigh: existing?.warnHigh ?? null, source: existing?.source || SUGGESTION_SOURCE, reference: existing?.reference ?? "", version: existing?.version };
  });
}
