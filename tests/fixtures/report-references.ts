import { readFileSync } from "node:fs";
import { attachmentLabel } from "../../lib/kfid/editor-tools";
import type { ControlData, Measurement } from "../../lib/kfid/model";
import { createPdfReport, type ReportFile } from "../../lib/kfid/report-core";
import { BUILTIN_FORMS } from "../../lib/workflow/builtin-forms";
import { initialFormValues } from "../../lib/workflow/form-document";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "../../lib/workflow/report";

/**
 * Today's reports, locked before the form engine takes over the control and the risk assessment (Daniel 2026-09-27:
 * the control's PDF must look exactly like today and is the model for every form report). Each case is rendered with
 * fixed data; `tests/reference-pdfs.ts` writes the PDFs and their drawings to tests/fixtures/reference-pdfs,
 * and tests/report-reference.test.ts renders them again and compares.
 */
export const REFERENCE_DIR = "tests/fixtures/reference-pdfs";
const font = () => new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
const photo = () => new Uint8Array(readFileSync(`${REFERENCE_DIR}/photo.png`));
const logo = () => new Uint8Array(readFileSync(`${REFERENCE_DIR}/logo.png`));
const company = "HINTEK Power Solutions AB";

const row = (uid: string, values: Record<string, unknown>): Measurement => ({ uid, ok: false, comment: "", ...values }) as Measurement;

export const referenceControlFull: ControlData = {
  meta: { proj: "Brf Solgläntan – ny elcentral A1", perf: "Elon Strömberg", ctrl: "Maria Ek", client: "Anna Berg", addr: "anna.berg@example.se", date: "2026-09-27", instr: "Fluke 1664 FC", sn: "SN 4471-22", cal: "2026-03-01", autoOn: true },
  active: { iso: true, cont: true, volt: true, rcd: true, vis: true },
  iso: { rows: [
    row("iso-1", { objekt: "Grupp 1 – belysning trapphus", u: "500 V", mohm: 250, limit: 1 }),
    row("iso-2", { objekt: "Grupp 2 – uttag kök", u: "500 V", mohm: 0.4, limit: 1, comment: "Fukt i kopplingsdosa, åtgärdas och mäts om." }),
    row("iso-3", { objekt: "Exempelkrets", u: "250 V", mohm: 12, limit: 0.5, example: true }),
  ] },
  cont: { rows: [
    row("cont-1", { name: "PE huvudcentral – A1", ohm: 0.12, limit: 0.5 }),
    row("cont-2", { name: "Skyddsutjämning VVS", ohm: 0.74, limit: 0.5, comment: "Förbindning lös, efterdragen." }),
  ] },
  volt: { rows: [
    row("volt-1", { name: "Inkommande L1–L2–L3", status: "400 Vac", rotation: "Höger" }),
    row("volt-2", { name: "Uttag kök", status: "Saknas", rotation: "Ej mätt", comment: "Säkring löst ut." }),
  ] },
  rcd: { rows: [
    row("rcd-1", { place: "JFB 1 – A1:F2", std: "EN", type: "A", idn: 30, idp: 21, idn_measured: 22, t1p: 24, t1n: 26, t5p: 12, t5n: 14, uclim: "50", uc: 1.2, ntrip05: true, btnok: true, comment: "Provad med testknapp och instrument." }),
    row("rcd-2", { place: "JFB 2 – A1:F7", std: "TT", type: "AC", idn: 30, idp: 25, idn_measured: 26, t1p: 240, t1n: 255, t5p: 38, t5n: 44, uclim: "25", uc: 3.4, ntrip05: false, btnok: true }),
  ] },
  vis: { checks: { markning: true, dok: true, mek: false, ip: true }, comment: "Mekaniskt skydd saknas vid kabelgenomföring i källaren. Ny genomföring beställd." },
};

const longRows = (count: number, make: (index: number) => Record<string, unknown>) => Array.from({ length: count }, (_, index) => row(`r-${index + 1}`, make(index)));
export const referenceControlLong: ControlData = {
  meta: { proj: "Industrihall Norra – nyinstallation med ett mycket långt projektnamn som bryts på två rader i rutan", perf: "Elon Strömberg", ctrl: "", client: "", addr: "", date: "2026-09-20", instr: "Metrel MI 3152", sn: "", cal: "", autoOn: false },
  active: { iso: true, cont: false, volt: false, rcd: true, vis: false },
  iso: { rows: longRows(42, (index) => ({ objekt: `Grupp ${index + 1} – ${index % 3 ? "uttag" : "belysning och nödbelysning i produktionshallens norra del"}`, u: index % 4 ? "500 V" : "1000 V", mohm: 100 + index, limit: 1, ok: index % 7 !== 3, comment: index % 5 === 0 ? "Uppmätt efter att frånskiljaren öppnats och alla laster kopplats bort." : "" })) },
  cont: { rows: [] },
  volt: { rows: [] },
  rcd: { rows: longRows(4, (index) => ({ place: `JFB ${index + 1}`, std: "TNIT", type: "B", idn: 300, idp: 180, idn_measured: 190, t1p: 120, t1n: 130, t5p: 20, t5n: 22, uclim: "50", uc: 2, ntrip05: true, btnok: index !== 2, ok: index !== 2 })) },
  vis: { checks: {}, comment: "" },
};

export const referenceControlTemplate: ControlData = {
  ...referenceControlFull,
  active: { iso: true, cont: true, volt: true, rcd: true, vis: true },
  iso: { rows: [] }, cont: { rows: [] }, volt: { rows: [] }, rcd: { rows: [] },
};

function controlFiles(data: ControlData): ReportFile[] {
  const files = [
    { filename: "grupp2-kopplingsdosa.png", mimeType: "image/png", section: "iso", rowId: "iso-2", bytes: photo() },
    { filename: "Ritning A1.pdf", mimeType: "application/pdf", section: "vis", rowId: null },
  ];
  return files.map((file) => ({ ...file, label: attachmentLabel(data, file) }));
}

export const referenceRiskTask: WorkflowReportTask = {
  id: "risk-1", kind: "RISK_ASSESSMENT", title: "Riskbedömning – byte av elcentral A1", description: "Byte av huvudcentral i källarplan under pågående drift i fastigheten.",
  status: "COMPLETED", progress: 100, projectName: "Brf Solgläntan", customerName: "Brf Solgläntan", siteName: "Stockholm", assignedToName: "Elon Strömberg", dueDate: "2026-10-01", totalDurationSec: 5400,
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
  values.fields = { ...values.fields, matdatum: "2026-09-27T09:30", kamera: "FLIR T560", omgivning: 21, driftlage: "Normal drift", miljo: "Inomhus" };
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
  { name: "control-full", locked: true, render: () => createPdfReport(referenceControlFull, { company }, controlFiles(referenceControlFull), false, font()) },
  { name: "control-long-logo", locked: true, render: () => createPdfReport(referenceControlLong, { company, branding: { primary: "#113351", accent: "#f59e0b", soft: "#eef4fb" }, logoBytes: logo() }, [], false, font()) },
  { name: "control-template", locked: true, render: () => createPdfReport(referenceControlTemplate, { company }, [], true, font()) },
  { name: "risk-assessment", locked: true, render: () => createWorkflowPdfReport({ company, tasks: [referenceRiskTask], options: defaultWorkflowReportOptions, fontBytes: font(), createdAt: fixedTime }) },
  { name: "form-thermography-before", locked: false, render: () => createWorkflowPdfReport({ company, tasks: [thermographyTask()], options: defaultWorkflowReportOptions, fontBytes: font(), createdAt: fixedTime }) },
];
