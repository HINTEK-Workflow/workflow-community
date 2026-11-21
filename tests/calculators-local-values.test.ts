import assert from "node:assert/strict";
import test from "node:test";
import { localCalcValuesState, localCompanyValuesSnapshot, publishLocalCompanyValues, saveLocalCalcValues, type LocalCompanyValues } from "../features/calculators/company-calc-values";
import { CALC_KEYS, companyCalcData, deviceKey } from "../lib/calculators/company-data";
import type { CompanyValue, CompanyValueInput } from "../lib/workflow/company-values";
import { createLocalWorkspace, saveLocalCompanyValues } from "../features/kfid/local-workspace-store";

/**
 * Local (fixed 2026-10-12): the Kalkylator gets the company's values from the open file, which the Local workspace
 * publishes when a file is opened and after every change, and its Företagets värden writes to the file the same way as
 * Inställningar → Värden och referenser.
 */
const input = (key: string, fields: Partial<CompanyValueInput>): CompanyValueInput => ({ key, low: null, high: null, warnLow: null, warnHigh: null, source: "", reference: "", ...fields });

test("Local without an open file: the calculators say so and cannot save", async () => {
  const state = localCalcValuesState(null);
  assert.equal(state.status, "closed");
  assert.equal(state.canEdit, false);
  assert.deepEqual(state.values, []);
  await assert.rejects(saveLocalCalcValues(null, []), /Öppna den lokala arbetsytan/);
});

test("Local with an open file: only the calculator values, and canEdit follows the writer", async () => {
  const workspace = saveLocalCompanyValues(createLocalWorkspace({ id: "org", name: "Firma" }), [
    input(CALC_KEYS.dropLimit, { high: 4, source: "Egen rutin" }),
    input("isolation_min", { low: 1 }),
  ], "Ägaren");
  const readOnly = localCalcValuesState({ values: workspace.companyValues, save: null });
  assert.equal(readOnly.status, "ready");
  assert.equal(readOnly.canEdit, false);
  assert.deepEqual(readOnly.values.map((value) => value.key), [CALC_KEYS.dropLimit]);
  assert.equal(companyCalcData(readOnly.values).dropLimitPct?.value, 4);
  await assert.rejects(saveLocalCalcValues({ values: workspace.companyValues, save: null }, []), /företagsadministratör/);
});

test("Local save writes through the file's writer and the published values follow", async () => {
  let file = createLocalWorkspace({ id: "org", name: "Firma" });
  // What LocalWorkspace publishes: the file's values and a writer that saves the file and publishes again.
  const publish = () => {
    const source: LocalCompanyValues = {
      values: file.companyValues,
      save: async (inputs) => { file = saveLocalCompanyValues(file, inputs, "Ägaren"); publish(); return file.companyValues; },
    };
    publishLocalCompanyValues(source);
  };
  publish();
  assert.equal(localCalcValuesState(localCompanyValuesSnapshot()).canEdit, true);
  assert.deepEqual(localCalcValuesState(localCompanyValuesSnapshot()).values, []);

  await saveLocalCalcValues(localCompanyValuesSnapshot(), [input(deviceKey("c", 16, 0.4), { low: 16, high: 160, source: "Tillverkarens data" })]);
  const after = localCalcValuesState(localCompanyValuesSnapshot());
  assert.equal(after.status, "ready");
  const devices = companyCalcData(after.values).devices;
  assert.equal(devices.length, 1);
  assert.equal(devices[0]?.tripA, 160);
  assert.equal(file.companyValues.find((value: CompanyValue) => value.key === deviceKey("c", 16, 0.4))?.updatedByName, "Ägaren");

  publishLocalCompanyValues(null);
  assert.equal(localCalcValuesState(localCompanyValuesSnapshot()).status, "closed");
});

test("publishing the same values and writer again does not notify the page", () => {
  const values: CompanyValue[] = [];
  const save = async () => values;
  publishLocalCompanyValues({ values, save });
  const first = localCompanyValuesSnapshot();
  publishLocalCompanyValues({ values, save });
  assert.equal(localCompanyValuesSnapshot(), first);
  publishLocalCompanyValues(null);
});
