import assert from "node:assert/strict";
import test from "node:test";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { emptyFormValues, evaluateForm, formApprovalTotals, formLeafBlocks, type FormSection } from "../lib/workflow/form-document";

// Autobedömning is always on (2026-10-02): the rule judges every measured value against its limit. A value that
// does not reach it stays "inte godkänd", but the control is still carried out and is completed with a comment.
test("the rule always judges a measured value, and a failing value stays failed", () => {
  const document = kfidFormDocument;
  const iso = document.blocks.find((block): block is FormSection => block.type === "section" && block.id === "kfid-iso")!;
  const table = formLeafBlocks(document).find((block) => block.type === "table" && block.key === "iso")!;
  const values = emptyFormValues();
  values.sections = { ...values.sections, [iso.id]: true };
  values.tables.iso = [
    { id: "r1", label: "", example: false, cells: { objekt: "Krets 1", u: "500 V", mohm: 250, limit: 1, ok: false } },
    { id: "r2", label: "", example: false, cells: { objekt: "Krets 2", u: "500 V", mohm: 300, limit: 1, ok: false } },
  ] as never;
  const auto = evaluateForm(document, values);
  assert.equal(auto.cells.iso.r1.ok, true, "the rule judges 250 MΩ ≥ 1 MΩ as approved without any tick");
  assert.equal(auto.deviations.filter((item) => item.key === "iso").length, 0);
  assert.deepEqual(formApprovalTotals(document, values, auto).find((item) => item.blockId === table.id), { blockId: table.id, title: "Isolation", ok: 2, total: 2 });
  values.tables.iso[0].cells.mohm = 0.5;
  assert.deepEqual(evaluateForm(document, values).deviations.filter((item) => item.key === "iso").map((item) => item.message), ["Isolation, Krets 1: inte godkänd."]);
});
