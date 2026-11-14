import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compareQuotedUsed, quoteLinesFromMaterials, workOrderMaterialsFromQuote } from "../lib/quotes/conversion";
import {
  parseKronor, parseShare, quoteActions, quoteInputSchema, quoteRotOf, quoteSendIssues, quoteTotals, quoteVersionDiff, rotDeduction, type QuoteLineView, type QuoteView,
} from "../lib/quotes/model";
import { createQuotePdf } from "../lib/quotes/quote-report";
import { priceSettingsOf } from "../lib/quotes/settings";
import { keepStoredMaterialPrices, withoutMaterialPrices } from "../lib/workflow/material-prices";
import { workOrderDataSchema } from "../lib/workflow/task-model";
import type { MaterialRow } from "../lib/workflow/expenses";
import { pdfText } from "../lib/import/pdf-text";

// Offert steg C, moms och ROT (2026-10-09). Made-up data; the ROT figures are the editable defaults only.

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const line = (values: Partial<QuoteLineView>): QuoteLineView => ({ id: newId(), kind: "MATERIAL", name: "Kabel", quantity: "10", unit: "m", unitPrice: "10", markupPercent: "", ...values });

test("VAT and ROT shares: 0–100 %, written with comma or %, kronor ≥ 0", () => {
  assert.equal(parseShare("25"), 25);
  assert.equal(parseShare("12,5 %"), 12.5);
  assert.equal(parseShare("101"), null);
  assert.equal(parseShare("-1"), null);
  assert.equal(parseShare(""), null);
  assert.equal(parseKronor("50 000"), 50000);
  assert.equal(parseKronor("-5"), null);
});

test("VAT is per quote: 25 % by default, another rate when the quote says so, computed on the sum of rounded lines", () => {
  const lines = [line({ quantity: "3", unitPrice: "33,33", markupPercent: "15" }), line({ kind: "LABOUR", name: "Montör", quantity: "1,5", unit: "h", unitPrice: "645" })];
  const standard = quoteTotals(lines);
  assert.equal(standard.net, 1082.49);
  assert.equal(standard.vat, 270.62);
  assert.equal(standard.toPay, standard.gross, "without ROT the sum to pay is incl. VAT");
  const reduced = quoteTotals(lines, 12);
  assert.equal(reduced.vat, 129.9, "1 082,49 × 12 % = 129,8988 → 129,90");
  assert.equal(reduced.gross, 1212.39);
  assert.equal(quoteTotals(lines, 0).gross, 1082.49);
});

test("ROT: share × marked labour incl. VAT, whole öre, never above the cap, only for a private person", () => {
  const rot = { percent: 30, cap: 50000 };
  const lines = [
    line({ quantity: "10", unitPrice: "100" }),
    line({ kind: "LABOUR", name: "Montör", quantity: "8", unit: "h", unitPrice: "650", rotLabour: true }),
    line({ kind: "LABOUR", name: "Resa", quantity: "1", unit: "st", unitPrice: "300" }),
  ];
  const totals = quoteTotals(lines, 25, rot);
  assert.equal(totals.net, 6500);
  assert.equal(totals.gross, 8125);
  assert.equal(totals.rotBase, 5200, "only the marked labour line");
  assert.equal(totals.rotBaseInclVat, 6500);
  assert.equal(totals.rot, 1950);
  assert.equal(totals.toPay, 6175);
  assert.equal(totals.rotCapped, false);
  const capped = quoteTotals(lines, 25, { percent: 30, cap: 1000 });
  assert.equal(capped.rot, 1000);
  assert.equal(capped.rotCapped, true);
  assert.equal(rotDeduction(333.33, { percent: 30, cap: 50000 }), 100, "99,999 → 100,00");
  assert.equal(rotDeduction(-5, rot), 0);
  assert.equal(quoteTotals(lines, 25, null).rot, 0, "a line marked as labour gives nothing without ROT");
  assert.equal(quoteRotOf({ customerType: "COMPANY", rotEnabled: true, rotPercent: "30", rotCap: "50000" }), null, "a company never gets ROT");
  assert.equal(quoteRotOf({ customerType: "PRIVATE", rotEnabled: false, rotPercent: "30", rotCap: "50000" }), null);
  assert.deepEqual(quoteRotOf({ customerType: "PRIVATE", rotEnabled: true, rotPercent: "30", rotCap: "50 000" }), rot);
});

test("quote input: customer type, VAT rate and ROT are checked; ROT only for a private person with share and cap", () => {
  const parsed = quoteInputSchema.parse({ title: "Badrum" });
  assert.equal(parsed.customerType, "COMPANY");
  assert.equal(parsed.vatPercent, "25");
  assert.equal(parsed.rotEnabled, false);
  assert.throws(() => quoteInputSchema.parse({ title: "X", vatPercent: "130" }), /Momssatsen/);
  assert.throws(() => quoteInputSchema.parse({ title: "X", rotEnabled: true, rotPercent: "30", rotCap: "50000" }), /privatpersoner/);
  assert.throws(() => quoteInputSchema.parse({ title: "X", customerType: "PRIVATE", rotEnabled: true, rotPercent: "", rotCap: "50000" }), /ROT-andelen/);
  const ok = quoteInputSchema.parse({ title: "X", customerType: "PRIVATE", rotEnabled: true, rotPercent: "30", rotCap: "50000", lines: [{ kind: "LABOUR", name: "Montör", quantity: "2", unitPrice: "600", rotLabour: true }] });
  assert.equal(ok.lines[0].rotLabour, true);
  const today = "2026-10-09";
  assert.deepEqual(quoteSendIssues({ lines: [line({})], validUntil: "2026-11-01", customerType: "PRIVATE", rotEnabled: true, rotPercent: "30", rotCap: "50000" }, today), ["Markera vilka rader som är arbete för ROT."]);
  assert.deepEqual(quoteSendIssues({ lines: [line({})], validUntil: "2026-11-01", vatPercent: "x" }, today), ["Ange momssatsen i procent."]);
  assert.deepEqual(priceSettingsOf({ rotPercent: "200", rotCap: "abc" }).rotPercent, "30", "an unreadable share falls back to the editable default");
});

test("ÄTA: an accepted quote gets a new version; the changes are matched on kind, benämning and enhet", () => {
  assert.deepEqual(quoteActions({ status: "ACCEPTED", validUntil: "" }, "2026-10-09"), ["new_version"]);
  const before = [line({ name: "Kabel", quantity: "10", unitPrice: "10" }), line({ name: "Dosa", unit: "st", quantity: "4", unitPrice: "25" }), line({ kind: "LABOUR", name: "Montör", unit: "h", quantity: "8", unitPrice: "650" })];
  const after = [line({ name: "kabel ", quantity: "15", unitPrice: "10" }), line({ kind: "LABOUR", name: "Montör", unit: "h", quantity: "8", unitPrice: "650" }), line({ name: "Jordfelsbrytare", unit: "st", quantity: "1", unitPrice: "800" })];
  const diff = quoteVersionDiff(before, after);
  assert.deepEqual(diff.lines.map((item) => [item.name, item.change, item.before?.quantity ?? null, item.after?.quantity ?? null, item.amountDelta]), [
    ["Dosa", "removed", 4, null, -100],
    ["Jordfelsbrytare", "added", null, 1, 800],
    ["kabel", "changed", 10, 15, 50],
  ]);
  assert.equal(diff.netBefore, 5400);
  assert.equal(diff.netAfter, 6150);
  assert.equal(diff.netDelta, 750);
  assert.deepEqual(quoteVersionDiff(before, before).lines, [], "an unchanged copy has no changes");
});

test("material list → quote: material rows (no expenses) per benämning and enhet, the row's own price, the company's markup otherwise", () => {
  const rows: MaterialRow[] = [
    { id: "a", name: "Kabel", quantity: "10", unit: "m", unitPrice: "12,5", markupPercent: "20" },
    { id: "b", name: " kabel", quantity: "2,5", unit: "M", unitPrice: "11" },
    { id: "c", name: "Dosa", quantity: "ca 20", unit: "st" },
    { id: "d", name: "Parkering", quantity: "1", unit: "st", kind: "expense", unitPrice: "50", amount: "50" },
    { id: "e", name: "", quantity: "3", unit: "st" },
  ];
  const result = quoteLinesFromMaterials(rows, { companyMarkup: "15", newId });
  assert.equal(result.rows, 3, "expense rows and rows without a name are left out");
  assert.equal(result.mixedPrices, 1);
  const [kabel, dosa] = result.lines;
  assert.deepEqual([kabel.kind, kabel.name, kabel.quantity, kabel.unit, kabel.unitPrice, kabel.markupPercent], ["MATERIAL", "Kabel", "12,5", "m", "12,5", "20"]);
  assert.deepEqual([dosa.quantity, dosa.unitPrice, dosa.markupPercent], ["ca 20", "", "15"], "a quantity that is not a number is kept to be corrected");
});

test("accepted quote → work order: Material lines become material rows with quoteRef; prices follow the price right", () => {
  const lines = [line({ name: "Kabel", quantity: "12,5", unit: "m", unitPrice: "10", markupPercent: "15" }), line({ kind: "LABOUR", name: "Montör", unit: "h", quantity: "8", unitPrice: "650" })];
  const rows = workOrderMaterialsFromQuote({ id: "q1", number: 12, version: 2 }, lines, newId);
  assert.equal(rows.length, 1, "Arbete stays on the quote");
  assert.deepEqual([rows[0].name, rows[0].quantity, rows[0].unit, rows[0].unitPrice, rows[0].markupPercent], ["Kabel", "12,5", "m", "10", "15"]);
  assert.deepEqual(rows[0].quoteRef, { quoteId: "q1", quoteLabel: "O-0012 v2", version: 2, lineId: lines[0].id, unitPrice: "11,5" });
  const parsed = workOrderDataSchema.parse({ executionNotes: "", deviations: "", closeNotes: "", materials: rows });
  assert.deepEqual(parsed.materials[0].quoteRef, rows[0].quoteRef, "the work order keeps the link");
  const redacted = withoutMaterialPrices(parsed.materials);
  assert.equal(redacted[0].quoteRef, undefined, "without the price right the quote's selling price is not shown");
  assert.equal(redacted[0].unitPrice, undefined);
  const kept = keepStoredMaterialPrices([{ ...redacted[0], quantity: "13" }], parsed.materials);
  assert.deepEqual(kept[0].quoteRef, rows[0].quoteRef, "a save without the right keeps the stored link");
});

test("quoted against used: per benämning and enhet, antal and selling amounts, lines on one side only", () => {
  const quoted = [line({ name: "Kabel", quantity: "100", unit: "m", unitPrice: "10", markupPercent: "10" }), line({ name: "Dosa", unit: "st", quantity: "10", unitPrice: "20" }), line({ kind: "LABOUR", name: "Montör", unit: "h", quantity: "8", unitPrice: "650" })];
  const used: MaterialRow[] = [
    { id: "1", name: "kabel", quantity: "80", unit: "m", unitPrice: "10", markupPercent: "10" },
    { id: "2", name: "Kabel", quantity: "35", unit: "m", unitPrice: "10", markupPercent: "10" },
    { id: "3", name: "Jordfelsbrytare", quantity: "1", unit: "st" },
    { id: "4", name: "Resa", quantity: "1", unit: "st", kind: "expense", amount: "100" },
  ];
  const result = compareQuotedUsed(quoted, used);
  assert.deepEqual(result.lines.map((item) => [item.name, item.quoted, item.used, item.difference, item.quotedAmount, item.usedAmount]), [
    ["Dosa", 10, null, -10, 200, null],
    ["Jordfelsbrytare", null, 1, 1, null, null],
    ["Kabel", 100, 115, 15, 1100, 1265],
  ]);
  assert.deepEqual(result.totals, { quotedAmount: 1300, usedAmount: 1265, quotedUnpriced: 0, usedUnpriced: 1, difference: -35 });
});

const font = () => readFile("public/fonts/DejaVuSans.ttf").then((bytes) => new Uint8Array(bytes));

test("PDF: VAT at the quote's rate, ROT lines with a neutral note, ÄTA changes – never purchase price or markup", async () => {
  const lines = [line({ name: "Kabel", quantity: "10", unitPrice: "33,33", markupPercent: "20" }), line({ kind: "LABOUR", name: "Montör", unit: "h", quantity: "8", unitPrice: "650", rotLabour: true })];
  const base = [line({ name: "Kabel", quantity: "5", unitPrice: "33,33", markupPercent: "20" }), line({ kind: "LABOUR", name: "Montör", unit: "h", quantity: "8", unitPrice: "650" })];
  const rot = { percent: 30, cap: 50000 };
  const quote: QuoteView = {
    id: "q", number: 3, version: 2, label: "O-0003 v2", revision: 1, title: "Badrum", description: "", status: "SENT", storedStatus: "SENT",
    validUntil: "2026-11-08", terms: "", vatPercent: 25, customer: { id: "c", name: "Privatkund" }, facility: null, project: null, lines,
    totals: quoteTotals(lines, 25, rot), sentAt: "2026-10-09T08:00:00.000Z", decidedAt: null, createdAt: "2026-10-09T07:00:00.000Z", updatedAt: "2026-10-09T08:00:00.000Z", superseded: false,
    versions: [], actions: [], canEdit: true,
    customerType: "PRIVATE", rotEnabled: true, rotPercent: 30, rotCap: 50000, changeOfVersion: 1, change: quoteVersionDiff(base, lines), workOrder: null, workOrders: [], canCreateWorkOrder: false,
  };
  const text = pdfText(Buffer.from(await createQuotePdf({ identity: { company: "QA El AB" }, fontBytes: await font(), quote, createdAt: new Date("2026-10-09T08:00:00Z") })))!.replace(/\s+/g, " ");
  assert.match(text, /tillägg till offert/);
  assert.match(text, /Privatperson/);
  assert.match(text, /Moms 25 %/);
  assert.match(text, /Preliminärt ROT-avdrag 30 %/);
  // 8 × 650 = 5 200; incl. VAT 6 500; 30 % = 1 950.
  assert.match(text, /6 ?500,00/);
  assert.match(text, /−1 ?950,00/);
  assert.match(text, /efter ROT-avdrag/);
  assert.match(text, /angivna av företaget/);
  assert.match(text, /Ändringar mot accepterad version/);
  assert.match(text, /Ändrat/);
  assert.ok(!text.includes("33,33"), "the purchase price is not printed");
  assert.ok(!/Påslag|Inköp/.test(text), "neither markup nor purchase is printed");
});
