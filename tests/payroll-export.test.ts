import assert from "node:assert/strict";
import test from "node:test";
import { delimitedText, encodeText, exportCodeOf, exportFileName, exportRows, exportTemplateSchema, formatDate, headerRow, PRESET_TEMPLATES, type ExportTemplate } from "../lib/payroll/export";
import { adapterAbsencesAsTable, adapterFor, mockAdapter, AdapterUnavailable } from "../lib/payroll/adapters";
import { contentHash, isBlockedHost, memoryTransport, runSftpExport, runSftpImport, sftpReady, sftpSettingsSchema, createSftpTransport, withRetry } from "../lib/payroll/transport";
import { mapFields } from "../lib/import/detect";
import { ABSENCE_FIELDS } from "../lib/payroll/fields";
import { previewAbsenceImport, readAbsenceRows } from "../lib/payroll/absence-import";

const people = [
  { userId: "anna", name: "Anna Andersson", email: "anna@example.invalid", employeeNumber: "1001", weeklyWorkMinutes: 2400 },
  { userId: "bo", name: "=Bo Berg", email: "bo@example.invalid", employeeNumber: null, weeklyWorkMinutes: 1200 },
];
const preset = (id: string) => PRESET_TEMPLATES.find((item) => item.id === id)!;
const template = (patch: Partial<ExportTemplate>): ExportTemplate => ({ ...preset("preset-absence-period"), ...patch });

test("Export: absence per period is clipped to the period and counts only workdays and the person's own day", () => {
  const rows = exportRows({ template: template({ columns: [{ field: "employeeNumber", header: "", value: "" }, { field: "code", header: "", value: "" }, { field: "from", header: "", value: "" }, { field: "to", header: "", value: "" }, { field: "hours", header: "", value: "" }] }),
    from: "2026-11-01", to: "2026-11-30", people, exportCodes: { VACATION: "SEM" },
    absences: [
      { userId: "anna", type: "VACATION", note: "", from: "2026-10-28", to: "2026-11-03", hours: null, status: "APPROVED", sourceLabel: "Workflow", externalCode: null },
      { userId: "bo", type: "SICK", note: "", from: "2026-11-04", to: "2026-11-04", hours: null, status: "APPROVED", sourceLabel: "Flex HRM", externalCode: "SJK" },
      { userId: "anna", type: "LEAVE", note: "", from: "2026-11-10", to: "2026-11-10", hours: { start: "10:00", end: "12:00" }, status: "APPLIED", sourceLabel: "Workflow", externalCode: null },
    ] });
  // Anna: 1–3 Nov is Sun–Tue → two workdays of 8 h; Bo works half time → 4 h; the applied leave is left out.
  const byNumber = [...rows].sort((a, b) => b[0].localeCompare(a[0]));
  assert.deepEqual(byNumber, [["1001", "SEM", "2026-11-01", "2026-11-03", "16,00"], ["", "SJK", "2026-11-04", "2026-11-04", "4,00"]]);
});

test("Export: one row per workday, part of a day as hours, date format and decimal point as chosen", () => {
  const rows = exportRows({ template: template({ rowsPer: "day", dateFormat: "YYYYMMDD", decimal: ".", statuses: ["APPROVED", "APPLIED"], columns: [{ field: "date", header: "", value: "" }, { field: "hours", header: "", value: "" }, { field: "fixed", header: "Typ", value: "FRV" }] }),
    from: "2026-11-01", to: "2026-11-30", people,
    absences: [{ userId: "anna", type: "VACATION", note: "", from: "2026-11-06", to: "2026-11-09", hours: null, status: "APPROVED", sourceLabel: "", externalCode: null },
      { userId: "anna", type: "LEAVE", note: "", from: "2026-11-10", to: "2026-11-10", hours: { start: "10:00", end: "11:30" }, status: "APPLIED", sourceLabel: "", externalCode: null }] });
  assert.deepEqual(rows, [["20261106", "8.00", "FRV"], ["20261109", "8.00", "FRV"], ["20261110", "1.50", "FRV"]]);
});

test("Export: worked time per entry and per day are separate files and never add up absence", () => {
  const entries = [
    { userId: "anna", day: "2026-11-02", seconds: 3600, project: "Elvägen", workOrder: "Byte central", customer: "Elkraft AB", timeType: "Ordinarie", timeTypeCode: "" },
    { userId: "anna", day: "2026-11-02", seconds: 5400, project: "", workOrder: "Felsökning", customer: "", timeType: "Ordinarie", timeTypeCode: "" },
    { userId: "anna", day: "2026-12-01", seconds: 3600, project: "", workOrder: "Senare", customer: "", timeType: "Ordinarie", timeTypeCode: "" },
  ];
  const perEntry = exportRows({ template: preset("preset-worked-entry"), from: "2026-11-01", to: "2026-11-30", people, entries });
  assert.equal(perEntry.length, 2);
  assert.deepEqual(perEntry[0].slice(2, 7), ["2026-11-02", "1,00", "Ordinarie", "", "Elvägen"]);
  const perDay = exportRows({ template: preset("preset-worked-day"), from: "2026-11-01", to: "2026-11-30", people, entries,
    absences: [{ userId: "anna", type: "SICK", note: "", from: "2026-11-02", to: "2026-11-02", hours: null, status: "APPROVED", sourceLabel: "", externalCode: null }] });
  assert.deepEqual(perDay, [["1001", "Anna Andersson", "2026-11-02", "2,50"]], "the day's total; the absence is not in a worked-time file");
});

test("Export: people can be chosen; a name that looks like a formula is neutralised; the time code falls back to the imported one", () => {
  const rows = exportRows({ template: template({ columns: [{ field: "name", header: "", value: "" }] }), from: "2026-11-01", to: "2026-11-30", people, userIds: ["bo"],
    absences: [{ userId: "bo", type: "SICK", note: "", from: "2026-11-04", to: "2026-11-04", hours: null, status: "APPROVED", sourceLabel: "", externalCode: null },
      { userId: "anna", type: "SICK", note: "", from: "2026-11-04", to: "2026-11-04", hours: null, status: "APPROVED", sourceLabel: "", externalCode: null }] });
  assert.deepEqual(rows, [["'=Bo Berg"]]);
  assert.equal(exportCodeOf({ type: "SICK", externalCode: "S9" }, {}), "S9");
  assert.equal(exportCodeOf({ type: "SICK", externalCode: "S9" }, { SICK: "SJ" }), "SJ");
});

test("Export: CSV/TSV writing, encodings, headings, file names and template checks", () => {
  assert.equal(delimitedText([["a;b", "c\"d", "e"], ["1", "2", "3"]], ";"), "\"a;b\";\"c\"\"d\";e\r\n1;2;3\r\n");
  assert.equal(delimitedText([["a\tb", "c"]], "\t"), "\"a\tb\"\tc\r\n");
  assert.deepEqual([...encodeText("åÄ€", "windows-1252")], [0xe5, 0xc4, 0x80]);
  assert.deepEqual([...encodeText("✓", "windows-1252")], [0x3f], "a character ANSI lacks becomes ?");
  assert.deepEqual([...encodeText("a", "utf-8-bom")], [0xef, 0xbb, 0xbf, 0x61]);
  assert.equal(formatDate("2026-11-02", "DD.MM.YYYY"), "02.11.2026");
  assert.equal(formatDate("2026-11-02", "YYMMDD"), "261102");
  assert.deepEqual(headerRow(template({ columns: [{ field: "employeeNumber", header: "AnstNr", value: "" }, { field: "code", header: "", value: "" }] })), ["AnstNr", "Tidkod"]);
  assert.equal(exportFileName(preset("preset-absence-day"), "2026-11-01", "2026-11-30"), "franvaro-per-dag-tsv-2026-11-01-2026-11-30.txt");
  for (const item of PRESET_TEMPLATES) assert.ok(exportTemplateSchema.safeParse(item).success, item.id);
  assert.equal(exportTemplateSchema.safeParse({ ...preset("preset-worked-day"), rowsPer: "period" }).success, false, "worked time is never per period");
  assert.equal(exportTemplateSchema.safeParse({ ...preset("preset-absence-period"), columns: [{ field: "project" }] }).success, false, "an absence file has no project column");
});

test("SFTP: hosts on the inside are refused; the settings need a host key; no client is installed yet", () => {
  for (const host of ["localhost", "127.0.0.1", "10.0.0.10", "192.168.1.5", "172.20.0.1", "169.254.1.1", "::1", "fd00::1", "db.internal", "bad host", "x"]) assert.equal(isBlockedHost(host), true, host);
  for (const host of ["sftp.example.se", "195.67.1.10"]) assert.equal(isBlockedHost(host), false, host);
  assert.equal(sftpSettingsSchema.safeParse({ host: "10.0.0.1" }).success, false);
  assert.equal(sftpSettingsSchema.safeParse({ importDir: "../etc" }).success, false);
  assert.equal(sftpReady(sftpSettingsSchema.parse({ host: "sftp.example.se", username: "hintek" })), false, "the host key is required");
  assert.equal(sftpReady(sftpSettingsSchema.parse({ host: "sftp.example.se", username: "hintek", hostKey: "SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" })), true);
  assert.equal(createSftpTransport(sftpSettingsSchema.parse({}), "secret"), null);
});

test("SFTP: a file is imported once, interrupted reads are retried, big files and other kinds are skipped, handled files are moved", async () => {
  const bytes = new TextEncoder().encode("Anst.nr;Frånvarokod;Från\n1001;Semester;2026-11-02\n");
  const transport = memoryTransport({ "in/a.csv": bytes, "in/b.csv": bytes, "in/notes.pdf": bytes, "in/big.csv": new Uint8Array(10_000_001) }, { failReads: 2 });
  const seen = new Set<string>();
  const imported: string[] = [];
  const settings = sftpSettingsSchema.parse({ host: "sftp.example.se", username: "u", importDir: "in", hostKey: "SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" });
  const lines = await runSftpImport({ transport, settings, pause: async () => undefined,
    alreadyImported: async (hash) => seen.has(hash),
    importFile: async (name, _data, hash) => { imported.push(name); seen.add(hash); return { ok: true, message: "1 ny" }; } });
  assert.deepEqual(imported, ["a.csv"], "b.csv has the same content and is not imported again");
  assert.deepEqual(lines.map((line) => [line.file, line.status]), [["a.csv", "imported"], ["b.csv", "skipped"], ["big.csv", "failed"]]);
  assert.ok(transport.files.has("in/hintek-klar/a.csv") && transport.files.has("in/hintek-klar/b.csv"), "handled files are moved aside");
  assert.equal(contentHash(bytes).length, 64);
  // A broken connection when listing fails the run after its retries.
  await assert.rejects(runSftpImport({ transport: memoryTransport({}, { failList: true }), settings, pause: async () => undefined, alreadyImported: async () => false, importFile: async () => ({ ok: true, message: "" }) }));
  // An import that fails leaves the file where it was, for the next run.
  const stay = memoryTransport({ "in/c.csv": bytes });
  const failed = await runSftpImport({ transport: stay, settings, pause: async () => undefined, alreadyImported: async () => false, importFile: async () => ({ ok: false, message: "Okänd kod" }) });
  assert.equal(failed[0].status, "failed");
  assert.ok(stay.files.has("in/c.csv"));
});

test("SFTP: an export is written as .part and renamed; an interrupted write is retried", async () => {
  const transport = memoryTransport({}, { failWrites: 2 });
  const settings = sftpSettingsSchema.parse({ exportDir: "out" });
  const target = await runSftpExport({ transport, settings, fileName: "franvaro.csv", bytes: new Uint8Array([1, 2]), pause: async () => undefined });
  assert.equal(target, "out/franvaro.csv");
  assert.deepEqual([...transport.files.keys()], ["out/franvaro.csv"]);
  await assert.rejects(withRetry(async () => { throw new Error("nej"); }, 2, async () => undefined), /nej/);
});

test("API: Flex HRM is a switched-off placeholder; a provider's answer goes through the same preview as a file", async () => {
  const flex = adapterFor("flex_hrm");
  assert.equal(flex.available, false);
  await assert.rejects(flex.absences({ from: "2026-11-01", to: "2026-11-30" }), AdapterUnavailable);
  await assert.rejects(mockAdapter({ fail: "timeout" }).absences({ from: "2026-11-01", to: "2026-11-30" }), /Tidsgränsen/);
  const answer = await mockAdapter({ absences: [{ externalId: "77", employeeNumber: "1001", code: "Semester", from: "2026-11-02", to: "2026-11-03", hours: null, status: "APPROVED", changedAt: null }] }).absences({ from: "2026-11-01", to: "2026-11-30" });
  const table = adapterAbsencesAsTable(answer);
  const file = { name: "api", mimeType: "application/json", size: 0, kind: "table" as const, ...table };
  const preview = previewAbsenceImport({ rows: readAbsenceRows(file, mapFields(ABSENCE_FIELDS, table.headers)), members: [{ userId: "anna", name: "Anna", email: "a@example.invalid", employeeNumber: "1001", weeklyWorkMinutes: 2400 }], existing: [], codeMap: {}, systemKey: "flex_hrm" });
  assert.equal(preview.counts.new, 1);
  assert.equal(preview.rows[0].key, "flex_hrm:id:77");
});
