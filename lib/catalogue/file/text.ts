/**
 * Prisfiler, etapp 1 (2026-10-12, docs/proposals/prisfiler-analys-2026-10-12.md): reading a text price file as a
 * stream – the encoding, the kind of table (separated columns or fixed width) and the rows one at a time, so a file of
 * several hundred thousand rows is never held as one string or one grid. Pure, so it is tested with made-up files.
 */

export type TextEncodingName = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

/** Whether the bytes are valid UTF-8 (without decoding them into one string). */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let index = 0;
  const length = bytes.length;
  while (index < length) {
    const byte = bytes[index];
    if (byte < 0x80) { index++; continue; }
    let extra: number;
    if (byte >= 0xc2 && byte <= 0xdf) extra = 1;
    else if (byte >= 0xe0 && byte <= 0xef) extra = 2;
    else if (byte >= 0xf0 && byte <= 0xf4) extra = 3;
    else return false;
    // A sequence cut off at the very end of the bytes still counts as invalid.
    if (index + extra >= length) return false;
    for (let next = 1; next <= extra; next++) if ((bytes[index + next] & 0xc0) !== 0x80) return false;
    if (byte === 0xe0 && bytes[index + 1] < 0xa0) return false;
    if (byte === 0xed && bytes[index + 1] > 0x9f) return false;
    if (byte === 0xf0 && bytes[index + 1] < 0x90) return false;
    if (byte === 0xf4 && bytes[index + 1] > 0x8f) return false;
    index += extra + 1;
  }
  return true;
}

/**
 * The encoding of a text file as decodeText (lib/import/csv.ts) reads it: a byte order mark first, valid UTF-8, and
 * otherwise Windows-1252 – which also covers ISO-8859-1, the usual encoding of suppliers' price files.
 */
export function detectEncoding(bytes: Uint8Array): { encoding: TextEncodingName; bom: number } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: "utf-8", bom: 3 };
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: "utf-16le", bom: 2 };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: "utf-16be", bom: 2 };
  return { encoding: isValidUtf8(bytes) ? "utf-8" : "windows-1252", bom: 0 };
}

const CHUNK = 256 * 1024;

/** The text of the bytes in pieces (a quarter of a megabyte each), never as one string. */
export function* decodeChunks(bytes: Uint8Array, encoding: TextEncodingName, start = 0): Generator<string> {
  const decoder = new TextDecoder(encoding);
  for (let offset = start; offset < bytes.length; offset += CHUNK) {
    const end = Math.min(bytes.length, offset + CHUNK);
    const text = decoder.decode(bytes.subarray(offset, end), { stream: end < bytes.length });
    if (text) yield text;
  }
  const rest = decoder.decode();
  if (rest) yield rest;
}

/** The first characters of the text (for recognising its layout), at most `max`. */
export function textStart(bytes: Uint8Array, encoding: TextEncodingName, bom: number, max = 128 * 1024): string {
  const slice = bytes.subarray(bom, Math.min(bytes.length, bom + max * (encoding.startsWith("utf-16") ? 2 : 1) + 4));
  return new TextDecoder(encoding).decode(slice).slice(0, max);
}

export type Separator = ";" | "," | "\t" | "|";
export type TextLayout =
  | { kind: "delimited"; separator: Separator }
  | { kind: "fixed"; lineLength: number }
  | { kind: "text" };

/** Non-empty lines of a piece of text; CR LF, CR CR LF and LF all end a line. */
export const linesOf = (text: string) => text.split(/\r\n|\r|\n/).filter((line) => line.trim());

/**
 * What a text file is (prisfil 2026-10-12): columns with a separator when nearly every line has the same number of
 * that separator; fixed width when nearly every line has the same length and no separator (a supplier's text file
 * with 112 characters per row); otherwise plain text. The last line may be cut off by the sample and is ignored.
 */
export function sniffLayout(sample: string, nameHint = ""): TextLayout {
  const lines = linesOf(sample).slice(0, 400);
  if (lines.length > 3) lines.pop();
  if (!lines.length) return { kind: "text" };
  const counts = (separator: Separator) => lines.map((line) => line.split(separator).length - 1);
  for (const separator of [";", "\t", "|", ","] as Separator[]) {
    const list = counts(separator);
    const withIt = list.filter((count) => count > 0).length;
    if (withIt / lines.length < 0.9) continue;
    const mode = modeOf(list);
    if (list.filter((count) => count === mode).length / lines.length >= 0.8) return { kind: "delimited", separator };
  }
  if (lines.length >= 5) {
    const length = modeOf(lines.map((line) => line.length));
    const same = lines.filter((line) => line.length === length).length / lines.length;
    if (length >= 20 && same >= 0.95) return { kind: "fixed", lineLength: length };
  }
  // A .csv / .tsv file is a table even when its first lines are uneven (as before: the first line decides).
  if (/\.(csv|tsv)$/i.test(nameHint)) {
    const first = lines[0];
    const separator: Separator = first.includes("\t") ? "\t" : (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
    return { kind: "delimited", separator };
  }
  return { kind: "text" };
}

function modeOf(values: number[]): number {
  const counts = new Map<number, number>();
  let best = values[0] ?? 0; let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) { best = value; bestCount = count; }
  }
  return best;
}

/** A record of a text table: its cells and the line it starts on (1 = the file's first line with content). */
export type TextRecord = { line: number; cells: string[] };

/**
 * A CSV parser that is fed the text piece by piece (the same rules as parseCsv in lib/import/csv.ts): a quote opens a
 * quoted field only at the start of a field – inside a value it is a character, as in an inch mark – so one such name
 * never swallows the rows after it. Empty lines are skipped; `line` counts the records with content.
 */
export class CsvStream {
  private row: string[] = [];
  private value = "";
  private quoted = false;
  private pendingCr = false;
  /** A quote inside a quoted field was the piece's last character: the next character decides ("" or the end). */
  private pendingQuote = false;
  private count = 0;
  constructor(private readonly separator: Separator) {}

  /** The records completed by this piece of text. */
  *feed(text: string): Generator<TextRecord> {
    const separator = this.separator;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (this.pendingCr) { this.pendingCr = false; if (char === "\n") continue; }
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (char === "\"") { this.value += "\""; continue; }
        this.quoted = false;
      }
      if (this.quoted) {
        if (char === "\"") {
          if (index + 1 >= text.length) this.pendingQuote = true;
          else if (text[index + 1] === "\"") { this.value += "\""; index++; }
          else this.quoted = false;
        } else this.value += char;
        continue;
      }
      if (char === "\"" && this.value === "") this.quoted = true;
      else if (char === separator) { this.row.push(this.value); this.value = ""; }
      else if (char === "\n" || char === "\r") {
        if (char === "\r") this.pendingCr = true;
        this.row.push(this.value); this.value = "";
        const done = this.take();
        if (done) yield done;
      } else this.value += char;
    }
  }

  /** The last record, when the text does not end with a line break. */
  *end(): Generator<TextRecord> {
    this.pendingQuote = false;
    if (this.value || this.row.length) { this.row.push(this.value); this.value = ""; const done = this.take(); if (done) yield done; }
  }

  private take(): TextRecord | null {
    const row = this.row;
    this.row = [];
    if (!row.some((part) => part.trim())) return null;
    this.count++;
    return { line: this.count, cells: row };
  }
}

/** Lines of text fed piece by piece; empty lines are skipped, `line` counts the lines with content. */
export class LineStream {
  private rest = "";
  private count = 0;
  *feed(text: string): Generator<TextRecord & { text: string }> {
    const all = this.rest + text;
    const parts = all.split(/\r\n|\r|\n/);
    // A piece may end in the middle of "\r\n": the "\n" then starts the next piece as an empty line, which is skipped.
    this.rest = parts.pop() ?? "";
    for (const part of parts) if (part.trim()) yield { line: ++this.count, cells: [], text: part };
  }
  *end(): Generator<TextRecord & { text: string }> {
    if (this.rest.trim()) yield { line: ++this.count, cells: [], text: this.rest };
    this.rest = "";
  }
}
