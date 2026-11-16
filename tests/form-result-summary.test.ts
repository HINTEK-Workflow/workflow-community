import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBlock, emptyEditorDocument, insertBlock } from "../lib/workflow/form-editor";
import {
  deviationCount, evaluateForm, formApprovalResult, formCompletion, formDocumentSchema, formFieldLacksLimit, formFilledIn, formResultSummary, formResultText, formRuleSummary,
  initialFormValues, type FormDocument, type FormLeafBlock,
} from "../lib/workflow/form-document";
import { formHistoryItem } from "../lib/workflow/form-history";
import { importControlPoints } from "../lib/workflow/form-import";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, protocolNumberOf, type WorkflowReportTask } from "../lib/workflow/report";
import { isolationMeasurementForm } from "../lib/workflow/form-examples";

// Kundresa 2026-11-07 (kontroller): a Nej on a check point is a deficiency, an empty control is "Ej ifyllt", and the
// editor, Tidigare protokoll and the PDF say the same thing.

function form(build: (add: (block: FormLeafBlock) => FormLeafBlock, editor: () => ReturnType<typeof emptyEditorDocument>) => void): FormDocument {
  let editor = emptyEditorDocument();
  const sectionId = editor.blocks[0].id;
  build((block) => { editor = insertBlock(editor, block, { sectionId }); return block; }, () => editor);
  return formDocumentSchema.parse(editor);
}

test("a new Ja/nej block is a check point: Nej is the deviation, counted as not approved", () => {
  let point!: FormLeafBlock;
  const document = form((add, editor) => { point = add(createBlock("yesno", editor())); });
  assert.equal(point.type === "field" && point.deviationOn, "NO");
  const values = initialFormValues(document);
  const key = (point as { key: string }).key;
  values.fields[key] = "NO";
  const evaluation = evaluateForm(document, values);
  assert.equal(evaluation.deviations.length, 1);
  assert.deepEqual(formApprovalResult(document, values, evaluation).totals.map(({ title, ok, total }) => ({ title, ok, total })), [{ title: "Kontrollpunkter", ok: 0, total: 1 }]);
  assert.match(formRuleSummary(document, values, evaluation), /^Kontrollpunkter: 0 av 1 godkända\.$/m);
  assert.deepEqual(formResultSummary(document, values, evaluation), { filled: true, approved: 0, points: 1, deviations: 1 });
  assert.equal(formResultText(formResultSummary(document, values, evaluation)), "1 avvikelse");
  values.fields[key] = "YES";
  assert.deepEqual(formResultSummary(document, values), { filled: true, approved: 1, points: 1, deviations: 0 });
});

test("a Ja/nej that switches a moment or a condition is never a deviation, whatever its setting", () => {
  let point!: FormLeafBlock;
  const document = form((add, editor) => { point = add({ ...createBlock("yesno", editor()), momentSwitch: true } as FormLeafBlock); });
  const values = initialFormValues(document);
  values.fields[(point as { key: string }).key] = "NO";
  assert.equal(evaluateForm(document, values).deviations.length, 0);
  assert.equal(formApprovalResult(document, values).totals.length, 0);
});

test("imported Ja/nej control points count Nej as the deviation", () => {
  const result = importControlPoints([{ kontrollpunkt: "Skyddsjord ansluten", svarstyp: "ja_nej" }]);
  const field = result.sections.flatMap((section) => section.blocks).find((block) => block.type === "field");
  assert.equal(field && field.type === "field" && field.deviationOn, "NO");
});

test("nothing filled in is 'Ej ifyllt'; prefilled and default values do not count", () => {
  let text!: FormLeafBlock;
  let date!: FormLeafBlock;
  const document = form((add, editor) => {
    text = add({ ...createBlock("text_field", editor()), prefill: "customer" } as FormLeafBlock);
    date = add({ ...createBlock("number", editor()), defaultValue: 5 } as FormLeafBlock);
    add(createBlock("yesno", editor()));
  });
  const values = initialFormValues(document);
  values.fields[(text as { key: string }).key] = "Brf Solgläntan";
  values.fields[(date as { key: string }).key] = 5;
  assert.equal(formFilledIn(document, values), false);
  assert.equal(formResultText(formResultSummary(document, values)), "Ej ifyllt");
  values.fields[(date as { key: string }).key] = 7;
  assert.equal(formResultText(formResultSummary(document, values)), "Inga avvikelser");
});

test("Tidigare protokoll counts a row that is not approved, like the PDF, and says 'Ej ifyllt' for an empty protocol", () => {
  const values = initialFormValues(isolationMeasurementForm);
  const empty = formHistoryItem({ id: "a", title: "Tom", status: "PLANNED", updatedAt: "2026-11-07T10:00:00.000Z", data: { details: { document: isolationMeasurementForm, values } } });
  assert.equal(empty.filled, false);
  assert.equal(formResultText(empty), "Ej ifyllt");
  values.tables.matning[0].cells = { uppmatt: "0,4", grans: "1" };
  const failing = formHistoryItem({ id: "b", title: "Underkänd", status: "IN_PROGRESS", updatedAt: "2026-11-07T10:00:00.000Z", data: { details: { document: isolationMeasurementForm, values } } });
  const { notApproved } = formApprovalResult(isolationMeasurementForm, values);
  // The summary block's two lists: the rows that are not approved and the other deviations.
  assert.equal(failing.deviations, notApproved.filter((row) => row.state === false).length + deviationCount(evaluateForm(isolationMeasurementForm, values)));
  assert.equal(failing.deviations, 1);
  assert.equal(formResultText(failing), "1 avvikelse");
  assert.equal(failing.filled, true);
});

test("a measured value judged against a limit without a value is said to lack it", () => {
  let measured!: FormLeafBlock;
  const document = form((add, editor) => { measured = add({ ...createBlock("measurement", editor()), unit: "MΩ" } as FormLeafBlock); });
  const withLimit = formDocumentSchema.parse({ ...document, limits: [{ key: "riso", label: "Isolation", unit: "MΩ", low: null, high: null, warnLow: null, warnHigh: null, source: "", help: "" }],
    blocks: document.blocks.map((section) => section.type === "section" ? { ...section, blocks: section.blocks.map((block) => block.id === measured.id ? { ...block, limitKey: "riso" } : block) } : section) });
  const values = initialFormValues(withLimit);
  const key = (measured as { key: string }).key;
  assert.equal(formFieldLacksLimit(withLimit, values, withLimit.blocks.flatMap((block) => block.type === "section" ? block.blocks : []).find((block) => block.id === measured.id)!), false, "nothing measured, nothing to say");
  values.fields[key] = "0,3";
  const block = withLimit.blocks.flatMap((item) => item.type === "section" ? item.blocks : []).find((item) => item.id === measured.id)!;
  assert.equal(formFieldLacksLimit(withLimit, values, block), true);
  const completion = formCompletion(withLimit, values);
  assert.equal(completion.pendingText, "1 mätvärde saknar gräns");
  assert.ok(completion.percent < 100);
  values.limits = { riso: { low: 1, high: null, warnLow: null, warnHigh: null, source: "", origin: "company" } };
  assert.equal(formFieldLacksLimit(withLimit, values, block), false);
});

test("the demo's protocols get a readable number; real ones keep theirs", () => {
  assert.equal(protocolNumberOf("demo-task-290"), "P-DEMO-290");
  assert.equal(protocolNumberOf("cmabc123def456ghi789"), "P-56GHI789");
  // A demo protocol named by words (the round protocol said "P-ERVKRAFT", 2026-11-16): four fixed digits, the same every time.
  const round = protocolNumberOf("demo-task-rond-reservkraft");
  assert.match(round, /^P-DEMO-\d{4}$/);
  assert.equal(protocolNumberOf("demo-task-rond-reservkraft"), round);
  assert.notEqual(protocolNumberOf("demo-task-fortlopande-kontor"), round);
});

async function pdfText(task: Partial<WorkflowReportTask> & Pick<WorkflowReportTask, "data">) {
  const { pdfDrawing, drawingText } = await import("./helpers/pdf-drawing");
  const bytes = await createWorkflowPdfReport({
    company: "QA AB", fontBytes: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")), options: defaultWorkflowReportOptions,
    tasks: [{ id: "cmabc123def456ghi789", kind: "FORM", title: "Pumpskåp P3", description: "", status: "IN_PROGRESS", progress: 0, assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [], protocolNumber: "P-56GHI789", ...task }],
  });
  return drawingText(await pdfDrawing(bytes)).join("\n").replace(/\s+/g, " ");
}

test("the PDF: an empty control says 'Ej ifyllt', a custom form is named by itself, one percent and the open logged deviation", async () => {
  let point!: FormLeafBlock;
  const document = form((add, editor) => { point = add(createBlock("yesno", editor())); add(createBlock("summary", editor())); });
  const details = { templateName: "Resa Kontroll pumpskåp", templateVersion: 1, document };
  const empty = await pdfText({ data: { kind: "FORM", details: { ...details, values: initialFormValues(document) } } });
  assert.ok(empty.includes("Ej ifyllt – inga kontrollpunkter är ifyllda."), empty);
  assert.ok(!empty.includes("Inga avvikelser."));
  assert.ok(empty.includes("Resa Kontroll pumpskåp"), "the form's name is the heading, not 'Protokoll'");

  const values = initialFormValues(document);
  values.fields[(point as { key: string }).key] = "NO";
  const text = await pdfText({ progress: 12, data: { kind: "FORM", details: { ...details, values } }, loggedDeviations: [{ number: 4, title: "Skyddsjord saknas", status: "OPEN" }] });
  assert.ok(text.includes("Kontrollpunkter: 0/1 godkända"), text);
  assert.ok(text.includes("Kontrollpunkt: svaret Nej är en avvikelse."));
  assert.ok(text.includes("Avvikelse 4 i avvikelseloggen är öppen: Skyddsjord saknas"));
  const percents = [...text.matchAll(/(\d+) % klart|Kompletteringsgrad: (\d+) %/g)].map((match) => match[1] ?? match[2]);
  assert.equal(new Set(percents).size, 1, `one percent, got ${percents.join(", ")}`);
});
