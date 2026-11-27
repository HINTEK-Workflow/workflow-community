import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { importGate, overrideImportGateForTests, wholesalerOfSupplier } from "../lib/catalogue/catalogue-gate";
import { CATALOGUE_ROW_LIMIT, fileEntryKey, fileHitOf, fileOfferId, fileOfferOf, filePriceColumns, fileRowAsRegister, fileRowNumber, fileWholesaleOffer, mergeWholesaleOffers, productKeysOfHit, withFileOffers, type FilePriceRow } from "../lib/catalogue/file-price-model";
import { companyRowLimitMessage, companyRowsAfter, wholesalerBoxText } from "../lib/catalogue/gate-text";
import { catalogHitOf, isWholesaleOfferId, parseWholesaleOfferId, registerOfferOf, wholesaleOfferOf, type RegisterArticleRow } from "../lib/catalogue/register-hit";
import { buildFilePricePageSql, buildFilePriceSearchSql, parseArticleQuery } from "../lib/catalogue/search-sql";
import { applyArticle, type CatalogueOffer } from "../lib/catalogue/snapshot";
import { wholesaleIdentity, registerArticleRefKey } from "../lib/catalogue/lists";
import { buildCatalogueTransfer, catalogueTransferCounts, catalogueTransferRows, parseCatalogueTransfer, type CatalogueExportRows } from "../lib/catalogue/transfer-format";
import { ApiError } from "../lib/kfid/errors";
import { wholesaleApi } from "../lib/integrations/wholesale-api";
import { serverKeyStatuses } from "../lib/integrations/server-keys";
import type { WholesaleOffer } from "../lib/catalogue/wholesale-read";

// Prisfil utan grossistens katalog (produktägaren 2026-11-01): the pure rules. The database side is tests/catalogue-file-prices.integration.ts.
const SUPPLIER = "csupplier0000000000000001";
const OTHER = "csupplier0000000000000002";
const row = (overrides: Partial<FilePriceRow> = {}): FilePriceRow => ({
  id: "1", supplierId: SUPPLIER, supplierName: "Rexel", wholesaler: "rexel", articleNo: "REX-1", articleKey: "REX-1", eNumber: "", rskNumber: "", gtin: "", manufacturer: "", manufacturerArticleNo: "", productKey: "",
  name: "Kabel 3G1,5", unit: "m", amount: "350.0000", perQuantity: 100, unitPrice: "3.5000", currency: "SEK", priceKind: "NET", priceDate: new Date("2026-10-01"), createdAt: new Date("2026-11-01T10:00:00Z"),
  importId: "imp1", sourceFileName: "rexel.csv", importedAt: new Date("2026-11-01T10:00:00Z"), discountGroup: "K12", packageSize: "", orderMultiple: "", minOrderQuantity: "", stocked: "", status: "", ...overrides,
});
const article = (overrides: Partial<RegisterArticleRow> = {}): RegisterArticleRow => ({
  id: "w1", seq: 7, wholesaler: "rexel", articleNo: "REX-1", eNumber: "", gtin: "", manufacturer: "", manufacturerArticleNo: "", name: "KABEL", description: "Installationskabel 3G1,5", productType: "Kabel", series: "", unit: "m", status: "10", productKey: "", ...overrides,
});

test("a price file is never refused because of an API: the gate names the way it is written", async () => {
  overrideImportGateForTests(null);
  for (const id of ["ahlsell", "rexel", "sonepar"] as const) assert.deepEqual(await importGate(id), { ok: true, catalogue: null, fileRows: id, reason: "no_api" });
  assert.deepEqual(await importGate(null), { ok: true, catalogue: null }, "a supplier the company named itself goes as before");
  assert.equal(wholesalerOfSupplier({ name: "Solar Sverige" }), "solar", "the name still says which wholesaler");
  assert.equal(wholesalerOfSupplier({ name: "Min elgrossist" }), null);
  assert.equal(wholesalerOfSupplier({ name: "Min elgrossist", wholesaler: "rexel" }), "rexel", "and the company's own choice goes first");
});

test("the texts say what is true: no text says a file waits for an API", () => {
  for (const reason of ["no_api", "inactive", "not_fetched"] as const) assert.match(wholesalerBoxText("rexel", reason), /prisfilen läses in som era egna rader/);
  assert.match(wholesaleApi("rexel").note, /Prisfiler fungerar ändå/);
  for (const id of ["ahlsell", "rexel", "sonepar"]) assert.match(serverKeyStatuses({ SMTP_HOST: "localhost" }).find((item) => item.id === id)!.note, /Prisfiler fungerar ändå/);
  for (const file of ["lib/integrations/wholesale-api.ts", "lib/integrations/server-keys.ts", "lib/api-handlers/integration-keys.ts", "features/integrations/solar-register.tsx", "lib/catalogue/catalogue-gate.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /tas (inte )?emot|kan ta emot prisfiler/i, file);
  }
});

test("a row's own columns: the normalised number, the product and one folded search text", () => {
  const columns = filePriceColumns({ articleNo: "ÅB-12 34", eNumber: "1234567", rskNumber: "", gtin: "07350000000011", manufacturer: "Tillverkare AB", manufacturerArticleNo: "XY-9", name: "Kabel Grå 3G1,5" });
  assert.equal(columns.articleNoNorm, "ab1234");
  assert.equal(columns.productKey, "E:1234567");
  for (const part of ["kabel gra 3g1,5", "ab-12 34", "ab1234", "xy9", "1234567", "07350000000011", "tillverkare ab"]) assert.ok(columns.searchText.includes(part), part);
  assert.equal(filePriceColumns({ articleNo: "A1", eNumber: "", rskNumber: "", gtin: "", manufacturer: "", manufacturerArticleNo: "", name: "Egen" }).productKey, "");
});

test("a row is an offer with the same identity as a price on a register article, with or without the article", () => {
  const id = fileOfferId(row());
  assert.equal(id, `rexel:REX-1:${SUPPLIER}`);
  assert.equal(isWholesaleOfferId(id), true, "so a discount letter reads it from what it carries, and a picked article is priced again from it");
  assert.deepEqual(parseWholesaleOfferId(id), { wholesaler: "rexel", articleNo: "REX-1", supplierId: SUPPLIER });
  assert.equal(wholesaleIdentity(id), "rexel:REX-1", "a favourite finds it");
  assert.equal(registerArticleRefKey({ wholesaler: "rexel", articleNo: "REX-1" }), "W:rexel:REX-1");
  assert.equal(fileRowNumber(row({ articleNo: "", eNumber: "1234567" })), "1234567", "a file with only an E-nummer");
  const linked = wholesaleOfferOf(article(), fileWholesaleOffer(row(), article()));
  assert.equal(linked.id, id, "the id does not change when the register gets the article: no duplicate");
  assert.equal(linked.name, "Installationskabel 3G1,5", "and then it has the register's words");
  assert.ok(linked.catalog);
  assert.equal(linked.price?.unitPrice, 3.5);
  assert.equal(linked.price?.perQuantity, 100);
});

test("an offer of a row says what the file says: no shared product info, so no picture, no stock, no catalogue line", () => {
  const offer = fileOfferOf(row({ status: "UTGAR", stocked: "J", packageSize: "100", priceKind: "BASE" }));
  assert.deepEqual([offer.name, offer.unit, offer.supplierArticleNo, offer.supplierId, offer.supplierName, offer.wholesaler, offer.discountGroup], ["Kabel 3G1,5", "m", "REX-1", SUPPLIER, "Rexel", "rexel", "K12"]);
  assert.deepEqual([offer.status, offer.stocked, offer.packageSize], ["UTGAR", true, "100"]);
  assert.deepEqual(offer.price, { unitPrice: 3.5, priceDate: "2026-10-01", confirmedDate: "2026-11-01", sourceFileName: "rexel.csv", importId: "imp1", perQuantity: 100, amount: 350, priceKind: "BASE" });
  assert.equal(offer.catalog, undefined);
  assert.equal(offer.catalogOnly, undefined);
  assert.equal(fileOfferOf(row({ priceDate: new Date("2026-11-01"), perQuantity: 1 })).price?.confirmedDate, undefined, "a list of today's date has no later confirmation");
  assert.equal(fileHitOf([offer]).product, undefined);
});

test("choosing a row gives a normal material row with its own copy of the price", () => {
  const hit = fileHitOf([fileOfferOf(row({ perQuantity: 1, amount: "12.5000", unitPrice: "12.5000" }))]);
  assert.equal(hit.supplierOnly, true, "no common number: only that supplier's");
  const material = applyArticle({ id: "m1", name: "", quantity: "2", unit: "" } as Parameters<typeof applyArticle>[0], hit);
  assert.deepEqual([material.name, material.unit, material.articleNo, material.articleSource, material.unitPrice], ["Kabel 3G1,5", "m", "REX-1", "Rexel", "12,5"]);
  assert.equal(material.catalogue?.articleId, hit.id);
  assert.equal(material.catalogue?.wholesaler, "rexel");
  assert.equal(material.catalogue?.source, "rexel.csv");
  const hidden = applyArticle({ id: "m1", name: "", quantity: "2", unit: "" } as Parameters<typeof applyArticle>[0], { ...hit, price: null, priceHidden: true });
  assert.equal(hidden.unitPrice, undefined, "who may not see prices gets none");
  assert.equal(hidden.pickedArticleId, hit.id, "the server prices the row from the id on save");
});

test("one register article and both kinds of row: per supplier the latest net price, otherwise the latest base price", () => {
  const offer = (supplierId: string, priceKind: "NET" | "BASE", createdAt: string, unitPrice: string): WholesaleOffer => ({ ...fileWholesaleOffer(row({ supplierId }), article()), priceKind, createdAt, unitPrice });
  const prices = mergeWholesaleOffers([offer(SUPPLIER, "BASE", "2026-10-01T00:00:00.000Z", "10")], [offer(SUPPLIER, "NET", "2026-09-01T00:00:00.000Z", "8")]);
  assert.deepEqual(prices.map((item) => item.unitPrice), ["8"], "a net price goes before a base price, whichever is newer");
  assert.deepEqual(mergeWholesaleOffers([offer(SUPPLIER, "NET", "2026-10-01T00:00:00.000Z", "8")], [offer(SUPPLIER, "NET", "2026-11-01T00:00:00.000Z", "9")]).map((item) => item.unitPrice), ["9"], "the newest of the same kind");
  assert.deepEqual(mergeWholesaleOffers([offer(SUPPLIER, "NET", "2026-11-01T00:00:00.000Z", "8")], [offer(SUPPLIER, "NET", "2026-10-01T00:00:00.000Z", "9")]).map((item) => item.unitPrice), ["8"]);
  assert.equal(mergeWholesaleOffers([offer(SUPPLIER, "NET", "2026-10-01T00:00:00.000Z", "8")], [offer(OTHER, "NET", "2026-10-01T00:00:00.000Z", "9")]).length, 2, "two suppliers are two offers");
});

test("rows beside a hit: one offer per id, the lowest comparable net price taken, the same E-nummer with another unit marked", () => {
  const register = article({ eNumber: "1234567", productKey: "E:1234567", wholesaler: "solar", articleNo: "1000000001", unit: "st" });
  const hit = catalogHitOf([register]);
  assert.equal(hit.catalogOnly, true);
  const ahlsell = fileOfferOf(row({ wholesaler: "ahlsell", supplierId: OTHER, supplierName: "Ahlsell", articleNo: "A-1", eNumber: "1234567", productKey: "E:1234567", unit: "st", perQuantity: 1, unitPrice: "90.0000", amount: "90.0000" }));
  const joined = withFileOffers(hit, [ahlsell, ahlsell], [register]);
  assert.equal(joined.offers?.length, 2, "Solar's own row and Ahlsell's, each once");
  assert.equal(joined.price?.unitPrice, 90, "the priced row is the one a pick takes");
  assert.equal(joined.supplierName, "Ahlsell");
  assert.equal(joined.offers?.find((offer) => offer.catalogOnly)?.price, null, "Ahlsell's file never prices Solar's row");
  assert.equal(joined.common?.number, "1234567");
  assert.ok(joined.product, "the product's facts stay");
  assert.equal(withFileOffers(joined, [ahlsell], [register]), joined, "nothing new: the same hit");

  const sameWholesaler = fileOfferOf(row({ wholesaler: "solar", supplierName: "Solar", articleNo: "S-1", eNumber: "1234567", productKey: "E:1234567", unit: "m" }));
  const checked = withFileOffers(hit, [sameWholesaler], [register]);
  assert.match(checked.offers?.find((offer) => offer.id === sameWholesaler.id)?.catalogCheck ?? "", /annan enhet/, "never guessed");

  const own: CatalogueOffer = { id: "a1", name: "Egen", unit: "st", supplierArticleNo: "E1", eNumber: "1234567", supplierName: "Egen", price: { unitPrice: 200, priceDate: "2026-10-01", sourceFileName: "egen.csv", importId: "i" } };
  assert.equal(withFileOffers({ ...own, offers: [own] }, [ahlsell], [], { exact: true }).id, "a1", "the company's own article found by its exact number stays the hit's");
  assert.equal(withFileOffers({ ...own, offers: [own] }, [ahlsell]).id, ahlsell.id);
});

test("hits of rows alone: one product gathered, a row without a number on its own", () => {
  const first = row({ eNumber: "1234567", productKey: "E:1234567", perQuantity: 1, unitPrice: "100.0000", amount: "100.0000" });
  const second = row({ id: "2", wholesaler: "ahlsell", supplierId: OTHER, supplierName: "Ahlsell", articleNo: "A-1", articleKey: "A-1", eNumber: "1234567", productKey: "E:1234567", perQuantity: 1, unitPrice: "90.0000", amount: "90.0000" });
  assert.equal(fileEntryKey(first), fileEntryKey(second), "the same product is one entry");
  assert.equal(fileEntryKey(first), "register:E:1234567", "the same key as the register's rows of the product");
  assert.notEqual(fileEntryKey(row()), fileEntryKey(row({ articleKey: "REX-2" })));
  const hit = fileHitOf([fileOfferOf(first), fileOfferOf(second)]);
  assert.deepEqual([hit.supplierName, hit.price?.unitPrice, hit.offers?.length, hit.common?.kind, hit.supplierOnly], ["Ahlsell", 90, 2, "E", undefined]);
  assert.equal(fileHitOf([fileOfferOf(first), fileOfferOf(second)], { exactId: fileOfferId(first) }).supplierName, "Rexel", "the row found by its exact number keeps its own offer");
  assert.equal(fileHitOf([fileOfferOf(first), fileOfferOf(second)], { supplierId: SUPPLIER }).supplierName, "Rexel", "the searched supplier's");
  assert.deepEqual(productKeysOfHit({ common: { kind: "E", number: "1234567" }, manufacturer: "Tillverkare", manufacturerArticleNo: "XY-99" }), ["E:1234567", "MPN:tillverkare:xy99"]);
  assert.equal(fileRowAsRegister(first).productKey, "E:1234567");
  assert.equal(fileRowAsRegister(row({ eNumber: "123" })).eNumber, "", "only a whole E-nummer joins");
});

test("the company's limit: a wholesaler's file replaces, an own supplier's adds, the installation decides", () => {
  assert.equal(companyRowsAfter({ stored: 290_000, replaced: 100_000, fileRows: 120_000, own: false }), 310_000);
  assert.equal(companyRowsAfter({ stored: 100, replaced: 500, fileRows: 10, own: false }), 10, "never below zero");
  assert.equal(companyRowsAfter({ stored: 100, replaced: 50, fileRows: 500, newArticles: 3, own: true }), 103, "an own supplier keeps its articles and adds the new ones");
  assert.equal(companyRowsAfter({ stored: 100, replaced: 0, fileRows: 500, own: true }), 600);
  assert.match(companyRowLimitMessage(300_000), /högst 300.000 artikelrader från prisfiler/);
  assert.equal(CATALOGUE_ROW_LIMIT, existsSync("community/instance-defaults.ts") ? 300_000 : null, "this installation carries the largest measured list and no uncontrolled copies");
  assert.match(readFileSync(existsSync("community/instance-defaults.ts") ? "community/instance-defaults.ts" : "lib/instance-defaults.ts", "utf8"), /catalogueRowLimit: null/, "a community installation pays for its own database");
});

test("the search's SQL: inside one company, only finished imports, words only as parameters", () => {
  const sql = buildFilePriceSearchSql({ organizationId: "org-a", query: parseArticleQuery("kabel 100%"), supplierId: "sup-1", limit: 500 });
  assert.match(sql.text, /f\."organizationId" = \$/);
  assert.match(sql.text, /f\."supplierId" = \$/);
  assert.match(sql.text, /i\."contentHash" <> ''/, "a file still being written is never seen");
  assert.ok(sql.values.includes("org-a"));
  assert.equal(sql.values.at(-1), 50, "bounded");
  assert.doesNotMatch(sql.text, /kabel/);
  assert.ok(sql.values.includes("%100\\%%"), "a percent sign means itself");
  assert.doesNotMatch(buildFilePriceSearchSql({ organizationId: "org-a", query: parseArticleQuery("kabel"), limit: 5 }).text, /f\."supplierId" = \$/);
  const page = buildFilePricePageSql({ organizationId: "org-a", query: null, filter: "unmatched", skip: 50, take: 50 });
  assert.match(page.text, /f\."organizationId" = \$/);
  assert.match(page.text, /f\."productKey" = ''/);
  assert.match(page.text, /i\."contentHash" <> ''/);
});

test("every query of the read and write path is inside one company", () => {
  const source = readFileSync("lib/catalogue/file-prices.ts", "utf8");
  const statements = source.split(/\$(?:queryRaw|executeRaw)(?:<[^`(]*>)?[`(]/).slice(1);
  assert.ok(statements.length >= 8);
  for (const statement of statements) assert.match(statement.slice(0, 900), /organizationId|buildFilePrice/, statement.slice(0, 120));
  // A row is bound to its company by composite keys, and the additive migration holds nothing destructive.
  const migration = readFileSync("prisma/migrations/20261101230200_catalogue_file_prices/migration.sql", "utf8").replace(/^--.*$/gm, "");
  assert.doesNotMatch(migration, /^\s*(DELETE|TRUNCATE|UPDATE)\b|\bDROP\b|\bRENAME\b/im);
  assert.match(migration, /FOREIGN KEY \("supplierId", "organizationId"\)/);
  assert.match(migration, /FOREIGN KEY \("importId", "organizationId"\)/);
});

test("the Cloud copy carries the rows from version 3, and an older file reads as before", () => {
  const at = new Date("2026-11-01T10:00:00.000Z");
  const rows: CatalogueExportRows = {
    suppliers: [{ id: "cloud-s1", name: "Rexel", customerNumber: "", wholesaler: "rexel", createdAt: at }],
    imports: [{ id: "cloud-i1", supplierId: "cloud-s1", fileName: "rexel.csv", contentHash: "a".repeat(64), rowCount: 1, newArticles: 1, changedPrices: 0, unchangedPrices: 0, failedRows: 0, createdAt: at }],
    articles: [], prices: [], confirmations: [], profiles: [],
    fileRows: [
      { importId: "cloud-i1", wholesaler: "rexel", articleNo: "REX-1", articleKey: "REX-1", eNumber: "1234567", rskNumber: "", gtin: "", manufacturer: "", manufacturerArticleNo: "", name: "Kabel", unit: "m", amount: "350", perQuantity: 100, unitPrice: "3.5", priceKind: "BASE", priceDate: at, createdAt: at, discountGroup: "K12", packageSize: "", orderMultiple: "", minOrderQuantity: "", stocked: "", status: "" },
      { importId: "cloud-other", wholesaler: "rexel", articleNo: "X", articleKey: "X", eNumber: "", rskNumber: "", gtin: "", manufacturer: "", manufacturerArticleNo: "", name: "Utan import", unit: "", amount: "1", perQuantity: 1, unitPrice: "1", priceKind: "NET", priceDate: at, createdAt: at, discountGroup: "", packageSize: "", orderMultiple: "", minOrderQuantity: "", stocked: "", status: "" },
    ],
  };
  const transfer = parseCatalogueTransfer(JSON.parse(JSON.stringify(buildCatalogueTransfer(rows))))!;
  assert.equal(transfer.schemaVersion, 3);
  assert.deepEqual(transfer.fileRows, [{ import: "i1", wholesaler: "rexel", rows: [["REX-1", "REX-1", "1234567", "", "", "", "", "Kabel", "m", "350.0000", 100, "3.5000", "B", "2026-11-01", at.toISOString(), "K12", "", "", "", "", ""]] }], "a row whose import is not in the file is left out");
  assert.equal(catalogueTransferRows(transfer), 1, "the Cloud import's time limit counts them");
  assert.equal(catalogueTransferCounts(transfer)?.fileRows, 1);
  assert.equal(JSON.stringify(transfer).includes("cloud-"), false, "no Cloud id in the file");
  const status = (error: unknown) => error instanceof ApiError && error.status === 422;
  assert.throws(() => parseCatalogueTransfer({ ...transfer, schemaVersion: 2 }), status, "version 2 has no such rows");
  assert.throws(() => parseCatalogueTransfer({ ...transfer, fileRows: [{ ...transfer.fileRows[0], import: "i9" }] }), status, "an import not in the file");
  const { fileRows, ...older } = transfer;
  void fileRows;
  assert.deepEqual(parseCatalogueTransfer({ ...older, schemaVersion: 2 })?.fileRows, [], "an older file has none");
});

test("the register's unpriced row and a row of the file are never the same offer id, so both can stand side by side", () => {
  const register = article({ articleNo: "REX-1" });
  assert.notEqual(registerOfferOf(register).id, fileOfferId(row()));
  assert.equal(parseWholesaleOfferId(registerOfferOf(register).id), null);
});
