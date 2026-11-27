import assert from "node:assert/strict";
import test from "node:test";
import { KNOWN_FIXED_VARIANTS, priceKindOfHeading, rebateFileReason, rebateLinesReason } from "../lib/catalogue/price-kind";
import { CatalogueRowParser, classifyCatalogueRows, HIGH_PRICE_WARNING, type CatalogueRow } from "../lib/catalogue/model";
import { suggestCatalogueColumns } from "../lib/catalogue/columns";
import { applyArticle, pickOffer, priceSourceText, type CatalogueHit, type CatalogueOffer } from "../lib/catalogue/snapshot";

// Prisfiler (2026-10-13 natt): base price or net price, discount files, Ahlsell's text layout, the high-price
// warning. Invented rows only – never a supplier's real rows or prices.

test("price kind from the price column's heading: GNP, Listpris, GN-pris are base prices", () => {
  for (const heading of ["GNP", "Gnp", "Listpris", "GN-pris", "Bruttopris", "Grundpris"]) assert.equal(priceKindOfHeading(heading), "BASE", heading);
  for (const heading of ["Nettopris", "Pris", "Ert pris", "", null]) assert.equal(priceKindOfHeading(heading), "NET", String(heading));
});

test("the column suggestion says the price kind", () => {
  const rows = [["1000001", "Kabel exempel 3G1,5", "12,50", "m"], ["1000002", "Dosa exempel", "4,10", "st"]];
  assert.equal(suggestCatalogueColumns(["Artikelnr", "Benämning", "GNP", "Enhet"], rows).priceKind, "BASE");
  assert.equal(suggestCatalogueColumns(["Artikelnr", "Benämning", "Nettopris", "Enhet"], rows).priceKind, "NET");
});

test("a discount file is recognised: agreement headings, group;discount rows", () => {
  const agreement = rebateFileReason({ kind: "delimited", headers: ["Kod", "Produktgrupp", "Artikelnr", "RSK-nr", "Benämning", "Rabatt", "Rabatt2", "NtoPris", "ArtRabatt"], hasHeader: true },
    [["V", "100001", "", "", "Kabel påhittad", "50,00", "", "", ""]]);
  assert.ok(agreement);
  const groups = Array.from({ length: 20 }, (_, index) => [`G${index}X`, String(500 + index), ""]);
  assert.ok(rebateFileReason({ kind: "delimited", headers: ["Kolumn 1", "Kolumn 2", "Kolumn 3"], hasHeader: false }, groups));
  const prices = Array.from({ length: 20 }, (_, index) => [`10000${index}`, `Påhittad artikel ${index}`, "12,50", "st"]);
  assert.equal(rebateFileReason({ kind: "delimited", headers: ["Artikelnr", "Benämning", "Pris", "Enhet"], hasHeader: true }, prices), null);
});

test("a fixed-width discount letter is recognised from its heading line", () => {
  const lines = ["   Mg      Rabatt    Tilläggsrabatt1", ...Array.from({ length: 10 }, () => "   A01     25.0      2.0       0.0")];
  assert.ok(rebateLinesReason(lines));
  assert.equal(rebateLinesReason(Array.from({ length: 10 }, (_, index) => `ARTIKEL ${index}      000000012345 kabel`)), null);
  // An agreement file with a validity period at the end of each row (invented groups).
  assert.ok(rebateLinesReason(Array.from({ length: 10 }, (_, index) => `30010${index}    Påhittad grupp ${index}      0500000000      2026010199991231`)));
});

test("Ahlsell's text layout is recognised from invented lines of the same shape", () => {
  const ahlsell = KNOWN_FIXED_VARIANTS.find((variant) => variant.id === "ahlsell-txt")!;
  const line = (no: string, price: string, name: string) => `${no.padEnd(20)}${price.padStart(12, "0")}AB123CST N${name.padEnd(60)}0000000NNN`;
  const lines = Array.from({ length: 10 }, (_, index) => line(`9${index}0001`, String(1250 + index), `PÅHITTAD ARTIKEL ${index}`));
  assert.equal(lines[0].length, 112);
  assert.equal(ahlsell.matches(lines), true);
  assert.equal(ahlsell.matches(lines.map((text) => text.replace(/NNN$/, "123"))), false);
  // Its columns: number, base price in öre, group, unit, name.
  const headers = ahlsell.starts.map((start) => `Tecken ${start}`);
  const suggestion = suggestCatalogueColumns(headers, [], { variant: { id: ahlsell.id, label: ahlsell.label, wholesaler: ahlsell.wholesaler, fields: ahlsell.fields, priceScale: ahlsell.priceScale, priceKind: ahlsell.priceKind } });
  assert.equal(suggestion.mapping.articleNo, "Tecken 1");
  assert.equal(suggestion.mapping.price, "Tecken 21");
  assert.equal(suggestion.mapping.unit, "Tecken 39");
  assert.equal(suggestion.mapping.name, "Tecken 43");
  assert.equal(suggestion.priceScale, 100);
  assert.equal(suggestion.priceKind, "BASE");
});

test("a unit is never taken from a column with two values (J/N)", () => {
  const rows = Array.from({ length: 30 }, (_, index) => [`A${1000 + index}`, `Påhittad artikel nummer ${index}`, `${10 + index},50`, index % 2 ? "J" : "N"]);
  assert.equal(suggestCatalogueColumns(["Kolumn 1", "Kolumn 2", "Kolumn 3", "Kolumn 4"], rows).mapping.unit ?? null, null);
});

test("a price above 10 Mkr is imported with a warning, not stopped", () => {
  const parser = new CatalogueRowParser(["Artikelnr", "Benämning", "Pris"], { articleNo: "Artikelnr", name: "Benämning", price: "Pris" }, "2026-10-14");
  const row = parser.push(2, ["E1", "Påhittat energilager", String(HIGH_PRICE_WARNING + 500_000)]);
  assert.ok(row);
  assert.ok(row!.warnings.some((warning) => /ovanligt högt pris/.test(warning)));
  assert.equal(parser.highPrices, 1);
});

test("a price of another kind is a new price even with the same amount", () => {
  const row = { articleKey: "A1", amount: 10, perQuantity: 1 } as CatalogueRow;
  const existing = new Map([["A1", { id: "a1", latest: { priceId: "p1", amount: 10, perQuantity: 1, priceKind: "NET" as const } }]]);
  assert.equal(classifyCatalogueRows([row], existing, "NET").unchangedPrices, 1);
  assert.equal(classifyCatalogueRows([row], existing, "BASE").changedPrices, 1);
});

test("lowest price compares net prices first; a base price is marked on the copied row", () => {
  const offer = (id: string, unitPrice: number, priceKind?: "BASE"): CatalogueOffer => ({ id, name: "Påhittad", unit: "st", supplierArticleNo: id, eNumber: "", supplierName: id,
    price: { unitPrice, priceDate: "2026-10-01", sourceFileName: "fil.csv", importId: "i", ...(priceKind ? { priceKind } : {}) } });
  assert.equal(pickOffer([offer("bas", 5, "BASE"), offer("netto", 8)], { matched: "bas" }).id, "netto");
  assert.equal(pickOffer([offer("bas1", 9, "BASE"), offer("bas2", 6, "BASE")], { matched: "bas1" }).id, "bas2");
  const hit: CatalogueHit = { ...offer("bas", 5, "BASE"), wholesaler: "ahlsell" };
  const row = applyArticle({ id: "r", name: "", quantity: "1", unit: "st" }, hit);
  assert.equal(row.catalogue?.priceKind, "BASE");
  assert.equal(row.catalogue?.wholesaler, "ahlsell");
  assert.match(priceSourceText(row.catalogue!), /^Grundpris – inte ert avtalspris/);
});
