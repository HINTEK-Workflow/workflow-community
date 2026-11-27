import { Readable } from "node:stream";
import { createInflateRaw, inflateRawSync } from "node:zlib";

/**
 * Excel (xlsx) read as a stream (prisfil 2026-10-12). Loading a supplier's 16 MB workbook with ExcelJS took about
 * 2.3 GB of memory, and ExcelJS's own streaming reader stopped on one supplier's file ("invalid signature": it reads
 * the zip from the front and trusts the local headers). This reader finds the parts through the zip's central
 * directory, inflates the sheet piece by piece and turns each <row> into cells as it arrives; only the shared strings
 * (the texts the sheet points to) are kept in memory. Pure Node, no package.
 */

type ZipEntry = { name: string; method: number; compressedSize: number; size: number; localOffset: number };

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export class XlsxError extends Error {}

function readU64(buffer: Buffer, offset: number) {
  return Number(buffer.readBigUInt64LE(offset));
}

/** The zip's entries from its central directory (zip64 included). */
export function zipEntries(buffer: Buffer): Map<string, ZipEntry> {
  const from = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= from; offset--) if (buffer.readUInt32LE(offset) === EOCD) { eocd = offset; break; }
  if (eocd < 0) throw new XlsxError("Filen är inte en Excel-fil (zip saknas).");
  let count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if ((count === 0xffff || offset === 0xffffffff) && eocd >= 20 && buffer.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) {
    const record = readU64(buffer, eocd - 20 + 8);
    if (buffer.readUInt32LE(record) !== ZIP64_EOCD) throw new XlsxError("Excel-filens zip64-katalog kan inte läsas.");
    count = readU64(buffer, record + 32);
    offset = readU64(buffer, record + 48);
  }
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count && offset + 46 <= buffer.length; index++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL) throw new XlsxError("Excel-filens innehållsförteckning kan inte läsas.");
    const method = buffer.readUInt16LE(offset + 10);
    let compressedSize = buffer.readUInt32LE(offset + 20);
    let size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    let localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    // Zip64 sizes and offsets are in the extra field (id 0x0001), in this order, only for the values that overflowed.
    if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      let extra = offset + 46 + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = buffer.readUInt16LE(extra);
        const length = buffer.readUInt16LE(extra + 2);
        if (id === 0x0001) {
          let field = extra + 4;
          if (size === 0xffffffff) { size = readU64(buffer, field); field += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = readU64(buffer, field); field += 8; }
          if (localOffset === 0xffffffff) { localOffset = readU64(buffer, field); }
          break;
        }
        extra += 4 + length;
      }
    }
    entries.set(name, { name, method, compressedSize, size, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entryData(buffer: Buffer, entry: ZipEntry): Buffer {
  if (buffer.readUInt32LE(entry.localOffset) !== LOCAL) throw new XlsxError(`Excel-filens del ${entry.name} kan inte läsas.`);
  const start = entry.localOffset + 30 + buffer.readUInt16LE(entry.localOffset + 26) + buffer.readUInt16LE(entry.localOffset + 28);
  return buffer.subarray(start, start + entry.compressedSize);
}

/** A small part (workbook, relations, styles) inflated at once; at most 20 MB. */
function readPart(buffer: Buffer, entries: Map<string, ZipEntry>, name: string): string | null {
  const entry = entries.get(name);
  if (!entry) return null;
  const data = entryData(buffer, entry);
  if (entry.method === 0) return data.toString("utf8");
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: 20_000_000 }).toString("utf8");
  throw new XlsxError(`Excel-filens del ${name} är packad på ett sätt som inte stöds.`);
}

/** A large part (the sheet, the shared strings) as text pieces, inflated as they are read. */
async function* streamPart(buffer: Buffer, entry: ZipEntry): AsyncGenerator<string> {
  const data = entryData(buffer, entry);
  const decoder = new TextDecoder("utf-8");
  if (entry.method === 0) {
    for (let offset = 0; offset < data.length; offset += 256 * 1024) yield decoder.decode(data.subarray(offset, offset + 256 * 1024), { stream: true });
  } else if (entry.method === 8) {
    const inflate = Readable.from([data]).pipe(createInflateRaw({ chunkSize: 128 * 1024 }));
    for await (const chunk of inflate) yield decoder.decode(chunk as Buffer, { stream: true });
  } else throw new XlsxError(`Excel-filens del ${entry.name} är packad på ett sätt som inte stöds.`);
  const rest = decoder.decode();
  if (rest) yield rest;
}

const ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };
export const decodeXml = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
  if (name[0] === "#") { const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10); return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""; }
  return ENTITY[name] ?? whole;
});
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** The text of an <si> or <is> element: its <t> runs, without phonetic hints (<rPh>). */
function runText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let text = "";
  for (const match of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) text += match[1] ? decodeXml(match[1]) : "";
  return text;
}

/** Complete elements `<name …>…</name>` (or `<name …/>`) as they arrive in pieces; the rest waits for the next piece. */
async function* elements(pieces: AsyncIterable<string>, name: string): AsyncGenerator<string> {
  let buffer = "";
  const open = `<${name}`;
  const close = `</${name}>`;
  for await (const piece of pieces) {
    buffer += piece;
    let from = 0;
    for (;;) {
      let start = buffer.indexOf(open, from);
      // "<row" must not match "<rows" or similar: the next character ends the name.
      while (start >= 0 && /[\w:-]/.test(buffer[start + open.length] ?? "")) start = buffer.indexOf(open, start + 1);
      // Not found: keep the last few characters, which may be the start of "<row" cut off by the piece.
      if (start < 0) { from = Math.max(from, buffer.length - open.length); break; }
      const tagEnd = buffer.indexOf(">", start);
      if (tagEnd < 0) { from = start; break; }
      if (buffer[tagEnd - 1] === "/") { yield buffer.slice(start, tagEnd + 1); from = tagEnd + 1; continue; }
      const end = buffer.indexOf(close, tagEnd);
      if (end < 0) { from = start; break; }
      yield buffer.slice(start, end + close.length);
      from = end + close.length;
    }
    buffer = buffer.slice(from);
    // One element (a row or a shared string) never needs this much: a crafted file could otherwise fill the memory (G-23).
    if (buffer.length > MAX_ELEMENT_CHARS) throw new XlsxError("Excel-filen har en rad eller text som är för stor för att läsas.");
  }
}
const MAX_ELEMENT_CHARS = 20_000_000;

/** Built-in number formats that are dates or times (ECMA-376, 18.8.30). */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Which cell styles (the s attribute) show a date. */
function dateStyles(styles: string | null): Set<number> {
  const result = new Set<number>();
  if (!styles) return result;
  const custom = new Map<number, string>();
  for (const match of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(match[0], "numFmtId"));
    const code = decodeXml(attr(match[0], "formatCode") ?? "");
    if (Number.isFinite(id)) custom.set(id, code);
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  let index = 0;
  for (const match of xfs.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
    const id = Number(attr(match[0], "numFmtId") ?? "0");
    const code = custom.get(id);
    // A custom code is a date when it has day, month or year letters outside quotes and brackets.
    const isDate = DATE_FORMATS.has(id) || (code !== undefined && /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) && !/^general$/i.test(code));
    if (isDate) result.add(index);
    index++;
  }
  return result;
}

/** An Excel serial date → ÅÅÅÅ-MM-DD (with the time when it has one), as the Import page shows dates. */
export function serialDate(serial: number, date1904 = false): string {
  const ms = Math.round((serial + (date1904 ? 1462 : 0)) * 86_400_000) + Date.UTC(1899, 11, 30);
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return String(serial);
  return date.getUTCHours() || date.getUTCMinutes() ? date.toISOString().slice(0, 16).replace("T", " ") : date.toISOString().slice(0, 10);
}

/** A column's letters ("A", "AB") → its index from 0. */
export function columnIndex(ref: string): number {
  let index = 0;
  for (const char of ref) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/** A number as JavaScript writes it, so 0.1 stays "0.1" and 12.300000000000001 stays as Excel stored it. */
const numberText = (value: string) => { const number = Number(value); return Number.isFinite(number) ? String(number) : value; };

export type XlsxSheet = { name: string; path: string; size: number };
export type XlsxRow = { line: number; cells: string[] };

export type XlsxBook = {
  sheets: XlsxSheet[];
  /** The rows of a sheet one at a time: `line` is the row number in Excel; at most `maxColumns` cells per row. */
  rows: (sheet: XlsxSheet, maxColumns: number) => AsyncGenerator<XlsxRow>;
};

/** Opens a workbook: its sheets, styles and shared strings (the only part kept in memory). */
export async function openXlsx(buffer: Buffer): Promise<XlsxBook> {
  const entries = zipEntries(buffer);
  const workbook = readPart(buffer, entries, "xl/workbook.xml");
  if (!workbook) throw new XlsxError("Filen är inte en Excel-arbetsbok (xlsx).");
  const relations = readPart(buffer, entries, "xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map<string, string>();
  for (const match of relations.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(match[0], "Id"); const target = attr(match[0], "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);
  const sheets: XlsxSheet[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const id = /\sr:id="([^"]*)"/.exec(match[0])?.[1] ?? /\s[\w]+:id="([^"]*)"/.exec(match[0])?.[1];
    const path = id ? targets.get(id) : undefined;
    const entry = path ? entries.get(path) : undefined;
    if (path && entry) sheets.push({ name: decodeXml(attr(match[0], "name") ?? path), path, size: entry.size });
  }
  if (!sheets.length) throw new XlsxError("Excel-filen saknar blad.");
  const dates = dateStyles(readPart(buffer, entries, "xl/styles.xml"));
  const shared: string[] = [];
  const sharedEntry = entries.get("xl/sharedStrings.xml");
  // The shared strings are the one part kept whole in memory, so their text has a ceiling (zip-bomb guard, G-23).
  let sharedChars = 0;
  if (sharedEntry) for await (const element of elements(streamPart(buffer, sharedEntry), "si")) {
    const text = runText(element);
    sharedChars += text.length;
    if (sharedChars > XLSX_MAX_UNPACKED_BYTES) throw new XlsxError(`Excel-filens texter blir större än ${Math.round(XLSX_MAX_UNPACKED_BYTES / 1_000_000)} MB uppackade och kan inte läsas.`);
    shared.push(text);
  }

  async function* rows(sheet: XlsxSheet, maxColumns: number): AsyncGenerator<XlsxRow> {
    const entry = entries.get(sheet.path);
    if (!entry) return;
    let next = 1;
    for await (const row of elements(streamPart(buffer, entry), "row")) {
      const head = row.slice(0, row.indexOf(">") + 1);
      const number = Number(attr(head, "r"));
      const line = Number.isFinite(number) && number > 0 ? number : next;
      next = line + 1;
      const cells: string[] = [];
      let column = 0;
      for (const match of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = match[1];
        const ref = /\sr="([A-Z]+)\d*"/.exec(attrs)?.[1];
        const index = ref ? columnIndex(ref) : column;
        column = index + 1;
        if (index >= maxColumns) continue;
        const body = match[2] ?? "";
        const type = attr(attrs, "t") ?? "n";
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = "";
        if (type === "s") value = raw !== undefined ? shared[Number(raw)] ?? "" : "";
        else if (type === "inlineStr") value = runText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
        else if (type === "str" || type === "e") value = raw !== undefined ? decodeXml(raw) : "";
        else if (type === "b") value = raw === "1" ? "true" : raw === "0" ? "false" : "";
        else if (type === "d") value = raw !== undefined ? decodeXml(raw).slice(0, 10) : "";
        else if (raw !== undefined) {
          const style = Number(attr(attrs, "s") ?? "-1");
          value = dates.has(style) && Number.isFinite(Number(raw)) ? serialDate(Number(raw), date1904) : numberText(raw);
        }
        while (cells.length < index) cells.push("");
        cells[index] = value;
      }
      yield { line, cells };
    }
  }
  return { sheets, rows };
}

/**
 * Zip-bomb guard (granskningen 2026-11-24, G-23 / data-ai F-07) for the readers that unpack a whole workbook in memory
 * (ExcelJS's `xlsx.load`). 200 MB unpacked is far more than a real form, payroll or import workbook of 20 MB holds, while
 * ExcelJS already needs several times the unpacked size in memory. 5 000 parts is far more than any workbook has.
 */
export const XLSX_MAX_UNPACKED_BYTES = 200_000_000;
export const XLSX_MAX_PARTS = 5_000;

/**
 * Why a workbook may not be unpacked, or null. The sizes the zip claims are checked first; then every part is actually
 * inflated as a stream, counting the bytes and stopping at the limit, since a crafted zip can claim small sizes. Nothing is
 * kept. A file that is not a zip at all is left to the reader, which gives its own message.
 */
export async function xlsxUnpackProblem(buffer: Buffer, limits: { maxBytes?: number; maxParts?: number } = {}): Promise<string | null> {
  const maxBytes = limits.maxBytes ?? XLSX_MAX_UNPACKED_BYTES;
  const maxParts = limits.maxParts ?? XLSX_MAX_PARTS;
  const tooLarge = `Excel-filen blir större än ${Math.round(maxBytes / 1_000_000)} MB uppackad och kan inte läsas. Dela upp den i mindre filer.`;
  let entries: Map<string, ZipEntry>;
  try { entries = zipEntries(buffer); } catch { return null; }
  if (entries.size > maxParts) return `Excel-filen har för många delar (över ${maxParts}) och kan inte läsas.`;
  let claimed = 0;
  for (const entry of entries.values()) claimed += entry.size;
  if (claimed > maxBytes) return tooLarge;
  let total = 0;
  for (const entry of entries.values()) {
    if (entry.method === 0) { total += entry.compressedSize; if (total > maxBytes) return tooLarge; continue; }
    if (entry.method !== 8) continue;
    let data: Buffer;
    try { data = entryData(buffer, entry); } catch { return null; }
    const inflate = Readable.from([data]).pipe(createInflateRaw({ chunkSize: 128 * 1024 }));
    try {
      for await (const chunk of inflate) {
        total += (chunk as Buffer).length;
        if (total > maxBytes) { inflate.destroy(); return tooLarge; }
      }
    } catch { return null; }
  }
  return null;
}

/** Whether the bytes start like a zip file (an xlsx is one). */
export const looksLikeZip = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
