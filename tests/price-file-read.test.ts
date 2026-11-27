// Prisfiler etapp 1 (2026-10-12): reading price files as a stream – encoding, separated columns across chunk
// boundaries, headerless files, fixed width and Excel – with made-up files only (never a supplier's data).
import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { CsvStream, detectEncoding, isValidUtf8, sniffLayout } from "../lib/catalogue/file/text";
import { cleanStarts, parseStarts, splitFixed, suggestFixedStarts } from "../lib/catalogue/file/fixed-width";
import { looksLikeHeader, openPriceFile, priceFileFromGrid, uniqueHeaders } from "../lib/catalogue/file/open";
import { columnIndex, serialDate } from "../lib/catalogue/file/xlsx";
import { CatalogueRowParser } from "../lib/catalogue/model";

const latin1 = (text: string) => Uint8Array.from([...text].map((char) => char.charCodeAt(0) & 0xff));
const utf8 = (text: string) => new TextEncoder().encode(text);
const all = async (file: Awaited<ReturnType<typeof openPriceFile>>) => { const rows = []; for await (const row of file.rows()) rows.push(row); return rows; };

test("the encoding: UTF-8 when valid, otherwise Windows-1252; a byte order mark decides", () => {
  assert.equal(isValidUtf8(utf8("Kabel å ä ö")), true);
  assert.equal(isValidUtf8(latin1("Kabel å ä ö")), false);
  assert.equal(isValidUtf8(Uint8Array.from([0x41, 0xc3])), false, "a sequence cut off at the end");
  assert.equal(detectEncoding(latin1("Dosa ö")).encoding, "windows-1252");
  assert.equal(detectEncoding(utf8("Dosa ö")).encoding, "utf-8");
  assert.deepEqual(detectEncoding(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), { encoding: "utf-8", bom: 3 });
});

test("CSV fed in pieces: quotes across boundaries, inch marks, CR CR LF and empty lines", () => {
  const text = "A;B;C\r\r\n1;\"Rör 1/2\"\"\";9,5\r\n\r\n2;Mät 3/4\" rör;1\n3;\"Med ;semikolon\";2\r\n4;\"\"\"citat\"\"\";3";
  // Every split position: the result must never depend on where a piece ends.
  for (let size = 1; size <= text.length; size++) {
    const parser = new CsvStream(";");
    const rows: string[][] = [];
    for (let offset = 0; offset < text.length; offset += size) for (const row of parser.feed(text.slice(offset, offset + size))) rows.push(row.cells);
    for (const row of parser.end()) rows.push(row.cells);
    assert.deepEqual(rows, [["A", "B", "C"], ["1", "Rör 1/2\"", "9,5"], ["2", "Mät 3/4\" rör", "1"], ["3", "Med ;semikolon", "2"], ["4", "\"citat\"", "3"]], `piece size ${size}`);
  }
});

test("the layout: separated columns, fixed width, or plain text", () => {
  assert.deepEqual(sniffLayout("a;b;c\n1;2;3\n4;5;6\n"), { kind: "delimited", separator: ";" });
  assert.deepEqual(sniffLayout("a\tb\n1\t2\n3\t4\n"), { kind: "delimited", separator: "\t" });
  const fixed = Array.from({ length: 30 }, (_, index) => `${String(index).padEnd(10)}${String(index * 3).padStart(8, "0")}NAMN ${index}`.padEnd(40)).join("\r\r\n");
  assert.deepEqual(sniffLayout(fixed), { kind: "fixed", lineLength: 40 });
  assert.deepEqual(sniffLayout("Hej,\n\nhär är en rapport om dagens arbete.\nMvh\n"), { kind: "text" });
});

test("a Windows-1252 CSV with headings is read row by row with its row numbers; a shifted row is seen", async () => {
  const text = "Artnr;Benämning;Enhet;Pris\r\n0001234;Kabel påhittad;M;12,50\r\n0001235;Dosa ;med semikolon;ST;3,00\r\n\r\n0001236;Rör;ST;7\r\n";
  const file = await openPriceFile(latin1(text), "lista.csv");
  assert.equal(file.info.kind, "delimited");
  assert.equal(file.info.encoding, "windows-1252");
  assert.equal(file.info.hasHeader, true);
  assert.deepEqual(file.info.headers, ["Artnr", "Benämning", "Enhet", "Pris"]);
  const rows = await all(file);
  assert.deepEqual(rows.map((row) => row.line), [2, 3, 4], "lines with content, the heading is line 1");
  assert.deepEqual(rows[0].cells, ["0001234", "Kabel påhittad", "M", "12,50"], "leading zeros stay");
  assert.equal(rows[1].width, 5, "the row with a stray separator has five fields");
  const parser = new CatalogueRowParser(file.info.headers, { articleNo: "Artnr", name: "Benämning", unit: "Enhet", price: "Pris" }, "2026-10-12");
  for (const row of rows) parser.push(row.line, row.cells, row.width);
  assert.equal(parser.accepted, 2);
  assert.equal(parser.errorsByKind.shifted, 1);
  assert.match(parser.errors[0].message, /raden har 5 fält men rubriken 4/);
});

test("a file without a heading row (a discount list) is read with numbered columns and can be mapped by hand", async () => {
  const text = "AB12;105;\r\nAB13;250;\r\nCD01;765;\r\n";
  const file = await openPriceFile(latin1(text), "rabatt.txt");
  assert.equal(file.info.hasHeader, false);
  assert.deepEqual(file.info.headers, ["Kolumn 1", "Kolumn 2"], "the trailing separator gives no column");
  assert.equal((await all(file)).length, 3, "the first row is data");
  assert.equal(file.info.fingerprint, "utan-rubrik:2");
  const forced = await openPriceFile(latin1(text), "rabatt.txt", { header: "yes" });
  assert.equal(forced.info.hasHeader, true, "the person may still say the first row is headings");
  assert.equal(looksLikeHeader(["Artikelnummer", "Pris"], [["1", "2,50"]]), true);
  assert.equal(looksLikeHeader(["12", "3,50"], [["13", "2,50"], ["14", "1,00"]]), false);
  assert.deepEqual(uniqueHeaders(["Pris", "pris", ""]), ["Pris", "pris (2)", "Kolumn 3"]);
});

test("fixed width: the columns are suggested from the characters, prices in hundredths are kept as digits", async () => {
  const lines: string[] = [];
  for (let index = 0; index < 400; index++) {
    const article = String(100000 + index * 7).padEnd(12);
    const price = String(1234 + index * 11).padStart(10, "0");
    const unit = ["ST", "M", "FP", "PAR", "KG", "RLE"][index % 6].padEnd(3);
    const flag = index % 2 ? "J" : "N";
    const name = `${["Kabel", "Dosa", "Rör", "Skruv", "Brytare", "Lampa", "Klämma"][index % 7]} ${["vit", "grå", "svart", "stor", "liten"][index % 5]} ${index}`.padEnd(30);
    lines.push(`${article}${price}${unit}${flag}${name}`);
  }
  const length = lines[0].length;
  assert.equal(length, 56);
  const starts = suggestFixedStarts(lines, length);
  assert.deepEqual(starts, [1, 13, 23, 26, 27], "article, price, unit, flag, name");
  assert.deepEqual(splitFixed(lines[1], starts), ["100007", "0000001245", "M", "J", "Dosa grå 1"]);
  assert.deepEqual(cleanStarts([21, 1, 21, 500, 0], 56), [1, 21]);
  assert.deepEqual(parseStarts("1, 13;23  26"), [1, 13, 23, 26]);
  const file = await openPriceFile(latin1(lines.join("\r\r\n")), "lista.txt");
  assert.equal(file.info.kind, "fixed");
  assert.equal(file.info.hasHeader, false);
  assert.deepEqual(file.info.headers, ["Tecken 1–12", "Tecken 13–22", "Tecken 23–25", "Tecken 26–26", "Tecken 27–56"]);
  assert.equal(file.info.fingerprint, "fast:56");
  const rows = await all(file);
  assert.equal(rows.length, 400, "CR CR LF does not give empty rows");
  const parser = new CatalogueRowParser(file.info.headers, { articleNo: "Tecken 1–12", price: "Tecken 13–22", unit: "Tecken 23–25", name: "Tecken 27–56" }, "2026-10-12", { priceScale: 100 });
  const first = parser.push(rows[0].line, rows[0].cells, rows[0].width)!;
  assert.equal(first.amount, 12.34, "skala 100: 0000001234 → 12,34");
  const other = await openPriceFile(latin1(lines.join("\n")), "lista.txt", { fixedStarts: [1, 13, 27] });
  assert.deepEqual(other.info.headers, ["Tecken 1–12", "Tecken 13–26", "Tecken 27–56"], "the person's positions are used");
});

test("Excel is read as a stream: shared strings, numbers, dates, text with leading zeros and many rows", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Artiklar");
  sheet.addRow(["Artnr", "Artben", "Sortkod", "Gnp", "Gdatum", "Giltig"]);
  for (let index = 0; index < 12_000; index++) sheet.addRow([String(index).padStart(7, "0"), `Påhittad vara ${index % 500} & <x>`, index % 2 ? "ST" : "M", 1.25 + index, "20261001", new Date(Date.UTC(2026, 9, 1))]);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  const file = await openPriceFile(new Uint8Array(buffer), "lista.xlsx");
  assert.equal(file.info.kind, "xlsx");
  assert.equal(file.info.sheet, "Artiklar");
  assert.deepEqual(file.info.headers, ["Artnr", "Artben", "Sortkod", "Gnp", "Gdatum", "Giltig"]);
  const rows = await all(file);
  assert.equal(rows.length, 12_000, "every row, also across the pieces of the inflated sheet");
  assert.deepEqual(rows[0].cells, ["0000000", "Påhittad vara 0 & <x>", "M", "1.25", "20261001", "2026-10-01"]);
  assert.equal(rows[11_999].line, 12_001);
  assert.equal(rows[11_999].cells[1], "Påhittad vara 499 & <x>");
  assert.equal(columnIndex("A"), 0);
  assert.equal(columnIndex("AB"), 27);
  assert.equal(serialDate(46296), "2026-10-01");
});

test("a large made-up list (300 000 rows) streams through the parser within seconds and bounded memory", async () => {
  const parts = ["Artikelnummer;Benämning;Enhet;Pris\r\n"];
  for (let index = 0; index < 300_000; index++) parts.push(`P${String(index).padStart(7, "0")};Påhittad artikel nummer ${index};ST;${(index % 900) + 1},25\r\n`);
  const bytes = latin1(parts.join(""));
  parts.length = 0;
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const started = Date.now();
  const file = await openPriceFile(bytes, "stor.csv");
  const parser = new CatalogueRowParser(file.info.headers, { articleNo: "Artikelnummer", name: "Benämning", unit: "Enhet", price: "Pris" }, "2026-10-12");
  let peak = 0;
  for await (const row of file.rows()) {
    parser.push(row.line, row.cells, row.width);
    if (row.line % 50_000 === 0) peak = Math.max(peak, process.memoryUsage().heapUsed - before);
  }
  assert.equal(parser.accepted, 300_000);
  assert.equal(parser.errorCount, 0);
  assert.ok(Date.now() - started < 30_000, "read and checked within seconds");
  // The rows are never held: what grows is the set of article numbers seen (for duplicates), far below the file as a grid.
  assert.ok(peak < 400_000_000, `heap growth ${Math.round(peak / 1e6)} MB`);
});

test("a table in memory (the API's rows) reads like a file", async () => {
  const file = priceFileFromGrid("api.csv", ["Artikelnummer", "Benämning", "Pris"], [["A-1", "Dosa", "4"], ["", "", ""], ["A-2", "Kabel", "5"]]);
  assert.deepEqual((await all(file)).map((row) => row.line), [2, 4]);
});
