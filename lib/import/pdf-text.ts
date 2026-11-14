import { inflateRawSync, inflateSync } from "node:zlib";

/**
 * The text of a PDF, best effort and without dependencies (2026-10-01: reports are PDFs, and Import read none of
 * them). Reads the pages' content streams (Flate-compressed or plain, also inside object streams), follows each
 * page's fonts to their ToUnicode maps and falls back to WinAnsi for the standard fonts. Lines follow the text's
 * vertical moves. Scanned PDFs (pictures of text) give no text; they stay attachments.
 */

type PdfObject = { dict: string; stream: Buffer | null };
const MAX_OBJECTS = 20_000;
const MAX_TEXT = 60_000;

function inflate(data: Buffer): Buffer | null {
  try { return inflateSync(data, { maxOutputLength: 20_000_000 }); } catch { /* try raw */ }
  try { return inflateRawSync(data, { maxOutputLength: 20_000_000 }); } catch { return null; }
}

function streamData(dict: string, raw: Buffer): Buffer | null {
  const filter = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict)?.[1] ?? "";
  if (!filter) return raw;
  if (/^\/FlateDecode$|^\[\s*\/FlateDecode\s*\]$/.test(filter.trim())) return inflate(raw);
  return null;
}

/** Every object by number, including those packed in object streams. */
function readObjects(buffer: Buffer): Map<number, PdfObject> {
  const text = buffer.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const pattern = /(\d+)\s+\d+\s+obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && objects.size < MAX_OBJECTS) {
    const start = match.index + match[0].length;
    const end = text.indexOf("endobj", start);
    if (end < 0) break;
    const body = text.slice(start, end);
    const streamAt = body.search(/\bstream\r?\n/);
    if (streamAt >= 0) {
      const dict = body.slice(0, streamAt);
      const dataStart = start + streamAt + (/\bstream\r\n/.test(body.slice(streamAt, streamAt + 8)) ? 8 : 7);
      const length = Number(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)?.[1] ?? -1);
      const endStream = text.indexOf("endstream", dataStart);
      const dataEnd = length >= 0 && dataStart + length <= endStream ? dataStart + length : endStream;
      objects.set(Number(match[1]), { dict, stream: streamData(dict, buffer.subarray(dataStart, dataEnd).subarray(0)) });
    } else objects.set(Number(match[1]), { dict: body, stream: null });
    pattern.lastIndex = end;
  }
  // Object streams (/Type /ObjStm): "number offset" pairs, then the objects from /First on.
  for (const object of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(object.dict) || !object.stream) continue;
    const content = object.stream.toString("latin1");
    const count = Number(/\/N\s+(\d+)/.exec(object.dict)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(object.dict)?.[1] ?? 0);
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let index = 0; index < count && index * 2 + 1 < header.length; index++) {
      const number = header[index * 2];
      const from = first + header[index * 2 + 1];
      const to = index + 1 < count ? first + header[(index + 1) * 2 + 1] : content.length;
      if (!objects.has(number)) objects.set(number, { dict: content.slice(from, to), stream: null });
    }
  }
  return objects;
}

const ref = (value: string | undefined) => (value ? Number(/^(\d+)\s+\d+\s+R/.exec(value.trim())?.[1] ?? NaN) : NaN);

/** A dictionary value: a reference is followed, an inline << … >> is returned as is. */
function dictValue(objects: Map<number, PdfObject>, dict: string, key: string): string {
  const at = dict.search(new RegExp(`/${key}(?![A-Za-z])`));
  if (at < 0) return "";
  const rest = dict.slice(at + key.length + 1).trimStart();
  if (rest.startsWith("<<")) {
    let depth = 0;
    for (let index = 0; index < rest.length - 1; index++) {
      if (rest.startsWith("<<", index)) { depth++; index++; }
      else if (rest.startsWith(">>", index)) { depth--; index++; if (!depth) return rest.slice(0, index + 1); }
    }
    return rest;
  }
  const number = ref(rest);
  return Number.isNaN(number) ? rest.split(/[\s/>]/)[0] : objects.get(number)?.dict ?? "";
}

type CMap = { bytes: number; map: Map<number, string> };
const utf16 = (hex: string) => { let out = ""; for (let index = 0; index < hex.length; index += 4) out += String.fromCharCode(parseInt(hex.slice(index, index + 4).padEnd(4, "0"), 16)); return out; };

function parseCMap(text: string): CMap {
  const map = new Map<number, string>();
  const range = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text);
  const bytes = range ? Math.max(1, range[1].length / 2) : 2;
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(pair[1], 16), utf16(pair[2]));
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const entry of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const from = parseInt(entry[1], 16); const to = Math.min(parseInt(entry[2], 16), from + 65_535);
      if (entry[4] !== undefined) { const base = parseInt(entry[4], 16); for (let code = from; code <= to; code++) map.set(code, String.fromCharCode(base + code - from)); }
      else [...(entry[5] ?? "").matchAll(/<([0-9a-fA-F]+)>/g)].forEach((item, index) => map.set(from + index, utf16(item[1])));
    }
  }
  return { bytes, map };
}

// WinAnsi differs from Latin-1 in 0x80–0x9F; the characters that matter in Swedish text.
const WIN_ANSI: Record<number, string> = { 0x80: "€", 0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x99: "™" };
const decodeBytes = (bytes: number[], cmap: CMap | null) => {
  if (!cmap) return bytes.map((code) => WIN_ANSI[code] ?? String.fromCharCode(code)).join("");
  let out = "";
  for (let index = 0; index + cmap.bytes <= bytes.length; index += cmap.bytes) {
    let code = 0;
    for (let offset = 0; offset < cmap.bytes; offset++) code = code * 256 + bytes[index + offset];
    out += cmap.map.get(code) ?? "";
  }
  return out;
};

function literalBytes(content: string, start: number): { bytes: number[]; end: number } {
  const bytes: number[] = []; let depth = 1; let index = start + 1;
  for (; index < content.length && depth > 0; index++) {
    const char = content[index];
    if (char === "\\") {
      const next = content[++index];
      const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
      if (next in escapes) bytes.push(escapes[next]);
      else if (/[0-7]/.test(next)) { let octal = next; while (octal.length < 3 && /[0-7]/.test(content[index + 1])) octal += content[++index]; bytes.push(parseInt(octal, 8) & 255); }
      continue;
    }
    if (char === "(") depth++;
    if (char === ")") { depth--; if (!depth) break; }
    bytes.push(char.charCodeAt(0) & 255);
  }
  return { bytes, end: index + 1 };
}

/** The text drawn by one content stream, with the page's fonts. */
function contentText(content: string, fonts: Map<string, CMap | null>): string {
  let out = ""; let font: CMap | null = null; let lastY: number | null = null;
  const operands: (number | string | number[][] | null)[] = [];
  const newline = () => { if (out && !out.endsWith("\n")) out += "\n"; };
  const show = (bytes: number[]) => { out += decodeBytes(bytes, font); };
  let index = 0;
  while (index < content.length && out.length < MAX_TEXT) {
    const char = content[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === "%") { index = content.indexOf("\n", index); if (index < 0) break; continue; }
    if (char === "(") { const literal = literalBytes(content, index); operands.push([literal.bytes]); index = literal.end; continue; }
    if (char === "<" && content[index + 1] !== "<") {
      const end = content.indexOf(">", index); const hex = content.slice(index + 1, end).replace(/\s/g, "");
      const bytes: number[] = []; for (let at = 0; at < hex.length; at += 2) bytes.push(parseInt(hex.slice(at, at + 2).padEnd(2, "0"), 16));
      operands.push([bytes]); index = end + 1; continue;
    }
    if (char === "[") {
      // A TJ array: strings and kerning; a large negative kerning is a space between words.
      const parts: number[][] = []; index++;
      while (index < content.length && content[index] !== "]") {
        const item = content[index];
        if (item === "(") { const literal = literalBytes(content, index); parts.push(literal.bytes); index = literal.end; }
        else if (item === "<") { const end = content.indexOf(">", index); const hex = content.slice(index + 1, end).replace(/\s/g, ""); const bytes: number[] = []; for (let at = 0; at < hex.length; at += 2) bytes.push(parseInt(hex.slice(at, at + 2).padEnd(2, "0"), 16)); parts.push(bytes); index = end + 1; }
        else if (/[-\d.]/.test(item)) { const number = /^-?[\d.]+/.exec(content.slice(index))?.[0] ?? "0"; if (Number(number) < -200) parts.push([-1]); index += number.length; }
        else index++;
      }
      operands.push(parts); index++; continue;
    }
    if (char === "/") { const name = /^\/[^\s/<>[\]()]+/.exec(content.slice(index))?.[0] ?? "/"; operands.push(name); index += name.length; continue; }
    if (/[-\d.]/.test(char)) { const number = /^-?[\d.]+/.exec(content.slice(index))?.[0] ?? "0"; operands.push(Number(number)); index += number.length || 1; continue; }
    if (char === "<" || char === ">") { index += 2; operands.length = 0; continue; }
    const operator = /^[A-Za-z'"*]+/.exec(content.slice(index))?.[0] ?? char;
    index += operator.length;
    if (operator === "BI") { const end = content.indexOf("EI", index); index = end < 0 ? content.length : end + 2; operands.length = 0; continue; }
    if (operator === "Tf") { const name = operands.find((item) => typeof item === "string") as string | undefined; font = name ? fonts.get(name.slice(1)) ?? null : null; }
    else if (operator === "Tj" || operator === "'" || operator === "\"") { if (operator !== "Tj") newline(); const last = operands[operands.length - 1]; if (Array.isArray(last)) show(last[0] ?? []); }
    else if (operator === "TJ") { const last = operands[operands.length - 1]; if (Array.isArray(last)) for (const part of last) { if (part.length === 1 && part[0] === -1) { if (!out.endsWith(" ")) out += " "; } else show(part); } }
    else if (operator === "Td" || operator === "TD") { const ty = Number(operands[operands.length - 1] ?? 0); if (Math.abs(ty) > 0.5) newline(); else if (out && !/\s$/.test(out)) out += " "; }
    else if (operator === "T*") newline();
    else if (operator === "Tm") { const y = Number(operands[operands.length - 1] ?? 0); if (lastY !== null && Math.abs(y - lastY) > 0.5) newline(); else if (lastY !== null && out && !/\s$/.test(out)) out += " "; lastY = y; }
    else if (operator === "ET") { newline(); lastY = null; }
    operands.length = 0;
  }
  return out;
}

/** The text of the PDF's pages in order, or null when it holds none (a scan, or an encrypted file). */
export function pdfText(buffer: Buffer): string | null {
  if (!buffer.subarray(0, 1024).toString("latin1").includes("%PDF")) return null;
  if (/\/Encrypt\s/.test(buffer.subarray(Math.max(0, buffer.length - 4096)).toString("latin1"))) return null;
  const objects = readObjects(buffer);
  const pages = [...objects.entries()].filter(([, object]) => /\/Type\s*\/Page(?![s\w])/.test(object.dict)).sort((a, b) => a[0] - b[0]);
  const cmaps = new Map<number, CMap>();
  const parts: string[] = [];
  for (const [, page] of pages) {
    const resources = dictValue(objects, page.dict, "Resources");
    const fontDict = dictValue(objects, resources, "Font");
    const fonts = new Map<string, CMap | null>();
    for (const entry of fontDict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      const fontObject = objects.get(Number(entry[2]));
      const toUnicode = ref(/\/ToUnicode\s+(\d+\s+\d+\s+R)/.exec(fontObject?.dict ?? "")?.[1]);
      if (!Number.isNaN(toUnicode)) {
        if (!cmaps.has(toUnicode)) { const stream = objects.get(toUnicode)?.stream; if (stream) cmaps.set(toUnicode, parseCMap(stream.toString("latin1"))); }
        fonts.set(entry[1], cmaps.get(toUnicode) ?? null);
      } else fonts.set(entry[1], null);
    }
    const contents = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(page.dict)?.[1] ?? "";
    const streams = [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map((item) => objects.get(Number(item[1]))?.stream).filter((stream): stream is Buffer => Boolean(stream));
    parts.push(contentText(streams.map((stream) => stream.toString("latin1")).join("\n"), fonts));
    if (parts.join("\n").length > MAX_TEXT) break;
  }
  const text = parts.join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim().slice(0, MAX_TEXT);
  return text.replace(/\s/g, "").length >= 20 ? text : null;
}
