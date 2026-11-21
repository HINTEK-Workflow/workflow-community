import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ExcelJS from "exceljs";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { kfidForm, kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { formRuleSummary, initialFormValues, newFormRow, type FormTableBlock, type FormValues } from "../lib/workflow/form-document";
import { createFormExcel } from "../lib/workflow/form-excel";
import { DEFAULT_REPEAT_MONTHS, addMonths, formIntervalMonths, formScheduleInputSchema, repeatScheduleDraft, scheduleOccurrences } from "../lib/workflow/form-schedule";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "../lib/workflow/report";
import { pdfText } from "../lib/import/pdf-text";
import { NEEDS_LIMIT_TEXT } from "../lib/kfid/guidance";

// ---------- "Upprepa kontrollen" (2026-10-06) ----------

test("addMonths keeps the day, or the month's last day when it is shorter", () => {
  assert.equal(addMonths("2026-10-06", 12), "2027-10-06");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
});

test("the form's own control interval is used, else 12 months", () => {
  const recurring = BUILTIN_FORMS.find((form) => form.id === "hintek-fortlopande-kontroll") ?? BUILTIN_FORMS.find((form) => JSON.stringify(form.document).includes("Kontrollintervall"))!;
  const values = initialFormValues(recurring.document);
  assert.equal(formIntervalMonths(recurring.document, values), 12, "the field's default");
  values.fields.intervall = 36;
  assert.equal(formIntervalMonths(recurring.document, values), 36, "the protocol's answer");
  assert.equal(formIntervalMonths(kfidFormDocument, initialFormValues(kfidFormDocument)), null, "a form without an interval");

  const task = { title: "Fortlöpande kontroll Hall 3", customerId: "c1", facilityId: "p1", projectId: null, assignedToUserId: "u1", assignedToName: "Anna",
    data: { details: { templateId: recurring.id, templateName: recurring.meta.name, document: recurring.document, values } } };
  const draft = repeatScheduleDraft(task, "2026-10-06");
  assert.deepEqual({ ...draft.rule }, { frequency: "MONTHLY", interval: 36, weekdays: [], startDate: "2029-10-06", endDate: "" });
  assert.equal(draft.templateId, recurring.id);
  assert.deepEqual([draft.assignedToUserId, draft.assignedToName, draft.title], ["u1", "Anna", "Fortlöpande kontroll Hall 3"]);
  assert.equal("customerId" in draft || "facilityId" in draft, false, "the round is the time rules; the work order brings the customer and place (2026-10-27 kväll)");
  assert.ok(formScheduleInputSchema.safeParse(draft).success, "the draft is a valid round");
  assert.deepEqual(scheduleOccurrences(draft.rule, "2026-10-06", "2036-01-01"), ["2029-10-06", "2032-10-06", "2035-10-06"]);

  const kfid = repeatScheduleDraft({ ...task, data: { details: { templateId: kfidForm.id, document: kfidFormDocument, values: initialFormValues(kfidFormDocument) } } }, "2026-10-06");
  assert.equal(kfid.rule.interval, DEFAULT_REPEAT_MONTHS);
  assert.equal(kfid.rule.startDate, "2027-10-06");
});

// ---------- A row without its limit: "Ej bedömd – ange gräns" (2026-10-06) ----------

const table = (key: string) => kfidFormDocument.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block): block is FormTableBlock => block.type === "table" && block.key === key)!;
const font = () => new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
const protocol = (values: FormValues): WorkflowReportTask => ({
  id: "kfid-1", kind: "FORM", title: "Hall 3", description: "", status: "IN_PROGRESS", progress: 50, assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
  data: { kind: "FORM", details: { templateName: kfidForm.meta.name, templateVersion: 1, document: kfidFormDocument, values } },
});

test("the form's PDF and Excel say Ej bedömd – ange gräns, never Ej godkänd, for a row without its limit", async () => {
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-iso"] = true;
  const row = newFormRow(table("iso"), "r1");
  values.tables.iso = [{ ...row, cells: { ...row.cells, objekt: "Grupp 1", mohm: 5 } }];
  const text = (await pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", fontBytes: font(), options: defaultWorkflowReportOptions, tasks: [protocol(values)] })))) ?? "";
  assert.match(text.replace(/\s+/g, " "), /Ej bedömd – ange gräns/);
  assert.doesNotMatch(text.split("Stöd vid bedömning")[0], /Ej godkänd/, "only the guidance note names Ej godkänd");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await createFormExcel({ company: "QA", task: protocol(values) })) as unknown as Parameters<typeof book.xlsx.load>[0]);
  const cells = book.worksheets.flatMap((sheet) => sheet.getSheetValues().flat().map(String));
  assert.ok(cells.includes(NEEDS_LIMIT_TEXT));
  assert.ok(!cells.includes("Ej godkänd"));
  // Sammanställ resultat says the same: not judged, never "inte godkänd".
  const summary = formRuleSummary(kfidFormDocument, values);
  assert.match(summary, /Inte bedömda – .*Grupp 1/);
  assert.match(summary, /1 kontrollrad är inte bedömd/);
  assert.doesNotMatch(summary, /inte godkänd/i);
});
