// Fakturor (2026-11-04): the pure rules and the documents. The data is invented. The database part is tests/customer-invoice.integration.ts.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { allocateInvoiceNumber, BLANK_INVOICE_SETTINGS, buildCredit, buildInvoice, freezeInvoiceTexts, frozenPdfTexts, invoiceContentOf, invoiceDetailsSchema, invoiceLabel, invoiceLinkPath, invoiceLinkState, invoicePaymentState, invoiceRetainedThrough, invoiceRetentionCutoff, INVOICE_LINK_DAYS, INVOICE_RETENTION_YEARS, publicInvoiceView, invoiceSums, invoiceUnit, ocrIsValid, ocrNumber, secondMonthEnd, sellerIsLimitedCompany, sellerProblems, signedSek, startNumberProblem, type InvoiceContent, type InvoiceDetails, type InvoiceSource } from "../lib/customer-invoice/model";
import { EXAMPLE_PERSONAL_NUMBER, exampleInvoiceContent, exampleInvoiceDetails, exampleInvoiceSource } from "../lib/customer-invoice/examples";
import { invoiceSellerOf } from "../lib/customer-invoice/seller";
import { createCustomerInvoicePdf } from "../lib/customer-invoice/report";
import { blockMayEdit, blockMayHide, catalogueProblems, resolvePdfDocument, type PdfTemplateOverride } from "../lib/pdf-templates/model";
import { PDF_DOCUMENTS, pdfDocumentDef } from "../lib/pdf-templates/catalog";
import { quoteTotals } from "../lib/quotes/model";
import { invoiceBasisTotals, NO_INVOICE_TAX } from "../lib/invoice-basis/model";
import { menuItemAllowed, resolveMenu } from "../lib/workflow/menu-items";
import { defaultWorkflowPermissionProfile, hasWorkflowPermission, noWorkflowPermissionProfile, workflowPermissionPresets } from "../lib/workflow/permissions";

const line = (amount: number, vatPercent = 25, rotLabour = false) => ({ amount, vatPercent, rotLabour });
const details = (patch: Partial<InvoiceDetails> = {}) => ({ ...invoiceDetailsSchema.parse({ performedOn: "2026-10-30", paymentDays: "30" }), ...patch });
const keys = (built: { problems: { key: string }[] }) => built.problems.map((problem) => problem.key);
const source = (variant: string, patch: Partial<InvoiceSource> = {}) => ({ ...exampleInvoiceSource(variant), ...patch });

test("sums: net and VAT per rate, whole öre, the total their sum", () => {
  const sums = invoiceSums([line(1000), line(100.1), line(200, 12), line(50.5, 6)], null);
  assert.deepEqual(sums.vatRows, [{ percent: 25, net: 1100.1, vat: 275.03 }, { percent: 12, net: 200, vat: 24 }, { percent: 6, net: 50.5, vat: 3.03 }]);
  assert.equal(sums.net, 1350.6);
  assert.equal(sums.vat, 302.06);
  assert.equal(sums.gross, 1652.66);
  assert.equal(sums.toPay, 1652.66);
});

test("rounding: VAT per rate is rounded once, on the rate's net, not per line", () => {
  const sums = invoiceSums([line(0.02), line(0.02), line(0.02)], null);
  assert.equal(sums.vatRows[0].net, 0.06);
  assert.equal(sums.vatRows[0].vat, 0.02);
});

test("with one rate an invoice counts as the basis and the quote do", () => {
  const built = buildInvoice(source("rot"), exampleInvoiceDetails("rot"));
  const basisLines = exampleInvoiceSource("rot").basis.lines;
  const totals = invoiceBasisTotals(basisLines, 25, { percent: 30, cap: 50000 });
  assert.equal(built.content.net, totals.net);
  assert.equal(built.content.vat, totals.vat);
  assert.equal(built.content.gross, totals.gross);
  assert.equal(built.content.rot?.deduction, totals.rot);
  assert.equal(built.content.toPay, totals.toPay);
  assert.deepEqual(quoteTotals(basisLines, 25, { percent: 30, cap: 50000 }).toPay, built.content.toPay);
});

test("ROT: labour incl. VAT, the split, the deduction, the cap, and the sum to pay", () => {
  const { content, problems, identity } = buildInvoice(source("rot"), exampleInvoiceDetails("rot"));
  assert.deepEqual(problems, []);
  assert.equal(content.rot?.labourInclVat, 4875);
  assert.equal(content.rot?.otherInclVat, content.gross - 4875);
  assert.equal(content.rot?.deduction, 1462.5);
  assert.equal(content.toPay, content.gross - 1462.5);
  assert.equal(content.rot?.capped, false);
  assert.equal(identity?.masked, "19121212-••••");
  const capped = invoiceSums([line(100000, 25, true)], { percent: 30, cap: 50000 });
  assert.equal(capped.deduction, 37500);
  const atCap = invoiceSums([line(1000000, 25, true)], { percent: 30, cap: 50000 });
  assert.equal(atCap.deduction, 50000);
  assert.equal(atCap.capped, true);
});

test("the identity number is never in the content: it comes back on its own, only for the sealed column", () => {
  const built = buildInvoice(source("rot"), exampleInvoiceDetails("rot"));
  const digits = EXAMPLE_PERSONAL_NUMBER.replace(/\D/g, "");
  assert.equal(built.identity?.digits, digits);
  const text = JSON.stringify(built.content);
  assert.ok(!text.includes(digits) && !text.includes(EXAMPLE_PERSONAL_NUMBER) && !text.includes(digits.slice(2)), "not in the snapshot");
  const problems = JSON.stringify(buildInvoice(source("rot"), { ...exampleInvoiceDetails("rot"), rot: { ...exampleInvoiceDetails("rot").rot, personalNumber: "19121212-1213" } }).problems);
  assert.ok(!problems.includes("19121212"), "a wrong number is not repeated in the message");
});

test("ROT refuses: no number, a wrong number, no property, no F-skatt, no labour marked, a company as buyer", () => {
  const rot = exampleInvoiceDetails("rot");
  const without = (patch: Partial<InvoiceDetails["rot"]>) => keys(buildInvoice(source("rot"), { ...rot, rot: { ...rot.rot, ...patch } }));
  assert.ok(without({ personalNumber: "" }).includes("rot.personalNumber"));
  assert.ok(without({ personalNumber: "19121212-1213" }).includes("rot.personalNumber"), "the check digit is checked");
  assert.ok(without({ propertyDesignation: "" }).includes("rot.property"));
  assert.ok(without({ propertyDesignation: "", brfOrganizationNumber: "769600-1234" }).includes("rot.apartment"));
  assert.deepEqual(without({ propertyDesignation: "", brfOrganizationNumber: "769600-1234", apartmentNumber: "1102" }), []);
  const base = exampleInvoiceSource("rot");
  assert.ok(keys(buildInvoice({ ...base, seller: { ...base.seller, fSkatt: false } }, rot)).includes("rot.fSkatt"));
  assert.ok(keys(buildInvoice({ ...base, basis: { ...base.basis, lines: base.basis.lines.map((item) => ({ ...item, rotLabour: false })) } }, rot)).includes("rot.labour"));
  assert.ok(keys(buildInvoice({ ...base, buyer: { ...base.buyer, customerType: "COMPANY" } }, rot)).includes("rot.type"));
});

test("reverse charge: no VAT, the buyer's VAT number, the note; and refusals", () => {
  const { content, problems } = buildInvoice(source("reverse"), exampleInvoiceDetails("reverse"));
  assert.deepEqual(problems, []);
  assert.equal(content.reverseVat, true);
  assert.equal(content.vat, 0);
  assert.equal(content.gross, content.net);
  assert.equal(content.buyerVatNumber, "SE559000000001");
  assert.ok(content.lines.every((item) => item.vatPercent === 0));
  const base = exampleInvoiceSource("reverse");
  assert.ok(keys(buildInvoice({ ...base, basis: { ...base.basis, tax: { ...base.basis.tax, buyerVatNumber: "" } } }, exampleInvoiceDetails("reverse"))).includes("buyer.vatNumber"));
  assert.ok(keys(buildInvoice({ ...base, buyer: { ...base.buyer, customerType: "PRIVATE" } }, exampleInvoiceDetails("reverse"))).includes("buyer.reverseType"));
});

test("refusal names exactly what is missing, the seller's details too", () => {
  const seller = { ...exampleInvoiceSource("plain").seller, name: "", address: "", organizationNumber: "", vatNumber: "", bankgiro: "" };
  const base = exampleInvoiceSource("plain");
  const built = buildInvoice({ ...base, seller, buyer: { ...base.buyer, name: "", address: "" }, settings: { ...base.settings, paymentDays: null } }, invoiceDetailsSchema.parse({}));
  for (const key of ["seller.name", "seller.address", "seller.organizationNumber", "seller.vatNumber", "seller.payment", "buyer.name", "buyer.address", "performedOn", "paymentDays"]) assert.ok(keys(built).includes(key), key);
  assert.ok(built.problems.every((problem) => problem.text.length > 10));
  assert.ok(keys(buildInvoice({ ...base, basis: { ...base.basis, lines: [] } }, details())).includes("lines.empty"));
  assert.ok(keys(buildInvoice({ ...base, basis: { ...base.basis, lines: [{ ...base.basis.lines[0]!, unitPrice: "" }] } }, details())).includes("lines.unpriced"));
  assert.deepEqual(keys(buildInvoice(base, details())), []);
});

test("a limited company needs its registered office; a sole trader does not", () => {
  const seller = { ...exampleInvoiceSource("plain").seller, registeredOffice: "" };
  assert.ok(sellerProblems(seller).some((problem) => problem.key === "seller.registeredOffice"));
  assert.equal(sellerIsLimitedCompany({ name: "Svens El", organizationNumber: "680101-1234" }), false);
  assert.equal(sellerProblems({ ...seller, name: "Svens El", organizationNumber: "680101-1234" }).length, 0);
});

test("selling without VAT: no VAT number needed, no VAT charged", () => {
  const base = exampleInvoiceSource("plain");
  const seller = { ...base.seller, vatNumber: "", vatExempt: true };
  const { content, problems } = buildInvoice({ ...base, seller }, details());
  assert.deepEqual(problems, []);
  assert.equal(content.vat, 0);
});

test("0 % outside reverse charge has to say why; other rates per line count", () => {
  const base = exampleInvoiceSource("plain");
  const zero = details({ lineVat: { l4: "0" } });
  assert.ok(keys(buildInvoice(base, zero)).includes("vat.exemption"));
  const built = buildInvoice(base, { ...zero, exemptionText: "Undantagen tjänst" });
  assert.deepEqual(keys(built), []);
  assert.equal(built.content.exemptionText, "Undantagen tjänst");
  assert.deepEqual(built.content.vatRows.map((row) => row.percent), [25, 0]);
  assert.ok(keys(buildInvoice(base, details({ lineVat: { l4: "abc" } }))).includes("lines.vat"));
});

test("purchase price and markup never reach the invoice: a line holds the selling price", () => {
  const base = exampleInvoiceSource("plain");
  const lines = [{ ...base.basis.lines[1]!, unitPrice: "100", markupPercent: "20", catalogue: undefined }];
  const { content } = buildInvoice({ ...base, basis: { ...base.basis, lines } }, details());
  assert.equal(content.lines[0]!.unitPrice, 120);
  assert.ok(!JSON.stringify(content).includes("markupPercent"));
  assert.ok(!JSON.stringify(content).includes("catalogue"));
});

test("the unit for hours is h on every invoice; other units stay as written", () => {
  for (const unit of ["h", "tim", "Timme", " timmar "]) assert.equal(invoiceUnit(unit), "h");
  assert.equal(invoiceUnit("st"), "st");
  assert.equal(invoiceUnit("m"), "m");
  const base = exampleInvoiceSource("plain");
  const { content } = buildInvoice({ ...base, basis: { ...base.basis, lines: [{ ...base.basis.lines[0]!, unit: "tim" }] } }, details());
  assert.equal(content.lines[0]!.unit, "h");
});

test("the dates: due = invoice date + terms; the second-month limit warns on old work", () => {
  const { content } = buildInvoice(source("plain"), details({ paymentDays: "10" }));
  assert.equal(content.issuedOn, "2026-11-04");
  assert.equal(content.dueOn, "2026-11-14");
  assert.equal(secondMonthEnd("2026-10-30"), "2026-12-31");
  assert.equal(secondMonthEnd("2026-01-15"), "2026-03-31");
  assert.equal(buildInvoice(source("plain"), details({ performedOn: "2026-10-30" })).warnings.length, 0);
  assert.ok(buildInvoice(source("plain"), details({ performedOn: "2026-08-30" })).warnings.some((text) => text.includes("Arbetet är gammalt")));
  assert.ok(keys(buildInvoice(source("plain"), details({ performedOn: "2026-11-20" }))).includes("performedOn.future"));
});

test("credit: own number, every amount negative, reference by number and date, parties kept, no payment", () => {
  const original = exampleInvoiceContent("rot");
  const credit = exampleInvoiceContent("credit");
  assert.equal(credit.kind, "CREDIT");
  assert.equal(credit.label, "1043");
  assert.deepEqual(credit.creditOf, { id: "exempel", label: "1042", issuedOn: "2026-11-04", reason: "Fel antal timmar på raden för installation." });
  assert.equal(credit.net, -original.net);
  assert.equal(credit.vat, -original.vat);
  assert.equal(credit.gross, -original.gross);
  assert.equal(credit.toPay, -original.toPay);
  assert.equal(credit.rot?.deduction, -(original.rot?.deduction ?? 0));
  assert.equal(credit.lines[0]!.amount, -original.lines[0]!.amount);
  assert.equal(credit.lines[0]!.unitPrice, original.lines[0]!.unitPrice);
  assert.equal(credit.dueOn, null);
  assert.deepEqual(credit.seller, original.seller);
  assert.deepEqual(credit.buyer, original.buyer);
  // A full credit nets to zero, whatever the rounding.
  assert.equal(original.net + credit.net, 0);
  assert.equal(original.toPay + credit.toPay, 0);
  assert.ok(!Object.is(buildCredit({ ...original, vat: 0 }, { id: "x", number: 2, label: "2", today: "2026-11-05", reason: "r", texts: {} }).vat, -0), "no negative zero");
  assert.equal(signedSek(-1234.5).replace(/\s/g, " "), "−1 234,50");
});

test("numbering: the next number from the series, in order, without gaps, however many ask", () => {
  // The server's row lock makes callers take turns: each sees what the previous left. Simulated with a queue of promises.
  let state = { enabled: true, nextNumber: 7, prefix: "A-" };
  let queue: Promise<unknown> = Promise.resolve();
  const given: string[] = [];
  const failing = new Set([3, 5]);
  const ask = (index: number) => { queue = queue.then(async () => {
    const before = state;
    const taken = allocateInvoiceNumber(before);
    state = { ...before, nextNumber: taken.nextNumber };
    await new Promise((resolve) => setImmediate(resolve));
    // A failed issue rolls back: the series stays as it was and the number is given to the next.
    if (failing.has(index)) { state = before; return; }
    given.push(taken.label);
  }); return queue; };
  return Promise.all(Array.from({ length: 12 }, (_, index) => ask(index))).then(() => {
    assert.deepEqual(given, ["A-7", "A-8", "A-9", "A-10", "A-11", "A-12", "A-13", "A-14", "A-15", "A-16"]);
    assert.equal(new Set(given).size, given.length);
    assert.equal(state.nextNumber, 17);
  });
});

test("numbering: off gives no number, and the start number locks at the first invoice", () => {
  assert.throws(() => allocateInvoiceNumber({ enabled: false, nextNumber: 1, prefix: "" }));
  assert.equal(startNumberProblem({ nextNumber: 1, issued: 0 }, 1001), "");
  assert.match(startNumberProblem({ nextNumber: 1, issued: 0 }, 0), /heltal/);
  assert.match(startNumberProblem({ nextNumber: 5, issued: 4 }, 100), /kan inte ändras/);
  assert.equal(startNumberProblem({ nextNumber: 5, issued: 4 }, 5), "");
  assert.equal(invoiceLabel("2026-", 12), "2026-12");
  assert.equal(BLANK_INVOICE_SETTINGS.enabled, true, "on for everyone (2026-11-05)");
});

test("OCR: a check digit and a length digit; the invoice number by default", () => {
  assert.equal(ocrNumber(1042), "1042" + "6" + "5");
  for (const number of [1, 7, 42, 1042, 99999, 123456789]) assert.ok(ocrIsValid(ocrNumber(number)), String(number));
  assert.equal(ocrIsValid("104264"), false, "a wrong check digit");
  assert.equal(ocrIsValid("104275"), false, "a wrong length digit");
  assert.equal(buildInvoice(source("plain"), details(), { number: 12, label: "A-12" }).content.reference, "A-12");
  const ocr = buildInvoice({ ...exampleInvoiceSource("plain"), settings: { ...BLANK_INVOICE_SETTINGS, paymentDays: 30, useOcr: true } }, details(), { number: 12, label: "A-12" });
  assert.equal(ocr.content.reference, ocrNumber(12));
  assert.equal(ocr.content.ocr, true);
});

test("payment state: overdue is derived, credited and credit have none", () => {
  const invoice = { kind: "INVOICE" as const, paidOn: null, dueOn: "2026-11-10", credited: false };
  assert.equal(invoicePaymentState(invoice, "2026-11-10"), "UNPAID");
  assert.equal(invoicePaymentState(invoice, "2026-11-11"), "OVERDUE");
  assert.equal(invoicePaymentState({ ...invoice, paidOn: "2026-11-09" }, "2026-12-01"), "PAID");
  assert.equal(invoicePaymentState({ ...invoice, credited: true }, "2026-12-01"), "CREDITED");
  assert.equal(invoicePaymentState({ ...invoice, kind: "CREDIT" }, "2026-12-01"), "CREDIT");
});

test("the seller comes from the company's profile by the form's own field names, in one place", () => {
  const seller = invoiceSellerOf("Exempel El AB", { organizationNumber: "556000-0000", vatNumber: "SE556000000001", fSkatt: true, address: "Gatan 1", postalCode: "123 45", city: "Stad", registeredOffice: "Stad", bankgiro: "123-4567", plusgiro: "12 34 56-7" }, { iban: "SE00", bic: "X", vatExempt: false });
  assert.deepEqual([seller.registeredOffice, seller.bankgiro, seller.plusgiro, seller.iban, seller.fSkatt], ["Stad", "123-4567", "12 34 56-7", "SE00", true]);
  assert.equal(seller.address, "Gatan 1, 123 45 Stad");
  assert.equal(invoiceSellerOf("X", {}, { iban: "", bic: "", vatExempt: false }).bankgiro, "");
  assert.equal(invoiceSellerOf("X", { vatNumber: "SE1" }, { iban: "", bic: "", vatExempt: true }).vatNumber, "", "selling without VAT prints none");
});

test("the right Fakturera: its own right, off for a new person, in no preset but Full åtkomst", () => {
  assert.equal(hasWorkflowPermission(noWorkflowPermissionProfile(), "invoicing", "edit"), false);
  assert.equal(hasWorkflowPermission(defaultWorkflowPermissionProfile(), "invoicing", "edit"), true);
  for (const preset of workflowPermissionPresets) if (preset.id !== "full") assert.equal(hasWorkflowPermission(preset.profile as never, "invoicing", "read"), false, preset.id);
  assert.equal(hasWorkflowPermission({ version: 1, grants: ["quotes:read", "quotes:edit"] }, "invoicing", "read"), false, "Offerter never opens invoices");
});

test("the catalogue: both documents are sound, and what the rules want cannot be hidden or changed", () => {
  assert.deepEqual(catalogueProblems(PDF_DOCUMENTS), []);
  for (const type of ["invoice", "credit_invoice"]) {
    const doc = pdfDocumentDef(type)!;
    for (const id of ["title", "fact.buyer", "fact.seller", "fact.performed", "section.spec", "note.f-tax", "note.reverse-vat", "note.vat-exempt", "note.rot", "fact.personal-number", "fact.property"]) {
      const block = doc.blocks.find((item) => item.id === id);
      assert.ok(block, `${type}.${id}`);
      assert.equal(blockMayHide(block), false, `${type}.${id} cannot be hidden`);
    }
    for (const id of ["note.f-tax", "note.reverse-vat", "note.vat-exempt"]) assert.equal(blockMayEdit(doc.blocks.find((item) => item.id === id)!), false, `${type}.${id} is a fixed wording`);
    assert.ok(doc.blocks.every((block) => block.id === "kind" || block.id === "spec.note" || !blockMayHide(block)), `${type}: only the small labels can be hidden`);
  }
});

test("a later change of the template never changes an issued invoice", () => {
  const def = pdfDocumentDef("invoice")!;
  const frozen = freezeInvoiceTexts(resolvePdfDocument(def, null));
  const issued = frozenPdfTexts(frozen, def.blocks);
  const version = resolvePdfDocument(def, null).blocks.find((block) => block.def.id === "pay.late")!.version;
  const override: PdfTemplateOverride = { documentType: "invoice", blockId: "pay.late", text: "Ny text.", visible: null, orderIndex: null, basedOnVersion: version };
  assert.equal(resolvePdfDocument(def, [override]).blocks.find((block) => block.def.id === "pay.late")!.text, "Ny text.");
  assert.match(issued.text("pay.late"), /dröjsmålsränta/);
  assert.ok(invoiceContentOf(JSON.parse(JSON.stringify(exampleInvoiceContent("plain")))));
  assert.equal(invoiceContentOf({ version: 2 }), null);
});

test("retention: seven years, counted from the end of the year after the invoice's, so a broken fiscal year is safe", () => {
  assert.equal(INVOICE_RETENTION_YEARS, 7);
  assert.equal(invoiceRetainedThrough("2026-01-15"), "2034-12-31");
  assert.equal(invoiceRetainedThrough("2026-12-31"), "2034-12-31");
  // An invoice from 2026 is kept through 2034 and goes from the first day of 2035, Swedish time.
  assert.equal(invoiceRetentionCutoff(new Date("2034-12-31T22:59:00Z")), "2026-01-01");
  assert.equal(invoiceRetentionCutoff(new Date("2034-12-31T23:01:00Z")), "2027-01-01");
  assert.ok("2026-12-31" >= invoiceRetentionCutoff(new Date("2034-06-01T12:00:00Z")), "still kept during 2034");
  assert.ok("2026-12-31" < invoiceRetentionCutoff(new Date("2035-01-01T12:00:00Z")), "over its time in 2035");
});

test("the customer's page: only what is allow-listed, never the identity number or the property", () => {
  const content = exampleInvoiceContent("rot");
  const view = publicInvoiceView(content, false);
  const text = JSON.stringify(view);
  assert.ok(!text.includes("19121212") && !text.includes("Exemplet 1:23") && !text.includes("exempel") && !text.includes("Org.nr"));
  assert.deepEqual(Object.keys(view).sort(), ["creditedNote", "credit", "dueOn", "issuedOn", "label", "ocr", "payment", "reference", "title", "toPay"].sort());
  assert.deepEqual(view.payment, [{ label: "Bankgiro", value: "123-4567" }]);
  assert.deepEqual(publicInvoiceView(exampleInvoiceContent("credit"), false).payment, [], "a credit asks for no payment");
  assert.equal(invoiceLinkPath("abc"), "/faktura/abc");
  assert.equal(INVOICE_LINK_DAYS, 60);
});

test("the customer's link: open through its last day, then expired; replaced is replaced", () => {
  assert.equal(invoiceLinkState({ validUntil: "2026-12-01", revokedAt: null }, "2026-12-01"), "open");
  assert.equal(invoiceLinkState({ validUntil: "2026-12-01", revokedAt: null }, "2026-12-02"), "expired");
  assert.equal(invoiceLinkState({ validUntil: "2026-12-01", revokedAt: "2026-11-05T00:00:00Z" }, "2026-11-06"), "revoked");
});

test("the menu: Fakturor stands only with invoicing on and the right, and never in Local", () => {
  const admin = { memberRole: "ADMIN" as const, workflowPermissions: noWorkflowPermissionProfile() };
  const member = (grants: string[]) => ({ memberRole: "MEMBER" as const, workflowPermissions: { version: 1 as const, grants: grants as never[] } });
  assert.equal(menuItemAllowed("customer_invoices", admin), false, "off by default");
  assert.equal(menuItemAllowed("customer_invoices", { ...admin, invoicingOn: false }), false);
  assert.equal(menuItemAllowed("customer_invoices", { ...admin, invoicingOn: true }), true);
  assert.equal(menuItemAllowed("customer_invoices", { ...member(["invoicing:read"]), invoicingOn: true }), true);
  assert.equal(menuItemAllowed("customer_invoices", { ...member(["quotes:read", "quotes:edit"]), invoicingOn: true }), false, "Offerter never opens it");
  assert.equal(menuItemAllowed("customer_invoices", { ...admin, invoicingOn: true, localStorageMode: true }), false);
  assert.equal(menuItemAllowed("customer_invoices", { ...admin, invoicingOn: true, modules: ["quotes"] }), false, "the module off takes it away");
  const keys = (access: Parameters<typeof resolveMenu>[0]) => resolveMenu(access, { hidden: [], shortcuts: [] }).flat().map((entry) => entry.key);
  assert.ok(!keys(admin).includes("customer_invoices"));
  const on = keys({ ...admin, invoicingOn: true });
  assert.equal(on.indexOf("customer_invoices"), on.indexOf("quotes") + 1, "right under Offerter");
});

// ---------- the documents ----------

const fontBytes = () => {
  const load = (name: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "public/fonts", name)));
  return { regular: load("Manrope-Regular.ttf"), bold: load("Manrope-Bold.ttf"), fallback: load("DejaVuSans.ttf") };
};
const identity = { company: "Exempel El AB", sender: null, templates: null };
async function textOf(bytes: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  let text = "";
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    text += `${(await page.getTextContent()).items.map((item) => "str" in item ? item.str : "").join(" ")}\n`;
  }
  return { text: text.replace(/\s+/g, " "), pages: doc.numPages };
}
const VARIANTS = { normal: "invoice", rot: "rot", omvand: "reverse", kredit: "credit" } as const;

test("the documents carry what is required, and a basis's internal mark never", { timeout: 120_000 }, async () => {
  const out = process.env.FAKTURA_EXEMPEL;
  if (out) mkdirSync(out, { recursive: true });
  for (const [name, variant] of Object.entries(VARIANTS)) {
    const content = exampleInvoiceContent(variant);
    const personalNumber = content.rot ? EXAMPLE_PERSONAL_NUMBER : "";
    const bytes = await createCustomerInvoicePdf({ identity, fontBytes: fontBytes(), content, personalNumber });
    if (out) writeFileSync(path.join(out, `faktura-${name}.pdf`), bytes);
    const { text } = await textOf(bytes);
    for (const word of ["Exempel El AB", "Org.nr 556000-0000", "Momsreg.nr SE556000000001", "Säte Exempelstad", "Godkänd för F-skatt", content.buyer.name, content.buyer.address, content.label, "Fakturadatum", "Benämning", "Antal", "À-pris", "Belopp", "Summa exkl. moms", "Utfört"]) assert.ok(text.includes(word), `${name}: ${word}`);
    assert.doesNotMatch(text, /internt underlag|EJ FAKTURA/i);
    assert.ok(!text.includes("kr/tim") && !/\btim\b/.test(text), `${name}: the unit for hours is h`);
    if (variant !== "credit") {
      for (const word of ["Faktura", "Förfallodatum", "Betalningsvillkor", "Bankgiro", "123-4567", "Att betala", "dröjsmålsränta"]) assert.ok(text.includes(word), `${name}: ${word}`);
      assert.ok(text.includes(content.reference), `${name}: the reference`);
    }
    if (variant === "invoice") { assert.ok(text.includes("OCR-nummer")); assert.ok(text.includes("Moms 25 %")); }
    if (variant === "reverse") {
      assert.ok(text.includes("Omvänd betalningsskyldighet"));
      assert.ok(text.includes("SE559000000001"));
      assert.doesNotMatch(text, /Moms 25 %/);
    }
    if (variant === "rot" || variant === "credit") {
      for (const word of [EXAMPLE_PERSONAL_NUMBER, "Exempelstad Exemplet 1:23", "Arbetskostnad inkl. moms", "Material och övrigt inkl. moms", "Skattereduktion ROT", "Arbetsplats"]) assert.ok(text.includes(word), `${name}: ${word}`);
    }
    if (variant === "credit") {
      for (const word of ["Kreditfaktura", "Krediterar faktura", "1042, 2026-11-04", "Fel antal timmar", "Krediterat belopp", "−"]) assert.ok(text.includes(word), `kredit: ${word}`);
      assert.doesNotMatch(text, /Förfallodatum|dröjsmålsränta/);
    }
  }
});

test("a document drawn without the opened number shows a dash, never a digit from the snapshot", async () => {
  const { text } = await textOf(await createCustomerInvoicePdf({ identity, fontBytes: fontBytes(), content: exampleInvoiceContent("rot") }));
  assert.ok(!text.includes("19121212"));
  assert.ok(text.includes("Köparens personnummer"));
});

test("a preview says so and has no number", async () => {
  const content = buildInvoice(source("plain"), details()).content;
  const { text } = await textOf(await createCustomerInvoicePdf({ identity, fontBytes: fontBytes(), content, preview: true }));
  assert.ok(text.includes("FÖRHANDSGRANSKNING"));
  assert.ok(text.includes("Utan nummer"));
});

test("a long list runs over pages and stays whole; several rates get their column", async () => {
  const base = exampleInvoiceSource("plain");
  const lines = Array.from({ length: 60 }, (_, index) => ({ ...base.basis.lines[1]!, id: `r${index}`, name: `Rad ${index + 1} med en lång benämning som kan behöva brytas på två rader i tabellen för att få plats`, articleNo: index % 2 ? "EX-1" : "" }));
  const content = buildInvoice({ ...base, basis: { ...base.basis, lines } }, details({ lineVat: { r1: "12", r2: "6" } })).content;
  const { text, pages } = await textOf(await createCustomerInvoicePdf({ identity, fontBytes: fontBytes(), content }));
  assert.ok(pages >= 2);
  assert.ok(text.includes("Rad 60"));
  assert.ok(text.includes("Underlag 12 %") && text.includes("Moms 6 %") && text.includes("fortsättning"));
  assert.equal(NO_INVOICE_TAX.reverseVat, false);
});

test("the seller reads Företagsuppgifter's säte, bankgiro and plusgiro; nothing when empty", async () => {
  const seller = invoiceSellerOf("Svens El AB", { organizationNumber: "556000-0000", registeredOffice: "Provstad", bankgiro: "123-4567", plusgiro: "12 34 56-7" }, { iban: "", bic: "", vatExempt: false });
  assert.equal(seller.registeredOffice, "Provstad");
  assert.equal(seller.bankgiro, "123-4567");
  assert.equal(seller.plusgiro, "12 34 56-7");
  const empty = invoiceSellerOf("Svens El AB", {}, { iban: "", bic: "", vatExempt: false });
  assert.deepEqual([empty.registeredOffice, empty.bankgiro, empty.plusgiro], ["", "", ""]);
});

test("the owner's edited common texts are frozen into the invoice; a later edit changes nothing; an old snapshot prints the defaults", async () => {
  const common = pdfDocumentDef("common")!;
  const version = (id: string) => resolvePdfDocument(common, null).blocks.find((block) => block.def.id === id)!.version;
  const edit = (id: string, text: string | null, visible: boolean | null = null): PdfTemplateOverride => ({ documentType: "common", blockId: id, text, visible, orderIndex: null, basedOnVersion: version(id) });
  // A valid edit, a text that drops its required placeholder, and an attempt to hide a block that is always drawn.
  const first = [edit("legal.org", "Organisationsnr {nr}"), edit("legal.vat", "Utan platshållare"), edit("legal.f-tax", null, false)];
  const content = exampleInvoiceContent("plain", first);
  assert.equal(content.common!["legal.org"]!.text, "Organisationsnr {nr}");
  assert.equal(content.common!["legal.vat"]!.text, "Momsreg.nr {nr}", "a text that hides required content is not applied");
  assert.equal(content.common!["legal.f-tax"]!.shown, true);
  const json = JSON.parse(JSON.stringify(content));
  const stored = invoiceContentOf(json)!;
  const drawn = async (value: InvoiceContent) => (await textOf(await createCustomerInvoicePdf({ identity, fontBytes: fontBytes(), content: value }))).text;
  const text = await drawn(stored);
  assert.ok(text.includes("· Organisationsnr 556000-0000") && !text.includes("· Org.nr 556000-0000"));
  assert.ok(text.includes("Momsreg.nr SE556000000001"));
  // A later edit of the template does not reach the issued invoice: the snapshot is all the PDF reads (the identity's templates are not used).
  const later = exampleInvoiceContent("plain", [edit("legal.org", "Senare {nr}")]);
  assert.equal(later.common!["legal.org"]!.text, "Senare {nr}");
  assert.equal(stored.common!["legal.org"]!.text, "Organisationsnr {nr}");
  const withLater = (await textOf(await createCustomerInvoicePdf({ identity: { ...identity, templates: [edit("legal.org", "Senare {nr}")] }, fontBytes: fontBytes(), content: stored }))).text;
  assert.ok(withLater.includes("Organisationsnr 556000-0000") && !withLater.includes("Senare"));
  // A snapshot from before this part has no common texts: the defaults, exactly as before.
  const old = { ...json }; delete old.common;
  const oldText = await drawn(invoiceContentOf(old)!);
  assert.ok(oldText.includes("· Org.nr 556000-0000") && !oldText.includes("Organisationsnr"));
  // A credit invoice takes the common texts of its own day.
  const credit = buildCredit(stored, { id: "x", number: 2, label: "2", today: "2026-11-05", reason: "Fel.", texts: stored.texts, common: later.common });
  assert.equal(credit.common!["legal.org"]!.text, "Senare {nr}");
});
