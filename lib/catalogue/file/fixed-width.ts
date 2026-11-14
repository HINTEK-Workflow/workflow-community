/**
 * Fast kolumnbredd (prisfil 2026-10-12): a text price file without separators, where every row has the same length and
 * each field has its own character positions (one supplier's files have 112 characters per row). The columns are given
 * as their first positions (1-based); the last column runs to the end of the row. A suggestion is made from the
 * characters themselves, and the person corrects it; the positions are saved with the supplier's column profile.
 */

export const MAX_FIXED_COLUMNS = 40;

/** The cells of a row: each column from its start up to the next column's start, trimmed. */
export function splitFixed(line: string, starts: number[]): string[] {
  return starts.map((start, index) => line.slice(start - 1, index + 1 < starts.length ? starts[index + 1] - 1 : undefined).trim());
}

/** The positions as people write them ("1, 21, 33") → sorted, unique, within the row; at most 40 columns. */
export function cleanStarts(starts: readonly number[], lineLength: number): number[] {
  const list = [...new Set(starts.map((value) => Math.trunc(Number(value))).filter((value) => Number.isFinite(value) && value >= 1 && value <= Math.max(1, lineLength)))].sort((a, b) => a - b);
  if (list[0] !== 1) list.unshift(1);
  return list.slice(0, MAX_FIXED_COLUMNS);
}

/** "1, 21, 33" → [1, 21, 33]; anything unreadable is left out. */
export const parseStarts = (text: string) => text.split(/[\s,;]+/).filter(Boolean).map(Number).filter((value) => Number.isInteger(value) && value >= 1);

/** The heading of a fixed-width column, by its positions ("Tecken 21–32"). */
export const fixedHeader = (start: number, end: number) => `Tecken ${start}–${end}`;

export function fixedHeaders(starts: number[], lineLength: number): string[] {
  return starts.map((start, index) => fixedHeader(start, index + 1 < starts.length ? starts[index + 1] - 1 : lineLength));
}

type Kind = "space" | "digit" | "letter" | "other";
const kindOf = (char: string | undefined): Kind => (char === undefined || char === " " ? "space" : /\d/.test(char) ? "digit" : /\p{L}/u.test(char) ? "letter" : "other");

/**
 * Suggested column starts from sample lines: a column starts where padding ends (a position that is mostly blank
 * followed by one that is rarely blank), where an always-numeric run begins or ends, and around single positions that
 * only ever hold one or two letters (flags such as J/N). Only a suggestion – the preview shows the result.
 */
export function suggestFixedStarts(lines: readonly string[], lineLength: number): number[] {
  const sample = lines.slice(0, 2000);
  if (!sample.length || lineLength < 2) return [1];
  const stats = Array.from({ length: lineLength }, () => ({ space: 0, digit: 0, letter: 0, other: 0, chars: new Set<string>() }));
  for (const line of sample) {
    for (let position = 0; position < lineLength; position++) {
      const char = line[position];
      const stat = stats[position];
      stat[kindOf(char)]++;
      if (stat.chars.size <= 4) stat.chars.add(char ?? " ");
    }
  }
  const n = sample.length;
  const blank = (p: number) => stats[p].space / n;
  const digits = (p: number) => stats[p].digit / n;
  const letters = (p: number) => stats[p].letter / n;
  // A flag position: at most three different characters, none of them digits, and rarely blank.
  // A constant position (one character) is part of a code or padding, never a flag of its own.
  const flag = (p: number) => stats[p].chars.size >= 2 && stats[p].chars.size <= 3 && stats[p].digit === 0 && blank(p) < 0.5;
  const starts = new Set<number>([1]);
  for (let p = 1; p < lineLength; p++) {
    const before = p - 1;
    // Padding ends: a left-aligned field (its blanks belong to it) is followed by one that is nearly always filled.
    if (blank(before) >= 0.5 && blank(p) < 0.2) starts.add(p + 1);
    // A run of digits ends in something that is nearly always filled and not a digit (a number right before a code).
    if (digits(before) >= 0.98 && digits(p) < 0.5 && blank(p) < 0.2) starts.add(p + 1);
    // Mostly digits, then always letters: a code followed by a unit.
    if (digits(before) >= 0.5 && letters(p) >= 0.98) starts.add(p + 1);
    if (flag(before) !== flag(p) || (flag(before) && flag(p))) starts.add(p + 1);
  }
  return cleanStarts([...starts], lineLength);
}
