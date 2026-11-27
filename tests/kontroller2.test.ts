import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ExcelJS from "exceljs";
import { kfidForm, kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { formCompletion, initialFormValues, newFormRow, type FormTableBlock, type FormValues } from "../lib/workflow/form-document";
import { createFormExcel } from "../lib/workflow/form-excel";
import { adviseFlow } from "../lib/workflow/flow-advisor";
import { nextStepLine } from "../lib/workflow/next-step";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "../lib/workflow/report";
import { pdfText } from "../lib/import/pdf-text";
import { CREDENTIAL_ORDER_MESSAGE, selfInspectionActionSchema } from "../lib/self-inspection/model";

const table = (key: string) => kfidFormDocument.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block): block is FormTableBlock => block.type === "table" && block.key === key)!;
const font = () => new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
const protocol = (values: FormValues): WorkflowReportTask => ({
  id: "kfid-1", kind: "FORM", title: "Hall 3", description: "", status: "IN_PROGRESS", progress: 50, assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
  data: { kind: "FORM", details: { templateName: kfidForm.meta.name, templateVersion: 1, document: kfidFormDocument, values } },
});
const pdf = async (values: FormValues) => ((await pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", fontBytes: font(), options: defaultWorkflowReportOptions, tasks: [protocol(values)] })))) ?? "").replace(/\s+/g, " ");
const sheetRows = async (values: FormValues, name: string) => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await createFormExcel({ company: "QA", task: protocol(values) })) as unknown as Parameters<typeof book.xlsx.load>[0]);
  return book.worksheets.find((sheet) => sheet.name.startsWith(name))!.getSheetValues().filter(Boolean).map((row) => (row as unknown[]).slice(1).map(String));
};
/** Isolation with one measured row (no limit) and two untouched extra rows. */
function isoValues() {
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-iso"] = true;
  const base = newFormRow(table("iso"), "r1");
  values.tables.iso = [{ ...base, cells: { ...base.cells, objekt: "Grupp 1", mohm: 5 } }, newFormRow(table("iso"), "r2"), newFormRow(table("iso"), "r3")];
  return values;
}

test("R2-KTR-03: a row without its limit is said as what is missing, never 100 % or 'allt klart'", () => {
  const completion = formCompletion(kfidFormDocument, isoValues());
  assert.equal(completion.pendingText, "1 rad saknar gräns");
  assert.ok(completion.percent < 100);
  assert.equal(formCompletion(kfidFormDocument, initialFormValues(kfidFormDocument)).pendingText, "");
  assert.match(nextStepLine({ flow: { steps: [], current: { key: "complete", label: "Färdigställd", hint: "", state: "current" }, done: false } as never, pendingText: "1 rad saknar gräns" })!.text, /^1 rad saknar gräns/);
  const tips = adviseFlow({ kind: "FORM", flow: { steps: [], current: { key: "complete", label: "Färdigställd", hint: "", state: "current" }, done: false } as never, saved: true, completed: false, today: "2026-10-18", pendingText: "1 rad saknar gräns" });
  assert.equal(tips[0].title, "1 rad saknar gräns");
  assert.doesNotMatch(JSON.stringify(tips), /Allt som krävs/);
});

test("R2-KTR-03/02: PDF names the missing limit and leaves out empty extra rows (R2-KTR-07, only the chosen moments' guidance, is NOT applied: the locked reference PDFs stay as they were until the product owner decides)", async () => {
  const text = await pdf(isoValues());
  assert.match(text, /Kompletteringsgrad: \d+ % · 1 rad saknar gräns/);
  assert.doesNotMatch(text, /Kompletteringsgrad: 100 %/);
  assert.match(text, /Valbara testspänningar/, "Isolation is chosen");
});

test("R2-KTR-02/08: Excel leaves out empty extra rows and labels the joined time columns one by one", async () => {
  const rows = await sheetRows(isoValues(), "Isolation");
  assert.equal(rows.length, 4, "two heading rows, the header and the one measured row (three before: 6)");
  assert.ok(rows.some((row) => row.includes("Grupp 1")));
  const values = initialFormValues(kfidFormDocument);
  values.sections["kfid-rcd"] = true;
  const rcd = await sheetRows(values, "Jordfelsbrytarprov");
  const header = rcd.find((row) => row.some((cell) => cell.startsWith("t 1×")))!;
  assert.ok(header.includes("t 1× (+) (ms)") && header.includes("t 1× (−) (ms)"), header.join("|"));
  assert.ok(!header.some((cell) => cell.includes("(+) / (−)")));
});

test("R2-KTR-05: a certificate cannot expire before it was taken", () => {
  const credential = (issuedAt: string | null, validUntil: string | null) => selfInspectionActionSchema.safeParse({ action: "save_credential", credential: { personId: "p1", title: "Heta arbeten", issuedAt, validUntil } });
  const bad = credential("2026-10-01", "2025-01-01");
  assert.equal(bad.success, false);
  assert.equal(bad.error?.issues[0].message, CREDENTIAL_ORDER_MESSAGE);
  assert.ok(credential("2026-10-01", "2026-10-01").success);
  assert.ok(credential(null, "2025-01-01").success);
});
