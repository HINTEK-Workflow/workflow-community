import { formReviewMaterial } from "@/lib/ai/protocol-review";
import { formLimitFor, formLimitText, type FormDocument, type FormValues } from "@/lib/workflow/form-document";

/**
 * A protocol's results as a reader sees them (2026-10-05: Workflow AI answered measurement questions poorly
 * because get_task only carried the raw values keyed by the form's internal ids). The reviewer's material – labels,
 * units, computed judgements, what the rules found missing or outside its limits – plus the limits the protocol was
 * judged against. Used by the shared get_task tool, so the API, MCP and Workflow AI read the same thing. Pure.
 */
export function formResultsForReaders(document: FormDocument, values: FormValues) {
  const material = formReviewMaterial(document, values);
  const limits = (document.limits ?? []).slice(0, 30).flatMap((item) => {
    const limit = formLimitFor(document, values, item.key);
    if (!limit) return [];
    const alarm = formLimitText(limit.low, limit.high, limit.unit);
    const warning = limit.warnLow === null && limit.warnHigh === null ? null : formLimitText(limit.warnLow, limit.warnHigh, limit.unit);
    return [{ limit: limit.label, allowed: alarm, ...(warning ? { warningRange: warning } : {}), ...(limit.source ? { source: String(limit.source).slice(0, 120) } : {}) }];
  });
  return { ...material, ...(limits.length ? { limits } : {}) };
}
