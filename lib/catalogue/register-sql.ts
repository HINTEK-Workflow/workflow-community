import { Prisma } from "@prisma/client";
import { trigramSql } from "@/lib/search/trgm-sql";
import type { RegisterQuery, RegisterQueryWord } from "@/lib/catalogue/register-text";

/**
 * Sökningen i det gemensamma registret (2026-10-17): the same engine as the company's article search
 * (lib/catalogue/search-sql.ts) on the shared WholesaleArticle table – every word (or one of its synonyms) must be in the
 * article's search text, which the trigram index serves; a number may instead be the article's E-nummer, GTIN, the
 * wholesaler's own number or the manufacturer's number. Pure, so the SQL is tested without a database.
 *
 * Ranking: an exact number first, then the name starting with the query, then how many words start a word in the text,
 * then similarity (the typo pass); shorter names before longer ones. Obsolete articles (Solar status 40) and the rows a
 * full import has not finished are never found – except, in the company's own search (`priced`), an obsolete article the
 * company has a price on (2026-10-17). Words and numbers are always parameters, never SQL text.
 */
export const REGISTER_SEARCH_MAX_LIMIT = 50;
export const REGISTER_TYPO_CANDIDATES = 2000;

const likeEscape = (value: string) => value.replace(/[\\%_]/g, "\\$&");
const or = (parts: Prisma.Sql[]) => Prisma.sql`(${Prisma.join(parts, " OR ")})`;

/** The rows of a register search: the article's id, its score and whether a number matched exactly. */
export type RegisterSearchRow = { id: string; score: number; exact: boolean; total: number };

/** Hidden from every search: obsolete at the wholesaler, or added by a full import that has not finished. */
export const REGISTER_VISIBLE = Prisma.sql`w."pendingRun" IS NULL AND w."status" <> '40'`;

/**
 * The company's own search of the register (priser mot grossistens katalogartikel, 2026-10-17): "bara artiklar jag har
 * pris på", an EXISTS on the company's WholesalePrice rows (index organizationId, seq, createdAt). An obsolete article (status 40)
 * the company has a price on stays visible, so the price history is never hidden; `supplierId` = only through that supplier's
 * imports. In the typo pass the candidates are chosen by their words first and the price filter follows, so a misspelt word never
 * makes the database walk the whole register looking for the company's prices.
 */
export type RegisterPriced = { organizationId: string; supplierId?: string | null };

/** `EXISTS` a price of the company on the article `w` – company-bound, and through the supplier's imports when one is given. */
export function pricedExistsSql(priced: RegisterPriced): Prisma.Sql {
  const supplier = priced.supplierId
    ? Prisma.sql` AND EXISTS (SELECT 1 FROM "CatalogueImport" i WHERE i."id" = p."importId" AND i."organizationId" = p."organizationId" AND i."supplierId" = ${priced.supplierId})`
    : Prisma.empty;
  return Prisma.sql`EXISTS (SELECT 1 FROM "WholesalePrice" p WHERE p."organizationId" = ${priced.organizationId} AND p."seq" = w."seq"${supplier})`;
}

export function buildRegisterSearchSql(input: { query: RegisterQuery; limit: number; mode: "match" | "typo"; trigram?: string | null; wholesaler?: string; priced?: RegisterPriced }): Prisma.Sql {
  const { query } = input;
  const limit = Math.max(1, Math.min(REGISTER_SEARCH_MAX_LIMIT, Math.trunc(input.limit)));
  const price = input.priced ? pricedExistsSql(input.priced) : null;
  const trgm = input.mode === "typo" && input.trigram ? trigramSql(input.trigram) : null;
  const text = Prisma.sql`w."searchText"`;
  const numberParts = (word: RegisterQueryWord): Prisma.Sql[] => [
    ...(word.digits.length === 7 ? [Prisma.sql`w."eNumber" = ${word.digits}`] : []),
    ...(word.gtin ? [Prisma.sql`w."gtin" = ${word.gtin}`] : []),
    ...(word.idLike && word.digits.length >= 5 && word.digits === word.norm ? [Prisma.sql`w."articleNo" = ${word.digits}`] : []),
    ...(word.norm.length >= 4 && (word.idLike || word.norm.length >= 6) ? [Prisma.sql`w."mpnNorm" = ${word.norm}`] : []),
  ];
  const wordMatch = (word: RegisterQueryWord): Prisma.Sql => or([
    ...word.alternatives.map((alternative) => Prisma.sql`${text} LIKE ${`%${likeEscape(alternative)}%`}`),
    ...(word.norm && word.norm !== word.text && word.norm.length >= 2 ? [Prisma.sql`${text} LIKE ${`%${likeEscape(word.norm)}%`}`] : []),
    ...numberParts(word),
    ...(trgm && word.fuzzy ? [trgm.wordSimilar(word.text, text)] : []),
  ]);
  const exactParts = query.words.flatMap(numberParts);
  const exact = exactParts.length ? or(exactParts) : Prisma.sql`FALSE`;
  const starts = query.words.length
    ? Prisma.sql`(${Prisma.join(query.words.map((word) => Prisma.sql`(CASE WHEN ${or(word.alternatives.map((alternative) => Prisma.sql`(' ' || ${text}) LIKE ${`% ${likeEscape(alternative)}%`}`))} THEN 1 ELSE 0 END)`), " + ")})`
    : Prisma.sql`0`;
  const similarity = trgm && query.words.some((word) => word.fuzzy)
    ? Prisma.sql`greatest(${Prisma.join(query.words.filter((word) => word.fuzzy).map((word) => trgm.wordSimilarity(word.text, text)))})`
    : Prisma.sql`0`;
  const score = Prisma.sql`(CASE WHEN ${exact} THEN 1000 ELSE 0 END + CASE WHEN ${text} LIKE ${`${likeEscape(query.folded)}%`} THEN 200 ELSE 0 END + 40 * ${starts} + 100 * ${similarity})`;
  // The company's own search (match pass): an article it has a price on, obsolete or not; the others as everyone.
  const visible = price && !trgm ? Prisma.sql`w."pendingRun" IS NULL AND ${price}` : REGISTER_VISIBLE;
  const where = Prisma.join([visible, ...(input.wholesaler ? [Prisma.sql`w."wholesaler" = ${input.wholesaler}`] : []), ...query.words.map(wordMatch)], " AND ");
  // The typo pass is a fallback: it ranks at most REGISTER_TYPO_CANDIDATES similar articles, so a common misspelt word
  // never scores tens of thousands of rows while the person types (measured 2026-10-17: 2 s → well under a second at 500 000).
  const source = trgm
    ? Prisma.sql`(SELECT w.* FROM "WholesaleArticle" w WHERE ${where} LIMIT ${REGISTER_TYPO_CANDIDATES}) w${price ? Prisma.sql` WHERE ${price}` : Prisma.empty}`
    : Prisma.sql`"WholesaleArticle" w WHERE ${where}`;
  return Prisma.sql`
    WITH m AS (
      SELECT w."id", w."name", w."description", ${score} AS "score", ${exact} AS "exact"
      FROM ${source})
    SELECT m."id", m."score"::float AS "score", m."exact", count(*) OVER()::int AS "total"
    FROM m ORDER BY m."score" DESC, length(coalesce(nullif(m."description", ''), m."name")), m."name", m."id"
    LIMIT ${limit}`;
}
