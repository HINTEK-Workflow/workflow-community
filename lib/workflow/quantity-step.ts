import { tradeUnit } from "@/lib/catalogue/units";
import { parseAmount } from "@/lib/workflow/expenses";

/**
 * Justerare för antal (2026-10-18, beslut 13): − N + på en rad eller ett sökkort. Minska under `min` tar raden
 * bort (om sidan ger en borttagning, med Ångra), annars stannar antalet på `min`. Ren regel, delad av alla listor.
 */
export type QuantityStep = { kind: "set"; value: number } | { kind: "remove" } | { kind: "none" };

export function stepQuantity(value: number, delta: 1 | -1, options: { min?: number; max?: number; canRemove?: boolean } = {}): QuantityStep {
  const min = options.min ?? 1;
  const current = Number.isFinite(value) ? value : min;
  const next = current + delta;
  if (next < min) return options.canRemove ? { kind: "remove" } : { kind: "none" };
  if (options.max !== undefined && next > options.max) return { kind: "none" };
  return { kind: "set", value: next };
}

/** "Finns redan i listan – antal 2": the sentence when an article that is already in the list is added once more. */
export const alreadyInListText = (quantity: number) => `Finns redan i listan – antal ${quantity}.`;

/**
 * Artikelns enhet (2026-10-26): antalet står i artikelns egen enhet – st, m, förp … – från prisfilen eller
 * grossistens katalog (koder som MTR blir "m"); saknas den är det "st".
 */
export const articleUnit = (unit: string | null | undefined) => tradeUnit(unit) || "st";

/** Enheter som räknas i hela stycken: st och förp (och rulle, sats, par). Andra – m, kg, l … – tar decimaler (2,5 m). */
const WHOLE_UNITS = new Set(["st", "förp", "rulle", "sats", "par"]);
export const unitTakesDecimals = (unit: string | null | undefined) => !WHOLE_UNITS.has(articleUnit(unit));

/** Ett antal som det står ("2", "2,5"). */
export const quantityShown = (value: number) => String(Math.round(value * 100) / 100).replace(".", ",");

/**
 * Ett antal som skrivs direkt i − antal +: 0 tar bort raden, decimaler bara där enheten tar dem (m, inte st eller förp).
 * Svaret är talet, eller varför det inte går.
 */
export function typedQuantity(text: string, unit: string | null | undefined): { value: number } | { problem: string } {
  const value = parseAmount(text.trim());
  if (value === null || !Number.isFinite(value)) return { problem: "Skriv antalet som ett tal, till exempel 2 eller 2,5." };
  if (value < 0) return { problem: "Antalet kan inte vara mindre än 0." };
  if (value > 1_000_000) return { problem: "Antalet är för stort." };
  if (!unitTakesDecimals(unit) && !Number.isInteger(value)) return { problem: `Antal i ${articleUnit(unit)} är hela tal.` };
  return { value: Math.round(value * 100) / 100 };
}
