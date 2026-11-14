import assert from "node:assert/strict";
import test from "node:test";
import {
  lineSupplier, materialRowsFromPurchase, purchaseActions, purchaseLineAmount, purchaseLineFromRow, purchaseNumberText, purchaseRefsOf, purchaseTotals, quoteLinesFromPurchase,
  quoteSumLineFromPurchase, refreshQuoteLines, statusAfterDelivery, type PurchaseLineView,
} from "@/lib/purchases/model";
import { lineCatalogueJson, readLineCatalogue } from "@/lib/quotes/model";
import { workflowTaskInputSchema } from "@/lib/workflow/task-model";

// Inköp (2026-10-16): only purchase prices, sums per supplier, delivery per line, and the way into a quote and a
// work order. The data is made up.
const line = (id: string, supplier: string, quantity: string, unitPrice: string, deliveredAt: string | null = null): PurchaseLineView => ({
  id, name: `Artikel ${id}`, quantity, unit: "st", unitPrice, supplierName: "", deliveredAt, sourceKind: null, sourceId: null,
  catalogue: { articleId: `a-${id}`, supplierName: supplier, supplierArticleNo: `S${id}`, eNumber: "", unitPrice, unit: "st", source: "fil.csv", priceDate: "2026-10-01" },
  articleNo: `S${id}`, articleSource: supplier,
});
const purchase = { id: "p1", label: "I-0007", revision: 3, lines: [line("1", "Solar", "10", "12,5"), line("2", "Ahlsell", "2", "100"), line("3", "Solar", "1", "")] };

test("a purchase is numbered I-0007 and sums per supplier, unpriced lines counted", () => {
  assert.equal(purchaseNumberText(7), "I-0007");
  assert.equal(purchaseLineAmount({ quantity: "10", unitPrice: "12,5" }), 125);
  assert.equal(purchaseLineAmount({ quantity: "1", unitPrice: "" }), null);
  const totals = purchaseTotals(purchase.lines);
  assert.deepEqual([totals.amount, totals.unpriced, totals.lines], [325, 1, 3]);
  assert.deepEqual(totals.bySupplier.map((entry) => [entry.supplierName, entry.lines, entry.amount]), [["Ahlsell", 1, 200], ["Solar", 2, 125]]);
  assert.equal(lineSupplier({ supplierName: "", catalogue: undefined }), "Utan leverantör");
});

test("statuses: a draft is ordered, an ordered purchase is delivered when every line has come", () => {
  assert.deepEqual(purchaseActions("DRAFT", 0), ["cancel", "delete"], "an empty draft cannot be ordered");
  assert.deepEqual(purchaseActions("DRAFT", 2), ["order", "cancel", "delete"]);
  assert.deepEqual(purchaseActions("ORDERED", 2), ["reopen", "cancel"]);
  assert.deepEqual(purchaseActions("DELIVERED", 2), []);
  assert.equal(statusAfterDelivery("ORDERED", [{ deliveredAt: "x" }, { deliveredAt: null }]), "ORDERED");
  assert.equal(statusAfterDelivery("ORDERED", [{ deliveredAt: "x" }, { deliveredAt: "y" }]), "DELIVERED");
  assert.equal(statusAfterDelivery("DELIVERED", [{ deliveredAt: null }]), "ORDERED", "unticking a line opens it again");
  assert.equal(statusAfterDelivery("DRAFT", [{ deliveredAt: "x" }]), "DRAFT");
});

test("into a quote as lines: purchase price as à-pris, the company's markup, the link to each line", () => {
  const lines = quoteLinesFromPurchase(purchase, "20");
  assert.equal(lines.length, 3);
  assert.deepEqual([lines[0].unitPrice, lines[0].markupPercent, lines[0].purchaseRef], ["12,5", "20", { purchaseId: "p1", label: "I-0007", revision: 3, lineId: "1" }]);
  // The supplier is in the price copy for the company's eyes only; the customer's documents show benämning, antal, pris.
  assert.equal(lines[0].catalogue?.supplierName, "Solar");
});

test("into a quote as one sum: antal 1, à-pris = the purchase sum, the markup editable", () => {
  const sum = quoteSumLineFromPurchase({ ...purchase, totals: purchaseTotals(purchase.lines) }, "15");
  assert.deepEqual([sum.name, sum.quantity, sum.unitPrice, sum.markupPercent, sum.purchaseRef.sum], ["Material", "1", "325", "15", true]);
});

test("Uppdatera offerten: the purchase's lines replace its old ones in place, markups kept, sum lines get the new sum", () => {
  type Line = { name: string; quantity: string; unitPrice?: string; markupPercent?: string; purchaseRef?: ReturnType<typeof quoteLinesFromPurchase>[number]["purchaseRef"] };
  const before: Line[] = [
    { name: "Arbete", quantity: "2", unitPrice: "650" },
    ...quoteLinesFromPurchase(purchase, "20").map((item, index) => ({ ...item, markupPercent: index === 1 ? "35" : item.markupPercent })),
    { name: "Material", quantity: "1", unitPrice: "100", markupPercent: "10", purchaseRef: { purchaseId: "p1", label: "I-0007", revision: 3, sum: true } },
    { name: "Resa", quantity: "1", unitPrice: "300" },
  ];
  const changed = { ...purchase, revision: 4, lines: [purchase.lines[1], line("4", "Rexel", "3", "10")] };
  const after = refreshQuoteLines(before, { ...changed, totals: purchaseTotals(changed.lines) }, "20", (item) => item);
  assert.deepEqual(after.map((item) => item.name), ["Arbete", "Artikel 2", "Artikel 4", "Material", "Resa"]);
  assert.equal(after[1].markupPercent, "35", "a line's own markup is kept");
  assert.equal(after[2].markupPercent, "20", "a new line takes the company's markup");
  assert.deepEqual([after[3].unitPrice, after[3].markupPercent, after[3].purchaseRef?.revision], ["230", "10", 4], "the sum line gets the new sum and keeps its markup");
  assert.deepEqual([...purchaseRefsOf(after).entries()], [["p1", 4]]);
});

test("into a work order: only the lines it does not have yet, as material rows with the link", () => {
  let n = 0;
  const first = materialRowsFromPurchase(purchase, [], () => `row-${++n}`, "20");
  assert.equal(first.length, 3);
  assert.deepEqual([first[0].kind, first[0].unitPrice, first[0].markupPercent, first[0].purchaseRef?.lineId], ["material", "12,5", "20", "1"]);
  assert.equal(first[2].unitPrice, undefined, "an unpriced line stays without price and markup");
  assert.equal(materialRowsFromPurchase(purchase, first, () => "x", "20").length, 0, "the same lines are not added twice");
});

test("the link survives the stores: a quote line's JSON and a work order's material row", () => {
  const ref = { purchaseId: "p1", label: "I-0007", revision: 3, lineId: "1", origin: true as const };
  const json = lineCatalogueJson({ articleNo: "", purchaseRef: ref });
  assert.deepEqual(readLineCatalogue(json).purchaseRef, ref);
  assert.equal(readLineCatalogue({ purchaseRef: { purchaseId: "" } }).purchaseRef, undefined, "an unreadable link is left out");
  const task = workflowTaskInputSchema.parse({ kind: "WORK_ORDER", title: "Jobb", status: "PLANNED", data: { kind: "WORK_ORDER", details: { materials: [{ id: "6f1c1c1e-6a8f-4f5e-9f6b-1b2c3d4e5f60", name: "Kabel", quantity: "1", unit: "m", purchaseRef: ref }] } } });
  const details = (task.data as { details: { materials: { purchaseRef?: unknown }[] } }).details;
  assert.deepEqual(details.materials[0].purchaseRef, ref);
});

test("a row picked on a document becomes a purchase line with its price copy", () => {
  const row = purchaseLineFromRow({ name: "Kabel", quantity: "", unit: "m", unitPrice: "12,5", articleNo: "S1", articleSource: "Solar" });
  assert.deepEqual([row.name, row.quantity, row.unitPrice, row.articleSource], ["Kabel", "1", "12,5", "Solar"], "an empty quantity starts at 1");
});

// Produktens uppgifter (2026-10-16: "informationen skall vara samma på alla ställen"): from the hit to the row and
// on to the purchase, the quote and the work order – the same facts, from any supplier.
test("the product's facts follow the article from the hit to every row", async () => {
  const { applyArticle } = await import("@/lib/catalogue/snapshot");
  const { productFacts, readProductInfo } = await import("@/lib/catalogue/product-info");
  const hit = { id: "a1", name: "Kabelrörsskydd", unit: "st", supplierArticleNo: "S1", eNumber: "0665009", supplierName: "Solar", manufacturer: "", manufacturerArticleNo: "", price: null,
    product: { source: "solar" as const, eNumber: "0665009", rskNumber: "", gtin: "7350134540303", manufacturer: "ELEKTROSKUTT", manufacturerArticleNo: "Capps 50", imageUrl: "https://example.invalid/p.png", statusText: "" } };
  const row = applyArticle({ id: "r1", name: "", quantity: "2", unit: "" }, hit);
  assert.deepEqual(productFacts(row.product), ["E 0665009", "EAN 7350134540303", "ELEKTROSKUTT", "tillv. Capps 50"]);
  assert.equal(row.product?.imageUrl, "https://example.invalid/p.png");
  const line = purchaseLineFromRow(row);
  assert.equal(line.product?.manufacturer, "ELEKTROSKUTT", "into the purchase");
  const stored = readLineCatalogue(lineCatalogueJson({ articleNo: "S1", product: readProductInfo(line.product) ?? undefined }));
  assert.equal(stored.product?.gtin, "7350134540303", "kept on the line");
  const purchaseWithProduct = { ...purchase, lines: [{ ...purchase.lines[0], product: stored.product }] };
  assert.equal(quoteLinesFromPurchase(purchaseWithProduct, "20")[0].product?.imageUrl, "https://example.invalid/p.png", "into the quote");
  assert.equal(materialRowsFromPurchase(purchaseWithProduct, [], () => "m1", "20")[0].product?.manufacturerArticleNo, "Capps 50", "into the work order");
});
