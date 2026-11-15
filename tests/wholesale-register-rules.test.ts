import assert from "node:assert/strict";
import test from "node:test";
import { catalogHitOf, isWholesaleOfferId, parseWholesaleOfferId, registerLinkOf, withRegister, withRegisters, wholesaleOfferId, wholesaleOfferOf, type PricedOffers, type RegisterArticleRow } from "../lib/catalogue/register-hit";
import type { WholesaleOffer } from "../lib/catalogue/wholesale-read";
import { applyArticle, hitProductType, linkedWholesaleIds, offerWarning, pickOffer, type CatalogueOffer } from "../lib/catalogue/snapshot";
import { wholesaleApi, wholesaleApis } from "../lib/integrations/wholesale-api";
import { serverKeyStatuses } from "../lib/integrations/server-keys";

/**
 * Grossistkopplingar (2026-10-17): every wholesaler keeps its own row, article number, status and price; the same
 * E-nummer only gathers the rows into one product. Prices are compared only between offers of the same unit and package.
 * An uncertain link is said, not guessed. Only Solar has a connected API. The data is made up.
 */
const registerRow = (overrides: Partial<RegisterArticleRow> = {}): RegisterArticleRow => ({
  id: "w1", seq: 1, wholesaler: "solar", articleNo: "1000000017", eNumber: "1234567", gtin: "04006381333931", manufacturer: "Tillverkare", manufacturerArticleNo: "MS-25",
  name: "MOTORSKYDD 25A", description: "Motorskydd 3-pol 20–25 A", productType: "Motorskyddsbrytare", series: "MS", unit: "st", status: "33", productKey: "E:1234567", ...overrides,
});
const price = (unitPrice: number, id: string) => ({ unitPrice, priceDate: "2026-10-01", sourceFileName: `${id}.xlsx`, importId: id });
const offer = (overrides: Partial<CatalogueOffer> = {}): CatalogueOffer => ({
  id: "o1", name: "Motorskydd", unit: "st", supplierArticleNo: "REX-98765", eNumber: "1234567", supplierName: "Rexel Sverige AB", wholesaler: "rexel", price: price(112, "i1"), ...overrides,
});

test("Rexel's price never reaches Solar's row, and Solar's status stays on Solar's row", () => {
  const rexelOffer = offer();
  const joined = withRegister({ ...rexelOffer, offers: [rexelOffer] }, registerRow({ status: "40" }));
  assert.equal(joined.offers?.length, 2, "two rows for the one product: Rexel's own and Solar's");
  const rexelRow = joined.offers!.find((item) => item.supplierName.startsWith("Rexel"))!;
  const solarRow = joined.offers!.find((item) => item.catalogOnly)!;
  assert.equal(rexelRow.price?.unitPrice, 112, "Rexel keeps its own price");
  assert.equal(solarRow.price, null, "Solar's row has no price from Rexel's file");
  assert.equal(solarRow.supplierArticleNo, "1000000017", "and Solar's own article number");
  assert.equal(rexelRow.supplierArticleNo, "REX-98765", "Rexel keeps its own");
  assert.equal(offerWarning(solarRow), "Utgången hos Solar", "the status is on Solar's row");
  assert.equal(offerWarning(rexelRow), "", "and not on Rexel's");
  assert.equal(rexelRow.catalog, undefined);
});

test("a link to the register is certain only inside the same wholesaler, on its own number or the same E-nummer and unit", () => {
  const row = registerRow();
  const company = { wholesaler: "solar" as const, supplierName: "Solar", supplierArticleNo: "1000000017", eNumber: "", unit: "st" };
  assert.equal(registerLinkOf(row, company), "own", "Solar's own number, exactly");
  assert.equal(registerLinkOf(row, { ...company, supplierArticleNo: "0000000017" }), "product", "a number that only ends the same is no link");
  assert.equal(registerLinkOf(row, { ...company, supplierArticleNo: "SOL-1", eNumber: "1234567" }), "own", "the same E-nummer and unit at Solar");
  assert.equal(registerLinkOf(row, { ...company, supplierArticleNo: "SOL-1", eNumber: "1234567", unit: "m" }), "check", "the same E-nummer at Solar but another unit is for the person to check");
  assert.equal(registerLinkOf(row, { ...company, wholesaler: "rexel", supplierName: "Rexel", eNumber: "1234567" }), "product", "another wholesaler is never linked, whatever the numbers");
  assert.equal(registerLinkOf(row, { ...company, wholesaler: undefined, supplierName: "Solar Sverige AB" }), "own", "a supplier named Solar counts as Solar");
  assert.equal(registerLinkOf(row, { ...company, wholesaler: undefined, supplierName: "Solaris AB", supplierArticleNo: "X", eNumber: "1234567" }), "product", "a similar name is not Solar");
  // The uncertain link is said, not guessed: the register's row stays separate and the company's row is marked.
  const uncertain = offer({ wholesaler: "solar", supplierName: "Solar", supplierArticleNo: "SOL-1", unit: "m" });
  const joined = withRegister({ ...uncertain, offers: [uncertain] }, row);
  assert.equal(joined.offers?.length, 2);
  assert.match(offerWarning(joined.offers![0]), /annan enhet/);
  assert.equal(joined.offers![0].catalog, undefined, "no register words on an uncertain row");
});

test("prices are compared only between offers that sell the same unit and package", () => {
  const perPack = offer({ id: "a", unit: "förp", supplierName: "A", price: price(40, "a") });
  const perMeter = offer({ id: "b", unit: "m", supplierName: "B", price: price(12, "b") });
  const perMeter2 = offer({ id: "c", unit: "m", supplierName: "C", price: price(15, "c") });
  assert.equal(pickOffer([perPack, perMeter, perMeter2], { matched: "c" }).id, "b", "the matched offer's unit decides what is compared");
  assert.equal(pickOffer([perPack, perMeter], { matched: "a" }).id, "a", "a price per package is not higher than a price per metre");
  const emptyUnit = offer({ id: "d", unit: "", price: price(9, "d") });
  const pieces = offer({ id: "e", unit: "st", price: price(8, "e") });
  assert.equal(pickOffer([emptyUnit, pieces], { matched: "d" }).id, "e", "an empty unit means st, as it is shown");
});

test("one product, one row per wholesaler, whichever wholesalers the register holds", () => {
  const hit = catalogHitOf([registerRow(), registerRow({ id: "w2", seq: 2, wholesaler: "rexel", articleNo: "REX-98765", status: "" })]);
  assert.equal(hit.offers?.length, 2);
  assert.deepEqual(hit.offers!.map((item) => item.catalog?.wholesaler), ["solar", "rexel"]);
  assert.ok(hit.offers!.every((item) => item.price === null && item.catalogOnly));
  assert.equal(offerWarning(hit.offers![0]), "På väg att utgå hos Solar");
  assert.equal(offerWarning(hit.offers![1]), "", "Solar's status codes mean nothing at another wholesaler");
  assert.equal(hitProductType(hit), "Motorskyddsbrytare");
  const rexelOffer = offer();
  assert.equal(withRegisters({ ...rexelOffer, offers: [rexelOffer] }, [registerRow()]).offers!.length, 2);
});

test("only Solar has a connected API; Ahlsell, Rexel and Sonepar are prepared and can never start an import", async () => {
  assert.deepEqual(wholesaleApis().map((api) => `${api.wholesaler}:${api.available}`), ["solar:true", "ahlsell:false", "sonepar:false", "rexel:false"]);
  for (const id of ["ahlsell", "rexel", "sonepar"] as const) {
    const api = wholesaleApi(id);
    assert.equal(await api.enabled(), false);
    const check = await api.preflight();
    assert.equal(check.ok, false);
    assert.match(check.ok ? "" : check.message, /ingen ansluten API-tjänst/);
    assert.deepEqual(await api.page({}), { ok: false, status: 0, message: `${api.label} har ingen ansluten API-tjänst.` });
  }
  const rows = serverKeyStatuses({ SMTP_HOST: "localhost" });
  for (const id of ["ahlsell", "rexel", "sonepar"]) {
    const row = rows.find((item) => item.id === id)!;
    assert.equal(row.prepared, true);
    assert.equal(row.configured, false);
    assert.deepEqual(row.variables, [], "no key names are invented for an API that has no documentation");
    assert.match(row.note, /^Inte ansluten\./);
  }
  assert.equal(rows.find((item) => item.id === "solar")!.prepared, undefined);
});

// ---------- priser direkt mot grossistens katalogartikel (2026-10-17, alternativ C): the company's price on a register article ----------

const SUPPLIER = "csolar0000000000000000001";
const NORR = "csolarnorr00000000000000001";
const wholesaleOffer = (overrides: Partial<WholesaleOffer> = {}): WholesaleOffer => ({
  seq: 1, wholesaler: "solar", articleNo: "1000000017", supplierId: SUPPLIER, supplierName: "Solar", priceRowId: "p1", importId: "i1", priceKind: "NET", amount: "412.0000", perQuantity: 1,
  unitPrice: "412.0000", currency: "SEK", priceDate: "2026-10-10", confirmedDate: "2026-10-10", createdAt: "2026-10-10T10:00:00.000Z", discountGroup: "", packageSize: "", orderMultiple: "",
  minOrderQuantity: "", stocked: "", status: "", sourceFileName: "solar.csv", missingFromLatestFile: false, ...overrides,
});
const pricedBy = (...offers: [number, CatalogueOffer[]][]): PricedOffers => new Map(offers);

test("a company's price on a register article is that article's own priced offer, with the register's words and the price file's facts", () => {
  const row = registerRow();
  const offer = wholesaleOfferOf(row, wholesaleOffer({ discountGroup: "K12", minOrderQuantity: "10", stocked: "J", confirmedDate: "2026-10-15" }));
  assert.equal(offer.id, `solar:1000000017:${SUPPLIER}`);
  assert.equal(offer.supplierName, "Solar", "the company's own name for the supplier");
  assert.equal(offer.supplierId, SUPPLIER);
  assert.equal(offer.wholesaler, "solar");
  assert.equal(offer.supplierArticleNo, "1000000017", "the wholesaler's own number");
  assert.equal(offer.name, "Motorskydd 3-pol 20–25 A");
  assert.equal(offer.unit, "st");
  assert.equal(offer.eNumber, "1234567");
  assert.equal(offer.catalogOnly, undefined);
  assert.equal(offer.catalog?.statusText, "På väg att utgå hos Solar", "the wholesaler's status stands on the wholesaler's row");
  assert.deepEqual(offer.price, { unitPrice: 412, priceDate: "2026-10-10", confirmedDate: "2026-10-15", sourceFileName: "solar.csv", importId: "i1" });
  assert.deepEqual([offer.discountGroup, offer.minOrderQuantity, offer.stocked], ["K12", "10", true]);
  assert.equal(offerWarning(offer), "På väg att utgå hos Solar");
  // A price for a hundred, a base price and the file's own status.
  const perHundred = wholesaleOfferOf(row, wholesaleOffer({ amount: "2000.0000", perQuantity: 100, unitPrice: "20.0000", priceKind: "BASE", status: "UTGAR", packageSize: "25", orderMultiple: "5" }));
  assert.deepEqual(perHundred.price, { unitPrice: 20, priceDate: "2026-10-10", sourceFileName: "solar.csv", importId: "i1", perQuantity: 100, amount: 2000, priceKind: "BASE" });
  assert.deepEqual([perHundred.status, perHundred.packageSize, perHundred.orderMultiple], ["UTGAR", "25", "5"]);
  assert.equal(offerWarning(perHundred), "Utgår – så länge lagret räcker", "the file's status first");
  // "Inte i senaste prisfilen" only when the price rows say so and the latest list is known.
  const missing = wholesaleOffer({ missingFromLatestFile: true });
  assert.equal(wholesaleOfferOf(row, missing).notInLatest, undefined);
  assert.deepEqual(wholesaleOfferOf(row, missing, { fileName: "solar-2.csv", date: "2026-10-15" }).notInLatest, { fileName: "solar-2.csv", date: "2026-10-15" });
  assert.equal(wholesaleOfferOf(row, wholesaleOffer(), { fileName: "solar-2.csv", date: "2026-10-15" }).notInLatest, undefined);
});

test("the id of a priced offer names the wholesaler's article and the company's supplier, and reads back", () => {
  const id = wholesaleOfferId(registerRow(), SUPPLIER);
  assert.equal(id, `solar:1000000017:${SUPPLIER}`);
  assert.deepEqual(parseWholesaleOfferId(id), { wholesaler: "solar", articleNo: "1000000017", supplierId: SUPPLIER });
  assert.deepEqual(parseWholesaleOfferId(`rexel:REX-98765:${SUPPLIER}`), { wholesaler: "rexel", articleNo: "REX-98765", supplierId: SUPPLIER });
  assert.equal(isWholesaleOfferId("solar:1000000017"), false, "the unpriced register row has the article's id only");
  assert.equal(isWholesaleOfferId("ref:E:1234567"), false);
  assert.equal(isWholesaleOfferId("solar:1234567"), false, "Solar's catalogue product in the search");
  assert.equal(isWholesaleOfferId("ckx0000000000000000000000"), false, "a row of the company's own catalogue");
  assert.equal(isWholesaleOfferId(`unknown:1000000017:${SUPPLIER}`), false, "only a known wholesaler");
  assert.ok(id.length <= 100);
});

test("a hit of register articles has one offer per supplier of the company where it has a price and the unpriced row where it has none", () => {
  const solar = registerRow();
  const rexel = registerRow({ id: "w2", seq: 2, wholesaler: "rexel", articleNo: "REX-98765", status: "" });
  const cheaper = wholesaleOffer({ supplierId: NORR, supplierName: "Solar Norr", unitPrice: "399.0000", amount: "399.0000" });
  const priced = pricedBy([1, [wholesaleOfferOf(solar, wholesaleOffer()), wholesaleOfferOf(solar, cheaper)]]);
  const hit = catalogHitOf([solar, rexel], priced);
  assert.deepEqual(hit.offers!.map((item) => [item.supplierName, item.supplierArticleNo, item.price?.unitPrice ?? null, item.catalogOnly ?? false]), [
    ["Solar", "1000000017", 412, false], ["Solar Norr", "1000000017", 399, false], ["Rexels katalog", "REX-98765", null, true],
  ]);
  assert.equal(hit.supplierName, "Solar Norr", "the lowest price is the one a row takes");
  assert.equal(hit.price?.unitPrice, 399);
  assert.equal(hit.catalogOnly, undefined, "a hit with a price is not 'only the catalogue'");
  assert.equal(hit.offers!.find((item) => item.catalogOnly)!.price, null, "Rexel's row has no price: Solar's prices never reach it");
  assert.deepEqual(hit.common, { kind: "E", number: "1234567" });
  assert.equal(hit.product?.manufacturer, "Tillverkare");
  // The searched supplier's offer, the article found by its exact number, and the first when nothing is priced.
  assert.equal(catalogHitOf([solar, rexel], priced, { supplierId: SUPPLIER }).supplierName, "Solar");
  assert.equal(catalogHitOf([solar, rexel], priced, { exactSeq: 1 }).supplierName, "Solar", "the first of the exact article's own offers");
  const none = catalogHitOf([solar, rexel]);
  assert.equal(none.catalogOnly, true);
  assert.equal(none.id, "solar:1000000017");
  // A price per package is not compared with a price per metre.
  const perMetre = wholesaleOfferOf(registerRow({ unit: "m" }), wholesaleOffer({ supplierId: NORR, supplierName: "Solar Norr", unitPrice: "5.0000" }));
  assert.equal(catalogHitOf([solar], pricedBy([1, [wholesaleOfferOf(solar, wholesaleOffer()), perMetre]])).supplierName, "Solar", "the other unit is not comparable, so the matched offer stays");
});

test("the company's own Rexel article and Solar's priced offers are one product, each with its own price, number and status", () => {
  const solar = registerRow();
  const rexelOffer = offer({ price: price(450, "ir"), unit: "st" });
  const company = { ...rexelOffer, productId: "p1", common: { kind: "E" as const, number: "1234567" }, offers: [rexelOffer], supplierOnly: false };
  const cheaper = wholesaleOffer({ supplierId: NORR, supplierName: "Solar Norr", unitPrice: "399.0000", amount: "399.0000" });
  const priced = pricedBy([1, [wholesaleOfferOf(solar, wholesaleOffer()), wholesaleOfferOf(solar, cheaper)]]);
  const joined = withRegisters(company, [solar], priced);
  assert.equal(joined.offers!.length, 3, "Rexel's own, Solar and Solar Norr; no unpriced row for Solar");
  assert.ok(!joined.offers!.some((item) => item.catalogOnly));
  assert.equal(joined.supplierName, "Solar Norr", "chosen again among all the offers: the lowest price");
  assert.equal(joined.productId, "p1", "the company's product stays");
  assert.deepEqual(joined.common, { kind: "E", number: "1234567" });
  const rexelRow = joined.offers!.find((item) => item.supplierName.startsWith("Rexel"))!;
  assert.equal(rexelRow.price?.unitPrice, 450, "Rexel's price untouched");
  assert.equal(rexelRow.catalog, undefined, "and Solar's words are not put on it");
  assert.equal(offerWarning(joined.offers!.find((item) => item.supplierName === "Solar")!), "På väg att utgå hos Solar", "Solar's status is on Solar's row");
  // The company's own article found by its exact number stays the hit's; the searched supplier's offer wins; Solar's exact number takes Solar's offer.
  assert.equal(withRegisters(company, [solar], priced, { exact: true }).supplierName.startsWith("Rexel"), true);
  assert.equal(withRegisters(company, [solar], priced, { supplierId: SUPPLIER }).supplierName, "Solar");
  assert.equal(withRegisters(company, [solar], priced, { exactSeq: 1 }).supplierName, "Solar");
  // No price of the company on the article: the unpriced row beside the company's, as before.
  const unpriced = withRegister(company, solar, pricedBy());
  assert.deepEqual(unpriced.offers!.map((item) => item.catalogOnly ?? false), [false, true]);
  assert.equal(unpriced.supplierName.startsWith("Rexel"), true);
  // A second register row of the same wholesaler and E-nummer never takes the first row's priced offer for its own.
  const second = registerRow({ id: "w3", seq: 3, articleNo: "1000000018", status: "10" });
  const both = withRegisters(company, [solar, second], priced);
  assert.equal(both.offers!.find((item) => item.supplierName === "Solar")!.catalog?.articleNo, "1000000017", "still the first article's words");
  assert.equal(both.offers!.filter((item) => item.catalogOnly).length, 1, "the second article is added as its own unpriced row");
});

test("a row made of a priced register offer copies it like any article, and the export finds the other wholesalers' numbers of the same product", () => {
  const solar = registerRow({ status: "10" });
  const priced = pricedBy([1, [wholesaleOfferOf(solar, wholesaleOffer({ confirmedDate: "2026-10-15" }))]]);
  const rexel = registerRow({ id: "w2", seq: 2, wholesaler: "rexel", articleNo: "REX-98765", status: "" });
  const hit = catalogHitOf([solar, rexel], priced);
  const row = applyArticle({ id: "r", name: "", quantity: "3", unit: "" }, hit);
  assert.equal(row.catalogue?.supplierName, "Solar");
  assert.equal(row.catalogue?.supplierArticleNo, "1000000017");
  assert.equal(row.catalogue?.unitPrice, "412");
  assert.equal(row.catalogue?.unit, "st");
  assert.equal(row.catalogue?.source, "solar.csv");
  assert.equal(row.catalogue?.priceDate, "2026-10-10");
  assert.equal(row.catalogue?.confirmedDate, "2026-10-15");
  assert.equal(row.catalogue?.articleId, `solar:1000000017:${SUPPLIER}`, "where the price came from; it prices the row again from it");
  assert.equal(row.catalogue?.wholesaler, "solar");
  assert.equal(row.articleNo, "1000000017");
  assert.deepEqual(row.wholesale, { ids: { rexel: "REX-98765" }, linked: { rexel: "REX-98765" } }, "a product of the shared register with a common number links its wholesalers' own numbers");
  assert.deepEqual(linkedWholesaleIds({ ...hit, common: undefined }), {}, "without a product or a common number nothing is linked");
});
