import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFObject } from "pdf-lib";

/**
 * What a PDF draws, page by page, in a form that can be compared between two renderers (2026-09-27: the
 * control's PDF must look exactly like today). Text is decoded to Unicode through each font's ToUnicode map, so the
 * glyph numbering of a font subset does not matter; resource names get their random suffix removed; numbers are kept
 * so they can be compared with a tolerance. Metadata such as the creation date is not part of the drawing.
 */
export type DrawingOp = { op: string; nums: number[]; text?: string; name?: string };
export type PdfDrawing = { pages: DrawingOp[][] };

type FontMap = { twoByte: boolean; map: Map<number, string> };

function resolve(doc: PDFDocument, value: PDFObject | undefined): PDFObject | undefined {
  return value instanceof PDFRef ? doc.context.lookup(value) : value;
}

function streamBytes(stream: PDFStream) {
  if (stream instanceof PDFRawStream) {
    const filter = stream.dict.get(PDFName.of("Filter"));
    const bytes = stream.getContents();
    return filter && String(filter) === "/FlateDecode" ? new Uint8Array(inflateSync(bytes)) : bytes;
  }
  return stream.getContents();
}

function hexToBytes(hex: string) {
  const clean = hex.replace(/\s+/g, "");
  const padded = clean.length % 2 ? `${clean}0` : clean;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function parseToUnicode(text: string) {
  const map = new Map<number, string>();
  const utf16 = (hex: string) => { const bytes = hexToBytes(hex); let result = ""; for (let i = 0; i + 1 < bytes.length; i += 2) result += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]); return result; };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const entry of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(entry[1], 16), utf16(entry[2]));
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const entry of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const start = parseInt(entry[1], 16), end = parseInt(entry[2], 16), first = utf16(entry[3]);
      for (let code = start; code <= end; code++) map.set(code, String.fromCharCode(first.charCodeAt(0) + code - start));
    }
  return map;
}

function fontMaps(doc: PDFDocument, resources: PDFDict | undefined) {
  const fonts = new Map<string, FontMap>();
  const dict = resolve(doc, resources?.get(PDFName.of("Font")));
  if (!(dict instanceof PDFDict)) return fonts;
  for (const [name, ref] of dict.entries()) {
    const font = resolve(doc, ref);
    if (!(font instanceof PDFDict)) continue;
    const subtype = String(font.get(PDFName.of("Subtype")));
    const toUnicode = resolve(doc, font.get(PDFName.of("ToUnicode")));
    const map = toUnicode instanceof PDFStream ? parseToUnicode(new TextDecoder("latin1").decode(streamBytes(toUnicode))) : new Map<number, string>();
    fonts.set(name.asString(), { twoByte: subtype === "/Type0", map });
  }
  return fonts;
}

const normalName = (name: string) => name.replace(/-\d+$/, "");

// The standard fonts use WinAnsi, which differs from Latin-1 in 0x80–0x9F (e.g. – and •).
const WIN_ANSI: Record<number, string> = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ" };

function decodeString(raw: Uint8Array, font: FontMap | undefined) {
  if (!font) return [...raw].map((byte) => WIN_ANSI[byte] ?? String.fromCharCode(byte)).join("");
  let result = "";
  if (font.twoByte) for (let i = 0; i + 1 < raw.length; i += 2) { const code = (raw[i] << 8) | raw[i + 1]; result += font.map.get(code) ?? `\\u{${code.toString(16)}}`; }
  else for (const byte of raw) result += font.map.get(byte) ?? WIN_ANSI[byte] ?? String.fromCharCode(byte);
  return result;
}

function literalBytes(source: string) {
  const out: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char !== "\\") { out.push(char.charCodeAt(0) & 0xff); continue; }
    const next = source[++i];
    const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    if (next in escapes) out.push(escapes[next]);
    else if (/[0-7]/.test(next)) { let octal = next; while (octal.length < 3 && /[0-7]/.test(source[i + 1] ?? "")) octal += source[++i]; out.push(parseInt(octal, 8)); }
  }
  return new Uint8Array(out);
}

/** Splits a content stream into operators with their numbers, names and (decoded) strings. */
function parseContent(content: string, fonts: Map<string, FontMap>): DrawingOp[] {
  const ops: DrawingOp[] = [];
  let nums: number[] = []; let text: string | undefined; let name: string | undefined; let font: FontMap | undefined;
  let i = 0;
  while (i < content.length) {
    const char = content[i];
    if (/\s/.test(char)) { i++; continue; }
    if (char === "%") { while (i < content.length && content[i] !== "\n") i++; continue; }
    if (char === "<" && content[i + 1] !== "<") {
      const end = content.indexOf(">", i);
      text = (text ?? "") + decodeString(hexToBytes(content.slice(i + 1, end)), font); i = end + 1; continue;
    }
    if (char === "(") {
      let depth = 1, j = i + 1, raw = "";
      while (j < content.length && depth > 0) {
        if (content[j] === "\\") { raw += content[j] + content[j + 1]; j += 2; continue; }
        if (content[j] === "(") depth++;
        if (content[j] === ")") { depth--; if (!depth) break; }
        raw += content[j++];
      }
      text = (text ?? "") + decodeString(literalBytes(raw), font); i = j + 1; continue;
    }
    if (char === "[" || char === "]") { i++; continue; }
    if (char === "<" || char === ">") { i += 2; continue; }
    if (char === "/") {
      let j = i + 1; while (j < content.length && !/[\s/[\]()<>]/.test(content[j])) j++;
      name = content.slice(i, j); i = j; continue;
    }
    let j = i; while (j < content.length && !/[\s/[\]()<>%]/.test(content[j])) j++;
    const token = content.slice(i, j); i = j;
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(token)) { nums.push(Number(token)); continue; }
    if (token === "Tf" && name) font = fonts.get(name);
    ops.push({ op: token, nums, ...(text !== undefined ? { text } : {}), ...(name ? { name: normalName(name) } : {}) });
    nums = []; text = undefined; name = undefined;
  }
  return ops;
}

export async function pdfDrawing(bytes: Uint8Array): Promise<PdfDrawing> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages: DrawingOp[][] = [];
  for (const page of doc.getPages()) {
    const fonts = fontMaps(doc, page.node.Resources());
    const contents = resolve(doc, page.node.get(PDFName.of("Contents")));
    const streams = contents instanceof PDFArray ? contents.asArray().map((item) => resolve(doc, item)) : [contents];
    const text = streams.filter((item): item is PDFStream => item instanceof PDFStream).map((item) => new TextDecoder("latin1").decode(streamBytes(item))).join("\n");
    pages.push(parseContent(text, fonts));
  }
  return { pages };
}

/** The first difference between two drawings, or null when they match (text exactly, numbers within `tolerance` pt). */
export function drawingDifference(actual: PdfDrawing, expected: PdfDrawing, tolerance = 0.5): string | null {
  if (actual.pages.length !== expected.pages.length) return `${actual.pages.length} sidor, väntade ${expected.pages.length}.`;
  for (let page = 0; page < expected.pages.length; page++) {
    const a = actual.pages[page], e = expected.pages[page];
    const count = Math.max(a.length, e.length);
    for (let index = 0; index < count; index++) {
      const x = a[index], y = e[index];
      const where = `sida ${page + 1}, instruktion ${index + 1}`;
      const show = (op?: DrawingOp) => op ? `${op.op}${op.text !== undefined ? ` "${op.text}"` : ""}${op.name ? ` ${op.name}` : ""} [${op.nums.join(" ")}]` : "inget";
      if (!x || !y) return `${where}: ${show(x)} i stället för ${show(y)}.`;
      if (x.op !== y.op || x.text !== y.text || x.name !== y.name || x.nums.length !== y.nums.length || x.nums.some((value, item) => Math.abs(value - y.nums[item]) > tolerance))
        return `${where}: ${show(x)} i stället för ${show(y)}.`;
    }
  }
  return null;
}

/** All text a drawing prints, in order, for content comparisons between an old and a new layout. */
export const drawingText = (drawing: PdfDrawing) => drawing.pages.map((page) => page.filter((op) => op.text !== undefined).map((op) => op.text).join("\n"));
