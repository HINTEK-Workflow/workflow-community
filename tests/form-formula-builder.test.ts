import assert from "node:assert/strict";
import test from "node:test";
import { describeFormula, emptySimpleFormula, parseSimpleFormula, simpleFormulaText } from "../lib/workflow/form-formula-builder";
import { evaluateForm, formCompletion } from "../lib/workflow/form-document";
import { isolationMeasurementForm } from "../lib/workflow/form-examples";
import { sampleFormValues } from "../lib/workflow/form-sample";

const labels: Record<string, string> = { u: "Spänning", i: "Ström", sannolikhet: "Sannolikhet", konsekvens: "Konsekvens", uppmatt: "Uppmätt", grans: "Gräns", "matning.uppmatt": "Uppmätt (Mätning)", godkand: "Godkänd" };
const labelOf = (name: string) => labels[name];

test("visual formulas: the examples round-trip through the simple shape and read as plain Swedish", () => {
  const effect = parseSimpleFormula("u * i");
  assert.deepEqual(effect?.terms, [{ kind: "ref", name: "u" }, { kind: "ref", name: "i" }]);
  assert.equal(simpleFormulaText(effect!), "u * i");
  assert.equal(describeFormula("u * i", labelOf), "Spänning × Ström");
  assert.equal(describeFormula("sannolikhet * konsekvens", labelOf), "Sannolikhet × Konsekvens");

  const row = parseSimpleFormula("[uppmatt] >= [grans]");
  assert.deepEqual(row?.compare, { op: ">=", right: { kind: "cell", name: "grans" } });
  assert.equal(describeFormula("[uppmatt] >= [grans]", labelOf), "Uppmätt ≥ Gräns");

  const result = parseSimpleFormula("OM(MIN(matning.uppmatt) >= 1,0; \"Godkänd\"; \"Avvikelse\")");
  assert.deepEqual(result?.terms, [{ kind: "aggregate", fn: "MIN", name: "matning.uppmatt" }]);
  assert.deepEqual(result?.result, { then: "Godkänd", otherwise: "Avvikelse" });
  assert.equal(simpleFormulaText(result!), "OM(MIN(matning.uppmatt) >= 1; \"Godkänd\"; \"Avvikelse\")");
  assert.equal(describeFormula("OM(MIN(matning.uppmatt) >= 1; \"Godkänd\"; \"Avvikelse\")", labelOf), "om lägsta av Uppmätt (Mätning) ≥ 1: ”Godkänd”, annars ”Avvikelse”");

  // Parentheses that change the order, other functions and invalid text stay as advanced formulas.
  assert.equal(parseSimpleFormula("(u + i) * 2"), null);
  assert.equal(describeFormula("(u + i) * 2", labelOf), "(Spänning + Ström) × 2");
  assert.equal(parseSimpleFormula("AVRUNDA(u; 2)"), null);
  assert.equal(parseSimpleFormula("u +"), null);
  assert.equal(describeFormula("u +", labelOf), "u +", "an invalid formula is shown as written");
  assert.equal(simpleFormulaText(emptySimpleFormula({ kind: "ref", name: "u" })), "u");
});

test("example answers: without deviations the example form is ready; with deviations it shows them", () => {
  const clean = sampleFormValues(isolationMeasurementForm, { today: "2026-09-28" });
  assert.equal(clean.fields.provdatum, "2026-09-28");
  assert.equal(evaluateForm(isolationMeasurementForm, clean).deviations.length, 0);
  assert.equal(formCompletion(isolationMeasurementForm, clean).ready, true, JSON.stringify(formCompletion(isolationMeasurementForm, clean).issues));
  const bad = sampleFormValues(isolationMeasurementForm, { deviations: true });
  const deviations = evaluateForm(isolationMeasurementForm, bad).deviations;
  assert.ok(deviations.some((item) => /N–PE/.test(item.message)), JSON.stringify(deviations));
  assert.equal(formCompletion(isolationMeasurementForm, bad).ready, true, "the example comment covers the deviations");
});
