import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFormula, FormulaError, formatFormulaValue, orderByDependencies, parseFormula, type FormulaValue } from "../lib/workflow/form-formula";
import { evaluateForm, formBlockSchema, formCompletion, formDocumentSchema, formProgress, initialFormValues, validateFormDocument, type FormDocument } from "../lib/workflow/form-document";

const run = (source: string, refs: Record<string, FormulaValue> = {}, cells: Record<string, FormulaValue> = {}) => {
  const warnings: string[] = [];
  const value = evaluateFormula(parseFormula(source), { ref: (name) => refs[name], cell: (name) => cells[name], warn: (message) => warnings.push(message) });
  return { value, warnings };
};

test("formulas: arithmetic, precedence, Swedish decimals, comparison and logic", () => {
  assert.equal(run("=1 + 2 * 3").value, 7);
  assert.equal(run("(1 + 2) * 3").value, 9);
  assert.equal(run("2 ^ 3 ^ 2").value, 512, "power is right-associative");
  assert.equal(run("-2 + 5").value, 3);
  assert.equal(run("1,5 * 2").value, 3, "decimal comma");
  assert.equal(run("uppmatt >= grans", { uppmatt: 250, grans: 1 }).value, true);
  assert.equal(run("[uppmatt] < [grans]", {}, { uppmatt: 0.4, grans: 1 }).value, true);
  assert.equal(run("OM(a > 10; \"Hög\"; \"Låg\")", { a: 12 }).value, "Hög");
  assert.equal(run("OCH(SANT; a = 3)", { a: 3 }).value, true);
  assert.equal(run("ELLER(FALSKT; INTE(SANT))").value, false);
  assert.equal(run("\"L\" & 1").value, "L1");
  assert.equal(run("IF(1 < 2; 1; 2)").value, 1, "English aliases");
});

test("formulas: functions over table columns and empty values", () => {
  const refs = { "matning.uppmatt": [250, 180, 0.4, null], "matning.godkand": [true, true, false, null] };
  assert.equal(run("SUMMA(matning.uppmatt)", refs).value, 430.4);
  assert.equal(run("MIN(matning.uppmatt)", refs).value, 0.4);
  assert.equal(run("MAX(matning.uppmatt; 300)", refs).value, 300);
  assert.equal(run("AVRUNDA(MEDEL(matning.uppmatt); 1)", refs).value, 143.5);
  assert.equal(run("ANTAL(matning.uppmatt)", refs).value, 3, "empty cells are not counted");
  assert.equal(run("ANTAL.OM(matning.godkand; FALSKT)", refs).value, 1);
  assert.equal(run("a + 1", { a: null }).value, null, "an empty input gives an empty result");
  assert.equal(run("ÄRTOM(a)", { a: null }).value, true);
  const divided = run("1 / a", { a: 0 });
  assert.equal(divided.value, null);
  assert.deepEqual(divided.warnings, ["Division med noll gav ett tomt värde."]);
  assert.equal(formatFormulaValue(0.4, "MΩ"), "0,4 MΩ");
  assert.equal(formatFormulaValue(false), "Nej");
});

test("formulas: errors are Swedish and nothing is executed as code", () => {
  const error = (source: string) => { try { parseFormula(source); return ""; } catch (issue) { assert.ok(issue instanceof FormulaError); return (issue as Error).message; } };
  assert.match(error("SUMMA(1; 2"), /parentes/);
  assert.match(error("FOO(1)"), /finns inte/);
  assert.match(error("OM(1)"), /ska ha 2–3 argument/);
  assert.match(error("a $ b"), /kan inte användas/);
  assert.match(error("constructor.constructor(\"x\")()"), /finns inte|Oväntat/);
  assert.match(error("x".repeat(501)), /högst 500/);
  assert.match(error("(".repeat(40) + "1" + ")".repeat(40)), /för många nivåer/);
  assert.throws(() => run("okand + 1"), /Okänt kortnamn/);
  assert.throws(() => orderByDependencies(new Map([["a", ["b"]], ["b", ["a"]]])), /Cirkelreferens: a → b → a/);
});

const isolation: FormDocument = formDocumentSchema.parse({
  schema: 1,
  blocks: [
    { id: "h", type: "heading", text: "Isolationsmätning", level: 1 },
    { id: "c1", type: "columns", columns: [
      [{ id: "f1", type: "field", key: "instrument", label: "Instrument", input: "text", required: true, help: "", unit: "", min: null, max: null, options: [], multiple: false, allowNotApplicable: true, deviationOn: "NONE" }],
      [{ id: "f2", type: "field", key: "provspanning", label: "Provspänning", input: "choice", required: true, help: "", unit: "", min: null, max: null, options: ["250 V", "500 V", "1000 V"], multiple: false, allowNotApplicable: true, deviationOn: "NONE" }],
    ] },
    { id: "t", type: "table", key: "matning", label: "Mätning", rowMode: "fixed", fixedRows: ["L1–PE", "L2–PE", "L3–PE"], required: true, help: "", columns: [
      { id: "k1", key: "uppmatt", label: "Uppmätt", input: "number", required: true, unit: "MΩ", options: [], min: null, max: null, formula: "", passCondition: false, total: "min" },
      { id: "k2", key: "grans", label: "Gräns", input: "number", required: true, unit: "MΩ", options: [], min: null, max: null, formula: "", passCondition: false, total: "none" },
      { id: "k3", key: "godkand", label: "Godkänd", input: "formula", required: false, unit: "", options: [], min: null, max: null, formula: "[uppmatt] >= [grans]", passCondition: true, total: "none" },
    ] },
    { id: "r", type: "computed", key: "resultat", label: "Resultat", formula: "OM(ANTAL.OM(matning.godkand; FALSKT) = 0; \"Godkänd\"; \"Avvikelse\")", unit: "", passCondition: false },
    { id: "s", type: "signature", key: "utford", label: "Utförd av", required: true },
  ],
});

test("form document: the isolation example validates, computes row formulas, totals and deviations", () => {
  assert.deepEqual(validateFormDocument(isolation).issues, []);
  const values = initialFormValues(isolation);
  assert.deepEqual(values.tables.matning.map((row) => row.label), ["L1–PE", "L2–PE", "L3–PE"]);
  values.fields.instrument = "IT-200";
  values.fields.provspanning = "500 V";
  values.tables.matning[0].cells = { uppmatt: 250, grans: 1 };
  values.tables.matning[1].cells = { uppmatt: 180, grans: 1 };
  values.tables.matning[2].cells = { uppmatt: 0.4, grans: 1 };
  const evaluation = evaluateForm(isolation, values);
  assert.deepEqual(Object.values(evaluation.cells.matning).map((row) => row.godkand), [true, true, false]);
  assert.equal(evaluation.totals.matning.uppmatt, 0.4);
  assert.equal(evaluation.computed.resultat, "Avvikelse");
  assert.equal(evaluation.deviations.length, 1);
  assert.match(evaluation.deviations[0].message, /L3–PE/);

  // Completion: signature and the deviation comment are still missing; progression stays below 95 %.
  let completion = formCompletion(isolation, values);
  assert.equal(completion.ready, false);
  assert.deepEqual(completion.issues.map((issue) => issue.blockId).sort(), ["deviations", "s"]);
  assert.ok(formProgress("IN_PROGRESS", isolation, values) < 95);
  values.signatures.utford = { name: "Elon Strömberg", confirmed: true, signedAt: null };
  values.deviationComment = "L3 omdragen och ommätt nästa vecka.";
  completion = formCompletion(isolation, values);
  assert.equal(completion.ready, true);
  assert.equal(formProgress("IN_PROGRESS", isolation, values), 95, "the 95 % cap until completed");
  assert.equal(formProgress("COMPLETED", isolation, values), 100);
});

test("form document: unknown names, misplaced row references, duplicate keys and cycles are rejected before publishing", () => {
  const broken = structuredClone(isolation);
  broken.blocks.push(formBlockSchema.parse({ id: "x", type: "computed", key: "fel", label: "Fel", formula: "okand + [uppmatt]", unit: "", passCondition: false }));
  broken.blocks.push(formBlockSchema.parse({ id: "y", type: "computed", key: "resultat", label: "Dubblett", formula: "1", unit: "", passCondition: false }));
  broken.blocks.push(formBlockSchema.parse({ id: "a", type: "computed", key: "a1", label: "A", formula: "b1 + 1", unit: "", passCondition: false }));
  broken.blocks.push(formBlockSchema.parse({ id: "b", type: "computed", key: "b1", label: "B", formula: "a1 + 1", unit: "", passCondition: false }));
  const messages = validateFormDocument(broken).issues.map((issue) => issue.message).join("\n");
  assert.match(messages, /okänt kortnamn "okand"/);
  assert.match(messages, /\[uppmatt\] kan bara användas i en tabellkolumn/);
  assert.match(messages, /Kortnamnet resultat används redan/);
  assert.match(messages, /Cirkelreferens/);
  assert.ok(validateFormDocument({ schema: 1, blocks: [{ id: "z", type: "script", text: "alert(1)" }] }).issues.length > 0, "unknown block types are refused");
});
