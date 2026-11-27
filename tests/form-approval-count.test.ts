import assert from "node:assert/strict";
import test from "node:test";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import {
  copyFormValues, evaluateForm, formApprovalResult, formApprovalTotals, formCompletion, formLeafBlocks, formRuleSummary, formSummaryMaterial, formValuesSchema,
  initialFormValues, newFormRow, summaryMaterialWithNote, summaryOwnNote, type FormTableBlock, type FormValues,
} from "../lib/workflow/form-document";
import { suggestedLimits } from "./helpers/suggested-limits";

// 2026-10-05, Kontroll före idrifttagning: "Skriv med AI" wrote "1 av 2 kontrollrader godkända" and later "0 av 2"
// about the same RCD test. Every count now comes from formApprovalResult, and an older summary in the field never brings
// its numbers along.
const rcd = formLeafBlocks(kfidFormDocument).find((block): block is FormTableBlock => block.type === "table" && block.key === "rcd")!;
const passing = { place: "JFB1", std: "EN 61008 / EN 61009", type: "A", idn: "30", t1p: 20, t1n: 22, t5p: 10, t5n: 12, ntrip05: true, btnok: true };
const failing = { ...passing, place: "JFB2", t1p: 450 };
function protocol(rows: FormValues["tables"][string]) {
  const values = initialFormValues(kfidFormDocument);
  values.fields.proj = "Elcentral A1";
  values.sections["kfid-rcd"] = true;
  values.tables.rcd = rows;
  // The RCD limits are the company's values (2026-10-06); here a company that took Workflow's suggestions.
  values.limits = suggestedLimits(kfidFormDocument);
  return values;
}
const row = (id: string, cells: Record<string, string | number | boolean>) => ({ ...newFormRow(rcd, id), cells: { ...newFormRow(rcd, id).cells, ...cells } });

test("one count: the card, the summary block, Sammanställ resultat and the AI material agree, even with a stale note", () => {
  const values = protocol([row("a", passing), row("b", failing)]);
  const evaluation = evaluateForm(kfidFormDocument, values);
  const result = formApprovalResult(kfidFormDocument, values, evaluation);
  assert.deepEqual(result.totals.find((item) => item.blockId === rcd.id), { blockId: rcd.id, title: "Jordfelsbrytarprov", ok: 1, total: 2 });
  assert.deepEqual(result.notApproved.map((item) => [item.name, item.state]), [["JFB2", false]]);
  assert.deepEqual(formApprovalTotals(kfidFormDocument, values, evaluation), result.totals);
  const summary = formRuleSummary(kfidFormDocument, values, evaluation);
  assert.match(summary, /^Jordfelsbrytarprov: 1 av 2 kontrollrader godkända\.$/m);
  assert.match(summary, /^Inte godkända – Jordfelsbrytarprov: JFB2\.$/m);
  assert.match(summary, /^Bedömning: 1 kontrollrad är inte godkänd/m, "the conclusion never says 'inga avvikelser' under a failing row");
  // The field still holds what Sammanställ resultat wrote earlier, when both rows failed.
  values.deviationComment = "Kontroll av Elcentral A1.\nJordfelsbrytarprov: 0 av 2 kontrollrader godkända.\nBedömning: 2 kontrollrader är inte godkända – åtgärdas.\nKunden informerad på plats.";
  const material = formSummaryMaterial(kfidFormDocument, values);
  assert.deepEqual(material.match(/\d+ av \d+ kontrollrader godkända/g), ["1 av 2 kontrollrader godkända"], "only today's count reaches the AI");
  assert.match(material, /Anteckning \(personens egen text; antalen ovan gäller\): Kunden informerad på plats\.$/);
});

test("the old control editor's material drops its own older rule lines too", () => {
  const fresh = "Kontroll av X.\nIsolation: 2 av 2 kontrollrader godkända.\nBedömning: inga avvikelser – installationen kan tas i drift enligt kontrollen.";
  assert.equal(summaryOwnNote("Kontroll av X.\nIsolation: 1 av 2 kontrollrader godkända.\nBedömning: 1 punkt är inte godkänd.", fresh), "");
  assert.equal(summaryMaterialWithNote(fresh, "Isolation: 1 av 2 kontrollrader godkända."), fresh);
});

test("Färdigställ names the row that is not approved and leads to the summary field", () => {
  const values = protocol([row("a", passing), row("b", failing)]);
  const issue = formCompletion(kfidFormDocument, values).issues.find((item) => item.blockId === "deviations");
  assert.ok(issue);
  assert.match(issue.message, /^Inte godkänt – Jordfelsbrytarprov: JFB2\. Åtgärda och för in den nya mätningen, eller beskriv avvikelsen/);
});

// "Mät igen" was removed (2026-10-24): an older protocol's measured-again row is read as an ordinary row, and the
// row it once replaced counts again – nothing is hidden, so Färdigställ names it.
test("an older protocol with a measured-again row is read without error, every row counted", () => {
  const values = formValuesSchema.parse(protocol([row("a", failing), { ...row("b", passing), remeasures: "a", remeasureAction: "Bytt jordfelsbrytare" } as FormValues["tables"][string][number]]));
  assert.equal("remeasures" in values.tables.rcd[1], false);
  assert.equal("remeasureAction" in values.tables.rcd[1], false);
  const evaluation = evaluateForm(kfidFormDocument, values);
  assert.deepEqual(formApprovalResult(kfidFormDocument, values, evaluation).totals.find((item) => item.blockId === rcd.id), { blockId: rcd.id, title: "Jordfelsbrytarprov", ok: 1, total: 2 });
  assert.ok(formCompletion(kfidFormDocument, values).issues.some((item) => item.blockId === "deviations"));
  assert.deepEqual(copyFormValues(values).tables.rcd.map((item) => item.id), ["a", "b"]);
});
