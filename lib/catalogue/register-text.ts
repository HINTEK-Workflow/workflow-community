import { foldText } from "@/lib/search/normalize";
import { articleNoCore, digitsOf, gtinOf, normalizeArticleNo } from "@/lib/catalogue/normalize";

/**
 * Gemensamt artikelregister (2026-10-17, docs/proposals/gemensamt-artikelregister-forslag-2026-10-17.md): the words
 * of a wholesaler's article and of a person's search, made the same way on both sides. Pure, so the sync, the search and
 * the tests read text identically.
 *
 * Tekniska skrivsätt: "3G2,5", "3G 2,5", "3x2,5" and "3G2.5" become "3g2.5"; "10 A" and "10A" become "10a"; "C 16" becomes
 * "c16"; "3-fas", "3 fas" and "3fas" become "3fas". The same steps run on the article's text when it is stored and on the
 * query before it is split into words, so they never cost storage and always meet.
 */
const UNITS = "ma|ka|a|kv|mv|v|kw|w|kva|va|hz|mm2|mm|cm|m|st|fas|pol|polig|vags|vag|ip";

export function technicalText(value: string): string {
  return foldText(value)
    .replace(/²/g, "2")
    .replace(/×/g, "x")
    // Decimal comma between digits is a decimal point.
    .replace(/(\d),(?=\d)/g, "$1.")
    // Conductors × area (a cable): "3g 2.5", "3 x 2.5", "3x2.5" → "3g2.5".
    .replace(/(^|[^\p{L}\p{N}.])(\d{1,2})\s*[gx]\s*(\d{1,3}(?:\.\d{1,2})?)(?![\d.]*\d)/gu, "$1$2g$3")
    // A number and its unit belong together: "10 a" → "10a", "3 - fas" → "3fas", "30 ma" → "30ma".
    .replace(new RegExp(`(\\d)\\s*-?\\s*(${UNITS})(?![\\p{L}\\p{N}])`, "gu"), "$1$2")
    // A breaker's characteristic and rating, and a protection class: "c 16" → "c16" (B, C, D and K curves), "ip 44" → "ip44".
    .replace(/(^|[^\p{L}\p{N}])([bcdk]|ip)\s+(\d{1,3})(?!\d)/gu, "$1$2$3")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Synonymer vid sökning, inte i lagringen: a short Workflow list widens a query word to its other names. A word of a group
 * matches an article that has any word of the group. Folded and in technical form, like the text they meet.
 */
export const REGISTER_SYNONYMS: readonly (readonly string[])[] = [
  ["automatsakring", "dvargbrytare", "mcb", "sakringsautomat", "ledningsskyddsbrytare"],
  ["jordfelsbrytare", "jfb", "rcd"],
  ["jordfelsautomat", "rcbo", "kombibrytare"],
  ["trefas", "3fas", "3pol", "3polig"],
  ["enfas", "1fas", "1pol", "1polig"],
  ["motorskydd", "motorskyddsbrytare"],
  ["kontaktor", "kontaktorer", "magnetkontaktor"],
  ["installationskabel", "kabel"],
  ["kopplingsdosa", "dosa", "apparatdosa"],
  ["vagguttag", "uttag"],
  ["stromstallare", "brytare"],
];
const SYNONYMS = new Map<string, readonly string[]>(REGISTER_SYNONYMS.flatMap((group) => group.map((word) => [word, group] as const)));

/** The query as technical text, before splitting: at most this many words and characters, as the company search. */
export const REGISTER_MAX_WORDS = 6;

export type RegisterQueryWord = {
  text: string;
  /** The word and its synonyms, each to be found in the article's search text. */
  alternatives: string[];
  norm: string; core: string; digits: string; idLike: boolean; fuzzy: boolean;
  /** The word as a GTIN/EAN (14 digits) when it is one with a right check digit. */
  gtin: string;
};
export type RegisterQuery = { folded: string; words: RegisterQueryWord[] };

export function parseRegisterQuery(query: string): RegisterQuery {
  const folded = technicalText(query.trim().slice(0, 120));
  const words = folded.split(" ").filter(Boolean).slice(0, REGISTER_MAX_WORDS).map((raw): RegisterQueryWord => {
    const text = raw.slice(0, 60);
    const idLike = /\d/.test(text);
    const group = SYNONYMS.get(text);
    return {
      text, alternatives: group ? [...new Set([text, ...group])] : [text],
      norm: normalizeArticleNo(text), core: idLike ? articleNoCore(text) : "", digits: idLike ? digitsOf(text) : "", idLike,
      fuzzy: !idLike && text.length >= 4, gtin: idLike ? gtinOf(text) : "",
    };
  });
  return { folded, words };
}

/** The register's fields that make an article's search text. */
export type RegisterTextFields = {
  name: string; description: string; productType: string; manufacturer: string; series: string;
  articleNo: string; eNumber: string; manufacturerArticleNo: string;
};

/**
 * En söktext per artikel: name, description, product type, brand, series and the numbers in one short folded text in
 * technical form (about 150 characters). The name comes first, so "the name starts with the query" is a prefix test.
 */
export function registerSearchText(fields: RegisterTextFields): string {
  const mpnNorm = normalizeArticleNo(fields.manufacturerArticleNo);
  return technicalText([
    fields.name, fields.description, fields.productType, fields.manufacturer, fields.series,
    fields.manufacturerArticleNo, mpnNorm !== foldText(fields.manufacturerArticleNo) ? mpnNorm : "", fields.eNumber, fields.articleNo,
  ].filter(Boolean).join(" ")).slice(0, 600);
}
