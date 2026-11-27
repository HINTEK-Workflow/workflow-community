import assert from "node:assert/strict";
import test from "node:test";
import { AMPACITY_SLOTS, ampacityFor, ampacityKey, areaKeyPart, CALC_KEYS, companyCalcData, emptyCompanyCalcData, isCalculatorKey } from "../lib/calculators/company-data";
import { freeSlot, mergeRows, modelFromValues, parsePastedRows, saveInputs, SINGLE_FIELDS, sameModel, type PanelModel } from "../lib/calculators/company-values-edit";
import { noteText, quantityParts, quantityText, REMINDER, resultText } from "../lib/calculators/present";
import { CALCULATORS, calculatorById, registryProblems } from "../lib/calculators/registry";
import { initialState, resolveChoices, runModule, withChoice, withText } from "../lib/calculators/run";
import { defineCalculator } from "../lib/calculators/define";
import type { CalcModule, Choices, Outcome } from "../lib/calculators/types";
import { companyValueKeySchema, mergeCompanyValues, type CompanyValue, type CompanyValueInput } from "../lib/workflow/company-values";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalCompanyValues } from "../features/kfid/local-workspace-store";

/**
 * Räkneverktyg (2026-10-07): what the calculators read from the company's own values, how the company enters
 * them, and the guards that keep Workflow from delivering a table or a limit of its own.
 */
const value = (key: string, fields: Partial<CompanyValue>): CompanyValue => ({ key, low: null, high: null, warnLow: null, warnHigh: null, source: "", reference: "", version: 1, updatedByName: "", ...fields });
/** The values as the server or the Local file keeps them after a save. */
const apply = (current: CompanyValue[], inputs: CompanyValueInput[]) => mergeCompanyValues(current, inputs, "Admin", "2026-10-07T08:00:00.000Z");
const flat = (text: string) => text.replace(/ /g, " ");

test("the calculators' keys live under kabel., which a form's limit key can never match, and only that namespace may have dots", () => {
  for (const key of [...Object.values(CALC_KEYS), ampacityKey(1, "cu", 2.5), ampacityKey(3, "al", 0.75), ampacityKey(2, "cu", 185)]) assert.ok(companyValueKeySchema.safeParse(key).success, key);
  for (const key of ["foo.bar", "kabel.", "kabel..x", "kabel.iz.1.cu.2_5.extra.more.x", "Ångström.x", "isolation.min"]) assert.ok(!companyValueKeySchema.safeParse(key).success, key);
  assert.ok(companyValueKeySchema.safeParse("isolation_min").success, "an ordinary limit key is unchanged");
  assert.ok(Object.values(CALC_KEYS).every(isCalculatorKey));
  assert.equal(isCalculatorKey("isolation_min"), false);
  assert.equal(ampacityKey(1, "cu", 2.5), "kabel.iz.1.cu.2_5");
  assert.equal(areaKeyPart(0.75), "0_75");
  assert.equal(areaKeyPart(16), "16");
});

test("the company's values become what the tools read: single values in their units, tables sorted, named by their source", () => {
  const values = [
    value(CALC_KEYS.reactance, { high: 0.08, source: "Egen kabelkatalog", reference: "2026" }),
    value(CALC_KEYS.dropLimit, { high: 4 }),
    value(CALC_KEYS.cMax, { high: 1.05 }),
    value(CALC_KEYS.cMin, { high: 0.95 }),
    value(CALC_KEYS.tempMax, { high: 20 }),
    value(CALC_KEYS.tempMin, { high: 80 }),
    value(ampacityKey(1, "cu", 4), { low: 4, high: 30, source: "Kabel i rör", reference: "utg. 2" }),
    value(ampacityKey(1, "cu", 2.5), { low: 2.5, high: 22, source: "Kabel i rör", reference: "utg. 2" }),
    value(ampacityKey(1, "al", 16), { low: 16, high: 60, source: "Kabel i rör", reference: "utg. 2" }),
    value(ampacityKey(2, "cu", 2.5), { low: 2.5, high: 31 }),
    value("isolation_min", { low: 1 }),
  ];
  const data = companyCalcData(values);
  assert.deepEqual(data.reactancePerM, { value: 0.00008, source: "Egen kabelkatalog, 2026" }, "mΩ/m becomes Ω/m");
  assert.equal(data.dropLimitPct?.value, 4);
  assert.deepEqual([data.cMax?.value, data.cMin?.value, data.tempMax?.value, data.tempMin?.value], [1.05, 0.95, 20, 80]);
  assert.equal(data.ampacity.length, 2);
  assert.deepEqual(data.ampacity[0].cu, [{ area: 2.5, amps: 22 }, { area: 4, amps: 30 }], "sorted by area");
  assert.deepEqual(data.ampacity[0].al, [{ area: 16, amps: 60 }]);
  assert.equal(data.ampacity[0].name, "Kabel i rör");
  assert.equal(data.ampacity[0].source, "Kabel i rör, utg. 2");
  assert.equal(data.ampacity[1].name, "Tabell 2", "a table without a source is named by its number");
  assert.equal(ampacityFor(data.ampacity, 1, "cu", 2.5)?.amps, 22);
  assert.equal(ampacityFor(data.ampacity, 2, "cu", 2.5)?.amps, 31);
  assert.equal(ampacityFor(data.ampacity, null, "cu", 2.5)?.amps, 22, "no table chosen: the first one that has the area");
  assert.equal(ampacityFor(data.ampacity, 1, "cu", 3), undefined);
  assert.equal(ampacityFor(data.ampacity, 2, "al", 16), undefined);
});

test("a value that does not make sense is left out as if it had not been entered", () => {
  const data = companyCalcData([
    value(CALC_KEYS.reactance, { high: -1 }), value(CALC_KEYS.dropLimit, { high: 0 }), value(CALC_KEYS.cMax, { high: 0 }), value(CALC_KEYS.tempMax, { high: 900 }),
    value(ampacityKey(1, "cu", 2.5), { low: 2.5, high: null }), value(ampacityKey(1, "cu", 4), { low: null, high: 20 }), value(ampacityKey(1, "cu", 6), { low: -6, high: 20 }),
    value("kabel.iz.4.cu.2_5", { low: 2.5, high: 20 }), value("kabel.iz.1.cu.nonsense", { low: 2.5, high: 20 }),
  ]);
  assert.deepEqual(data, emptyCompanyCalcData());
  assert.equal(AMPACITY_SLOTS, 3);
  // A single value kept only in "Lägst" still counts
  assert.equal(companyCalcData([value(CALC_KEYS.dropLimit, { low: 5 })]).dropLimitPct?.value, 5);
});

test("the panel starts from the stored rows and writes only what changed; an unchanged panel writes nothing", () => {
  const model = modelFromValues([]);
  assert.equal(model.tables.length, 1, "table 1 is always there");
  const result = saveInputs([], model);
  assert.deepEqual(result, { inputs: [] });
  // Entering values
  const edited: PanelModel = {
    ...model, singleSource: "Företagets egen kabelkatalog", singleReference: "2026-10",
    singles: { ...model.singles, [CALC_KEYS.reactance]: "0,08", [CALC_KEYS.dropLimit]: "4" },
    tables: [{ slot: 1, source: "Kabel i rör", reference: "utg. 2", cu: [{ area: "2,5", amps: "22" }, { area: "4", amps: "30" }], al: [{ area: "16", amps: "60" }] }],
  };
  const first = saveInputs([], edited);
  assert.ok("inputs" in first);
  assert.deepEqual(first.inputs.map((input) => input.key).sort(), [CALC_KEYS.dropLimit, CALC_KEYS.reactance, "kabel.iz.1.al.16", "kabel.iz.1.cu.2_5", "kabel.iz.1.cu.4"].sort());
  const reactance = first.inputs.find((input) => input.key === CALC_KEYS.reactance)!;
  assert.deepEqual([reactance.low, reactance.high, reactance.source, reactance.reference], [null, 0.08, "Företagets egen kabelkatalog", "2026-10"]);
  const row = first.inputs.find((input) => input.key === "kabel.iz.1.cu.2_5")!;
  assert.deepEqual([row.low, row.high, row.source, row.reference], [2.5, 22, "Kabel i rör", "utg. 2"]);
  const stored = apply([], first.inputs);
  const data = companyCalcData(stored);
  assert.equal(data.reactancePerM?.value, 0.00008);
  assert.deepEqual(data.ampacity[0].cu, [{ area: 2.5, amps: 22 }, { area: 4, amps: 30 }]);
  // The panel read back from what was stored is the same panel, and saving it again writes nothing
  const again = modelFromValues(stored);
  assert.ok(sameModel(again, modelFromValues(stored)));
  assert.deepEqual(again.tables[0].cu, [{ area: "2,5", amps: "22" }, { area: "4", amps: "30" }]);
  assert.deepEqual(saveInputs(stored, again), { inputs: [] });
  // Changing one number, one area (a new row and the old one removed), the source of the table, and clearing a single value
  const changed: PanelModel = {
    ...again, singles: { ...again.singles, [CALC_KEYS.dropLimit]: "" },
    tables: [{ ...again.tables[0], cu: [{ area: "2,5", amps: "23" }, { area: "6", amps: "40" }] }],
  };
  const second = saveInputs(stored, changed);
  assert.ok("inputs" in second);
  const byKey = new Map(second.inputs.map((input) => [input.key, input]));
  assert.equal(byKey.get("kabel.iz.1.cu.2_5")?.high, 23);
  assert.equal(byKey.get("kabel.iz.1.cu.2_5")?.version, 1, "the stored version travels with the change");
  assert.equal(byKey.get("kabel.iz.1.cu.6")?.high, 40);
  assert.equal(byKey.get("kabel.iz.1.cu.6")?.version, undefined, "a new row has no version");
  assert.deepEqual([byKey.get("kabel.iz.1.cu.4")?.low, byKey.get("kabel.iz.1.cu.4")?.high, byKey.get("kabel.iz.1.cu.4")?.source], [null, null, ""], "a removed row is blank");
  assert.deepEqual([byKey.get("kabel.iz.1.al.16")], [undefined], "an untouched row is not written");
  assert.deepEqual([byKey.get(CALC_KEYS.dropLimit)?.high, byKey.get(CALC_KEYS.dropLimit)?.source], [null, ""], "a cleared single value is removed");
  assert.equal(byKey.get(CALC_KEYS.reactance), undefined);
  const next = companyCalcData(apply(stored, second.inputs));
  assert.deepEqual(next.ampacity[0].cu, [{ area: 2.5, amps: 23 }, { area: 6, amps: 40 }]);
  assert.equal(next.dropLimitPct, undefined);
  // The shared source of the single values reaches every one of them
  const resourced = saveInputs(stored, { ...again, singleSource: "Ny rutin" });
  assert.ok("inputs" in resourced);
  assert.deepEqual(resourced.inputs.map((input) => input.key).sort(), [CALC_KEYS.dropLimit, CALC_KEYS.reactance].sort());
  // Taking a table away altogether removes its rows
  const withTwo = apply(stored, [{ key: "kabel.iz.2.cu.2_5", low: 2.5, high: 31, warnLow: null, warnHigh: null, source: "Annan", reference: "" }]);
  const dropped = saveInputs(withTwo, { ...modelFromValues(withTwo), tables: modelFromValues(withTwo).tables.filter((table) => table.slot !== 2) });
  assert.ok("inputs" in dropped);
  assert.deepEqual(dropped.inputs.map((input) => input.key), ["kabel.iz.2.cu.2_5"]);
});

test("the panel refuses what cannot be stored, and says which row", () => {
  const model = modelFromValues([]);
  const withRows = (cu: { area: string; amps: string }[]): PanelModel => ({ ...model, tables: [{ ...model.tables[0], cu }] });
  const error = (candidate: PanelModel) => { const result = saveInputs([], candidate); assert.ok("error" in result, JSON.stringify(result)); return result.error; };
  assert.equal(error({ ...model, singles: { ...model.singles, [CALC_KEYS.reactance]: "abc" } }), "Reaktans per längd: skriv värdet som ett tal, till exempel 0,08.");
  assert.match(error({ ...model, singles: { ...model.singles, [CALC_KEYS.dropLimit]: "150" } }), /^Gräns för spänningsfall: Gränsen är större än 0 och högst 100 %\.$/);
  assert.match(error({ ...model, singles: { ...model.singles, [CALC_KEYS.cMax]: "0" } }), /Spänningsfaktorn/);
  assert.match(error(withRows([{ area: "2,5", amps: "" }])), /^Tabell 1, koppar: fyll i både area och belastbarhet som tal på varje rad\.$/);
  assert.match(error(withRows([{ area: "2,5", amps: "20" }, { area: "2.5", amps: "21" }])), /^Tabell 1, koppar: arean 2,5 mm² finns två gånger\.$/);
  assert.match(error(withRows([{ area: "-2,5", amps: "20" }])), /större än noll/);
  assert.match(error(withRows(Array.from({ length: 31 }, (_, index) => ({ area: String(index + 1), amps: "10" })))), /högst 30 rader/);
  // Empty rows are skipped
  const result = saveInputs([], withRows([{ area: "", amps: "" }, { area: "2,5", amps: "20" }]));
  assert.ok("inputs" in result && result.inputs.length === 1);
});

test("rows pasted from a spreadsheet: a line of two numbers, in any separator; headings are skipped; the same area replaces the row", () => {
  const pasted = parsePastedRows("Area\tStröm\n1,5\t18\n2,5;24\n4 32\n6   41,5\nsumma\n\n10 mm² 57 A");
  assert.deepEqual(pasted.rows, [{ area: "1,5", amps: "18" }, { area: "2,5", amps: "24" }, { area: "4", amps: "32" }, { area: "6", amps: "41,5" }, { area: "10", amps: "57" }]);
  assert.equal(pasted.skipped, 2);
  assert.deepEqual(mergeRows([{ area: "4", amps: "30" }, { area: "2,5", amps: "20" }], [{ area: "2,5", amps: "24" }, { area: "1,5", amps: "18" }]), [{ area: "1,5", amps: "18" }, { area: "2,5", amps: "24" }, { area: "4", amps: "30" }]);
  assert.deepEqual(mergeRows([{ area: "", amps: "" }], [{ area: "2,5", amps: "24" }]), [{ area: "2,5", amps: "24" }, { area: "", amps: "" }], "a blank row stays last");
  assert.equal(freeSlot(modelFromValues([])), 2);
  assert.equal(freeSlot({ ...modelFromValues([]), tables: [1, 2, 3].map((slot) => ({ slot, source: "", reference: "", cu: [], al: [] })) }), null);
  assert.equal(SINGLE_FIELDS.length, 9);
});

test("the values go through the Local file and the shared merge like any other company value, and survive a reload of the file", () => {
  const organization = { id: "org-local", name: "Lokalt AB" };
  const opened = parseLocalWorkspace(createLocalWorkspace(organization), organization.id);
  const model: PanelModel = { ...modelFromValues([]), singles: { ...modelFromValues([]).singles, [CALC_KEYS.reactance]: "0,09" }, tables: [{ slot: 1, source: "Egen tabell", reference: "", cu: [{ area: "2,5", amps: "20" }], al: [] }] };
  const inputs = saveInputs(opened.companyValues, model);
  assert.ok("inputs" in inputs);
  const saved = saveLocalCompanyValues(opened, inputs.inputs, "Ägaren");
  const reloaded = parseLocalWorkspace(JSON.parse(JSON.stringify(saved)), organization.id);
  const data = companyCalcData(reloaded.companyValues);
  assert.ok(Math.abs((data.reactancePerM?.value ?? 0) - 0.00009) < 1e-15);
  assert.deepEqual(data.ampacity[0].cu, [{ area: 2.5, amps: 20 }]);
  assert.equal(data.ampacity[0].name, "Egen tabell");
});

// ───────────────────────────── Registret ─────────────────────────────

test("the registry is consistent: ids, groups, units, outputs; a broken declaration is found", () => {
  assert.deepEqual(registryProblems(), []);
  const broken = defineCalculator({
    id: "Bad Id", name: " ", summary: "", help: [], outputs: [{ id: "x", label: "X" }, { id: "x", label: "X" }],
    inputs: [{ kind: "number", id: "a", label: "A", dimension: "voltage", defaultUnit: "A" }, { kind: "number", id: "a", label: "A", dimension: "voltage", group: "nowhere" }],
    compute: () => ({ status: "incomplete", message: "" }),
  });
  const problems = registryProblems([broken, broken]);
  for (const part of ["ogiltigt id", "id används två gånger", "namn och sammanfattning krävs", "hjälptext saknas", "indata a finns två gånger", "gruppen nowhere som inte finns", "enheten A som inte hör till dimensionen", "utdata x finns två gånger"]) {
    assert.ok(problems.some((problem) => problem.includes(part)), part);
  }
});

const sample: Record<string, { texts: Record<string, string>; choices?: Choices }> = {
  power: { texts: { u: "400", i: "10", pf: "0,8" } },
  "voltage-drop": { texts: { length: "100", i: "16", area: "2,5" } },
  "short-circuit": { texts: { srcMaxCurrent: "10", srcMinCurrent: "6", length: "50", area: "25" } },
  "cable-area": { texts: { length: "50", i: "16", area: "2,5" } },
  ohm: { texts: { u: "12", i: "2" } },
  energy: { texts: { p: "2,5", hours: "4" } },
};
const sampleOutcome = (tool: CalcModule, company = emptyCompanyCalcData()): Outcome => {
  const ctx = { company };
  const { texts, choices = {} } = sample[tool.id];
  let state = initialState(tool, ctx);
  for (const [id, choice] of Object.entries(choices)) state = withChoice(tool, state, id, choice);
  for (const [id, text] of Object.entries(texts)) state = withText(tool, state, id, text);
  return runModule(tool, state, ctx);
};

test("every tool answers its own example, with every result declared, and nothing a tool gives is empty", () => {
  for (const tool of CALCULATORS) {
    const outcome = sampleOutcome(tool);
    assert.equal(outcome.status, "ok", `${tool.id}: ${JSON.stringify(outcome)}`);
    if (outcome.status !== "ok") continue;
    const declared = new Set(tool.outputs.map((output) => output.id));
    for (const row of outcome.rows) {
      assert.ok(declared.has(row.id), `${tool.id}: ${row.id} is not declared`);
      if (row.kind === "quantity") assert.ok(Number.isFinite(row.value), `${tool.id}: ${row.id}`);
    }
    assert.ok(outcome.steps.length > 0 && outcome.steps.every((step) => step.trim().length > 0), tool.id);
    assert.ok(outcome.rows.some((row) => row.kind === "quantity" && row.primary), `${tool.id} has a main result`);
  }
});

test("copyright precaution: no standard's table or limit is delivered – only the company's values, constants of nature and neutral defaults", () => {
  const company = emptyCompanyCalcData();
  const allowed: Record<string, "suggestion" | "default"> = {
    rho20: "default", alpha: "default", // constants of nature for the chosen material (physics at 20 °C)
    temperature: "default", tempMax: "default", tempMin: "default", cosphi: "default", correction: "default", cMax: "default", cMin: "default", reactance: "default",
  };
  const defaults: Record<string, number> = { temperature: 20, tempMax: 20, tempMin: 20, cosphi: 1, correction: 1, cMax: 1, cMin: 1, reactance: 0 };
  for (const tool of CALCULATORS) {
    for (const input of tool.inputs) {
      if (input.kind !== "number" || !input.fallback) continue;
      for (const phases of ["3", "1"]) for (const material of ["cu", "al"]) {
        const fallback = input.fallback({ phases, material, source: "current" }, { company });
        if (!fallback) continue;
        assert.equal(fallback.origin, allowed[input.id], `${tool.id}.${input.id} may not have a built-in value`);
        if (input.id in defaults) assert.equal(fallback.value, defaults[input.id], `${tool.id}.${input.id}`);
      }
    }
    // A limit, a table, a protective device's data: never filled in without the company's value
    for (const id of ["limit", "ampacity", "breaking", "trip", "price"]) {
      const input = tool.inputs.find((item) => item.id === id);
      if (input?.kind === "number") assert.equal(input.fallback?.({ phases: "3" }, { company }), undefined, `${tool.id}.${id}`);
      if (input?.kind === "number") assert.ok(input.initial === undefined, `${tool.id}.${id} starts empty`);
    }
  }
  // The company's own value does fill the empty field, marked as the company's
  const filled = companyCalcData([value(CALC_KEYS.dropLimit, { high: 4, source: "Egen rutin" }), value(CALC_KEYS.reactance, { high: 0.08 })]);
  const drop = calculatorById("voltage-drop")!;
  const limit = drop.inputs.find((input) => input.id === "limit");
  assert.ok(limit?.kind === "number");
  assert.deepEqual(limit.fallback?.({ phases: "3" }, { company: filled }), { value: 4, origin: "company", note: "Företagets värde (Egen rutin)" });
});

test("copyright precaution: no organisation, manufacturer or standard is named in what the calculators say", () => {
  const FORBIDDEN = /\bEBR\b|Ymer|Metrel|Eurotest|Megger|Fluke|FLIR|EL-Info|Energiföretagen|Svensk Energi|\bSIS\b|\bSEK\b|\bESA\b|\bIEC\b|\bIEEE\b|\bSS[- ]?\d|\bSS-EN\b|\bEN[ -]?\d{4,5}|ELSÄK|\bNEK\b|\bDIN\b|\bNEC\b|\bAWG\b/i; // Personal names are stopped by the community export itself (community/export.mjs).
  const texts: string[] = [];
  for (const tool of CALCULATORS) {
    texts.push(tool.name, tool.summary, ...tool.help);
    for (const [, group] of Object.entries(tool.groups ?? {})) texts.push(group.title, group.hint ?? "");
    for (const output of tool.outputs) texts.push(output.label);
    for (const input of tool.inputs) {
      texts.push(input.label, input.help ?? "");
      if (input.kind === "choice" && typeof input.options !== "function") for (const option of input.options) texts.push(option.label);
    }
    const outcome = sampleOutcome(tool);
    if (outcome.status === "ok") {
      for (const row of outcome.rows) texts.push(row.label, row.kind === "verdict" ? row.text : row.note ?? "");
      texts.push(...outcome.steps, ...outcome.notes.map(noteText));
    }
  }
  for (const text of texts) assert.doesNotMatch(text, FORBIDDEN, text);
  assert.ok(texts.length > 100);
});

test("the copied result carries the inputs with where each came from, the results, the way it was calculated and the reminder", () => {
  const company = companyCalcData([value(CALC_KEYS.reactance, { high: 0.08, source: "Egen kabelkatalog", reference: "2026" })]);
  const tool = calculatorById("voltage-drop")!;
  const outcome = sampleOutcome(tool, company);
  assert.equal(outcome.status, "ok");
  if (outcome.status !== "ok") return;
  const text = flat(resultText(tool, outcome));
  for (const part of ["Räkneverktyg: Spänningsfall", "Indata", "- System: Trefas", "- Kabellängd (enkel väg): 100 m", "- Reaktans per längd: 0,08 mΩ/m (Företagets värde (Egen kabelkatalog, 2026))",
    "- Resistivitet vid 20 °C: 0,0172 Ω·mm²/m (Fysikaliskt värde för koppar)", "Resultat", "- Spänningsfall ΔU: 19,1 V", "Så räknades det", "1. Resistivitet för koppar vid 20 °C", "Anmärkningar", "Värden och referenser.", REMINDER]) {
    assert.ok(text.includes(part), `${part}\n${text}`);
  }
  const drop = outcome.rows.find((row) => row.id === "dropPct");
  assert.ok(drop?.kind === "quantity");
  assert.equal(quantityText(drop), "4,78 %");
  assert.deepEqual(quantityParts(drop), { value: "4,78", unit: "%" });
  const resistance = outcome.rows.find((row) => row.id === "resistance");
  assert.ok(resistance?.kind === "quantity");
  assert.deepEqual(quantityParts(resistance), { value: "690", unit: "mΩ" });
});

test("a choice that is not offered any more falls back, and unknown choices are ignored", () => {
  const tool = calculatorById("short-circuit")!;
  assert.deepEqual(resolveChoices(tool, { source: "bogus", material: "al" }, { company: emptyCompanyCalcData() }), { source: "current", material: "al" });
});
