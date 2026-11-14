import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankInvoiceLine, invoiceBasisInputSchema, invoiceBasisLabel, invoiceBasisLinesOf, invoiceBasisTotals, invoiceLineHoursText, invoiceLineSubtitle, invoiceProposalKey, invoiceReadyProblem,
  invoiceSourceKeys, linesFromWork, markedText, materialsFromData, mergeLineSources, newBasisReason, notCompletedText, patchInvoiceLine, quoteLabelsOf, quoteNoteText, rowSourceKey,
  timeSourceKey, type InvoiceSourceJob,
} from "../lib/invoice-basis/model";
import { quoteOre, quotesCsv, quotesSie, quoteVoucher, type AccountingQuote, type AccountingSettings } from "../lib/quotes/accounting";
import { fortnoxInvoicePayload } from "../lib/quotes/fortnox";

// Fakturaunderlag från utfört arbete (2026-10-10): the pure rules – what a new basis takes from a finished job,
// that nothing taken is taken again, the sums (the quote's rule), the list as the person changes it, and the export.

const job = (over: Partial<InvoiceSourceJob> = {}): InvoiceSourceJob => ({
  id: "task-1", title: "Byte av central",
  entries: [{ id: "t1", durationSec: 3 * 3600 }, { id: "t2", durationSec: 5400 }, { id: "t0", durationSec: 0 }],
  materials: [
    { id: "m1", name: "Jordfelsbrytare", quantity: "2", unit: "st", unitPrice: "450", markupPercent: "15" },
    { id: "m2", name: "Kabel", quantity: "12,5", unit: "m", unitPrice: "", markupPercent: "" },
    { id: "m3", name: "  ", quantity: "1", unit: "st" },
    { id: "e1", kind: "expense", name: "Bilkostnad: tur och retur 2 × 10 km (längs väg) × 35 kr/mil", quantity: "20", unit: "km", unitPrice: "3,5", amount: "70,00" },
    { id: "e2", kind: "expense", name: "Parkering", quantity: "1", unit: "st", unitPrice: "", amount: "" },
  ],
  ...over,
});

test("a new basis takes the finished time as one Arbete line, every material row and every expense row", () => {
  const built = linesFromWork([job()], { taken: new Set(), hourlyRate: "650", perJob: false });
  assert.deepEqual(built.lines.map((line) => [line.kind, line.name, line.quantity, line.unit, line.unitPrice, line.markupPercent]), [
    ["LABOUR", "Arbete", "4,5", "h", "650", ""],
    ["MATERIAL", "Jordfelsbrytare", "2", "st", "450", "15"],
    ["MATERIAL", "Kabel", "12,5", "m", "", ""],
    ["OTHER", "Bilkostnad: tur och retur 2 × 10 km (längs väg) × 35 kr/mil", "20", "km", "3,5", ""],
    ["OTHER", "Parkering", "1", "st", "", ""],
  ]);
  assert.deepEqual(built.lines.map((line) => line.id), ["labour:task-1", "row:task-1:m1", "row:task-1:m2", "row:task-1:e1", "row:task-1:e2"], "ids follow what a line takes");
  assert.deepEqual(built.lines[0].sources, ["time:t1", "time:t2"], "a zero entry is not taken");
  assert.deepEqual(built.sources, ["time:t1", "time:t2", "row:task-1:m1", "row:task-1:m2", "row:task-1:e1", "row:task-1:e2"]);
  assert.equal(built.candidates, 6, "the unnamed material row is not a source");
  assert.deepEqual(invoiceSourceKeys([job()]), built.sources);
  // 4,5 × 650 = 2925; 2 × 450 × 1,15 = 1035; 70; two lines without price.
  const totals = invoiceBasisTotals(built.lines);
  assert.deepEqual([totals.byKind.LABOUR, totals.byKind.MATERIAL, totals.byKind.OTHER, totals.net, totals.vat, totals.gross, totals.unpriced], [2925, 1035, 70, 4030, 1007.5, 5037.5, 2]);
});

test("what is already on a basis is never taken again; the hours are rounded to two decimals; no rate = no price", () => {
  const taken = new Set([timeSourceKey("t1"), rowSourceKey("task-1", "m1"), rowSourceKey("task-1", "e1")]);
  const built = linesFromWork([job({ entries: [{ id: "t1", durationSec: 3600 }, { id: "t2", durationSec: 1000 }] })], { taken, hourlyRate: "", perJob: false });
  assert.deepEqual(built.lines.map((line) => [line.kind, line.name, line.quantity, line.unitPrice]), [
    ["LABOUR", "Arbete", "0,28", ""], ["MATERIAL", "Kabel", "12,5", ""], ["OTHER", "Parkering", "1", ""],
  ]);
  assert.deepEqual(built.sources, ["time:t2", "row:task-1:m2", "row:task-1:e2"]);
  const nothing = linesFromWork([job()], { taken: new Set(invoiceSourceKeys([job()])), hourlyRate: "650", perJob: false });
  assert.deepEqual([nothing.lines.length, nothing.sources.length, nothing.candidates], [0, 0, 6]);
});

test("a project's basis: one Arbete line per job named after it, then material and expenses", () => {
  const second = job({ id: "task-2", title: "Belysning  trapphus", entries: [{ id: "t9", durationSec: 7200 }], materials: [{ id: "x", name: "LED-armatur", quantity: "ca 4", unit: "", unitPrice: "890" }] });
  const built = linesFromWork([job({ materials: [] }), second], { taken: new Set(), hourlyRate: "650", perJob: true });
  assert.deepEqual(built.lines.map((line) => [line.kind, line.name, line.quantity, line.unit]), [
    ["LABOUR", "Arbete – Byte av central", "4,5", "h"], ["LABOUR", "Arbete – Belysning trapphus", "2", "h"], ["MATERIAL", "LED-armatur", "ca 4", "st"],
  ]);
  assert.equal(invoiceBasisTotals(built.lines).unpriced, 1, "an antal that is not a number has no amount until it is corrected");
});

test("why no new basis can be made", () => {
  assert.equal(newBasisReason({ project: false, completedJobs: 0, candidates: 0, available: 0, takenBy: [] }), "Färdigställ jobbet först.");
  assert.equal(newBasisReason({ project: true, completedJobs: 0, candidates: 0, available: 0, takenBy: [] }), "Inget jobb i projektet är färdigställt än.");
  assert.match(newBasisReason({ project: false, completedJobs: 1, candidates: 0, available: 0, takenBy: [] }), /^Det finns inget att fakturera på jobbet/);
  assert.equal(newBasisReason({ project: false, completedJobs: 1, candidates: 4, available: 0, takenBy: ["F-0003"] }), "Allt på jobbet finns redan i F-0003.");
  assert.equal(newBasisReason({ project: true, completedJobs: 2, candidates: 4, available: 0, takenBy: ["F-0004", "F-0003"] }), "Allt i projektets färdigställda jobb finns redan i F-0003 och F-0004.");
  assert.equal(newBasisReason({ project: false, completedJobs: 1, candidates: 4, available: 2, takenBy: ["F-0003"] }), "");
  assert.equal(notCompletedText(2), "2 jobb är inte färdigställda och tas inte med.");
  assert.equal(notCompletedText(1), "1 jobb är inte färdigställt och tas inte med.");
  assert.equal(notCompletedText(0), "");
  assert.equal(markedText({ invoiced: ["F-0002"], draft: ["F-0003"] }), "Fakturerat: F-0002 · Utkast: F-0003");
  assert.equal(markedText({ invoiced: [], draft: [] }), "");
});

test("numbers and the line about an accepted quote", () => {
  assert.equal(invoiceBasisLabel(1), "F-0001");
  assert.equal(invoiceBasisLabel(12345), "F-12345");
  const fromQuote = job({ materials: [{ id: "q", name: "Laddbox", quantity: "2", unit: "st", quoteRef: { quoteId: "x", quoteLabel: "O-0007", version: 1, lineId: "l", unitPrice: "100" } }] });
  assert.deepEqual(quoteLabelsOf([fromQuote, job()]), ["O-0007"]);
  assert.equal(quoteNoteText(["O-0007"]), "Arbetsordern kommer från offert O-0007 – kontrollera att inget faktureras två gånger.");
  assert.equal(quoteNoteText(["O-0001", "O-0002"], true), "Arbetsorder i projektet kommer från offerterna O-0001 och O-0002 – kontrollera att inget faktureras två gånger.");
  assert.equal(quoteNoteText([]), "");
});

test("a work order's stored rows are read tolerantly", () => {
  assert.deepEqual(materialsFromData({ kind: "RISK_ASSESSMENT", details: { materials: [{ id: "a", name: "x" }] } }), []);
  assert.deepEqual(materialsFromData(null), []);
  const rows = materialsFromData({ kind: "WORK_ORDER", details: { materials: [{ id: "a", name: "Kabel", quantity: 3, unit: "m", unitPrice: "10" }, { name: "utan id" }, "skräp", { id: "b", kind: "expense", name: "Resa", amount: "100" }] } });
  assert.deepEqual(rows.map((row) => [row.id, row.name, row.quantity, row.kind ?? "material", row.amount]), [["a", "Kabel", "3", "material", ""], ["b", "Resa", "", "expense", "100"]]);
});

test("saving: lines keep the sources they took, new lines take none, and the page cannot move sources", () => {
  const stored = linesFromWork([job()], { taken: new Set(), hourlyRate: "650", perJob: false }).lines;
  const input = invoiceBasisInputSchema.parse({
    title: "Byte av central", vatPercent: "25",
    lines: [
      { ...stored[0], quantity: "4", sources: ["time:someone-else"] },
      { id: "new-1", kind: "OTHER", name: "Extra resa", quantity: "1", unit: "st", unitPrice: "300", markupPercent: "" },
    ],
  });
  const merged = mergeLineSources(stored, input.lines);
  assert.deepEqual(merged.map((line) => [line.id, line.quantity, line.sources]), [[stored[0].id, "4", ["time:t1", "time:t2"]], ["new-1", "1", []]]);
  assert.throws(() => invoiceBasisInputSchema.parse({ title: "x", lines: [{ id: "a", kind: "OTHER", name: "y", quantity: "två" }] }), /Antal måste vara ett tal/);
  assert.throws(() => invoiceBasisInputSchema.parse({ title: "x", lines: [{ id: "a", kind: "OTHER", name: "y", quantity: "1" }, { id: "a", kind: "OTHER", name: "z", quantity: "1" }] }), /samma id/);
  assert.throws(() => invoiceBasisInputSchema.parse({ title: " ", lines: [] }), /rubrik/);
  assert.throws(() => invoiceBasisInputSchema.parse({ title: "x", vatPercent: "130", lines: [] }), /Momssatsen/);
  assert.deepEqual(invoiceBasisLinesOf([{ id: "a", kind: "OTHER", name: "y", quantity: "1", unit: "st", unitPrice: "1", markupPercent: "", sources: ["time:1"] }, { kind: "BAD" }, null]).map((line) => line.id), ["a"]);
  assert.deepEqual(blankInvoiceLine("LABOUR", "n"), { id: "n", kind: "LABOUR", name: "Arbete", quantity: "1", unit: "h", unitPrice: "", markupPercent: "", sources: [] });
});

test("a material line keeps the price copy and the article number of its row, through saving (2026-10-15)", () => {
  const copy = { articleId: "a1", supplierName: "Grossist", supplierArticleNo: "1234567", eNumber: "1234567", unitPrice: "120,50", unit: "st", source: "Prisfil", priceDate: "2026-10-14", rebate: { basePrice: "179,30", percent: "32,98" } };
  const data = { kind: "WORK_ORDER", details: { materials: [{ id: "m1", name: "Kabelrörsskydd", quantity: "2", unit: "st", unitPrice: "120,50", articleNo: "E 1234567", articleSource: "Grossist", catalogue: copy }, { id: "m2", name: "Skruv", quantity: "1", unit: "st", catalogue: { bad: true } }] } };
  const rows = materialsFromData(data);
  assert.equal(rows[0].catalogue?.rebate?.percent, "32,98", "the copy is read from the stored row");
  assert.equal(rows[1].catalogue, undefined, "an unreadable copy is left out, not the row");
  const built = linesFromWork([job({ entries: [], materials: rows })], { taken: new Set(), hourlyRate: "", perJob: false });
  assert.deepEqual([built.lines[0].unitPrice, built.lines[0].articleNo, built.lines[0].catalogue?.rebate?.basePrice], ["120,5", "E 1234567", "179,30"]);
  // The page sends the copy back; the stored line keeps it, and a new price file never changes the line's own price.
  const input = invoiceBasisInputSchema.parse({ title: "x", lines: built.lines });
  const merged = mergeLineSources(built.lines, input.lines);
  assert.equal(merged[0].catalogue?.priceDate, "2026-10-14");
  assert.equal(invoiceBasisLinesOf(JSON.parse(JSON.stringify(merged)))[0].catalogue?.supplierName, "Grossist");
});

test("an expense keeps its own antal, enhet and à-pris when they give its amount (QA 2026-10-10)", () => {
  const parking = (over: Record<string, string>) => job({ entries: [], materials: [{ id: "p", kind: "expense", name: "Parkering", quantity: "2", unit: "tim", unitPrice: "1 250,50", amount: "2 501", ...over }] });
  const line = (over: Record<string, string>) => { const [first] = linesFromWork([parking(over)], { taken: new Set(), hourlyRate: "", perJob: false }).lines; return [first.quantity, first.unit, first.unitPrice].map((text) => text.replace(/\s/g, " ")); };
  assert.deepEqual(line({}), ["2", "tim", "1 250,5"], "2 tim × 1 250,50, not 1 st × 2 501");
  assert.deepEqual(line({ amount: "" }), ["2", "tim", "1 250,5"], "no amount: antal × à-pris");
  assert.deepEqual(line({ amount: "2 000" }), ["1", "st", "2 000"], "an amount typed by itself is one item of that amount");
  assert.deepEqual(line({ unitPrice: "", amount: "80" }), ["1", "st", "80"]);
  assert.deepEqual(line({ unit: "" }), ["2", "st", "1 250,5"], "no unit: st");
  assert.equal(invoiceBasisTotals(linesFromWork([parking({})], { taken: new Set(), hourlyRate: "", perJob: false }).lines).net, 2501);
});

test("Nytt fakturaunderlag: the proposal's key is what it takes, in order", () => {
  const built = linesFromWork([job()], { taken: new Set(), hourlyRate: "650", perJob: false });
  const again = linesFromWork([job()], { taken: new Set(), hourlyRate: "700", perJob: false });
  assert.equal(invoiceProposalKey(built.sources), invoiceProposalKey(again.sources), "a new price is not a new proposal");
  assert.deepEqual(again.lines.map((line) => line.id), built.lines.map((line) => line.id), "the same line ids, so the person's changes land on the right line");
  const more = linesFromWork([job({ entries: [...job().entries, { id: "t3", durationSec: 600 }] })], { taken: new Set(), hourlyRate: "650", perJob: false });
  assert.notEqual(invoiceProposalKey(more.sources), invoiceProposalKey(built.sources), "new time is a new proposal");
  const fewer = linesFromWork([job()], { taken: new Set([rowSourceKey("task-1", "m1")]), hourlyRate: "650", perJob: false });
  assert.notEqual(invoiceProposalKey(fewer.sources), invoiceProposalKey(built.sources), "something taken by another basis meanwhile");
  assert.match(invoiceProposalKey([]), /^0-[0-9a-f]+$/);
  // A very long row id still gives a line id the page may send back (at most 100 characters).
  const long = linesFromWork([job({ entries: [], materials: [{ id: "x".repeat(120), name: "Kabel", quantity: "1", unit: "m" }] })], { taken: new Set(), hourlyRate: "", perJob: false });
  assert.ok(long.lines[0].id.length <= 100 && long.lines[0].sources[0].length > 100);
  // The page's list on create: lines keep what their built line takes, the rest takes nothing.
  const input = invoiceBasisInputSchema.parse({ title: "Byte", lines: [{ ...built.lines[1], unitPrice: "500" }, { id: "own", kind: "OTHER", name: "Resa", quantity: "1", unit: "st", unitPrice: "100", markupPercent: "" }] });
  assert.deepEqual(mergeLineSources(built.lines, input.lines).map((line) => [line.id, line.unitPrice, line.sources]), [["row:task-1:m1", "500", ["row:task-1:m1"]], ["own", "100", []]]);
});

test("Markera som fakturerat needs a price on every line (QA 2026-10-10)", () => {
  const priced = { kind: "MATERIAL" as const, quantity: "2", unitPrice: "100", markupPercent: "" };
  assert.equal(invoiceReadyProblem([priced]), "");
  assert.equal(invoiceReadyProblem([priced, { ...priced, unitPrice: "" }]), "1 rad saknar pris.");
  assert.equal(invoiceReadyProblem([{ ...priced, unitPrice: "" }, { ...priced, quantity: "ca 4" }, priced]), "2 rader saknar pris.");
  assert.equal(invoiceReadyProblem([]), "Underlaget har inga rader.");
});

test("new and priced lines are filled in as the quote does: hourly rate and markup (QA 2026-10-10)", () => {
  const defaults = { hourlyRate: "650", markupPercent: "15" };
  assert.deepEqual([blankInvoiceLine("LABOUR", "a", defaults).unitPrice, blankInvoiceLine("LABOUR", "a", defaults).markupPercent], ["650", ""]);
  assert.deepEqual([blankInvoiceLine("MATERIAL", "b", defaults).unitPrice, blankInvoiceLine("MATERIAL", "b", defaults).markupPercent], ["", "15"]);
  assert.deepEqual([blankInvoiceLine("OTHER", "c", defaults).unitPrice, blankInvoiceLine("OTHER", "c", defaults).markupPercent], ["", ""]);
  assert.equal(blankInvoiceLine("LABOUR", "d", { hourlyRate: "inget", markupPercent: "" }).unitPrice, "", "an unreadable rate is left out");
  const material = { id: "m", kind: "MATERIAL" as const, name: "Gruppcentral", quantity: "1", unit: "st", unitPrice: "", markupPercent: "", sources: ["row:t:m"] };
  assert.equal(patchInvoiceLine(material, { unitPrice: "2400" }, defaults).markupPercent, "15", "the first price brings the company's markup");
  assert.equal(patchInvoiceLine({ ...material, markupPercent: "10" }, { unitPrice: "2400" }, defaults).markupPercent, "10", "a markup of its own stays");
  assert.equal(patchInvoiceLine({ ...material, unitPrice: "2000" }, { unitPrice: "2400" }, defaults).markupPercent, "", "a changed price does not bring one back once it was cleared");
  assert.equal(patchInvoiceLine(material, { unitPrice: "2400", markupPercent: "" }, defaults).markupPercent, "", "typed together, as typed");
  assert.equal(patchInvoiceLine({ ...material, kind: "OTHER" }, { unitPrice: "50" }, defaults).markupPercent, "", "Övrigt gets no markup");
  assert.equal(patchInvoiceLine({ ...material, kind: "OTHER" }, { kind: "LABOUR" }, defaults).unitPrice, "650", "made Arbete: the hourly rate");
  assert.equal(patchInvoiceLine(material, { unitPrice: "2400" }, null).markupPercent, "", "no company markup");
});

test("an Arbete line shows its hours and minutes beside the decimal hours (QA 2026-10-10)", () => {
  const labour = { kind: "LABOUR" as const, quantity: "3,06", unit: "h", unitPrice: "650" };
  assert.equal(invoiceLineHoursText(labour), "3 h 4 min");
  assert.equal(invoiceLineHoursText({ ...labour, quantity: "0,5" }), "0 h 30 min");
  assert.equal(invoiceLineHoursText({ ...labour, quantity: "30" }), "", "whole hours need no minutes");
  assert.equal(invoiceLineHoursText({ ...labour, unit: "st" }), "");
  assert.equal(invoiceLineHoursText({ ...labour, kind: "MATERIAL" }), "");
  assert.equal(invoiceLineHoursText({ ...labour, quantity: "ca 3" }), "");
  assert.equal(invoiceLineSubtitle(labour), "3,06 h (3 h 4 min) · à 650,00 kr");
  assert.equal(invoiceLineSubtitle({ kind: "MATERIAL", quantity: "64", unit: "m", unitPrice: "" }), "64 m · Inget pris");
});

const settings: AccountingSettings = { materialAccount: "3001", labourAccount: "3002", otherAccount: "3003", vatAccount: "2611", receivableAccount: "1510", rotReceivableAccount: "", reverseVatAccount: "", series: "A" };
const basis = (over: Partial<AccountingQuote> = {}): AccountingQuote => ({
  document: "invoice_basis", id: "b1", label: "F-0003", title: "Byte av central", status: "DRAFT", date: "2026-10-10", customerName: "Villa Voltberg", projectName: "", vatPercent: 25,
  lines: [
    { kind: "LABOUR", name: "Arbete", quantity: "4,5", unit: "h", unitPrice: "650", markupPercent: "" },
    { kind: "MATERIAL", name: "Jordfelsbrytare", quantity: "2", unit: "st", unitPrice: "450", markupPercent: "15" },
    { kind: "OTHER", name: "Bilkostnad", quantity: "1", unit: "st", unitPrice: "70", markupPercent: "" },
  ],
  ...over,
});

test("export: only an invoiced basis is booked, named Fakturaunderlag, with the sums of the page", () => {
  const sums = quoteOre(basis());
  assert.deepEqual([sums.byKind.LABOUR, sums.byKind.MATERIAL, sums.byKind.OTHER, sums.net, sums.vat, sums.gross], [292500, 103500, 7000, 403000, 100750, 503750]);
  const voucher = quoteVoucher(basis(), settings);
  assert.deepEqual(voucher.issues, [], "the verification itself is the same in any status");
  assert.equal(voucher.rows.reduce((sum, row) => sum + row.ore, 0), 0);
  const csv = quotesCsv([basis({ status: "INVOICED" })]);
  assert.ok(csv.startsWith("﻿\"Fakturaunderlag\";\"Rubrik\""));
  assert.ok(csv.includes("\"F-0003\";\"Byte av central\";\"Fakturerat\";\"2026-10-10\";\"Villa Voltberg\";\"\";\"\";\"1\";\"Arbete\";\"\";\"Arbete\";\"4,5\";\"h\";\"650,00\";\"2925,00\";\"25\""));
  const draftSie = quotesSie([basis()], settings, { company: "Elfirma AB", organizationNumber: "", generatedOn: "2026-10-10", programVersion: "1" });
  assert.equal(draftSie.text, "", "a draft is never booked (2026-11-01)");
  assert.ok(draftSie.issues.some((issue) => /F-0003: Bara ett godkänt fakturaunderlag/.test(issue)));
  const sie = quotesSie([basis({ status: "INVOICED" })], settings, { company: "Elfirma AB", organizationNumber: "", generatedOn: "2026-10-10", programVersion: "1" });
  assert.deepEqual(sie.issues, []);
  assert.ok(sie.text.includes("#VER \"A\" \"\" 20261010 \"Fakturaunderlag F-0003 Byte av central Villa Voltberg\""));
  assert.ok(sie.text.includes("#TRANS 1510 {} 5037.50"));
  const unpriced = quotesSie([basis({ status: "INVOICED", lines: [{ kind: "LABOUR", name: "Arbete", quantity: "2", unit: "h", unitPrice: "", markupPercent: "" }] })], settings, { company: "X", organizationNumber: "", generatedOn: "2026-10-10", programVersion: "1" });
  assert.ok(unpriced.issues.some((issue) => /F-0003: 1 rad saknar pris/.test(issue)), "a line without price stops SIE");
  const { payload, issues } = fortnoxInvoicePayload(basis(), settings, "K-1");
  assert.deepEqual(issues, []);
  assert.equal(payload?.Invoice.ExternalInvoiceReference1, "Fakturaunderlag F-0003");
  assert.equal(payload?.Invoice.InvoiceRows.length, 3);
  assert.deepEqual(fortnoxInvoicePayload(basis({ lines: [] }), settings, "K-1").issues, ["Underlaget har inga rader."]);
  assert.match(fortnoxInvoicePayload(basis({ lines: [{ kind: "OTHER", name: "Parkering", quantity: "1", unit: "st", unitPrice: "", markupPercent: "" }] }), settings, "K-1").issues.join(" "), /saknar pris/);
});
