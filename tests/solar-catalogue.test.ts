import assert from "node:assert/strict";
import test from "node:test";
import { forgetSolarToken, lookupSolarProduct, solarMasterData } from "../lib/integrations/solar";
import { parseStoredServerKeys, serverSetting, serverSettingProblem, withServerSecret, withServerSetting } from "../lib/integrations/server-secret-values";
import { identifierOfQuery } from "../lib/catalogue/master-data";

// Solars katalog i artikelsökningen (2026-10-14): master data only, never a price; the catalogue number is a
// product-owner setting and is never guessed. Invented answers – no call leaves the test.

const config = { clientId: "00000000-0000-0000-0000-000000000000", clientSecret: "påhittad-hemlighet", catalogId: "12" };
const answer = { name: "Påhittad dvärgbrytare", electricalNo: "1000001", gtin: "7300000000004", brandName: "Påhittad Tillverkare", manufacturerPartNumber: "PT-16", salesUnitofMeasure: "ST",
  imageLinks: [{ url: "https://example.invalid/bild.jpg", linkNumber: 1 }], listPrice: 999, listPriceCurrency: "SEK", productStatus: "Active" };

function fakeFetch(product: { status: number; body?: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200 });
    return new Response(product.body === undefined ? "" : JSON.stringify(product.body), { status: product.status });
  }) as typeof fetch;
  return { fetcher, calls };
}

test("a product by E-nummer: master data, never the list price", async () => {
  forgetSolarToken();
  const { fetcher, calls } = fakeFetch({ status: 200, body: answer });
  const result = await lookupSolarProduct(config, { kind: "electricalNumber", value: "1000001" }, fetcher);
  assert.equal(result.status, "found");
  if (result.status !== "found") return;
  assert.equal(result.data.name, "Påhittad dvärgbrytare");
  assert.equal(result.data.manufacturer, "Påhittad Tillverkare");
  assert.equal(result.data.manufacturerArticleNo, "PT-16");
  assert.equal(result.data.gtin, "7300000000004");
  assert.equal(result.data.imageUrl, "https://example.invalid/bild.jpg");
  assert.ok(!JSON.stringify(result.data).includes("999"), "the list price is never read");
  const product = calls.find((call) => call.url.includes("/catalogs/"))!;
  assert.match(product.url, /\/catalogs\/12\/products\/1000001\?countrycode=SE&productIdentifier=electricalNumber$/);
  assert.equal((product.init?.headers as Record<string, string>).Authorization, "Bearer token-1");
  // The secret only in the token request's body, never in an address.
  assert.ok(calls.every((call) => !call.url.includes(config.clientSecret)));
});

test("not found, a missing catalogue number and an error say so in plain words", async () => {
  forgetSolarToken();
  assert.equal((await lookupSolarProduct(config, { kind: "eanNumber", value: "7300000000004" }, fakeFetch({ status: 404 }).fetcher)).status, "not-found");
  const none = fakeFetch({ status: 200, body: answer });
  const missing = await lookupSolarProduct({ ...config, catalogId: "" }, { kind: "electricalNumber", value: "1000001" }, none.fetcher);
  assert.deepEqual(missing, { status: "error", message: "Solars katalognummer är inte inställt." });
  assert.equal(none.calls.length, 0, "nothing is asked without the catalogue number");
  forgetSolarToken();
  assert.equal((await lookupSolarProduct(config, { kind: "electricalNumber", value: "1000001" }, fakeFetch({ status: 500 }).fetcher)).status, "error");
});

test("solarMasterData needs a name and takes only https image links", () => {
  assert.equal(solarMasterData({ electricalNo: "1" }), null);
  assert.equal(solarMasterData({ ...answer, imageLinks: [{ url: "http://example.invalid/x.jpg" }] })!.imageUrl, "");
});

test("a search is looked up only when it is a whole E-nummer or GTIN", () => {
  assert.deepEqual(identifierOfQuery("E1000001"), { kind: "electricalNumber", value: "1000001" });
  assert.deepEqual(identifierOfQuery("1000001"), { kind: "electricalNumber", value: "1000001" });
  // Solar's SAP material number is ten digits (2026-10-15), as in Solar's own examples; it fits the documented int32 productId.
  assert.deepEqual(identifierOfQuery("1200873368"), { kind: "sapMaterialNumber", value: "1200873368" });
  assert.equal(identifierOfQuery("12345678901"), null, "eleven digits is nothing Solar can look up");
  assert.deepEqual(identifierOfQuery("7300000000004"), { kind: "eanNumber", value: "7300000000004" });
  assert.equal(identifierOfQuery("100000"), null);
  assert.equal(identifierOfQuery("kabel"), null);
  assert.equal(identifierOfQuery("7300000000005"), null, "a GTIN with a wrong check digit is not looked up");
});

test("the catalogue number is a setting beside the key: a whole number, kept when a key is saved", () => {
  assert.equal(serverSettingProblem("solarCatalogId", "12"), null);
  assert.ok(serverSettingProblem("solarCatalogId", "abc"));
  const withId = withServerSetting({}, "solarCatalogId", "12", "Superadmin");
  const afterKey = parseStoredServerKeys(withServerSecret(withId, "solarClientId", "x", (value) => `sealed:${value}`, "Superadmin"));
  assert.equal(serverSetting(afterKey, "solarCatalogId"), "12");
  assert.equal(serverSetting(withServerSetting(afterKey, "solarCatalogId", null, "Superadmin"), "solarCatalogId"), "");
});

// The live answer 2026-10-16 had no name at the top: the product is read inside its wrapper and from more name fields.
test("Solar's product is read inside product / products and from its other name fields", async () => {
  const { solarMasterData } = await import("../lib/integrations/solar");
  const now = new Date("2026-10-16T12:00:00Z");
  assert.equal(solarMasterData({ product: { productName: "Påhittad dosa", electricalNumber: "1234567" } }, now)?.name, "Påhittad dosa");
  assert.equal(solarMasterData({ products: [{ description: "Påhittad kabel" }] }, now)?.name, "Påhittad kabel");
  assert.equal(solarMasterData([{ descriptions: [{ language: "sv", text: "Påhittad säkring" }] }], now)?.name, "Påhittad säkring");
  assert.equal(solarMasterData({ product: { productName: "Dosa", electricalNumber: "1234567" } }, now)?.eNumber, "1234567");
  assert.equal(solarMasterData({ listPrice: 12 }, now), null, "no name, no product");
});

// The live answer (2026-10-16) as Kontrollera listed its fields: capital first letters.
test("Solar's capitalised field names are read like the documented ones", async () => {
  const { solarMasterData, solarStockOf } = await import("../lib/integrations/solar");
  const now = new Date("2026-10-16T12:00:00Z");
  const data = solarMasterData({ Name: "Påhittad dosa", ElectricalNo: "0665009", Gtin: "7300000000004", BrandName: "Påhittat", ManufacturerPartNumber: "PD-1", SalesUnitofMeasure: "ST", ProductStatus: "10", ImageLinks: [{ Url: "https://example.invalid/b.png" }], ListPrice: 99 }, now);
  assert.deepEqual([data?.name, data?.eNumber, data?.gtin, data?.manufacturer, data?.manufacturerArticleNo, data?.unit, data?.status, data?.imageUrl], ["Påhittad dosa", "0665009", "7300000000004", "Påhittat", "PD-1", "st", "10", "https://example.invalid/b.png"]);
  assert.equal(JSON.stringify(data).includes("99"), false, "never the price");
  assert.equal(solarStockOf([{ ProductId: "0665009", AtpStock: 12, UnitCode: "ST" }], now)[0]?.stock, 12);
});

// Solar live 2026-10-16: "Name" held the E-nummer and the unit came as PCE; the words are the description, the unit "st".
test("a Name that is only the number gives way to the description, and the unit code is the trade's", async () => {
  const { solarMasterData } = await import("../lib/integrations/solar");
  const data = solarMasterData({ Name: "0665009", MaterialDescription: "Kabelrörsskydd Capps 50 mm", ElectricalNo: "0665009", SalesUnitofMeasure: "PCE", BrandName: "ELEKTROSKUTT" });
  assert.deepEqual([data?.name, data?.unit, data?.manufacturer], ["Kabelrörsskydd Capps 50 mm", "st", "ELEKTROSKUTT"]);
});
