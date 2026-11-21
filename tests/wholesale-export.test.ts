import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { exportFileName, formatCsv, formatText, splitParts } from "../lib/wholesale/format";
import { cleanRowWholesale, readRowWholesale, WHOLESALERS, type RowWholesale, type WholesalerId } from "../lib/wholesale/model";
import { exportBlockReason, prepareLines, type ExportLine, type WholesaleSourceLine } from "../lib/wholesale/prepare";
import { WHOLESALE_PROFILES } from "../lib/wholesale/profiles";
import { fromMaterialRows, fromProjectMaterials, fromQuoteLines } from "../lib/wholesale/sources";
import { createWholesaleWorkbook } from "../lib/wholesale/xlsx";
import { applyArticle } from "../lib/catalogue/snapshot";
import { lineCatalogueJson, readLineCatalogue, quoteLineInputSchema } from "../lib/quotes/model";
import { workflowTaskDataSchema } from "../lib/workflow/task-model";
import { summarizeProjectMaterials } from "../lib/workflow/project-materials";
import type { MaterialRow } from "../lib/workflow/expenses";

// Invented articles only: no supplier data from any price file is used in the tests.
const line = (id: string, over: Partial<WholesaleSourceLine> = {}): WholesaleSourceLine => ({ id, name: `Testartikel ${id}`, quantity: "3", unit: "st", ...over });
const ready = (lines: WholesaleSourceLine[], wholesaler: WholesalerId, options = {}) => {
  const preparation = prepareLines(lines, wholesaler, options);
  assert.equal(preparation.canExport, true, exportBlockReason(preparation));
  return preparation;
};
/** A row that has every number a wholesaler could use, with the supplier named as `supplier`. */
const rich = (id: string, supplier: string, over: Partial<WholesaleSourceLine> = {}) => line(id, {
  supplierName: supplier, supplierArticleNo: "0012345", eNumber: "1234567", manufacturerArticleNo: "TILL-77", articleNo: "0012345", articleSource: supplier, ...over,
});

test("each wholesaler gets its own column order, separator, header and line ending", () => {
  const solar = ready([rich("a", "Solar Test AB"), rich("b", "Solar Test AB", { supplierArticleNo: "X", eNumber: "7654321", quantity: "10" })], "solar");
  assert.equal(formatText(solar.ready, "solar"), "1234567 3\n7654321 10");
  const ahlsell = ready([rich("a", "Ahlsell Test AB")], "ahlsell");
  assert.equal(formatText(ahlsell.ready, "ahlsell"), "0012345\t3");
  const sonepar = ready([rich("a", "Sonepar Test AB", { supplierArticleNo: "E0012345" })], "sonepar");
  assert.equal(formatText(sonepar.ready, "sonepar"), "3 E0012345", "quantity first, the E prefix kept");
  const rexel = ready([rich("a", "Rexel Test AB")], "rexel");
  assert.equal(formatText(rexel.ready, "rexel"), "Artikelnummer / Tillv.art.nr;Kvantitet\r\n0012345;3\r\n");
});

test("only the chosen wholesaler's verified identifier is used; the same digits in another system are never taken", () => {
  const row = rich("a", "Ahlsell Test AB");
  // Ahlsell: its own number from the Ahlsell price list.
  assert.equal(prepareLines([row], "ahlsell").rows[0].identifier, "0012345");
  // Solar: the E-nummer on the row (a common system), never Ahlsell's article number.
  assert.equal(prepareLines([row], "solar").rows[0].identifier, "1234567");
  // Sonepar: the row is from Ahlsell's list, so there is no verified Sonepar number, even though the digits exist.
  const sonepar = prepareLines([row], "sonepar");
  assert.equal(sonepar.rows[0].identifier, null);
  assert.equal(sonepar.rows[0].issues[0].code, "no-identifier");
  assert.equal(sonepar.canExport, false);
  // Rexel: the manufacturer's number counts (the template's column is "Tillv.art.nr").
  assert.equal(prepareLines([row], "rexel").rows[0].identifier, "TILL-77");
  // A similar supplier name does not count as the wholesaler.
  assert.equal(prepareLines([rich("a", "Solarcell Ahlsellsson")], "ahlsell").rows[0].identifier, null);
});

test("a missing or uncertain link shows the row; the person picks a number or leaves the row out", () => {
  const plain = line("x", { articleNo: "HAND-1" });
  const first = prepareLines([plain, rich("ok", "Ahlsell Test AB")], "ahlsell");
  assert.equal(first.canExport, false);
  assert.equal(first.needAction, 1);
  assert.match(exportBlockReason(first), /1 rad behöver/);
  assert.deepEqual(first.rows[0].candidates.map((c) => c.value), ["HAND-1"], "the number on the row is offered, not used");
  // Chosen by the person (saved on the row).
  const picked = prepareLines([{ ...plain, wholesale: { ids: { ahlsell: "HAND-1" } } }], "ahlsell");
  assert.equal(picked.canExport, true);
  assert.equal(picked.rows[0].origin, "user");
  // Left out explicitly.
  const left = prepareLines([plain, rich("ok", "Ahlsell Test AB")], "ahlsell", { excluded: new Set(["x"]) });
  assert.equal(left.canExport, true);
  assert.equal(left.ready.length, 1);
  assert.equal(left.excluded, 1);
  // The note is per wholesaler: an Ahlsell number is not used at Solar.
  assert.equal(prepareLines([{ ...plain, wholesale: { ids: { ahlsell: "HAND-1" } } }], "solar").rows[0].identifier, null);
});

test("an identifier a wholesaler could read as a separator or a formula is refused, and Rexel stops non-ASCII", () => {
  const unsafe = (id: string, wholesale: WholesalerId) => prepareLines([line("a", { wholesale: { ids: { [wholesale]: id } } })], wholesale).rows[0].issues.map((issue) => issue.code);
  assert.deepEqual(unsafe("12 34", "solar"), ["unsafe-identifier"]);
  assert.deepEqual(unsafe("12,34", "sonepar"), ["unsafe-identifier"]);
  assert.deepEqual(unsafe("12;34", "rexel"), ["unsafe-identifier"]);
  assert.deepEqual(unsafe("12 34", "ahlsell"), [], "a space is fine in a tab separated line");
  assert.deepEqual(unsafe("=1+1", "ahlsell"), ["unsafe-identifier"]);
  assert.deepEqual(unsafe("ÅÄ-12", "rexel"), ["non-ascii"]);
  assert.deepEqual(unsafe("ÅÄ-12", "ahlsell"), []);
});

test("leading zeros stay in the text, the copied text and the CSV", () => {
  const p = ready([line("a", { wholesale: { ids: { ahlsell: "000123", rexel: "007", solar: "0001234", sonepar: "00099" } } })], "ahlsell");
  assert.equal(formatText(p.ready, "ahlsell"), "000123\t3");
  for (const id of ["rexel", "solar", "sonepar"] as const) {
    const lines = ready([line("a", { wholesale: { ids: { [id]: id === "rexel" ? "007" : "0001234" } } })], id).ready;
    assert.ok(formatText(lines, id).includes(id === "rexel" ? "007" : "0001234"));
    assert.ok(!formatText(lines, id).includes("'"), "no apostrophe is added to keep the zeros");
  }
});

test("quantities: empty, negative, zero, unreadable and ambiguous ones are not exported; decimals are not guessed", () => {
  const codes = (quantity: string) => prepareLines([rich("a", "Ahlsell Test AB", { quantity })], "ahlsell").rows[0].issues.map((issue) => issue.code);
  assert.deepEqual(codes(""), ["no-quantity"]);
  assert.deepEqual(codes("-2"), ["non-positive"]);
  assert.deepEqual(codes("0"), ["non-positive"]);
  assert.deepEqual(codes("abc"), ["bad-quantity"]);
  assert.deepEqual(codes("1.000"), ["ambiguous-quantity"]);
  assert.deepEqual(codes("1,000"), ["ambiguous-quantity"]);
  assert.deepEqual(codes("2,5"), ["decimal-quantity"], "a decimal quantity is not verified at any wholesaler");
  assert.deepEqual(codes("12"), []);
  assert.deepEqual(codes("1 200"), []);
});

test("the consumption quantity becomes an order quantity only with a factor; a missing factor is a clear error", () => {
  // The article is sold per rulle but the row counts metres and has no factor yet.
  const noFactor = prepareLines([rich("a", "Ahlsell Test AB", { quantity: "120", unit: "m", priceUnit: "rulle" })], "ahlsell");
  assert.equal(noFactor.rows[0].issues[0].code, "missing-factor");
  assert.match(noFactor.rows[0].issues[0].message, /120|m men artikeln säljs per rulle/);
  assert.equal(noFactor.canExport, false);
  // With 100 m per rulle: 120 m needs 2 rulle, which is more than needed and so needs the person's confirmation.
  const pack: RowWholesale = { packs: { ahlsell: { orderUnit: "rulle", perUnit: "100" } } };
  const rounded = prepareLines([rich("a", "Ahlsell Test AB", { quantity: "120", unit: "m", priceUnit: "rulle", wholesale: pack })], "ahlsell");
  assert.equal(rounded.lines[0].quantity, 2);
  assert.equal(rounded.lines[0].unit, "rulle");
  assert.equal(rounded.lines[0].rounded, true);
  assert.equal(rounded.canExport, false);
  assert.match(exportBlockReason(rounded), /Bekräfta/);
  const confirmed = prepareLines([rich("a", "Ahlsell Test AB", { quantity: "120", unit: "m", priceUnit: "rulle", wholesale: pack })], "ahlsell", { confirmed: new Set([rounded.lines[0].confirmKey]) });
  assert.equal(confirmed.canExport, true);
  assert.equal(formatText(confirmed.ready, "ahlsell"), "0012345\t2");
  // An exact fit needs no confirmation; an order multiple rounds up to the multiple.
  assert.equal(prepareLines([rich("a", "Ahlsell Test AB", { quantity: "200", unit: "m", priceUnit: "rulle", wholesale: pack })], "ahlsell").canExport, true);
  const multiple = prepareLines([rich("a", "Ahlsell Test AB", { quantity: "3", unit: "st", wholesale: { packs: { ahlsell: { orderUnit: "förp", perUnit: "1", multiple: "10" } } } })], "ahlsell");
  assert.equal(multiple.lines[0].quantity, 10);
  assert.equal(multiple.lines[0].rounded, true);
  // A changed quantity needs a new confirmation.
  const changed = prepareLines([rich("a", "Ahlsell Test AB", { quantity: "230", unit: "m", priceUnit: "rulle", wholesale: pack })], "ahlsell", { confirmed: new Set([rounded.lines[0].confirmKey]) });
  assert.equal(changed.canExport, false);
  // A bad factor is an error on the row.
  const bad = prepareLines([rich("a", "Ahlsell Test AB", { quantity: "5", unit: "m", wholesale: { packs: { ahlsell: { orderUnit: "rulle", perUnit: "0" } } } })], "ahlsell");
  assert.equal(bad.rows[0].issues[0].code, "bad-factor");
  // The same unit under another spelling needs no factor.
  assert.equal(prepareLines([rich("a", "Ahlsell Test AB", { unit: "styck", priceUnit: "st" })], "ahlsell").canExport, true);
});

test("only equal rows are merged; different units or terms stay apart", () => {
  const a = rich("a", "Ahlsell Test AB", { quantity: "3" });
  const b = rich("b", "Ahlsell Test AB", { quantity: "4", name: "Annan benämning, samma artikel" });
  const merged = prepareLines([a, b], "ahlsell");
  assert.equal(merged.lines.length, 1);
  assert.equal(merged.lines[0].quantity, 7);
  assert.equal(merged.merged, 1);
  assert.deepEqual(merged.lines[0].rowIds, ["a", "b"]);
  // Same article, different order unit: two lines and a warning.
  const apart = prepareLines([a, rich("c", "Ahlsell Test AB", { quantity: "2", unit: "förp" })], "ahlsell");
  assert.equal(apart.lines.length, 2);
  assert.equal(apart.warnings.length, 1);
  // Different packaging terms are not merged either.
  const terms = prepareLines([
    rich("d", "Ahlsell Test AB", { quantity: "100", unit: "m", wholesale: { packs: { ahlsell: { orderUnit: "rulle", perUnit: "100" } } } }),
    rich("e", "Ahlsell Test AB", { quantity: "50", unit: "m", wholesale: { packs: { ahlsell: { orderUnit: "ring", perUnit: "50" } } } }),
  ], "ahlsell");
  assert.equal(terms.lines.length, 2);
});

test("Ahlsell above 400 lines is split in numbered parts; no line is lost", () => {
  const many = Array.from({ length: 950 }, (_, i) => line(`r${i}`, { wholesale: { ids: { ahlsell: `ART-${String(i).padStart(4, "0")}` } }, quantity: String(i + 1) }));
  const preparation = ready(many, "ahlsell");
  const parts = splitParts(preparation.ready, "ahlsell");
  assert.deepEqual(parts.map((part) => part.lines.length), [400, 400, 150]);
  assert.deepEqual(parts.map((part) => [part.index, part.of, part.from, part.to]), [[1, 3, 1, 400], [2, 3, 401, 800], [3, 3, 801, 950]]);
  assert.equal(parts.flatMap((part) => part.lines).length, 950);
  assert.equal(new Set(parts.flatMap((part) => part.lines.map((l) => l.identifier))).size, 950);
  assert.equal(exportFileName("ahlsell", "Offert O-0012", parts[1]), "inkop-ahlsell-offert-o-0012-del-2-av-3");
  // Exactly 400 is one part; other wholesalers are never split.
  assert.equal(splitParts(ready(many.slice(0, 400), "ahlsell").ready, "ahlsell").length, 1);
  assert.equal(splitParts(ready(many.map((l) => ({ ...l, wholesale: { ids: { solar: `S${l.id}` } } })), "solar").ready, "solar").length, 1);
  assert.equal(exportFileName("rexel", "Arbetsorder"), "inkop-rexel-arbetsorder");
});

test("Rexel CSV follows the template: header, semicolon, CRLF, no example line", () => {
  const p = ready([rich("a", "Rexel Test AB"), rich("b", "Rexel Test AB", { supplierArticleNo: "00777", quantity: "12" })], "rexel");
  const csv = formatCsv(p.ready, "rexel");
  assert.equal(csv, "Artikelnummer / Tillv.art.nr;Kvantitet\r\n0012345;3\r\n00777;12\r\n");
  assert.equal(csv.split("\r\n")[0], "Artikelnummer / Tillv.art.nr;Kvantitet");
  assert.ok(!/\n\n|\r\n\r\n/.test(csv), "no empty example row");
  assert.ok(!csv.replace(/\r\n/g, "").includes("\n"), "every line break is CRLF");
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(csv), "ASCII only");
  assert.throws(() => formatCsv(p.ready, "ahlsell"), /ingen CSV/);
  assert.equal(WHOLESALE_PROFILES.rexel.csv, true);
  assert.deepEqual(WHOLESALERS.filter((id) => WHOLESALE_PROFILES[id].csv), ["rexel"]);
});

test("the Excel file opens, has two columns in the wholesaler's order and identifiers as text", async () => {
  for (const id of WHOLESALERS) {
    const own = id === "solar" ? "0012345" : "00AB-9";
    const p = ready([line("a", { quantity: "7", wholesale: { ids: { [id]: own } } }), line("b", { quantity: "12", wholesale: { ids: { [id]: "007" } } })], id);
    const bytes = await createWholesaleWorkbook(p.ready, id);
    assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK", "a real XLSX (zip), not a renamed CSV");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = book.worksheets[0];
    const header = WHOLESALE_PROFILES[id].xlsxHeader;
    const first = header ? 2 : 1;
    assert.equal(sheet.rowCount, first + 1, "only the data rows (and Rexel's header), no sums or extra rows");
    const articleColumn = WHOLESALE_PROFILES[id].columns[0] === "article" ? 1 : 2;
    const quantityColumn = articleColumn === 1 ? 2 : 1;
    if (header) assert.deepEqual([sheet.getCell(1, 1).value, sheet.getCell(1, 2).value], [header[0], header[1]]);
    const article = sheet.getCell(first, articleColumn);
    assert.equal(article.type, ExcelJS.ValueType.String, `${id}: identifier is a text cell`);
    assert.equal(article.value, own);
    assert.equal(article.numFmt, "@");
    assert.equal(sheet.getCell(first + 1, articleColumn).value, "007", "leading zeros kept");
    assert.equal(sheet.getCell(first, quantityColumn).value, 7);
    assert.equal(sheet.getCell(first + 1, quantityColumn).value, 12);
  }
});

test("a value that looks like a formula is written as text in the file", async () => {
  const lines: ExportLine[] = [{ key: "k", identifier: "=1+1", name: "x", quantity: 1, unit: "st", consumption: 1, consumptionUnit: "st", rowIds: ["a"], rounded: false, confirmKey: "k", confirmed: false, issues: [] }];
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await createWholesaleWorkbook(lines, "ahlsell")) as unknown as ArrayBuffer);
  const cell = book.worksheets[0].getCell(1, 1);
  assert.equal(cell.type, ExcelJS.ValueType.String);
  assert.equal(cell.formula, undefined);
});

test("only material rows are read: no work, expenses, prices, discounts or markup, and nothing changes", () => {
  const rows: MaterialRow[] = [
    { id: "m1", name: "Kabel", quantity: "10", unit: "m", unitPrice: "12,5", markupPercent: "20", articleNo: "A1", articleSource: "Ahlsell Test AB", wholesale: { ids: { solar: "1111111" } },
      catalogue: { articleId: "i", supplierName: "Ahlsell Test AB", supplierArticleNo: "A1", eNumber: "", unitPrice: "12,5", unit: "m", source: "lista.xlsx", priceDate: "2026-10-01" } },
    { id: "e1", kind: "expense", name: "Parkering", quantity: "1", unit: "st", unitPrice: "50", amount: "50" },
    { id: "blank", name: "", quantity: "", unit: "" },
  ];
  const before = JSON.stringify(rows);
  const source = fromMaterialRows(rows);
  assert.equal(source.lines.length, 1);
  assert.equal(source.skipped, 1);
  const serialised = JSON.stringify(source.lines);
  for (const forbidden of ["12,5", "unitPrice", "markup", "20", "Parkering", "amount"]) assert.ok(!serialised.includes(`"${forbidden}"`) && !serialised.includes(forbidden === "20" ? '"20"' : forbidden), `${forbidden} is not read`);
  const p = prepareLines(source.lines, "ahlsell");
  assert.equal(JSON.stringify(rows), before, "export never changes a row, its prices or its status");
  assert.equal(formatText(p.ready, "ahlsell"), "A1\t10");
  assert.ok(!formatText(p.ready, "ahlsell").includes("12,5"));
});

test("quote lines: only Material lines are read; selling prices and markup never follow, and the quote is unchanged", () => {
  const quoteLines = [
    { id: "l1", kind: "MATERIAL" as const, name: "Dosa", quantity: "5", unit: "st", unitPrice: "20", markupPercent: "30", articleNo: "Q1", articleSource: "Solar Test AB", wholesale: { ids: { solar: "7654321" } } },
    { id: "l2", kind: "LABOUR" as const, name: "Arbete", quantity: "3", unit: "h", unitPrice: "700", markupPercent: "" },
    { id: "l3", kind: "OTHER" as const, name: "Fri text", quantity: "1", unit: "st", unitPrice: "100", markupPercent: "" },
  ];
  const before = JSON.stringify(quoteLines);
  const source = fromQuoteLines(quoteLines);
  assert.equal(source.lines.length, 1);
  assert.equal(source.skipped, 2);
  assert.equal(formatText(ready(source.lines, "solar").ready, "solar"), "7654321 5");
  assert.equal(JSON.stringify(quoteLines), before);
  assert.ok(!JSON.stringify(source.lines).includes("700"));
});

test("project material lines carry an article number only when every summed row agrees", () => {
  const same = { name: "Kabel", quantity: "10", unit: "m", articleNo: "A1", articleSource: "Ahlsell Test AB" };
  const summary = summarizeProjectMaterials([
    { id: "w1", title: "Ett", materials: [same, { ...same, quantity: "5" }, { name: "Dosa", quantity: "1", unit: "st", articleNo: "D1", articleSource: "Ahlsell Test AB" }, { name: "Dosa", quantity: "1", unit: "st", articleNo: "D2", articleSource: "Ahlsell Test AB" }] },
  ]);
  const cable = summary.lines.find((l) => l.name === "Kabel")!;
  const box = summary.lines.find((l) => l.name === "Dosa")!;
  assert.equal(cable.article?.articleNo, "A1");
  assert.equal(box.article, undefined, "differing numbers: the person is asked");
  const p = prepareLines(fromProjectMaterials(summary.lines).lines, "ahlsell");
  assert.equal(p.ready.length, 1);
  assert.equal(p.ready[0].quantity, 15);
  assert.equal(p.needAction, 1);
});

test("what a person enters is kept on the work order row and on the quote line, and a new article clears it", () => {
  const wholesale: RowWholesale = { ids: { rexel: "ZZ-1" }, packs: { rexel: { orderUnit: "rulle", perUnit: "100", multiple: "2" } } };
  const parsed = workflowTaskDataSchema.parse({
    kind: "WORK_ORDER", details: { executionNotes: "", signature: { name: "", confirmed: false, signedAt: null },
      materials: [{ id: "6f1c8f0e-3a5c-4a58-9a8e-2f4b3a1d9c11", name: "Kabel", quantity: "5", unit: "m", wholesale }] },
  });
  assert.deepEqual((parsed.details as { materials: MaterialRow[] }).materials[0].wholesale, wholesale);
  const stored = lineCatalogueJson({ articleNo: "", wholesale });
  assert.deepEqual(readLineCatalogue(stored).wholesale, wholesale);
  assert.equal(lineCatalogueJson({ articleNo: "" }), null, "a line without notes stores nothing");
  const input = quoteLineInputSchema.parse({ kind: "MATERIAL", name: "x", quantity: "1", wholesale });
  assert.deepEqual(input.wholesale, wholesale);
  assert.equal(readRowWholesale({ ids: { solar: 5 } }), undefined, "unreadable values are dropped");
  assert.equal(cleanRowWholesale({ ids: { solar: "  " }, packs: { ahlsell: { orderUnit: "", perUnit: "" } } }), undefined);
  const picked = applyArticle({ id: "r", name: "x", quantity: "1", unit: "st", wholesale }, { id: "i", name: "Ny", unit: "st", supplierArticleNo: "N1", eNumber: "", supplierName: "Solar Test AB", price: null });
  assert.equal(picked.wholesale, undefined);
});

test("the profiles list what is verified and what is not", () => {
  for (const id of WHOLESALERS) {
    assert.ok(WHOLESALE_PROFILES[id].verified.length > 0);
    assert.ok(WHOLESALE_PROFILES[id].unverified.some((text) => /Decimalantal|Teckenkodning/.test(text)));
  }
  assert.equal(WHOLESALE_PROFILES.ahlsell.recommendedMaxLines, 400);
  assert.equal(WHOLESALE_PROFILES.rexel.copyHint?.includes("CSV"), true);
});
