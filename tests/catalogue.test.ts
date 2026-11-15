import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ApiError } from "../lib/kfid/errors";
import { catalogueAccess, requireCatalogue } from "../lib/catalogue/access";
import { classifyCatalogueRows, countsAgainst, headerFingerprint, mappingFits, missingFields, normalizeUnit, parseCatalogueRows, parsePrice, samePrice, suggestCatalogueMapping, type ExistingArticle } from "../lib/catalogue/model";
import { applyArticle, checkedDate, priceAgeHint, priceAgeMonths, priceDateText, priceSourceText, type CatalogueHit } from "../lib/catalogue/snapshot";
import { detectImport, looksLikePriceFile, type ExtractedFile } from "../lib/import/detect";
import { workOrderDataSchema } from "../lib/workflow/task-model";
import { defaultWorkflowPermissionProfile, noWorkflowPermissionProfile, workflowPermissionPresets, type WorkflowPermissionProfile } from "../lib/workflow/permissions";
import type { MaterialRow } from "../lib/workflow/expenses";

// Artiklar och priser, steg 1 (2026-10-08): reading a company's own price file, the copy of the price on a
// work order's material row, and who may use the catalogue. The data is made up; no supplier's file layout is used.

const HEADERS = ["Artikelnummer", "E-nummer", "Benämning", "Enhet", "Nettopris", "Prisenhet", "Prisdatum"];
const TODAY = "2026-10-08";

test("Swedish headings are mapped to the catalogue's fields", () => {
  const mapping = suggestCatalogueMapping(HEADERS);
  assert.deepEqual(mapping, { articleNo: "Artikelnummer", eNumber: "E-nummer", name: "Benämning", unit: "Enhet", price: "Nettopris", perQuantity: "Prisenhet", priceDate: "Prisdatum", discountGroup: null, manufacturerArticleNo: null, rskNumber: null, gtin: null, manufacturer: null, packageSize: null, orderMultiple: null, minOrderQuantity: null, stocked: null, status: null, priceOnRequest: null });
  assert.deepEqual(suggestCatalogueMapping(["Art.nr", "Beskrivning", "Pris"]), { articleNo: "Art.nr", eNumber: null, name: "Beskrivning", unit: null, price: "Pris", perQuantity: null, priceDate: null, discountGroup: null, manufacturerArticleNo: null, rskNumber: null, gtin: null, manufacturer: null, packageSize: null, orderMultiple: null, minOrderQuantity: null, stocked: null, status: null, priceOnRequest: null });
});

test("prices with decimal comma, thousands and a currency are read; per 100 gives the unit price", () => {
  assert.deepEqual(parsePrice("1 234,50"), { state: "ok", value: 1234.5 });
  assert.deepEqual(parsePrice("12,5 kr"), { state: "ok", value: 12.5 });
  assert.deepEqual(parsePrice("1.234,50"), { state: "ok", value: 1234.5 });
  assert.deepEqual(parsePrice("99:-"), { state: "ok", value: 99 });
  assert.deepEqual(parsePrice(""), { state: "empty" });
  assert.equal(parsePrice("tolv").state, "invalid");
  const parsed = parseCatalogueRows(HEADERS, [
    ["A-100", "18 123 45", "Installationskabel 3G1,5", "M", "1 250,00", "100", "2026-09-01"],
    ["A-200", "", "Dosa", "ST", "12,50", "", ""],
  ], suggestCatalogueMapping(HEADERS), TODAY);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 2);
  const [cable, box] = parsed.rows;
  assert.equal(cable.amount, 1250);
  assert.equal(cable.perQuantity, 100);
  assert.equal(cable.unitPrice, 12.5);
  assert.equal(cable.unit, "m");
  assert.equal(cable.eNumber, "1812345");
  assert.equal(cable.priceDate, "2026-09-01");
  assert.equal(cable.line, 2);
  assert.equal(box.unitPrice, 12.5);
  assert.equal(box.unit, "st");
  assert.equal(box.priceDate, TODAY, "without a date in the file the import's date is the price date");
});

test("units are written one way", () => {
  assert.equal(normalizeUnit("ST"), "st");
  assert.equal(normalizeUnit("styck"), "st");
  assert.equal(normalizeUnit("Meter"), "m");
  assert.equal(normalizeUnit("m2"), "m²");
  assert.equal(normalizeUnit("RLE"), "rulle");
  assert.equal(normalizeUnit("FP"), "förp");
  assert.equal(normalizeUnit(""), "");
  assert.equal(normalizeUnit("Säck"), "Säck", "an unknown unit stays as written");
});

test("missing columns stop the import before any row is read", () => {
  const headers = ["Benämning", "Enhet"];
  const parsed = parseCatalogueRows(headers, [["Dosa", "st"]], suggestCatalogueMapping(headers), TODAY);
  assert.deepEqual(parsed.missing, ["Artikelnummer eller E-nummer", "Pris"]);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.total, 1);
  // A mapping that names a column the file does not have is as good as none.
  assert.deepEqual(missingFields({ articleNo: "Art", name: "Benämning", price: "Pris" }, ["Benämning", "Pris"]), ["Artikelnummer eller E-nummer"]);
  // An E-nummer is enough as the article's identity.
  assert.deepEqual(missingFields({ eNumber: "E-nr", name: "Namn", price: "Pris" }, ["E-nr", "Namn", "Pris"]), []);
});

test("rows that cannot be imported are listed with their row number; warnings do not stop a row", () => {
  const rows = [
    ["A-1", "", "Utan pris", "st", "", "", ""],
    ["A-2", "", "Konstigt pris", "st", "tolv", "", ""],
    ["", "", "Utan nummer", "st", "10", "", ""],
    ["A-4", "", "", "st", "10", "", ""],
    ["A-5", "", "Negativ", "st", "-5", "", ""],
    ["A-6", "", "Fel prisenhet", "st", "10", "noll", ""],
    ["A-7", "12AB", "Konstigt E-nummer", "st", "10", "", "i höstas"],
    ["A-7", "", "Dubblett", "st", "11", "", ""],
    ["", "", "", "", "", "", ""],
    ["", "123456", "Sexsiffrigt", "st", "10", "", ""],
  ];
  const parsed = parseCatalogueRows(HEADERS, rows, suggestCatalogueMapping(HEADERS), TODAY);
  assert.deepEqual(parsed.errors, [
    { line: 2, message: "saknar pris" },
    { line: 3, message: "priset ”tolv” kan inte läsas" },
    { line: 4, message: "saknar artikelnummer och E-nummer" },
    { line: 5, message: "saknar benämning" },
    { line: 6, message: "negativt pris" },
    { line: 7, message: "prisenheten ”noll” kan inte läsas (ange t.ex. 1, 100 eller 1000)" },
    // Prisfiler etapp 1 (2026-10-12): two products under one number are reported as such, with the other name.
    { line: 9, kind: "conflict", message: "samma artikelnummer som rad 8 men en annan produkt (”Dubblett”) – bara rad 8 importeras. Kontrollera numret med leverantören" },
  ]);
  assert.equal(parsed.total, 9, "the empty row is not counted");
  const odd = parsed.rows.find((row) => row.articleNo === "A-7")!;
  assert.equal(odd.eNumber, "");
  assert.deepEqual(odd.warnings, ["E-nummer ”12AB” kan inte läsas – lämnas tomt", "prisdatumet ”i höstas” kan inte läsas – importdagen används"]);
  assert.equal(odd.priceDate, TODAY);
  const six = parsed.rows.find((row) => row.eNumber === "123456")!;
  assert.equal(six.articleKey, "e:123456", "without an article number the E-nummer identifies the article");
  assert.deepEqual(six.warnings, ["E-nummer ”123456” har inte 7 siffror"]);
});

test("a saved mapping is recognised for the same headings and only when it fits", () => {
  const mapping = suggestCatalogueMapping(HEADERS);
  assert.equal(headerFingerprint(HEADERS), headerFingerprint(["artikelnummer", "e nummer", "benämning", "enhet", "nettopris", "prisenhet", "prisdatum"]));
  assert.equal(mappingFits(mapping, HEADERS), true);
  assert.equal(mappingFits(mapping, HEADERS.filter((header) => header !== "Prisdatum")), false, "a column the file no longer has");
  assert.equal(mappingFits({ name: "Benämning" }, HEADERS), false, "the required fields must be named");
});

test("the Import page recognises a price list, keeps other lists as before and never offers it to the AI", () => {
  const file: ExtractedFile = { name: "prislista.xlsx", mimeType: "", size: 1, kind: "table", headers: HEADERS, rows: [["A-1", "", "Dosa", "st", "10", "", ""]] };
  const detection = detectImport(file);
  assert.equal(detection.target, "catalogue");
  assert.equal(detection.mapping.price, "Nettopris");
  assert.equal(looksLikePriceFile(file), true);
  const customers: ExtractedFile = { name: "kunder.csv", mimeType: "", size: 1, kind: "table", headers: ["Namn", "Företag", "E-post", "Telefon", "Ort"], rows: [["Anna", "Elkraft AB", "anna@example.invalid", "070", "Umeå"]] };
  assert.equal(detectImport(customers).target, "customers");
  assert.equal(looksLikePriceFile(customers), false);
  assert.equal(detectImport(customers).candidates.some((item) => item.target === "catalogue"), false, "no price column, no catalogue candidate");
});

const hit = (): CatalogueHit => ({
  id: "article-1", name: "Installationskabel 3G1,5", unit: "m", supplierArticleNo: "A-100", eNumber: "1812345", supplierName: "Min leverantör",
  price: { unitPrice: 12.5, priceDate: "2026-09-01", sourceFileName: "prislista.xlsx", importId: "import-1" },
});

test("picking an article copies price, unit, supplier, article number, source and date into the row", () => {
  const row: MaterialRow = { id: "11111111-1111-4111-8111-111111111111", name: "kabel", quantity: "25", unit: "" };
  const picked = applyArticle(row, hit());
  assert.equal(picked.name, "Installationskabel 3G1,5");
  assert.equal(picked.quantity, "25", "the quantity typed stays");
  assert.equal(picked.unit, "m");
  assert.equal(picked.unitPrice, "12,5");
  assert.deepEqual(picked.catalogue, { articleId: "article-1", supplierName: "Min leverantör", supplierArticleNo: "A-100", eNumber: "1812345", unitPrice: "12,5", unit: "m", source: "prislista.xlsx", priceDate: "2026-09-01", importId: "import-1" });
  assert.equal(priceSourceText(picked.catalogue!), "Min leverantör · art.nr A-100 · E 1812345 · prislista.xlsx, prisdatum 2026-09-01");
  // An article without a price gives no price and no source, never an invented one.
  const without = applyArticle({ ...picked }, { ...hit(), price: null });
  assert.equal(without.catalogue, undefined);
  assert.equal(without.unitPrice, undefined);
});

test("the copied price never changes when the catalogue changes, and survives saving", () => {
  const source = hit();
  const row = applyArticle({ id: "11111111-1111-4111-8111-111111111111", name: "", quantity: "2", unit: "" }, source);
  const before = JSON.stringify(row);
  // A later import, a renamed supplier or a removed article changes the catalogue's objects – never the row.
  source.price!.unitPrice = 99; source.price!.priceDate = "2026-10-08"; source.supplierName = "Annat namn"; source.name = "Ändrad";
  assert.equal(JSON.stringify(row), before);
  const saved = workOrderDataSchema.parse({ materials: [row] });
  assert.deepEqual(saved.materials[0].catalogue, row.catalogue);
  assert.equal(saved.materials[0].unitPrice, "12,5");
  // Rows from before the catalogue read as before.
  assert.equal(workOrderDataSchema.parse({ materials: [{ id: row.id, name: "Dosa", quantity: "1", unit: "st" }] }).materials[0].catalogue, undefined);
  assert.throws(() => workOrderDataSchema.parse({ materials: [{ ...row, catalogue: { ...row.catalogue, priceDate: "i går" } }] }), "a price date is ÅÅÅÅ-MM-DD");
});

test("an old price date is pointed out", () => {
  assert.equal(priceAgeMonths("2026-07-08", TODAY), 3);
  assert.equal(priceAgeMonths("2026-07-09", TODAY), 2);
  assert.equal(priceAgeHint("2026-07-08", TODAY), "Prisdatum äldre än 3 månader – kontrollera priset");
  assert.equal(priceAgeHint("2026-09-01", TODAY), "");
  assert.equal(priceAgeHint("2025-10-08", TODAY, 12), "Prisdatum äldre än 12 månader – kontrollera priset");
  assert.equal(priceAgeHint("okänt", TODAY), "");
});

const caller = (permissions: WorkflowPermissionProfile, admin = false, storageMode = "HINTEK_CLOUD") => ({ admin, permissions, storageMode });
const rejects = (status: number) => (error: unknown) => error instanceof ApiError && error.status === status;

test("the catalogue follows the rights model: read, pick from a work order, edit", () => {
  assert.deepEqual(catalogueAccess(caller(noWorkflowPermissionProfile())), { read: false, pick: false, edit: false });
  assert.deepEqual(catalogueAccess(caller(defaultWorkflowPermissionProfile())), { read: true, pick: true, edit: true });
  assert.deepEqual(catalogueAccess(caller(noWorkflowPermissionProfile(), true)), { read: true, pick: true, edit: true }, "an admin may do everything");
  // A member who may edit work orders may pick an article, also with a profile saved before the catalogue existed.
  assert.deepEqual(catalogueAccess(caller({ version: 1, grants: ["work-order:read", "work-order:edit"] })), { read: false, pick: true, edit: false });
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;
  assert.deepEqual(catalogueAccess(caller(field)), { read: true, pick: true, edit: false }, "Utföra arbete sees the catalogue but does not import");
  assert.throws(() => requireCatalogue(caller(field), "edit"), rejects(403));
  assert.throws(() => requireCatalogue(caller(noWorkflowPermissionProfile()), "pick"), rejects(403));
  requireCatalogue(caller(field), "pick");
  // Local companies keep their data on their own computer: the catalogue says it is Cloud only, even for an admin.
  assert.throws(() => requireCatalogue(caller(defaultWorkflowPermissionProfile(), true, "LOCAL"), "read"), (error: unknown) => error instanceof ApiError && error.status === 409 && /bara med serverlagring/.test(error.message));
});

test("every catalogue query on the server is bound to the caller's company", () => {
  // Tenant scoping, statically: each Prisma call on a catalogue table names the organization (the composite keys in the
  // schema refuse a cross-company link in the database as well, see tests/tenant-schema.test.ts).
  // Prisfiler etapp 1 (2026-10-12): the import, the product links and the search live in modules of their own.
  const source = ["lib/catalogue/server.ts", "lib/catalogue/import-file.ts", "lib/catalogue/products.ts", "lib/catalogue/search.ts"].map((file) => readFileSync(file, "utf8")).join("\n");
  const calls = [...source.matchAll(/(?:prisma|tx)\.catalogue(\w+)\.(findMany|findFirst|findUnique|count|create|createMany|update|updateMany|upsert|delete|deleteMany)\(\{([\s\S]*?)\}\);?\n/g)];
  assert.ok(calls.length >= 12, `found ${calls.length} catalogue calls`);
  for (const [text, model, method, body] of calls) {
    // A delete or update by an id that was just read or created within the company is the one allowed form without it.
    const byCheckedId = /^(delete|update)$/.test(method) && /where: \{ id: (found|supplier|imported)\.id \}/.test(body);
    assert.ok(/organizationId/.test(body) || byCheckedId, `catalogue${model}.${method} without organizationId: ${text.slice(0, 160)}`);
  }
  // The latest prices, the inserts, the product links and the offers are SQL of their own, bound to the company as well.
  const raw = [...source.matchAll(/\$(?:queryRaw|executeRaw)[\s\S]*?`;/g)].filter(([query]) => !/^\$queryRaw<[^>]*>\(build/.test(query) && !/^\$executeRaw`SET LOCAL /.test(query));
  assert.ok(raw.length >= 10, `found ${raw.length} raw queries`);
  // A query reads within the company; an insert writes the caller's company into every row.
  for (const [query] of raw) assert.ok(/"organizationId" = \$\{(organizationId|reader\.organizationId)\}/.test(query) || /INSERT INTO "Catalogue\w+" \("id", "organizationId"[^)]*\)\s+SELECT u\."id", \$\{organizationId\}/.test(query), query.slice(0, 120));
  // The search used by the material row is bound to the company too (its SQL is built in search-sql.ts).
  const search = readFileSync("lib/catalogue/search-sql.ts", "utf8");
  assert.equal(search.match(/a\."organizationId" = \$\{(input\.)?organizationId\}/g)?.length, 2, "the search and the page's list");
});

// ---------- Pris ändrat (2026-10-08): a re-import stores a new price only when the price changed ----------

const LIST = ["Artikelnummer", "Benämning", "Enhet", "Nettopris", "Prisenhet", "Prisdatum"];
const listRows = (count: number, price = (index: number) => `${(index % 500) + 1},25`, date = "2026-09-01") =>
  Array.from({ length: count }, (_, index) => [`A${String(index).padStart(6, "0")}`, `Artikel ${index}`, "st", price(index), "1", date]);
/** The catalogue as the import would find it after importing these rows: every article with its latest price. */
const asCatalogue = (rows: ReturnType<typeof parseCatalogueRows>["rows"]) =>
  new Map<string, ExistingArticle>(rows.map((row, index) => [row.articleKey, { id: `art-${index}`, latest: { priceId: `price-${index}`, amount: row.amount, perQuantity: row.perQuantity } }]));

test("the same price is the same amount for the same per-quantity; the date never makes a price changed", () => {
  assert.equal(samePrice({ amount: 12.5, perQuantity: 1 }, { amount: 12.5, perQuantity: 1 }), true);
  assert.equal(samePrice({ amount: 12.5, perQuantity: 1 }, { amount: 12.50001, perQuantity: 1 }), true, "compared at the four decimals the database keeps");
  assert.equal(samePrice({ amount: 12.5, perQuantity: 1 }, { amount: 12.51, perQuantity: 1 }), false);
  assert.equal(samePrice({ amount: 1250, perQuantity: 100 }, { amount: 1250, perQuantity: 1000 }), false, "another per-quantity is another price");
});

test("a re-import counts new articles, changed prices and unchanged (confirmed) prices", () => {
  const mapping = suggestCatalogueMapping(LIST);
  const first = parseCatalogueRows(LIST, listRows(10), mapping, TODAY).rows;
  const catalogue = asCatalogue(first);
  // Identical file: nothing new, nothing changed, every price only confirmed on the file's date.
  const same = classifyCatalogueRows(parseCatalogueRows(LIST, listRows(10, undefined, "2026-10-01"), mapping, TODAY).rows, catalogue);
  assert.deepEqual([same.newArticles, same.changedPrices, same.unchangedPrices, same.created.length, same.changed.length], [0, 0, 10, 0, 0]);
  assert.deepEqual(same.confirmed[3], { articleId: "art-3", priceId: "price-3", row: same.confirmed[3].row });
  assert.equal(same.confirmed[3].row.priceDate, "2026-10-01", "the confirmation carries the new file's date");
  // Two prices changed, one per-quantity changed, two new articles; one article missing from the file is simply left out.
  const rows = listRows(9).map((row, index) => (index === 1 ? [...row.slice(0, 3), "999,00", ...row.slice(4)] : index === 2 ? [...row.slice(0, 3), "1,00", ...row.slice(4)] : index === 4 ? [...row.slice(0, 4), "10", row[5]] : row));
  rows.push(["NY-1", "Ny artikel", "st", "5", "1", "2026-10-01"], ["NY-2", "Ny artikel 2", "m", "7", "1", "2026-10-01"]);
  const mixed = classifyCatalogueRows(parseCatalogueRows(LIST, rows, mapping, TODAY).rows, catalogue);
  assert.deepEqual([mixed.newArticles, mixed.changedPrices, mixed.unchangedPrices], [2, 3, 6]);
  assert.deepEqual(mixed.changed.map((item) => item.articleId), ["art-1", "art-2", "art-4"]);
  assert.deepEqual(mixed.created.map((row) => row.articleKey), ["NY-1", "NY-2"]);
  assert.equal(mixed.confirmed.some((item) => item.articleId === "art-9"), false, "an article missing from the file gets no row and no confirmation");
  // An article without any price gets a price, not a confirmation.
  const bare = classifyCatalogueRows(first.slice(0, 1), new Map([[first[0].articleKey, { id: "bare", latest: null }]]));
  assert.deepEqual([bare.changedPrices, bare.unchangedPrices], [1, 0]);
});

test("the preview's counts against a supplier follow from the articles it already has", () => {
  assert.deepEqual(countsAgainst(100, { matched: 90, unchanged: 85 }), { newArticles: 10, changedPrices: 5, unchangedPrices: 85 });
  assert.deepEqual(countsAgainst(100, undefined), { newArticles: 100, changedPrices: 0, unchangedPrices: 0 }, "a supplier without these articles, or a new one");
});

test("a price list of 200 000 rows read twice: the second time is all confirmations, compared in one pass", () => {
  const mapping = suggestCatalogueMapping(LIST);
  const raw = listRows(200_000);
  const started = performance.now();
  const first = parseCatalogueRows(LIST, raw, mapping, TODAY);
  const again = classifyCatalogueRows(parseCatalogueRows(LIST, raw, mapping, TODAY).rows, asCatalogue(first.rows));
  const elapsed = performance.now() - started;
  assert.deepEqual([again.newArticles, again.changedPrices, again.unchangedPrices], [0, 0, 200_000]);
  assert.ok(elapsed < 15_000, `two reads and the comparison took ${Math.round(elapsed)} ms`);
});

test("the price date says when the price was set; a later confirmation is shown and counts for the age hint", () => {
  const price = { priceDate: "2026-05-01", confirmedDate: "2026-10-01" };
  assert.equal(checkedDate(price), "2026-10-01");
  assert.equal(checkedDate({ priceDate: "2026-05-01" }), "2026-05-01");
  assert.equal(checkedDate({ priceDate: "2026-05-01", confirmedDate: "2026-04-01" }), "2026-05-01", "an earlier confirmation never moves the date back");
  assert.equal(priceDateText(price), "prisdatum 2026-05-01, bekräftad 2026-10-01");
  assert.equal(priceDateText({ priceDate: "2026-05-01" }), "prisdatum 2026-05-01");
  assert.equal(priceAgeHint({ priceDate: "2026-05-01" }, TODAY), "Prisdatum äldre än 3 månader – kontrollera priset");
  assert.equal(priceAgeHint(price, TODAY), "", "confirmed last week: not old");
  // The material row keeps the confirmation it was given, and saves it.
  const source = hit();
  source.price = { ...source.price!, priceDate: "2026-05-01", confirmedDate: "2026-10-01" };
  const row = applyArticle({ id: "11111111-1111-4111-8111-111111111111", name: "", quantity: "1", unit: "" }, source);
  assert.equal(row.catalogue?.confirmedDate, "2026-10-01");
  assert.equal(priceSourceText(row.catalogue!), "Min leverantör · art.nr A-100 · E 1812345 · prislista.xlsx, prisdatum 2026-05-01, bekräftad 2026-10-01");
  assert.equal(workOrderDataSchema.parse({ materials: [row] }).materials[0].catalogue?.confirmedDate, "2026-10-01");
  assert.equal(applyArticle(row, hit()).catalogue?.confirmedDate, undefined, "a price never confirmed has no confirmation");
});
