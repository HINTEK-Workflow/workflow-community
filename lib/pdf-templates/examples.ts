import { PDFDocument } from "pdf-lib";
import { createQuotePdf, type QuotePdfQuote } from "@/lib/quotes/quote-report";
import { quoteTotals, quoteVersionDiff, type QuoteLineView } from "@/lib/quotes/model";
import { createInvoiceBasisPdf } from "@/lib/invoice-basis/basis-report";
import { invoiceBasisTotals, type InvoiceBasisLine, type InvoiceBasisView } from "@/lib/invoice-basis/model";
import { createBasisPdf } from "@/lib/payroll/basis-report";
import { createCustomerInvoicePdf } from "@/lib/customer-invoice/report";
import { exampleInvoiceContent, EXAMPLE_PERSONAL_NUMBER } from "@/lib/customer-invoice/examples";
import { createStaffRegisterPdf } from "@/lib/staff-register/report";
import type { RegisterEvent } from "@/lib/staff-register/model";
import { createSelfInspectionPdf } from "@/lib/self-inspection/report";
import { ACTIVITY_TYPES, programContent, type VersionView } from "@/lib/self-inspection/model";
import { programFromTemplate } from "@/lib/self-inspection/template";
import { createDeviationsPdf, type DeviationExportEntry } from "@/lib/self-inspection/deviation-export";
import { createFormProtocolPdf } from "@/lib/workflow/form-report";
import { kfidForm, kfidFormDocument } from "@/lib/workflow/builtin-kfid-form";
import { formDocumentSchema, initialFormValues, type FormDocument, type FormValues } from "@/lib/workflow/form-document";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "@/lib/workflow/report";
import { projectReportFooterLeft, stampContinuousFooter } from "@/lib/workflow/report-merge";
import type { KitIdentity } from "@/lib/workflow/report-kit";
import type { ReportFontBytes } from "@/lib/workflow/report-fonts";
import { pdfDocumentDef, type PdfDocumentType } from "./catalog";
import { PDF_EXAMPLE_VARIANTS } from "./example-variants";
import { BUILTIN_FORMS } from "@/lib/workflow/builtin-forms";
import { ROUND_FORMS } from "@/lib/workflow/builtin-rounds";
import { riskForm } from "@/lib/workflow/builtin-risk-form";
import { isolationMeasurementForm } from "@/lib/workflow/form-examples";
import { PdfTrace, tracedTemplates, type PdfTemplateOverride, type PdfTraceTarget } from "./model";

/**
 * The editor's preview (PDF-mallar, 2026-11-03): each document type drawn by its real generator with INVENTED data only –
 * an invented company, customer, people and numbers – so the product owner never sees a customer's business data here
 * (CLAUDE.md, tenant isolation). Each example is chosen so that as many of the document's blocks as possible are printed.
 */
export { PDF_EXAMPLE_VARIANTS, type PdfExampleVariant } from "./example-variants";

const CREATED = new Date("2026-11-03T09:00:00.000Z");
const COMPANY = "Kopplingsbyrån AB";
const exampleIdentity = (templates: readonly PdfTemplateOverride[] | null | undefined): KitIdentity => ({
  company: COMPANY,
  sender: { organizationNumber: "556000-0000", vatNumber: "SE556000000001", fSkatt: true, address: "Strömtångsvägen 7, 123 45 Exempelstad", phone: "070-174 06 05", email: "info@example.invalid", registeredOffice: "Exempelstad", bankgiro: "123-4567", plusgiro: "12 34 56-7" },
  templates: templates ?? null,
});

const quoteLines: QuoteLineView[] = [
  { id: "l1", kind: "LABOUR", name: "Installation av laddbox", quantity: "6", unit: "h", unitPrice: "650", markupPercent: "", rotLabour: true },
  { id: "l2", kind: "MATERIAL", name: "Laddbox 11 kW", quantity: "1", unit: "st", unitPrice: "9800", markupPercent: "" },
  { id: "l3", kind: "MATERIAL", name: "Kabel 5G6", quantity: "18", unit: "m", unitPrice: "", markupPercent: "" },
];
function exampleQuote(variant: string): QuotePdfQuote {
  const rot = { percent: 30, cap: 50000 };
  const base: QuotePdfQuote = {
    label: "O-1042", title: "Laddbox i garage", description: "Installation av laddbox på garagets vägg med ny matning från centralen.", status: "SENT", storedStatus: "SENT", validUntil: "2026-12-03",
    terms: "Betalning 30 dagar netto.\nArbetet utförs vardagar 07–16.", customerType: "PRIVATE", rotPercent: 30, reverseVat: false, buyerVatNumber: "", changeOfVersion: null, change: null,
    customer: { id: "c", name: "Anna Exempel", contactName: "", address: "Exempelvägen 2, 123 45 Exempelstad" }, facility: null, project: null, sentAt: "2026-11-03T08:00:00.000Z",
    lines: quoteLines, totals: quoteTotals(quoteLines, 25, rot),
  };
  if (variant === "draft") return { ...base, status: "DRAFT", storedStatus: "DRAFT", sentAt: null };
  if (variant === "ata") {
    const after = [{ ...quoteLines[0]!, quantity: "8" }, quoteLines[2]!, { id: "l4", kind: "MATERIAL" as const, name: "Jordfelsbrytare", quantity: "1", unit: "st", unitPrice: "1200", markupPercent: "" }];
    return { ...base, label: "O-1042-Ä1", title: "Tillägg: jordfelsbrytare", description: "Kunden vill ha en jordfelsbrytare för laddboxen.", changeOfVersion: 2, customerType: "COMPANY", rotPercent: null,
      customer: { id: "c", name: "Exempel Bygg AB", contactName: "Bo Exempel", address: "Exempelgatan 9, 123 45 Exempelstad" }, lines: after, totals: quoteTotals(after, 25), change: quoteVersionDiff(quoteLines, after) };
  }
  return base;
}

function exampleBasis(): InvoiceBasisView {
  const lines: InvoiceBasisLine[] = [
    { id: "b1", kind: "LABOUR", name: "Arbete", quantity: "8", unit: "h", unitPrice: "650", markupPercent: "", sources: [], rotLabour: true },
    { id: "b2", kind: "MATERIAL", name: "Dvärgbrytare 16 A", quantity: "4", unit: "st", unitPrice: "", markupPercent: "", sources: [] },
  ];
  const rot = { percent: 30, cap: 50000 };
  return {
    id: "b", number: 7, label: "F-0007", revision: 1, title: "Byte av elcentral", status: "DRAFT", vatPercent: 25, note: "", lines, totals: invoiceBasisTotals(lines, 25, rot),
    invoicedAt: null, invoicedByName: "", createdAt: CREATED.toISOString(), updatedAt: CREATED.toISOString(), task: null, project: null, customer: { id: "c", name: "Anna Exempel", contactName: "", address: "Exempelvägen 2, 123 45 Exempelstad" },
    canEdit: true, quoteNote: "", priceDefaults: { hourlyRate: "", markupPercent: "" }, customerType: "PRIVATE", tax: { reverseVat: false, buyerVatNumber: "", rotEnabled: true, rotPercent: 30, rotCap: 50000 },
  } as InvoiceBasisView;
}

const workOrderTask = (): WorkflowReportTask => ({
  id: "w1", kind: "WORK_ORDER", title: "Byte av elcentral", description: "Byt elcentralen i källaren.", status: "IN_PROGRESS", progress: 60, assignedToName: "Erik Exempel", dueDate: "2026-11-10", totalDurationSec: 5 * 3600,
  customerName: "Brf Exempel", facilityName: "Hus A", projectName: "Elrenovering",
  data: { kind: "WORK_ORDER", details: { executionNotes: "Gamla centralen demonterad. Ny central monterad och märkt.", deviations: "", materials: [{ name: "Elcentral 24 moduler", quantity: "1", unit: "st" }, { name: "Kabel EKK 3G2,5", quantity: "20", unit: "m" }],
    signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } },
  attachments: [],
});

function protocolTask(): WorkflowReportTask {
  return {
    id: "p1", kind: "FORM", title: "Kontroll Hus A", description: "", status: "IN_PROGRESS", progress: 40, assignedToName: "Erik Exempel", dueDate: "", totalDurationSec: 0,
    protocolNumber: "P-0001", customerName: "Brf Exempel", projectName: "Elrenovering", facilityName: "Hus A", workOrderTitle: "Byte av elcentral",
    data: { kind: "FORM", details: { templateName: kfidForm.meta.name, templateVersion: 1, document: kfidFormDocument, values: initialFormValues(kfidFormDocument) } },
    attachments: [],
  };
}

function exampleEvents(): RegisterEvent[] {
  const at = (minute: number) => new Date(CREATED.getTime() + minute * 60000);
  return [
    { id: "e1", personId: "p1", personName: "Erik Exempel", idNumber: "19800101-0000", employerName: COMPANY, employerOrgNo: "556000-0000", kind: "IN", occurredAt: at(0), registeredAt: at(0), registeredByName: "Erik Exempel", correctsId: null, reason: "", siteId: "EX123" },
    { id: "e2", personId: "p2", personName: "Eva Exempel", idNumber: "19850202-0000", employerName: COMPANY, employerOrgNo: "556000-0000", kind: "IN", occurredAt: at(5), registeredAt: at(5), registeredByName: "Eva Exempel", correctsId: null, reason: "", siteId: "EX123" },
    { id: "e3", personId: "p2", personName: "Eva Exempel", idNumber: "19850202-0000", employerName: COMPANY, employerOrgNo: "556000-0000", kind: "OUT", occurredAt: at(240), registeredAt: at(240), registeredByName: "Eva Exempel", correctsId: null, reason: "", siteId: "EX123" },
  ];
}

function exampleVersion(): VersionView {
  let counter = 0;
  const draft = programFromTemplate({ id: "prog", now: CREATED.toISOString(), newId: () => `id-${++counter}`, title: "Egenkontrollprogram" });
  const content = programContent(draft);
  // The first sections only: the preview shows the document's own texts, not the whole programme.
  const sections = content.sections.slice(0, 2);
  const roles = content.roles.slice(0, 2).map((role, index) => ({ ...role, members: [{ personId: `person-${index}`, name: index ? "Eva Exempel" : "Erik Exempel", authorizationLevel: index ? "" as const : "AB" as const, registered: !index }] }));
  return { id: "v", number: 3, content: { ...content, sections, roles, registrationCheckedAt: "2026-10-01" }, hash: "0123456789abcdef0123", changeReason: "Årlig översyn.", approvedById: "person-0", approvedByName: "Erik Exempel", approvedAt: CREATED.toISOString() } as VersionView;
}

function exampleDeviations(): DeviationExportEntry[] {
  const base: DeviationExportEntry = {
    id: "d1", number: 4, kind: "DEVIATION", title: "Stege gled på vått golv", description: "Stegen gled när golvet var nyvattnat.", category: "ROUTINE", systematic: false, status: "OPEN",
    action: "Halkskydd på stegen och skylt vid våtstädning.", responsibleId: "r", responsibleName: "Eva Exempel", dueDate: "2026-11-20", followUp: "Kontroll om en månad.", reportedById: "w", reportedByName: "Erik Exempel",
    createdAt: CREATED.toISOString(), updatedAt: CREATED.toISOString(), closedAt: null, source: null, type: "NEAR_MISS",
    occurredAt: CREATED.toISOString(), whatHappened: "Stegen gled åt sidan.", cause: "Vått golv.", serious: false, electrical: false,
  } as DeviationExportEntry;
  const second = { ...base, id: "d2", number: 5, title: "Saknad märkning i central", type: "SELF_INSPECTION", description: "Gruppförteckning saknas.", whatHappened: undefined, cause: undefined } as DeviationExportEntry;
  return [base, second];
}

const TINY_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const pricedOptions = { ...defaultWorkflowReportOptions, prices: true };
const plainOptions = { ...defaultWorkflowReportOptions, prices: false };
const AT = "2026-11-03T09:00:00.000Z";

function exampleQuoteVariant(key: string): QuotePdfQuote {
  const plain = exampleQuote("quote");
  const company = { customerType: "COMPANY" as const, rotPercent: null, customer: { id: "c", name: "Exempel Bygg AB", contactName: "Bo Exempel", address: "Exempelgatan 9, 123 45 Exempelstad" } };
  const numbered = quoteLines.map((line, index) => ({ ...line, articleNo: `A-${index + 1}` }));
  switch (key) {
    case "draft": {
      // A low cap, so the example says what a deduction at the cap looks like.
      return { ...exampleQuote("draft"), totals: quoteTotals(quoteLines, 25, { percent: 30, cap: 500 }) };
    }
    case "ata": return exampleQuote("ata");
    case "reverse": return { ...plain, ...company, reverseVat: true, buyerVatNumber: "SE556000000001", status: "ACCEPTED", storedStatus: "ACCEPTED", lines: numbered, totals: quoteTotals(numbered, 25),
      project: { id: "p", name: "Elrenovering" }, facility: { id: "f", name: "Hus A", address: "Exempelvägen 2" } } as QuotePdfQuote;
    case "empty": return { ...plain, ...company, customer: null, description: "", terms: "", validUntil: "", lines: [], totals: quoteTotals([], 25) } as unknown as QuotePdfQuote;
    case "ata-reverse": return { ...exampleQuote("ata"), reverseVat: true, buyerVatNumber: "SE556000000001", change: quoteVersionDiff(quoteLines, quoteLines) };
    case "ata-rot": return { ...exampleQuote("ata"), customerType: "PRIVATE", rotPercent: 30, totals: quoteTotals(quoteLines, 25, { percent: 30, cap: 50000 }) };
    case "long": {
      const lines = Array.from({ length: 60 }, (_, index) => ({ ...quoteLines[1]!, id: `l${index}`, name: `Artikel ${index + 1}` }));
      return { ...plain, lines, totals: quoteTotals(lines, 25) };
    }
    default: return plain;
  }
}

function exampleBasisVariant(key: string): InvoiceBasisView {
  const base = exampleBasis();
  const company = { customerType: "COMPANY", customer: { id: "c", name: "Exempel Bygg AB", contactName: "Bo Exempel", address: "Exempelgatan 9" } };
  if (key === "invoiced") return { ...base, ...company, status: "INVOICED", invoicedAt: AT, invoicedByName: "Eva Exempel", task: { id: "t", title: "Byte av elcentral" }, project: { id: "p", name: "Elrenovering" }, tax: { ...base.tax!, rotEnabled: false }, totals: invoiceBasisTotals(base.lines, 25) } as unknown as InvoiceBasisView;
  if (key === "articles") { const lines = base.lines.map((line, index) => ({ ...line, articleNo: `A-${index + 1}` })); return { ...base, lines, totals: invoiceBasisTotals(lines, 25, { percent: 30, cap: 500 }) } as InvoiceBasisView; }
  if (key === "invoiced-unnamed") return { ...base, status: "INVOICED", invoicedAt: AT, invoicedByName: "" } as unknown as InvoiceBasisView;
  if (key === "reverse") return { ...base, ...company, status: "NOT_INVOICED", tax: { ...base.tax!, reverseVat: true, buyerVatNumber: "SE556000000001", rotEnabled: false }, totals: invoiceBasisTotals(base.lines, 25) } as unknown as InvoiceBasisView;
  if (key === "empty") return { ...base, customer: null, lines: [], tax: { ...base.tax!, rotEnabled: false }, totals: invoiceBasisTotals([], 25) } as unknown as InvoiceBasisView;
  return base;
}

function workOrderVariant(key: string): { task: WorkflowReportTask; prices: boolean; hourlyRate: number | null } {
  const base = workOrderTask();
  const details = (base.data as Extract<WorkflowReportTask["data"], { kind: "WORK_ORDER" }>).details;
  if (key === "done") return { prices: true, hourlyRate: 650, task: { ...base, status: "COMPLETED", progress: 100, completedAt: AT, workOrderTitle: "Elrenovering, etapp 1", projectFields: [["Beställare", "Brf Exempel"]],
    customerComments: [{ authorName: "Erik Exempel", body: "Kunden är informerad.", createdAt: AT }],
    maintenanceItems: [{ partName: "Pump 1", facts: { type: "", priority: "", criticality: "", marking: "", fault: "", cause: "", causeNote: "", reportedAt: null } }],
    attachments: [{ id: "a1", filename: "central.png", mimeType: "image/png", bytes: TINY_PNG }, { id: "a2", filename: "matning.pdf", mimeType: "application/pdf" }],
    data: { kind: "WORK_ORDER", details: { ...details, deviations: "Skyddsplåt saknades.", closeNotes: "Klart enligt plan.", signature: { name: "Erik Exempel", confirmed: true, signedAt: AT }, customerReceipt: { name: "Anna Exempel", at: AT },
      materials: [{ name: "Elcentral", quantity: "1", unit: "st", unitPrice: "4200", articleNo: "A-1", manufacturerArticleNo: "T-99" }, { name: "Parkering", quantity: "1", unit: "st", kind: "expense", unitPrice: "80", amount: "80" }] } } } };
  if (key === "no-rate") return { prices: true, hourlyRate: null, task: { ...base, billedLabour: { standardSec: 3600, own: [{ name: "Jour", seconds: 3600, rate: null }] }, totalDurationSec: 7200,
    data: { kind: "WORK_ORDER", details: { ...details, materials: [{ name: "Parkering", quantity: "1", unit: "st", kind: "expense", unitPrice: "", amount: "kvitto saknas" }, { name: "Färja", quantity: "1", unit: "st", kind: "expense", amount: "okänt" }] } } } };
  if (key === "no-rate-one") return { prices: true, hourlyRate: null, task: { ...base, attachments: [{ id: "a1", filename: "central.png", mimeType: "image/png", bytes: TINY_PNG }],
    data: { kind: "WORK_ORDER", details: { ...details, customerReceipt: { name: "Anna Exempel", at: null }, materials: [{ name: "Parkering", quantity: "1", unit: "st", kind: "expense", amount: "kvitto saknas" }] } } } };
  if (key === "expenses") return { prices: false, hourlyRate: null, task: { ...base, data: { kind: "WORK_ORDER", details: { ...details, materials: [{ name: "Parkering", quantity: "1", unit: "st", kind: "expense", amount: "80" }] } } } };
  if (key === "empty") return { prices: false, hourlyRate: null, task: { ...base, customerName: "", projectName: "", assignedToName: "", dueDate: "", description: "",
    data: { kind: "WORK_ORDER", details: { ...details, executionNotes: "", materials: [], tempPlace: { description: "Vid grinden" } } as typeof details } } };
  return { task: base, prices: false, hourlyRate: null };
}

const riskRows = [{ hazard: "Arbete nära spänning", likelihood: 3, consequence: 4, protectiveMeasure: "Frånkoppla och lås", residualLikelihood: 1, residualConsequence: 4 }, { hazard: "Halka", likelihood: 2, consequence: 2, protectiveMeasure: "", residualLikelihood: 1, residualConsequence: 2 }];
function riskTask(key: string): WorkflowReportTask {
  const check = (extra: object) => ({ answers: { deenergized: "yes", competence: "no" }, level: "simplified", confirmedBy: "Erik Exempel", confirmedAt: AT, ...extra });
  if (key === "step" || key === "step-extended" || key === "exception") {
    const riskCheck = key === "step" ? check({ confirmedBy: "" }) : key === "step-extended" ? check({ level: "extended", confirmedBy: "", confirmedAt: null, extendedTaskId: "x" }) : check({ exception: { reason: "Akut fel, arbetet var redan utfört.", by: "", at: AT, byId: "u" } });
    const base = workOrderTask();
    return { ...base, data: { ...base.data, riskCheck } as unknown as WorkflowReportTask["data"] };
  }
  const approved = key === "approved";
  return { id: "r1", kind: "RISK_ASSESSMENT", title: "Arbete i elcentral", description: approved ? "Bedöm riskerna före bytet." : "", status: approved ? "COMPLETED" : "IN_PROGRESS", progress: approved ? 100 : 50, completedAt: approved ? AT : null, assignedToName: approved ? "Erik Exempel" : "", dueDate: approved ? "2026-11-10" : "", totalDurationSec: 1800,
    customerName: approved ? "Brf Exempel" : "", projectName: approved ? "Elrenovering" : "", facilityName: "Hus A", workOrderTitle: approved ? "Byte av elcentral" : undefined, projectFields: approved ? [["Beställare", "Brf Exempel"]] : undefined,
    data: { kind: "RISK_ASSESSMENT", details: { risks: key === "none" ? [] : riskRows, generalMeasures: approved ? "Avspärrning vid centralen." : "", approval: { name: approved ? "Eva Exempel" : "", confirmed: approved, approvedAt: approved ? AT : null } }, ...(approved ? {} : { tempPlace: { description: "Vid grinden" } }) } as WorkflowReportTask["data"],
    attachments: [] };
}

/** A protocol from one of the product's own forms, filled in with invented answers. */
function filledProtocol(document: FormDocument, templateName: string, fill: (values: FormValues) => void, task: Partial<WorkflowReportTask> = {}): WorkflowReportTask {
  const values = initialFormValues(document);
  fill(values);
  return { ...protocolTask(), data: { kind: "FORM", details: { templateName, templateVersion: 2, document, values } }, ...task };
}
const firstTableRows = (document: FormDocument, values: FormValues, cells: Record<string, string>) => {
  const table = document.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block) => block.type === "table");
  if (table && table.type === "table") for (const row of values.tables[table.key] ?? []) row.cells = { ...row.cells, ...cells };
};
/** An invented form that uses what the product's own forms leave out: remarks, totals, picture columns, limits and summaries. */
const FIELD = { help: "", unit: "", min: null, max: null, options: [], multiple: false, allowNotApplicable: true };
const COLUMN = { required: false, unit: "", options: [], min: null, max: null, formula: "", passCondition: false };
const fullForm: FormDocument = formDocumentSchema.parse({
  schema: 1,
  limits: [{ key: "isolation", label: "Isolation", unit: "MΩ", low: 1, high: null, warnLow: 2, warnHigh: null, source: "Företagets gränsprofil" }, { key: "temp", label: "Temperatur", unit: "°C", low: null, high: 80, warnLow: null, warnHigh: 60, source: "" }],
  blocks: [
    { id: "sek", type: "section", title: "Mätningar", blocks: [
      { id: "instrument", type: "field", key: "instrument", label: "Instrument", input: "text", required: false, ...FIELD, prefill: "instrument", remarks: true },
      { id: "matt", type: "field", key: "matt", label: "Isolation", input: "number", required: false, ...FIELD, unit: "MΩ", limit: "isolation" },
      { id: "rader", type: "table", key: "rader", label: "Rader", rowMode: "free", required: false, help: "", columns: [
        { id: "namn", key: "namn", label: "Namn", input: "text", ...COLUMN, total: "none" },
        { id: "antal", key: "antal", label: "Antal", input: "number", ...COLUMN, total: "sum" },
        { id: "foto", key: "foto", label: "Foto", input: "images", ...COLUMN, total: "none" },
        { id: "ok", key: "ok", label: "Godkänd", input: "assessment", ...COLUMN, total: "none" },
      ] },
      { id: "fasta", type: "table", key: "fasta", label: "Fasta rader", rowMode: "fixed", fixedRows: ["F1"], required: false, help: "", columns: [
        { id: "max", key: "max", label: "Högst", input: "number", ...COLUMN, total: "max" }, { id: "kommentar", key: "kommentar", label: "Kommentar", input: "text", ...COLUMN, total: "none" },
      ] },
      { id: "medel", type: "table", key: "medel", label: "Medelvärden", rowMode: "free", required: false, help: "", columns: [
        { id: "m", key: "m", label: "Medel", input: "number", ...COLUMN, total: "avg" }, { id: "s", key: "s", label: "Summa", input: "number", ...COLUMN, total: "sum" },
      ] },
      { id: "kort", type: "table", key: "kort", label: "Objekten", layout: "cards", rowMode: "free", required: false, help: "", columns: [
        { id: "plats", key: "plats", label: "Plats", input: "text", ...COLUMN, total: "none" }, { id: "temp", key: "temp", label: "Temperatur", input: "number", ...COLUMN, max: 80, total: "none" },
      ] },
      { id: "bilder", type: "images", key: "bilder", label: "Bilder", pdfInline: true, accept: "images" },
      { id: "filer", type: "images", key: "filer", label: "Ritningar", pdfInline: true, accept: "files" },
      { id: "summa", type: "summary", label: "Sammanfattning / avvikelser" },
      { id: "sign", type: "signature", key: "sign", label: "Kontrollerad av", required: false },
      { id: "sign2", type: "signature", key: "sign2", label: "Granskad av", required: false },
    ] },
  ],
});
function fullProtocol(): WorkflowReportTask {
  return filledProtocol(fullForm, "Kontroll med allt", (values) => {
    values.fields.instrument = "IT-200";
    values.instruments = { instrument: { overdue: true } } as unknown as FormValues["instruments"];
    values.remarks = { instrument: { comment: "Lånat instrument.", deviation: true } } as unknown as FormValues["remarks"];
    values.fields.matt = 1.5;
    const row = (id: string, cells: Record<string, unknown>, more = {}) => ({ id, label: "", cells, ...more }) as FormValues["tables"][string][number];
    values.tables.rader = [row("r0", { namn: "Grupp 1", antal: 1, foto: ["a1"], ok: false }), row("r1", { namn: "Grupp 2", antal: 2, foto: ["a2", "a3"], ok: true }, { example: true }),
      ...Array.from({ length: 9 }, (_, index) => row(`x${index}`, { namn: `Grupp ${index + 3}`, antal: 1, ok: false })),
      row("j1", { namn: "Grupp utan gräns", antal: 1 }, { judged: { approved: true, by: "Erik Exempel", at: AT } })];
    values.tables.fasta = [row("f0", { max: 3, kommentar: "" })];
    values.tables.medel = [row("m0", { m: 3, s: 4 })];
    values.tables.kort = [row("k0", { plats: "", temp: 95 })];
    values.images = { bilder: ["a4"], filer: ["a5"] };
    values.signatures = { sign: { name: "Erik Exempel", confirmed: true, signedAt: null }, sign2: { name: "Eva Exempel", confirmed: false, signedAt: null } };
  }, { assignedToName: "", status: "IN_PROGRESS", customerReceipt: { name: "Anna Exempel", at: null }, attachments: [
    ...["a1", "a2", "a3"].map((id) => ({ id, filename: `${id}.png`, mimeType: "image/png", bytes: TINY_PNG })), { id: "a4", filename: "central.png", mimeType: "image/png", bytes: TINY_PNG }, { id: "a5", filename: "ritning.pdf", mimeType: "application/pdf" }, { id: "a6", filename: "extra.pdf", mimeType: "application/pdf" }] });
}
function protocolVariant(key: string): { task: WorkflowReportTask; blank?: boolean } {
  switch (key) {
    case "blank": return { task: protocolTask(), blank: true };
    case "blank-round": {
      const form = ROUND_FORMS.find((item) => item.id === "hintek-driftrond-vattenkraft")!;
      return { task: filledProtocol(form.document, form.meta.name, () => undefined), blank: true };
    }
    case "blank-safety": {
      const form = ROUND_FORMS.find((item) => item.id === "hintek-skyddsrond")!;
      return { task: filledProtocol(form.document, form.meta.name, () => undefined), blank: true };
    }
    case "full": return { task: fullProtocol() };
    case "full-preview": return { task: { ...fullProtocol(), protocolNumber: undefined, version: 3, facilityName: "Hus A", data: { ...fullProtocol().data, tempPlace: { description: "Vid grinden" } } as unknown as WorkflowReportTask["data"] } };
    case "measure": return { task: filledProtocol(isolationMeasurementForm, "Isolationsmätning", (values) => {
      values.fields.instrument = "IT-200";
      if (values.tables.matning?.[0]) values.tables.matning[0].cells = { uppmatt: "250", grans: "1" };
      if (values.tables.matning?.[1]) values.tables.matning[1].cells = { uppmatt: "0,4", grans: "1" };
      values.signatures.utford = { name: "Erik Exempel", confirmed: true, signedAt: AT };
      values.finalVerdict = { choice: "REMARK", by: "Erik Exempel", at: AT };
    }, { status: "COMPLETED", progress: 100, completedAt: AT, customerReceipt: { name: "Anna Exempel", at: AT }, description: "Mät i garaget.", totalDurationSec: 1800, assignedToName: "", dueDate: "2026-11-10", customerName: "", projectName: "" }) };
    case "preview": return { task: { ...filledProtocol(isolationMeasurementForm, "Isolationsmätning", () => undefined, { protocolNumber: undefined, version: 3, facilityName: "Hus A", workOrderTitle: "Byte av elcentral", projectFields: [["Beställare", "Brf Exempel"]], status: "COMPLETED", progress: 100 }) } };
    case "thermography": {
      const form = BUILTIN_FORMS.find((item) => item.id === "hintek-termografering")!;
      return { task: filledProtocol(form.document, "Termografering", (values) => { firstTableRows(form.document, values, {}); }) };
    }
    case "round": {
      const form = ROUND_FORMS.find((item) => item.id === "hintek-driftrond-vattenkraft")!;
      return { task: filledProtocol(form.document, form.meta.name, (values) => { values.round = { scans: [{ at: AT, place: "Turbinhall", point: "Turbin 1", by: "Erik Exempel" }] } as unknown as FormValues["round"]; }) };
    }
    case "safety": {
      const form = ROUND_FORMS.find((item) => item.id === "hintek-skyddsrond")!;
      return { task: filledProtocol(form.document, form.meta.name, () => undefined) };
    }
    case "risk": return { task: filledProtocol(riskForm.document, riskForm.meta.name, () => undefined, { formArea: "risk-assessment" }) };
    default: return { task: protocolTask() };
  }
}

function deviationVariant(key: string): { entries: DeviationExportEntry[]; scope?: string; photos?: Map<string, Uint8Array>; log?: boolean } {
  const [nearMiss, selfCheck] = exampleDeviations();
  const photo = { id: "ph1", phase: "BEFORE", filename: "stege.png", mimeType: "image/png" };
  switch (key) {
    case "log": return { entries: [nearMiss!, selfCheck!], scope: "Öppna" };
    case "log-one": return { entries: [{ ...nearMiss!, occurredAt: null, serious: true, reportedToAuthorityAt: AT, reportedToAuthorityByName: "", source: { title: "", taskId: "t" }, attachments: [photo, { ...photo, id: "ph2" }, { ...photo, id: "ph3" }] } as unknown as DeviationExportEntry, { ...selfCheck!, status: "DONE" as const, serious: false }].slice(0, 1).concat([]), scope: "Öppna", photos: new Map([["ph1", TINY_PNG]]), log: true };
    case "not-reported": return { entries: [{ ...nearMiss!, serious: true, occurredAt: null } as unknown as DeviationExportEntry] };
    case "log-all": return { entries: [{ ...nearMiss!, dueDate: "2020-01-01" }, { ...selfCheck!, status: "DONE", closedAt: AT }] };
    case "empty": return { entries: [] };
    case "accident": return { entries: [{ ...nearMiss!, type: "ACCIDENT", serious: true, personalInjury: true, electrical: true, reportedToAuthorityAt: AT, reportedToAuthorityByName: "Eva Exempel", doneNote: "Kontrollerat på plats.", source: { title: "", taskId: "t" }, attachments: [photo, { ...photo, id: "ph2", mimeType: "application/pdf" }] } as unknown as DeviationExportEntry], photos: new Map([["ph1", TINY_PNG]]) };
    case "risk": return { entries: [{ ...nearMiss!, type: "RISK_OBSERVATION", serious: true, occurredAt: null, reportedByName: "", responsibleName: "", dueDate: "2020-01-01", attachments: [{ ...photo, mimeType: "application/pdf" }, { ...photo, id: "ph2", mimeType: "application/pdf" }] } as unknown as DeviationExportEntry] };
    case "self-check": return { entries: [{ ...selfCheck!, status: "DONE", closedAt: AT, closedByName: "Eva Exempel", dueDate: "", source: { title: "Kontroll Hus A", taskId: "t" }, attachments: [{ ...photo, mimeType: "application/pdf" }] } as unknown as DeviationExportEntry] };
    case "improvement": return { entries: [{ ...selfCheck!, kind: "IMPROVEMENT", type: null, title: "Bättre skyltning" } as unknown as DeviationExportEntry] };
    default: return { entries: [nearMiss!] };
  }
}

function programmeVariant(key: string): VersionView {
  const version = exampleVersion();
  if (key === "full") {
    let counter = 0;
    const content = programContent(programFromTemplate({ id: "prog", now: CREATED.toISOString(), newId: () => `id-${++counter}`, title: "Egenkontrollprogram" }));
    const roles = content.roles.map((role, index) => ({ ...role, members: index < 3 ? [{ personId: `person-${index}`, name: index === 1 ? "" : "Erik Exempel", authorizationLevel: index ? "" as const : "AB" as const, registered: !index }] : [] }));
    // Ny struktur (2026-11-24): a section with the programme's markers, the people's levels and a hired person, so every text they print is in the example.
    const sections = [...content.sections, { key: "", title: "Personal och organisation", legalRef: "", body: "{{organisation}}\n{{roller}}\n{{personal}}\n{{inhyrda}}\n{{nivaregel}}" }];
    const staff = [{ personId: "person-0", name: "Erik Exempel", roles: [roles[0]!.name], level: 3 }];
    const external = [{ id: "hired-1", name: "Inga Inhyrd", company: "Exempelbemanning AB", role: roles[2]?.name ?? "", roleId: null, level: 2 }];
    return { ...version, content: { ...content, sections, staff, external, levelYears: [2, 5], commonDuties: "Alla följer programmet och rapporterar avvikelser.", roles, people: [{ personId: "person-0", name: "Erik Exempel", scope: "", workTypes: [], supervised: false, assessment: "Har rätt kompetens.", assessedAt: "2026-10-01", limitations: "" }, { personId: "person-9", name: "", scope: "", workTypes: [], supervised: false, assessment: "", assessedAt: null, limitations: "" }], activityTypes: content.activityTypes.length ? content.activityTypes : [ACTIVITY_TYPES[0]!.key], registrationCheckedAt: null } } as unknown as VersionView;
  }
  if (key === "own") return { ...version, approvedByName: "", content: { ...version.content, peopleShownFor: "person-0", worksOnOthersInstallations: false, registrationCheckedAt: null, activityTypes: [] } } as unknown as VersionView;
  if (key === "empty") return { ...version, content: { ...version.content, roles: version.content.roles.map((role) => ({ ...role, members: [], level: null })), worksOnOthersInstallations: true } } as unknown as VersionView;
  return version;
}

/** The example PDF of a document type with the given (saved or draft) overrides. */
export async function renderPdfExample(type: PdfDocumentType, variant: string | null, templates: readonly PdfTemplateOverride[] | null, fontBytes: ReportFontBytes): Promise<Uint8Array> {
  const identity = exampleIdentity(templates);
  const key = variant && PDF_EXAMPLE_VARIANTS[type].some((item) => item.key === variant) ? variant : PDF_EXAMPLE_VARIANTS[type][0]!.key;
  const quotePdf = (name: string) => createQuotePdf({ identity, fontBytes, quote: exampleQuoteVariant(name), createdAt: CREATED });
  const orderPdf = (name: string) => {
    const { task, prices, hourlyRate } = workOrderVariant(name);
    return createWorkflowPdfReport({ ...identity, tasks: [task], options: prices ? pricedOptions : plainOptions, hourlyRate, fontBytes, createdAt: CREATED });
  };
  const deviationPdf = (name: string) => {
    const { entries, scope, photos } = deviationVariant(name);
    return createDeviationsPdf({ identity, fontBytes, entries, sections: {}, scope, photos, createdAt: CREATED });
  };
  const projectPdf = async () => {
    const cover = await createWorkflowPdfReport({ ...identity, projectName: "Elrenovering", projectFields: [["Beställare", "Brf Exempel"], ["Arbetsplats", "Exempelvägen 2"]], tasks: [workOrderTask()], taskCount: 1, options: defaultWorkflowReportOptions, fontBytes, createdAt: CREATED });
    const result = await PDFDocument.create();
    const source = await PDFDocument.load(cover);
    for (const page of await result.copyPages(source, source.getPageIndices())) result.addPage(page);
    await stampContinuousFooter(result, { fontBytes, left: projectReportFooterLeft("Elrenovering", CREATED, templates), company: COMPANY, sender: identity.sender, createdAt: CREATED, templates });
    return result.save();
  };
  switch (type) {
    case "quote": return quotePdf(key);
    case "invoice_basis": return createInvoiceBasisPdf({ identity, fontBytes, basis: exampleBasisVariant(key), createdAt: CREATED });
    case "invoice": case "credit_invoice": {
      const content = exampleInvoiceContent(key, templates);
      return createCustomerInvoicePdf({ identity, fontBytes, content, createdAt: CREATED, personalNumber: content.rot ? EXAMPLE_PERSONAL_NUMBER : undefined, preview: key === "preview", proforma: key === "proforma" });
    }
    case "work_order": return orderPdf(key);
    case "protocol": {
      const { task, blank } = protocolVariant(key);
      return createFormProtocolPdf({ identity, fontBytes, task, options: defaultWorkflowReportOptions, createdAt: CREATED, ...(blank ? { blank: true } : {}) });
    }
    case "risk_assessment": return createWorkflowPdfReport({ ...identity, tasks: [riskTask(key)], options: plainOptions, fontBytes, createdAt: CREATED });
    case "project_report": return projectPdf();
    case "staff_register": {
      const events = key === "empty" ? [] : exampleEvents();
      const correction = key === "corrections" ? [{ ...events[1]!, id: "e4", correctsId: "e3", correctionReason: "Fel tid" }, { ...events[1]!, id: "e5", correctsId: "e2" }] as RegisterEvent[] : [];
      if (key === "corrections") Object.assign(correction[0]!, { reason: "Fel tid" });
      return createStaffRegisterPdf({ identity, fontBytes, projectName: "Elrenovering", siteId: "EX123", company: { name: COMPANY, orgNo: key === "empty" ? "" : "556000-0000" }, from: "2026-11-03", to: "2026-11-03", events: [...events, ...correction], onSite: events.length ? [events[0]!] : [], now: CREATED });
    }
    case "self_inspection": return createSelfInspectionPdf({ identity, fontBytes, version: programmeVariant(key), createdAt: CREATED });
    case "deviation": return deviationPdf(key);
    case "payroll": {
      const people = key === "empty" ? [] : [{ userId: "u1", name: "Erik Exempel", employeeNumber: key === "other" ? "" : "101", months: [{ month: "2026-10", status: "APPROVED" }], worked: [{ timeType: "Arbete", code: "100", minutes: 9600, workingTime: true }], absence: [{ label: "Sjuk", code: "", days: 2, minutes: 960 }], workedMinutes: 9600, absenceMinutes: 960, otherMinutes: key === "other" ? 120 : 0 }] as never;
      const warnings = key === "empty" ? [] : key === "other" ? ["Eva Exempel: lönekod saknas för Sjuk.", "Erik Exempel: månaden är inte godkänd."] : ["Eva Exempel: lönekod saknas för Sjuk."];
      return createBasisPdf({ identity, fontBytes, from: "2026-10-01", to: "2026-10-31", onlyApproved: key !== "other", createdAt: CREATED, warnings, people });
    }
    case "agent_report": {
      const { createAgentReportPdf } = await import("@/lib/agents/report-pdf");
      const { exampleAgentReport } = await import("@/lib/agents/report-examples");
      return createAgentReportPdf({ identity, fontBytes, missionName: "Exempeluppdrag", report: exampleAgentReport(key), createdAt: CREATED });
    }
    case "common": return key === "order" ? orderPdf("done") : key === "long" ? quotePdf("long") : key === "project" ? projectPdf() : quotePdf("quote");
  }
}

export type PdfExampleRender = { pdf: Uint8Array; targets: PdfTraceTarget[]; pages: { width: number; height: number }[] };

/**
 * The example with the editor's click targets: the same generators draw the same file (tests/pdf-editor.test.ts compares it
 * with an untraced one operator by operator) and every template word reports where it landed.
 */
export async function renderTracedExample(type: PdfDocumentType, variant: string | null, templates: readonly PdfTemplateOverride[] | null, fontBytes: ReportFontBytes): Promise<PdfExampleRender> {
  const trace = new PdfTrace();
  const pdf = await renderPdfExample(type, variant, tracedTemplates(templates, trace), fontBytes);
  const pages = (await PDFDocument.load(pdf)).getPages().map((page) => page.getSize());
  return { pdf, targets: trace.targets, pages };
}

const coverageCache = new Map<string, Promise<Record<string, Record<string, string[]>>>>();
/**
 * Which examples of a document type print which blocks, with the defaults: where the editor's overview goes to show a block.
 * `{ doc: { block: [variant …] } }`. Kept per process: it depends on the code only.
 */
export function pdfExampleCoverage(type: PdfDocumentType, fontBytes: ReportFontBytes) {
  const known = coverageCache.get(type);
  if (known) return known;
  const running = (async () => {
    const result: Record<string, Record<string, string[]>> = {};
    for (const { key } of PDF_EXAMPLE_VARIANTS[type]) {
      const { targets } = await renderTracedExample(type, key, null, fontBytes);
      for (const target of targets) {
        const list = ((result[target.doc] ??= {})[target.id] ??= []);
        if (!list.includes(key)) list.push(key);
      }
      // Between two drawings the server answers what else waits, such as the page the person is looking at.
      await new Promise((resolve) => setImmediate(resolve));
    }
    return result;
  })();
  coverageCache.set(type, running);
  return running;
}

/** A block's document exists: guards the coverage against a removed block. */
export const knownExampleBlock = (doc: string, id: string) => Boolean(pdfDocumentDef(doc)?.blocks.some((block) => block.id === id));
