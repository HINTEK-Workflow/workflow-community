import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { blankControl } from "../lib/kfid/model";
import { createExcelReport } from "../lib/kfid/report-core";
import {
  DEFAULT_REPORT_BRANDING,
  reportBranding,
} from "../lib/kfid/report-branding";

test("report branding normalizes colors and retains the HINTEK default", () => {
  assert.deepEqual(reportBranding(), DEFAULT_REPORT_BRANDING);
  assert.deepEqual(
    reportBranding({ primary: "#abcdef", accent: "#123456", soft: "#fedcba" }),
    { primary: "#ABCDEF", accent: "#123456", soft: "#FEDCBA" },
  );
  assert.throws(() => reportBranding({ primary: "orange" }));
});

test("Excel report applies the registered company name and document colors", async () => {
  const bytes = await createExcelReport(blankControl(), {
    company: "Färgbolaget AB",
    branding: { primary: "#112233", accent: "#445566", soft: "#DDEEFF" },
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.getWorksheet("Grunduppgifter");
  assert.ok(sheet);
  assert.equal(sheet.getCell("A1").value, "Kontrollprotokoll");
  const fill = sheet.getCell("A1").fill;
  assert.equal(fill.type, "pattern");
  if (fill.type === "pattern")
    assert.equal(fill.fgColor?.argb, "FF112233");
  assert.equal(sheet.getCell("A2").value, "Färgbolaget AB");
});
