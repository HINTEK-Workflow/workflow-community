/**
 * HINTEK's originals of the built-in task types (Daniel 2026-09-27, decision B). While an original – or a company's own
 * version of it – is published, it takes the place of the old task type: under Ny uppgift and for "Ny kontroll" /
 * "Ny riskbedömning". Unpublishing it brings the old type back, so the switch-over is HINTEK's own, reversible step.
 */
export const KFID_FORM_ID = "hintek-kontroll-fore-idrifttagning";
export const RISK_FORM_ID = "hintek-riskbedomning";
export const TASK_TYPE_OF_ORIGINAL: Record<string, "COMMISSIONING_CONTROL" | "RISK_ASSESSMENT"> = { [KFID_FORM_ID]: "COMMISSIONING_CONTROL", [RISK_FORM_ID]: "RISK_ASSESSMENT" };
