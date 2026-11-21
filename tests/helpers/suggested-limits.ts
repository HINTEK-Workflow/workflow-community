import type { FormDocument } from "../../lib/workflow/form-document";
import { resolveFormLimits } from "../../lib/workflow/form-limits";
import { HINTEK_LIMIT_SUGGESTIONS, SUGGESTION_NOTE } from "../../lib/workflow/limit-suggestions";
import type { CompanyValue } from "../../lib/workflow/company-values";

/**
 * The RCD 1× times a company could take from the suggestions before 2026-10-10, when the row still offered TN/IT and TT.
 * The keys remain for older protocols, so a company that pressed "Använd förslagen" back then still has these values.
 */
export const EARLIER_RCD_VALUES: Record<string, { low: number | null; high: number | null }> = { rcd_t1_tnit: { low: null, high: 400 }, rcd_t1_tt: { low: null, high: 200 } };
const companyNumbers = { ...HINTEK_LIMIT_SUGGESTIONS, ...EARLIER_RCD_VALUES };

/** A company that pressed "Använd förslagen" under Värden och referenser (2026-10-06): Workflow's suggestions as its values. */
export const suggestedCompanyValues: CompanyValue[] = Object.entries(companyNumbers).map(([key, value]) => ({ key, ...value, warnLow: null, warnHigh: null, source: SUGGESTION_NOTE, reference: "", version: 1, updatedByName: "" }));

/** The same numbers as a protocol's own limits (`values.limits`), as a company that has entered them. */
export const companyRcdLimits = () => Object.fromEntries(Object.entries(companyNumbers).map(([key, value]) => [key, { ...value, warnLow: null, warnHigh: null, source: "", origin: "company" as const }]));

/** The limits a protocol of the form takes from that company. */
export const suggestedLimits = (document: FormDocument) => resolveFormLimits(document, [], null, "", suggestedCompanyValues);
