import { normalizeHeader } from "@/lib/import/detect";
import type { WholesalerId } from "@/lib/wholesale/model";
import type { ENumberRule } from "@/lib/catalogue/known-files";

/**
 * Grundpris eller nettopris (2026-10-13 natt): the wholesalers' price lists hold their base price before the
 * customer's discount (Solar Listpris, Ahlsell GNP, Sonepar Gnp, Rexel GN-pris), not what the company pays. A price is
 * therefore marked with its kind when it is imported – chosen per file, suggested from the price column's heading – and
 * a base price is shown as "Grundpris – inte ert avtalspris" in the search and on the row it is copied to. The company's
 * markup is added as before. "Lägsta pris" only compares prices of the same kind (a net price before a base price).
 */
export const PRICE_KINDS = ["NET", "BASE"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];
export const PRICE_KIND_LABELS: Record<PriceKind, string> = {
  NET: "Ert nettopris (avtalspris)",
  BASE: "Grundpris före er rabatt (GNP, listpris)",
};
/** What a base price says wherever it is shown. */
export const BASE_PRICE_NOTE = "Grundpris – inte ert avtalspris";

const BASE_HEADINGS = new Set(["gnp", "gn pris", "gnpris", "grossistnettopris", "grossistpris", "listpris", "bruttopris", "brutto", "grundpris", "baspris", "list price", "gross price"].map(normalizeHeader));

/** The kind a price column's heading points to: a base price for GNP, Listpris and the like, otherwise a net price. */
export const priceKindOfHeading = (heading: string | null | undefined): PriceKind => (heading && BASE_HEADINGS.has(normalizeHeader(heading)) ? "BASE" : "NET");

export const isPriceKind = (value: unknown): value is PriceKind => value === "NET" || value === "BASE";

/**
 * Rabattbrev och avtalsfiler (2026-10-13 natt): a wholesaler's discount file is not a price list – it has discounts per
 * product group (and sometimes net prices per article) but no list of articles with prices. The import cannot read
 * one yet, so it is recognised and said in plain words instead of asking for columns that are not there. Recognised
 * from the shape alone: the headings of an agreement file (Kod/Produktgrupp/Rabatt …), or rows of a group code and a
 * discount (two or three short fields, the second a whole number of tenths of a percent or a percentage), or a
 * fixed-width file whose lines read as discount rows. Returns the reason, or null for an ordinary price list.
 */
export function rebateFileReason(input: { kind: "xlsx" | "delimited" | "fixed"; headers: string[]; hasHeader: boolean; lineLength?: number }, sample: readonly (readonly string[])[]): string | null {
  const headings = input.hasHeader ? input.headers.map(normalizeHeader) : [];
  const has = (pattern: RegExp) => headings.some((heading) => pattern.test(heading));
  // An agreement file with headings: discount columns and a group or code column, no list price.
  if (headings.length && has(/^(rabatt|rabatt ?2|artrabatt|tilläggsrabatt ?\d?|specrabatt|kedjerabatt)$/) && has(/^(kod|produktgrupp|materialgrupp|materialklass|mg|rabattgrupp)$/)
    && !has(/^(listpris|gnp|gn ?pris|grundpris|bruttopris|pris)$/)) return "Filen har kolumner för rabatter per produktgrupp men ingen prislista.";
  const rows = sample.filter((row) => row.some((cell) => cell.trim())).slice(0, 300);
  if (rows.length < 5) return null;
  const filled = (row: readonly string[]) => row.filter((cell) => cell.trim()).length;
  const group = (value: string) => /^[0-9A-ZÅÄÖ][0-9A-ZÅÄÖ\-.]{1,9}$/i.test(value.trim());
  const discount = (value: string) => /^\d{1,3}([.,]\d{1,2})?%?$/.test(value.trim()) && Number(value.replace(",", ".").replace("%", "")) <= 1000;
  // Rows of a group code and a discount: at most three fields, nothing that reads as a name.
  const short = rows.filter((row) => filled(row) <= 3 && group(row[0] ?? "") && discount(row[1] ?? "") && !row.some((cell) => /\p{L}\s+\p{L}/u.test(cell)));
  if (input.kind !== "xlsx" && short.length / rows.length >= 0.9) return "Raderna har en produktgrupp och en rabatt, men inga artiklar och priser.";
  // Text with "Rabatt" in the first rows (a discount letter's own heading line) and mostly short numeric rows.
  const text = rows.slice(0, 3).map((row) => row.join(" ")).join(" ").toLowerCase();
  if (/rabatt/.test(text) && /\bmg\b|materi[ae]lgrupp|produktgrupp/.test(text)) return "Filen ser ut som ett rabattbrev med rabatter per materielgrupp.";
  return null;
}

/** What the person is told about a recognised discount file, and what to do instead. */
export const REBATE_FILE_HELP = "Det här ser ut som ett rabattbrev eller en avtalsfil, inte en prislista. Rabattbrev kan inte läsas in ännu: importera grossistens prislista här. Priserna märks då som grundpris – inte ert avtalspris.";

/**
 * Kända filformer (2026-10-13 natt): a wholesaler file whose layout is known is read the right way at once, as data – not
 * an importer of its own. Ahlsell's text price list: 112 characters per row; article number 1–20, the base price in
 * öre 21–32, the material class 33–38, the unit 39–41, stocked (J/N) 42, the name 43–102, the multiple 103–109 and
 * three flags 110–112 – the same columns as Ahlsell's own Excel file of the list, in the same order. Derived from the
 * files themselves, not confirmed by Ahlsell.
 */
export type KnownFixedVariant = {
  id: string;
  label: string;
  wholesaler: WholesalerId;
  lineLength: number;
  starts: number[];
  /** Field → the column's index among `starts`. */
  fields: Record<string, number>;
  priceScale: 1 | 100 | 1000;
  priceKind: PriceKind;
  /** Whether the article number is the E-nummer (2026-10-14): the electrical list has seven digits, the others not. */
  eNumber?: ENumberRule;
  /** Whether the lines are this layout (whole lines of `lineLength` characters). */
  matches: (lines: readonly string[]) => boolean;
};

export const KNOWN_FIXED_VARIANTS: KnownFixedVariant[] = [{
  id: "ahlsell-txt",
  label: "Ahlsells prislista som textfil",
  wholesaler: "ahlsell",
  lineLength: 112,
  starts: [1, 21, 33, 39, 42, 43, 103, 110, 111, 112],
  // Multipel (positions 103–109) is written in hundredths (0000420 = 4,2); quantityText reads it so (2026-10-15).
  fields: { articleNo: 0, price: 1, discountGroup: 2, unit: 3, stocked: 4, name: 5, orderMultiple: 6 },
  priceScale: 100,
  priceKind: "BASE",
  eNumber: "share",
  matches: (lines) => {
    const sample = lines.filter((line) => line.length === 112).slice(0, 500);
    if (sample.length < 5) return false;
    const fits = sample.filter((line) => /^\S/.test(line) && /^\d{12}$/.test(line.slice(20, 32)) && /^[JN ]$/.test(line[41] ?? "") && /^[JN]{3}$/.test(line.slice(109, 112)) && /^\d{7}$/.test(line.slice(102, 109)));
    return fits.length / sample.length >= 0.95;
  },
}];

/**
 * A fixed-width discount file from its lines (2026-10-13 natt): rows of a material group and discounts in tenths of a
 * percent with zero-padded numbers (an agreement file), or a discount letter with "Mg" and "Rabatt" in its heading line
 * and percentages written 99.9. Null for anything else.
 */
export function rebateLinesReason(lines: readonly string[]): string | null {
  const sample = lines.filter((line) => line.trim()).slice(0, 500);
  if (sample.length < 5) return null;
  if (sample.slice(0, 3).some((line) => /\bmg\b/i.test(line) && /rabatt/i.test(line))) return "Filen ser ut som ett rabattbrev med rabatter per materielgrupp.";
  // Agreement rows: a two-digit row type, then fields of zero-padded digits for discounts and net prices.
  const agreement = sample.filter((line) => /^0[13]/.test(line) && /\d{4}\d{4}\d{9}/.test(line.slice(36, 53)));
  if (agreement.length / sample.length >= 0.8) return "Raderna har rabatter och nettopriser per materialklass eller artikel – en avtalsfil, inte en prislista.";
  // Discount rows with a validity period at the end (from and to, eight digits each) after a zero-padded discount.
  const dated = sample.filter((line) => /\b\d{10}\s+(19|20)\d{6}(19|20|99)\d{6}\s*$/.test(line));
  if (dated.length / sample.length >= 0.8) return "Raderna har rabatter med giltighetstid per produktgrupp – en avtalsfil, inte en prislista.";
  return null;
}
