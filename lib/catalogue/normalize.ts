import { foldText } from "@/lib/search/normalize";

/**
 * Article numbers as the search compares them (prisfiler etapp 1, 2026-10-12). The same rules run in the
 * database: the trigger of migration 20261012170000_catalogue_products_search fills "articleNoNorm" and
 * "articleNoCore" with exactly these steps (tests/catalogue-normalize.test.ts keeps the two in step through the
 * integration test). The article number itself is always kept as the file wrote it.
 *
 * - norm: folded (lower case, å ä ö → a a o), only letters a–z and digits: "AB-12 34" → "ab1234".
 * - core: norm without a leading "e" before exactly seven digits (an E-nummer written "E1234567") and without leading
 *   zeros, so "0001234", "1234" and "E0001234" meet. A number of only zeros keeps one.
 */
export function normalizeArticleNo(value: string | null | undefined): string {
  return foldText(value ?? "").replace(/[^a-z0-9]/g, "");
}

export function articleNoCore(value: string | null | undefined): string {
  const norm = normalizeArticleNo(value);
  const plain = /^e\d{7}$/.test(norm) ? norm.slice(1) : norm;
  const stripped = plain.replace(/^0+/, "");
  return stripped || (plain ? "0" : "");
}

/** Digits only (E-nummer and RSK-nummer are numbers; separators and an "E" in front are not part of them). */
export const digitsOf = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/**
 * The common numbering systems a product is merged on (2026-10-14: also the GTIN/EAN and the manufacturer with the
 * manufacturer's article number, when there is no E-nummer). Never a supplier's own numbers or similar names.
 */
export type CommonNumberKind = "E" | "RSK" | "GTIN" | "MPN";
export type CommonNumber = { kind: CommonNumberKind; number: string };

/**
 * The common number of an article (2026-10-12, one register per company): its E-nummer when it has exactly
 * seven digits, otherwise its RSK-nummer when that has exactly seven digits; otherwise none – the article then stays a
 * product of its own supplier. The numbers come only from the company's own files (a mapped column, or the person's
 * choice that the supplier's article number is the E-nummer), never from a guess.
 */
export function commonNumberOf(article: { eNumber?: string; rskNumber?: string; gtin?: string }): CommonNumber | null {
  const e = digitsOf(article.eNumber);
  if (/^\d{7}$/.test(e)) return { kind: "E", number: e };
  const rsk = digitsOf(article.rskNumber);
  if (/^\d{7}$/.test(rsk)) return { kind: "RSK", number: rsk };
  const gtin = gtinOf(article.gtin ?? "");
  if (gtin) return { kind: "GTIN", number: gtin };
  return null;
}

/**
 * A GTIN/EAN as one way of writing it (2026-10-14): 8, 12, 13 or 14 digits with a right check digit, padded to 14 with
 * zeros in front (so an EAN-13 and the same GTIN-14 meet); "" for anything else, so a wrong number never joins products.
 */
export function gtinOf(value: string): string {
  const plain = (value ?? "").replace(/[\s-]/g, "");
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(plain) || /^0+$/.test(plain)) return "";
  const padded = plain.padStart(14, "0");
  let sum = 0;
  for (let index = 0; index < 13; index++) sum += Number(padded[index]) * (index % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(padded[13]) ? padded : "";
}

/**
 * The manufacturer with the manufacturer's article number as one key ("abb:s201c16"), or "" when either is missing or
 * the number is too short to mean one product. Folded like the search: case, å ä ö and separators do not matter; a
 * company form (AB, GmbH …) is left out so "Tillverkare AB" and "Tillverkare" meet.
 */
export function manufacturerKey(manufacturer: string | null | undefined, manufacturerArticleNo: string | null | undefined): string {
  const maker = foldText(manufacturer ?? "").replace(/\b(ab|as|gmbh|oy|ltd|inc|sverige|sweden)\b/g, "").replace(/[^a-z0-9]/g, "");
  const number = normalizeArticleNo(manufacturerArticleNo);
  return maker.length >= 2 && number.length >= 3 ? `${maker}:${number}`.slice(0, 120) : "";
}

/** "E 1234567" / "RSK 1234567": how a common number is shown. */
export const commonNumberText = (common: CommonNumber) => `${common.kind} ${common.number}`;

/**
 * Which product an article belongs to, in order (2026-10-14): the E-nummer, the RSK-nummer, the GTIN/EAN, the
 * manufacturer with the manufacturer's number. As "KIND:number", the key the import resolves products on.
 */
export function productKeyOf(article: { eNumber?: string; rskNumber?: string; gtin?: string; manufacturer?: string; manufacturerArticleNo?: string }): string | null {
  const common = commonNumberOf(article);
  if (common) return `${common.kind}:${common.number}`;
  const maker = manufacturerKey(article.manufacturer, article.manufacturerArticleNo);
  return maker ? `MPN:${maker}` : null;
}

/**
 * An E-nummer read from the supplier's article number, when the person said that the supplier numbers its electrical
 * articles by E-nummer: exactly seven digits, optionally with an "E" in front ("E1234567", "1234567"). Anything else
 * gives none, so a longer or shorter number never becomes an E-nummer.
 */
export function eNumberFromArticleNo(articleNo: string): string {
  const compact = articleNo.replace(/[\s-]/g, "");
  const match = /^[Ee]?(\d{7})$/.exec(compact);
  return match ? match[1] : "";
}
