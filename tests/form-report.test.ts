import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createWorkflowPdfReport, defaultWorkflowReportOptions } from "../lib/workflow/report";
import { initialFormValues } from "../lib/workflow/form-document";
import { isolationMeasurementForm } from "../lib/workflow/form-examples";

test("a form protocol renders as PDF, including units such as MΩ in bold text and deviations", async () => {
  const values = initialFormValues(isolationMeasurementForm);
  values.fields.instrument = "IT-200";
  values.tables.matning[0].cells = { uppmatt: "250", grans: "1" };
  values.tables.matning[1].cells = { uppmatt: "0,4", grans: "1" };
  values.signatures.utford = { name: "Elon Strömberg", confirmed: true, signedAt: "2026-09-28T10:00:00.000Z" };
  values.deviationComment = "L2–PE mäts om.";
  const bytes = await createWorkflowPdfReport({
    company: "HINTEK Power Solutions AB", fontBytes: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")), options: defaultWorkflowReportOptions,
    tasks: [{ id: "p1", kind: "FORM", title: "Isolationsmätning garage (MΩ)", description: "", status: "IN_PROGRESS", progress: 60, assignedToName: "Elon", dueDate: "", totalDurationSec: 0, attachments: [],
      data: { kind: "FORM", details: { templateName: "Isolationsmätning Ω", templateVersion: 1, document: isolationMeasurementForm, values } } }],
  });
  assert.ok(bytes.length > 5000);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
});

test("a single protocol is drawn like the control's report: heading, fact boxes, summary, attachments and snapshot mark", async () => {
  const { pdfDrawing, drawingText } = await import("./helpers/pdf-drawing");
  const { referenceReports } = await import("./fixtures/report-references");
  const reference = referenceReports.find((item) => item.name === "form-thermography-before")!;
  const text = drawingText(await pdfDrawing(await reference.render())).join("\n");
  for (const expected of ["TERMOGRAFERING", "Protokoll", "Version 1", "· ÖGONBLICKSBILD – EJ SLUTFÖRT", "HINTEK Power Solutions AB", "Uppgift", "Termografering Brf Solgläntan", "Mätförutsättningar",
    "Objekt 1: Central A1, grupp 12", "Avvikelse", "Iakttagelse och rekommenderad åtgärd: Byt säkringshållare vid nästa service.", "Termografibild · termobild-a1.png",
    "Sammanfattning / avvikelser", "1 avvikelse:", "Säkringshållaren byts vid nästa service.", "Bilagor", "1. termobild-a1.png · Termograferade objekt · Central A1, grupp 12 · Termografibild",
    "Elon Strömberg · bekräftad 2026-09-27 13:00", "Protokoll · fortsättning"])
    assert.ok(text.includes(expected), `saknar ${expected}`);
  // The picture sits in its card, so it gets no attachment page of its own.
  assert.ok(!text.includes("BILAGA 1"));
});

test("a form protocol keeps a heading with its content, leaves out empty free rows and says 'se bilder nedan' only with pictures", async () => {
  const { pdfDrawing, drawingText } = await import("./helpers/pdf-drawing");
  const { createBlock, emptyEditorDocument, insertBlock } = await import("../lib/workflow/form-editor");
  const { formDocumentSchema } = await import("../lib/workflow/form-document");
  const render = async (fields: number) => {
    let editor = emptyEditorDocument();
    const sectionId = editor.blocks[0].id;
    for (let index = 0; index < fields; index++) editor = insertBlock(editor, { ...createBlock("long_text", editor), label: `Fält ${index + 1}` } as never, { sectionId, index });
    const table = createBlock("table", editor);
    editor = insertBlock(editor, table, { sectionId, index: fields });
    const images = createBlock("attachment", editor);
    editor = insertBlock(editor, images, { sectionId, index: fields + 1 });
    editor = insertBlock(editor, createBlock("summary", editor), { sectionId, index: fields + 2 });
    const document = formDocumentSchema.parse(editor);
    const values = initialFormValues(document);
    const { key, columns } = table as { key: string; columns: { key: string }[] };
    values.tables[key] = [{ id: "r1", label: "", cells: { [columns[0].key]: "Grupp 1", [columns[1].key]: "0,45" } }, { id: "r2", label: "", cells: { [columns[0].key]: "", [columns[1].key]: null } }];
    const bytes = await createWorkflowPdfReport({
      company: "QA AB", fontBytes: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")), options: defaultWorkflowReportOptions,
      tasks: [{ id: "p1", kind: "FORM", title: "Protokoll", description: "", status: "IN_PROGRESS", progress: 50, assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
        data: { kind: "FORM", details: { templateName: "Formulär", templateVersion: 1, document, values } } }],
    });
    return drawingText(await pdfDrawing(bytes));
  };
  const first = await render(0);
  assert.ok(first.join("\n").includes("Grupp 1"));
  assert.ok(!first.join("\n").includes("—\n—"), "the empty free row is not printed");
  assert.ok(!first.join("\n").includes("se bilder nedan"), "no pictures, no reference to them");
  // Wherever the page ends, the summary's heading stands on the same page as its box.
  for (let fields = 4; fields <= 16; fields++) {
    const pages = await render(fields);
    const page = pages.findIndex((text) => text.split("\n").includes("Sammanfattning / avvikelser"));
    assert.ok(page >= 0 && pages[page].includes("Kompletteringsgrad"), `heading alone at the foot of page ${page + 1} with ${fields} fields`);
  }
});
