// Prisfiler etapp 1 (2026-10-12): column suggestion (headings with the trade's abbreviations, then content),
// article number normalisation, duplicates and zero prices, the one article register's offers, the link to the
// wholesale export, and the search SQL. Made-up rows only – never a supplier's data.
import assert from "node:assert/strict";
import test from "node:test";
import { suggestCatalogueColumns } from "../lib/catalogue/columns";
import { articleNoCore, commonNumberOf, eNumberFromArticleNo, normalizeArticleNo } from "../lib/catalogue/normalize";
import { CatalogueRowParser, normalizeUnit, parseCatalogueRows } from "../lib/catalogue/model";
import { applyArticle, hitWithOffer, linkedWholesaleIds, pickOffer, type CatalogueHit, type CatalogueOffer } from "../lib/catalogue/snapshot";
import { buildArticleSearchSql, parseArticleQuery } from "../lib/catalogue/search-sql";
import { trigramSql, quotedSchema } from "../lib/search/trgm-sql";
import { cleanRowWholesale } from "../lib/wholesale/model";
import { resolveIdentifier } from "../lib/wholesale/prepare";
import { WHOLESALE_PROFILES } from "../lib/wholesale/profiles";

const TODAY = "2026-10-12";
const sqlText = (sql: { strings: readonly string[] }) => sql.strings.join("?");

test("headings: the trade's abbreviations are aliases (GNP, GN-pris, Artnr, Artben, Sortkod, Gdatum, Mg, RSK)", () => {
  const one = suggestCatalogueColumns(["Artnr", "Artben", "Sortkod", "Gdatum", "Mg", "Gnp"], [["E1000001", "Påhittad", "ST", "20261001", "A1", "10,00"]]);
  assert.deepEqual({ ...one.mapping }, { articleNo: "Artnr", name: "Artben", unit: "Sortkod", priceDate: "Gdatum", discountGroup: "Mg", price: "Gnp", eNumber: null, manufacturerArticleNo: null, perQuantity: null, rskNumber: null, gtin: null, manufacturer: null, packageSize: null, orderMultiple: null, minOrderQuantity: null, stocked: null, status: null, priceOnRequest: null });
  assert.ok(one.suggestions.every((item) => item.source === "heading"));
  const two = suggestCatalogueColumns(["Artikelnr", "GNP", "Materialklass", "Enhet", "Benämning", "RSK"], [["1", "2,00", "X", "ST", "Dosa", ""]]);
  assert.equal(two.mapping.price, "GNP");
  assert.equal(two.mapping.discountGroup, "Materialklass");
  assert.equal(two.mapping.rskNumber, "RSK");
  assert.equal(suggestCatalogueColumns(["Artikelnummer", "Benämning", "GN-pris"], []).mapping.price, "GN-pris");
});

test("content: a file without headings gets its columns from the values, with reasons, for the person to confirm", () => {
  const rows = Array.from({ length: 60 }, (_, index) => [
    String(2000000 + index * 13), ["Kabel vit", "Dosa grå", "Rör svart", "Lampa stor", "Klämma liten"][index % 5] + ` modell ${index}`, ["ST", "M", "FP", "PAR"][index % 4],
    `${(index % 90) + 1},${String(index % 100).padStart(2, "0")}`, "20261001", index % 2 ? "J" : "N",
  ]);
  const headers = ["Kolumn 1", "Kolumn 2", "Kolumn 3", "Kolumn 4", "Kolumn 5", "Kolumn 6"];
  const found = suggestCatalogueColumns(headers, rows);
  assert.equal(found.mapping.articleNo, "Kolumn 1");
  assert.equal(found.mapping.name, "Kolumn 2");
  assert.equal(found.mapping.unit, "Kolumn 3", "the unit, not the J/N flag");
  assert.equal(found.mapping.price, "Kolumn 4");
  assert.equal(found.mapping.priceDate, "Kolumn 5", "an eight-digit date is a date, not a price");
  assert.ok(found.suggestions.filter((item) => item.source === "content").every((item) => item.reason.length > 5), "every guess says why");
  assert.deepEqual(found.articleNoLooksLikeENumber, { share: 1 }, "seven digits: probably E-nummer – to confirm, never assumed");
  // A fixed run of digits with leading zeros is a price in hundredths.
  const fixed = suggestCatalogueColumns(["A", "B", "C"], Array.from({ length: 40 }, (_, index) => [`Q${index}X`, `000000${String(1000 + index * 37).padStart(6, "0")}`, `Påhittad vara nr ${index}`]));
  assert.equal(fixed.mapping.price, "B");
  assert.equal(fixed.priceScale, 100);
  assert.equal(fixed.articleNoLooksLikeENumber, undefined);
});

test("article numbers are normalised for the search; leading zeros and an E in front are handled", () => {
  assert.equal(normalizeArticleNo(" AB-12 34/5 "), "ab12345");
  assert.equal(normalizeArticleNo("Ö-1"), "o1");
  assert.equal(articleNoCore("0001234"), "1234");
  assert.equal(articleNoCore("E0001234"), "1234", "E + seven digits");
  assert.equal(articleNoCore("E00012345"), "e00012345", "not seven digits: the E stays");
  assert.equal(articleNoCore("0000"), "0");
  assert.equal(articleNoCore(""), "");
  assert.equal(eNumberFromArticleNo("E1234567"), "1234567");
  assert.equal(eNumberFromArticleNo("12 345 67"), "1234567");
  assert.equal(eNumberFromArticleNo("123456"), "");
  assert.equal(eNumberFromArticleNo("12345678"), "");
  assert.deepEqual(commonNumberOf({ eNumber: "1234567", rskNumber: "7654321" }), { kind: "E", number: "1234567" });
  assert.deepEqual(commonNumberOf({ eNumber: "123456", rskNumber: "7654321" }), { kind: "RSK", number: "7654321" });
  assert.equal(commonNumberOf({ eNumber: "", rskNumber: "" }), null);
  assert.equal(normalizeUnit("PÅS"), "påse");
  assert.equal(normalizeUnit("STS"), "st");
});

test("duplicates are reported, never dropped in silence: the same article twice, and two products under one number", () => {
  const headers = ["Artikelnummer", "Benämning", "Pris"];
  const mapping = { articleNo: "Artikelnummer", name: "Benämning", price: "Pris" };
  const parsed = parseCatalogueRows(headers, [
    ["A-1", "Dosa vit", "4"], ["A-1", "Dosa  vit", "4"], ["A-1", "Skruv lång", "1"], ["a-1", "Annat", "2"], ["A-2", "Gratis?", "0"],
  ], mapping, TODAY);
  assert.deepEqual(parsed.rows.map((row) => row.articleNo), ["A-1", "A-2"]);
  assert.deepEqual(parsed.errors.map((error) => [error.line, error.kind]), [[3, "duplicate"], [4, "conflict"], [5, "conflict"]]);
  assert.match(parsed.errors[1].message, /samma artikelnummer som rad 2 men en annan produkt \(”Skruv lång”\)/);
  assert.match(parsed.rows[1].warnings[0], /priset är 0/, "a zero price is imported but flagged");
  // Only whitespace is folded: two names that differ by an "s" are two products, not a duplicate (2026-10-13).
  const byS = parseCatalogueRows(headers, [["B-1", "Kabelskåp", "4"], ["B-1", "Kabelkåp", "4"]], mapping, TODAY);
  assert.deepEqual(byS.errors.map((error) => error.kind), ["conflict"]);
  const parser = new CatalogueRowParser(headers, mapping, TODAY);
  parser.push(2, ["A-9", "Rör", "0"]);
  assert.equal(parser.zeroPrices, 1);
});

test("price scale, E-nummer from the article number (never on a row with RSK) and the RSK column", () => {
  const headers = ["Nr", "Namn", "Pris", "RSK"];
  const mapping = { articleNo: "Nr", name: "Namn", price: "Pris", rskNumber: "RSK" };
  const parsed = parseCatalogueRows(headers, [["E1234567", "Brytare", "000000012345", ""], ["7654321", "Ventil", "000000000500", "7654321"], ["12345", "Kort", "000000000100", ""]], mapping, TODAY, { priceScale: 100, articleNoIsENumber: true });
  assert.deepEqual(parsed.rows.map((row) => [row.amount, row.eNumber, row.rskNumber]), [[123.45, "1234567", ""], [5, "", "7654321"], [1, "", ""]]);
  const plain = parseCatalogueRows(headers, [["1234567", "Brytare", "10", ""]], mapping, TODAY);
  assert.equal(plain.rows[0].eNumber, "", "without the person's choice an article number never becomes an E-nummer");
});

const offer = (id: string, supplierName: string, unitPrice: number | null, over: Partial<CatalogueOffer> = {}): CatalogueOffer => ({
  id, name: `Brytare ${id}`, unit: "st", supplierArticleNo: `${id}-NR`, eNumber: "1234567", supplierName, supplierId: `s-${supplierName}`,
  price: unitPrice === null ? null : { unitPrice, priceDate: TODAY, sourceFileName: "lista.csv", importId: "i" }, ...over,
});

test("one product, every supplier's offer: the row takes the exact hit, otherwise the lowest price above zero", () => {
  const offers = [offer("a", "Grossist Ett", 120), offer("b", "Grossist Två", 99), offer("c", "Grossist Tre", 0), offer("d", "Grossist Fyra", null)];
  assert.equal(pickOffer(offers, { matched: "a" }).id, "b", "the lowest price");
  assert.equal(pickOffer(offers, { matched: "a", exact: true }).id, "a", "the article found by its own number");
  assert.equal(pickOffer(offers, { matched: "a", supplierId: "s-Grossist Fyra" }).id, "d", "the supplier searched for");
  const hit: CatalogueHit = { ...offers[1], productId: "p1", offers };
  assert.equal(hitWithOffer(hit, "a").supplierArticleNo, "a-NR");
  assert.equal(hitWithOffer({ ...hit, priceHidden: true, price: null }, "a").price, null, "a hidden price stays hidden");
});

test("the wholesale export gets each wholesaler's own number of the same product, marked as from its price list", () => {
  const offers = [offer("s", "Solar Test AB", 10, { supplierArticleNo: "1234567" }), offer("a", "Ahlsell Test AB", 11, { supplierArticleNo: "00A-77" }), offer("x", "Egen leverantör", 12)];
  const hit: CatalogueHit = { ...offers[0], productId: "p1", offers };
  assert.deepEqual(linkedWholesaleIds(hit), { ahlsell: "00A-77" }, "not the picked supplier's own, not a non-wholesaler");
  assert.deepEqual(linkedWholesaleIds({ ...hit, productId: undefined }), {}, "an article without a common number links nothing");
  const row = applyArticle({ id: "r", name: "", quantity: "2", unit: "st" }, hit);
  assert.deepEqual(row.wholesale, { ids: { ahlsell: "00A-77" }, linked: { ahlsell: "00A-77" } });
  const line = { id: "r", name: row.name, quantity: "2", unit: "st", supplierName: row.catalogue?.supplierName, supplierArticleNo: row.catalogue?.supplierArticleNo, eNumber: row.catalogue?.eNumber, wholesale: row.wholesale };
  const resolved = resolveIdentifier(line, WHOLESALE_PROFILES.ahlsell);
  assert.equal(resolved?.value, "00A-77");
  assert.equal(resolved?.origin, "supplier");
  // Changed by hand: the person's number, no longer called the price list's.
  const typed = cleanRowWholesale({ ...row.wholesale, ids: { ahlsell: "EGET-1" } });
  assert.deepEqual(typed, { ids: { ahlsell: "EGET-1" } });
  assert.equal(resolveIdentifier({ ...line, wholesale: typed }, WHOLESALE_PROFILES.ahlsell)?.origin, "user");
});

test("the search SQL: words and numbers are parameters; the trigram operator carries pg_trgm's schema", () => {
  const query = parseArticleQuery("x'; drop table \"User\"; -- 10%_0 0001234");
  assert.equal(query.words.length, 6, "at most six words");
  const sql = buildArticleSearchSql({ organizationId: "org-1", query, limit: 500, mode: "typo", trigram: "public" });
  assert.ok(!sqlText(sql).includes("drop table"));
  assert.ok(sql.values.includes("org-1"), "always bound to the company");
  assert.ok(sql.values.some((value) => value === "%10\\%\\_0%"), "LIKE wildcards are escaped");
  assert.match(sqlText(sql), /OPERATOR\("public"\.<%\)/);
  assert.match(sqlText(sql), /"public"\.word_similarity/);
  assert.ok(sql.values.includes(50), "the limit is capped");
  const numbers = parseArticleQuery("E0001234");
  assert.deepEqual(numbers.words[0], { text: "e0001234", norm: "e0001234", core: "1234", digits: "0001234", idLike: true, fuzzy: false, gtin: "" });
  assert.ok(buildArticleSearchSql({ organizationId: "o", query: numbers, limit: 20, mode: "match", supplierId: "s1" }).values.includes("s1"), "the supplier filter");
  assert.doesNotMatch(sqlText(buildArticleSearchSql({ organizationId: "o", query: parseArticleQuery("kabel"), limit: 20, mode: "match" })), /<%/, "no typo pass in the first query");
  assert.equal(quotedSchema("public"), "\"public\"");
  assert.equal(quotedSchema("x\"; drop"), null, "a schema name is an identifier or nothing");
  assert.match(sqlText(trigramSql(true).wordSimilar("w", { strings: ["t"], values: [] } as never)), /<%/);
});
