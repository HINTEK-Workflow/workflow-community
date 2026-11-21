import assert from "node:assert/strict";
import test from "node:test";
import { agreedQuoteVersions, compareQuotedUsed, isHourUnit, quotedWork, quotedWorkText, workOrderExpensesFromQuote, workOrderPlanFromQuote } from "../lib/quotes/conversion";
import { quoteTotals, type QuoteLineView } from "../lib/quotes/model";
import { expenseTotal, formatPrice, type MaterialRow } from "../lib/workflow/expenses";
import { withoutMaterialPrices } from "../lib/workflow/material-prices";
import { workOrderDataSchema } from "../lib/workflow/task-model";

// Accepterad offert → arbetsorder with Arbete and Övrigt, and Offererat mot använt for time and expenses (2026-10-09,
// "bygg klart allt som går att bygga"). Made-up data.

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const line = (values: Partial<QuoteLineView>): QuoteLineView => ({ id: newId(), kind: "MATERIAL", name: "Kabel", quantity: "10", unit: "m", unitPrice: "10", markupPercent: "", ...values });
const quote = { id: "q1", number: 7, version: 2, description: "Byte av central i tvättstugan." };

test("hour units: h, tim, timmar count as time; st and other units do not", () => {
  assert.equal(isHourUnit("h"), true);
  assert.equal(isHourUnit(" Tim. "), true);
  assert.equal(isHourUnit("timmar"), true);
  assert.equal(isHourUnit("st"), false);
  assert.equal(isHourUnit(""), false);
});

test("quoted work: the Arbete lines in hours become minutes; other units and unreadable antal are not counted", () => {
  const work = quotedWork([
    line({ kind: "LABOUR", name: "Montör", quantity: "8", unit: "h", unitPrice: "650" }),
    line({ kind: "LABOUR", name: "Elinstallatör", quantity: "2,5", unit: "tim", unitPrice: "720" }),
    line({ kind: "LABOUR", name: "Driftsättning", quantity: "1", unit: "st", unitPrice: "1500" }),
    line({ kind: "LABOUR", name: "Resa", quantity: "ca 2", unit: "h", unitPrice: "650" }),
    line({ kind: "MATERIAL", name: "Kabel", quantity: "100", unit: "h" }),
  ]);
  assert.equal(work.minutes, 630, "8 h + 2,5 h = 630 min");
  assert.equal(work.uncounted, 2);
  assert.equal(work.lines.length, 4);
  assert.equal(quotedWorkText(work), "Offererat arbete: Montör 8 h, Elinstallatör 2,5 tim, Driftsättning 1 st, Resa ca 2 h. Totalt 10,5 h.");
  assert.equal(quotedWork([line({})]).minutes, null, "no Arbete line, no estimate");
  assert.equal(quotedWorkText(quotedWork([])), "");
});

test("Övrigt → expense rows at the selling price excl. VAT with quoteRef; a line without price stays to be filled in", () => {
  const lines = [
    line({ kind: "OTHER", name: "Lift, hyra", quantity: "2", unit: "dag", unitPrice: "1000", markupPercent: "10" }),
    line({ kind: "OTHER", name: "Bortforsling", quantity: "1", unit: "st", unitPrice: "" }),
    line({ kind: "MATERIAL", name: "Kabel" }),
  ];
  const rows = workOrderExpensesFromQuote(quote, lines, newId);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].kind, rows[0].name, rows[0].quantity, rows[0].unit, rows[0].unitPrice, rows[0].amount], ["expense", "Lift, hyra", "2", "dag", formatPrice(1100),"2 200,00"]);
  assert.deepEqual(rows[0].quoteRef, { quoteId: "q1", quoteLabel: "O-0007 v2", version: 2, lineId: lines[0].id, unitPrice: formatPrice(1100) });
  assert.equal(rows[1].unitPrice, undefined);
  assert.equal(rows[1].amount, undefined);
  assert.deepEqual(expenseTotal(rows), { total: 2200, count: 2, missing: 0 }, "the amount reads back as written");
  const parsed = workOrderDataSchema.parse({ executionNotes: "", deviations: "", closeNotes: "", materials: rows });
  assert.equal(parsed.materials[0].kind, "expense");
  assert.deepEqual(withoutMaterialPrices(parsed.materials)[0].amount, "2 200,00", "expense rows read the same with or without the price right");
});

test("accepted quote → work order plan: material, expenses, Uppskattad tid and the work in the description (no prices)", () => {
  const lines = [
    line({ name: "Kabel", quantity: "12,5", unit: "m", unitPrice: "10", markupPercent: "15" }),
    line({ kind: "LABOUR", name: "Montör", quantity: "8", unit: "h", unitPrice: "650" }),
    line({ kind: "LABOUR", name: "Driftsättning", quantity: "1", unit: "st", unitPrice: "1500" }),
    line({ kind: "OTHER", name: "Resa", quantity: "1", unit: "st", unitPrice: "450" }),
  ];
  const plan = workOrderPlanFromQuote(quote, lines, newId);
  assert.deepEqual([plan.materials, plan.expenses, plan.estimatedMinutes], [1, 1, 480]);
  assert.deepEqual(plan.rows.map((row) => [row.kind, row.name]), [["material", "Kabel"], ["expense", "Resa"]]);
  assert.equal(plan.description, "Enligt offert O-0007 v2.\n\nOffererat arbete: Montör 8 h, Driftsättning 1 st. Totalt 8 h.\n\nByte av central i tvättstugan.");
  assert.doesNotMatch(plan.description, /650|1500|kr/, "the description never carries a price");
  const parsed = workOrderDataSchema.parse({ executionNotes: "", deviations: "", closeNotes: "", materials: plan.rows });
  assert.equal(parsed.materials.length, 2);
  const onlyMaterial = workOrderPlanFromQuote({ id: "q2", number: 1, version: 1 }, [line({})], newId);
  assert.deepEqual([onlyMaterial.estimatedMinutes, onlyMaterial.expenses, onlyMaterial.description], [null, 0, "Enligt offert O-0001."]);
});

test("quoted against used: Arbete hours against reported time, Övrigt against expense rows", () => {
  const quoted = [
    line({ name: "Kabel", quantity: "100", unit: "m", unitPrice: "10" }),
    line({ kind: "LABOUR", name: "Montör", quantity: "16", unit: "h", unitPrice: "650" }),
    line({ kind: "LABOUR", name: "Driftsättning", quantity: "1", unit: "st", unitPrice: "1500" }),
    line({ kind: "OTHER", name: "Lift", quantity: "2", unit: "dag", unitPrice: "1000" }),
    line({ kind: "OTHER", name: "Bortforsling", quantity: "1", unit: "st", unitPrice: "" }),
  ];
  const used: MaterialRow[] = [
    { id: "1", name: "Kabel", quantity: "90", unit: "m", unitPrice: "10" },
    { id: "2", name: "Lift", quantity: "3", unit: "dag", kind: "expense", unitPrice: "1000", amount: "3 000" },
    { id: "3", name: "Parkering", quantity: "1", unit: "st", kind: "expense", amount: "ca 50" },
  ];
  const result = compareQuotedUsed(quoted, used, 18.5 * 3600);
  assert.deepEqual(result.labour, { quotedMinutes: 960, reportedMinutes: 1110, differenceMinutes: 150, uncounted: 1, quotedAmount: 11900 });
  assert.deepEqual(result.other, { quotedAmount: 2000, quotedUnpriced: 1, usedAmount: 3000, usedRows: 2, usedMissing: 1, difference: 1000 });
  assert.deepEqual(result.totals, { quotedAmount: 1000, usedAmount: 900, quotedUnpriced: 0, usedUnpriced: 0, difference: -100 }, "material is unchanged by the new parts");
  assert.equal(quoteTotals(quoted).byKind.LABOUR, result.labour.quotedAmount, "the Arbete amount is the quote's own");
  const withoutTime = compareQuotedUsed(quoted, used);
  assert.deepEqual([withoutTime.labour.reportedMinutes, withoutTime.labour.differenceMinutes], [null, null], "no time given (no right to read it): nothing compared");
  assert.equal(compareQuotedUsed([line({})], [], 3600).labour.differenceMinutes, null, "no hours quoted: no difference");
});

test("agreed versions: per quote number the latest accepted version, an ÄTA accepted later replaces the one before", () => {
  const rows = [
    { id: "a1", number: 1, version: 1, status: "ACCEPTED" }, { id: "a2", number: 1, version: 2, status: "SENT" },
    { id: "b2", number: 2, version: 2, status: "ACCEPTED" }, { id: "b1", number: 2, version: 1, status: "ACCEPTED" },
    { id: "c1", number: 3, version: 1, status: "DRAFT" },
  ];
  assert.deepEqual(agreedQuoteVersions(rows).map((row) => row.id), ["a1", "b2"]);
});
