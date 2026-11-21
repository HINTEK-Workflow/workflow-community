import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseRegisterQuery, registerSearchText, technicalText } from "../lib/catalogue/register-text";
import { buildRegisterSearchSql } from "../lib/catalogue/register-sql";
import { catalogHitOf, registerJoinKeys, withRegister, type RegisterArticleRow } from "../lib/catalogue/register-hit";
import { nextRegisterRun, registerRowOf, stockholmHour } from "../lib/catalogue/register-sync";
import { fetchSolarProductPage, solarNextPage, solarProductsPageUrl, solarRegisterArticle } from "../lib/integrations/solar";
import type { CatalogueHit } from "../lib/catalogue/snapshot";

/**
 * Gemensamt artikelregister (2026-10-17): the pure parts – the same technical form on both sides, Solar's article
 * read into the register's fields and never its price, the search SQL with parameters only, a register hit without a price,
 * the keys a company's own price joins on, and when the scheduled job runs. The data is made up.
 */

test("technical notations become one form on both sides", () => {
  for (const [input, expected] of [
    ["Installationskabel 3G2,5 Grå", "installationskabel 3g2.5 gra"], ["kabel 3G 2,5", "kabel 3g2.5"], ["3x2,5", "3g2.5"], ["3G2.5mm²", "3g2.5mm2"],
    ["Minikontaktor 9 A, 4 kW", "minikontaktor 9a, 4kw"], ["C 16 automatsäkring", "c16 automatsakring"], ["3 - fas", "3fas"], ["3-polig", "3polig"],
    ["IP 44 uttag", "ip44 uttag"], ["30 mA", "30ma"], ["FK 1x16", "fk 1g16"], ["låda 200x300 mm", "lada 200x300mm"],
  ] as const) assert.equal(technicalText(input), expected, input);
  // A query is normalised before it is split, so "3G 2,5" is one word that meets "3G2,5" in an article.
  assert.deepEqual(parseRegisterQuery("kabel 3G 2,5").words.map((word) => word.text), ["kabel", "3g2.5"]);
  assert.deepEqual(parseRegisterQuery("C 16").words.map((word) => word.text), ["c16"]);
});

test("synonyms widen the query, never the stored text", () => {
  const [word] = parseRegisterQuery("automatsäkring").words;
  assert.ok(word.alternatives.includes("dvargbrytare") && word.alternatives.includes("mcb"));
  assert.ok(parseRegisterQuery("3-fas").words[0].alternatives.includes("trefas"));
  assert.deepEqual(parseRegisterQuery("kontaktdon").words[0].alternatives, ["kontaktdon"], "a word without synonyms is itself");
  const text = registerSearchText({ name: "DVÄRGBRYTARE C16", description: "Dvärgbrytare 1-pol C 16 A", productType: "Dvärgbrytare", manufacturer: "Tillverkare", series: "S200", articleNo: "1234567890", eNumber: "1234567", manufacturerArticleNo: "S-201 C16" });
  assert.match(text, /^dvargbrytare c16 /, "the name first, folded");
  assert.ok(text.includes("1pol c16a") && text.includes("s201c16") && text.includes("1234567890"));
  assert.ok(!text.includes("mcb"), "no synonym is stored");
});

const solarProduct = (overrides: Record<string, unknown> = {}) => ({
  SapMaterialNumber: "1000000017", ElectricalNo: "1234567", Gtin: "4006381333931", BrandName: "Tillverkare", ManufacturerPartNumber: "MS-25",
  Name: "1234567", LocalMaterialDescription: "1234567", MaterialName: "MOTORSKYDD 25A", MaterialDescription: "Motorskydd 3-pol 20–25 A",
  LongProductDescription: "Lång text som inte sparas.", EtimClass: "EC000074", EtimFeatures: { Id: "SC000074", Name: "Motorskyddsbrytare", Features: [{ Name: "Höjd", Value: 90 }] },
  Series: "MS", Unit: "PCE", BaseUnitofMeasure: "PCE", SalesUnitofMeasure: null, ProductStatus: "10", LastChanged: 1789997290,
  ListPrice: 1234.5, ListPriceCurrency: "SEK", ListPriceQuantity: 1, ListPriceUnit: "PCE", ImageLinks: [{ Url: "https://example.invalid/bild.jpg" }],
  ...overrides,
});

test("a Solar article is read into the register's fields – never its price", () => {
  const article = solarRegisterArticle(solarProduct())!;
  assert.deepEqual(article, {
    articleNo: "1000000017", eNumber: "1234567", gtin: "04006381333931", manufacturer: "Tillverkare", manufacturerArticleNo: "MS-25",
    name: "MOTORSKYDD 25A", description: "Motorskydd 3-pol 20–25 A", productType: "Motorskyddsbrytare", etimClass: "EC000074", series: "MS", unit: "st", status: "10",
    lastChanged: new Date(1789997290 * 1000),
  });
  assert.doesNotMatch(JSON.stringify(article), /1234\.5|SEK|price/i, "nothing of the price is kept");
  assert.equal(solarRegisterArticle(solarProduct({ SapMaterialNumber: "" })), null, "without Solar's number there is no register row");
  const loose = solarRegisterArticle(solarProduct({ ElectricalNo: "12345", Gtin: "4006381333932" }))!;
  assert.equal(loose.eNumber, "", "an E-nummer has seven digits");
  assert.equal(loose.gtin, "", "a GTIN with a wrong check digit is left out");
  // The portal's spelling (small first letter) reads the same.
  assert.equal(solarRegisterArticle({ sapMaterialNumber: "42", materialName: "Liten" })?.name, "Liten");
  const row = registerRowOf(article);
  assert.equal(row.productKey, "E:1234567", "the product key of the import's rule");
  assert.equal(row.mpnNorm, "ms25");
  assert.match(row.searchText, /motorskyddsbrytare/, "the product type is searchable ('motorskydd' is only there in Solar's data)");
});

test("the cursor is read from the Link header and every page asks with the same parameters", () => {
  assert.equal(solarNextPage('<https://api.solar.eu/procurement/V1/catalogs/1/products?nextpage=abc%3D%3D&limit=1000&countrycode=SE>; rel="next"'), "abc==");
  assert.equal(solarNextPage('<https://x.invalid/a?nextpage=1>; rel="prev", <https://x.invalid/a?nextpage=2>; rel="next"'), "2");
  assert.equal(solarNextPage(null), "");
  assert.equal(solarNextPage('<https://x.invalid/a?limit=1>; rel="next"'), "");
  const url = solarProductsPageUrl("3016431", "SE", { limit: 1000, nextPage: "abc==", lastChanged: new Date(1_790_000_000_000), ignoreObsolete: true });
  assert.equal(url, "https://api.solar.eu/procurement/V1/catalogs/3016431/products?countrycode=SE&limit=1000&nextpage=abc%3D%3D&lastChanged=1790000000&ignoreObsoleteProducts=true");
});

test("a page of Get Products becomes register rows, and errors are said in plain words", async () => {
  const body = JSON.stringify([solarProduct(), solarProduct({ SapMaterialNumber: "1000000018" }), { Name: "utan nummer" }]);
  let asked = "";
  const page = await fetchSolarProductPage("token", { catalogId: "1", countryCode: "SE" }, { limit: 5000 }, (async (url: string) => {
    asked = url;
    return new Response(body, { status: 200, headers: { link: '<https://api.solar.eu/x?nextpage=n2>; rel="next"' } });
  }) as typeof fetch);
  assert.ok(page.ok);
  assert.equal(page.articles.length, 2);
  assert.equal(page.skipped, 1);
  assert.equal(page.nextPage, "n2");
  assert.match(asked, /limit=1000/, "at most 1000 per page");
  const denied = await fetchSolarProductPage("token", { catalogId: "1", countryCode: "SE" }, {}, (async () => new Response("", { status: 403 })) as typeof fetch);
  assert.deepEqual(denied, { ok: false, status: 403, message: "Solar gav inte tillgång till katalogen." });
});

test("the register search is parameters only, hides obsolete and unfinished rows, and widens with synonyms", () => {
  const sql = buildRegisterSearchSql({ query: parseRegisterQuery("automatsäkring c16 '; DROP TABLE x; --"), limit: 999, mode: "match" });
  assert.doesNotMatch(sql.sql, /DROP TABLE|automatsakring|dvargbrytare/, "words never in the SQL text");
  assert.match(sql.sql, /"pendingRun" IS NULL AND w\."status" <> '40'/);
  assert.ok(sql.values.includes("%dvargbrytare%") && sql.values.includes("%mcb%"));
  assert.ok(sql.values.includes(50), "bounded to 50");
  const numbers = buildRegisterSearchSql({ query: parseRegisterQuery("1234567"), limit: 20, mode: "match" });
  assert.match(numbers.sql, /w\."eNumber" = /);
  const typo = buildRegisterSearchSql({ query: parseRegisterQuery("motorskyd"), limit: 20, mode: "typo", trigram: "public" });
  assert.match(typo.sql, /"public"\.word_similarity/);
});

const registerRow = (overrides: Partial<RegisterArticleRow> = {}): RegisterArticleRow => ({
  id: "w1", seq: 1, wholesaler: "solar", articleNo: "1000000017", eNumber: "1234567", gtin: "04006381333931", manufacturer: "Tillverkare", manufacturerArticleNo: "MS-25",
  name: "MOTORSKYDD 25A", description: "Motorskydd 3-pol 20–25 A", productType: "Motorskyddsbrytare", series: "MS", unit: "st", status: "33", productKey: "E:1234567", ...overrides,
});

test("a register article no price file has is a hit without a price; with the company's product it is the company's hit", () => {
  const hit = catalogHitOf(registerRow());
  assert.equal(hit.id, "solar:1000000017");
  assert.equal(hit.price, null);
  assert.equal(hit.catalogOnly, true);
  assert.equal(hit.name, "Motorskydd 3-pol 20–25 A", "the description reads better than the terse short name");
  assert.equal(hit.supplierName, "Solars katalog");
  assert.deepEqual(hit.common, { kind: "E", number: "1234567" });
  assert.equal(hit.product?.statusText, "", "a wholesaler's status is never the product's");
  assert.equal(hit.offers?.[0].catalog?.statusText, "På väg att utgå hos Solar", "it is the wholesaler's own row's");
  assert.equal(hit.catalog?.productType, "Motorskyddsbrytare");
  const own: CatalogueHit = { id: "a1", name: "Motorskydd 25 A", unit: "st", supplierArticleNo: "S-1", eNumber: "1234567", supplierName: "Leverantör", price: { unitPrice: 312.5, priceDate: "2026-10-01", sourceFileName: "f.csv", importId: "i1" } };
  const joined = withRegister(own, registerRow());
  assert.equal(joined.price?.unitPrice, 312.5, "the company's own price stays");
  assert.equal(joined.name, "Motorskydd 25 A", "and its own name");
  assert.equal(joined.catalogOnly, undefined);
  // The supplier is no known wholesaler, so Solar's row is added beside it, without a price – never merged into it.
  assert.deepEqual(joined.offers!.map((item) => [item.supplierName, item.catalog?.articleNo ?? "", item.price?.unitPrice ?? null]), [["Leverantör", "", 312.5], ["Solars katalog", "1000000017", null]]);
});

test("a company's price joins only on safe keys", () => {
  assert.deepEqual(registerJoinKeys(registerRow()), ["E:1234567", "GTIN:04006381333931", "W:solar:1000000017"]);
  assert.deepEqual(registerJoinKeys(registerRow({ eNumber: "", gtin: "", productKey: "MPN:tillverkare:ms25" })), ["MPN:tillverkare:ms25", "W:solar:1000000017"]);
});

test("the scheduled job does nothing until a full import is asked for, then keeps to the night", () => {
  const night = new Date("2026-10-18T01:30:00+02:00");
  const day = new Date("2026-10-18T14:00:00+02:00");
  assert.equal(stockholmHour(night), 1);
  const empty = { lastFullAt: null, syncedFrom: null, requestedKind: null, runId: null, runHeartbeatAt: null, apiEnabled: true };
  assert.equal(nextRegisterRun(null, night), null, "no first import by itself");
  assert.equal(nextRegisterRun({ ...empty, apiEnabled: false, requestedKind: "full" }, day), null, "an inactive API connection starts nothing");
  const past = new Date("2026-10-10T02:00:00+02:00");
  assert.equal(nextRegisterRun({ ...empty, apiEnabled: false, lastFullAt: past, syncedFrom: past }, night), null, "nor the night's sync");
  assert.equal(nextRegisterRun(empty, night), null);
  assert.equal(nextRegisterRun({ ...empty, requestedKind: "full" }, day), "full", "the product owner's request runs at once");
  assert.equal(nextRegisterRun({ ...empty, requestedKind: "full", runId: "r", runHeartbeatAt: new Date(day.getTime() - 60_000) }, day), null, "never two runs");
  assert.equal(nextRegisterRun({ ...empty, requestedKind: "full", runId: "r", runHeartbeatAt: new Date(day.getTime() - 3600_000) }, day), "full", "a dead run is taken over");
  const synced = { ...empty, lastFullAt: new Date("2026-10-10T02:00:00+02:00"), syncedFrom: new Date("2026-10-17T01:10:00+02:00") };
  assert.equal(nextRegisterRun(synced, night), "changes");
  assert.equal(nextRegisterRun(synced, day), null, "only at night");
  assert.equal(nextRegisterRun({ ...synced, syncedFrom: new Date("2026-10-18T01:10:00+02:00") }, night), null, "once a night");
  assert.equal(nextRegisterRun({ ...synced, lastFullAt: new Date("2026-09-10T02:00:00+02:00") }, night), "full", "the monthly check");
});

test("the register is global product data: no company, no price, an additive migration", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  for (const model of ["WholesaleArticle", "WholesaleRegisterSync"]) {
    const body = new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, "m").exec(schema)?.[1] ?? "";
    assert.ok(body, model);
    assert.doesNotMatch(body, /organizationId/, `${model} belongs to no company`);
    // The back-relation to the companies' price rows (`prices WholesalePrice[]`, 2026-10-17) is not a price column: no price is stored here.
    assert.doesNotMatch(body.replace(/^\s+prices\s+WholesalePrice\[\]\s*$/m, ""), /^\s+\w*[pP]rice\w*\s/m, `${model} has no price column`);
  }
  const sql = readFileSync("prisma/migrations/20261017150000_wholesale_register/migration.sql", "utf8");
  assert.doesNotMatch(sql, /^\s*(DELETE|UPDATE|TRUNCATE|DROP|ALTER TABLE "(?!Wholesale))/im, "nothing existing is changed");
  assert.doesNotMatch(sql, /^s+"w*[pP]ricew*"s/m, "no price column");
});

test("the company's own search of the register is an EXISTS on its price rows, in the match pass and after the candidates in the typo pass", () => {
  const plain = buildRegisterSearchSql({ query: parseRegisterQuery("kabel"), limit: 20, mode: "match" });
  assert.doesNotMatch(plain.text, /WholesalePrice/, "a search that is not the company's reads no price");
  const mine = buildRegisterSearchSql({ query: parseRegisterQuery("kabel"), limit: 20, mode: "match", priced: { organizationId: "org-1" } });
  assert.match(mine.text, /w\."pendingRun" IS NULL AND EXISTS \(SELECT 1 FROM "WholesalePrice" p WHERE p\."organizationId" = \$\d+ AND p\."seq" = w\."seq"\)/);
  assert.doesNotMatch(mine.text, /<> '40'/, "an obsolete article the company has a price on is kept");
  assert.ok(mine.values.includes("org-1"), "always bound to the company");
  assert.doesNotMatch(mine.text, /org-1/, "and as a parameter, never as text");
  const supplier = buildRegisterSearchSql({ query: parseRegisterQuery("kabel"), limit: 20, mode: "match", priced: { organizationId: "org-1", supplierId: "sup-1" } });
  assert.match(supplier.text, /FROM "CatalogueImport" i WHERE i\."id" = p\."importId" AND i\."organizationId" = p\."organizationId" AND i\."supplierId" = \$\d+/);
  assert.ok(supplier.values.includes("sup-1"));
  // The typo pass picks its candidates by their words first (bounded), and filters on the price after them.
  const typo = buildRegisterSearchSql({ query: parseRegisterQuery("kontaktr"), limit: 20, mode: "typo", trigram: "public", priced: { organizationId: "org-1" } });
  const limitAt = typo.text.indexOf("LIMIT $");
  assert.ok(limitAt > 0 && typo.text.indexOf("EXISTS (SELECT 1 FROM \"WholesalePrice\"") > limitAt, "the price filter comes after the candidate limit");
  assert.match(typo.text, /w\."status" <> '40'/, "obsolete articles are not typo candidates");
});
