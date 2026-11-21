import { parseDecimal } from "@/lib/calculators/number";
import { CATALOGUE_FIELDS, type PriceScale } from "@/lib/catalogue/fields";
import { eNumberFromArticleNo, gtinOf } from "@/lib/catalogue/normalize";
import { mapFields, normalizeDate, normalizeHeader } from "@/lib/import/detect";
import { foldText } from "@/lib/search/normalize";
import type { PriceKind } from "@/lib/catalogue/price-kind";

/** Above this a price is unusual (a large energy store), shown as a warning – never stopped (2026-10-13 natt). */
export const HIGH_PRICE_WARNING = 10_000_000;
/** Above this the value cannot be stored (the price column has ten digits before the decimals). */
const MAX_STORABLE_PRICE = 9_999_999_999;

/**
 * Artiklar och priser, steg 1 (2026-10-08): a price file's rows → articles with a price. Pure, so the Import
 * page's preview and the server's import read a file the same way, and so it can be tested. The server always parses
 * again from the file's cells; what the browser shows is never trusted as the result.
 *
 * Prisfiler, etapp 1 (2026-10-12): the rows arrive one at a time (CatalogueRowParser), so a list of several
 * hundred thousand rows is checked without holding it; a duplicated article number is reported with both rows (the
 * same article twice, or two different products under one number – never dropped in silence); a row with more fields
 * than the headings (a separator inside a name shifts the fields) is listed as shifted; a price of 0 is imported but
 * flagged. The price column may be written in hundredths (`priceScale`), and the person may say that the supplier's
 * article number is the E-nummer (`articleNoIsENumber`: exactly seven digits, optionally with an E in front).
 */
export type CatalogueMapping = Record<string, string | null>;

/** UTGAR = going out while stock lasts (Rexel UL); PRIS_PA_BEGARAN = no list price, ask the wholesaler (Rexel PPB, Sonepar Påbeg J). */
export type ArticleStatus = "" | "UTGAR" | "PRIS_PA_BEGARAN";
export const ARTICLE_STATUS_TEXT: Record<Exclude<ArticleStatus, "">, string> = { UTGAR: "Utgår – så länge lagret räcker", PRIS_PA_BEGARAN: "Pris på begäran" };

/**
 * A quantity as the file writes it, as a decimal with a dot ("" when none or 0): "250", "4,2" → "4.2". A zero-padded
 * whole number of five or more digits is hundredths (Ahlsell's text file writes the multiple 4,2 as 0000420).
 */
export function quantityText(value: string): string {
  const text = value.trim().replace(/\s/g, "");
  if (!text) return "";
  if (/^0\d{4,}$/.test(text)) { const hundredths = Number(text) / 100; return hundredths > 0 ? String(hundredths) : ""; }
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) && number > 0 && number < 1_000_000 ? String(Math.round(number * 10_000) / 10_000) : "";
}

/** The status a file writes, in Workflow's two states; normal and anything unknown are "". */
export function articleStatusOf(status: string, priceOnRequest = ""): ArticleStatus {
  const code = status.trim().toUpperCase();
  if (/^(PPB|PRIS PÅ BEGÄRAN|PÅ BEGÄRAN)$/.test(code) || /^(J|JA|Y|YES|1)$/.test(priceOnRequest.trim().toUpperCase())) return "PRIS_PA_BEGARAN";
  if (/^(UL|U|UTGÅR|UTGÅENDE|UTGÅTT|UTG)$/.test(code)) return "UTGAR";
  return "";
}

/** Lagerförd as the file writes it: J/JA (Ahlsell) or L (Rexel: on a central stock) = "J", N = "N"; anything else – Rexel's A, whose meaning is not described – is left out. */
export function stockedOf(value: string): "" | "J" | "N" {
  const code = value.trim().toUpperCase();
  return /^(J|JA|L|Y|YES)$/.test(code) ? "J" : /^(N|NEJ|NO)$/.test(code) ? "N" : "";
}

/** Förpackning, multipel, minsta beställning, lagerförd och status of a row (2026-10-15). Shown, never used to recompute a price. */
export function articleExtras(values: { packageSize: string; orderMultiple: string; minOrderQuantity: string; stocked: string; status: string; priceOnRequest: string }) {
  return { packageSize: quantityText(values.packageSize), orderMultiple: quantityText(values.orderMultiple), minOrderQuantity: quantityText(values.minOrderQuantity),
    stocked: stockedOf(values.stocked), status: articleStatusOf(values.status, values.priceOnRequest) };
}
export type CatalogueRow = {
  /** The row as a person counts it in the file (header = row 1). */
  line: number;
  articleNo: string; eNumber: string; articleKey: string;
  /** The manufacturer's article number (2026-10-09), "" when the file has none. */
  manufacturerArticleNo: string;
  /** The RSK-nummer (VVS), digits only, "" when none (2026-10-12). */
  rskNumber: string;
  /** The GTIN/EAN (8–14 digits, check digit right) and the manufacturer's name, "" when none (2026-10-14). */
  gtin: string; manufacturer: string;
  name: string; unit: string;
  /** The supplier's discount group (Rabattgrupp/Produktgrupp), kept for steg 2's discount file; "" when none. */
  discountGroup: string;
  /** Förpackning, multipel och status (2026-10-15), "" when the file has none (`articleExtras`). */
  packageSize: string; orderMultiple: string; minOrderQuantity: string; stocked: "" | "J" | "N"; status: ArticleStatus;
  /** The price as written, SEK excluding VAT, for `perQuantity` units. */
  amount: number; perQuantity: number;
  /** amount / perQuantity, rounded to four decimals. */
  unitPrice: number;
  /** ÅÅÅÅ-MM-DD: the file's date, otherwise the import's. */
  priceDate: string;
  warnings: string[];
};
/** Why a row is not imported: an unreadable value, a duplicated article number, or fields shifted by a stray separator. */
export type CatalogueRowErrorKind = "invalid" | "duplicate" | "conflict" | "shifted";
export type CatalogueRowError = { line: number; message: string; kind?: CatalogueRowErrorKind };
export type CatalogueParse = {
  rows: CatalogueRow[]; errors: CatalogueRowError[];
  /** Fields that need a column before anything can be imported. */
  missing: string[];
  total: number;
};

export type CatalogueParseOptions = {
  /** The price column is in kronor (1) or whole hundredths/thousandths (100, 1000). */
  priceScale?: PriceScale;
  /** The supplier's article number is the E-nummer (seven digits, optionally "E" in front) when no E-nummer column says otherwise. */
  articleNoIsENumber?: boolean;
  /** What the file's prices are (2026-10-13 natt): the company's own net price, or the wholesaler's base price before the discount. */
  priceKind?: PriceKind;
  /**
   * The article number is the E-nummer on the rows whose column holds one of the values (2026-10-14: Solar's
   * Produktområde E or B) – also on a row with an RSK-nummer, since such a row is both. Before articleNoIsENumber.
   */
  eNumberRule?: { column: string; values: string[] };
};

/**
 * Rows read from one price file (prisfiler etapp 1, 2026-10-12): the largest supplier list measured has about
 * 293 000 rows; the files are read as a stream, so the limit is about time and the company's own register, not memory.
 * Other kinds of import keep 1 000 (MAX_TABLE_ROWS in lib/import/csv.ts).
 */
export const MAX_CATALOGUE_ROWS = 500_000;
/** Rows and errors shown in the preview; the counts always cover the whole file. */
export const CATALOGUE_PREVIEW_ROWS = 200;

export const suggestCatalogueMapping = (headers: string[]): CatalogueMapping => mapFields(CATALOGUE_FIELDS, headers);

/** The file's headings as one key, to recognise a supplier's file layout again. */
export const headerFingerprint = (headers: string[]) => headers.map(normalizeHeader).join("|").slice(0, 2000);

/** Whether a saved mapping fits these headings: every column it names is in the file, and the required ones are named. */
export function mappingFits(mapping: CatalogueMapping, headers: string[]): boolean {
  const set = new Set(headers);
  const named = Object.values(mapping).filter((value): value is string => Boolean(value));
  return named.length > 0 && named.every((header) => set.has(header)) && missingFields(mapping, headers).length === 0;
}

/** The required fields without a column: the name, the price, and an article number or an E-nummer. */
export function missingFields(mapping: CatalogueMapping, headers: string[]): string[] {
  const has = (key: string) => Boolean(mapping[key] && headers.includes(mapping[key]!));
  return [
    !has("articleNo") && !has("eNumber") ? "Artikelnummer eller E-nummer" : "",
    !has("name") ? "Benämning" : "",
    !has("price") ? "Pris" : "",
  ].filter(Boolean);
}

const UNITS: [RegExp, string][] = [
  [/^(st|st\.|stk|sts|styck|styck\.|pcs|pc|ea|each)$/, "st"],
  [/^(m|m\.|meter|mtr|metr)$/, "m"],
  [/^(m2|m²|kvm)$/, "m²"],
  [/^(m3|m³)$/, "m³"],
  [/^(km)$/, "km"],
  [/^(kg|kilo)$/, "kg"],
  [/^(g|gram)$/, "g"],
  [/^(l|liter|ltr)$/, "l"],
  [/^(förp|forp|fp|frp|förpackning)$/, "förp"],
  [/^(rle|rl|rul|rulle)$/, "rulle"],
  [/^(pkt|paket|pk|pak)$/, "paket"],
  [/^(pås|pse|påse|pase)$/, "påse"],
  [/^(tim|h|timme|timmar)$/, "h"],
  [/^(set|sat|sats)$/, "sats"],
  [/^(par)$/, "par"],
];

/** A unit as people write it → one way of writing it ("ST", "st.", "styck" → "st"; "M" → "m"); anything else as written. */
export function normalizeUnit(text: string): string {
  const plain = text.trim().toLowerCase();
  if (!plain) return "";
  return UNITS.find(([pattern]) => pattern.test(plain))?.[1] ?? text.trim().slice(0, 20);
}

/** A price as written in a file: "1 234,50", "12.5", "12,50 kr", "12:-" → a number; empty or unreadable → null. */
export function parsePrice(text: string): { state: "empty" } | { state: "ok"; value: number } | { state: "invalid" } {
  const cleaned = text.replace(/\s*(kr|sek)\.?\s*$/i, "").replace(/:-$/, "").trim();
  const parsed = parseDecimal(cleaned);
  return parsed;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** FNV-1a over a name: enough to tell "the same article again" from "another product under the same number". */
function nameHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}
const ERRORS_KEPT = 1000;

/**
 * The rows of one price file, checked one at a time. `push` returns the article row or null (the reason is in
 * `errors`, of which the first 1 000 are kept and all are counted). The article numbers seen are remembered with the
 * row and a short folded name, so a later row with the same number is reported against the first one.
 */
export class CatalogueRowParser {
  readonly missing: string[];
  readonly errors: CatalogueRowError[] = [];
  errorCount = 0;
  readonly errorsByKind: Record<CatalogueRowErrorKind, number> = { invalid: 0, duplicate: 0, conflict: 0, shifted: 0 };
  /** Rows with content (empty rows are not counted). */
  total = 0;
  accepted = 0;
  zeroPrices = 0;
  highPrices = 0;
  withCommonNumber = 0;
  withDiscountGroup = 0;
  private readonly columns: Record<string, number>;
  /** Article key → the first row and a hash of its folded name (a number: a kept string would keep its source text alive). */
  private readonly seen = new Map<string, { line: number; name: number }>();

  constructor(private readonly headers: string[], mapping: CatalogueMapping, private readonly today: string, private readonly options: CatalogueParseOptions = {}) {
    this.missing = missingFields(mapping, headers);
    const index = (key: string) => (mapping[key] ? headers.indexOf(mapping[key]!) : -1);
    this.columns = Object.fromEntries(CATALOGUE_FIELDS.map((field) => [field.key, index(field.key)]));
  }

  private fail(line: number, message: string, kind: CatalogueRowErrorKind = "invalid") {
    this.errorCount++;
    this.errorsByKind[kind]++;
    if (this.errors.length < ERRORS_KEPT) this.errors.push(kind === "invalid" ? { line, message } : { line, message, kind });
    return null;
  }

  /** One row of the file: `width` is how many fields it really had (trailing empty ones not counted). */
  push(line: number, row: readonly string[], width = row.length): CatalogueRow | null {
    if (!row.some((cell) => cell && cell.trim())) return null;
    this.total++;
    if (this.missing.length) return null;
    if (width > this.headers.length) {
      const preview = row.filter(Boolean).join(" · ").slice(0, 120);
      return this.fail(line, `raden har ${width} fält men rubriken ${this.headers.length} – en avgränsare i texten har troligen förskjutit fälten (${preview}). Rätta raden i filen eller importera utan den.`, "shifted");
    }
    const get = (key: string) => (this.columns[key] >= 0 ? String(row[this.columns[key]] ?? "").trim() : "");
    const warnings: string[] = [];

    const articleNo = get("articleNo").replace(/\s+/g, " ").slice(0, 60);
    let eNumber = "";
    const eText = get("eNumber");
    if (eText) {
      const digits = eText.replace(/[\s.-]/g, "").replace(/^[Ee](?=\d{7}$)/, "");
      if (!/^\d+$/.test(digits)) warnings.push(`E-nummer ”${eText.slice(0, 30)}” kan inte läsas – lämnas tomt`);
      else { eNumber = digits.slice(0, 20); if (digits.length !== 7) warnings.push(`E-nummer ”${eText.slice(0, 30)}” har inte 7 siffror`); }
    } else if (this.options.eNumberRule && articleNo) {
      const rule = this.options.eNumberRule;
      const at = this.headers.indexOf(rule.column);
      if (at >= 0 && rule.values.includes(String(row[at] ?? "").trim().toUpperCase())) eNumber = eNumberFromArticleNo(articleNo);
    } else if (this.options.articleNoIsENumber && articleNo && !get("rskNumber")) {
      // A row with an RSK-nummer is a plumbing article: its seven digits are the supplier's own, never an E-nummer.
      eNumber = eNumberFromArticleNo(articleNo);
    }
    if (!articleNo && !eNumber) return this.fail(line, "saknar artikelnummer och E-nummer");
    const name = get("name").replace(/\s+/g, " ").slice(0, 300);
    if (!name) return this.fail(line, "saknar benämning");

    const priceText = get("price");
    const price = parsePrice(priceText);
    if (price.state === "empty") return this.fail(line, "saknar pris");
    if (price.state === "invalid") return this.fail(line, `priset ”${priceText.slice(0, 30)}” kan inte läsas`);
    const scale = this.options.priceScale && this.options.priceScale > 1 ? this.options.priceScale : 1;
    const value = price.value / scale;
    if (value < 0) return this.fail(line, "negativt pris");
    if (value > MAX_STORABLE_PRICE) return this.fail(line, `priset ”${priceText.slice(0, 30)}” är för stort för att sparas`);
    if (value > HIGH_PRICE_WARNING) { warnings.push(`ovanligt högt pris (${Math.round(value).toLocaleString("sv-SE")} kr) – kontrollera att det är rätt`); this.highPrices++; }
    if (value === 0) { warnings.push("priset är 0 – kontrollera att artikeln har ett pris hos leverantören"); }

    let perQuantity = 1;
    const perText = get("perQuantity");
    if (perText) {
      const number = /\d+(?:[.,]\d+)?/.exec(perText.replace(/\s/g, ""))?.[0];
      const parsed = number ? parseDecimal(number) : { state: "invalid" as const };
      if (parsed.state !== "ok" || !Number.isInteger(parsed.value) || parsed.value < 1 || parsed.value > 100_000) return this.fail(line, `prisenheten ”${perText.slice(0, 30)}” kan inte läsas (ange t.ex. 1, 100 eller 1000)`);
      perQuantity = parsed.value;
    }

    let priceDate = this.today;
    const dateText = get("priceDate");
    if (dateText) {
      const date = normalizeDate(dateText);
      if (date) priceDate = date; else warnings.push(`prisdatumet ”${dateText.slice(0, 30)}” kan inte läsas – importdagen används`);
    }

    let rskNumber = "";
    const rskText = get("rskNumber");
    if (rskText) {
      const digits = rskText.replace(/[\s.-]/g, "");
      if (/^\d+$/.test(digits)) { rskNumber = digits.slice(0, 20); if (digits.length !== 7) warnings.push(`RSK-nummer ”${rskText.slice(0, 30)}” har inte 7 siffror`); }
      else warnings.push(`RSK-nummer ”${rskText.slice(0, 30)}” kan inte läsas – lämnas tomt`);
    }

    let gtin = "";
    const gtinText = get("gtin");
    if (gtinText) { gtin = gtinOf(gtinText); if (!gtin) warnings.push(`GTIN/EAN ”${gtinText.slice(0, 30)}” är inte ett giltigt nummer – lämnas tomt`); }
    const manufacturer = get("manufacturer").replace(/\s+/g, " ").slice(0, 120);
    const discountGroup = get("discountGroup").replace(/\s+/g, " ").slice(0, 40);
    const manufacturerArticleNo = get("manufacturerArticleNo").replace(/\s+/g, " ").slice(0, 60);
    const extras = articleExtras({ packageSize: get("packageSize"), orderMultiple: get("orderMultiple"), minOrderQuantity: get("minOrderQuantity"), stocked: get("stocked"), status: get("status"), priceOnRequest: get("priceOnRequest") });
    const articleKey = articleNo || `e:${eNumber}`;
    const key = articleKey.toLowerCase();
    const folded = nameHash(foldText(name).replace(/\s+/g, " "));
    const earlier = this.seen.get(key);
    if (earlier) {
      // The same article twice is a duplicate; two different names under one number are two products the supplier
      // gave the same number – both reported, the first one imported, until the supplier has settled which is right.
      if (earlier.name === folded) return this.fail(line, `samma artikel som rad ${earlier.line} (dubblett) – raden hoppas över`, "duplicate");
      return this.fail(line, `samma artikelnummer som rad ${earlier.line} men en annan produkt (”${name.slice(0, 60)}”) – bara rad ${earlier.line} importeras. Kontrollera numret med leverantören`, "conflict");
    }
    this.seen.set(key, { line, name: folded });

    this.accepted++;
    if (value === 0) this.zeroPrices++;
    if (discountGroup) this.withDiscountGroup++;
    if (/^\d{7}$/.test(eNumber) || /^\d{7}$/.test(rskNumber)) this.withCommonNumber++;
    const amount = round4(value);
    return {
      line, articleNo, eNumber, manufacturerArticleNo, rskNumber, gtin, manufacturer, articleKey, name, unit: normalizeUnit(get("unit")), discountGroup, ...extras,
      amount, perQuantity, unitPrice: round4(amount / perQuantity), priceDate, warnings,
    };
  }
}

/** The rows of a price file with the person's mapping: articles with a price, and the rows that cannot be imported. */
export function parseCatalogueRows(headers: string[], rows: string[][], mapping: CatalogueMapping, today: string, options: CatalogueParseOptions = {}): CatalogueParse {
  const parser = new CatalogueRowParser(headers, mapping, today, options);
  const result: CatalogueRow[] = [];
  rows.slice(0, MAX_CATALOGUE_ROWS).forEach((row, position) => {
    const parsed = parser.push(position + 2, row, row.length > headers.length ? widthOf(row) : row.length);
    if (parsed) result.push(parsed);
  });
  return { rows: result, errors: parser.errors, missing: parser.missing, total: parser.total };
}

const widthOf = (cells: readonly string[]) => { let width = cells.length; while (width > 0 && !(cells[width - 1] ?? "").trim()) width--; return width; };

/** An article already in the supplier's catalogue, with its latest price (null when it has none). */
export type ExistingArticle = { id: string; latest: { priceId: string; amount: number; perQuantity: number; priceKind?: PriceKind } | null };
export type CatalogueCounts = { newArticles: number; changedPrices: number; unchangedPrices: number };
export type CatalogueClassification = CatalogueCounts & {
  /** Rows for articles that do not exist yet: a new article with its first price. */
  created: CatalogueRow[];
  /** Existing articles whose price (amount or per-quantity) changed, or that had none: a new price row. */
  changed: { articleId: string; row: CatalogueRow }[];
  /** Existing articles whose latest price is the same: only a confirmation on the row's date, no new price row. */
  confirmed: { articleId: string; priceId: string; row: CatalogueRow }[];
};

/**
 * Pris ändrat (2026-10-08): the same price is the same amount for the same per-quantity, compared at the four
 * decimals the database keeps. The price date, name or unit never make a price "changed".
 */
export const samePrice = (latest: { amount: number; perQuantity: number }, row: Pick<CatalogueRow, "amount" | "perQuantity">) =>
  round4(latest.amount) === round4(row.amount) && Number(latest.perQuantity) === Number(row.perQuantity);

/**
 * A file's rows against the supplier's articles (keyed by articleKey): new articles, changed prices (a new price row)
 * and unchanged prices (a confirmation only). One pass over the rows and one map lookup per row, so 200 000 rows stay fast.
 */
export function classifyCatalogueRows(rows: CatalogueRow[], existing: Map<string, ExistingArticle>, priceKind: PriceKind = "NET"): CatalogueClassification {
  const result: CatalogueClassification = { newArticles: 0, changedPrices: 0, unchangedPrices: 0, created: [], changed: [], confirmed: [] };
  for (const row of rows) {
    const article = existing.get(row.articleKey);
    if (!article) { result.created.push(row); result.newArticles++; continue; }
    // A price of another kind (a base price where a net price was) is a new price, even with the same amount.
    if (article.latest && samePrice(article.latest, row) && (article.latest.priceKind ?? "NET") === priceKind) { result.confirmed.push({ articleId: article.id, priceId: article.latest.priceId, row }); result.unchangedPrices++; continue; }
    result.changed.push({ articleId: article.id, row });
    result.changedPrices++;
  }
  return result;
}

/**
 * The counts against one supplier from the matches the preview found: matched articles and how many kept their price.
 * `skipped` (2026-10-17): for a wholesaler's supplier the rows the import will not read (not in its catalogue) – they are no new articles.
 */
export function countsAgainst(rowCount: number, match: { matched: number; unchanged: number; skipped?: number } | undefined): CatalogueCounts {
  const matched = match?.matched ?? 0;
  const unchanged = match?.unchanged ?? 0;
  return { newArticles: Math.max(0, rowCount - matched - (match?.skipped ?? 0)), changedPrices: Math.max(0, matched - unchanged), unchangedPrices: unchanged };
}
