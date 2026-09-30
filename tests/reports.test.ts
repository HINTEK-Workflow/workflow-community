import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { blankControl, visualFields } from "../lib/kfid/model";
import { excelReport, pdfReport } from "../lib/kfid/reports";

function representativeControl() {
  const data = blankControl();
  data.active.iso = true;
  data.active.vis = true;
  data.meta.autoOn = true;
  data.meta = {
    ...data.meta,
    proj: "Central ÅÄÖ",
    perf: "Montör",
    ctrl: "Granskare",
    client: "Beställare",
    addr: "bestallare@example.com",
    instr: "Installationstestare",
    sn: "SN-123",
    cal: "2026-01-15",
  };
  data.iso.rows = [
    {
      uid: "iso-report-1",
      objekt: "Grupp 1",
      u: "500 V",
      mohm: 2,
      limit: 1,
      ok: true,
      comment: "Godkänd mätning",
    },
  ];
  data.vis.checks = Object.fromEntries(
    visualFields.map((field) => [field.key, true]),
  );
  return data;
}

async function workbookRows(bytes: Uint8Array, sheetName: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.getWorksheet(sheetName);
  assert.ok(sheet, `Arbetsbladet ${sheetName} saknas.`);
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    rows.push(
      (row.values as unknown[])
        .slice(1)
        .map((value) => String(value ?? "")),
    );
  });
  return rows;
}

test("PDF and XLSX reports accept representative Swedish control data", async () => {
  const data = representativeControl();
  const identity = {
    company: "HINTEK Test",
    branding: { primary: "#174C72", accent: "#2E7EAA", soft: "#EDF5F9" },
  };
  const pdfBytes = await pdfReport(data, identity, []);
  assert.equal(Buffer.from(pdfBytes).subarray(0, 5).toString(), "%PDF-");
  assert.ok((await PDFDocument.load(pdfBytes)).getPageCount() >= 2);

  const rows = await workbookRows(
    await excelReport(data, identity, false, 1),
    "Isolation",
  );
  assert.ok(rows.some((row) => row.includes("Grupp 1")));
  assert.ok(rows.some((row) => row.includes("Godkänd mätning")));
});

test("XLSX completion summary uses the actual attachment count", async () => {
  const data = representativeControl();
  const withoutFiles = await workbookRows(
    await excelReport(data, { company: "HINTEK Test" }, false, 0),
    "Sammanfattning",
  );
  assert.ok(
    withoutFiles.some(
      (row) =>
        row[0] === "Observera" && row[1]?.includes("saknar bilder eller dokument"),
    ),
  );

  const withFile = await workbookRows(
    await excelReport(data, { company: "HINTEK Test" }, false, 1),
    "Sammanfattning",
  );
  assert.equal(
    withFile.some((row) => row[1]?.includes("saknar bilder eller dokument")),
    false,
  );
});

test("PDF repeats readable tables over dynamic page breaks", async () => {
  const data = representativeControl();
  data.iso.rows = Array.from({ length: 80 }, (_, index) => ({
    uid: `iso-${index}`,
    objekt: `Grupp ${index + 1} med en längre beskrivning`,
    u: "500 V",
    mohm: 2 + index / 10,
    limit: 1,
    ok: true,
    comment: "Kontrollerad utan anmärkning",
  }));
  const bytes = await pdfReport(
    data,
    { company: "HINTEK Test" },
    [],
  );
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 5);
});
