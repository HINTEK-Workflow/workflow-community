import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyArticle, type CatalogueHit } from "../lib/catalogue/snapshot";
import { searchDemoCatalogue } from "../features/demo/demo-catalogue";
import { pdfText } from "../lib/import/pdf-text";
import { quotesCsv, type AccountingQuote } from "../lib/quotes/accounting";
import { quoteLinesFromMaterials, workOrderMaterialsFromQuote } from "../lib/quotes/conversion";
import { publicQuoteView, quoteContentFingerprint } from "../lib/quotes/customer-link";
import { lineCatalogueJson, quoteLineInputSchema, quoteTotals, readLineCatalogue, type QuoteLineView, type QuoteView } from "../lib/quotes/model";
import { createQuotePdf } from "../lib/quotes/quote-report";
import { invoiceBasisLinesOf, linesFromWork, mergeLineSources, invoiceBasisInputSchema } from "../lib/invoice-basis/model";

// Sök i prisfilen, Artikelnummer and the compact list (2026-10-11, plan 1N). Made-up data.

const hit: CatalogueHit = {
  id: "art-1", name: "Installationskabel 3G1,5", unit: "m", supplierArticleNo: "100201", eNumber: "", supplierName: "SIM-Grossist", manufacturerArticleNo: "DK-3G15",
  price: { unitPrice: 12.4, priceDate: "2026-10-01", sourceFileName: "sim.xlsx", importId: "imp-1" },
};
const picked = applyArticle({ id: "r", name: "kab", quantity: "10", unit: "" }, hit);
const view = (patch: Partial<QuoteLineView> = {}): QuoteLineView => ({ id: "l1", kind: "MATERIAL", name: picked.name, quantity: "10", unit: "m", unitPrice: "12,4", markupPercent: "15", ...patch });

test("a picked article gives the line its article number, supplier and manufacturer number", () => {
  assert.equal(picked.articleNo, "100201");
  assert.equal(picked.articleSource, "SIM-Grossist");
  assert.equal(picked.manufacturerArticleNo, "DK-3G15");
  assert.equal(picked.catalogue?.manufacturerArticleNo, "DK-3G15");
});

test("the article number is kept inside the line's catalogue JSON, with or without a price copy – no schema change", () => {
  const withCopy = lineCatalogueJson({ catalogue: picked.catalogue, articleNo: "100201", articleSource: "SIM-Grossist" })!;
  assert.equal(withCopy.articleNo, "100201");
  assert.equal(withCopy.unitPrice, picked.catalogue!.unitPrice);
  const back = readLineCatalogue(withCopy);
  assert.equal(back.articleNo, "100201");
  assert.equal(back.articleSource, "SIM-Grossist");
  assert.equal(back.catalogue?.articleId, "art-1");
  // Typed by hand, no price copy: only the number.
  const own = lineCatalogueJson({ articleNo: " X-77 " })!;
  assert.deepEqual(own, { articleNo: "X-77" });
  assert.deepEqual(readLineCatalogue(own), { articleNo: "X-77" });
  // Nothing at all stays null (the column stays empty).
  assert.equal(lineCatalogueJson({}), null);
  assert.equal(lineCatalogueJson({ articleNo: "  " }), null);
  // A number cleared by hand on a line with a price copy stays cleared (the key is written as an empty text).
  assert.equal(readLineCatalogue(lineCatalogueJson({ catalogue: picked.catalogue, articleNo: "" })).articleNo, undefined);
});

test("a line saved before this shows the number of its own price copy", () => {
  const legacy = readLineCatalogue(picked.catalogue);
  assert.equal(legacy.articleNo, "100201");
  assert.equal(legacy.articleSource, "SIM-Grossist");
  assert.equal(readLineCatalogue(null).articleNo, undefined);
  assert.deepEqual(readLineCatalogue("fel"), {});
});

test("a quote line accepts the article number as typed text", () => {
  const parsed = quoteLineInputSchema.parse({ kind: "MATERIAL", name: "Kabel", quantity: "1", articleNo: "  AB-1 " });
  assert.equal(parsed.articleNo, "AB-1");
  assert.equal(quoteLineInputSchema.parse({ kind: "MATERIAL", name: "Kabel", quantity: "1" }).articleNo, "");
  assert.throws(() => quoteLineInputSchema.parse({ kind: "MATERIAL", name: "Kabel", quantity: "1", articleNo: "x".repeat(61) }));
});

test("quote to work order: the material row gets the article number, its supplier and the manufacturer's number", () => {
  const rows = workOrderMaterialsFromQuote({ id: "q1", number: 4, version: 1 }, [view({ articleNo: "100201", articleSource: "SIM-Grossist", manufacturerArticleNo: "DK-3G15" }), view({ id: "l2", articleNo: "" })], (() => { let n = 0; return () => `row-${++n}`; })());
  assert.equal(rows[0].articleNo, "100201");
  assert.equal(rows[0].articleSource, "SIM-Grossist");
  assert.equal(rows[0].manufacturerArticleNo, "DK-3G15");
  assert.ok(!("articleNo" in rows[1]), "no number, no key");
});

test("work order material to a new quote: the line takes the article number of its rows", () => {
  const result = quoteLinesFromMaterials([
    { name: "Kabel", quantity: "5", unit: "m", articleNo: "", unitPrice: "12,4" },
    { name: "Kabel", quantity: "5", unit: "m", articleNo: "100201", articleSource: "SIM-Grossist", manufacturerArticleNo: "DK-3G15" },
  ], { newId: () => "n1" });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].articleNo, "100201");
  assert.equal(result.lines[0].articleSource, "SIM-Grossist");
  assert.equal(result.lines[0].manufacturerArticleNo, "DK-3G15");
});

test("CSV has an Artikelnummer column; the quote's customer page shows the number but never the price copy", () => {
  const quote: AccountingQuote = { document: "quote", id: "q", label: "O-0001", title: "T", status: "ACCEPTED", date: "2026-10-11", customerName: "K", customerNumber: "", projectName: "", vatPercent: 25,
    lines: [{ articleNo: "100201", kind: "MATERIAL", name: "Kabel", quantity: 2, unit: "m", unitPrice: 12.4, markupPercent: 15 }] } as AccountingQuote;
  const csv = quotesCsv([quote]);
  assert.ok(csv.includes("\"Typ\";\"Artikelnummer\";\"Benämning\""));
  assert.ok(csv.includes("\"Material\";\"100201\";\"Kabel\""));
  const lines = [view({ articleNo: "100201", catalogue: picked.catalogue })];
  const publicView = publicQuoteView({
    quote: { number: 1, version: 1, title: "T", description: "", validUntil: "2026-11-01", terms: "", vatPercent: 25, customerType: "COMPANY", rotEnabled: false, rotPercent: null, rotCap: null, changeOfVersion: null, lines, sentAt: null },
    customerName: "K", placeName: "", customerContact: "", customerAddress: "", company: { name: "Alfa El", email: "" }, senderName: "",
  } as unknown as Parameters<typeof publicQuoteView>[0]);
  assert.equal(publicView.lines[0].articleNo, "100201");
  const text = JSON.stringify(publicView);
  assert.ok(!text.includes("SIM-Grossist") && !text.includes("DK-3G15") && !text.includes("12,4") && !text.includes("art-1"), "no supplier, manufacturer number, purchase price or article id");
  assert.ok(!("articleNo" in publicQuoteView({ quote: { number: 1, version: 1, title: "T", description: "", validUntil: "", terms: "", vatPercent: 25, customerType: "COMPANY", rotEnabled: false, rotPercent: null, rotCap: null, changeOfVersion: null, lines: [view()], sentAt: null },
    customerName: "", placeName: "", customerContact: "", customerAddress: "", company: { name: "", email: "" }, senderName: "" } as unknown as Parameters<typeof publicQuoteView>[0]).lines[0]), "no number, no key");
});

test("the fingerprint of a link only changes for a line that has an article number", () => {
  const base = { number: 1, version: 1, title: "T", description: "", validUntil: "2026-11-01", terms: "", vatPercent: 25, customerType: "COMPANY" as const, rotEnabled: false, rotPercent: null, rotCap: null, changeOfVersion: null };
  const plain = quoteContentFingerprint({ ...base, lines: [view()] });
  assert.equal(quoteContentFingerprint({ ...base, lines: [view({ articleNo: "" })] }), plain, "links sent before this stay valid");
  assert.notEqual(quoteContentFingerprint({ ...base, lines: [view({ articleNo: "100201" })] }), plain);
});

test("quote PDF: an Art.nr column only when a line has a number; never purchase price or markup", async () => {
  const font = new Uint8Array(await readFile("public/fonts/DejaVuSans.ttf"));
  const make = (lines: QuoteLineView[]): QuoteView => ({
    id: "q", number: 7, version: 1, label: "O-0007", revision: 1, title: "Byte", description: "", status: "SENT", storedStatus: "SENT", validUntil: "2026-11-08", terms: "", vatPercent: 25,
    customer: { id: "c", name: "Kund AB" }, facility: null, project: null, lines, totals: quoteTotals(lines), sentAt: "2026-10-09T08:00:00.000Z", decidedAt: null, createdAt: "2026-10-09T07:00:00.000Z",
    updatedAt: "2026-10-09T08:00:00.000Z", superseded: false, versions: [], actions: [], canEdit: true,
    customerType: "COMPANY", rotEnabled: false, rotPercent: null, rotCap: null, changeOfVersion: null, change: null, workOrder: null, workOrders: [], canCreateWorkOrder: false,
  });
  const render = async (lines: QuoteLineView[]) => pdfText(Buffer.from(await createQuotePdf({ identity: { company: "QA El AB" }, fontBytes: font, quote: make(lines), createdAt: new Date("2026-10-09T08:00:00Z") })))!.replace(/\s+/g, " ");
  const withNumber = await render([view({ articleNo: "100201" }), view({ id: "l2", kind: "LABOUR", name: "Montör", unit: "h", unitPrice: "600", markupPercent: "" })]);
  assert.match(withNumber, /Art\.nr/);
  assert.match(withNumber, /100201/);
  assert.ok(!withNumber.includes("12,4 ") && !/Påslag|Inköp|SIM-Grossist/.test(withNumber), "no purchase price, markup or supplier");
  const without = await render([view()]);
  assert.ok(!/Art\.nr/.test(without), "no column without a number");
});

test("invoice basis lines carry the article number from the work order row and keep it when saved", () => {
  const built = linesFromWork([{ id: "job1", title: "Jobb", entries: [], materials: [{ id: "m1", name: "Kabel", quantity: "3", unit: "m", unitPrice: "12,4", articleNo: "100201", articleSource: "SIM-Grossist", manufacturerArticleNo: "DK-3G15" }] }],
    { taken: new Set(), hourlyRate: "650", perJob: false });
  const line = built.lines.find((item) => item.kind === "MATERIAL")!;
  assert.equal(line.articleNo, "100201");
  assert.equal(line.manufacturerArticleNo, "DK-3G15");
  const input = invoiceBasisInputSchema.parse({ title: "T", lines: [{ ...line, articleNo: "100201-B" }] });
  const saved = mergeLineSources(built.lines, input.lines);
  assert.equal(saved[0].articleNo, "100201-B", "a number changed by hand is kept");
  assert.deepEqual(saved[0].sources, line.sources, "the sources are the server's");
  assert.equal(invoiceBasisLinesOf(saved)[0].articleNo, "100201-B");
  assert.equal(invoiceBasisLinesOf([{ id: "x", kind: "MATERIAL", name: "Äldre", quantity: "1", unit: "st", unitPrice: "", markupPercent: "", sources: [] }])[0].articleNo, undefined, "an older line has none");
});

test("the demo's price file answers on name, article number and manufacturer number, every word must match", () => {
  const names = (query: string) => searchDemoCatalogue(query).articles.map((article) => article.id);
  assert.ok(names("kabel").length >= 2);
  assert.deepEqual(names("100202"), ["demo-art-2"], "article number");
  assert.deepEqual(names("DK-5G25"), ["demo-art-3"], "manufacturer's number");
  assert.deepEqual(names("kabel 5g2,5"), ["demo-art-3"], "all words");
  assert.deepEqual(names("k"), [], "two characters at least");
  assert.deepEqual(names("finns inte"), []);
  assert.ok(searchDemoCatalogue("kabel").articles.every((article) => article.price && article.supplierName));
});
