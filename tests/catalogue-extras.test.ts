import assert from "node:assert/strict";
import test from "node:test";
import { openPriceFile } from "../lib/catalogue/file/open";
import { parseOfColumns, suggestCatalogueColumns } from "../lib/catalogue/columns";
import { articleExtras, articleStatusOf, CatalogueRowParser, quantityText, stockedOf, type CatalogueRow } from "../lib/catalogue/model";
import { offerFacts, offerWarning, pickOffer, type CatalogueOffer } from "../lib/catalogue/snapshot";
import { catalogueTransferSchema } from "../lib/catalogue/transfer-format";

// Förpackning, multipel, minsta beställning, lagerförd, status och artiklar som saknas (2026-10-15): read from the
// wholesalers' own columns when the file has them, shown on the hit, never used to recompute a price.

const pad = (text: string, width: number) => (text + " ".repeat(width)).slice(0, width);
const num = (value: number, width: number) => String(Math.round(value)).padStart(width, "0");

async function priceRows(name: string, content: string) {
  const file = await openPriceFile(new TextEncoder().encode(content), name);
  const columns = suggestCatalogueColumns(file.info.headers, file.sample, file.info);
  const parser = new CatalogueRowParser(file.info.headers, columns.mapping, "2026-10-15", parseOfColumns(columns));
  const rows: CatalogueRow[] = [];
  for await (const record of file.rows()) { const row = parser.push(record.line, record.cells, record.width); if (row) rows.push(row); }
  return { file, columns, rows };
}

test("quantities and statuses as the files write them", () => {
  assert.equal(quantityText("250"), "250");
  assert.equal(quantityText("4,2"), "4.2");
  assert.equal(quantityText("0000420"), "4.2", "Ahlsell's text file: hundredths");
  assert.equal(quantityText("0"), "");
  assert.equal(quantityText(""), "");
  assert.equal(quantityText("abc"), "");
  assert.equal(articleStatusOf("UL"), "UTGAR");
  assert.equal(articleStatusOf("PPB"), "PRIS_PA_BEGARAN");
  assert.equal(articleStatusOf("O"), "");
  assert.equal(articleStatusOf("", "J"), "PRIS_PA_BEGARAN", "Sonepar Påbeg J");
  assert.equal(articleStatusOf("", "N"), "");
  assert.deepEqual([stockedOf("J"), stockedOf("N"), stockedOf("L"), stockedOf("A"), stockedOf("")], ["J", "N", "J", "", ""], "Rexel's A is not described and is left out");
  assert.deepEqual(articleExtras({ packageSize: "250", orderMultiple: "1", minOrderQuantity: "500", stocked: "J", status: "", priceOnRequest: "N" }),
    { packageSize: "250", orderMultiple: "1", minOrderQuantity: "500", stocked: "J", status: "" });
});

test("Solar prislista: MinBestKvant is the minimum order; Ansvarskod is a delivery term, never a status", async () => {
  const { rows, columns } = await priceRows("lista.csv", [
    "Produktområde;Artikelnr;RSK;Benämning;Produktgrupp;Enhet;Listpris;Ansvarskod;Datum;MinBestKvant",
    "E;1000001;;Påhittad kabel;300120;M;400,02;A;20261001;1",
    "E;1000002;;Påhittad kabel T500;300120;M;363,70;A;20261001;500",
  ].join("\r\n"));
  assert.equal(columns.mapping.minOrderQuantity, "MinBestKvant");
  assert.equal(columns.mapping.status, undefined);
  assert.deepEqual(rows.map((row) => [row.minOrderQuantity, row.status, row.unitPrice]), [["1", "", 400.02], ["500", "", 363.7]], "stored as the file says (the hit says nothing of a minimum of 1); the price is per m, untouched");
});

test("Sonepar GNP: Antsort, Stdfp and Påbeg; Rexel GN: Status and Lagerförd; Ahlsell: Multipel and Lagerförd", async () => {
  const sonepar = await priceRows("gnp.csv", [
    "Artnr;Artben;Sortkod;Antsort;Stdfp;Påbeg;Gdatum;Mg;DistributionsAvgift;Gnp",
    "E1000001;PÅHITTAD KABEL;M;0;100;N;20261001;1NB;;25",
    "AB12345;PÅHITTAD SPIK 250ST;FP;250;1;N;20261001;FVK;;295",
    "AB12346;PÅHITTAD FLÄKT;ST;0;1;J;20261001;FVK;;0",
  ].join("\r\n"));
  assert.deepEqual(sonepar.rows.map((row) => [row.packageSize, row.orderMultiple, row.status, row.unit, row.unitPrice]),
    [["", "100", "", "m", 25], ["250", "1", "", "förp", 295], ["", "1", "PRIS_PA_BEGARAN", "st", 0]], "the FP price stays the price of the package");
  const rexel = await priceRows("gn.csv", [
    "Artikelnummer;Benämning;Enhet;Materialgrupp;GN-pris;Prisdatum;ALEM ansvarskod;Lagerförd;Status",
    "1000001;PÅHITTAD KABEL;M;00XXA;18,40;20261010;A;L;O",
    "1000003;PÅHITTAD DOSA;ST;11ÅBC;4,70;20261010;J;A;UL",
  ].join("\r\n"));
  assert.deepEqual(rexel.rows.map((row) => [row.stocked, row.status]), [["J", ""], ["", "UTGAR"]]);
  const header = "Artikelnr;GNP;Materialklass;Enhet;Lagerförd;Benämning;Multipel;Miljöavgift;Förlängd ansvarstid;Energieffektivt";
  const ahlsell = await priceRows("el.csv", [header, ...Array.from({ length: 10 }, (_, index) => `${1000001 + index};${100 + index};QA0100;M;${index % 2 ? "J" : "N"};PÅHITTAD KABEL ${index};${index ? 500 : 0};N;N;N`)].join("\r\n"));
  assert.deepEqual([ahlsell.rows[0].stocked, ahlsell.rows[0].orderMultiple, ahlsell.rows[1].stocked, ahlsell.rows[1].orderMultiple], ["N", "", "J", "500"]);
  const line = (article: string, price: number, multiple: number, stocked: string) => `${pad(article, 20)}${num(price, 12)}${pad("QA0100", 6)}${pad("M", 3)}${stocked}${pad("PÅHITTAD KABEL", 60)}${num(multiple, 7)}NNN`;
  const fixed = await priceRows("El.txt", Array.from({ length: 12 }, (_, index) => line(String(1000001 + index), 19800, index ? 420 : 0, index % 2 ? "J" : "N")).join("\r\n"));
  assert.equal(fixed.file.info.variant?.id, "ahlsell-txt");
  assert.deepEqual([fixed.rows[0].orderMultiple, fixed.rows[1].orderMultiple, fixed.rows[1].stocked, fixed.rows[1].unitPrice], ["", "4.2", "J", 198], "the multiple in hundredths, the price still in öre");
});

const offer = (over: Partial<CatalogueOffer>): CatalogueOffer => ({ id: "a", name: "Kabel", unit: "m", supplierArticleNo: "1", eNumber: "1000001", supplierName: "A", supplierId: "s1",
  price: { unitPrice: 10, priceDate: "2026-10-01", sourceFileName: "f.csv", importId: "i1" }, ...over });

test("the default offer is never an article going out, with price on request or missing from the latest file", () => {
  const current = offer({ id: "b", supplierId: "s2", supplierName: "B", price: { unitPrice: 12, priceDate: "2026-10-01", sourceFileName: "g.csv", importId: "i2" } });
  assert.equal(pickOffer([offer({ status: "UTGAR" }), current], { matched: "a" }).id, "b");
  assert.equal(pickOffer([offer({ notInLatest: { fileName: "f.csv", date: "2026-10-10" } }), current], { matched: "a" }).id, "b");
  assert.equal(pickOffer([offer({ status: "PRIS_PA_BEGARAN" })], { matched: "a" }).id, "a", "alone, it is still the offer");
  assert.equal(pickOffer([offer({}), current], { matched: "a" }).id, "a", "both current: the cheapest as before");
});

test("facts and warnings on the hit, in plain words", () => {
  assert.deepEqual(offerFacts(offer({ packageSize: "250", orderMultiple: "500", minOrderQuantity: "100", stocked: true })), ["250 st per förpackning", "Beställs i 500 m", "Minst 100 m", "Lagervara"]);
  assert.deepEqual(offerFacts(offer({ orderMultiple: "1", minOrderQuantity: "1", stocked: false })), [], "one is nothing to say; not stocked is not said");
  assert.equal(offerWarning(offer({ status: "UTGAR" })), "Utgår – så länge lagret räcker");
  assert.equal(offerWarning(offer({ status: "PRIS_PA_BEGARAN" })), "Pris på begäran");
  assert.equal(offerWarning(offer({ notInLatest: { fileName: "f.csv", date: "2026-10-10" } })), "Inte i senaste prisfilen (2026-10-10)");
  assert.equal(offerWarning(offer({})), "");
});

test("the catalogue transfer carries the price kind and reads an older file without it as net prices", () => {
  const base = { format: "HWF_CATALOGUE", schemaVersion: 1, suppliers: [{ ref: "s1", name: "A", customerNumber: "", createdAt: "2026-10-01T00:00:00.000Z" }],
    imports: [{ ref: "i1", supplier: "s1", fileName: "f.csv", contentHash: "a".repeat(64), rowCount: 1, newArticles: 1, changedPrices: 0, unchangedPrices: 0, failedRows: 0, createdAt: "2026-10-01T00:00:00.000Z" }],
    articles: [{ ref: "a1", supplier: "s1", articleNo: "1", eNumber: "1000001", articleKey: "1", name: "Kabel", unit: "m", createdAt: "2026-10-01T00:00:00.000Z" }],
    prices: [{ ref: "p1", article: "a1", import: "i1", amount: "10.0000", perQuantity: 1, unitPrice: "10.0000", currency: "SEK", priceDate: "2026-10-01", sourceFileName: "f.csv", createdAt: "2026-10-01T00:00:00.000Z" }],
    confirmations: [], mappings: [] };
  const old = catalogueTransferSchema.safeParse(base);
  assert.ok(old.success, "a file from before the kinds still reads");
  if (old.success) assert.equal(old.data.prices[0].priceKind, undefined);
  const withKind = catalogueTransferSchema.safeParse({ ...base, imports: [{ ...base.imports[0], priceKind: "BASE" }], prices: [{ ...base.prices[0], priceKind: "BASE" }] });
  assert.ok(withKind.success);
  if (withKind.success) assert.deepEqual([withKind.data.imports[0].priceKind, withKind.data.prices[0].priceKind], ["BASE", "BASE"]);
  assert.equal(catalogueTransferSchema.safeParse({ ...base, prices: [{ ...base.prices[0], priceKind: "GROSS" }] }).success, false);
});
