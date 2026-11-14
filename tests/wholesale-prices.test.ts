import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { matchAgainstCatalogue } from "../lib/catalogue/catalogue-gate";
import { countsAgainst, parseCatalogueRows, suggestCatalogueMapping, type CatalogueRow } from "../lib/catalogue/model";
import { SeenBits, classifyWholesaleRow, effectiveExtras, matchBatch, planWholesalePrices, type ExtraColumns, type SeqHistory, type WholesaleItem } from "../lib/catalogue/wholesale-prices";
import { EMPTY_PRICE_EXTRAS, seenFromSeqs, seenSeqs } from "../lib/catalogue/wholesale-model";

/**
 * Priser direkt mot grossistens katalogartikel, skrivvägen (2026-10-17): the pure parts – the bit list as the batches
 * build it, which rows of a file are the catalogue's articles and which article each one prices, when a price row is written
 * and what its extras are. The data is made up; the database parts have their own test (tests/catalogue.integration.ts).
 */
const HEADERS = ["Artikelnummer", "E-nummer", "Benämning", "Enhet", "Nettopris", "Prisenhet", "Rabattgrupp", "Förpackning", "Status"];
const mapping = suggestCatalogueMapping(HEADERS);
const rowsOf = (lines: string[][]): CatalogueRow[] => parseCatalogueRows(HEADERS, lines, mapping, "2026-10-17").rows;
const [a] = rowsOf([["1000000001", "1234567", "Motorskydd", "st", "100,00", "", "K12", "10", ""]]);
const ALL: ExtraColumns = { packageSize: true, orderMultiple: false, minOrderQuantity: false, stocked: false, status: true };
const NONE: ExtraColumns = { packageSize: false, orderMultiple: false, minOrderQuantity: false, stocked: false, status: false };
const history = (latest: Partial<NonNullable<SeqHistory["latest"]>> | null, known = true): SeqHistory => ({
  known: known || latest !== null,
  latest: latest && { amount: 100, perQuantity: 1, unitPrice: 100, ...EMPTY_PRICE_EXTRAS, ...latest },
});

test("the bit list built from the batches is the list seenFromSeqs makes", () => {
  const bits = new SeenBits();
  const seqs = [1, 8, 9, 17, 1000, 9000, 70_000, 166_398];
  for (const seq of seqs) assert.equal(bits.add(seq), true, String(seq));
  assert.equal(bits.add(9), false, "a second row for the same article is told");
  assert.equal(bits.count, seqs.length);
  assert.deepEqual([...bits.toBytes()], [...seenFromSeqs(seqs)], "the same bytes, the same length – across the growth of the buffer");
  assert.deepEqual(seenSeqs(bits.toBytes()), seqs);
  assert.deepEqual([1, 2, 9000, 9001].map((seq) => bits.has(seq)), [true, false, true, false]);
  assert.equal(bits.has(0), false);
  assert.equal(bits.has(5_000_000), false, "beyond the list is not seen");
});

test("an empty list is no bytes and a running number is a whole number from 1", () => {
  const bits = new SeenBits();
  assert.equal(bits.toBytes().length, 0);
  assert.equal(bits.count, 0);
  for (const bad of [0, -1, 1.5, Number.NaN]) assert.throws(() => bits.add(bad), Error, String(bad));
});

test("a row is new, changed or unchanged against the company's earlier row of the same price kind", () => {
  const row = (amount: string, per = "") => rowsOf([["1000000001", "1234567", "Motorskydd", "st", amount, per, "", "", ""]])[0];
  assert.equal(classifyWholesaleRow(row("100,00"), undefined), "new", "no history at all");
  assert.equal(classifyWholesaleRow(row("100,00"), history(null, false)), "new");
  assert.equal(classifyWholesaleRow(row("100,00"), history({ amount: 100 })), "unchanged");
  assert.equal(classifyWholesaleRow(row("100,5"), history({ amount: 100 })), "changed");
  assert.equal(classifyWholesaleRow(row("100,00", "100"), history({ amount: 100, perQuantity: 1 })), "changed", "the same amount for another quantity is another price");
  assert.equal(classifyWholesaleRow(row("100,00"), history(null)), "changed", "the supplier has the article, but only at the other price kind: a price of its own");
});

test("a column the file lacks keeps what the series said; a blank group keeps the earlier one; a column with an empty cell clears", () => {
  const earlier = { ...EMPTY_PRICE_EXTRAS, discountGroup: "K12", packageSize: "250", status: "UTGAR", stocked: "J" };
  const [blank] = rowsOf([["1000000001", "1234567", "Motorskydd", "st", "100,00", "", "", "", ""]]);
  const kept = effectiveExtras(blank, earlier, NONE);
  assert.deepEqual(kept, earlier, "a file without those columns changes none of them");
  const cleared = effectiveExtras(blank, earlier, ALL);
  assert.deepEqual([cleared.discountGroup, cleared.packageSize, cleared.status, cleared.stocked], ["K12", "", "", "J"], "package and status follow the file, the group and stocked are not in it");
  const [other] = rowsOf([["1000000001", "1234567", "Motorskydd", "st", "100,00", "", "K13", "500", "UL"]]);
  const changed = effectiveExtras(other, earlier, ALL);
  assert.deepEqual([changed.discountGroup, changed.packageSize, changed.status], ["K13", "500", "UTGAR"]);
  assert.deepEqual(effectiveExtras(a, null, ALL), { ...EMPTY_PRICE_EXTRAS, discountGroup: "K12", packageSize: "10" }, "a new article has what the file says");
  assert.deepEqual(effectiveExtras(a, null, NONE), { ...EMPTY_PRICE_EXTRAS, discountGroup: "K12" }, "and nothing from a column it has not");
});

test("a price row is written for a new article, a changed price or a changed extra – and for nothing else", () => {
  const items: WholesaleItem[] = rowsOf([
    ["1000000001", "1234567", "Ny", "st", "100,00", "", "K12", "10", ""],         // seq 1: new
    ["1000000002", "2222222", "Samma", "st", "50,00", "", "K1", "10", ""],         // seq 2: same price and extras
    ["1000000003", "3333333", "Dyrare", "st", "60,00", "", "K1", "10", ""],        // seq 3: changed price
    ["1000000004", "4444444", "Ny grupp", "st", "70,00", "", "K9", "10", ""],      // seq 4: same price, another group
    ["1000000005", "5555555", "Annan sort", "st", "80,00", "", "K1", "10", ""],    // seq 5: known, but only at the other kind
    ["1000000006", "6666666", "Utgår", "st", "90,00", "", "K1", "10", "UL"],       // seq 6: same price, now going out
  ]).map((row, index) => ({ seq: index + 1, row }));
  const earlier = new Map<number, SeqHistory>([
    [2, history({ amount: 50, discountGroup: "K1", packageSize: "10" })],
    [3, history({ amount: 55, discountGroup: "K1", packageSize: "10" })],
    [4, history({ amount: 70, discountGroup: "K1", packageSize: "10" })],
    [5, history(null)],
    [6, history({ amount: 90, discountGroup: "K1", packageSize: "10" })],
  ]);
  const plan = planWholesalePrices(items, earlier, ALL);
  assert.deepEqual(plan.write.map(({ item }) => item.seq), [1, 3, 4, 5, 6]);
  assert.deepEqual([plan.newArticles, plan.changedPrices, plan.unchangedPrices], [1, 2, 3], "an extra alone never makes a price changed");
  assert.equal(plan.write.find(({ item }) => item.seq === 6)!.extras.status, "UTGAR");
  assert.equal(plan.write.find(({ item }) => item.seq === 4)!.extras.discountGroup, "K9");
  assert.equal(plan.write.some(({ item }) => item.seq === 2), false, "nothing for an unchanged price: the bit list confirms it");
});

test("the same file read twice writes nothing the second time", () => {
  const items: WholesaleItem[] = rowsOf([["1000000001", "1234567", "A", "st", "100,00", "", "K12", "10", ""], ["1000000002", "2222222", "B", "m", "9,5", "100", "K1", "", "UL"]]).map((row, index) => ({ seq: index + 1, row }));
  const first = planWholesalePrices(items, new Map(), ALL);
  assert.equal(first.write.length, 2);
  const written = new Map<number, SeqHistory>(first.write.map(({ item, extras }) => [item.seq, history({ amount: item.row.amount, perQuantity: item.row.perQuantity, unitPrice: item.row.unitPrice, ...extras })]));
  const again = planWholesalePrices(items, written, ALL);
  assert.deepEqual([again.write.length, again.newArticles, again.changedPrices, again.unchangedPrices], [0, 0, 0, 2]);
});

// ---------- which rows are the catalogue's articles ----------
type Found = { seq: number; articleNo: string; eNumber: string; unit: string };
const catalogue = (found: Found[]) => ({ $queryRaw: async () => found }) as unknown as Pick<Prisma.TransactionClient, "$queryRaw">;
const fileRows = (lines: string[][]) => rowsOf(lines.map(([articleNo, e, name, unit]) => [articleNo, e, name, unit, "1,00", "", "", "", ""]));

test("a row prices the article with its own number, or the one with its E-nummer and unit – never another unit, never another wholesaler's", async () => {
  const db = catalogue([
    { seq: 11, articleNo: "1000000001", eNumber: "1234567", unit: "PCE" },
    { seq: 12, articleNo: "1000000002", eNumber: "1111111", unit: "MTR" },
    { seq: 13, articleNo: "1000000003", eNumber: "2222222", unit: "PCE" },
  ]);
  const rows = fileRows([
    ["1234567", "1234567", "Motorskydd", "ST"],         // the E-nummer and the unit (PCE = st)
    ["0001111", "1111111", "Kabel", "M"],               // the E-nummer and the unit (MTR = m)
    ["1000000003", "", "Brytare", "st"],                // the wholesaler's own number
    ["2222222", "2222222", "Brytare i meter", "m"],     // the E-nummer of an article, another unit: never guessed
    ["REX-1", "", "Rexels", "st"],                      // no article of this wholesaler
    ["9999999", "9999999", "Finns inte", "st"],         // not in the catalogue
  ]);
  const match = await matchAgainstCatalogue(db, "solar", rows);
  assert.deepEqual(match.matched, [0, 1, 2]);
  assert.deepEqual(match.seqs, [11, 12, 13], "each matched row knows the article it prices");
  assert.deepEqual([match.unitDiffers, match.notInCatalogue], [1, 2]);
});

test("a number the wholesaler gave beats an E-nummer, and the lowest running number is the article when the register has several", async () => {
  const db = catalogue([
    { seq: 30, articleNo: "1000000030", eNumber: "1234567", unit: "PCE" },
    { seq: 20, articleNo: "1000000020", eNumber: "1234567", unit: "PCE" },
    { seq: 25, articleNo: "1000000025", eNumber: "1234567", unit: "MTR" },
  ]);
  const rows = fileRows([["1234567", "1234567", "Via E-nummer", "st"], ["1000000030", "1234567", "Via numret", "st"], ["7654321", "1234567", "Meter", "m"]]);
  const match = await matchAgainstCatalogue(db, "solar", rows);
  assert.deepEqual(match.matched, [0, 1, 2]);
  assert.deepEqual(match.seqs, [20, 30, 25], "E-nummer + st: the lowest running number; the exact number: its own article; E-nummer + m: the meter article");
});

test("an article reached by two rows of the file is priced by the first row only", async () => {
  const db = catalogue([{ seq: 7, articleNo: "1000000007", eNumber: "1234567", unit: "PCE" }, { seq: 8, articleNo: "1000000008", eNumber: "", unit: "PCE" }]);
  const claimed = new SeenBits();
  const first = await matchBatch(db, "solar", fileRows([["1234567", "1234567", "Via E-nummer", "st"], ["1000000008", "", "Annan", "st"]]), claimed);
  assert.deepEqual(first.items.map((item) => [item.seq, item.row.name]), [[7, "Via E-nummer"], [8, "Annan"]]);
  const second = await matchBatch(db, "solar", fileRows([["1000000007", "", "Samma artikel igen", "st"], ["1000000008", "", "Och igen", "st"], ["8888888", "8888888", "Ingen", "st"]]), claimed);
  assert.deepEqual(second.items, [], "both articles were priced in the earlier batch");
  assert.deepEqual([second.sameArticle, second.notInCatalogue], [2, 1]);
  assert.deepEqual(seenSeqs(claimed.toBytes()), [7, 8], "the list has each article once");
});

test("the preview counts the rows the import will not read as no new articles", () => {
  assert.deepEqual(countsAgainst(10, { matched: 4, unchanged: 3 }), { newArticles: 6, changedPrices: 1, unchangedPrices: 3 }, "a company's own supplier: as before");
  assert.deepEqual(countsAgainst(10, { matched: 4, unchanged: 3, skipped: 5 }), { newArticles: 1, changedPrices: 1, unchangedPrices: 3 }, "a wholesaler's: five rows are not in its catalogue");
  assert.deepEqual(countsAgainst(3, { matched: 0, unchanged: 0, skipped: 9 }), { newArticles: 0, changedPrices: 0, unchangedPrices: 0 });
});
