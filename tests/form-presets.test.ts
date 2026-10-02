import assert from "node:assert/strict";
import test from "node:test";
import { evaluateForm, formCompletion, formLeafBlocks, validateFormDocument, type FormFieldBlock } from "../lib/workflow/form-document";
import { createBlock, emptyEditorDocument, insertBlock, insertSection, type EditorDocument } from "../lib/workflow/form-editor";
import { createPreset, PRESET_LIBRARY, PRESET_TYPES } from "../lib/workflow/form-presets";
import { canvasValues } from "../lib/workflow/form-sample";

function withPreset(document: EditorDocument, type: (typeof PRESET_TYPES)[number]): EditorDocument {
  const preset = createPreset(type, document);
  return preset.kind === "section" ? insertSection(document, preset.section, null) : insertBlock(document, preset.block);
}

test("ready-made control blocks: every preset in the ribbon inserts a valid block or moment into an empty form", () => {
  assert.deepEqual(PRESET_LIBRARY.map((item) => item.type), [...PRESET_TYPES]);
  assert.ok(PRESET_LIBRARY.every((item) => item.group === "Kontroll" && item.label.length <= 12), "short names so the ribbon stays readable");
  let document = emptyEditorDocument();
  for (const type of PRESET_TYPES) document = withPreset(document, type);
  assert.deepEqual(validateFormDocument(document).issues, [], "the presets publish without issues");
  // The six moments of the control came as sections that can be switched on and off; the three others as blocks.
  const moments = document.blocks.filter((section) => section.optional).map((section) => section.title);
  assert.deepEqual(moments, ["Isolation", "Kontinuitet", "Spänningsprovning", "Jordfelsbrytarprov", "Automatisk frånkoppling", "Visuell kontroll"]);
  const tables = formLeafBlocks(document).filter((block) => block.type === "table");
  assert.deepEqual(tables.map((table) => table.label), ["Isolation", "Kontinuitet", "Spänningsprovning", "Jordfelsbrytarprov", "Automatisk frånkoppling", "Identifierade risker", "Mätrader", "Objekt"]);
  // Fresh ids everywhere: nothing points back into the original's ids.
  assert.ok(formLeafBlocks(document).every((block) => !block.id.startsWith("kfid-") && !block.id.startsWith("risk-")));
  assert.ok(tables.every((table) => table.columns.every((column) => !column.id.startsWith("kfid-") && !column.id.startsWith("risk-"))));
});

test("ready-made control blocks: JFB-prov keeps the control's two-line rows and its rule; without Autobedömning Godkänd follows the rule by itself", () => {
  const preset = createPreset("kfid_rcd", emptyEditorDocument());
  assert.equal(preset.kind, "section");
  if (preset.kind !== "section") return;
  assert.equal(preset.section.title, "Jordfelsbrytarprov");
  assert.equal(preset.section.optional, true);
  const table = preset.section.blocks.find((block) => block.type === "table");
  assert.ok(table && table.type === "table");
  if (!table || table.type !== "table") return;
  assert.equal(table.taskLayout, "rows");
  assert.equal(table.layout, "cards");
  assert.deepEqual(table.columns.filter((column) => column.line === 2).map((column) => column.key), ["place", "t1p", "t1n", "t5p", "t5n", "uc", "ntrip05", "btnok"]);
  const approved = table.columns.find((column) => column.input === "assessment")!;
  assert.equal(approved.mode, "auto", "no Autobedömning switch in the form: decided by the rule");
  assert.equal(approved.switchKey, "");
  assert.ok(table.columns.filter((column) => column.key.startsWith("t1") || column.key.startsWith("t5")).every((column) => column.requiredIf === "" && column.required));
  // The rule still works: a trip time over the profile's limit is a deviation.
  const document = insertSection(emptyEditorDocument(), preset.section, null);
  const values = canvasValues(document);
  const row = values.tables[table.key][0];
  row.cells = { ...row.cells, place: "JFB1", std: "EN", type: "A", idn: 30, t1p: 500, t1n: 200, t5p: 20, t5n: 20, btnok: true };
  const evaluation = evaluateForm(document, values);
  assert.ok(evaluation.deviations.some((item) => item.key === table.key), "500 ms at 1× IΔn fails the EN profile's 300 ms");
});

test("ready-made control blocks: with the control's Autobedömning in the form, Godkänd and the time requirements follow that switch", () => {
  let document = emptyEditorDocument();
  const auto: FormFieldBlock = { ...(createBlock("yesno", document) as FormFieldBlock), key: "auto", label: "Autobedömning", momentSwitch: true };
  document = insertBlock(document, auto);
  const preset = createPreset("kfid_iso", document);
  if (preset.kind !== "section") throw new Error("expected a moment");
  const table = preset.section.blocks.find((block) => block.type === "table");
  if (!table || table.type !== "table") throw new Error("expected a table");
  const approved = table.columns.find((column) => column.input === "assessment")!;
  assert.equal(approved.mode, "switch");
  assert.equal(approved.switchKey, "auto");
  document = insertSection(document, preset.section, null);
  assert.deepEqual(validateFormDocument(document).issues, []);
});

test("ready-made control blocks: the same preset twice gets unique short names, so two isolation moments can live in one form", () => {
  let document = withPreset(emptyEditorDocument(), "kfid_iso");
  document = withPreset(document, "kfid_iso");
  const keys = formLeafBlocks(document).flatMap((block) => ("key" in block ? [block.key] : []));
  assert.deepEqual(keys, ["iso", "iso_bilder", "iso_2", "iso_bilder_2"]);
  assert.equal(new Set(formLeafBlocks(document).map((block) => block.id)).size, 4);
  assert.deepEqual(validateFormDocument(document).issues, []);
});

test("the sheet is drawn with every moment on and one fresh row per table, so measurement rows and object cards show their real look", () => {
  let document = withPreset(emptyEditorDocument(), "kfid_cont");
  document = withPreset(document, "risk_table");
  const values = canvasValues(document);
  assert.ok(document.blocks.filter((section) => section.optional).every((section) => values.sections[section.id] === true));
  for (const table of formLeafBlocks(document).filter((block) => block.type === "table")) {
    assert.equal(values.tables[table.key].length, 1, `${table.label} shows one row`);
    assert.equal(values.tables[table.key][0].example, undefined, "a plain row, not the example row");
  }
  // Nothing typed in: the requirements are still open, exactly as a new protocol.
  assert.equal(formCompletion(document, values).ready, false);
});
