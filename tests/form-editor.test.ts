import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import test from "node:test";
import { evaluateForm, formBlockSchema, formBlockSpan, formWidthForSpan, formCompletion, formDocumentSchema, formLeafBlocks, initialFormValues, validateFormDocument, type FormLeafBlock } from "../lib/workflow/form-document";
import { createBlock, createHistory, duplicateBlock, emptyEditorDocument, emptySection, insertBlock, insertionPoint, insertSection, locate, moveBlock, moveBlockTo, moveSectionTo, normalizeFormDocument, recordHistory, redoHistory, removeBlock, undoHistory, updateBlock, type EditorDocument } from "../lib/workflow/form-editor";
import { diffFormVersions, formDisplayName, formPublishChecks } from "../lib/workflow/form-publish";
import { isolationMeasurementForm } from "../lib/workflow/form-examples";
import { createWorkflowPdfReport, defaultWorkflowReportOptions } from "../lib/workflow/report";

const leaf = (input: Record<string, unknown>) => formBlockSchema.parse(input) as FormLeafBlock;
const ids = (document: EditorDocument) => document.blocks.map((section) => section.blocks.map((block) => block.id));

function sample(): EditorDocument {
  const document = emptyEditorDocument();
  document.blocks[0].title = "Kunduppgifter";
  document.blocks[0].blocks = [leaf({ id: "a", type: "field", key: "kund", label: "Kund", input: "text" }), leaf({ id: "b", type: "field", key: "datum", label: "Datum", input: "datetime" })];
  document.blocks.push({ ...emptySection("Mätning"), id: "s2", blocks: [leaf({ id: "c", type: "field", key: "u", label: "Spänning", input: "number", unit: "V" })] });
  return document;
}

test("form editor: a schema 1 form is read as sections with the width ⅓ for a three-column row, and computes exactly as before", () => {
  const normalized = normalizeFormDocument(isolationMeasurementForm);
  assert.equal(normalized.schema, 2);
  assert.ok(normalized.blocks.every((block) => block.type === "section"));
  // The column row (instrument, provspänning, provdatum) becomes three blocks with the width ⅓, in reading order.
  const first = normalized.blocks[0].blocks;
  assert.deepEqual(first.map((block) => block.id), ["rubrik", "instruktion", "instrument", "provspanning", "provdatum", "matning", "lagsta", "resultat", "utford"]);
  assert.deepEqual(first.filter((block) => "width" in block && block.width === "third").map((block) => block.id), ["instrument", "provspanning", "provdatum"]);
  // Same blocks, same answers, same evaluation and requirements as the stored schema 1 version.
  const values = initialFormValues(isolationMeasurementForm);
  values.tables.matning[0].cells = { uppmatt: "0,4", grans: "1" };
  assert.deepEqual(evaluateForm(normalized as never, values), evaluateForm(isolationMeasurementForm, values));
  assert.deepEqual(formCompletion(normalized as never, values).requirements, formCompletion(isolationMeasurementForm, values).requirements);
  assert.deepEqual(validateFormDocument(normalized).issues, []);
  assert.equal(formWidthForSpan(5), "half"); assert.equal(formWidthForSpan(3), "quarter"); assert.equal(formWidthForSpan(11), "full");
  assert.equal(formBlockSpan(first.find((block) => block.id === "instrument")!), 4);
  assert.equal(formBlockSpan(first.find((block) => block.id === "matning")!), 12, "a table is always the whole row");
  // A level 2 heading at the top starts a section with its title.
  const withHeading = normalizeFormDocument({ schema: 1, blocks: [{ id: "x", type: "text", text: "Intro" }, { id: "h2", type: "heading", text: "Mätning", level: 2 }, { id: "y", type: "text", text: "Mät" }] });
  assert.deepEqual(withHeading.blocks.map((section) => [section.title, section.blocks.map((block) => block.id)]), [["", ["x"]], ["Mätning", ["y"]]]);
});

test("form editor: insert, move across sections, drag to a place, duplicate with unique keys and remove", () => {
  let document = sample();
  // Library blocks land after the selected block, or last in a selected section.
  assert.deepEqual(insertionPoint(document, "a"), { sectionId: document.blocks[0].id, index: 1 });
  assert.deepEqual(insertionPoint(document, "s2"), { sectionId: "s2", index: 1 });
  const added = createBlock("measurement", document);
  assert.equal(added.type === "field" && added.key, "mätvärde");
  document = insertBlock(document, added, insertionPoint(document, "a"));
  assert.deepEqual(ids(document), [["a", added.id, "b"], ["c"]]);
  // A second block from the same library entry gets a unique short name.
  const second = createBlock("measurement", document);
  assert.equal(second.type === "field" && second.key, "mätvärde_2");

  // The buttons move within a section and continue into the neighbouring section at the edge.
  document = moveBlock(document, "b", 1);
  assert.deepEqual(ids(document), [["a", added.id], ["b", "c"]]);
  document = moveBlock(document, "b", -1);
  assert.deepEqual(ids(document), [["a", added.id, "b"], ["c"]]);
  assert.equal(moveBlock(document, "a", -1), document, "the first block cannot move further up");

  // Drag and drop: to a place in another section and downwards in the same section.
  document = moveBlockTo(document, "a", "s2", 1);
  assert.deepEqual(ids(document), [[added.id, "b"], ["c", "a"]]);
  document = moveBlockTo(document, added.id, document.blocks[0].id, 2);
  assert.deepEqual(ids(document), [["b", added.id], ["c", "a"]]);
  document = moveSectionTo(document, "s2", 0);
  assert.equal(document.blocks[0].id, "s2");

  const copy = duplicateBlock(document, "c");
  const copied = copy.document.blocks[0].blocks[1];
  assert.equal(copied.id, copy.newId);
  assert.ok(copied.type === "field" && copied.key === "u_2" && copied.label === "Spänning (kopia)");
  const sectionCopy = duplicateBlock(copy.document, "s2");
  assert.equal(sectionCopy.document.blocks.length, 3);
  assert.deepEqual(validateFormDocument(sectionCopy.document).issues, [], "a duplicated section keeps every short name unique");

  document = removeBlock(document, "a");
  assert.equal(locate(document, "a"), null);
  let onlyOne = emptyEditorDocument();
  onlyOne = removeBlock(onlyOne, onlyOne.blocks[0].id);
  assert.equal(onlyOne.blocks.length, 1, "the document always keeps one section");

  // A new section after a block takes the blocks below it along, like a new chapter.
  const split = insertSection(sample(), { ...emptySection("Nytt"), id: "s-new" }, "a");
  assert.deepEqual(ids(split), [["a"], ["b"], ["c"]]);
  assert.equal(updateBlock(split, "s-new", { title: "Ändrat" }).blocks[1].title, "Ändrat");
  assert.equal((updateBlock(split, "b", { label: "Datum och tid" }).blocks[1].blocks[0] as { label: string }).label, "Datum och tid");

  // The first Avsnitt in a new form takes over its empty, untitled section instead of leaving it empty above.
  const fresh = insertSection(emptyEditorDocument(), { ...emptySection("Grunduppgifter"), id: "s-first" });
  assert.deepEqual(fresh.blocks.map((section) => section.id), ["s-first"]);
  const next = insertSection(fresh, { ...emptySection("Mätningar"), id: "s-second" }, "s-first");
  assert.deepEqual(next.blocks.map((section) => section.id), ["s-first", "s-second"], "an empty section with a title stays");
});

test("form editor: undo and redo, with typing in one property grouped into one step", () => {
  let history = createHistory("a");
  history = recordHistory(history, "ab", "label:x", 1000);
  history = recordHistory(history, "abc", "label:x", 1500);
  history = recordHistory(history, "abcd", "label:x", 2600);
  assert.deepEqual(history.past, ["a", "abc"]);
  history = undoHistory(history);
  assert.equal(history.present, "abc");
  history = undoHistory(history);
  assert.equal(history.present, "a");
  assert.equal(undoHistory(history), history);
  history = redoHistory(history);
  assert.equal(history.present, "abc");
  history = recordHistory(history, "new", null, 5000);
  assert.deepEqual(history.future, [], "a new change clears redo");
  for (let index = 0; index < 150; index++) history = recordHistory(history, `v${index}`, null, 10_000 + index * 1000);
  assert.equal(history.past.length, 100);
});

test("form document schema 2: defaults, hard validation, deviating options, hidden blocks and cycles on their blocks", () => {
  const document = formDocumentSchema.parse({ schema: 2, blocks: [{ id: "s", type: "section", title: "Allmänt", blocks: [
    { id: "v", type: "field", key: "volt", label: "Spänning", input: "number", unit: "V", defaultValue: "230", allowedMin: 0, allowedMax: 1000, decimals: 1, required: true },
    { id: "k", type: "field", key: "klass", label: "Klass", input: "choice", options: ["A", "B", "C"], deviationOptions: ["C"], defaultValue: "A" },
    { id: "d", type: "field", key: "tid", label: "Tid", input: "datetime" },
    { id: "hidden", type: "field", key: "intern", label: "Intern", input: "text", required: true, visibility: { task: false, pdf: true } },
    { id: "p", type: "pagebreak" },
  ] }] });
  const values = initialFormValues(document);
  assert.equal(values.fields.volt, 230);
  assert.equal(values.fields.klass, "A");
  let completion = formCompletion(document, values);
  assert.ok(completion.ready, JSON.stringify(completion.issues));
  assert.ok(!completion.requirements.some((item) => item.blockId === "hidden"), "a block hidden in the task is never a requirement");
  values.fields.volt = "1200";
  completion = formCompletion(document, values);
  assert.match(completion.issues.map((item) => item.message).join(), /Spänning: ange ett värde mellan 0 och 1000 V/);
  values.fields.volt = "230,25";
  assert.match(formCompletion(document, values).issues.map((item) => item.message).join(), /högst 1 decimaler/);
  values.fields.volt = "abc";
  assert.match(formCompletion(document, values).issues.map((item) => item.message).join(), /ange ett tal/);
  values.fields.volt = "230";
  values.fields.klass = "C";
  assert.match(evaluateForm(document, values).deviations.map((item) => item.message).join(), /Klass: C är en avvikelse/);

  const cyclic = formDocumentSchema.parse({ schema: 2, blocks: [{ id: "s", type: "section", blocks: [
    { id: "x", type: "computed", key: "x", label: "X", formula: "y + 1" },
    { id: "y", type: "computed", key: "y", label: "Y", formula: "x + 1" },
    { id: "z", type: "computed", key: "z", label: "Z", formula: "x + 1" },
  ] }] });
  const issues = validateFormDocument(cyclic).issues.filter((item) => /Cirkelreferens/.test(item.message));
  assert.deepEqual(issues.map((item) => item.blockId).sort(), ["x", "y"], "the cycle points at the blocks in it, not at z");
  assert.match(validateFormDocument({ schema: 2, blocks: [{ id: "s", type: "section", blocks: [{ id: "k", type: "field", key: "k", label: "K", input: "choice", options: ["A"], defaultValue: "B" }] }] }).issues.map((item) => item.message).join(), /standardvärdet finns inte bland alternativen/);
  assert.ok(validateFormDocument({ schema: 2, blocks: Array.from({ length: 4 }, (_, section) => ({ id: `s${section}`, type: "section", blocks: Array.from({ length: 80 }, (_, index) => ({ id: `t${section}-${index}`, type: "text", text: "x" })) })) }).issues.length > 0, "at most 300 blocks in total, also inside sections");
});

test("publish checks: errors stop publishing, warnings can be accepted, and changes are listed in plain language", () => {
  const empty = formPublishChecks({ name: "" , allowStandalone: false, allowInProject: false }, emptyEditorDocument());
  const messages = empty.errors.map((item) => item.message).join("\n");
  assert.match(messages, /Ange formulärets namn/);
  assert.match(messages, /fristående, i projekt eller båda/);
  assert.match(messages, /minst ett fält att fylla i/);

  const document = sample();
  document.blocks[1].blocks.push(leaf({ id: "sig", type: "signature", key: "sign", label: "Utförd av", required: true, visibility: { task: true, pdf: false } }));
  document.blocks[1].blocks.push(leaf({ id: "pb", type: "pagebreak" }));
  document.blocks[0].blocks[0] = leaf({ ...document.blocks[0].blocks[0], required: true, visibility: { task: false, pdf: true } });
  const checks = formPublishChecks({ name: "Serviceprotokoll" }, document, normalizeFormDocument({ schema: 2, blocks: [{ id: "s", type: "section", blocks: [{ id: "c", type: "field", key: "spanning", label: "Spänning", input: "number" }] }] }));
  assert.deepEqual(checks.errors.map((item) => item.blockId).sort(), ["a", "sig"]);
  const warnings = checks.warnings.map((item) => item.message).join("\n");
  assert.match(warnings, /sidbrytning sist/);
  assert.match(warnings, /interna koden ändras från spanning till u/);
  assert.deepEqual(formPublishChecks({ name: "Isolationsmätning" }, isolationMeasurementForm).errors, []);
  assert.equal(formDisplayName({ name: "Isolationsmätning", displayName: "" }), "Isolationsmätning");

  assert.deepEqual(diffFormVersions(null, { meta: {}, document }).map((item) => item.kind), ["added"]);
  const next = structuredClone(document);
  next.blocks[0].blocks[1] = leaf({ ...next.blocks[0].blocks[1], label: "Provdatum", required: true });
  next.blocks[1].blocks = next.blocks[1].blocks.filter((block) => block.id !== "c");
  next.blocks[1].blocks.unshift(createBlock("yesno", next));
  const changes = diffFormVersions({ meta: { name: "A" }, document }, { meta: { name: "B" }, document: next }).map((item) => item.text);
  assert.ok(changes.includes("Namn ändrad."));
  assert.ok(changes.includes("Ändrat: Provdatum (etikett, obligatoriskt)."), changes.join("\n"));
  assert.ok(changes.includes("Borttaget: Spänning."));
  assert.ok(changes.includes("Nytt: Kontrollpunkt."));
  assert.deepEqual(diffFormVersions({ meta: {}, document: isolationMeasurementForm }, { meta: {}, document: isolationMeasurementForm }), []);
});

test("PDF: a schema 2 form with sections, Halv width, a page break, a hidden block and a checklist renders", async () => {
  const document = formDocumentSchema.parse({ schema: 2, blocks: [
    { id: "s1", type: "section", title: "Kunduppgifter", blocks: [
      { id: "a", type: "field", key: "kund", label: "Kund", input: "text", width: "quarter" },
      { id: "a2", type: "field", key: "ort", label: "Ort", input: "text", width: "quarter" },
      { id: "b", type: "field", key: "tid", label: "Datum och tid", input: "datetime", width: "half" },
      { id: "h", type: "text", text: "Visas bara i uppgiften.", visibility: { task: true, pdf: false } },
      { id: "p", type: "pagebreak" },
    ] },
    { id: "s2", type: "section", title: "Kontroll", newPage: true, blocks: [
      { id: "c", type: "checklist", key: "lista", label: "Checklista", items: [{ id: "i1", text: "Skyltning" }, { id: "i2", text: "Jordning" }] },
      { id: "t", type: "table", key: "matning", label: "Mätning", rowMode: "fixed", fixedRows: Array.from({ length: 60 }, (_, index) => `Punkt ${index + 1}`), columns: [{ id: "k", key: "varde", label: "Värde", input: "number", unit: "MΩ" }] },
      { id: "sig", type: "signature", key: "sign", label: "Utförd av", width: "half" },
    ] },
  ] });
  const values = initialFormValues(document);
  values.fields.kund = "Brf Kopparlunden";
  values.fields.tid = "2026-09-28T10:15";
  values.checklists.lista = { i1: { state: "OK", comment: "" }, i2: { state: "NOT_OK", comment: "Saknas i garaget" } };
  assert.equal(formLeafBlocks(document).length, 8);
  const bytes = await createWorkflowPdfReport({
    company: "Exempelföretag", fontBytes: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")), options: defaultWorkflowReportOptions,
    tasks: [{ id: "p1", kind: "FORM", title: "Egenkontroll", description: "", status: "IN_PROGRESS", progress: 40, assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
      data: { kind: "FORM", details: { templateName: "Egenkontroll", templateVersion: 1, document, values } } }],
  });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  assert.ok(pages >= 3, `the page break, the new-page section and the long table give several pages (got ${pages})`);
});
