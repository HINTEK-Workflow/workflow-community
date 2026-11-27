import type { RatingRow } from "../engine";
import type { AmpacityTable, AmpacityMaterial } from "../company-data";

/**
 * The current ratings Iz the person types or pastes for Kabeldimensionering (Kalkylator, 2026-10-12): one line per
 * area, the area first and the current second, whatever separates them (space, tab, semicolon) and with a decimal comma or
 * point: "2,5  20", "4;27". The values are the person's own (or the company's table): Workflow delivers no table.
 */
export type ParsedRatings = { rows: RatingRow[]; skipped: number; duplicates: number };

export function parseRatings(text: string): ParsedRatings {
  const rows = new Map<number, number>();
  let skipped = 0;
  let duplicates = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const numbers = (line.match(/\d+(?:[.,]\d+)?/g) ?? []).map((part) => Number(part.replace(",", ".")));
    if (numbers.length < 2 || !(numbers[0] > 0) || !(numbers[1] > 0)) { skipped += 1; continue; }
    if (rows.has(numbers[0])) duplicates += 1;
    rows.set(numbers[0], numbers[1]);
  }
  return { rows: [...rows].map(([areaMm2, izA]) => ({ areaMm2, izA })).sort((a, b) => a.areaMm2 - b.areaMm2), skipped, duplicates };
}

/** The company's table for one material as rating rows. */
export const ratingsOfTable = (table: AmpacityTable | undefined, material: AmpacityMaterial): RatingRow[] => (table ? table[material].map((row) => ({ areaMm2: row.area, izA: row.amps })) : []);
