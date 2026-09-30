import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { riskForm, riskFormDocument } from "../lib/workflow/builtin-risk-form";
import { kfidForm, kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { createFormProtocolPdf } from "../lib/workflow/form-report";
import { defaultWorkflowReportOptions } from "../lib/workflow/report";
import { controlToFormValues } from "./fixtures/control-to-form";
import { REFERENCE_DIR, referenceControlFull, referenceReports, referenceRiskTask } from "./fixtures/report-references";
import { riskToFormValues } from "./fixtures/risk-to-form";

/**
 * Before-and-after PDFs for the review of decision B (2026-09-27): `npx tsx tests/pdf-examples.ts`. Written to
 * docs/pdf-examples-20260927; the locked references stay in tests/fixtures/reference-pdfs.
 */
const out = "docs/pdf-examples-20260927";
const font = () => new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
const company = "HINTEK Power Solutions AB";
(async () => {
  copyFileSync(`${REFERENCE_DIR}/control-full.pdf`, `${out}/1-kontroll-idag.pdf`);
  const files = [{ id: "file-1", filename: "grupp2-kopplingsdosa.png", mimeType: "image/png", section: "iso", rowId: "iso-2", bytes: new Uint8Array(readFileSync(`${REFERENCE_DIR}/photo.png`)) }, { id: "file-2", filename: "Ritning A1.pdf", mimeType: "application/pdf", section: "vis", rowId: null }];
  writeFileSync(`${out}/2-kontroll-som-formular.pdf`, await createFormProtocolPdf({ identity: { company }, fontBytes: font(), options: defaultWorkflowReportOptions, task: {
    id: "k", kind: "FORM", title: referenceControlFull.meta.proj, description: "", status: "COMPLETED", progress: 100, assignedToName: "", dueDate: "", totalDurationSec: 0,
    data: { kind: "FORM", details: { templateName: kfidForm.meta.name, templateVersion: 1, document: kfidFormDocument, values: controlToFormValues(referenceControlFull, files) } },
    attachments: files.map(({ id, filename, mimeType, bytes }) => ({ id, filename, mimeType, bytes })),
  } }));
  copyFileSync(`${REFERENCE_DIR}/risk-assessment.pdf`, `${out}/3-riskbedomning-idag.pdf`);
  const details = referenceRiskTask.data.kind === "RISK_ASSESSMENT" ? referenceRiskTask.data.details : null!;
  writeFileSync(`${out}/4-riskbedomning-som-formular.pdf`, await createFormProtocolPdf({ identity: { company }, fontBytes: font(), options: defaultWorkflowReportOptions,
    task: { ...referenceRiskTask, kind: "FORM", data: { kind: "FORM", details: { templateName: riskForm.meta.name, templateVersion: 1, document: riskFormDocument, values: riskToFormValues(details) } } } }));
  copyFileSync(`${REFERENCE_DIR}/form-thermography-before.pdf`, `${out}/5-termografering-fore.pdf`);
  writeFileSync(`${out}/6-termografering-i-kontrollens-stil.pdf`, await referenceReports.find((item) => item.name === "form-thermography-before")!.render());
  console.log("ok");
})();
