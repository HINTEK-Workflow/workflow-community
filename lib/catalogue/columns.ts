import { CATALOGUE_FIELDS, type PriceScale } from "@/lib/catalogue/fields";
import { eNumberFromArticleNo } from "@/lib/catalogue/normalize";
import { normalizeDate } from "@/lib/import/detect";
import { parsePrice, suggestCatalogueMapping, type CatalogueMapping, type CatalogueParseOptions } from "@/lib/catalogue/model";
import { E_NUMBER_SHARE } from "@/lib/catalogue/known-files";
import { priceKindOfHeading, type PriceKind } from "@/lib/catalogue/price-kind";
import type { PriceFileInfo } from "@/lib/catalogue/file/open";

/**
 * Kolumnförslag (prisfiler etapp 1, 2026-10-12): which column holds which field, from the headings first and
 * then from the content – rule based, never the AI (price files never go to the AI). The person sees each suggestion
 * with its reason and confirms it before anything is imported; the confirmed mapping is saved for the supplier.
 *
 * Content rules, on the first rows of the file (the Import page's sample):
 * - article number: nearly every value present, unique and short, without spaces inside;
 * - name: the column with the longest varied text that has letters and spaces;
 * - price: nearly every value a number ≥ 0, most with decimals – or a fixed-length run of digits with leading zeros,
 *   which is a price in whole hundredths (suggested with scale 100);
 * - unit: few different values of one to four letters;
 * - price date: eight digits starting 19/20, or a date.
 * A column the headings already gave is never taken again.
 */
export type ColumnSuggestion = { field: string; column: string; source: "heading" | "content"; reason: string };
export type ColumnSuggestions = {
  mapping: CatalogueMapping;
  suggestions: ColumnSuggestion[];
  /** The price column looks like whole hundredths (a fixed run of digits). */
  priceScale?: PriceScale;
  /** Most article numbers are seven digits (optionally E + seven digits): the supplier probably numbers by E-nummer – to confirm. */
  articleNoLooksLikeENumber?: { share: number };
  /** What the price column holds, from its heading (or the known layout): a base price before the discount, or a net price. */
  priceKind: PriceKind;
  /** A wholesaler layout the import knows: its name, to say why the columns were chosen. */
  variant?: string;
  /** A known layout's E-nummer rule, settled from the file (2026-10-14): nothing for the person to tick. */
  eNumber?: Pick<CatalogueParseOptions, "articleNoIsENumber" | "eNumberRule">;
};

/** How a file is parsed when the suggestion is taken as it is: the price scale, the price kind and the E-nummer rule. */
export function parseOfColumns(columns: ColumnSuggestions): CatalogueParseOptions {
  return { ...(columns.priceScale && columns.priceScale > 1 ? { priceScale: columns.priceScale } : {}), priceKind: columns.priceKind, ...(columns.eNumber ?? {}) };
}

type Stats = {
  index: number; header: string; filled: number; distinct: number; unique: number;
  numeric: number; decimals: number; digitsOnly: number; sameLength: boolean; leadingZero: number;
  avgLength: number; letters: number; spaces: number; date: number; shortLetters: number; e7: number;
};

const SAMPLE = 2000;
const share = (part: number, whole: number) => (whole ? part / whole : 0);
const percent = (value: number) => `${Math.round(value * 100)} %`;

function statsOf(headers: string[], rows: readonly (readonly string[])[]): Stats[] {
  const sample = rows.slice(0, SAMPLE);
  return headers.map((header, index) => {
    const values = sample.map((row) => (row[index] ?? "").trim()).filter(Boolean);
    const n = values.length;
    const set = new Set(values);
    let numeric = 0; let decimals = 0; let digitsOnly = 0; let leadingZero = 0; let length = 0; let letters = 0; let spaces = 0; let date = 0; let shortLetters = 0; let e7 = 0;
    const lengths = new Set<number>();
    for (const value of values) {
      const price = parsePrice(value);
      if (price.state === "ok" && price.value >= 0) { numeric++; if (/[.,]\d{1,4}$/.test(value)) decimals++; }
      if (/^\d+$/.test(value)) { digitsOnly++; if (value.length > 1 && value[0] === "0") leadingZero++; }
      lengths.add(value.length);
      length += value.length;
      if (/\p{L}/u.test(value)) letters++;
      if (/\S\s+\S/.test(value)) spaces++;
      if ((/^(19|20)\d{6}$/.test(value) && normalizeDate(value)) || /^\d{4}-\d{2}-\d{2}/.test(value)) date++;
      if (/^\p{L}{1,4}\d?$/u.test(value)) shortLetters++;
      if (eNumberFromArticleNo(value)) e7++;
    }
    return { index, header, filled: share(n, sample.length), distinct: set.size, unique: share(set.size, n), numeric: share(numeric, n), decimals: share(decimals, n), digitsOnly: share(digitsOnly, n), sameLength: lengths.size === 1 && n > 0, leadingZero: share(leadingZero, n), avgLength: n ? length / n : 0, letters: share(letters, n), spaces: share(spaces, n), date: share(date, n), shortLetters: share(shortLetters, n), e7: share(e7, n) };
  });
}

/** Suggested columns for a price file: the headings' aliases, then the content for the fields still open. */
export function suggestCatalogueColumns(headers: string[], rows: readonly (readonly string[])[], info?: Pick<PriceFileInfo, "variant">): ColumnSuggestions {
  // A known wholesaler layout (2026-10-13 natt) names its columns itself: nothing is guessed.
  const variant = info?.variant;
  if (variant) {
    const mapping: CatalogueMapping = {};
    const suggestions: ColumnSuggestion[] = [];
    for (const [field, index] of Object.entries(variant.fields)) if (index >= 0 && headers[index]) { mapping[field] = headers[index]; suggestions.push({ field, column: headers[index], source: "heading", reason: variant.label }); }
    // The E-nummer (2026-10-14): always the article number, by an area column, or when most article numbers are seven digits.
    let eNumber: ColumnSuggestions["eNumber"];
    const rule = variant.eNumber;
    if (rule === "always") eNumber = { articleNoIsENumber: true };
    else if (rule && typeof rule === "object") eNumber = headers.some((header) => header.trim().toLowerCase() === rule.column.toLowerCase()) ? { eNumberRule: { column: headers.find((header) => header.trim().toLowerCase() === rule.column.toLowerCase())!, values: rule.values } } : undefined;
    else if (rule === "share" && mapping.articleNo) {
      const article = statsOf(headers, rows).find((stat) => stat.header === mapping.articleNo);
      if (article && article.e7 >= E_NUMBER_SHARE) eNumber = { articleNoIsENumber: true };
    }
    return { mapping, suggestions, ...(variant.priceScale > 1 ? { priceScale: variant.priceScale } : {}), priceKind: variant.priceKind, variant: variant.label, ...(eNumber ? { eNumber } : {}) };
  }
  const byHeading = suggestCatalogueMapping(headers);
  const mapping: CatalogueMapping = { ...byHeading };
  const suggestions: ColumnSuggestion[] = [];
  const label = (key: string) => CATALOGUE_FIELDS.find((field) => field.key === key)?.label ?? key;
  for (const [field, column] of Object.entries(byHeading)) if (column) suggestions.push({ field, column, source: "heading", reason: `rubriken ”${column}”` });
  const stats = statsOf(headers, rows);
  const taken = new Set(Object.values(mapping).filter(Boolean) as string[]);
  const free = () => stats.filter((stat) => !taken.has(stat.header) && stat.filled > 0);
  const take = (field: string, stat: Stats, reason: string) => { mapping[field] = stat.header; taken.add(stat.header); suggestions.push({ field, column: stat.header, source: "content", reason }); };
  let priceScale: PriceScale | undefined;

  // Dates first: eight-digit dates are numbers too and must not be read as prices or article numbers.
  if (!mapping.priceDate) {
    const date = free().filter((stat) => stat.date >= 0.9).sort((a, b) => b.date - a.date)[0];
    if (date) take("priceDate", date, `${percent(date.date)} av värdena är datum`);
  }
  if (!mapping.articleNo && !mapping.eNumber) {
    const candidates = free().filter((stat) => stat.filled >= 0.95 && stat.unique >= 0.95 && stat.avgLength >= 3 && stat.avgLength <= 20 && stat.spaces <= 0.05);
    // The leftmost such column: a supplier puts its own number first.
    const article = candidates.sort((a, b) => a.index - b.index)[0];
    if (article) take("articleNo", article, `${percent(article.unique)} unika, korta värden utan mellanslag`);
  }
  if (!mapping.name) {
    const name = free().filter((stat) => stat.letters >= 0.8 && stat.spaces >= 0.3 && stat.distinct >= 5).sort((a, b) => b.avgLength - a.avgLength)[0];
    if (name) take("name", name, `längst text (i snitt ${Math.round(name.avgLength)} tecken) med ord`);
  }
  if (!mapping.price) {
    const fixedDigits = (stat: Stats) => stat.digitsOnly >= 0.98 && stat.sameLength && stat.avgLength >= 8 && stat.leadingZero >= 0.5;
    const candidates = free().filter((stat) => stat.numeric >= 0.95 && stat.date < 0.5 && (stat.decimals >= 0.5 || fixedDigits(stat)));
    const price = candidates.sort((a, b) => b.decimals - a.decimals || b.distinct - a.distinct)[0];
    if (price) {
      if (price.decimals < 0.5 && fixedDigits(price)) { priceScale = 100; take("price", price, `siffror med fast längd (${Math.round(price.avgLength)}) och inledande nollor – troligen hundradelar, kontrollera priset i förhandsvisningen`); }
      else take("price", price, `${percent(price.numeric)} är tal, ${percent(price.decimals)} med decimaler`);
    }
  }
  if (!mapping.unit) {
    // A flag (J/N) has two values: never a unit (2026-10-13 natt: Ahlsell's text file got the unit "N" on every row).
    const unit = free().filter((stat) => stat.shortLetters >= 0.9 && stat.distinct >= 3 && stat.distinct <= 60 && stat.avgLength <= 4).sort((a, b) => b.distinct - a.distinct)[0];
    if (unit) take("unit", unit, `${unit.distinct} olika korta värden med bokstäver`);
  }
  const article = mapping.articleNo ? stats.find((stat) => stat.header === mapping.articleNo) : undefined;
  const result: ColumnSuggestions = { mapping, suggestions: suggestions.map((item) => ({ ...item, reason: item.reason || label(item.field) })), priceKind: priceKindOfHeading(mapping.price) };
  if (priceScale) result.priceScale = priceScale;
  if (article && !mapping.eNumber && article.e7 >= 0.6) result.articleNoLooksLikeENumber = { share: Math.round(article.e7 * 100) / 100 };
  return result;
}
