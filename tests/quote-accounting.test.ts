import assert from "node:assert/strict";
import { test } from "node:test";
import { accountingSettingsOf, csvCell, DRAFT_BASIS_SIE_REFUSED, QUOTE_SIE_REFUSED, quoteOre, quotesCsv, quotesSie, quoteVoucher, sieBytes, sieRefusal, sieText, type AccountingQuote, type AccountingSettings } from "../lib/quotes/accounting";
import { fortnoxCustomerNumberProblem, fortnoxInvoicePayload } from "../lib/quotes/fortnox";

const settings: AccountingSettings = { materialAccount: "3001", labourAccount: "3002", otherAccount: "3003", vatAccount: "2611", receivableAccount: "1510", rotReceivableAccount: "", reverseVatAccount: "", series: "A" };
const quote = (over: Partial<AccountingQuote> = {}): AccountingQuote => ({
  id: "q1", label: "O-0012", title: "Elcentral \"ny\"", status: "ACCEPTED", date: "2026-10-09", customerName: "Kund Åkesson AB", customerNumber: "K-4711", projectName: "Villa Öst", vatPercent: 25,
  lines: [
    { kind: "MATERIAL", name: "Kabel", quantity: 12.5, unit: "m", unitPrice: 10, markupPercent: 15 },
    { kind: "LABOUR", name: "Montör", quantity: 3, unit: "h", unitPrice: 650, markupPercent: null },
    { kind: "OTHER", name: "=SUM(A1)", quantity: "1", unit: "st", unitPrice: "99,90", markupPercent: "" },
  ],
  ...over,
});

test("account mapping starts empty and drops what is unreadable, field by field", () => {
  assert.deepEqual(accountingSettingsOf(null), { materialAccount: "", labourAccount: "", otherAccount: "", vatAccount: "", receivableAccount: "", rotReceivableAccount: "", reverseVatAccount: "", series: "" });
  assert.deepEqual(accountingSettingsOf({ materialAccount: "30x1", vatAccount: "2611", series: "B 1" }), { materialAccount: "", labourAccount: "", otherAccount: "", vatAccount: "2611", receivableAccount: "", rotReceivableAccount: "", reverseVatAccount: "", series: "" });
});

test("sums are counted in whole öre and balance", () => {
  const sums = quoteOre(quote());
  // 12,5 × 10 × 1,15 = 143,75; 3 × 650 = 1950; 99,90
  assert.deepEqual(sums.byKind, { MATERIAL: 14375, LABOUR: 195000, OTHER: 9990 });
  assert.equal(sums.net, 219365);
  assert.equal(sums.vat, 54841); // 548,4125 rounded
  assert.equal(sums.gross, 274206);
  const voucher = quoteVoucher(quote(), settings);
  assert.deepEqual(voucher.issues, []);
  assert.deepEqual(voucher.rows, [{ account: "1510", ore: 274206 }, { account: "3001", ore: -14375 }, { account: "3002", ore: -195000 }, { account: "3003", ore: -9990 }, { account: "2611", ore: -54841 }]);
  assert.equal(voucher.rows.reduce((sum, row) => sum + row.ore, 0), 0);
});

test("CSV: one row per line, semicolon, decimal comma, BOM and CRLF, formulas neutralised", () => {
  const csv = quotesCsv([quote()]);
  assert.ok(csv.startsWith("﻿\"Offert\";\"Rubrik\""));
  const rows = csv.slice(1).split("\r\n");
  assert.equal(rows.length, 5); // header, three lines, trailing empty
  assert.equal(rows[4], "");
  assert.equal(rows[1], "\"O-0012\";\"Elcentral \"\"ny\"\"\";\"Accepterad\";\"2026-10-09\";\"Kund Åkesson AB\";\"K-4711\";\"Villa Öst\";\"1\";\"Material\";\"\";\"Kabel\";\"12,5\";\"m\";\"11,50\";\"143,75\";\"25\"");
  assert.ok(rows[3].includes("\"'=SUM(A1)\""));
  assert.equal(csvCell("-12,50"), "\"-12,50\"");
  assert.equal(csvCell("-x"), "\"'-x\"");
  const unpriced = quotesCsv([quote({ lines: [{ kind: "MATERIAL", name: "Dosa", quantity: 2, unit: "st", unitPrice: null, markupPercent: null }] })]);
  assert.ok(unpriced.includes("\"Dosa\";\"2\";\"st\";\"\";\"\";\"25\""));
});

// The SIE file is made of an invoiced fakturaunderlag only (2026-11-01); the same lines as the quote above.
const invoiced = (over: Partial<AccountingQuote> = {}) => quote({ document: "invoice_basis", label: "F-0012", status: "INVOICED", ...over });

test("SIE 4: header, one verification per invoiced basis, amounts with dot, empty number for the program", () => {
  const { text, issues } = quotesSie([invoiced()], settings, { company: "Elfirma \"Ström\" AB", organizationNumber: "556000-0000", generatedOn: "2026-10-09", programVersion: "0.4.29" });
  assert.deepEqual(issues, []);
  assert.equal(text, [
    "#FLAGGA 0",
    "#PROGRAM \"Workflow\" \"0.4.29\"",
    "#FORMAT PC8",
    "#GEN 20261009",
    "#SIETYP 4",
    "#FNAMN \"Elfirma \\\"Ström\\\" AB\"",
    "#ORGNR 556000-0000",
    "#VER \"A\" \"\" 20261009 \"Fakturaunderlag F-0012 Elcentral \\\"ny\\\" Kund Åkesson AB\"",
    "{",
    "   #TRANS 1510 {} 2742.06",
    "   #TRANS 3001 {} -143.75",
    "   #TRANS 3002 {} -1950.00",
    "   #TRANS 3003 {} -99.90",
    "   #TRANS 2611 {} -548.41",
    "}",
    "",
  ].join("\r\n"));
  assert.ok(!text.includes("#KONTO"), "no account names are written");
});

test("SIE: a quote is never booked and a draft basis is refused, whatever its status (2026-11-01)", () => {
  const meta = { company: "X", organizationNumber: "", generatedOn: "2026-10-09", programVersion: "1" };
  for (const status of ["DRAFT", "SENT", "ACCEPTED"] as const) {
    assert.equal(sieRefusal(quote({ status })), QUOTE_SIE_REFUSED);
    assert.deepEqual(quotesSie([quote({ status })], settings, meta), { text: "", issues: [QUOTE_SIE_REFUSED] });
  }
  assert.equal(sieRefusal(invoiced({ status: "DRAFT" })), `F-0012: ${DRAFT_BASIS_SIE_REFUSED}`);
  const draft = quotesSie([invoiced({ status: "DRAFT" })], settings, meta);
  assert.equal(draft.text, "");
  assert.ok(draft.issues[0].includes("inte ett utkast"));
  assert.equal(sieRefusal(invoiced()), "");
  assert.ok(QUOTE_SIE_REFUSED.startsWith("Offerter exporteras inte till bokföringen"));
});

test("SIE: nothing is written while accounts or series are missing", () => {
  const empty = accountingSettingsOf({});
  const result = quotesSie([invoiced()], empty, { company: "X", organizationNumber: "", generatedOn: "2026-10-09", programVersion: "1" });
  assert.equal(result.text, "");
  assert.ok(result.issues.some((issue) => issue.includes("verifikationsserie")));
  assert.ok(result.issues.some((issue) => issue.includes("kundfordran")));
  assert.ok(result.issues.some((issue) => issue.includes("utgående moms")));
  const unpriced = quoteVoucher(quote({ lines: [{ kind: "MATERIAL", name: "Dosa", quantity: 2, unit: "st", unitPrice: "", markupPercent: null }] }), settings);
  assert.ok(unpriced.issues.some((issue) => issue.includes("saknar pris")));
  // Only the accounts actually used are required.
  const materialOnly = quoteVoucher(quote({ lines: [{ kind: "MATERIAL", name: "Kabel", quantity: 1, unit: "m", unitPrice: 10, markupPercent: null }] }), { ...settings, labourAccount: "", otherAccount: "" });
  assert.deepEqual(materialOnly.issues, []);
});

test("SIE text fields and PC8 (code page 437) encoding", () => {
  assert.equal(sieText("a\"b\\c\nd"), "\"a\\\"b\\\\c d\"");
  assert.deepEqual([...sieBytes("åäöÅÄÖé")], [0x86, 0x84, 0x94, 0x8f, 0x8e, 0x99, 0x82]);
  assert.deepEqual([...sieBytes("A日")], [0x41, 0x3f]);
  assert.deepEqual([...sieBytes("A€")], [0x41, 0x45, 0x55, 0x52], "the euro sign is written out");
});

test("Fortnox payload: invoice draft rows with selling price excl. VAT, account only when set", () => {
  const { payload, issues } = fortnoxInvoicePayload(quote(), { ...settings, otherAccount: "" }, " K-100 ");
  assert.deepEqual(issues, []);
  assert.deepEqual(payload, { Invoice: {
    CustomerNumber: "K-100", InvoiceDate: "2026-10-09", ExternalInvoiceReference1: "Offert O-0012", Remarks: "Elcentral \"ny\"\nProjekt: Villa Öst",
    InvoiceRows: [
      { Description: "Kabel", DeliveredQuantity: "12.5", Price: 11.5, VAT: 25, AccountNumber: 3001 },
      { Description: "Montör", DeliveredQuantity: "3", Price: 650, VAT: 25, AccountNumber: 3002 },
      { Description: "=SUM(A1)", DeliveredQuantity: "1", Price: 99.9, VAT: 25 },
    ],
  } });
  assert.equal(JSON.stringify(payload).includes("Bearer"), false);
});

test("Fortnox payload refuses what Fortnox should not get", () => {
  assert.ok(fortnoxCustomerNumberProblem(""));
  assert.ok(fortnoxCustomerNumberProblem("a b"));
  assert.equal(fortnoxCustomerNumberProblem("1001"), "");
  const notAccepted = fortnoxInvoicePayload(quote({ status: "DRAFT" }), settings, "1");
  assert.equal(notAccepted.payload, null);
  assert.ok(notAccepted.issues[0].includes("accepterad"));
  const long = fortnoxInvoicePayload(quote({ lines: [{ kind: "MATERIAL", name: "x".repeat(80), quantity: 1, unit: "st", unitPrice: 1, markupPercent: null }] }), settings, "1");
  assert.equal(long.payload!.Invoice.InvoiceRows[0].Description.length, 50);
});

test("ROT: the receivable is split into the customer's share and the ROT claim, which needs its own account", () => {
  const withRot = quote({
    rot: { percent: 30, cap: 50000 },
    lines: [
      { kind: "MATERIAL", name: "Kabel", quantity: 12.5, unit: "m", unitPrice: 10, markupPercent: 15 },
      { kind: "LABOUR", name: "Montör", quantity: 3, unit: "h", unitPrice: 650, markupPercent: null, rotLabour: true },
    ],
  });
  const sums = quoteOre(withRot);
  // Labour 1 950 kr, incl. VAT 2 437,50 kr, 30 % = 731,25 kr. Gross (143,75 + 1 950) × 1,25 = 2 617,19 kr.
  assert.equal(sums.rot, 73125);
  assert.equal(sums.gross, 261719);
  assert.equal(sums.customer, 261719 - 73125);
  const missing = quoteVoucher(withRot, settings);
  assert.ok(missing.issues.some((issue) => issue.includes("fordran rot-avdrag")), "the ROT account is asked for when ROT is used");
  const voucher = quoteVoucher(withRot, { ...settings, rotReceivableAccount: "1513" });
  assert.deepEqual(voucher.issues, []);
  assert.deepEqual(voucher.rows.slice(0, 2), [{ account: "1510", ore: 188594 }, { account: "1513", ore: 73125 }]);
  assert.equal(voucher.rows.reduce((sum, row) => sum + row.ore, 0), 0, "the verification balances");
  assert.equal(quoteOre({ ...withRot, rot: { percent: 30, cap: 500 } }).rot, 50000, "never above the cap");
  assert.equal(quoteOre({ ...withRot, rot: null }).rot, 0);
  assert.deepEqual(quoteVoucher(quote(), settings).issues, [], "without ROT the ROT account is not needed");
});

test("SIE bytes: a dash, curly quotes and an ellipsis come out as plain text, accents drop, the rest becomes ? (Fas 2)", () => {
  const text = (value: string) => Buffer.from(sieBytes(value)).toString("latin1");
  assert.deepEqual([...sieBytes("Å – ä")], [0x8f, 0x20, 0x2d, 0x20, 0x84]);
  assert.equal(text("a—b “x” …"), "a-b 'x' ...");
  assert.equal(text("Šeš"), "Ses");
  assert.equal(text("日本"), "??");
});
