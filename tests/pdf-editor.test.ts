import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PDF_DOCUMENTS, PDF_DOCUMENT_TYPES, pdfDocumentDef, type PdfDocumentType } from "../lib/pdf-templates/catalog";
import { PDF_EXAMPLE_VARIANTS } from "../lib/pdf-templates/example-variants";
import { renderPdfExample, renderTracedExample } from "../lib/pdf-templates/examples";
import { pdfTextsOf, PdfTrace, tracedTemplates, untraced, type PdfTemplateOverride } from "../lib/pdf-templates/model";
import { pdfDrawing, type DrawingOp } from "./helpers/pdf-drawing";

/**
 * The on-page editor (2026-11-04): the click targets come from the real generators, and tracing them changes nothing.
 * No database and no browser: the page itself is tested by tests/pdf-templates.browser.cjs.
 */
const fonts = { regular: new Uint8Array(readFileSync("public/fonts/Manrope-Regular.ttf")), bold: new Uint8Array(readFileSync("public/fonts/Manrope-Bold.ttf")), fallback: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")) };
const everyExample = PDF_DOCUMENT_TYPES.flatMap((type) => PDF_EXAMPLE_VARIANTS[type].map((variant) => ({ type, key: variant.key })));

test("a traced document draws exactly what an untraced one draws: every operator of every page of every example", async () => {
  for (const { type, key } of everyExample) {
    const plain = await pdfDrawing(await renderPdfExample(type, key, null, fonts));
    const traced = await pdfDrawing((await renderTracedExample(type, key, null, fonts)).pdf);
    assert.deepEqual(traced.pages, plain.pages, `${type}/${key} draws differently with the trace on`);
  }
});

test("a real document has no trace: without one a text is the plain text, and the marks never reach the file", async () => {
  const def = pdfDocumentDef("quote")!;
  assert.equal(pdfTextsOf(def, null).text("title"), "Offert");
  const trace = new PdfTrace();
  const marked = pdfTextsOf(def, tracedTemplates(null, trace)).text("section.changes");
  assert.notEqual(marked, "Ändringar mot accepterad version");
  assert.equal(untraced(marked), "Ändringar mot accepterad version");
  const { pdf } = await renderTracedExample("quote", "quote", null, fonts);
  const raw = Buffer.from(pdf).toString("latin1");
  assert.doesNotMatch(raw, /Title \(.*[-]/);
  for (const page of (await pdfDrawing(pdf)).pages) for (const op of page) assert.doesNotMatch(op.text ?? "", /[-]/);
});

/** The text drawn on a page, with where each drawing position is: the same numbers pdf.js shows. */
function textOps(page: readonly DrawingOp[]) {
  const out: { x: number; y: number; text: string }[] = [];
  let x = 0;
  let y = 0;
  for (const op of page) {
    if (op.op === "Tm" || op.op === "cm") { x = op.nums.at(-2) ?? x; y = op.nums.at(-1) ?? y; }
    if (op.text) out.push({ x, y, text: op.text });
  }
  return out;
}

test("the click targets lie on the words they name: the same x and baseline as the drawn text, and the width of the text", async () => {
  const { pdf, targets } = await renderTracedExample("quote", "quote", null, fonts);
  const drawing = await pdfDrawing(pdf);
  const heading = targets.find((target) => target.id === "section.spec")!;
  assert.ok(heading, "the heading has a target");
  const texts = textOps(drawing.pages[heading.page]!);
  const drawn = texts.find((item) => item.text.includes("Specifikation"));
  assert.ok(drawn, "the heading is drawn");
  assert.ok(Math.abs(drawn.x - heading.x) < 0.01, `x ${drawn.x} / ${heading.x}`);
  assert.ok(drawn.y > heading.y && drawn.y < heading.y + heading.height, `the baseline ${drawn.y} lies in ${heading.y}..${heading.y + heading.height}`);
  assert.ok(heading.width > 50 && heading.width < 110, `the width of one word: ${heading.width}`);
  // A right-aligned title reports where it really starts, not the column's edge.
  const title = targets.find((target) => target.id === "title")!;
  assert.equal(title.align, "right");
  assert.ok(Math.abs(title.x + title.width - (595.28 - 56.69)) < 0.2, "the title ends at the right margin");
});

test("every target names a block of the catalogue, and a template word never lands outside the page", async () => {
  for (const { type, key } of everyExample) {
    const { targets, pages } = await renderTracedExample(type, key, null, fonts);
    assert.ok(targets.length > 5, `${type}/${key} has targets`);
    for (const target of targets) {
      assert.ok(pdfDocumentDef(target.doc)?.blocks.some((block) => block.id === target.id), `${target.doc}.${target.id}`);
      const page = pages[target.page]!;
      assert.ok(target.x >= 0 && target.y >= 0 && target.x + target.width <= page.width + 0.5 && target.y + target.height <= page.height + 0.5, `${type}/${key}: ${target.id} lies on its page`);
      assert.ok(target.width > 0 && target.height > 0, `${target.id} has a size`);
    }
  }
});

test("most of the document's texts are on a page in some example, and every document's head, sections and table columns are", async () => {
  const printed = new Set<string>();
  for (const { type, key } of everyExample) for (const target of (await renderTracedExample(type, key, null, fonts)).targets) printed.add(`${target.doc}:${target.id}`);
  const total = PDF_DOCUMENTS.reduce((sum, doc) => sum + doc.blocks.length, 0);
  const missing = PDF_DOCUMENTS.flatMap((doc) => doc.blocks.filter((block) => !printed.has(`${doc.type}:${block.id}`)).map((block) => `${doc.type}:${block.id}`));
  assert.ok(missing.length / total < 0.12, `${missing.length} of ${total} never printed: ${missing.join(" ")}`);
  const columns = PDF_DOCUMENTS.flatMap((doc) => doc.blocks.filter((block) => block.kind === "column" && !printed.has(`${doc.type}:${block.id}`)).map((block) => `${doc.type}:${block.id}`));
  assert.deepEqual(columns, [], "every column label can be clicked in an example");
});

test("an edited table column label reaches the table, and its target follows", async () => {
  const override: PdfTemplateOverride = { documentType: "quote", blockId: "col.name", text: "Artikel", visible: null, orderIndex: null, basedOnVersion: "" };
  const version = pdfDocumentDef("quote")!.blocks.find((block) => block.id === "col.name")!;
  const { blockVersion } = await import("../lib/pdf-templates/model");
  const { targets, pdf } = await renderTracedExample("quote", "quote", [{ ...override, basedOnVersion: blockVersion(version) }], fonts);
  const page = (await pdfDrawing(pdf)).pages[0]!.flatMap((op) => op.text ?? "").join(" ");
  assert.ok(page.includes("Artikel"));
  assert.ok(targets.some((target) => target.id === "col.name"));
});

test("a common text is edited once and every document follows", async () => {
  const { blockVersion } = await import("../lib/pdf-templates/model");
  const made = pdfDocumentDef("common")!.blocks.find((block) => block.id === "sign.name")!;
  const overrides: PdfTemplateOverride[] = [{ documentType: "common", blockId: "sign.name", text: "Namn i klartext", visible: null, orderIndex: null, basedOnVersion: blockVersion(made) }];
  for (const type of ["quote", "invoice_basis"] as PdfDocumentType[]) {
    const text = (await pdfDrawing(await renderPdfExample(type, null, overrides, fonts))).pages.flat().map((op) => op.text ?? "").join("");
    assert.ok(text.includes("Namn i klartext"), type);
  }
});

test("the generators hold no fixed label of their own: a text printed as a label, heading or column comes from the catalogue", () => {
  const files = ["lib/quotes/quote-report.ts", "lib/invoice-basis/basis-report.ts", "lib/payroll/basis-report.ts", "lib/staff-register/report.ts", "lib/self-inspection/deviation-export.ts", "lib/self-inspection/report.ts", "lib/workflow/task-report.ts", "lib/workflow/form-report.ts", "lib/workflow/risk-step-report.ts"];
  for (const file of files) {
    const source = readFileSync(file, "utf8").split("\n").filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));
    for (const [index, line] of source.entries()) {
      // deviation-export.ts names its CSV sections with labels on its own: they are the export menu's, not printed text.
      if (file.endsWith("deviation-export.ts") && /key: "(description|action|investigation|history|photos)"/.test(line)) continue;
      assert.doesNotMatch(line, /\blabel: "[A-ZÅÄÖ]/, `${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
      assert.doesNotMatch(line, /kit\.(section|subTitle|band|block)\("/, `${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
      assert.doesNotMatch(line, /\btitle: "[A-ZÅÄÖ]/, `${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
    }
  }
});

test("the ids a generator asks for exist in the catalogue, also on the paths no example takes", () => {
  const sources: [string, PdfDocumentType, string][] = [["lib/quotes/quote-report.ts", "quote", "t"], ["lib/invoice-basis/basis-report.ts", "invoice_basis", "t"], ["lib/payroll/basis-report.ts", "payroll", "t"], ["lib/staff-register/report.ts", "staff_register", "t"], ["lib/self-inspection/deviation-export.ts", "deviation", "t"], ["lib/self-inspection/report.ts", "self_inspection", "t"], ["lib/workflow/form-report.ts", "protocol", "t"], ["lib/workflow/task-report.ts", "work_order", "w"], ["lib/workflow/task-report.ts", "project_report", "p"], ["lib/workflow/task-report.ts", "risk_assessment", "r"], ["lib/workflow/risk-step-report.ts", "risk_assessment", "t"], ["lib/workflow/report-kit.ts", "common", "common"]];
  for (const [file, type, name] of sources) {
    const known = new Set(pdfDocumentDef(type)!.blocks.map((block) => block.id));
    const source = readFileSync(file, "utf8");
    const calls = new RegExp(`\\b${name.replace(".", "\\.")}\\.(?:text|shown)\\(([^)]*)`, "g");
    for (const match of source.matchAll(calls)) {
      for (const literal of match[1]!.split(",")[0]!.replace(/[!=]== "[^"]*"/g, "").matchAll(/"([a-z][a-z0-9.-]*)"/g)) assert.ok(known.has(literal[1]!), `${file}: ${type} has no block ${literal[1]}`);
    }
    if (type === "protocol") for (const match of source.matchAll(/context\.t\.text\(([^)]*)/g)) for (const literal of match[1]!.split(",")[0]!.replace(/[!=]== "[^"]*"/g, "").matchAll(/"([a-z][a-z0-9.-]*)"/g)) assert.ok(known.has(literal[1]!), `${file}: protocol has no block ${literal[1]}`);
  }
});

test("the unit for hours in the texts moved here is h (2026-11-04), never tim", () => {
  for (const doc of PDF_DOCUMENTS) for (const block of doc.blocks) assert.doesNotMatch(block.text, /\b(\d+ )?tim\b|kr\/tim/, `${doc.type}.${block.id}`);
});

// Fakturan (2026-11-04) is locked when issued; its fixed texts are edited in the same click editor as every other document.
test("the invoice's and the credit invoice's fixed texts can be clicked, the ROT example with its own blocks", async () => {
  const blocksOf = async (type: "invoice" | "credit_invoice", key: string) => new Set((await renderTracedExample(type, key, null, fonts)).targets.filter((target) => target.doc === type).map((target) => target.id));
  const plain = await blocksOf("invoice", "invoice");
  for (const id of ["title", "fact.buyer", "col.name", "total.pay", "pay.late"]) assert.ok(plain.has(id), `faktura: ${id}`);
  const rot = await blocksOf("invoice", "rot");
  for (const id of ["section.rot", "fact.personal-number", "fact.property", "sum.rot"]) assert.ok(rot.has(id), `ROT: ${id}`);
  assert.ok((await blocksOf("invoice", "preview")).has("band.preview"));
  const proforma = await blocksOf("invoice", "proforma");
  for (const id of ["title.proforma", "band.proforma", "total.proforma"]) assert.ok(proforma.has(id), `proforma: ${id}`);
  for (const id of ["title", "date.due", "pay.reference", "pay.late"]) assert.ok(!proforma.has(id), `proforma has no ${id}: no number, no payment`);
  assert.ok((await blocksOf("credit_invoice", "credit")).has("fact.credits"));
  const version = pdfDocumentDef("invoice")!.blocks.find((block) => block.id === "fact.subject")!;
  const { blockVersion } = await import("../lib/pdf-templates/model");
  const { pdf } = await renderTracedExample("invoice", "invoice", [{ documentType: "invoice", blockId: "fact.subject", text: "Gäller", visible: null, orderIndex: null, basedOnVersion: blockVersion(version) }], fonts);
  assert.ok((await pdfDrawing(pdf)).pages[0]!.flatMap((op) => op.text ?? "").join(" ").includes("Gäller"), "an edited text reaches the invoice example");
});

// 2026-11-05: an example keeps the widths it has measured. A kept width must give the same drawing as a measured one.
test("kept widths change nothing: the next drawing of an example is the same as the first", async () => {
  const first = await pdfDrawing((await renderTracedExample("self_inspection", "programme", null, fonts)).pdf);
  const second = await pdfDrawing((await renderTracedExample("self_inspection", "programme", null, fonts)).pdf);
  assert.deepEqual(second, first);
});
