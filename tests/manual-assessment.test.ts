import assert from "node:assert/strict";
import test from "node:test";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { emptyFormValues, evaluateForm, formApprovalTotals, formLeafBlocks, type FormSection } from "../lib/workflow/form-document";

// Totalkontrollen F7 (2026-09-29): with Autobedömning off, an unticked Godkänd is an assessment not made – empty in the
// report (never a red "Ej godkänd"), not counted as approved, and reported as "inte bedömd" until someone takes a stand.
test("an unticked Godkänd by hand is not assessed, not a failure", () => {
  const document = kfidFormDocument;
  const iso = document.blocks.find((block): block is FormSection => block.type === "section" && block.id === "kfid-iso")!;
  const table = formLeafBlocks(document).find((block) => block.type === "table" && block.key === "iso")!;
  const values = emptyFormValues();
  values.fields.auto = "NO";
  values.sections = { ...values.sections, [iso.id]: true };
  values.tables.iso = [
    { id: "r1", label: "", example: false, cells: { objekt: "Krets 1", u: "500 V", mohm: 250, limit: 1, ok: false } },
    { id: "r2", label: "", example: false, cells: { objekt: "Krets 2", u: "500 V", mohm: 300, limit: 1, ok: true } },
  ] as never;
  const manual = evaluateForm(document, values);
  assert.equal(manual.cells.iso.r1.ok, null, "unticked by hand = not assessed");
  assert.equal(manual.cells.iso.r2.ok, true);
  const deviations = manual.deviations.filter((item) => item.key === "iso");
  assert.deepEqual(deviations.map((item) => item.message), ["Isolation, Krets 1: inte bedömd."]);
  assert.deepEqual(formApprovalTotals(document, values, manual).find((item) => item.blockId === table.id), { blockId: table.id, title: "Isolation", ok: 1, total: 2 });

  values.fields.auto = "YES";
  const auto = evaluateForm(document, values);
  assert.equal(auto.cells.iso.r1.ok, true, "the rule judges 250 MΩ ≥ 1 MΩ as approved");
  assert.equal(auto.deviations.filter((item) => item.key === "iso").length, 0);
  values.tables.iso[0].cells.mohm = 0.5;
  assert.deepEqual(evaluateForm(document, values).deviations.filter((item) => item.key === "iso").map((item) => item.message), ["Isolation, Krets 1: inte godkänd."]);
});
