import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { CatalogueHit } from "../lib/catalogue/snapshot";
import type { MaterialRow } from "../lib/workflow/expenses";
import { keepStoredMaterialPrices, withoutMaterialPrices, workOrderTotals } from "../lib/workflow/material-prices";
import { keepStoreRows, rowsAfterReturn, storeReturnRow, storeRowLabel, storeRowOf, storeWithdrawalRow, withoutStoreRows } from "../lib/workflow/store-rows";
import { workOrderDataSchema } from "../lib/workflow/task-model";
import { linesFromWork, materialsFromData } from "../lib/invoice-basis/model";
import { formatPrice } from "../lib/workflow/expenses";

// Uttag ur förrådet på arbetsordern (2026-10-30): a withdrawal is a locked material row on the work order, shown in
// its material, its report and the invoice basis exactly once; antal and removal go through the store (Lämna tillbaka).

const hit: CatalogueHit = {
  id: "a1", name: "Tätningssats 40 mm (register)", unit: "st", supplierArticleNo: "TS-40", eNumber: "", supplierName: "Grossist AB",
  price: { unitPrice: 250, priceDate: "2026-10-01", sourceFileName: "pris.csv", importId: "i1" },
};
const article = { name: "Tätningssats 40 mm", unit: "sats", articleNo: "TS-40", supplierName: "Grossist AB" };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const withdrawal = (n: number, extra: Partial<Parameters<typeof storeWithdrawalRow>[0]> = {}) =>
  storeWithdrawalRow({ id: uuid(n), transactionId: `tx${n}`, locationName: "Servicebil 1", article, quantity: 2, hit, markupPercent: "15", ...extra });

test("a withdrawal becomes a material row: the store's name, unit and number, the register's price and the company's markup", () => {
  const row = withdrawal(1);
  assert.equal(row.name, "Tätningssats 40 mm", "the store's own name");
  assert.equal(row.unit, "sats", "the store's unit, in which it was counted");
  assert.equal(row.quantity, "2");
  assert.equal(row.articleNo, "TS-40");
  assert.equal(row.unitPrice, "250");
  assert.equal(row.markupPercent, "15");
  assert.equal(row.catalogue?.articleId, "a1", "where the price came from, as for a picked article");
  assert.deepEqual(row.storeRef, { transactionId: "tx1", locationName: "Servicebil 1" });
  assert.equal(storeRowLabel(row), "Från förråd Servicebil 1");
  assert.equal(row.pickedArticleId, undefined);
  // An own article of the store: no price until someone with the price right gives it one; never a made-up 0 kr.
  const own = withdrawal(2, { hit: null, quantity: 0.5, article: { name: "Egen packning", unit: "st", articleNo: "", supplierName: "" } });
  assert.deepEqual([own.name, own.quantity, own.unit, own.unitPrice, own.markupPercent, own.articleNo], ["Egen packning", "0,5", "st", undefined, undefined, undefined]);
  // The saved work order keeps the mark (the task model accepts it).
  const saved = workOrderDataSchema.parse({ executionNotes: "", deviations: "", materials: [row, own] });
  assert.deepEqual(saved.materials[0].storeRef, row.storeRef);
});

test("a save cannot change, add or remove a store row; only à-pris and påslag are the price right's", () => {
  const stored: MaterialRow[] = [{ id: uuid(9), name: "Kabel", quantity: "10", unit: "m" }, withdrawal(1)];
  // Antal, name and unit typed over, the mark removed, à-pris and påslag changed.
  const edited = { ...withdrawal(1), quantity: "1", name: "Annat", unit: "st", unitPrice: "300", markupPercent: "20" };
  delete (edited as MaterialRow).storeRef;
  const forged: MaterialRow = { id: uuid(3), name: "Gratis", quantity: "5", unit: "st", storeRef: { transactionId: "txX", locationName: "Förråd A" } };
  const kept = keepStoreRows([stored[0], edited, forged, { id: uuid(4), name: "Ny rad", quantity: "1", unit: "st" }], stored);
  assert.deepEqual(kept.map((row) => row.id), [uuid(9), uuid(1), uuid(4)], "a made-up store row is left out; the person's own rows stay");
  const locked = kept[1];
  assert.deepEqual([locked.name, locked.quantity, locked.unit, locked.storeRef?.transactionId], ["Tätningssats 40 mm", "2", "sats", "tx1"]);
  assert.deepEqual([locked.unitPrice, locked.markupPercent], ["300", "20"]);
  // A save that dropped the row (removed on the page, or an old page) gets it back.
  const back = keepStoreRows([stored[0]], stored);
  assert.deepEqual(back.map((row) => row.id), [uuid(9), uuid(1)]);
  // The same row twice in a save is kept once.
  assert.equal(keepStoreRows([withdrawal(1), withdrawal(1)], stored).length, 1);
  // Without the price right the stored prices are kept too (the order the server applies the rules in).
  const noPrice = keepStoredMaterialPrices(keepStoreRows(withoutMaterialPrices(stored), stored), stored);
  assert.deepEqual([noPrice[1].unitPrice, noPrice[1].markupPercent], ["250", "15"]);
  // A new work order (nothing stored, a copy or a Local file) gets no store rows.
  assert.deepEqual(keepStoreRows([withdrawal(1)], []), []);
});

test("Lämna tillbaka: the row goes while it is not billed; once billed, a negative row credits it", () => {
  const rows: MaterialRow[] = [{ id: uuid(9), name: "Kabel", quantity: "10", unit: "m" }, withdrawal(1)];
  const returnRow = (row: MaterialRow) => storeReturnRow({ id: uuid(5), transactionId: "ret1", locationName: "Servicebil 1", withdrawal: row, quantity: 2 });
  assert.deepEqual(rowsAfterReturn(rows, { withdrawalId: "tx1", billed: false, returnRow }).map((row) => row.id), [uuid(9)]);
  const billed = rowsAfterReturn(rows, { withdrawalId: "tx1", billed: true, returnRow });
  assert.equal(billed.length, 3);
  const credit = billed[2];
  assert.deepEqual([credit.quantity, credit.unitPrice, credit.markupPercent, credit.storeRef?.return, credit.storeRef?.transactionId], ["-2", "250", "15", true, "ret1"]);
  assert.equal(storeRowLabel(credit), "Åter till förråd Servicebil 1");
  assert.equal(storeRowOf(billed, "ret1"), undefined, "a return row is not a withdrawal's row");
  // A withdrawal without a row (drawn before rows were written): nothing changes.
  assert.deepEqual(rowsAfterReturn(rows, { withdrawalId: "old", billed: false, returnRow }), rows);
  // The sums: the withdrawal and its credit together are 0.
  const totals = workOrderTotals(billed.slice(1));
  assert.deepEqual([totals.material.purchase, totals.material.sale], [0, 0]);
});

test("the invoice basis takes a store row exactly once, also after it was edited or credited", () => {
  const order = (materials: MaterialRow[]) => ({ id: "wo1", title: "Läckage", entries: [], materials: materialsFromData({ kind: "WORK_ORDER", details: { materials } }) });
  const first = linesFromWork([order([withdrawal(1)])], { taken: new Set(), hourlyRate: "", perJob: false });
  assert.equal(first.lines.length, 1);
  assert.deepEqual([first.lines[0].name, first.lines[0].quantity, first.lines[0].unit, first.lines[0].unitPrice, first.lines[0].articleNo], ["Tätningssats 40 mm", "2", "sats", "250", "TS-40"]);
  // A save that tried to change the antal keeps the row as it was: the same source key, so it is never taken twice.
  const saved = keepStoreRows([{ ...withdrawal(1), quantity: "9" }], [withdrawal(1)]);
  const again = linesFromWork([order(saved)], { taken: new Set(first.sources), hourlyRate: "", perJob: false });
  assert.equal(again.lines.length, 0);
  // Returned after billing: only the credit comes on the next basis.
  const credited = rowsAfterReturn(saved, { withdrawalId: "tx1", billed: true, returnRow: (row) => storeReturnRow({ id: uuid(5), transactionId: "ret1", locationName: "Servicebil 1", withdrawal: row, quantity: 2 }) });
  const next = linesFromWork([order(credited)], { taken: new Set(first.sources), hourlyRate: "", perJob: false });
  assert.deepEqual(next.lines.map((line) => line.quantity), [formatPrice(-2)]);
});

test("the machine's cost counts the store's withdrawals, not the store rows on the order as well", () => {
  const rows: MaterialRow[] = [{ id: uuid(9), name: "Kabel", quantity: "10", unit: "m", unitPrice: "5" }, withdrawal(1)];
  assert.deepEqual(withoutStoreRows(rows).map((row) => row.id), [uuid(9)]);
  const cost = readFileSync(new URL("../lib/maintenance/cost-server.ts", import.meta.url), "utf8");
  assert.match(cost, /workOrderTotals\(withoutStoreRows\(/);
});

test("the server wires it: the save keeps store rows, the store writes them in its transaction, the report names the store", () => {
  const save = readFileSync(new URL("../lib/workflow/material-prices-server.ts", import.meta.url), "utf8");
  assert.match(save, /keepStoreRows\(details\.materials, storedRows\)/);
  const store = readFileSync(new URL("../lib/maintenance/store-server.ts", import.meta.url), "utf8");
  assert.match(store, /storeWithdrawalRow\(/);
  assert.match(store, /rowsAfterReturn\(/);
  assert.match(store, /invoiceBasisSource\.count/);
  assert.match(store, /FOR UPDATE/);
  const report = readFileSync(new URL("../lib/workflow/task-report.ts", import.meta.url), "utf8");
  assert.match(report, /storeRowLabel\(item\)/);
  const reimport = readFileSync(new URL("../lib/kfid/cloud-import.ts", import.meta.url), "utf8");
  assert.match(reimport, /keepStoreRows\(/);
});
