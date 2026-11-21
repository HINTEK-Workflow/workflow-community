import assert from "node:assert/strict";
import test from "node:test";
import { chainPercent, netPriceOf, pickRebate, readRebateText, rebateCounts, type RebateMatch } from "../lib/catalogue/rebate";
import { openPriceFile } from "../lib/catalogue/file/open";
import { parseOfColumns, suggestCatalogueColumns } from "../lib/catalogue/columns";
import { CatalogueRowParser, type CatalogueRow } from "../lib/catalogue/model";
import { recognizePriceList } from "../lib/catalogue/known-files";
import { gtinOf, manufacturerKey, productKeyOf, commonNumberOf } from "../lib/catalogue/normalize";
import { applyArticle, pickOffer, priceMarkOf, type CatalogueHit } from "../lib/catalogue/snapshot";
import { verdictOf } from "../lib/catalogue/verdict";

// Rabattbrev, kända prislistor och samma produkt (2026-10-14). Invented rows only, in the same shape as the
// wholesalers' files – never a real row, price, customer number or account number.

const today = "2026-10-14";
const pad = (text: string, width: number) => text.padEnd(width, " ").slice(0, width);
const num = (value: number, width: number) => String(value).padStart(width, "0");

test("the chain: 20 % and 2 % make 21,6 %; a net price is never discounted further", () => {
  assert.equal(chainPercent(20, 2), 21.6);
  assert.equal(chainPercent(50), 50);
  assert.equal(chainPercent(0, 0), 0);
  assert.deepEqual(netPriceOf(1000, { kind: "GROUP", key: "X", percent: 20, percent2: 2, netPrice: null }), { unitPrice: 784, percent: 21.6, rule: "GROUP" });
  assert.deepEqual(netPriceOf(1000, { kind: "NET", key: "1", percent: 30, percent2: 0, netPrice: 640.5 }), { unitPrice: 640.5, percent: 35.95, rule: "NET" });
  // Rounded to whole öre at the end only.
  assert.equal(netPriceOf(0.68, { kind: "GROUP", key: "X", percent: 33.33, percent2: 0, netPrice: null })!.unitPrice, 0.45);
});

test("precedence: the article's net price, then its discount, then the longest group it starts with", () => {
  const rules: RebateMatch[] = [
    { kind: "GROUP", key: "12", percent: 10, percent2: 0, netPrice: null },
    { kind: "GROUP", key: "12AB", percent: 40, percent2: 0, netPrice: null },
    { kind: "ARTICLE", key: "1234567", percent: 45, percent2: 0, netPrice: null },
    { kind: "NET", key: "7654321", percent: 0, percent2: 0, netPrice: 99 },
  ];
  assert.equal(pickRebate(rules, { articleNo: "0000001", group: "12AB" })?.key, "12AB", "longest group");
  assert.equal(pickRebate(rules, { articleNo: "0000001", group: "12ZZ" })?.key, "12", "main group covers its sub-groups");
  assert.equal(pickRebate(rules, { articleNo: "1234567", group: "12AB" })?.kind, "ARTICLE", "article before group");
  assert.equal(pickRebate(rules, { articleNo: "", eNumber: "7654321", group: "12AB" })?.kind, "NET", "net price before everything, by E-nummer too");
  assert.equal(pickRebate(rules, { articleNo: "0000001", group: "99" }), null);
});

test("Solar avtalsfil (CSV): V = group with follow-on discount, A = article discount, P = net price", () => {
  const text = [
    "Kod;Produktgrupp;Artikelnr;RSK-nr;Benämning;Rabatt;Rabatt2;NtoPris;ArtRabatt",
    "V;100100;;;Påhittad kabelgrupp;50,00;10,00;;;",
    "V;100200;;;Påhittad dosgrupp;35,5;;;;",
    "A;;1000001;;Påhittad laddbox;;;;46,00",
    "P;;1000002;;Påhittad central;;;1234,50;",
    "X;;;;okänd rad;;;;",
  ].join("\r\n");
  const read = readRebateText(text, today)!;
  assert.equal(read.format.id, "solar-csv");
  assert.equal(read.format.wholesaler, "solar");
  assert.deepEqual(rebateCounts(read.rows), { groups: 2, articles: 1, netPrices: 1 });
  assert.equal(read.errorCount, 1);
  const group = read.rows.find((row) => row.key === "100100")!;
  assert.equal(group.percent, 50); assert.equal(group.percent2, 10);
  assert.equal(netPriceOf(200, group)!.unitPrice, 90, "50 % then 10 % of 200 = 90");
  assert.equal(read.rows.find((row) => row.kind === "NET")!.netPrice, 1234.5);
  // The article discount replaces the group's (it is the article's total, not one more step).
  const article = pickRebate(read.rows, { articleNo: "1000001", group: "100100" })!;
  assert.equal(netPriceOf(1000, article)!.unitPrice, 540);
});

test("Solar avtalsfil (text, 130 characters): discounts in hundredths, an ended validity is left out", () => {
  const line = (group: string, article: string, name: string, r1: number, r2: number, from: string, to: string) =>
    `${pad(group, 20)}${pad(article, 20)}${pad(name, 50)}${num(r1, 5)}${num(r2, 5)}${" ".repeat(14)}${from}${to}`;
  const text = [
    pad("0000000000000       10000000            202610140000001.1  Påhittad grossist", 130),
    line("100100", "", "Påhittad grupp", 7650, 0, "20250101", "99991231"),
    line("", "1000001", "Påhittad artikel", 4510, 0, "20260101", "99991231"),
    line("100300", "", "Gammal grupp", 1000, 0, "20200101", "20201231"),
  ].join("\r\n");
  const read = readRebateText(text, today)!;
  assert.equal(read.format.id, "solar-txt");
  assert.equal(read.rows.length, 2);
  assert.equal(read.skipped, 1);
  assert.equal(read.rows[0].percent, 76.5);
  assert.equal(read.rows[1].kind, "ARTICLE");
});

test("Rexel rabattbrev: group;discount 1;discount 2 in tenths of a percent (701 = 70,1 %)", () => {
  const text = ["00XXA;701;", "11ÅBC;455;100", "14ZZZ;100;", "93QQQ;765;"].join("\r\n");
  const read = readRebateText(text, today)!;
  assert.equal(read.format.id, "rexel-txt");
  assert.equal(read.rows[0].percent, 70.1);
  assert.equal(read.rows[1].key, "11ÅBC");
  assert.equal(read.rows[1].percent2, 10);
  assert.equal(netPriceOf(100, read.rows[0])!.unitPrice, 29.9);
});

test("Sonepar rabattbrev: Mg 4–6, discounts 11–14, 21–24, 31–34 written 99.9, data from line 3", () => {
  const row = (mg: string, r1: string, r2: string, r3: string) => `   ${mg}    ${r1.padStart(4)}      ${r2.padStart(4)}      ${r3.padStart(4)}`;
  const text = ["Kundnr 0000000 Avtal 000 Giltigt från 2026-10-01", "   Mg     Rabatt    Tillägg1  Tillägg2", row("ABC", "20.0", "2.0", "0.0"), row("1NB", "45.5", "0.0", "0.0")].join("\r\n");
  const read = readRebateText(text, today)!;
  assert.equal(read.format.id, "sonepar-txt");
  assert.equal(read.rows.length, 2);
  assert.equal(chainPercent(read.rows[0].percent, read.rows[0].percent2), 21.6);
});

test("Ahlsell avtalsfil: material class or article; tenths of a percent, net price in öre, chain discount with J", () => {
  const head = `01${num(1234567, 7)}000${pad("Påhittat avtal", 30)}J${" ".repeat(30)}261014`;
  const row = (chain: "J" | "N", article: string, cls: string, discount: number, special: number, net: number, chained: number) =>
    `01${chain}${num(1234567, 7)}${pad(article, 20)}${pad(cls, 6)}${num(discount, 4)}${num(special, 4)}${num(net, 9)}${num(chained, 4)}${pad(cls ? "Påhittad klass" : "", 30)}261231`;
  const text = [head, row("J", "", "QA0100", 400, 0, 0, 50), row("N", "1000001", "", 0, 450, 0, 0), row("N", "1000002", "", 0, 0, 12345, 0)].join("\r\n");
  const read = readRebateText(text, today)!;
  assert.equal(read.format.id, "ahlsell-txt");
  assert.deepEqual(rebateCounts(read.rows), { groups: 1, articles: 1, netPrices: 1 });
  const group = read.rows.find((item) => item.kind === "GROUP")!;
  assert.equal(group.percent, 40); assert.equal(group.percent2, 5);
  assert.equal(read.rows.find((item) => item.kind === "ARTICLE")!.percent, 45);
  assert.equal(read.rows.find((item) => item.kind === "NET")!.netPrice, 123.45);
});

test("a price list is never read as a discount letter", () => {
  assert.equal(readRebateText("Artikelnr;Benämning;Pris\r\n1000001;Påhittad kabel;12,50\r\n1000002;Påhittad dosa;4,10", today), null);
  assert.equal(readRebateText("", today), null);
});

const priceRows = async (name: string, text: string) => {
  const file = await openPriceFile(new TextEncoder().encode(text), name);
  const columns = suggestCatalogueColumns(file.info.headers, file.sample, file.info);
  const parser = new CatalogueRowParser(file.info.headers, columns.mapping, today, parseOfColumns(columns));
  const rows: CatalogueRow[] = [];
  for await (const record of file.rows()) { const row = parser.push(record.line, record.cells, record.width); if (row) rows.push(row); }
  return { file, columns, rows, parser };
};

test("Solar prislista: known by its headings; the article number is the E-nummer on E and B rows only", async () => {
  const { file, columns, rows } = await priceRows("lista.csv", [
    "Produktområde;Artikelnr;RSK;Benämning;Produktgrupp;Enhet;Listpris;Ansvarskod;Datum;MinBestkvant",
    "E;1000001;;Påhittad kabel 3G1,5;100100;M;12,50;J;20261001;1,00",
    "B;1000002;2000002;Påhittad ventil;100200;ST;99,00;J;20261001;1,00",
    "V;3000003;2000003;Påhittad koppling;100300;ST;45,00;V;20261001;1,00",
  ].join("\r\n"));
  assert.equal(file.info.variant?.id, "solar-prislista");
  assert.equal(columns.priceKind, "BASE");
  assert.deepEqual(rows.map((row) => row.eNumber), ["1000001", "1000002", ""]);
  assert.deepEqual(rows.map((row) => row.rskNumber), ["", "2000002", "2000003"]);
  assert.equal(rows[0].discountGroup, "100100");
});

test("Sonepar GNP and Rexel GN: known by their headings, base price, E-nummer from the article number", async () => {
  const sonepar = await priceRows("gnp.csv", [
    "Artnr;Artben;Sortkod;Antsort;Stdfp;Påbeg;Gdatum;Mg;DistributionsAvgift;Gnp",
    "E1000001;PÅHITTAD KABEL;M;0;100;N;20261001;1NB;;25",
    "AB12345;PÅHITTAD SPIK 250ST;FP;250;1;N;20261001;FVK;;295",
  ].join("\r\n"));
  assert.equal(sonepar.file.info.variant?.id, "sonepar-gnp");
  assert.deepEqual(sonepar.rows.map((row) => row.eNumber), ["1000001", ""]);
  assert.equal(sonepar.rows[1].discountGroup, "FVK");
  const rexel = await priceRows("gn.csv", [
    "Artikelnummer;Benämning;Enhet;Materialgrupp;GN-pris;Prisdatum;ALEM ansvarskod;Lagerförd;Status",
    "1000001;PÅHITTAD KABEL;M;00XXA;18,40;20261010;A;L;O",
    "1000003;PÅHITTAD DOSA;ST;11ÅBC;4,70;20261010;J;A;UL",
  ].join("\r\n"));
  assert.equal(rexel.file.info.variant?.id, "rexel-gn");
  assert.equal(rexel.columns.priceKind, "BASE");
  assert.deepEqual(rexel.rows.map((row) => [row.eNumber, row.discountGroup, row.unitPrice]), [["1000001", "00XXA", 18.4], ["1000003", "11ÅBC", 4.7]]);
});

test("Ahlsell prislista (Excel headings and 112-character text): E-nummer only when most numbers are seven digits", async () => {
  const header = "Artikelnr;GNP;Materialklass;Enhet;Lagerförd;Benämning;Multipel;Miljöavgift;Förlängd ansvarstid;Energieffektivt";
  const el = await priceRows("el.csv", [header, ...Array.from({ length: 10 }, (_, index) => `${1000001 + index};${100 + index};QA0100;M;N;PÅHITTAD KABEL ${index};0;N;N;N`)].join("\r\n"));
  assert.equal(el.file.info.variant?.id, "ahlsell-excel");
  assert.equal(el.rows[0].eNumber, "1000001");
  const own = await priceRows("bygg.csv", [header, ...Array.from({ length: 10 }, (_, index) => `${200001 + index};${100 + index};CX400B;ST;N;PÅHITTAT LÅS ${index};0;N;N;N`)].join("\r\n"));
  assert.equal(own.rows[0].eNumber, "", "six-digit own numbers are never E-nummer");
  const line = (article: string, price: number, cls: string, unit: string, name: string) => `${pad(article, 20)}${num(price, 12)}${pad(cls, 6)}${pad(unit, 3)}N${pad(name, 60)}${num(0, 7)}NNN`;
  const text = Array.from({ length: 12 }, (_, index) => line(String(1000001 + index), 19800 + index, "QA0100", "M", `PÅHITTAD KABEL ${index}`)).join("\r\n");
  const fixed = await priceRows("El.txt", text);
  assert.equal(fixed.file.info.variant?.id, "ahlsell-txt");
  assert.equal(fixed.rows[0].unitPrice, 198);
  assert.equal(fixed.rows[0].eNumber, "1000001");
  assert.equal(fixed.rows[0].unit, "m");
});

test("recognizePriceList needs every heading of a layout", () => {
  assert.equal(recognizePriceList(["Artikelnummer", "Benämning", "Enhet", "Materialgrupp", "GN-pris", "Prisdatum", "Status"])?.id, "rexel-gn");
  assert.equal(recognizePriceList(["Artikelnr", "Benämning", "Pris"]), null);
});

test("samma produkt: GTIN with a right check digit, manufacturer with number, in that order after E-nummer and RSK", () => {
  assert.equal(gtinOf("7300000000004"), "07300000000004");
  assert.equal(gtinOf("7300000000005"), "", "wrong check digit");
  assert.equal(gtinOf("12345"), "");
  assert.equal(manufacturerKey("Påhittad Tillverkare AB", "S-201 C16"), "pahittadtillverkare:s201c16");
  assert.equal(manufacturerKey("", "S201"), "");
  assert.equal(productKeyOf({ eNumber: "1000001", gtin: "7300000000004" }), "E:1000001");
  assert.equal(productKeyOf({ rskNumber: "2000002", gtin: "7300000000004" }), "RSK:2000002");
  assert.equal(productKeyOf({ gtin: "7300000000004", manufacturer: "X", manufacturerArticleNo: "Y" }), "GTIN:07300000000004");
  assert.equal(productKeyOf({ manufacturer: "Påhittad", manufacturerArticleNo: "ABC123" }), "MPN:pahittad:abc123");
  assert.equal(productKeyOf({ manufacturerArticleNo: "ABC123" }), null, "a number without its manufacturer never joins products");
  assert.deepEqual(commonNumberOf({ gtin: "7300000000004" }), { kind: "GTIN", number: "07300000000004" });
});

const hit = (price: CatalogueHit["price"]): CatalogueHit => ({ id: "a1", name: "Påhittad kabel", unit: "m", supplierArticleNo: "1000001", eNumber: "1000001", supplierName: "Grossist", price });

test("the row copies the discount: the net price as à-pris, the base price and the percent beside it", () => {
  const rebate = { basePrice: 267.5, percent: 32.98, rule: "GROUP" as const, fileName: "avtal.csv", date: today };
  const row = applyArticle({ id: "r1", name: "", quantity: "2", unit: "" }, hit({ unitPrice: 179.28, priceDate: today, sourceFileName: "lista.csv", importId: "i1", rebate }));
  assert.equal(row.unitPrice, "179,28");
  assert.deepEqual(row.catalogue?.rebate, { basePrice: "267,5", percent: "32,98" });
  assert.equal(row.catalogue?.priceKind, undefined, "a computed net price is the company's price");
  assert.match(row.catalogue?.source ?? "", /rabattbrev avtal\.csv −32,98 %/);
  assert.deepEqual(priceMarkOf(row.catalogue, row.unitPrice), { label: "32,98 %", basePrice: "267,5", tone: "discount" });
  assert.equal(priceMarkOf(row.catalogue, "150,00"), null, "a typed price is the person's own");
  const fixed = applyArticle({ id: "r2", name: "", quantity: "1", unit: "" }, hit({ unitPrice: 640.5, priceDate: today, sourceFileName: "lista.csv", importId: "i1", rebate: { ...rebate, rule: "NET", percent: 35.95, basePrice: 1000 } }));
  assert.equal(priceMarkOf(fixed.catalogue, fixed.unitPrice)?.label, "Avtalspris");
  const base = applyArticle({ id: "r3", name: "", quantity: "1", unit: "" }, hit({ unitPrice: 100, priceDate: today, sourceFileName: "lista.csv", importId: "i1", priceKind: "BASE" }));
  assert.deepEqual(priceMarkOf(base.catalogue, base.unitPrice), { label: "Grundpris", tone: "base" });
});

test("lowest price: a net price from a discount letter is compared with net prices, before base prices", () => {
  const offers = [
    { ...hit({ unitPrice: 50, priceDate: today, sourceFileName: "a", importId: "i", priceKind: "BASE" }), id: "base" },
    { ...hit({ unitPrice: 80, priceDate: today, sourceFileName: "b", importId: "i", rebate: { basePrice: 160, percent: 50, rule: "GROUP", fileName: "c", date: today } }), id: "net" },
  ];
  assert.equal(pickOffer(offers, { matched: "base" }).id, "net");
});

test("the verdict: right file, wrong box, unknown file", () => {
  const count = (value: number) => String(value);
  const known = { rowCount: 10, missing: [], format: { variant: { wholesaler: "rexel" as const, label: "Rexel prislista (GN)" } } };
  assert.equal(verdictOf(known, null, count).text, "Rätt fil – Rexel prislista (GN), 10 artiklar.");
  assert.equal(verdictOf(known, "rexel", count).tone, "success");
  const wrong = verdictOf(known, "solar", count);
  assert.equal(wrong.tone, "danger"); assert.equal(wrong.other, "rexel");
  assert.match(verdictOf({ rowCount: 5, missing: [] }, "ahlsell", count).text, /^Fel fil – det här är inte en prislista eller ett rabattbrev från Ahlsell/);
  const letter = { rowCount: 0, missing: [], rebateFile: { format: { wholesaler: "solar" as const, label: "Solar avtalsfil" }, counts: { groups: 3, articles: 1, netPrices: 0 } } };
  assert.equal(verdictOf(letter, "solar", count).text, "Rätt fil – Solar avtalsfil, 4 rabatter.");
});
