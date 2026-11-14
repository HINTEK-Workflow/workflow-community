import assert from "node:assert/strict";
import test from "node:test";
import {
  articleListLineInputSchema, articleListLinesSaveSchema, articleListTotal, articleRefInputSchema, articleRefKey, canEditArticleList, catalogRefOfHit, externalRefKey, hitIsFavorite, hitOfSnapshot, listQuantity,
  moveLine, parseRefKey, productRefKey, readRefSnapshot, refInputOfHit, registerArticleRefKey, rowOfListLine, rowOfResolved, snapshotOfHit, wholesaleIdentity, type ArticleListLineView, type ResolvedArticle,
} from "@/lib/catalogue/lists";
import type { CatalogueHit } from "@/lib/catalogue/snapshot";

// Favoriter och artikellistor (2026-10-16): how an article is pointed at, what a favourite keeps when the article
// is gone, how a list line becomes a document row, and the list's sum. The data is made up.
const hit = (overrides: Partial<CatalogueHit> = {}): CatalogueHit => ({
  id: "art-1", name: "Dvärgbrytare 1P C16", unit: "st", supplierArticleNo: "S100", eNumber: "2711016", supplierName: "Solar", manufacturerArticleNo: "MB-116", productId: "prod-1",
  common: { kind: "E", number: "2711016" },
  price: { unitPrice: 48.5, priceDate: "2026-10-01", sourceFileName: "solar.csv", importId: "imp-1" },
  offers: [
    { id: "art-1", name: "Dvärgbrytare 1P C16", unit: "st", supplierArticleNo: "S100", eNumber: "2711016", supplierName: "Solar", price: { unitPrice: 48.5, priceDate: "2026-10-01", sourceFileName: "solar.csv", importId: "imp-1" } },
    { id: "art-2", name: "Dvärgbrytare C16", unit: "st", supplierArticleNo: "A-77", eNumber: "2711016", supplierName: "Ahlsell", price: { unitPrice: 52, priceDate: "2026-10-01", sourceFileName: "ahlsell.txt", importId: "imp-2" } },
  ],
  ...overrides,
});

test("an article key has one of six forms; anything else is refused", () => {
  assert.deepEqual(parseRefKey("E:2711016"), { kind: "E", value: "2711016" });
  assert.deepEqual(parseRefKey("RSK:1234567"), { kind: "RSK", value: "1234567" });
  assert.deepEqual(parseRefKey("GTIN:07311234567890"), { kind: "GTIN", value: "07311234567890" });
  assert.deepEqual(parseRefKey("MPN:abb:s201c16"), { kind: "MPN", value: "abb:s201c16" });
  assert.deepEqual(parseRefKey("A:clx123"), { kind: "A", value: "clx123" });
  for (const bad of ["", "E:123", "RSK:12345678", "GTIN:123", "X:1", "A:", "E2711016", null, undefined]) assert.equal(parseRefKey(bad), null, String(bad));
  assert.equal(productRefKey({ numberKind: "E", number: "2711016" }), "E:2711016");
  assert.equal(productRefKey({ numberKind: "E", number: "27" }), null);
  assert.equal(articleRefKey("clx9"), "A:clx9");
});

test("Solar's catalogue product gets the key its product gets once a price file brings it", () => {
  assert.equal(externalRefKey({ eNumber: "2711016", gtin: "7311234567898" }), "E:2711016");
  assert.equal(externalRefKey({ eNumber: "", gtin: "4006381333931" }), "GTIN:04006381333931", "an EAN is read as 14 digits");
  assert.equal(externalRefKey({ gtin: "4006381333932" }), null, "a wrong check digit is no EAN");
  assert.equal(externalRefKey({ eNumber: "12", gtin: "" }), null);
});

test("what the browser sends: a product, an article or Solar's numbers – never a key", () => {
  assert.ok(articleRefInputSchema.safeParse({ productId: "p1" }).success);
  assert.ok(articleRefInputSchema.safeParse({ articleId: "a1" }).success);
  assert.ok(articleRefInputSchema.safeParse({ eNumber: "2711016" }).success);
  assert.equal(articleRefInputSchema.safeParse({ eNumber: "27" }).success, false);
  assert.equal(articleRefInputSchema.safeParse({}).success, false, "Solar's product without E-nummer or EAN");
  assert.deepEqual(refInputOfHit(hit()), { productId: "prod-1" }, "a product hit marks the product");
  assert.deepEqual(refInputOfHit(hit({ productId: undefined, id: "art-9" })), { articleId: "art-9" }, "a supplier's own article marks the article");
});

test("a snapshot keeps the name, unit and numbers, never a price", () => {
  const snapshot = snapshotOfHit(hit());
  assert.deepEqual([snapshot.name, snapshot.unit, snapshot.supplierName, snapshot.eNumber, snapshot.source], ["Dvärgbrytare 1P C16", "st", "Solar", "2711016", "register"]);
  assert.equal(JSON.stringify(snapshot).includes("48.5"), false);
  assert.deepEqual(readRefSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot, "read back as stored");
  assert.equal(readRefSnapshot({ unit: "st" }), null, "a snapshot without a name is unreadable");
  const bare = hitOfSnapshot({ ...snapshot, source: "solar", supplierName: "" }, "E:2711016");
  assert.deepEqual([bare.price, bare.supplierName, bare.eNumber], [null, "Solars katalog", "2711016"]);
});

const resolved = (overrides: Partial<ResolvedArticle> = {}): ResolvedArticle => ({ key: "E:2711016", hit: hit(), snapshot: snapshotOfHit(hit()), productId: "prod-1", articleId: null, ...overrides });

test("a favourite or list line becomes a row the way a search hit does, with today's price", () => {
  const added = rowOfResolved(resolved(), "3", "row-1");
  assert.deepEqual([added.row.id, added.row.name, added.row.quantity, added.row.unitPrice, added.row.catalogue?.supplierName, added.supplierName, added.fromCatalogue], ["row-1", "Dvärgbrytare 1P C16", "3", "48,5", "Solar", "Solar", false]);
  // Someone who may not see prices: the server prices the row on save.
  const hidden = rowOfResolved(resolved({ hit: { ...hit(), price: null, priceHidden: true } }), "1", "row-2");
  assert.deepEqual([hidden.row.unitPrice, hidden.row.pickedArticleId], [undefined, "art-1"]);
  // No longer in the register: the snapshot without a price.
  const gone = rowOfResolved(resolved({ hit: null }), "2", "row-3");
  assert.deepEqual([gone.row.name, gone.row.unitPrice, gone.row.catalogue, gone.fromCatalogue], ["Dvärgbrytare 1P C16", undefined, undefined, true]);
  // A free-text line.
  const free = rowOfListLine({ name: "Kabelstege, kapas på plats", unit: "m", quantity: "6", article: null }, "row-4");
  assert.deepEqual(free, { row: { id: "row-4", name: "Kabelstege, kapas på plats", quantity: "6", unit: "m" }, supplierName: "", fromCatalogue: false });
});

test("the list's sum counts the lines with a price; the others are counted apart", () => {
  const lines: Pick<ArticleListLineView, "quantity" | "article">[] = [
    { quantity: "2", article: resolved() },
    { quantity: "1,5", article: resolved({ hit: { ...hit(), price: { unitPrice: 10, priceDate: "2026-10-01", sourceFileName: "x", importId: "i" } } }) },
    { quantity: "1", article: null },
    { quantity: "1", article: resolved({ hit: null }) },
  ];
  assert.deepEqual(articleListTotal(lines), { amount: 112, unpriced: 2 });
});

test("quantities above zero; the lines saved as they stand", () => {
  assert.equal(listQuantity("2,5"), 2.5);
  assert.equal(listQuantity(3), 3);
  for (const bad of ["0", "-1", "", "abc", "2000000"]) assert.equal(listQuantity(bad), null, bad);
  assert.equal(articleListLineInputSchema.safeParse({ name: "Fritext", quantity: "0" }).success, false);
  const parsed = articleListLineInputSchema.parse({ ref: { productId: "p1" }, quantity: "4" });
  assert.equal(parsed.quantity, 4);
  assert.deepEqual(articleListLinesSaveSchema.parse([{ id: "l1", quantity: "1,5" }, { quantity: "2", name: "Ny rad", unit: "st" }]), [{ id: "l1", quantity: 1.5 }, { quantity: 2, name: "Ny rad", unit: "st" }]);
});

test("moving a line renumbers the list", () => {
  const lines = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }];
  assert.deepEqual(moveLine(lines, 2, 0).map((line) => `${line.id}${line.position}`), ["c0", "a1", "b2"]);
  assert.deepEqual(moveLine(lines, 0, 5).map((line) => line.id), ["a", "b", "c"], "outside the list nothing moves");
});

test("the star follows the product, and a supplier's article within it", () => {
  assert.equal(hitIsFavorite(hit(), [{ productId: "prod-1", articleId: null }]), true);
  assert.equal(hitIsFavorite(hit(), [{ productId: null, articleId: "art-2" }]), true, "an offer of the product");
  assert.equal(hitIsFavorite(hit(), [{ productId: "prod-9", articleId: null }]), false);
  assert.equal(hitIsFavorite(hit({ productId: undefined, offers: undefined, id: "art-5" }), [{ productId: null, articleId: "art-5" }]), true);
});

test("a list is changed by the one who made it and by an admin", () => {
  assert.equal(canEditArticleList({ userId: "u1", admin: false }, { createdById: "u1" }), true);
  assert.equal(canEditArticleList({ userId: "u2", admin: false }, { createdById: "u1" }), false);
  assert.equal(canEditArticleList({ userId: "u2", admin: true }, { createdById: "u1" }), true);
  assert.equal(canEditArticleList({ userId: "u2", admin: false }, { createdById: null }), false, "a list whose maker is gone: an admin");
});

// Priser direkt mot grossistens katalogartikel (2026-10-17): a wholesaler's article without a common number is pointed at by "W:".
const wholesaleHit = (overrides: Partial<CatalogueHit> = {}): CatalogueHit => ({
  id: "solar:2000000001:clxsupplier000000000001", name: "Kabelstege 200 mm", unit: "m", supplierArticleNo: "2000000001", eNumber: "", supplierName: "Solar", supplierId: "clxsupplier000000000001", wholesaler: "solar",
  catalog: { wholesaler: "solar", articleNo: "2000000001", name: "Kabelstege", description: "", productType: "", series: "", status: "10", statusText: "" },
  price: { unitPrice: 120, priceDate: "2026-10-01", sourceFileName: "solar.csv", importId: "imp-9" }, ...overrides,
});

test("a wholesaler's article key is W:<wholesaler>:<number> – only for a known wholesaler and a number", () => {
  assert.deepEqual(parseRefKey("W:solar:2000000001"), { kind: "W", value: "solar:2000000001" });
  assert.deepEqual(parseRefKey("W:rexel:REX-98765"), { kind: "W", value: "rexel:REX-98765" });
  for (const bad of ["W:okand:1", "W:solar:", "W:solar", "W:", "w:solar:1", "W:Solar:1"]) assert.equal(parseRefKey(bad), null, bad);
  assert.equal(registerArticleRefKey({ wholesaler: "solar", articleNo: "2000000001" }), "W:solar:2000000001", "no common number: the W key");
  assert.equal(registerArticleRefKey({ wholesaler: "solar", articleNo: "2000000001", eNumber: "2711016" }), "E:2711016", "an E-nummer keeps the E key, as a product of Solar's catalogue always had");
  assert.equal(registerArticleRefKey({ wholesaler: "solar", articleNo: "2000000001", gtin: "4006381333931" }), "GTIN:04006381333931");
  assert.equal(registerArticleRefKey({ wholesaler: "okand", articleNo: "1" }), null);
  assert.equal(registerArticleRefKey({ wholesaler: "solar", articleNo: "x".repeat(120) }), null, "too long for the key");
});

test("every form that names a wholesaler's article gives the same identity", () => {
  for (const id of ["W:solar:2000000001", "solar:2000000001", "solar:2000000001:clxsupplier000000000001", "W:solar:2000000001:clxsupplier000000000001"]) assert.equal(wholesaleIdentity(id), "solar:2000000001", id);
  for (const other of ["clxabcdefghijklmnopqrstuv", "A:clx123", "E:2711016", "ref:E:2711016", "okand:1", "", null, undefined]) assert.equal(wholesaleIdentity(other), null, String(other));
});

test("what the browser sends for a wholesaler's article: the wholesaler and its number, or the hit's id", () => {
  assert.ok(articleRefInputSchema.safeParse({ wholesaler: "solar", articleNo: "2000000001" }).success);
  assert.equal(articleRefInputSchema.safeParse({ wholesaler: "okand", articleNo: "1" }).success, false);
  assert.equal(articleRefInputSchema.safeParse({ wholesaler: "solar", articleNo: "" }).success, false);
  assert.deepEqual(refInputOfHit(wholesaleHit()), { articleId: "solar:2000000001:clxsupplier000000000001" }, "a priced wholesale offer is marked by its id; the server finds the key");
  // A register article no price file has: its E-nummer or EAN, otherwise the wholesaler and its number.
  const unpriced = wholesaleHit({ id: "solar:2000000001", price: null, catalogOnly: true });
  assert.deepEqual(catalogRefOfHit(unpriced), { key: "W:solar:2000000001", ref: { wholesaler: "solar", articleNo: "2000000001" } });
  assert.deepEqual(catalogRefOfHit({ ...unpriced, eNumber: "2711016" }), { key: "E:2711016", ref: { eNumber: "2711016", gtin: undefined } });
  assert.equal(catalogRefOfHit({ eNumber: "", catalog: undefined }), null, "nothing to point at");
});

test("the star finds a wholesaler's article whichever form the hit's id has, and a product by its common number", () => {
  const favorite = { key: "W:solar:2000000001", productId: null, articleId: null };
  assert.equal(hitIsFavorite(wholesaleHit(), [favorite]), true, "the company's offer on it");
  assert.equal(hitIsFavorite(wholesaleHit({ id: "solar:2000000001", price: null, catalogOnly: true }), [favorite]), true, "the register's own row");
  assert.equal(hitIsFavorite(wholesaleHit({ id: "ref:x", catalog: undefined, offers: [wholesaleHit(), wholesaleHit({ id: "solar:2000000001:clxsupplier000000000002" })] }), [favorite]), true, "an offer of the hit");
  assert.equal(hitIsFavorite(wholesaleHit({ id: "solar:2000000002:clxsupplier000000000001", catalog: { ...wholesaleHit().catalog!, articleNo: "2000000002" } }), [favorite]), false, "another article");
  // A product only a wholesaler's price list has: no product of the company's to point at, so the key is the common number.
  const hit = wholesaleHit({ common: { kind: "E", number: "2711016" }, eNumber: "2711016" });
  assert.equal(hitIsFavorite(hit, [{ key: "E:2711016", productId: null, articleId: null }]), true);
  assert.equal(hitIsFavorite(hit, [{ key: "E:2711017", productId: null, articleId: null }]), false);
  assert.equal(hitIsFavorite({ ...hit, productId: "prod-1" }, [{ key: "E:2711016", productId: null, articleId: null }]), false, "a hit that is a product of the company's is found by the product");
});

test("a wholesaler's article the company has no price on is added from the catalogue, without a price", () => {
  const unpriced = wholesaleHit({ id: "solar:2000000001", price: null, catalogOnly: true, supplierName: "Solars katalog" });
  const added = rowOfResolved({ key: "W:solar:2000000001", hit: unpriced, snapshot: snapshotOfHit(unpriced, "solar"), productId: null, articleId: unpriced.id }, "4", "row-9");
  assert.deepEqual([added.row.name, added.row.quantity, added.row.unitPrice, added.row.catalogue, added.supplierName, added.fromCatalogue], ["Kabelstege 200 mm", "4", undefined, undefined, "Solar", true]);
  const priced = rowOfResolved({ key: "W:solar:2000000001", hit: wholesaleHit(), snapshot: snapshotOfHit(wholesaleHit()), productId: null, articleId: "x" }, "2", "row-8");
  assert.deepEqual([priced.row.unitPrice, priced.row.catalogue?.supplierName, priced.row.catalogue?.wholesaler, priced.supplierName, priced.fromCatalogue], ["120", "Solar", "solar", "Solar", false]);
});
