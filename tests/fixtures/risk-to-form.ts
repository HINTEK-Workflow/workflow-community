import { emptyFormValues, type FormValues } from "../../lib/workflow/form-document";
import type { WorkflowReportTask } from "../../lib/workflow/report";

/** Today's risk assessment as answers to the Riskbedömning form, for comparing the reports' content (tests only). */
export function riskToFormValues(details: Extract<WorkflowReportTask["data"], { kind: "RISK_ASSESSMENT" }>["details"]): FormValues {
  const values = emptyFormValues();
  values.tables.risker = details.risks.map((risk, index) => ({ id: `risk-${index + 1}`, label: "", cells: {
    fara: risk.hazard, sannolikhet: risk.likelihood, konsekvens: risk.consequence, atgard: risk.protectiveMeasure,
    sannolikhet_efter: risk.residualLikelihood, konsekvens_efter: risk.residualConsequence,
  } }));
  values.fields.atgarder = details.generalMeasures;
  values.signatures.godkand = { name: details.approval.name, confirmed: details.approval.confirmed, signedAt: details.approval.approvedAt };
  return values;
}
