import assert from "node:assert/strict";
import test from "node:test";
import { formCompletion, initialFormValues } from "../lib/workflow/form-document";
import { isolationMeasurementForm } from "../lib/workflow/form-examples";
import { formCompletionShown } from "../lib/workflow/task-model";
import { remapSectionAnchors } from "../lib/self-inspection/outline";
import { INSTRUMENT_ORDER_MESSAGE, selfInspectionActionSchema } from "../lib/self-inspection/model";

test("KTR-02: a protocol nobody has touched says 0 %, however much the form fills in by itself", () => {
  const values = initialFormValues(isolationMeasurementForm);
  const shown = formCompletionShown(isolationMeasurementForm, values);
  assert.equal(shown.percent, 0);
  assert.equal(shown.requirements.length, formCompletion(isolationMeasurementForm, values).requirements.length, "the requirements are untouched");
  Object.assign(values.fields, { instrument: "IT-200" });
  values.signatures.utford = { name: "Elon", confirmed: true, signedAt: null };
  assert.ok(formCompletionShown(isolationMeasurementForm, values).percent > 0, "something documented counts again");
});

test("KTR-07: an instrument's next calibration must lie after the last one", () => {
  const save = (calibratedAt: string | null, nextCalibrationAt: string | null) => selfInspectionActionSchema.safeParse({ action: "save_instrument", instrument: { name: "Mätare", calibratedAt, nextCalibrationAt } });
  const bad = save("2026-10-01", "2025-01-01");
  assert.equal(bad.success, false);
  assert.equal(bad.error?.issues[0].message, INSTRUMENT_ORDER_MESSAGE);
  assert.equal(save("2026-10-01", "2026-10-01").success, false);
  assert.equal(save("2026-10-01", "2027-10-01").success, true);
  assert.equal(save(null, "2025-01-01").success, true, "one date alone is nothing to compare");
});

test("Egenkontroll: open parts and check marks follow their section after an unsaved move", () => {
  const saved = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const moved = [{ id: "b" }, { id: "a" }, { id: "c" }, { id: undefined }];
  const items = [{ anchor: "si-section-0", n: 1 }, { anchor: "si-section-1", n: 2 }, { anchor: "si-facts", n: 3 }];
  assert.deepEqual(remapSectionAnchors(items, saved, moved).map((item) => item.anchor), ["si-section-1", "si-section-0", "si-facts"]);
  assert.deepEqual(remapSectionAnchors(items, saved, [{ id: "b" }]).map((item) => item.anchor), ["si-section-0", "si-facts"], "a removed section has no marks");
});
