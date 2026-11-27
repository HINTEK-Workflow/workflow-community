import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyArticle, type CatalogueHit } from "../lib/catalogue/snapshot";
import { catalogueAccess } from "../lib/catalogue/access";
import type { MaterialRow } from "../lib/workflow/expenses";
import {
  canSeePrices, customerPriceTotals, keepStoredMaterialPrices, materialRowPrice, parsePercent, redactTaskPrices, roundOre, withCompanyMarkup, withoutMaterialPrices, workOrderTotals,
} from "../lib/workflow/material-prices";
import { defaultWorkflowPermissionProfile, noWorkflowPermissionProfile, workflowPermissionPresets, type WorkflowPermissionGrant } from "../lib/workflow/permissions";
import { projectMaterialsCsv, summarizeProjectMaterials } from "../lib/workflow/project-materials";
import { workOrderDataSchema } from "../lib/workflow/task-model";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "../lib/workflow/report";
import { menuItemAllowed } from "../lib/workflow/menu-items";
import { pdfText } from "../lib/import/pdf-text";
import {
  effectiveQuoteStatus, listedQuoteStatus, quoteDatePassed, quoteMatchesFilter, quoteActionError, quoteActions, quoteInputSchema, quoteLabel, quoteLineNumbers, quoteNumberText, quoteSendIssues, quoteTotals, type QuoteView,
} from "../lib/quotes/model";
import { addDays, priceSettingsOf, priceSettingsSchema } from "../lib/quotes/settings";
import { createQuotePdf } from "../lib/quotes/quote-report";
import { modelView } from "../lib/ai/assistant-tools";

// Priser och offert, steg A + B (2026-10-09, docs/proposals/material-pris-offert-2026-10-09.md). Made-up data.

const profile = (grants: WorkflowPermissionGrant[]) => ({ version: 1 as const, grants });
const row = (id: string, values: Partial<MaterialRow>): MaterialRow => ({ id, name: "Kabel", quantity: "10", unit: "m", ...values });

test("rounding: whole öre without float noise", () => {
  assert.equal(roundOre(1.005), 1.01);
  assert.equal(roundOre(0.1 + 0.2), 0.3);
  assert.equal(roundOre(2.675), 2.68);
  assert.equal(roundOre(-1.005), -1);
  assert.equal(roundOre(12.344999), 12.34);
});

test("markup: a percentage between -100 and 1000, written as typed", () => {
  assert.equal(parsePercent("15"), 15);
  assert.equal(parsePercent("12,5"), 12.5);
  assert.equal(parsePercent("12,5 %"), 12.5);
  assert.equal(parsePercent(""), null);
  assert.equal(parsePercent("ca 10"), null);
  assert.equal(parsePercent("-100"), -100);
  assert.equal(parsePercent("-101"), null);
  assert.equal(parsePercent("1001"), null);
});

test("material row: amount = antal × à-pris, with the row's own markup, whole öre", () => {
  assert.deepEqual(materialRowPrice({ quantity: "10", unitPrice: "12,50" }), { purchase: 125, sale: 125, markup: null, saleUnitPrice: 12.5 });
  assert.deepEqual(materialRowPrice({ quantity: "3", unitPrice: "33,33", markupPercent: "15" }), { purchase: 99.99, sale: 114.99, markup: 15, saleUnitPrice: 38.33 });
  // The selling amount is computed from the unrounded product: 7 × 1,99 × 1,125 = 15,67125 → 15,67 (not 7 × 2,24 = 15,68).
  assert.equal(materialRowPrice({ quantity: "7", unitPrice: "1,99", markupPercent: "12,5" }).sale, 15.67);
  assert.deepEqual(materialRowPrice({ quantity: "ca 10", unitPrice: "5" }), { purchase: null, sale: null, markup: null, saleUnitPrice: 5 });
  assert.equal(materialRowPrice({ quantity: "10", unitPrice: "" }).sale, null);
});

test("work order totals: material at purchase and with markup, expenses, total excl. VAT, rows without price counted", () => {
  const totals = workOrderTotals([
    row("a", { unitPrice: "12,50", markupPercent: "20" }),
    row("b", { name: "Dosa", quantity: "4", unit: "st", unitPrice: "10" }),
    row("c", { name: "Skruv", quantity: "1", unit: "förp" }),
    row("d", { name: "", quantity: "", unit: "" }),
    { id: "e", kind: "expense", name: "Parkering", quantity: "1", unit: "st", unitPrice: "40", amount: "40,00" },
    { id: "f", kind: "expense", name: "Färja", quantity: "1", unit: "st", amount: "okänt" },
  ]);
  assert.deepEqual(totals.material, { purchase: 165, sale: 190, priced: 2, unpriced: 1 });
  assert.deepEqual(totals.expenses, { total: 40, count: 2, missing: 1 });
  assert.equal(totals.total, 230);
});

test("company markup is copied once, when the row gets its price; the row keeps its own copy", () => {
  assert.equal(withCompanyMarkup(row("a", { unitPrice: "10" }), "15").markupPercent, "15");
  assert.equal(withCompanyMarkup(row("a", { unitPrice: "10", markupPercent: "5" }), "15").markupPercent, "5", "the row's own markup stays");
  assert.equal(withCompanyMarkup(row("a", { unitPrice: "10", markupPercent: "" }), "15").markupPercent, "", "a cleared markup stays cleared");
  assert.equal(withCompanyMarkup(row("a", {}), "15").markupPercent, undefined, "no price, no markup");
  assert.equal(withCompanyMarkup(row("a", { unitPrice: "10" }), "").markupPercent, undefined, "no company markup");
});

test("price right: admin, Artiklar och priser – läsa or Offerter – läsa; Utföra arbete does not include quotes", () => {
  assert.equal(canSeePrices({ admin: true, permissions: noWorkflowPermissionProfile() }), true);
  assert.equal(canSeePrices({ admin: false, permissions: profile(["catalogue:read"]) }), true);
  assert.equal(canSeePrices({ admin: false, permissions: profile(["quotes:read"]) }), true);
  assert.equal(canSeePrices({ admin: false, permissions: profile(["work-order:read", "work-order:edit"]) }), false);
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;
  assert.ok(!field.grants.some((grant) => grant.startsWith("quotes:")), "a new right is opt-in");
  assert.ok(defaultWorkflowPermissionProfile().grants.includes("quotes:edit"));
  // A quote editor may search the catalogue for its lines.
  assert.equal(catalogueAccess({ admin: false, permissions: profile(["quotes:read", "quotes:edit"]) }).pick, true);
});

test("redaction: without the price right a material row is Benämning, Antal and Enhet; expenses are unchanged", () => {
  const snapshot = { articleId: "art", supplierName: "Leverantör", supplierArticleNo: "1", eNumber: "", unitPrice: "12,5", unit: "m", source: "lista.csv", priceDate: "2026-10-01" };
  const rows: MaterialRow[] = [row("a", { unitPrice: "12,5", markupPercent: "15", catalogue: snapshot }), { id: "e", kind: "expense", name: "Parkering", quantity: "1", unit: "st", unitPrice: "40", amount: "40,00" }];
  const hidden = withoutMaterialPrices(rows);
  assert.deepEqual(hidden[0], { id: "a", name: "Kabel", quantity: "10", unit: "m" });
  assert.deepEqual(hidden[1], rows[1]);
  const data = redactTaskPrices({ kind: "WORK_ORDER", details: { materials: rows, executionNotes: "x" } });
  assert.equal((data.details as { executionNotes: string }).executionNotes, "x");
  assert.equal(JSON.stringify(data).includes("12,5"), false);
  const form = { kind: "FORM", details: { values: 1 } };
  assert.equal(redactTaskPrices(form), form, "other kinds are untouched");
});

test("Workflow AI never gets a work order's purchase prices or markup, also when the person may see them", () => {
  const result = { id: "w", kind: "WORK_ORDER", details: { executionNotes: "", materials: [row("a", { unitPrice: "12,5", markupPercent: "15" })] } };
  const view = modelView("get_task", result);
  assert.deepEqual((view.details as { materials: unknown[] }).materials, [{ id: "a", name: "Kabel", quantity: "10", unit: "m" }]);
  assert.equal(JSON.stringify(view).includes("12,5"), false);
});

test("a save without the price right keeps the stored prices and cannot set or clear one", () => {
  const stored: MaterialRow[] = [row("a", { unitPrice: "12,5", markupPercent: "15" }), row("b", { name: "Dosa", unitPrice: "3" })];
  const incoming: MaterialRow[] = [
    row("a", { quantity: "12" }), // price hidden on the page, quantity changed
    row("b", { name: "Dosa", unitPrice: "0", markupPercent: "900" }), // a forged price is ignored
    row("c", { name: "Ny rad", unitPrice: "99" }), // a new row gets no price from this person
    row("d", { name: "Vald artikel", pickedArticleId: "art-1" }),
  ];
  const kept = keepStoredMaterialPrices(incoming, stored);
  assert.deepEqual(kept[0], { id: "a", name: "Kabel", quantity: "12", unit: "m", unitPrice: "12,5", markupPercent: "15" });
  assert.deepEqual(kept[1], { id: "b", name: "Dosa", quantity: "10", unit: "m", unitPrice: "3" });
  assert.deepEqual(kept[2], { id: "c", name: "Ny rad", quantity: "10", unit: "m" });
  assert.equal(kept[3].pickedArticleId, "art-1", "the server prices a picked article afterwards");
});

test("picking an article: a hidden price marks the row for the server; a visible one is copied and the markup is taken anew", () => {
  const hit: CatalogueHit = { id: "art-1", name: "Kabel 3G1,5", unit: "m", supplierArticleNo: "K-1", eNumber: "", supplierName: "Leverantör", price: { unitPrice: 12.5, priceDate: "2026-10-01", sourceFileName: "lista.csv", importId: "imp" } };
  const priced = applyArticle(row("a", { markupPercent: "40" }), hit);
  assert.equal(priced.unitPrice, "12,5");
  assert.equal(priced.markupPercent, undefined);
  assert.equal(priced.pickedArticleId, undefined);
  const hidden = applyArticle(row("a", { unitPrice: "1" }), { ...hit, price: null, priceHidden: true });
  assert.equal(hidden.pickedArticleId, "art-1");
  assert.equal(hidden.unitPrice, undefined);
  assert.equal(hidden.name, "Kabel 3G1,5");
  // The stored row's schema keeps the markup copy; old rows without it parse as before.
  const parsed = workOrderDataSchema.parse({ executionNotes: "", deviations: "", closeNotes: "", materials: [{ id: "11111111-1111-4111-8111-111111111111", name: "Kabel", quantity: "1", unit: "m", unitPrice: "2", markupPercent: "10" }, { id: "22222222-2222-4222-8222-222222222222", name: "Gammal", quantity: "1", unit: "st" }] });
  assert.equal(parsed.materials[0].markupPercent, "10");
  assert.equal(parsed.materials[1].markupPercent, undefined);
});

test("Material i projektet: amounts per line and the project's sums only with prices", () => {
  const orders = [
    { id: "w1", title: "AO 1", materials: [row("a", { unitPrice: "10", markupPercent: "10" }), row("b", { quantity: "5" }), { id: "e", kind: "expense" as const, name: "Parkering", quantity: "1", unit: "st", amount: "40" }] },
    { id: "w2", title: "AO 2", materials: [row("c", { name: "kabel", quantity: "2", unitPrice: "10" })] },
  ];
  const plain = summarizeProjectMaterials(orders);
  assert.equal(plain.prices, undefined);
  assert.equal(plain.lines[0].price, undefined);
  assert.ok(!projectMaterialsCsv(plain).includes("Inköp"));
  const priced = summarizeProjectMaterials(orders, undefined, { prices: true });
  assert.equal(priced.lines.length, 1);
  assert.deepEqual(priced.lines[0].price, { purchase: 120, sale: 130, unpriced: 1 });
  assert.deepEqual(priced.prices, { purchase: 120, sale: 130, unpriced: 1, expenses: 40, expensesMissing: 0, total: 170 });
  assert.match(projectMaterialsCsv(priced), /"Inköp \(kr exkl\. moms\)"/);
  assert.match(projectMaterialsCsv(priced), /"120,00";"130,00";"1"/);
});

test("menu: Ny offert / Mina offerter in Cloud and the demo, with the right Offerter only", () => {
  const member = (grants: WorkflowPermissionGrant[]) => ({ memberRole: "MEMBER" as const, workflowPermissions: profile(grants) });
  assert.equal(menuItemAllowed("quotes", member(["quotes:read"])), true);
  assert.equal(menuItemAllowed("quotes", member(["work-order:read"])), false);
  assert.equal(menuItemAllowed("quotes", { ...member(["quotes:read"]), localStorageMode: true }), false);
  // The public demo shows invented quotes in memory (2026-10-09).
  assert.equal(menuItemAllowed("quotes", { memberRole: "ADMIN", workflowPermissions: noWorkflowPermissionProfile(), demo: true }), true);
  assert.equal(menuItemAllowed("quotes", { ...member(["work-order:read"]), demo: true }), false);
});

// ---------- Offert ----------

test("quote line: antal × à-pris × (1 + påslag), whole öre; labour is hours × hourly rate", () => {
  assert.deepEqual(quoteLineNumbers({ quantity: "8", unitPrice: "650" }), { quantity: 8, unitPrice: 650, markup: null, saleUnitPrice: 650, amount: 5200, purchase: 5200 });
  assert.deepEqual(quoteLineNumbers({ quantity: "3", unitPrice: "33,33", markupPercent: "15" }), { quantity: 3, unitPrice: 33.33, markup: 15, saleUnitPrice: 38.33, amount: 114.99, purchase: 99.99 });
  assert.equal(quoteLineNumbers({ quantity: 2.5, unitPrice: 100, markupPercent: 10 }).amount, 275);
  assert.equal(quoteLineNumbers({ quantity: "2", unitPrice: "" }).amount, null);
});

test("quote totals: lines rounded first, VAT 25 % on the sum, gross = net + VAT, company's figures apart", () => {
  const totals = quoteTotals([
    { kind: "MATERIAL", quantity: "3", unitPrice: "33,33", markupPercent: "15" }, // 114,99
    { kind: "LABOUR", quantity: "1,5", unitPrice: "645" }, // 967,50
    { kind: "OTHER", quantity: "1", unitPrice: "0,01" }, // 0,01
    { kind: "MATERIAL", quantity: "1", unitPrice: "" }, // no price
  ]);
  assert.deepEqual(totals.byKind, { MATERIAL: 114.99, LABOUR: 967.5, OTHER: 0.01 });
  assert.equal(totals.net, 1082.5);
  assert.equal(totals.vat, 270.63, "1 082,50 × 25 % = 270,625 → 270,63");
  assert.equal(totals.gross, 1353.13);
  // Inköp is the material's purchase price only (simulation 0.6.3: it counted the hours of work); Påslag what the markup adds.
  assert.equal(totals.purchase, 99.99);
  assert.equal(totals.margin, 15);
  assert.equal(totals.unpriced, 1);
  assert.equal(quoteTotals([], 25).gross, 0);
  // A sum of many small lines stays exact to the öre.
  const many = quoteTotals(Array.from({ length: 10 }, () => ({ kind: "MATERIAL" as const, quantity: "1", unitPrice: "0,1" })));
  assert.equal(many.net, 1);
  assert.equal(many.vat, 0.25);
});

test("quote list: a draft whose Giltig till has passed reads as Utgången and is counted there, not under Pågående", () => {
  const today = "2026-11-22";
  const passedDraft = { status: "DRAFT" as const, validUntil: "2026-11-19" };
  assert.equal(quoteDatePassed(passedDraft, today), true);
  assert.equal(listedQuoteStatus(passedDraft, today), "EXPIRED");
  assert.equal(effectiveQuoteStatus(passedDraft, today), "DRAFT", "the stored draft is unchanged");
  assert.deepEqual(quoteActions(passedDraft, today), ["edit", "send", "delete"], "it can still get a new date and be sent");
  assert.equal(quoteMatchesFilter(passedDraft, "EXPIRED", today), true);
  assert.equal(quoteMatchesFilter(passedDraft, "open", today), false);
  assert.equal(quoteMatchesFilter(passedDraft, "DRAFT", today), false);
  assert.equal(quoteMatchesFilter(passedDraft, "all", today), true);
  const todayDraft = { status: "DRAFT" as const, validUntil: today };
  assert.equal(listedQuoteStatus(todayDraft, today), "DRAFT", "valid through the date itself");
  assert.equal(quoteMatchesFilter(todayDraft, "open", today), true);
  assert.equal(quoteMatchesFilter({ status: "DRAFT", validUntil: "" }, "DRAFT", today), true, "a draft without a date is not expired");
  assert.equal(quoteMatchesFilter({ status: "SENT", validUntil: "2026-11-21" }, "EXPIRED", today), true);
  assert.equal(quoteMatchesFilter({ status: "SENT", validUntil: "2026-11-21" }, "SENT", today), false);
  assert.equal(quoteMatchesFilter({ status: "EXPIRED", validUntil: "2026-12-01" }, "EXPIRED", today), true);
  assert.equal(listedQuoteStatus({ status: "ACCEPTED", validUntil: "2026-01-01" }, today), "ACCEPTED", "an answered quote keeps its answer");
  assert.equal(quoteMatchesFilter({ status: "DECLINED", validUntil: "2026-01-01" }, "EXPIRED", today), false);
});

test("quote status: drafts are written, sent quotes answered or versioned, expired by date, accepted never changed", () => {
  const today = "2026-10-09";
  assert.deepEqual(quoteActions({ status: "DRAFT", validUntil: "2026-11-08" }, today), ["edit", "send", "delete"]);
  assert.deepEqual(quoteActions({ status: "SENT", validUntil: "2026-11-08" }, today), ["accept", "decline", "expire", "new_version"]);
  assert.equal(effectiveQuoteStatus({ status: "SENT", validUntil: "2026-10-08" }, today), "EXPIRED");
  assert.equal(effectiveQuoteStatus({ status: "SENT", validUntil: "2026-10-09" }, today), "SENT", "valid through the date itself");
  assert.equal(effectiveQuoteStatus({ status: "DRAFT", validUntil: "2026-01-01" }, today), "DRAFT");
  assert.deepEqual(quoteActions({ status: "SENT", validUntil: "2026-10-01" }, today), ["expire", "decline", "new_version"], "an expired quote is not accepted");
  assert.deepEqual(quoteActions({ status: "DECLINED", validUntil: "" }, today), ["new_version"]);
  assert.deepEqual(quoteActions({ status: "EXPIRED", validUntil: "" }, today), ["new_version"]);
  assert.deepEqual(quoteActions({ status: "ACCEPTED", validUntil: "" }, today), ["new_version"], "an accepted quote changes only by an ÄTA");
  assert.deepEqual(quoteActions({ status: "ACCEPTED", validUntil: "", superseded: true }, today), []);
  assert.deepEqual(quoteActions({ status: "SENT", validUntil: "2026-11-08", superseded: true }, today), [], "an older version is read only");
  assert.match(quoteActionError({ status: "SENT", validUntil: "2026-11-08" }, "edit", today), /låst/);
  assert.match(quoteActionError({ status: "SENT", validUntil: "2026-10-01" }, "accept", today), /gått ut/);
  assert.equal(quoteActionError({ status: "ACCEPTED", validUntil: "" }, "new_version", today), "");
  assert.match(quoteActionError({ status: "ACCEPTED", validUntil: "" }, "edit", today), /låst/);
  assert.match(quoteActionError({ status: "SENT", validUntil: "2026-11-08", superseded: true }, "accept", today), /nyare version/);
  assert.equal(quoteActionError({ status: "DRAFT", validUntil: "" }, "send", today), "");
});

test("sending needs lines, a price on every line and a valid-until date ahead", () => {
  const today = "2026-10-09";
  assert.deepEqual(quoteSendIssues({ lines: [], validUntil: "" }, today), ["Lägg till minst en rad.", "Ange hur länge offerten gäller (Giltig till)."]);
  assert.deepEqual(quoteSendIssues({ lines: [{ kind: "MATERIAL", quantity: "1", unitPrice: "" }, { kind: "OTHER", quantity: "1", unitPrice: "" }], validUntil: "2026-10-08" }, today), ["2 rader saknar à-pris.", "Giltig till har redan passerat."]);
  assert.deepEqual(quoteSendIssues({ lines: [{ kind: "LABOUR", quantity: "2", unitPrice: "600" }], validUntil: today }, today), []);
});

test("quote input: numbers must be numbers; the company writes its own terms", () => {
  const parsed = quoteInputSchema.parse({ title: "Byte av central", lines: [{ kind: "MATERIAL", name: "Kabel", quantity: "10", unitPrice: "12,5", markupPercent: "15" }] });
  assert.equal(parsed.lines[0].unit, "");
  assert.equal(parsed.terms, "");
  assert.equal(parsed.customerId, null);
  assert.throws(() => quoteInputSchema.parse({ title: "X", lines: [{ kind: "MATERIAL", name: "Kabel", quantity: "ca 10" }] }), /Antal måste vara ett tal/);
  assert.throws(() => quoteInputSchema.parse({ title: "X", lines: [{ kind: "LABOUR", name: "Montör", quantity: "1", unitPrice: "-5" }] }), /À-pris/);
  assert.throws(() => quoteInputSchema.parse({ title: "", lines: [] }), /rubrik/);
  assert.equal(quoteNumberText(12), "O-0012");
  assert.equal(quoteLabel({ number: 12, version: 2 }), "O-0012 v2");
});

test("price settings: defaults, field by field fallback, validation and the valid-until date", () => {
  assert.deepEqual(priceSettingsOf(null), { markupPercent: "", hourlyRate: "", validDays: 30, terms: "", rotPercent: "30", rotCap: "50000", emailMessage: "" });
  assert.deepEqual(priceSettingsOf({ markupPercent: "15", hourlyRate: "-1", validDays: 0, terms: "Betalning 30 dagar netto." }), { markupPercent: "15", hourlyRate: "", validDays: 30, terms: "Betalning 30 dagar netto.", rotPercent: "30", rotCap: "50000", emailMessage: "" });
  assert.throws(() => priceSettingsSchema.parse({ markupPercent: "mycket" }), /procent/);
  assert.equal(addDays("2026-10-09", 30), "2026-11-08");
  assert.equal(addDays("2026-12-20", 30), "2027-01-19");
  assert.equal(addDays("fel", 3), "");
});

const font = () => readFile("public/fonts/DejaVuSans.ttf").then((bytes) => new Uint8Array(bytes));

test("quote PDF: selling prices, VAT apart, the company's terms – never the purchase price or the markup", async () => {
  const lines = [
    { id: "1", kind: "MATERIAL" as const, name: "Installationskabel", quantity: "3", unit: "m", unitPrice: "33,33", markupPercent: "15" },
    { id: "2", kind: "LABOUR" as const, name: "Montör", quantity: "1,5", unit: "h", unitPrice: "645", markupPercent: "" },
  ];
  const quote: QuoteView = {
    id: "q", number: 7, version: 2, label: "O-0007 v2", revision: 1, title: "Byte av elcentral", description: "Byte av central i källaren.", status: "SENT", storedStatus: "SENT",
    validUntil: "2026-11-08", terms: "Betalning 30 dagar netto.", vatPercent: 25, customer: { id: "c", name: "Kund AB" }, facility: null, project: null, lines,
    totals: quoteTotals(lines), sentAt: "2026-10-09T08:00:00.000Z", decidedAt: null, createdAt: "2026-10-09T07:00:00.000Z", updatedAt: "2026-10-09T08:00:00.000Z", superseded: false,
    versions: [], actions: [], canEdit: true,
    customerType: "COMPANY", rotEnabled: false, rotPercent: null, rotCap: null, changeOfVersion: null, change: null, workOrder: null, workOrders: [], canCreateWorkOrder: false,
  };
  const text = pdfText(Buffer.from(await createQuotePdf({ identity: { company: "QA El AB" }, fontBytes: await font(), quote, createdAt: new Date("2026-10-09T08:00:00Z") })))!.replace(/\s+/g, " ");
  assert.match(text, /Offert/);
  assert.match(text, /O-0007 v2/);
  assert.match(text, /Kund AB/);
  assert.match(text, /38,33/, "the selling unit price");
  assert.match(text, /114,99/);
  assert.match(text, /967,50/);
  assert.match(text, /Summa exkl\. moms/);
  assert.match(text, /1 ?082,49/, "114,99 + 967,50");
  assert.match(text, /Moms 25 %/);
  assert.match(text, /270,62/, "1 082,49 × 25 % = 270,6225 → 270,62");
  assert.match(text, /1 ?353,11 kr/);
  assert.match(text, /Betalning 30 dagar netto\./);
  assert.ok(!text.includes("33,33"), "the purchase price is not printed");
  assert.ok(!/Påslag|Inköp/.test(text), "neither markup nor purchase is printed");
  assert.ok(!text.includes("UTKAST"));
  const draft = pdfText(Buffer.from(await createQuotePdf({ identity: { company: "QA El AB" }, fontBytes: await font(), quote: { ...quote, status: "DRAFT", storedStatus: "DRAFT" } })))!;
  assert.match(draft, /UTKAST/);
});

test("work order report: prices only with Visa priser; otherwise Benämning, Antal and Enhet even for a priced row", async () => {
  const task: WorkflowReportTask = {
    id: "w", kind: "WORK_ORDER", title: "Byte av central", description: "", status: "COMPLETED", progress: 100, assignedToName: "QA", dueDate: "", totalDurationSec: 0, attachments: [],
    data: { kind: "WORK_ORDER", details: { executionNotes: "Bytt", deviations: "", closeNotes: "", signature: { name: "QA", confirmed: true, signedAt: "2026-10-09T08:00:00.000Z" }, materials: [
      { name: "Kabel", quantity: "10", unit: "m", unitPrice: "12,5", markupPercent: "20", catalogue: { articleId: "a", supplierName: "Leverantör", supplierArticleNo: "K-1", eNumber: "", unitPrice: "12,5", unit: "m", source: "lista.csv", priceDate: "2026-10-01" } },
      { name: "Parkering", quantity: "1", unit: "st", kind: "expense", unitPrice: "40", amount: "40,00" },
    ] } },
  };
  const fontBytes = await font();
  const without = pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", tasks: [task], options: defaultWorkflowReportOptions, fontBytes })))!.replace(/\s+/g, " ");
  assert.equal(defaultWorkflowReportOptions.prices, false);
  assert.match(without, /Kabel/);
  assert.ok(!without.includes("12,5"), "no à-pris without the choice");
  assert.ok(!without.includes("lista.csv"));
  assert.match(without, /Parkering/);
  assert.ok(!without.includes("Summa utgifter"), "no sum of the expenses without the choice");
  assert.ok(!without.includes("40,00"), "no amount of an expense without the choice");
  const withPrices = pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", tasks: [task], options: { ...defaultWorkflowReportOptions, prices: true }, fontBytes })))!.replace(/\s+/g, " ");
  // The report is the customer's (2026-11-01, F2): the price to the customer only – no purchase price, markup or price file.
  assert.match(withPrices, /15,00/, "à-pris to the customer: 12,5 × 1,2");
  assert.match(withPrices, /150,00/, "10 × 12,5 × 1,2");
  assert.ok(!withPrices.includes("12,5"), "the purchase price is not printed");
  assert.ok(!/Påslag|påslag|inköp|20 %|lista\.csv/.test(withPrices), "neither markup, purchase nor the price file is printed");
  assert.match(withPrices, /Summa utgifter/);
  assert.match(withPrices, /Material/);
  assert.match(withPrices, /190,00 kr/, "material at the customer price plus the expense (no time reported)");
  assert.match(withPrices, /Totalt[\s\S]*exkl\. moms · arbete, material och utgifter/);
});

test("work order report with Visa priser: Totalt includes the work (hours × the company's hourly rate)", async () => {
  const materials = [{ name: "Kabel", quantity: "10", unit: "m", unitPrice: "12,5", markupPercent: "20" }];
  const task: WorkflowReportTask = {
    id: "w", kind: "WORK_ORDER", title: "Byte av central", description: "", status: "COMPLETED", progress: 100, assignedToName: "QA", dueDate: "", totalDurationSec: 18 * 3600, attachments: [],
    data: { kind: "WORK_ORDER", details: { executionNotes: "Bytt", deviations: "", closeNotes: "", signature: { name: "QA", confirmed: true, signedAt: "2026-10-09T08:00:00.000Z" }, materials } },
  };
  const fontBytes = await font();
  const options = { ...defaultWorkflowReportOptions, prices: true };
  const priced = pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", tasks: [task], options, hourlyRate: 650, fontBytes })))!.replace(/\s+/g, " ");
  assert.match(priced, /Arbete, 18 h/);
  assert.match(priced, /Arbetstid[\s\S]*18[\s\S]*650,00[\s\S]*11\s?700,00/);
  assert.match(priced, /11\s?850,00 kr/, "11 700 work + 150 material");
  assert.ok(!/inköp|Påslag/.test(priced));
  const noRate = pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", tasks: [task], options, fontBytes })))!.replace(/\s+/g, " ");
  assert.match(noRate, /timpris saknas/);
  assert.match(noRate, /arbetet utan timpris/, "never a total that silently leaves the work out");
  assert.equal(customerPriceTotals(materials, 5400, 600).total, 1050, "1,5 h × 600 + 150");
  assert.equal(customerPriceTotals(materials, 5400, null).labourMissing, true);
  assert.equal(customerPriceTotals([], 0, null).labourMissing, false, "no time, nothing missing");
});
