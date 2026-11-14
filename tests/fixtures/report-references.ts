import { readFileSync } from "node:fs";
import { reportFontBytes } from "../helpers/report-font";
import { kfidForm, kfidFormDocument } from "../../lib/workflow/builtin-kfid-form";
import { BUILTIN_FORMS } from "../../lib/workflow/builtin-forms";
import { initialFormValues } from "../../lib/workflow/form-document";
import { createFormProtocolPdf } from "../../lib/workflow/form-report";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "../../lib/workflow/report";
import { kfidFull, kfidLong, kfidTemplate, kfidValues, type KfidCase } from "./kfid-answers";

/**
 * Today's reports, locked (2026-09-27: the control's PDF must look exactly like today and is the model for every
 * form report). Since 2026-10-06 a control is only the form Kontroll före idrifttagning, so its references are the
 * form's own PDF – the look it had when the older control editor was removed. Each case is rendered with fixed data;
 * `tests/reference-pdfs.ts` writes the PDFs and their drawings to tests/fixtures/reference-pdfs, and
 * tests/report-reference.test.ts renders them again and compares.
 */
export const REFERENCE_DIR = "tests/fixtures/reference-pdfs";
// The references are drawn with the document typeface (Manrope with DejaVu Sans behind it), as the app draws them.
const font = () => reportFontBytes();
const photo = () => new Uint8Array(readFileSync(`${REFERENCE_DIR}/photo.png`));
const logo = () => new Uint8Array(readFileSync(`${REFERENCE_DIR}/logo.png`));
export const REFERENCE_COMPANY = "Workflow Power Solutions AB";
const company = REFERENCE_COMPANY;

type KfidFile = { id: string; filename: string; mimeType: string; section: string; rowId: string | null; bytes?: Uint8Array };
/** A picture on a measurement row and a drawing on the visual inspection. */
export const kfidFiles = (): KfidFile[] => [
  { id: "file-1", filename: "grupp2-kopplingsdosa.png", mimeType: "image/png", section: "iso", rowId: "iso-2", bytes: photo() },
  { id: "file-2", filename: "Ritning A1.pdf", mimeType: "application/pdf", section: "vis", rowId: null },
];
/** Kontroll före idrifttagning as the protocol a person fills in. */
export function kfidTask(data: KfidCase, attachments: KfidFile[] = [], document = kfidFormDocument): WorkflowReportTask {
  return {
    id: "kfid-1", kind: "FORM", title: data.meta.proj, description: "", status: "COMPLETED", progress: 100, assignedToName: "", dueDate: "", totalDurationSec: 0,
    data: { kind: "FORM", details: { templateName: kfidForm.meta.name, templateVersion: 1, document, values: kfidValues(data, attachments) } },
    attachments: attachments.map(({ id, filename, mimeType, bytes }) => ({ id, filename, mimeType, bytes })),
  };
}
export const kfidLongIdentity = () => ({ company, branding: { primary: "#113351", accent: "#f59e0b", soft: "#eef4fb" }, logoBytes: logo() });

export const referenceRiskTask: WorkflowReportTask = {
  id: "risk-1", kind: "RISK_ASSESSMENT", title: "Riskbedömning – byte av elcentral A1", description: "Byte av huvudcentral i källarplan under pågående drift i fastigheten.",
  status: "COMPLETED", progress: 100, projectName: "Brf Solgläntan", customerName: "Brf Solgläntan", assignedToName: "Elon Strömberg", dueDate: "2026-10-01", totalDurationSec: 5400,
  data: { kind: "RISK_ASSESSMENT", details: {
    risks: [
      { hazard: "Arbete nära spänningssatta delar i befintlig central", likelihood: 3, consequence: 5, protectiveMeasure: "Frånkoppling, låsning och spänningsprovning före arbete. Isolerande verktyg.", residualLikelihood: 1, residualConsequence: 5 },
      { hazard: "Tunga lyft av ny central", likelihood: 3, consequence: 3, protectiveMeasure: "Två personer och lyftvagn.", residualLikelihood: 2, residualConsequence: 2 },
      { hazard: "Snubbelrisk från kablar i passage", likelihood: 4, consequence: 2, protectiveMeasure: "Avspärrning och kabelskydd.", residualLikelihood: 1, residualConsequence: 2 },
    ],
    generalMeasures: "Arbetsberedning genomgången med alla. Avspärrning vid centralen och personlig skyddsutrustning.",
    approval: { name: "Maria Ek", confirmed: true, approvedAt: "2026-09-26T07:30:00.000Z" },
  } },
  attachments: [],
};

function thermographyTask(): WorkflowReportTask {
  const form = BUILTIN_FORMS.find((item) => item.meta.name === "Termografering") ?? BUILTIN_FORMS[0];
  const values = initialFormValues(form.document);
  values.fields = { ...values.fields, matdatum: "2026-09-27T09:30", kamera: "Värmekamera 640 × 480", omgivning: 21, driftlage: "Normal drift", miljo: "Inomhus" };
  values.tables.objekt = [
    { id: "row-1", label: "", cells: { objekt: "Central A1, grupp 12", komponent: "Säkring", fas: "L2", maxtemp: 68.4, reftemp: 31.2, last: 12, markstrom: 16, bedomning: "Åtgärda planerat", atgard: "Byt säkringshållare vid nästa service.", termobild: ["photo-1"] } },
    { id: "row-2", label: "", cells: { objekt: "T1 lågspänningsanslutning", komponent: "Kabelanslutning", fas: "Alla faser", maxtemp: 34.1, reftemp: 32.9, bedomning: "Ingen anmärkning" } },
  ];
  values.fields.sammanfattning = "En anmärkning som åtgärdas planerat.";
  values.signatures.termograf = { name: "Elon Strömberg", confirmed: true, signedAt: "2026-09-27T11:00:00.000Z" };
  values.deviationComment = "Säkringshållaren byts vid nästa service.";
  return {
    id: "form-1", kind: "FORM", title: "Termografering Brf Solgläntan", description: "", status: "IN_PROGRESS", progress: 80, customerName: "Brf Solgläntan", assignedToName: "Elon Strömberg", dueDate: "", totalDurationSec: 3600,
    data: { kind: "FORM", details: { templateName: form.meta.name, templateVersion: 1, document: form.document, values } },
    attachments: [{ id: "photo-1", filename: "termobild-a1.png", mimeType: "image/png", bytes: photo() }],
  };
}

const fixedTime = new Date("2026-09-27T12:00:00.000Z");
/** `locked`: the drawing must stay exactly the same; the others are kept as references for content comparisons. */
export const referenceReports: { name: string; locked: boolean; render: () => Promise<Uint8Array> }[] = [
  { name: "kfid-full", locked: true, render: () => createFormProtocolPdf({ identity: { company }, fontBytes: font(), task: kfidTask(kfidFull, kfidFiles()), options: defaultWorkflowReportOptions, createdAt: fixedTime }) },
  { name: "kfid-long-logo", locked: true, render: () => createFormProtocolPdf({ identity: kfidLongIdentity(), fontBytes: font(), task: kfidTask(kfidLong), options: defaultWorkflowReportOptions, createdAt: fixedTime }) },
  { name: "kfid-template", locked: true, render: () => createFormProtocolPdf({ identity: { company }, fontBytes: font(), task: kfidTask(kfidTemplate), options: defaultWorkflowReportOptions, createdAt: fixedTime, blank: true }) },
  { name: "risk-assessment", locked: true, render: () => createWorkflowPdfReport({ company, tasks: [referenceRiskTask], options: defaultWorkflowReportOptions, fontBytes: font(), createdAt: fixedTime }) },
  // Protokollmallen (2026-11-01, beslut 6): the original printed by the shared template. Not locked until its look is
  // approved; `npx tsx tests/reference-pdfs.ts protocol-template` writes it, and `locked: true` then guards it like the others.
  { name: "protocol-template", locked: false, render: () => createFormProtocolPdf({ identity: { company, sender: { organizationNumber: "556000-0000", vatNumber: "SE556000000001", fSkatt: true, address: "Verkstadsgatan 1, 123 45 Provstad", phone: "010-123 45 67", email: "info@example.invalid" } }, fontBytes: font(), task: { ...kfidTask(kfidFull, kfidFiles()), protocolNumber: "P-REFERENS", customerName: "Brf Solgläntan", projectName: "Brf Solgläntan", facilityName: "Hus A", workOrderTitle: "Byte av elcentral A1", completedAt: "2026-09-27T11:00:00.000Z", customerReceipt: { name: "Maria Ek", at: "2026-09-27T11:30:00.000Z" } }, options: defaultWorkflowReportOptions, createdAt: fixedTime }) },
  { name: "form-thermography-before", locked: false, render: () => createWorkflowPdfReport({ company, tasks: [thermographyTask()], options: defaultWorkflowReportOptions, fontBytes: font(), createdAt: fixedTime }) },
];
