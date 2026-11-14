import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { exportFileName, exportTemplateSchema, PRESET_TEMPLATES, type ExportAbsence, type ExportPerson, type ExportTimeEntry } from "../lib/payroll/export";
import { latin1Bytes, paxmlDocument, paxmlHours, paxmlTimeCode, paxmlTransactions, paxmlPreviewRows, xmlText } from "../lib/payroll/paxml";
import { monthStatusLookup, monthsBetween, onlyApprovedMonths, skippedWarnings } from "../lib/payroll/periods";
import { basisCsv, basisGaps, basisRows, basisStatusText, payrollBasis } from "../lib/payroll/basis";
import { createBasisPdf } from "../lib/payroll/basis-report";

// Löneunderlag och PAXml (2026-10-30): the PAXml writer, the month rule and the payroll basis, without a database.
const people: ExportPerson[] = [
  { userId: "anna", name: "Anna Andersson", email: "anna@example.invalid", employeeNumber: "1001", weeklyWorkMinutes: 2400 },
  { userId: "bo", name: "Bo Berg", email: "bo@example.invalid", employeeNumber: null, weeklyWorkMinutes: 2400 },
  { userId: "cia", name: "Cia <&> Ek", email: "cia@example.invalid", employeeNumber: "A&1", weeklyWorkMinutes: 2400, noFixedHours: true },
];
const entry = (userId: string, day: string, minutes: number, timeType: string, timeTypeCode: string): ExportTimeEntry =>
  ({ userId, day, seconds: minutes * 60, project: "", workOrder: "", customer: "", timeType, timeTypeCode });
const absence = (userId: string, type: ExportAbsence["type"], from: string, to: string, extra: Partial<ExportAbsence> = {}): ExportAbsence =>
  ({ userId, type, note: "", from, to, hours: null, status: "APPROVED", sourceLabel: "Workflow", externalCode: null, ...extra });

test("PAXml: worked time per person, day and type, absence per workday, golden output", () => {
  const { transactions, errors } = paxmlTransactions({
    from: "2026-11-01", to: "2026-11-30", people: [people[0]], exportCodes: { VACATION: "sem" },
    entries: [entry("anna", "2026-11-02", 240, "Ordinarie", "TID"), entry("anna", "2026-11-02", 210, "Ordinarie", "TID"), entry("anna", "2026-11-02", 90, "Övertid", "öt1")],
    absences: [absence("anna", "VACATION", "2026-11-06", "2026-11-09"), absence("anna", "SICK", "2026-11-10", "2026-11-10", { status: "APPLIED" })],
  });
  assert.deepEqual(errors, []);
  const xml = paxmlDocument({ transactions, createdAt: "2026-12-01T08:30:00", company: "Elfirman AB" });
  assert.equal(xml, [
    `<?xml version="1.0" encoding="ISO-8859-1"?>`,
    `<paxml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.paxml.se/2.0/paxml.xsd">`,
    "  <header>", "    <format>LÖNIN</format>", "    <version>2.0</version>", "    <datum>2026-12-01T08:30:00</datum>", "    <foretagnamn>Elfirman AB</foretagnamn>", "    <programnamn>Workflow</programnamn>", "  </header>",
    "  <tidtransaktioner>",
    `    <tidtrans anstid="1001">`, "      <tidkod>TID</tidkod>", "      <datum>2026-11-02</datum>", "      <timmar>7.50</timmar>", "    </tidtrans>",
    `    <tidtrans anstid="1001">`, "      <tidkod>ÖT1</tidkod>", "      <datum>2026-11-02</datum>", "      <timmar>1.50</timmar>", "    </tidtrans>",
    // Friday and Monday: the weekend between is not a workday; the applied sick day is not written.
    `    <tidtrans anstid="1001">`, "      <tidkod>SEM</tidkod>", "      <datum>2026-11-06</datum>", "      <timmar>8.00</timmar>", "    </tidtrans>",
    `    <tidtrans anstid="1001">`, "      <tidkod>SEM</tidkod>", "      <datum>2026-11-09</datum>", "      <timmar>8.00</timmar>", "    </tidtrans>",
    "  </tidtransaktioner>", "</paxml>", "",
  ].join("\r\n"));
});

test("PAXml: a person without number, a type without code and a code outside the format are errors and not written", () => {
  const { transactions, errors } = paxmlTransactions({
    from: "2026-11-01", to: "2026-11-30", people,
    entries: [entry("bo", "2026-11-02", 60, "Ordinarie", "TID"), entry("bo", "2026-11-03", 60, "Ordinarie", "TID"), entry("anna", "2026-11-02", 60, "Restid", ""), entry("anna", "2026-11-03", 60, "Jour", "X99"), entry("anna", "2026-11-04", 60, "Ordinarie", "tid")],
    absences: [absence("anna", "VAB", "2026-11-05", "2026-11-05")],
  });
  assert.deepEqual(transactions.map((item) => [item.employeeNumber, item.date, item.code]), [["1001", "2026-11-04", "TID"]]);
  assert.deepEqual(errors, [
    "Bo Berg saknar anställningsnummer – 2 rader är inte med.",
    "Frånvarotypen VAB saknar exportkod – 1 rad är inte med.",
    "Koden X99 (tidstypen Jour) är ingen tidkod i PAXml – 1 rad är inte med.",
    "Tidstypen Restid saknar lönekod – 1 rad är inte med.",
  ]);
});

test("PAXml: an employee number longer than 12 characters is written and named as a warning", () => {
  const long: ExportPerson[] = [{ ...people[0], employeeNumber: "1234567890123" }, { ...people[2], employeeNumber: "123456789012" }];
  const { transactions, errors, warnings } = paxmlTransactions({ from: "2026-11-01", to: "2026-11-30", people: long,
    entries: [entry("anna", "2026-11-02", 60, "Ordinarie", "TID"), entry("anna", "2026-11-03", 60, "Ordinarie", "TID"), entry("cia", "2026-11-02", 60, "Ordinarie", "TID")] });
  assert.equal(transactions.length, 3, "nothing is left out");
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, ["Anna Anderssons anställningsnummer är längre än 12 tecken – kontrollera att lönesystemet tar emot det."], "once per person, 12 is fine");
});

test("PAXml: escaping, a whole day without fixed hours, decimals and ISO-8859-1 bytes", () => {
  const { transactions } = paxmlTransactions({ from: "2026-11-01", to: "2026-11-30", people, exportCodes: { SICK: "SJK" },
    absences: [absence("cia", "SICK", "2026-11-02", "2026-11-02"), absence("cia", "SICK", "2026-11-03", "2026-11-03", { hours: { start: "08:00", end: "10:20" } })] });
  const xml = paxmlDocument({ transactions, createdAt: "2026-12-01T08:30:00", company: "Ström & Söner €" });
  assert.match(xml, /<tidtrans anstid="A&amp;1">\r\n {6}<tidkod>SJK<\/tidkod>\r\n {6}<datum>2026-11-02<\/datum>\r\n {4}<\/tidtrans>/, "a whole day without fixed hours has no timmar");
  assert.match(xml, /<timmar>2\.33<\/timmar>/);
  assert.match(xml, /<foretagnamn>Ström &amp; Söner €<\/foretagnamn>/);
  assert.equal(xmlText(`a"b'c<d>\u0001`), "a&quot;b&apos;c&lt;d&gt;");
  assert.equal(paxmlHours(445), "7.42");
  const bytes = latin1Bytes("Ö€");
  assert.deepEqual([...bytes], [0xd6, ...Buffer.from("&#8364;", "ascii")]);
  assert.equal(paxmlTimeCode(" öt1 "), "ÖT1");
  assert.equal(paxmlTimeCode("OT1"), null);
  assert.deepEqual(paxmlPreviewRows(transactions)[0], ["A&1", "Cia <&> Ek", "2026-11-02", "SJK", "Hel dag", "Frånvaro: Sjuk"]);
});

test("PAXml: the preset template is valid and named for the format", () => {
  const preset = PRESET_TEMPLATES.find((item) => item.id === "preset-paxml")!;
  assert.equal(preset.name, "Löneunderlag (PAXml)");
  assert.equal(exportTemplateSchema.safeParse(preset).success, true);
  assert.equal(exportFileName(preset, "2026-11-01", "2026-11-30"), "loneunderlag-paxml-2026-11-01-2026-11-30.xml");
  assert.equal(exportTemplateSchema.safeParse({ ...preset, kind: "absence", rowsPer: "period" }).success, false, "PAXml is always time per person, day and type");
});

test("Months: only approved months are kept, an absence is cut at the month boundary, the rest is listed", () => {
  assert.deepEqual(monthsBetween("2026-11-15", "2027-01-02"), ["2026-11", "2026-12", "2027-01"]);
  const statusOf = monthStatusLookup([{ userId: "anna", period: "2026-11", status: "APPROVED" }, { userId: "anna", period: "2026-12", status: "SUBMITTED" }]);
  assert.equal(statusOf("bo", "2026-11"), "OPEN");
  const kept = onlyApprovedMonths({ statusOf,
    entries: [entry("anna", "2026-11-30", 60, "Ordinarie", "TID"), entry("anna", "2026-12-01", 60, "Ordinarie", "TID"), entry("bo", "2026-11-02", 60, "Ordinarie", "TID")],
    absences: [absence("anna", "VACATION", "2026-11-27", "2026-12-04")] });
  assert.deepEqual(kept.entries.map((item) => item.day), ["2026-11-30"]);
  assert.deepEqual(kept.absences.map((item) => [item.from, item.to]), [["2026-11-27", "2026-11-30"]]);
  assert.deepEqual(skippedWarnings(kept.skipped, people), [
    "Anna Andersson, 2026-12: månaden är inte godkänd (Inskickad) och är inte med.",
    "Bo Berg, 2026-11: månaden är inte godkänd (Öppen) och är inte med.",
  ]);
});

test("Löneunderlag: hours per type with code, approved absence per type in days and hours, totals and status", () => {
  const statusOf = monthStatusLookup([{ userId: "anna", period: "2026-11", status: "APPROVED" }]);
  const basis = payrollBasis({ from: "2026-11-01", to: "2026-11-30", people, statusOf, exportCodes: { VACATION: "SEM" },
    entries: [entry("anna", "2026-11-02", 480, "Ordinarie", "TID"), entry("anna", "2026-11-03", 450, "Ordinarie", "TID"), entry("anna", "2026-11-03", 60, "Restid", ""), entry("anna", "2026-12-01", 480, "Ordinarie", "TID")],
    absences: [absence("anna", "VACATION", "2026-11-06", "2026-11-09"), absence("anna", "SICK", "2026-11-10", "2026-11-10", { status: "APPLIED" }), absence("bo", "LEAVE", "2026-11-11", "2026-11-11", { hours: { start: "13:00", end: "15:00" } })] });
  assert.deepEqual(basis.map((person) => person.name), ["Anna Andersson", "Bo Berg"]);
  const [anna, bo] = basis;
  assert.deepEqual(anna.worked, [{ timeType: "Ordinarie", code: "TID", minutes: 930, workingTime: true }, { timeType: "Restid", code: "", minutes: 60, workingTime: true }]);
  assert.deepEqual(anna.absence, [{ type: "VACATION", label: "Semester", code: "SEM", days: 2, minutes: 960 }]);
  assert.equal(anna.workedMinutes, 990);
  assert.equal(basisStatusText(anna), "Godkänd");
  assert.equal(basisStatusText(bo), "Öppen");
  assert.deepEqual(bo.absence, [{ type: "LEAVE", label: "Ledig", code: "", days: 1, minutes: 120 }]);
  assert.deepEqual(basisGaps(basis), ["Anna Andersson: tidstypen Restid saknar lönekod.", "Bo Berg saknar anställningsnummer.", "Bo Berg: frånvarotypen Ledig saknar exportkod."]);
  assert.deepEqual(basisRows([anna]), [
    ["1001", "Anna Andersson", "Godkänd", "Arbetad tid", "Ordinarie", "TID", "", "15,50"],
    ["1001", "Anna Andersson", "Godkänd", "Arbetad tid", "Restid", "", "", "1,00"],
    ["1001", "Anna Andersson", "Godkänd", "Frånvaro", "Semester", "SEM", "2", "16,00"],
    ["1001", "Anna Andersson", "Godkänd", "Summa arbetad tid", "", "", "", "16,50"],
    ["1001", "Anna Andersson", "Godkänd", "Summa frånvaro", "", "", "2", "16,00"],
  ]);
  const csv = Buffer.from(basisCsv([anna])).toString("utf8");
  assert.ok(csv.startsWith("﻿Anställningsnummer;Namn;Månadsstatus;Slag;Typ;Kod;Dagar;Timmar\r\n"));
  const twoMonths = payrollBasis({ from: "2026-11-01", to: "2026-12-31", people, statusOf, entries: [entry("anna", "2026-12-01", 60, "Ordinarie", "TID")], absences: [] });
  assert.equal(basisStatusText(twoMonths[0]), "2026-11 Godkänd, 2026-12 Öppen");
});

test("Löneunderlag: the PDF is drawn with the report kit", async () => {
  const fontBytes = new Uint8Array(await readFile(path.join(process.cwd(), "public/fonts/DejaVuSans.ttf")));
  const basis = payrollBasis({ from: "2026-11-01", to: "2026-11-30", people, statusOf: () => "APPROVED", entries: [entry("anna", "2026-11-02", 480, "Ordinarie", "TID")], absences: [] });
  const bytes = await createBasisPdf({ identity: { company: "Elfirman AB" }, fontBytes, from: "2026-11-01", to: "2026-11-30", people: basis, onlyApproved: true, warnings: ["Bo Berg saknar anställningsnummer."], createdAt: new Date("2026-12-01T08:00:00Z") });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("latin1"), "%PDF-");
});
