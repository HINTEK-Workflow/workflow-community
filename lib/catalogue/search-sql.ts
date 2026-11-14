import { Prisma } from "@prisma/client";
import { articleNoCore, digitsOf, gtinOf, normalizeArticleNo } from "@/lib/catalogue/normalize";
import { foldText } from "@/lib/search/normalize";
import { trigramSql } from "@/lib/search/trgm-sql";

/**
 * Artikelsökningen (prisfiler etapp 1, 2026-10-12): one query over the company's articles, ranked, grouped into
 * products (the same E-nummer or RSK-nummer at several suppliers is one product), bounded. Pure, so the SQL is tested
 * without a database; lib/catalogue/search.ts runs it.
 *
 * Matching: every word of the query must be in the article's folded search text (name, the supplier's article number
 * as written and normalised, the manufacturer's number, E-nummer, RSK-nummer) – which the trigram index serves – or,
 * for a word with a digit, be the article number without leading zeros or an E in front ("articleNoCore", a B-tree).
 * The "typo" pass also lets a word of four or more letters be similar (pg_trgm word_similarity) when the first pass
 * found too little.
 *
 * Ranking: an exact article number, E-nummer, RSK-nummer or manufacturer's number first; then an article number that
 * starts with the query; then the name starting with the query; then how many words start a word in the text; then
 * similarity; shorter names before longer ones. Words and numbers are always parameters, never SQL text.
 */
export const ARTICLE_SEARCH_MAX_WORDS = 6;
export const ARTICLE_SEARCH_MAX_LIMIT = 50;
/** A query word must be this similar to a word of the article (typing errors); higher than Sök's, the register is large. */
export const ARTICLE_TYPO_SIMILARITY = 0.5;

const likeEscape = (value: string) => value.replace(/[\\%_]/g, "\\$&");
const TRUE = Prisma.sql`TRUE`;
const and = (parts: Prisma.Sql[]) => (parts.length ? Prisma.sql`(${Prisma.join(parts, " AND ")})` : TRUE);
const or = (parts: Prisma.Sql[]) => Prisma.sql`(${Prisma.join(parts, " OR ")})`;

export type ArticleQueryWord = { text: string; norm: string; core: string; digits: string; idLike: boolean; fuzzy: boolean;
  /** The word as a GTIN/EAN (14 digits) when it is one with a right check digit (2026-10-14), otherwise "". */
  gtin: string };
export type ArticleQuery = { folded: string; words: ArticleQueryWord[] };

/** The words of a query, folded, with the forms an article number can take. */
export function parseArticleQuery(query: string): ArticleQuery {
  const folded = foldText(query.trim().slice(0, 120)).replace(/\s+/g, " ");
  const words = folded.split(" ").filter(Boolean).slice(0, ARTICLE_SEARCH_MAX_WORDS).map((text) => {
    const word = text.slice(0, 60);
    const idLike = /\d/.test(word);
    return { text: word, norm: normalizeArticleNo(word), core: idLike ? articleNoCore(word) : "", digits: idLike ? digitsOf(word) : "", idLike, fuzzy: !idLike && word.length >= 4, gtin: idLike ? gtinOf(word) : "" };
  });
  return { folded, words };
}

export type ArticleSearchSqlInput = {
  organizationId: string;
  query: ArticleQuery;
  supplierId?: string | null;
  limit: number;
  mode: "match" | "typo";
  /** pg_trgm's schema for the typo pass (null: no typo pass). */
  trigram?: string | null;
};

/** The row the search query returns: the best article of each product (or of each supplier-only article). */
export type ArticleSearchRow = { id: string; productId: string | null; score: number; exact: boolean; total: number };

export function buildArticleSearchSql(input: ArticleSearchSqlInput): Prisma.Sql {
  const { organizationId, query } = input;
  const limit = Math.max(1, Math.min(ARTICLE_SEARCH_MAX_LIMIT, Math.trunc(input.limit)));
  const trgm = input.mode === "typo" && input.trigram ? trigramSql(input.trigram) : null;
  const text = Prisma.sql`a."searchText"`;
  const wordMatch = (word: ArticleQueryWord): Prisma.Sql => {
    const parts = [Prisma.sql`${text} LIKE ${`%${likeEscape(word.text)}%`}`];
    // "ab-12" also meets "ab12" (the normalised number is in the search text).
    if (word.norm && word.norm !== word.text && word.norm.length >= 2) parts.push(Prisma.sql`${text} LIKE ${`%${likeEscape(word.norm)}%`}`);
    if (word.idLike && word.core) parts.push(Prisma.sql`a."articleNoCore" = ${word.core}`);
    if (word.gtin) parts.push(Prisma.sql`a."gtin" = ${word.gtin}`);
    if (trgm && word.fuzzy) parts.push(trgm.wordSimilar(word.text, text));
    return or(parts);
  };
  const exactParts = query.words.filter((word) => word.idLike || word.norm.length >= 4).flatMap((word) => [
    Prisma.sql`a."articleNoNorm" = ${word.norm}`,
    ...(word.core ? [Prisma.sql`a."articleNoCore" = ${word.core}`] : []),
    ...(word.digits.length === 7 ? [Prisma.sql`a."eNumber" = ${word.digits}`, Prisma.sql`a."rskNumber" = ${word.digits}`] : []),
    ...(word.gtin ? [Prisma.sql`a."gtin" = ${word.gtin}`] : []),
    Prisma.sql`regexp_replace(lower(a."manufacturerArticleNo"), '[^a-z0-9]', '', 'g') = ${word.norm}`,
  ]);
  const exact = exactParts.length ? or(exactParts) : Prisma.sql`FALSE`;
  const first = query.words[0];
  const prefix = first && (first.idLike || first.norm.length >= 3) ? Prisma.sql`(a."articleNoNorm" LIKE ${`${likeEscape(first.norm)}%`})` : Prisma.sql`FALSE`;
  const starts = query.words.length
    ? Prisma.sql`(${Prisma.join(query.words.map((word) => Prisma.sql`(CASE WHEN (' ' || ${text}) LIKE ${`% ${likeEscape(word.text)}%`} THEN 1 ELSE 0 END)`), " + ")})`
    : Prisma.sql`0`;
  const similarity = trgm && query.words.some((word) => word.fuzzy)
    ? Prisma.sql`greatest(${Prisma.join(query.words.filter((word) => word.fuzzy).map((word) => trgm.wordSimilarity(word.text, text)))})`
    : Prisma.sql`0`;
  const score = Prisma.sql`(CASE WHEN ${exact} THEN 1000 ELSE 0 END + CASE WHEN ${prefix} THEN 300 ELSE 0 END
    + CASE WHEN ${text} LIKE ${`${likeEscape(query.folded)}%`} THEN 200 ELSE 0 END + 40 * ${starts} + 100 * ${similarity})`;
  const where = and([
    Prisma.sql`a."organizationId" = ${organizationId}`,
    ...(input.supplierId ? [Prisma.sql`a."supplierId" = ${input.supplierId}`] : []),
    ...query.words.map(wordMatch),
  ]);
  return Prisma.sql`
    WITH m AS (
      SELECT a."id", a."productId", a."name", ${score} AS "score", ${exact} AS "exact"
      FROM "CatalogueArticle" a
      WHERE ${where}),
    g AS (
      SELECT DISTINCT ON (coalesce(m."productId", m."id")) m."id", m."productId", m."name", m."score", m."exact"
      FROM m ORDER BY coalesce(m."productId", m."id"), m."score" DESC, length(m."name"), m."id")
    SELECT g."id", g."productId", g."score"::float AS "score", g."exact", count(*) OVER()::int AS "total"
    FROM g ORDER BY g."score" DESC, length(g."name"), g."name", g."id"
    LIMIT ${limit}`;
}

/** A hit of the search below: a row's supplier and article, its score and how many were found. */
export type FilePriceSearchRow = { supplierId: string; articleKey: string; score: number; exact: boolean; total: number };

/** A word of the query in a price row of a file (`f`): in its search text, or – for a number – the number itself, the same forms as the company's own articles. */
const fileWordMatch = (word: ArticleQueryWord): Prisma.Sql => or([
  Prisma.sql`f."searchText" LIKE ${`%${likeEscape(word.text)}%`}`,
  ...(word.norm && word.norm !== word.text && word.norm.length >= 2 ? [Prisma.sql`f."searchText" LIKE ${`%${likeEscape(word.norm)}%`}`] : []),
  ...(word.idLike && word.core ? [Prisma.sql`ltrim(f."articleNoNorm", '0') = ${word.core}`] : []),
  ...(word.gtin ? [Prisma.sql`f."gtin" = ${word.gtin}`] : []),
]);

/**
 * Prisfil utan grossistens katalog (produktägaren 2026-11-01): the same words and the same score as `buildArticleSearchSql`, so these rows rank beside the
 * company's own articles and the register by one rule. Always within one company's rows (its limit bounds the scan; no index shared with other
 * companies), only finished imports, one hit per supplier and article. There is no typo pass: it would scan the company's rows once more for every search.
 */
export function buildFilePriceSearchSql(input: { organizationId: string; query: ArticleQuery; supplierId?: string | null; limit: number }): Prisma.Sql {
  const { query } = input;
  const limit = Math.max(1, Math.min(ARTICLE_SEARCH_MAX_LIMIT, Math.trunc(input.limit)));
  const text = Prisma.sql`f."searchText"`;
  const exactParts = query.words.filter((word) => word.idLike || word.norm.length >= 4).flatMap((word) => [
    Prisma.sql`f."articleNoNorm" = ${word.norm}`,
    ...(word.core ? [Prisma.sql`ltrim(f."articleNoNorm", '0') = ${word.core}`] : []),
    ...(word.digits.length === 7 ? [Prisma.sql`f."eNumber" = ${word.digits}`, Prisma.sql`f."rskNumber" = ${word.digits}`] : []),
    ...(word.gtin ? [Prisma.sql`f."gtin" = ${word.gtin}`] : []),
    Prisma.sql`regexp_replace(lower(f."manufacturerArticleNo"), '[^a-z0-9]', '', 'g') = ${word.norm}`,
  ]);
  const exact = exactParts.length ? or(exactParts) : Prisma.sql`FALSE`;
  const first = query.words[0];
  const prefix = first && (first.idLike || first.norm.length >= 3) ? Prisma.sql`(f."articleNoNorm" LIKE ${`${likeEscape(first.norm)}%`})` : Prisma.sql`FALSE`;
  const starts = query.words.length
    ? Prisma.sql`(${Prisma.join(query.words.map((word) => Prisma.sql`(CASE WHEN (' ' || ${text}) LIKE ${`% ${likeEscape(word.text)}%`} THEN 1 ELSE 0 END)`), " + ")})`
    : Prisma.sql`0`;
  const score = Prisma.sql`(CASE WHEN ${exact} THEN 1000 ELSE 0 END + CASE WHEN ${prefix} THEN 300 ELSE 0 END + CASE WHEN ${text} LIKE ${`${likeEscape(query.folded)}%`} THEN 200 ELSE 0 END + 40 * ${starts})`;
  const where = and([
    Prisma.sql`f."organizationId" = ${input.organizationId}`,
    ...(input.supplierId ? [Prisma.sql`f."supplierId" = ${input.supplierId}`] : []),
    ...query.words.map(fileWordMatch),
  ]);
  return Prisma.sql`
    WITH m AS (
      SELECT f."supplierId", f."articleKey", f."name", ${score} AS "score", ${exact} AS "exact"
      FROM "CatalogueFilePrice" f
      JOIN "CatalogueImport" i ON i."id" = f."importId" AND i."organizationId" = f."organizationId" AND i."contentHash" <> ''
      WHERE ${where}),
    g AS (
      SELECT DISTINCT ON (m."supplierId", m."articleKey") m."supplierId", m."articleKey", m."name", m."score", m."exact"
      FROM m ORDER BY m."supplierId", m."articleKey", m."score" DESC)
    SELECT g."supplierId", g."articleKey", g."score"::float AS "score", g."exact", count(*) OVER()::int AS "total"
    FROM g ORDER BY g."score" DESC, length(g."name"), g."name", g."supplierId", g."articleKey"
    LIMIT ${limit}`;
}

/** One page of a company's rows from files by name, each article once, with the total: the Import page's list. "unmatched" = no common number. */
export function buildFilePricePageSql(input: { organizationId: string; query: ArticleQuery | null; supplierId?: string | null; filter: "" | "unmatched"; skip: number; take: number }): Prisma.Sql {
  const where = and([
    Prisma.sql`f."organizationId" = ${input.organizationId}`,
    ...(input.supplierId ? [Prisma.sql`f."supplierId" = ${input.supplierId}`] : []),
    ...(input.filter === "unmatched" ? [Prisma.sql`f."productKey" = ''`] : []),
    ...(input.query?.words ?? []).map(fileWordMatch),
  ]);
  return Prisma.sql`
    WITH g AS (
      SELECT DISTINCT ON (f."supplierId", f."articleKey") f."supplierId", f."articleKey", f."name"
      FROM "CatalogueFilePrice" f
      JOIN "CatalogueImport" i ON i."id" = f."importId" AND i."organizationId" = f."organizationId" AND i."contentHash" <> ''
      WHERE ${where}
      ORDER BY f."supplierId", f."articleKey", (f."priceKind" = 'NET') DESC, f."createdAt" DESC)
    SELECT g."supplierId", g."articleKey", count(*) OVER()::int AS "total" FROM g
    ORDER BY g."name", g."supplierId", g."articleKey" OFFSET ${Math.max(0, Math.trunc(input.skip))} LIMIT ${Math.max(1, Math.min(100, Math.trunc(input.take)))}`;
}

/**
 * The catalogue page's article list for a search (2026-10-12): the same word matching (the trigram-indexed search text,
 * the number without leading zeros), ordered by name, one page at a time, with the number of articles found.
 */
export function buildArticlePageSql(input: { organizationId: string; query: ArticleQuery; supplierId?: string | null; skip: number; take: number }): Prisma.Sql {
  const text = Prisma.sql`a."searchText"`;
  const words = input.query.words.map((word) => or([
    Prisma.sql`${text} LIKE ${`%${likeEscape(word.text)}%`}`,
    ...(word.norm && word.norm !== word.text && word.norm.length >= 2 ? [Prisma.sql`${text} LIKE ${`%${likeEscape(word.norm)}%`}`] : []),
    ...(word.idLike && word.core ? [Prisma.sql`a."articleNoCore" = ${word.core}`] : []),
  ]));
  const where = and([Prisma.sql`a."organizationId" = ${input.organizationId}`, ...(input.supplierId ? [Prisma.sql`a."supplierId" = ${input.supplierId}`] : []), ...words]);
  return Prisma.sql`SELECT a."id", count(*) OVER()::int AS "total" FROM "CatalogueArticle" a WHERE ${where} ORDER BY a."name", a."id" OFFSET ${Math.max(0, Math.trunc(input.skip))} LIMIT ${Math.max(1, Math.min(100, Math.trunc(input.take)))}`;
}
