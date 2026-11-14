import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { drawingText, pdfDrawing } from "./helpers/pdf-drawing";
import { companyProfileSchema, companySenderOf } from "../lib/kfid/company";
import { createReportKit, senderLines } from "../lib/workflow/report-kit";
import { createFormProtocolPdf } from "../lib/workflow/form-report";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, protocolNumberOf, type WorkflowReportTask } from "../lib/workflow/report";
import { evaluateForm, formCompletion, formDocumentSchema, formRowTechnicianJudged, formRowWithCell, formVerdictBasis, formWithoutStaleVerdict, initialFormValues, newFormRow, technicianJudgedText, type FormColumn, type FormTableBlock, type FormValues } from "../lib/workflow/form-document";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { customerReceiptOf, resetWorkflowTaskApproval, stampCustomerAndJudgements, workflowTaskCompletion, workflowTaskDataSchema } from "../lib/workflow/task-model";
import { kfidFormDocument, kfidForm } from "../lib/workflow/builtin-kfid-form";
import { kfidFull } from "./fixtures/kfid-answers";
import { kfidTask, REFERENCE_COMPANY } from "./fixtures/report-references";
import { createQuotePdf, type QuotePdfQuote } from "../lib/quotes/quote-report";
import { lineCatalogueJson, quoteInputSchema, quoteReverseVatOf, quoteTotals, readLineCatalogue, REVERSE_VAT_LABEL } from "../lib/quotes/model";
import { quoteContentFingerprint, publicQuoteView, type QuoteContent } from "../lib/quotes/customer-link";
import { accountingSettingsSchema, quoteVoucher, quotesCsv, QUOTE_CSV_HEADER, QUOTE_CSV_TAX_HEADER, type AccountingQuote } from "../lib/quotes/accounting";
import { fortnoxInvoicePayload } from "../lib/quotes/fortnox";
import { invoiceBasisInputSchema, invoiceBasisLinesOf, invoiceBasisRot, invoiceBasisStored, invoiceBasisTaxOf, invoiceBasisTotals, invoiceReadyProblem, invoiceTaxFromInput, invoiceTaxFromQuote, invoiceTaxProblem, mergeLineSources, NO_INVOICE_TAX, type InvoiceBasisLine, type InvoiceBasisView } from "../lib/invoice-basis/model";
import { createInvoiceBasisPdf, INVOICE_BASIS_NOT_INVOICE } from "../lib/invoice-basis/basis-report";

const fontBytes = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
const textOf = async (bytes: Uint8Array) => drawingText(await pdfDrawing(bytes)).join(" ").replace(/\s+/g, " ");
const sender = { organizationNumber: "556000-0000", vatNumber: "SE556000000001", fSkatt: true, address: "Verkstadsgatan 1, 123 45 Provstad", phone: "010-123 45", email: "info@example.se" };

// ---------- Beslut 5: avsändarrutan ----------

test("the company's profile holds F-skatt, and an old profile reads as not stated", () => {
  assert.equal(companyProfileSchema.parse({}).fSkatt, false);
  assert.equal(companyProfileSchema.parse({ fSkatt: true }).fSkatt, true);
  assert.deepEqual(companySenderOf({ organizationNumber: " 556000-0000 ", vatNumber: "SE1", fSkatt: true, address: "Fakturav. 2", postalCode: "12345", city: "Provstad", phone: "010", email: "a@example.se" }),
    { organizationNumber: "556000-0000", vatNumber: "SE1", fSkatt: true, address: "Fakturav. 2, 12345 Provstad", phone: "010", email: "a@example.se", registeredOffice: "", bankgiro: "", plusgiro: "" });
  // The company's own place wins over the billing address.
  assert.equal(companySenderOf({ address: "Fakturav. 2", place: { address: "Platsv. 1", city: "Provstad" } })?.address, "Platsv. 1, Provstad");
  assert.equal(companySenderOf({ email: "inte en adress" }), null, "a profile that cannot be read gives no box");
});

test("the sender box names everything the company entered, and nothing is printed when it entered nothing", () => {
  assert.deepEqual(senderLines("Elfirma AB", sender), ["Elfirma AB · Org.nr 556000-0000 · Momsreg.nr SE556000000001 · Godkänd för F-skatt", "Verkstadsgatan 1, 123 45 Provstad · Tel 010-123 45 · info@example.se"]);
  assert.deepEqual(senderLines("Elfirma AB", { fSkatt: false, phone: " " }), []);
  assert.deepEqual(senderLines("Elfirma AB", null), []);
});

const quote: QuotePdfQuote = {
  label: "O-0001", title: "Laddbox", description: "", status: "DRAFT", storedStatus: "DRAFT", validUntil: "2026-12-01", terms: "", customerType: "COMPANY", rotPercent: null, changeOfVersion: null, change: null,
  customer: { id: "c", name: "Bygg AB" }, facility: null, project: null, sentAt: null,
  lines: [{ id: "l1", kind: "LABOUR", name: "Arbete", quantity: "2", unit: "h", unitPrice: "500", markupPercent: "" }],
  totals: quoteTotals([{ kind: "LABOUR", quantity: "2", unitPrice: "500" }]),
};

test("a quote prints the sender box under its heading, only with details", async () => {
  const withBox = await textOf(await createQuotePdf({ identity: { company: "Elfirma AB", sender }, fontBytes, quote, createdAt: new Date("2026-11-01T10:00:00Z") }));
  assert.match(withBox, /Org\.nr 556000-0000/);
  assert.match(withBox, /Godkänd för F-skatt/);
  assert.match(withBox, /Org\.nr 556000-0000/);
  const without = await textOf(await createQuotePdf({ identity: { company: "Elfirma AB" }, fontBytes, quote, createdAt: new Date("2026-11-01T10:00:00Z") }));
  assert.doesNotMatch(without, /Org\.nr 556000-0000/);
});

// Företagsuppgifter (2026-11-04): bankgiro and plusgiro in the payment box, säte in the footer; empty prints nothing.
test("bankgiro and plusgiro print in the quote's payment box and säte in the footer, and with none filled in the PDF is as before", async () => {
  const at = new Date("2026-11-04T10:00:00Z");
  const filled = { ...sender, registeredOffice: "Provstad", bankgiro: "123-4567", plusgiro: "12 34 56-7" };
  const withGiro = await textOf(await createQuotePdf({ identity: { company: "Elfirma AB", sender: filled }, fontBytes, quote, createdAt: at }));
  assert.match(withGiro, /Bankgiro.*123-4567/);
  assert.match(withGiro, /Plusgiro.*12 34 56-7/);
  assert.match(withGiro, /Säte Provstad/);
  const same = async (identity: Parameters<typeof createQuotePdf>[0]["identity"]) => textOf(await createQuotePdf({ identity, fontBytes, quote, createdAt: at }));
  const plain = await same({ company: "Elfirma AB", sender });
  assert.doesNotMatch(plain, /Bankgiro|Plusgiro|Säte/);
  assert.equal(await same({ company: "Elfirma AB", sender: { ...sender, registeredOffice: " ", bankgiro: "", plusgiro: "  " } }), plain, "blank values change nothing");
  assert.match(await same({ company: "Elfirma AB", sender: { ...sender, plusgiro: "5 55 55-5" } }), /Plusgiro.*5 55 55-5/);
  assert.doesNotMatch(await same({ company: "Elfirma AB", sender: { ...sender, plusgiro: "5 55 55-5" } }), /Bankgiro/, "only what is filled in");
});

// PDF-granskningen 2026-11-03: an ÄTA was called "Offert" in the PDF's title, on the continuation page and in the footer.
test("an ÄTA is called ÄTA in the title, on the continuation page and in the footer; a quote stays Offert", async () => {
  const added = (index: number) => ({ kind: "MATERIAL" as const, name: `Tillägg ${index + 1}`, unit: "st", change: "added" as const, before: null, after: { quantity: 1, amount: 100 }, amountDelta: 100 });
  const change = { lines: Array.from({ length: 50 }, (_, index) => added(index)), netBefore: 1000, netAfter: 6000, netDelta: 5000 };
  const ata = { ...quote, label: "O-0001 v2", changeOfVersion: 1, change, terms: "Betalning 30 dagar netto." };
  const bytes = await createQuotePdf({ identity: { company: "Elfirma AB" }, fontBytes, quote: ata, createdAt: new Date("2026-11-03T10:00:00Z") });
  assert.equal((await PDFDocument.load(bytes, { updateMetadata: false })).getTitle(), "ÄTA O-0001 v2 – Laddbox");
  const pages = drawingText(await pdfDrawing(bytes));
  assert.ok(pages.length >= 2, "fifty changes run on to a second page");
  assert.match(pages[0], /Ekonomi · tillägg till offert/);
  for (const page of pages.slice(1)) assert.match(page, /ÄTA O-0001 v2 · fortsättning/);
  assert.doesNotMatch(pages.join("\n"), /Offert O-0001 v2 · fortsättning/);
  for (const page of pages) assert.match(page, /Skapad i Workflow \d{4}-\d{2}-\d{2}\nSida \d+ av \d+$/, "the footer");
  assert.match(pages.join("\n"), /Förändring av summan exkl\. moms[\s\S]*\+5\s000,00[\s\S]*Villkor/);
  const plain = await createQuotePdf({ identity: { company: "Elfirma AB" }, fontBytes, quote, createdAt: new Date("2026-11-03T10:00:00Z") });
  assert.equal((await PDFDocument.load(plain, { updateMetadata: false })).getTitle(), "Offert O-0001 – Laddbox");
  assert.match(drawingText(await pdfDrawing(plain))[0], /Skapad i Workflow \d{4}-\d{2}-\d{2}\nSida 1 av 1$/);
});

// ---------- Beslut 6: protokollmallen ----------

const protocol = (patch: Partial<WorkflowReportTask> = {}): WorkflowReportTask => ({ ...kfidTask(kfidFull), protocolNumber: protocolNumberOf("cmabc123def456ghi789"), customerName: "Brf Solgläntan", projectName: "Stambyte", facilityName: "Hus A", workOrderTitle: "AO elcentral", completedAt: "2026-10-01T08:00:00.000Z", ...patch });

test("a protocol number is fixed and comes from the protocol's own id", () => {
  assert.equal(protocolNumberOf("cmabc123def456ghi789"), "P-56GHI789");
  assert.equal(protocolNumberOf("kfid-1"), "P-KFID1");
});

test("the protocol template: number and template version in the heading, the box, verdict and signature block, also on the original", async () => {
  const text = await textOf(await createFormProtocolPdf({ identity: { company: REFERENCE_COMPANY, sender }, fontBytes, task: protocol(), options: defaultWorkflowReportOptions, createdAt: new Date("2026-10-01T12:00:00Z") }));
  assert.match(text, /P-56GHI789/);
  assert.match(text, /Mallversion/);
  for (const part of ["Org.nr 556000-0000", "Brf Solgläntan", "Stambyte", "Hus A", "AO elcentral", "Arbetsorder", "Slutomdöme", "Inte angivet", "Signering", "Kundens kvittens", "Ingen kvittens", "Färdigställt"]) assert.ok(text.includes(part), part);
  // The save counter is never the protocol's version.
  const counted = await textOf(await createFormProtocolPdf({ identity: { company: REFERENCE_COMPANY }, fontBytes, task: protocol({ version: 18 }), options: defaultWorkflowReportOptions }));
  assert.doesNotMatch(counted, /Version 18/);
});

test("the verdict is the technician's word and the receipt is name and time", async () => {
  const task = protocol({ customerReceipt: { name: "Kim Kund", at: "2026-10-01T09:00:00.000Z" } });
  if (task.data.kind === "FORM") task.data.details.values.finalVerdict = { choice: "REMARK", by: "Elon", at: "2026-10-01T08:30:00.000Z" };
  const text = await textOf(await createFormProtocolPdf({ identity: { company: REFERENCE_COMPANY }, fontBytes, task, options: defaultWorkflowReportOptions }));
  assert.match(text, /Godkänt med anmärkning/);
  assert.match(text, /Kim Kund/);
  assert.doesNotMatch(text, /Ingen kvittens/);
});

test("a blank form has no template: it stays the form to fill in by hand", async () => {
  const text = await textOf(await createFormProtocolPdf({ identity: { company: REFERENCE_COMPANY, sender }, fontBytes, task: protocol(), options: defaultWorkflowReportOptions, blank: true }));
  for (const part of ["Slutomdöme", "Mallversion", "Kundens kvittens"]) assert.ok(!text.includes(part), part);
  assert.ok(text.includes("Org.nr 556000-0000"), "the footer keeps the company's legal line");
});

test("a work order's report prints the customer's receipt under Signering", async () => {
  const data = workflowTaskDataSchema.parse({ kind: "WORK_ORDER", details: { executionNotes: "Utfört.", deviations: "", materials: [], signature: { name: "Åsa", confirmed: true, signedAt: "2026-10-01T08:00:00.000Z" }, closeNotes: "", customerReceipt: { name: "Kim Kund", at: "2026-10-01T09:00:00.000Z" } } });
  const task = { id: "w", kind: "WORK_ORDER", title: "AO", description: "", status: "COMPLETED", progress: 100, assignedToName: "Åsa", dueDate: "", totalDurationSec: 0, data, attachments: [] } as unknown as WorkflowReportTask;
  const text = await textOf(await createWorkflowPdfReport({ company: "Elfirma AB", sender, tasks: [task], options: defaultWorkflowReportOptions, fontBytes }));
  assert.match(text, /Kundens kvittens/);
  assert.match(text, /Kim Kund/);
  assert.match(text, /Org\.nr 556000-0000/);
});

test("the receipt's and the judgement's name and time are set where the task is saved, never by the client", () => {
  const order = (name: string, at: string | null) => workflowTaskDataSchema.parse({ kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "", customerReceipt: { name, at } } });
  const now = "2026-11-01T10:00:00.000Z";
  // A time sent by the client does not count: the first save sets it.
  assert.equal(customerReceiptOf(stampCustomerAndJudgements(order("Kim", "2020-01-01T00:00:00.000Z"), null, "Åsa", now))?.at, now);
  // Saved again unchanged, it keeps its time; a new name is a new receipt.
  const stored = stampCustomerAndJudgements(order("Kim", null), null, "Åsa", "2026-10-01T10:00:00.000Z");
  assert.equal(customerReceiptOf(stampCustomerAndJudgements(order("Kim", null), stored, "Åsa", now))?.at, "2026-10-01T10:00:00.000Z");
  assert.equal(customerReceiptOf(stampCustomerAndJudgements(order("Lo", null), stored, "Åsa", now))?.at, now);
  assert.equal(customerReceiptOf(stampCustomerAndJudgements(order("  ", null), stored, "Åsa", now)), null, "an empty name is no receipt");
});

// ---------- Beslut 7: rader utan gräns ----------

const iso = kfidFormDocument.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block): block is FormTableBlock => block.type === "table" && block.key === "iso")!;
const rcd = kfidFormDocument.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block): block is FormTableBlock => block.type === "table" && block.key === "rcd")!;
function withoutLimit(judged?: { approved: boolean; by: string; at: string | null }): FormValues {
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-iso"] = true;
  const row = newFormRow(iso, "r1");
  values.tables.iso = [{ ...row, cells: { ...row.cells, objekt: "Grupp 1", mohm: "0,4", ok: true, limit: "" }, ...(judged ? { judged } : {}) }] as FormValues["tables"][string];
  return values;
}
const limitIssues = (values: FormValues) => formCompletion(kfidFormDocument, values).issues.filter((item) => /Isolation/.test(item.message) && /gräns/.test(item.message)).map((item) => item.message);

test("a row without its limit stops completion, and the message says the two ways on", () => {
  const issues = limitIssues(withoutLimit());
  assert.equal(issues.length, 1, issues.join(" | "));
  assert.match(issues[0], /fyll i gräns.* eller bedöm raden själv/);
});

test("the technician's judgement lets the row through: it reads as judged, and not approved is a deviation", () => {
  const passed = withoutLimit({ approved: true, by: "Åsa", at: null });
  assert.deepEqual(limitIssues(passed), []);
  assert.equal(evaluateForm(kfidFormDocument, passed).cells.iso.r1.ok, true);
  assert.equal(formCompletion(kfidFormDocument, passed).pending.length, 0);
  const failed = withoutLimit({ approved: false, by: "Åsa", at: null });
  const evaluated = evaluateForm(kfidFormDocument, failed);
  assert.equal(evaluated.cells.iso.r1.ok, false);
  assert.ok(evaluated.deviations.some((item) => item.rowId === "r1"), "a deviation, which needs its comment");
  assert.ok(formCompletion(kfidFormDocument, failed).issues.some((item) => item.blockId === "deviations"));
});

test("a limit given later decides by itself, whatever the technician said", () => {
  const values = withoutLimit({ approved: true, by: "Åsa", at: null });
  values.tables.iso[0].cells.limit = 1;
  assert.equal(evaluateForm(kfidFormDocument, values).cells.iso.r1.ok, false, "0,4 is below the given limit of 1");
});

test("a row waiting for the company's value also stops completion, without inventing a limit, until it is judged", () => {
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-rcd"] = true;
  const row = newFormRow(rcd, "p1");
  values.tables.rcd = [{ ...row, cells: { ...row.cells, place: "JFB 1", std: "IEC 60364-4-41 TT", t1p: 240, t1n: 190, t5p: 30, t5n: 30, ntrip05: true, btnok: true } }];
  const waiting = formCompletion(kfidFormDocument, values);
  assert.ok(waiting.issues.some((item) => /JFB 1: ange gränsen eller bedöm raden själv/.test(item.message)), waiting.issues.map((item) => item.message).join(" | "));
  values.tables.rcd[0] = { ...values.tables.rcd[0], judged: { approved: true, by: "Åsa", at: null } };
  const judged = formCompletion(kfidFormDocument, values);
  assert.ok(!judged.issues.some((item) => /JFB 1: ange gränsen/.test(item.message)));
  assert.equal(judged.evaluation.cells.rcd.p1.ok, true);
});

test("the server's completion rule refuses it too: workflowTaskCompletion is what the API runs", () => {
  const task = (values: FormValues) => ({ title: "Protokoll", status: "IN_PROGRESS" as const, data: { kind: "FORM" as const, details: { document: kfidFormDocument, values } } });
  assert.ok(workflowTaskCompletion(task(withoutLimit())).issues.some((item) => /eller bedöm raden själv/.test(item.message)));
  assert.ok(!workflowTaskCompletion(task(withoutLimit({ approved: true, by: "", at: null }))).issues.some((item) => /eller bedöm raden själv/.test(item.message)));
});

test("the PDF says who judged the row, and never makes it a measured limit", async () => {
  const data = withoutLimit({ approved: true, by: "Åsa Ek", at: "2026-10-01T08:00:00.000Z" });
  const task = { ...kfidTask(kfidFull), data: { kind: "FORM" as const, details: { templateName: kfidForm.meta.name, templateVersion: 1, document: kfidFormDocument, values: data } } } as WorkflowReportTask;
  const text = await textOf(await createFormProtocolPdf({ identity: { company: REFERENCE_COMPANY }, fontBytes, task, options: defaultWorkflowReportOptions }));
  assert.ok(text.includes(technicianJudgedText(true)) || text.includes("Bedömd av"), "the row's word");
  assert.match(text, /gräns saknas/);
  assert.match(text, /Åsa Ek/);
});

const formData = (values: FormValues) => workflowTaskDataSchema.parse({ kind: "FORM", details: { templateId: "t", templateVersion: 1, templateName: "K", document: kfidFormDocument, values } });
const formValuesOf = (value: ReturnType<typeof formData>) => { if (value.kind !== "FORM") throw new Error("kind"); return value.details.values; };

test("a judged row's name and time come from the server; an unchanged judgement keeps its own", () => {
  const now = "2026-11-01T10:00:00.000Z";
  const data = formData;
  const first = stampCustomerAndJudgements(data(withoutLimit({ approved: true, by: "", at: null })), null, "Åsa", now);
  const judged = (value: typeof first) => value.kind === "FORM" ? value.details.values.tables.iso[0].judged : undefined;
  assert.deepEqual(judged(first), { approved: true, by: "Åsa", at: now });
  assert.equal(judged(stampCustomerAndJudgements(data(withoutLimit({ approved: true, by: "Någon annan", at: "2020-01-01T00:00:00.000Z" })), null, "Åsa", now)), undefined, "a name and time sent by a client are no judgement");
  const again = stampCustomerAndJudgements(data(withoutLimit({ approved: true, by: "", at: null })), first, "Bo", "2026-11-02T10:00:00.000Z");
  assert.deepEqual(judged(again), { approved: true, by: "Åsa", at: now });
  const changed = stampCustomerAndJudgements(data(withoutLimit({ approved: false, by: "", at: null })), first, "Bo", "2026-11-02T10:00:00.000Z");
  assert.deepEqual(judged(changed), { approved: false, by: "Bo", at: "2026-11-02T10:00:00.000Z" });
});

test("a judgement goes when its row's values change, and only a new word brings it back", () => {
  const data = formData;
  const anna = "2026-11-01T10:00:00.000Z", later = "2026-11-02T10:00:00.000Z";
  const stored = stampCustomerAndJudgements(data(withoutLimit({ approved: true, by: "", at: null })), null, "Anna", anna);
  const carried = formValuesOf(stored).tables.iso[0].judged!;
  const changedRow = (judged?: { approved: boolean; by: string; at: string | null }) => { const values = withoutLimit(judged); values.tables.iso[0].cells.mohm = "0,1"; return data(values); };
  // A client that still sends the old word with the new value: the word is gone, and completion asks for the row again.
  const stale = stampCustomerAndJudgements(changedRow(carried), stored, "Bengt", later);
  assert.equal(formValuesOf(stale).tables.iso[0].judged, undefined);
  assert.equal(limitIssues(formValuesOf(stale)).length, 1, "the protocol cannot be completed on the old word");
  // The technician looks again: the new word is that person's, even when it is the same word.
  assert.deepEqual(formValuesOf(stampCustomerAndJudgements(changedRow({ approved: true, by: "", at: null }), stored, "Bengt", later)).tables.iso[0].judged, { approved: true, by: "Bengt", at: later });
  // Nothing changed on the row: the word stays with its own name and time, also after a reopen.
  const reopened = resetWorkflowTaskApproval(stored);
  assert.deepEqual(formValuesOf(stampCustomerAndJudgements(data(withoutLimit(carried)), reopened, "Bengt", later)).tables.iso[0].judged, { approved: true, by: "Anna", at: anna });
});

test("on screen a changed value takes the judgement away; a picture does not", () => {
  const row = { id: "r", label: "", cells: { mohm: "5", bild: ["a"] as string[] }, judged: { approved: true, by: "Anna", at: "2026-11-01T10:00:00.000Z" } };
  assert.equal(formRowWithCell(row, "mohm", "0,1").judged, undefined);
  assert.equal(formRowWithCell(row, "mohm", "0,1").cells.mohm, "0,1");
  assert.deepEqual(formRowWithCell(row, "mohm", "5").judged, row.judged, "the same value is no change");
  assert.deepEqual(formRowWithCell(row, "bild", ["a", "b"]).judged, row.judged);
});

test("a final verdict is given on what the protocol says: a changed value or a reopen takes it away", () => {
  const data = formData;
  const anna = "2026-11-01T10:00:00.000Z", later = "2026-11-02T10:00:00.000Z";
  const fresh = { choice: "APPROVED" as const, by: "", at: null };
  const base = stampCustomerAndJudgements(data(withoutLimit({ approved: true, by: "", at: null })), null, "Anna", anna);
  const saved = stampCustomerAndJudgements(data({ ...formValuesOf(base), finalVerdict: fresh }), base, "Anna", anna);
  const carried = formValuesOf(saved).finalVerdict!;
  assert.deepEqual(carried, { choice: "APPROVED", by: "Anna", at: anna });
  const again = (values: FormValues) => formValuesOf(stampCustomerAndJudgements(data(values), saved, "Bengt", later)).finalVerdict;
  // Saved again unchanged, or only signed: the word and its name and time stay.
  assert.deepEqual(again(formValuesOf(saved)), carried);
  assert.deepEqual(again({ ...formValuesOf(saved), signatures: { kontrollant: { name: "Anna", confirmed: true, signedAt: null } } }), carried);
  // A changed answer with the old verdict: gone. A new word on it: that person's.
  const changed = (verdict: FormValues["finalVerdict"]): FormValues => ({ ...formValuesOf(saved), deviationComment: "Ny text", finalVerdict: verdict });
  assert.equal(again(changed(carried)), undefined);
  assert.deepEqual(again(changed(fresh)), { choice: "APPROVED", by: "Bengt", at: later });
  // A reopen takes it back, also from a client that still holds it.
  const reopened = resetWorkflowTaskApproval(saved);
  assert.equal(formValuesOf(reopened).finalVerdict, undefined);
  assert.equal(formValuesOf(stampCustomerAndJudgements(data(formValuesOf(saved)), reopened, "Bengt", later)).finalVerdict, undefined);
  // On screen the same rule.
  const before = formValuesOf(saved);
  assert.equal(formWithoutStaleVerdict(before, { ...before, deviationComment: "Ny text" }).finalVerdict, undefined);
  assert.deepEqual(formWithoutStaleVerdict(before, { ...before, signatures: { a: { name: "A", confirmed: true, signedAt: null } } }).finalVerdict, carried);
  const withPicture: FormValues = { ...before, images: { a: ["x"] } };
  assert.equal(formVerdictBasis(before), formVerdictBasis(withPicture), "a picture is no part of it");
});

test("a word that no longer holds is taken away before the completion check, on every way a task is saved", () => {
  for (const [file, check] of [["app/api/workflow-tasks/route.ts", "workflowTaskCompletion(task)"], ["features/kfid/local-workspace-store.ts", "workflowTaskCompletion(parsed)"], ["features/demo/demo-backend.ts", "workflowTaskCompletion(data)"]] as const) {
    const source = readFileSync(file, "utf8");
    const stamp = source.indexOf("= stampCustomerAndJudgements(");
    assert.ok(stamp > 0 && stamp < source.indexOf(check), file);
  }
});

// ---------- Beslut 7: gränsen i ett formulärfält ----------

const earthing = BUILTIN_FORMS.find((item) => item.id === "hintek-foljelinematning-ebr")!.document;
const stretches = earthing.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block): block is FormTableBlock => block.type === "table" && block.key === "matpunkter")!;
const columnOf = (key: string) => stretches.columns.find((column) => column.key === key) as FormColumn;
function earthingValues(judged?: { approved: boolean; by: string; at: string | null }): FormValues {
  const values = initialFormValues(earthing);
  Object.assign(values.fields, { matdatum: "2026-11-01", instrument: "IT-200" });
  values.tables.matpunkter = [{ ...newFormRow(stretches, "a"), cells: { fran: "Station 1", till: "Station 2", imat: 20, iy: 19 }, ...(judged ? { judged } : {}) }];
  values.signatures.matare = { name: "Elon", confirmed: true, signedAt: null };
  return values;
}
const earthingLimitIssues = (values: FormValues) => formCompletion(earthing, values).issues.filter((item) => /ange gränsen/.test(item.message));

test("a limit kept in a form field stops completion like a limit column, until it is given or the row is judged", () => {
  const empty = earthingValues();
  assert.equal(earthingLimitIssues(empty).length, 1, "both limit fields empty: the stretch stops the protocol");
  assert.equal(formCompletion(earthing, empty).ready, false);
  assert.equal(formCompletion(earthing, empty).pending.length, 1);
  assert.equal(formCompletion(earthing, empty).evaluation.deviations.length, 0, "not judged, never a deviation");
  const given = earthingValues();
  Object.assign(given.fields, { grans_skarm: 0.9, grans_jord: 0.3 });
  assert.deepEqual(earthingLimitIssues(given), []);
  assert.equal(formCompletion(earthing, given).pending.length, 0);
});

test("one limit given: the other column waits, and the judgement counts only there", () => {
  const values = earthingValues({ approved: true, by: "Elon", at: null });
  values.fields.grans_jord = 0.3;
  const evaluation = evaluateForm(earthing, values);
  const row = values.tables.matpunkter[0];
  assert.equal(evaluation.cells.matpunkter.a.jord_ok, true, "0,95 meets the given limit");
  assert.equal(evaluation.cells.matpunkter.a.skarm_ok, true, "the technician's word");
  assert.equal(formRowTechnicianJudged(stretches, columnOf("skarm_ok"), row, evaluation), true);
  assert.equal(formRowTechnicianJudged(stretches, columnOf("jord_ok"), row, evaluation), false, "the limit decided this one");
});

test("the judged row counts in the form's own sums, and not approved is a deviation", () => {
  const failed = earthingValues({ approved: false, by: "Elon", at: null });
  const evaluation = evaluateForm(earthing, failed);
  assert.deepEqual([evaluation.computed.besiktiga_skarm, evaluation.computed.besiktiga_jord], [1, 1], "what is to be inspected follows the word");
  assert.ok(evaluation.deviations.some((item) => item.rowId === "a"));
  assert.deepEqual(earthingLimitIssues(failed), []);
  assert.ok(formCompletion(earthing, failed).issues.some((item) => item.blockId === "deviations"), "the deviation needs its comment");
  const passed = earthingValues({ approved: true, by: "Elon", at: null });
  assert.deepEqual(earthingLimitIssues(passed), []);
  assert.equal(formCompletion(earthing, passed).ready, true, JSON.stringify(formCompletion(earthing, passed).issues));
});

test("a customer's own form: a field named as a limit waits too, and a field that is not a limit does not", () => {
  const custom = (label: string) => formDocumentSchema.parse({ schema: 2, blocks: [
    { id: "g", type: "field", key: "tal", label, input: "number" },
    { id: "t", type: "table", key: "rader", label: "Rader", columns: [
      { id: "c1", key: "matt", label: "Mätt", input: "number" },
      { id: "c2", key: "ok", label: "Godkänd", input: "formula", formula: "[matt] <= tal", passCondition: true },
    ] },
  ] });
  const fill = (document: ReturnType<typeof custom>) => { const values = initialFormValues(document); values.tables.rader = [{ id: "r", label: "", cells: { matt: 5 } }]; return values; };
  const named = custom("Gräns");
  assert.equal(formCompletion(named, fill(named)).ready, false);
  const other = custom("Temperatur");
  assert.equal(formCompletion(other, fill(other)).ready, true, "no limit is claimed where the form names none");
});

// ---------- Omvänd byggmoms ----------

test("reverse VAT is chosen for a company only, and follows the line's JSON through a version", () => {
  const input = { title: "Bygg", customerType: "COMPANY", reverseVat: true, buyerVatNumber: "SE5560000000", vatPercent: "0", lines: [{ kind: "LABOUR", name: "Arbete", quantity: "1", unit: "h", unitPrice: "500" }] };
  assert.equal(quoteInputSchema.safeParse(input).success, true);
  assert.equal(quoteInputSchema.safeParse({ ...input, customerType: "PRIVATE" }).success, false);
  // The choice lives on the lines: without one it could not be kept, so it is refused rather than lost.
  const noLines = quoteInputSchema.safeParse({ ...input, lines: [] });
  assert.equal(noLines.success, false);
  assert.match(noLines.error?.issues[0].message ?? "", /minst en rad/);
  assert.equal(quoteInputSchema.safeParse({ title: "Bygg", lines: [] }).success, true, "a draft without lines is still fine");
  const stored = lineCatalogueJson({ reverseVat: { buyerVatNumber: "SE5560000000" } });
  assert.deepEqual(quoteReverseVatOf([readLineCatalogue(stored)]), { buyerVatNumber: "SE5560000000" });
  assert.equal(lineCatalogueJson({}), null, "a line without it stores nothing, as before");
  assert.equal(quoteReverseVatOf([readLineCatalogue(null)]), null);
});

test("an earlier quote's fingerprint is unchanged; reverse VAT is part of what the customer sees", () => {
  const content: QuoteContent = { number: 1, version: 1, title: "T", description: "", validUntil: "2026-12-01", terms: "", vatPercent: 0, customerType: "COMPANY", rotEnabled: false, rotPercent: null, rotCap: null, changeOfVersion: null, lines: [] };
  assert.equal(JSON.parse(quoteContentFingerprint(content)).length, 14);
  assert.notEqual(quoteContentFingerprint(content), quoteContentFingerprint({ ...content, reverseVat: true, buyerVatNumber: "SE1" }));
  const view = publicQuoteView({ quote: { ...content, reverseVat: true, buyerVatNumber: "SE1", sentAt: null }, customerName: "", placeName: "", company: { name: "", email: "" }, senderName: "" });
  assert.equal(view.reverseVat, true);
  assert.equal(view.buyerVatNumber, "SE1");
});

test("a reverse-VAT quote whose customer is a private person gives a basis with VAT, never 0 % without a reason", () => {
  const quoteTax = { vatPercent: 0, reverse: { buyerVatNumber: "SE1" }, rotEnabled: false, rotPercent: null, rotCap: null };
  assert.deepEqual(invoiceTaxFromQuote(quoteTax, "COMPANY"), { tax: { ...NO_INVOICE_TAX, reverseVat: true, buyerVatNumber: "SE1" }, vatPercent: 0 });
  assert.deepEqual(invoiceTaxFromQuote(quoteTax, "PRIVATE"), { tax: NO_INVOICE_TAX, vatPercent: null }, "the server takes the product's own rate");
  // A ROT choice that does not fit goes alone: the quote's rate stays.
  assert.deepEqual(invoiceTaxFromQuote({ vatPercent: 12, reverse: null, rotEnabled: true, rotPercent: 30, rotCap: 50000 }, "COMPANY"), { tax: NO_INVOICE_TAX, vatPercent: 12 });
});

test("a quote with reverse VAT states it, with no VAT in its sums", async () => {
  const totals = quoteTotals(quote.lines, 0);
  assert.equal(totals.vat, 0);
  assert.equal(totals.gross, totals.net);
  const text = await textOf(await createQuotePdf({ identity: { company: "Elfirma AB" }, fontBytes, quote: { ...quote, totals, reverseVat: true, buyerVatNumber: "SE5560000000" } }));
  assert.ok(text.includes(REVERSE_VAT_LABEL));
  assert.match(text, /Köparen redovisar momsen/);
  assert.match(text, /SE5560000000/);
});

const settings = { ...accountingSettingsSchema.parse({}), materialAccount: "3010", labourAccount: "3020", otherAccount: "3030", vatAccount: "2611", receivableAccount: "1510", rotReceivableAccount: "1513", reverseVatAccount: "3231", series: "A" };
const document_: AccountingQuote = { document: "invoice_basis", id: "b", label: "F-0001", title: "T", status: "INVOICED", date: "2026-11-01", customerName: "K", projectName: "", vatPercent: 25, lines: [{ kind: "LABOUR", name: "Arbete", quantity: "2", unit: "h", unitPrice: "500", markupPercent: "", rotLabour: true }] };

test("the verification of a reverse-VAT document has no VAT row, books the sale on the company's own account and balances", () => {
  const voucher = quoteVoucher({ ...document_, vatPercent: 0, reverseVat: true, buyerVatNumber: "SE1" }, settings);
  assert.deepEqual(voucher.issues, []);
  assert.deepEqual(voucher.rows, [{ account: "1510", ore: 100000 }, { account: "3231", ore: -100000 }]);
  assert.match(quoteVoucher({ ...document_, vatPercent: 0, reverseVat: true }, { ...settings, reverseVatAccount: "" }).issues.join(" "), /försäljning omvänd moms/);
});

test("the CSV gets the tax columns only in a file that has them", () => {
  const plain = quotesCsv([document_]);
  assert.ok(!plain.includes("Omvänd moms"));
  const header = plain.split("\r\n")[0].replace("﻿", "");
  assert.equal(header.split(";").length, QUOTE_CSV_HEADER.length);
  const taxed = quotesCsv([{ ...document_, vatPercent: 0, reverseVat: true, buyerVatNumber: "SE1" }]);
  const [head, row] = taxed.split("\r\n");
  assert.equal(head.split(";").length, QUOTE_CSV_HEADER.length + QUOTE_CSV_TAX_HEADER.length);
  assert.match(row, /"Ja";"SE1";"Nej";""$/);
});

test("Fortnox refuses a reverse-VAT document rather than sending it as plain 0 % VAT", () => {
  const built = fortnoxInvoicePayload({ ...document_, vatPercent: 0, reverseVat: true }, settings, "12");
  assert.equal(built.payload, null);
  assert.match(built.issues.join(" "), /Omvänd moms/);
});

// ---------- ROT och moms på fakturaunderlaget ----------

const line = (patch: Partial<InvoiceBasisLine> = {}): InvoiceBasisLine => ({ id: "l1", kind: "LABOUR", name: "Arbete", quantity: "10", unit: "h", unitPrice: "500", markupPercent: "", sources: ["time:1"], ...patch });
const rotTax = { reverseVat: false, buyerVatNumber: "", rotEnabled: true, rotPercent: 30, rotCap: 50000 };

test("the tax choice is kept beside the lines and is no line; a basis without it stores what it always did", () => {
  const stored = invoiceBasisStored([line()], rotTax);
  assert.equal(stored.length, 2);
  assert.equal(invoiceBasisLinesOf(stored).length, 1, "every reader of the lines leaves it out");
  assert.deepEqual(invoiceBasisTaxOf(stored), rotTax);
  assert.deepEqual(invoiceBasisStored([line()], NO_INVOICE_TAX), [line()]);
  assert.deepEqual(invoiceBasisTaxOf([line()]), NO_INVOICE_TAX);
  assert.deepEqual(invoiceBasisTaxOf(null), NO_INVOICE_TAX);
});

test("ROT on a basis counts by the quote's rule, only for a private person", () => {
  const rot = invoiceBasisRot(rotTax, "PRIVATE");
  assert.deepEqual(rot, { percent: 30, cap: 50000 });
  assert.equal(invoiceBasisRot(rotTax, "COMPANY"), null);
  const totals = invoiceBasisTotals([line({ rotLabour: true })], 25, rot);
  assert.equal(totals.gross, 6250);
  assert.equal(totals.rotBaseInclVat, 6250);
  assert.equal(totals.rot, 1875);
  assert.equal(totals.toPay, 4375);
  assert.deepEqual(totals, quoteTotals([{ kind: "LABOUR", quantity: "10", unitPrice: "500", markupPercent: "", rotLabour: true }], 25, rot));
  // The whole sum still reaches the verification: the customer's share and the claim on the company's ROT account.
  const voucher = quoteVoucher({ ...document_, vatPercent: 25, rot, lines: [{ kind: "LABOUR", name: "Arbete", quantity: "10", unit: "h", unitPrice: "500", markupPercent: "", rotLabour: true }] }, settings);
  assert.deepEqual(voucher.rows, [{ account: "1510", ore: 437500 }, { account: "1513", ore: 187500 }, { account: "3020", ore: -500000 }, { account: "2611", ore: -125000 }]);
});

test("the choice must fit the customer, and an invoiced basis must say what it should", () => {
  assert.match(invoiceTaxProblem(rotTax, "COMPANY"), /privatpersoner/);
  assert.equal(invoiceTaxProblem(rotTax, "PRIVATE"), "");
  assert.match(invoiceTaxProblem({ reverseVat: true, rotEnabled: false }, "PRIVATE"), /företag/);
  assert.match(invoiceReadyProblem([line()], { reverseVat: true, buyerVatNumber: " ", rotEnabled: false }), /momsregistreringsnummer/);
  assert.equal(invoiceReadyProblem([line()], { reverseVat: true, buyerVatNumber: "SE1", rotEnabled: false }), "");
  assert.match(invoiceReadyProblem([line()], { reverseVat: false, buyerVatNumber: "", rotEnabled: true }), /arbete för ROT/);
  assert.equal(invoiceReadyProblem([line({ rotLabour: true })], rotTax), "");
  assert.match(invoiceReadyProblem([line({ unitPrice: "" })], rotTax), /saknar pris/);
});

test("what the page sends: the mark and the choice, and a sender that does not know them changes nothing", () => {
  const base = { title: "T", vatPercent: "25", lines: [{ id: "l1", kind: "LABOUR", name: "Arbete", quantity: "10", unit: "h", unitPrice: "500" }] };
  const unknowing = invoiceBasisInputSchema.parse(base);
  assert.equal(unknowing.tax, undefined);
  assert.equal(mergeLineSources([line({ rotLabour: true })], unknowing.lines)[0].rotLabour, true, "absent keeps the stored mark");
  const off = invoiceBasisInputSchema.parse({ ...base, lines: [{ ...base.lines[0], rotLabour: false }] });
  assert.equal(mergeLineSources([line({ rotLabour: true })], off.lines)[0].rotLabour, undefined, "false clears it");
  assert.equal(invoiceBasisInputSchema.safeParse({ ...base, tax: { rotEnabled: true, rotPercent: "x", rotCap: "1" } }).success, false);
  assert.equal(invoiceBasisInputSchema.safeParse({ ...base, tax: { rotEnabled: true, reverseVat: true, rotPercent: "30", rotCap: "1" } }).success, false);
  assert.deepEqual(invoiceTaxFromInput({ reverseVat: false, buyerVatNumber: "kvar", rotEnabled: true, rotPercent: "30", rotCap: "50000" }), rotTax);
});

const basisView = (patch: Partial<InvoiceBasisView> = {}): InvoiceBasisView => ({
  id: "b", number: 1, label: "F-0001", revision: 1, title: "Stambyte", status: "DRAFT", vatPercent: 25, note: "HEMLIG ANTECKNING", lines: [line({ markupPercent: "10", rotLabour: true })], totals: invoiceBasisTotals([line({ markupPercent: "10", rotLabour: true })], 25),
  invoicedAt: null, invoicedByName: "", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", task: null, project: null, customer: { id: "c", name: "Kim Kund" }, canEdit: true, quoteNote: "", priceDefaults: { hourlyRate: "", markupPercent: "" }, ...patch,
});

test("the basis as a PDF: says it is no invoice, has the sender box and never the note or the markup", async () => {
  const text = await textOf(await createInvoiceBasisPdf({ identity: { company: "Elfirma AB", sender }, fontBytes, basis: basisView() }));
  assert.ok(text.includes(INVOICE_BASIS_NOT_INVOICE));
  assert.match(text, /Org\.nr 556000-0000/);
  assert.match(text, /UTKAST/);
  assert.ok(!text.includes("HEMLIG"));
  assert.ok(!/Påslag/.test(text));
});

test("the basis's PDF states ROT and reverse VAT with their sums", async () => {
  const rot = invoiceBasisRot(rotTax, "PRIVATE");
  const withRot = await textOf(await createInvoiceBasisPdf({ identity: { company: "Elfirma AB" }, fontBytes, basis: basisView({ customerType: "PRIVATE", tax: rotTax, totals: invoiceBasisTotals([line({ rotLabour: true })], 25, rot) }) }));
  assert.match(withRot, /Preliminärt ROT-avdrag 30 %/);
  assert.match(withRot, /efter ROT-avdrag/);
  const reverse = await textOf(await createInvoiceBasisPdf({ identity: { company: "Elfirma AB" }, fontBytes, basis: basisView({ vatPercent: 0, tax: { ...NO_INVOICE_TAX, reverseVat: true, buyerVatNumber: "SE1" }, totals: invoiceBasisTotals([line()], 0) }) }));
  assert.ok(reverse.includes(REVERSE_VAT_LABEL));
  assert.match(reverse, /Köparens momsreg\.nr/);
});

// ---------- Sidbrytningar och långa texter i rapportverktyget ----------

test("the engine prints long content whole over the pages, and the page numbers count them all", async () => {
  const kit = await createReportKit({ identity: { company: "Ett mycket långt företagsnamn ".repeat(6) }, fontBytes, head: { kind: "Överrad", title: "Rubrik", number: "Kod", continuation: "En mycket lång rubrik på fortsättningssidan ".repeat(6) } });
  kit.firstPage();
  kit.checkList(Array.from({ length: 90 }, (_, index) => ({ text: `Punkt ${index + 1}`, checked: index % 2 === 0 })));
  kit.block("Lång notering", Array.from({ length: 120 }, (_, index) => `Rad ${index + 1} i noteringen.`));
  kit.part("Ett kapitel med en mycket lång rubrik som aldrig får skriva över raden under sig ".repeat(4), "Kort beskrivning.");
  kit.section("En rubrik som är så lång att den behöver två rader innan innehållet börjar, och som inte får hamna ovanpå det som följer efteråt i rapporten", { note: "En kort beskrivning." });
  kit.table({ title: "Lång tabell", columns: [{ key: "a", label: "A", width: 200 }, { key: "b", label: "B", width: 281 }], rows: Array.from({ length: 200 }, (_, index) => [`Rad ${index + 1}`, "text"]) });
  kit.footer();
  const drawing = await pdfDrawing(await kit.pdf.save());
  assert.ok(drawing.pages.length > 4);
  const text = drawingText(drawing).join(" ");
  for (const expected of ["Punkt 90", "Rad 120 i noteringen.", "Rad 200"]) assert.ok(text.includes(expected), expected);
  const pageNo = `Sida ${drawing.pages.length} av ${drawing.pages.length}`;
  assert.ok(text.replace(/\s+/g, " ").includes(pageNo), "page numbers count the whole document");
});

test("a table's heading never stands alone at the foot of a page", async () => {
  const kit = await createReportKit({ identity: { company: "F" }, fontBytes, head: { kind: "Ö", title: "Rubrik", number: "Kod", continuation: "R" } });
  kit.firstPage();
  kit.y = 71 + 30; // Room for the heading row, not for the row under it.
  kit.table({ title: "T", columns: [{ key: "a", label: "UNIK-RUBRIK", width: 481 }], rows: [["Rad ett"]] });
  kit.footer();
  const drawing = await pdfDrawing(await kit.pdf.save());
  const onFirst = drawing.pages[0].map((op) => op.text ?? "").join(" ");
  assert.ok(!onFirst.includes("UNIK-RUBRIK"));
  assert.equal(drawing.pages.length, 2);
});

test("a long comment on an object card is printed whole, the rest under the card", async () => {
  const task = kfidTask(kfidFull);
  const form = (await import("../lib/workflow/builtin-forms")).BUILTIN_FORMS.find((item) => item.meta.name === "Termografering")!;
  const formValues = initialFormValues(form.document);
  const long = Array.from({ length: 60 }, (_, index) => `Iakttagelse ${index + 1} om objektet`).join(" ");
  formValues.tables.objekt = [{ id: "row-1", label: "", cells: { objekt: "Central A1", komponent: "Säkring", fas: "L2", maxtemp: 68.4, reftemp: 31.2, bedomning: "Ingen anmärkning", atgard: `${long} SISTA ORDET` } }];
  const report = { ...task, data: { kind: "FORM" as const, details: { templateName: form.meta.name, templateVersion: 1, document: form.document, values: formValues } } } as WorkflowReportTask;
  const text = await textOf(await createFormProtocolPdf({ identity: { company: "F" }, fontBytes, task: report, options: defaultWorkflowReportOptions }));
  assert.ok(text.includes("SISTA ORDET"));
});

// ---------- PDF-granskningen 2026-11-03: fynd 10, 15 och 19 (val) ----------

test("finding 10: the basis names the customer's contact person and address like the quote, and draws no empty box", async () => {
  const full = await textOf(await createInvoiceBasisPdf({ identity: { company: "Elfirma AB" }, fontBytes, basis: basisView({ customer: { id: "c", name: "Bygg AB", contactName: "Eva Ek", address: "Ljusvägen 2, 123 45 Elstad" } }) }));
  assert.match(full, /Att: Eva Ek/);
  assert.match(full, /Eva Ek/);
  assert.match(full, /Ljusvägen 2, 123 45 Elstad/);
  const empty = await textOf(await createInvoiceBasisPdf({ identity: { company: "Elfirma AB" }, fontBytes, basis: basisView({ customer: { id: "c", name: "Kim Kund", contactName: "", address: "" } }) }));
  assert.doesNotMatch(empty, /Att:/);
  assert.doesNotMatch(empty, /Adress/);
  const server = readFileSync("lib/invoice-basis/server.ts", "utf8");
  assert.match(server, /customer: row\.customer \? customerOf\(row\.customer\) : null/, "a saved basis carries them");
  assert.match(server, /customer: customer \? customerOf\(customer\) : null/, "so does a proposal");
  assert.match(server, /prisma\.customer\.findFirst\(\{ where: \{ id: customerId, organizationId: caller\.organizationId \}/, "the customer is read within the caller's company");
});

test("finding 15: Kundtyp stands on the quote only when ROT applies, as Privatperson – ROT", async () => {
  const company = await textOf(await createQuotePdf({ identity: { company: "Elfirma AB" }, fontBytes, quote }));
  assert.doesNotMatch(company, /Kundtyp/);
  const privateNoRot = await textOf(await createQuotePdf({ identity: { company: "Elfirma AB" }, fontBytes, quote: { ...quote, customerType: "PRIVATE" } }));
  assert.doesNotMatch(privateNoRot, /Kundtyp|Privatperson/);
  const rotLines = [{ id: "l1", kind: "LABOUR" as const, name: "Arbete", quantity: "2", unit: "h", unitPrice: "500", markupPercent: "", rotLabour: true }];
  const withRot = await textOf(await createQuotePdf({ identity: { company: "Elfirma AB" }, fontBytes, quote: { ...quote, customerType: "PRIVATE", rotPercent: 30, lines: rotLines, totals: quoteTotals(rotLines, 25, { percent: 30, cap: 50000 }) } }));
  assert.match(withRot, /Kundtyp/);
  assert.match(withRot, /Privatperson – ROT/);
});

test("finding 19: the protocol's box says — where there is no place or work order, and the rows stay", async () => {
  const text = await textOf(await createFormProtocolPdf({ identity: { company: REFERENCE_COMPANY }, fontBytes, task: protocol({ facilityName: undefined, workOrderTitle: undefined }), options: defaultWorkflowReportOptions }));
  assert.match(text, /Plats/);
  assert.match(text, /Arbetsorder/);
  assert.match(text, /—/);
  assert.doesNotMatch(text, /Ingen plats|Ingen arbetsorder/);
});
