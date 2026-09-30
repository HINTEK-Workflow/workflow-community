import assert from "node:assert/strict";
import test from "node:test";
import { balancedFormWidths, type FormWidth } from "../lib/workflow/form-document";

// Daniel 2026-09-30: "fält upplevs rörigt arrangerade" – rows with a gap are shared evenly so the fields line up.
const fields = (...widths: FormWidth[]) => widths.map((width) => ({ width, field: true }));

test("Termografering's Mätförutsättningar become full rows of thirds and halves", () => {
  // Mättillfälle, kamera, serienummer | kalibrering, emissivitet, reflekterad | omgivning, fukt, miljö | driftläge,
  // kapslingar | bedömningsgrund, utgåva | övriga.
  const widths = balancedFormWidths(fields("third", "third", "third", "third", "quarter", "quarter", "quarter", "quarter", "quarter", "third", "third", "half", "half", "full"));
  assert.deepEqual(widths, ["third", "third", "third", "third", "third", "third", "third", "third", "third", "half", "half", "half", "half", "full"]);
});

test("full rows, single blocks, five fields and rows with tables keep the widths they were built with", () => {
  assert.deepEqual(balancedFormWidths(fields("half", "quarter", "quarter")), ["half", "quarter", "quarter"]);
  assert.deepEqual(balancedFormWidths(fields("half", "full")), ["half", "full"]);
  assert.deepEqual(balancedFormWidths(fields("quarter", "quarter", "quarter", "quarter", "full")), ["quarter", "quarter", "quarter", "quarter", "full"]);
  assert.deepEqual(balancedFormWidths([{ width: "third", field: true }, { width: "half", field: false }]), ["third", "half"]);
  assert.deepEqual(balancedFormWidths(fields("two_thirds")), ["two_thirds"]);
  assert.deepEqual(balancedFormWidths([]), []);
});
