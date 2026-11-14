import assert from "node:assert/strict";
import test from "node:test";
import { decodeText, parseCsv, table } from "../lib/import/csv";
import { detectImport } from "../lib/import/detect";
import { MAX_CATALOGUE_ROWS, parseCatalogueRows, suggestCatalogueMapping } from "../lib/catalogue/model";

// Prisfil (2026-10-08): a supplier's price list as portals export it – Windows-1252, semicolons, CRLF, list price,
// discount group, article numbers with leading zeros, dates as ÅÅÅÅMMDD, tens of thousands of rows. Every value here
// is made up; only the shape of such a file is imitated.

const HEADER = "Produktområde;Artikelnr;RSK;Benämning;Produktgrupp;Enhet;Listpris;Ansvarskod;Datum;MinBestkvant";
const latin1 = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));
const TODAY = "2026-10-08";

test("a Windows-1252 file is decoded with å, ä and ö intact; UTF-8 with and without BOM as before", () => {
  const text = `${HEADER}\r\nX1;0000123;9999999;Kabelsko för ö-terminal 6 mm²;AB12;M;12,50;Z;20260915;1\r\n`;
  const decoded = decodeText(latin1(text));
  assert.equal(decoded, text);
  assert.ok(!decoded.includes("�"), "no replacement characters");
  assert.equal(decodeText(new TextEncoder().encode("Benämning;Pris")), "Benämning;Pris");
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Åsa;Öl")])), "Åsa;Öl", "the BOM is removed");
  assert.equal(decodeText(latin1("pris \x80 10")), "pris € 10", "Windows-1252, not plain ISO-8859-1, for the euro sign");
});

test("the price-list columns are mapped: list price, article number, discount group; RSK is its own field, never an E-nummer", () => {
  const headers = HEADER.split(";");
  const mapping = suggestCatalogueMapping(headers);
  assert.deepEqual(mapping, { articleNo: "Artikelnr", eNumber: null, name: "Benämning", unit: "Enhet", price: "Listpris", perQuantity: null, priceDate: "Datum", discountGroup: "Produktgrupp", manufacturerArticleNo: null, rskNumber: "RSK", gtin: null, manufacturer: null, packageSize: null, orderMultiple: null, minOrderQuantity: "MinBestkvant", stocked: null, status: null, priceOnRequest: null });
  assert.notEqual(mapping.eNumber, "RSK", "an RSK number is not an E-nummer");
  assert.equal(suggestCatalogueMapping(["Art.nr", "Benämning", "Bruttopris", "Rabattkod"]).price, "Bruttopris");
  assert.equal(suggestCatalogueMapping(["Art.nr", "Benämning", "Bruttopris", "Rabattkod"]).discountGroup, "Rabattkod");
  assert.equal(suggestCatalogueMapping(["Art.nr", "Benämning", "Bruttopris", "Nettopris"]).price, "Nettopris", "a net price wins over a list price");
  assert.equal(suggestCatalogueMapping(["Artikelnummer", "Benämning", "À-pris", "Rabattgrupp"]).price, "À-pris");
  assert.equal(suggestCatalogueMapping(["Artikelnummer", "Benämning", "À-pris", "Rabattgrupp"]).discountGroup, "Rabattgrupp");
  const file = { name: "lista.csv", mimeType: "text/csv", size: 1, kind: "table" as const, headers, rows: [] };
  assert.equal(detectImport(file).target, "catalogue");
});

test("leading zeros, decimal comma, units and the three date forms are read from the file", () => {
  const text = [
    HEADER,
    "X1;0000710;1111111;Kabel exempel 3x1,5;AB12;M;12,34;Z;20260915;100",
    "X1;0004711;;Dosa exempel;CD34;ST;1 234,50;Z;2026-09-01;1",
    "X2;0090001;;Rör exempel;;M;7,5;Z;01.08.2026;1",
    "X2;0090002;;Utan pris;EF56;ST;;Z;20260915;1",
  ].join("\r\n");
  const grid = table(parseCsv(decodeText(latin1(text)), MAX_CATALOGUE_ROWS), "lista.csv", MAX_CATALOGUE_ROWS);
  const parsed = parseCatalogueRows(grid.headers!, grid.rows!, suggestCatalogueMapping(grid.headers!), TODAY);
  assert.deepEqual(parsed.errors, [{ line: 5, message: "saknar pris" }]);
  const [cable, box, pipe] = parsed.rows;
  assert.equal(cable.articleNo, "0000710", "the leading zeros stay");
  assert.equal(cable.unit, "m");
  assert.equal(cable.amount, 12.34);
  assert.equal(cable.priceDate, "2026-09-15");
  assert.equal(cable.discountGroup, "AB12");
  assert.equal(cable.eNumber, "", "the RSK column is not read as an E-nummer");
  assert.equal(box.amount, 1234.5);
  assert.equal(box.unit, "st");
  assert.equal(box.priceDate, "2026-09-01");
  assert.equal(pipe.name, "Rör exempel");
  assert.equal(pipe.priceDate, "2026-08-01");
  assert.equal(pipe.discountGroup, "");
});

test("a price list of 50 000 rows is read in full; other imports keep their first 1 000 rows", () => {
  const lines = [HEADER];
  for (let index = 0; index < 50_000; index++) lines.push(`X1;${String(index).padStart(7, "0")};;Artikel ${index};G${index % 40};ST;${(index % 900) + 1},25;Z;20260901;1`);
  const text = `${lines.join("\r\n")}\r\n`;
  const ordinary = table(parseCsv(text), "lista.csv", 1000);
  assert.equal(ordinary.rows!.length, 1000);
  assert.equal(ordinary.truncated, true, "the ordinary limit says that the file had more");
  const started = Date.now();
  const full = table(parseCsv(text, MAX_CATALOGUE_ROWS), "lista.csv", MAX_CATALOGUE_ROWS);
  assert.equal(full.rowCount, 50_000);
  assert.equal(full.truncated, false);
  const parsed = parseCatalogueRows(full.headers!, full.rows!, suggestCatalogueMapping(full.headers!), TODAY);
  assert.equal(parsed.rows.length, 50_000);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.total, 50_000);
  assert.equal(parsed.rows[49_999].articleNo, "0049999");
  assert.ok(Date.now() - started < 10_000, "read and parsed within seconds");
});

test("a file over the price list's limit is marked as cut", () => {
  const lines = [HEADER, ...Array.from({ length: 12 }, (_, index) => `X1;${index};;A${index};G;ST;1;Z;20260901;1`)];
  const cut = table(parseCsv(lines.join("\n"), 10), "lista.csv", 10);
  assert.equal(cut.rows!.length, 10);
  assert.equal(cut.truncated, true);
});

test("an inch mark inside a name is a character, not the start of a quoted field", () => {
  const rows = parseCsv([
    "Artikelnr;Benämning;Listpris",
    "0000001;Rör exempel 1/2\" grå;10,00",
    "0000002;Nippel 3/4\";5,00",
    "0000003;\"Citerad; med semikolon\";7,00",
    "0000004;\"Två \"\"citat\"\"\";8,00",
  ].join("\r\n"));
  assert.equal(rows.length, 5, "no row is swallowed");
  assert.deepEqual(rows[1], ["0000001", "Rör exempel 1/2\" grå", "10,00"]);
  assert.deepEqual(rows[2], ["0000002", "Nippel 3/4\"", "5,00"]);
  assert.deepEqual(rows[3], ["0000003", "Citerad; med semikolon", "7,00"]);
  assert.deepEqual(rows[4], ["0000004", "Två \"citat\"", "8,00"]);
});
