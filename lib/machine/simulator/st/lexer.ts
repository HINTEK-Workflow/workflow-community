// PLC-simulatorn (2026-11-02: "programmering i ST-kod"): the tokens of our small Structured Text dialect.
// Own implementation, written from scratch; keywords are case-insensitive, as programmers of such controllers expect. Every
// token carries its line and column, so an error can point at its place in the editor.

export type TokenKind = "ident" | "keyword" | "int" | "real" | "time" | "address" | "op" | "end";
export type Token = { kind: TokenKind; text: string; value?: number; line: number; col: number };

export const KEYWORDS = new Set([
  "PROGRAM", "END_PROGRAM", "VAR", "END_VAR", "AT", "IF", "THEN", "ELSIF", "ELSE", "END_IF", "CASE", "OF", "END_CASE",
  "AND", "OR", "XOR", "NOT", "MOD", "TRUE", "FALSE", "BOOL", "INT", "REAL", "TIME",
]);

const OPERATORS = [":=", "<=", ">=", "<>", "..", "+", "-", "*", "/", "(", ")", ";", ":", ",", ".", "<", ">", "="];

export class StError extends Error {
  constructor(message: string, readonly line: number, readonly col: number) { super(message); }
}

/** A TIME literal after `T#`: parts in d, h, m, s and ms, in that order, each optional; the value in milliseconds. */
export function parseTimeLiteral(body: string): number | null {
  const match = /^(?:(\d+(?:\.\d+)?)d)?(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/i.exec(body.replace(/_/g, ""));
  if (!match || match[0] === "") return null;
  const [, days, hours, minutes, seconds, millis] = match;
  return Math.round((Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) * 1000 + Number(millis ?? 0));
}

const isIdentStart = (ch: string) => /[A-Za-z_]/.test(ch);
const isIdentPart = (ch: string) => /[A-Za-z0-9_]/.test(ch);
const isDigit = (ch: string) => ch >= "0" && ch <= "9";

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0, line = 1, col = 1;
  const advance = (count: number) => {
    for (let step = 0; step < count; step += 1) {
      if (source[index] === "\n") { line += 1; col = 1; } else col += 1;
      index += 1;
    }
  };
  while (index < source.length) {
    const ch = source[index];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") { advance(1); continue; }
    if (ch === "/" && source[index + 1] === "/") { while (index < source.length && source[index] !== "\n") advance(1); continue; }
    if (ch === "(" && source[index + 1] === "*") {
      const startLine = line, startCol = col;
      const end = source.indexOf("*)", index + 2);
      if (end === -1) throw new StError("Kommentaren (* saknar sitt slut *).", startLine, startCol);
      advance(end + 2 - index);
      continue;
    }
    const startLine = line, startCol = col;
    // Direct addresses: %IX0.0, %QX0.3, %IW1, %QW0.
    if (ch === "%") {
      const match = /^%([IQ])([XW])(\d+)(?:\.(\d+))?/i.exec(source.slice(index));
      if (!match) throw new StError("Adressen går inte att läsa. Skriv till exempel %IX0.0 eller %IW1.", startLine, startCol);
      tokens.push({ kind: "address", text: match[0].toUpperCase(), line: startLine, col: startCol });
      advance(match[0].length);
      continue;
    }
    if ((ch === "T" || ch === "t") && source[index + 1] === "#") {
      const match = /^T#([A-Za-z0-9_.]+)/i.exec(source.slice(index));
      const value = match ? parseTimeLiteral(match[1]) : null;
      if (!match || value === null) throw new StError("Tiden går inte att läsa. Skriv till exempel T#2s, T#500ms eller T#1m30s.", startLine, startCol);
      tokens.push({ kind: "time", text: match[0], value, line: startLine, col: startCol });
      advance(match[0].length);
      continue;
    }
    if (isDigit(ch)) {
      const match = /^\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/.exec(source.slice(index))!;
      const text = match[0];
      const real = match[1] !== undefined || match[2] !== undefined;
      tokens.push({ kind: real ? "real" : "int", text, value: Number(text.replace(/_/g, "")), line: startLine, col: startCol });
      advance(text.length);
      continue;
    }
    if (isIdentStart(ch)) {
      let end = index + 1;
      while (end < source.length && isIdentPart(source[end])) end += 1;
      const text = source.slice(index, end);
      const upper = text.toUpperCase();
      tokens.push({ kind: KEYWORDS.has(upper) ? "keyword" : "ident", text: KEYWORDS.has(upper) ? upper : text, line: startLine, col: startCol });
      advance(text.length);
      continue;
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (!op) throw new StError(`Oväntat tecken: ${ch}`, startLine, startCol);
    tokens.push({ kind: "op", text: op, line: startLine, col: startCol });
    advance(op.length);
  }
  tokens.push({ kind: "end", text: "", line, col });
  return tokens;
}
