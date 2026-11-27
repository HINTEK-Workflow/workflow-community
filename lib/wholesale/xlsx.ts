import ExcelJS from "exceljs";
import type { ExportLine } from "./prepare";
import { sheetRows } from "./format";
import type { WholesalerId } from "./model";

/**
 * The Excel file of an export (2026-10-12): one sheet, two columns in the wholesaler's order, nothing else (no
 * sums, no extra rows). The article column is written as TEXT cells (number format "@"), so leading zeros stay and a
 * value such as "=1+1" is a string, never a formula; the quantity is a number. Runs in the browser (like the Local
 * workspace's other Excel exports) so Cloud and Local make it the same way and nothing is sent anywhere.
 */
export async function createWholesaleWorkbook(lines: readonly ExportLine[], wholesaler: WholesalerId): Promise<Uint8Array> {
  const { header, rows, articleColumn } = sheetRows(lines, wholesaler);
  const book = new ExcelJS.Workbook();
  book.creator = "Workflow";
  book.created = new Date();
  const sheet = book.addWorksheet("Beställning");
  const quantityColumn = articleColumn === 1 ? 2 : 1;
  sheet.getColumn(articleColumn).width = 28;
  sheet.getColumn(quantityColumn).width = 14;
  sheet.getColumn(articleColumn).numFmt = "@";
  let rowNumber = 1;
  if (header) {
    const first = sheet.getRow(rowNumber++);
    first.getCell(articleColumn).value = header[0];
    first.getCell(quantityColumn).value = header[1];
    first.font = { bold: true };
  }
  for (const row of rows) {
    const current = sheet.getRow(rowNumber++);
    const article = current.getCell(articleColumn);
    article.numFmt = "@";
    // A plain string value: ExcelJS writes it as a shared string (a text cell), never as a formula.
    article.value = row.article;
    article.alignment = { horizontal: "left" };
    const quantity = current.getCell(quantityColumn);
    quantity.value = row.quantity;
    quantity.numFmt = "0";
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}
