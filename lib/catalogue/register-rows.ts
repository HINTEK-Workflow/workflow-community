import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { trigramSchema } from "@/lib/search/trgm";
import { ARTICLE_TYPO_SIMILARITY } from "@/lib/catalogue/search-sql";
import { parseRegisterQuery } from "@/lib/catalogue/register-text";
import { buildRegisterSearchSql, REGISTER_SEARCH_MAX_LIMIT, type RegisterSearchRow } from "@/lib/catalogue/register-sql";
import { catalogHitOf, parseWholesaleOfferId, registerJoinKeys, wholesaleOfferOf, type RegisterArticleRow } from "@/lib/catalogue/register-hit";
import { fileHitOf, fileOfferOf, fileWholesaleOffer, mergeWholesaleOffers, withFileOffers, type FilePriceRow } from "@/lib/catalogue/file-price-model";
import { fileOffersForRegister, filePricesByNumber, filePricesOfProducts, linkFileRows } from "@/lib/catalogue/file-prices";
import { withRebates } from "@/lib/catalogue/rebate-server";
import type { CatalogueHit, CatalogueOffer } from "@/lib/catalogue/snapshot";
import { wholesaleOffers, type WholesaleOffer } from "@/lib/catalogue/wholesale-read";

/**
 * The register's rows and the company's prices on them, read from the database (2026-10-17): the shared, price-free
 * register of the wholesalers' catalogues (WholesaleArticle) searched and fetched, and – company-bound – the company's own
 * prices on those articles (WholesalePrice, lib/catalogue/wholesale-read.ts) turned into priced offers (register-hit.ts).
 * The register is global; every query that reads a price carries the company, and another company's price is never joined.
 */
export const REGISTER_ROWS = 40;
const SELECT_ARTICLE = Prisma.raw(`w."id", w."seq", w."wholesaler", w."articleNo", w."eNumber", w."gtin", w."manufacturer", w."manufacturerArticleNo", w."name", w."description", w."productType", w."series", w."unit", w."status", w."productKey"`);

let presence: { at: number; has: boolean } | null = null;

/** Whether the register has any article at all (kept a minute): without one the search is the company's own, as before. */
export async function registerHasArticles(now = Date.now()): Promise<boolean> {
  if (presence && now - presence.at < 60_000) return presence.has;
  const row = await prisma.wholesaleArticle.findFirst({ where: { pendingRun: null }, select: { id: true } });
  presence = { at: now, has: Boolean(row) };
  return presence.has;
}
/** Forgets the minute's answer (a sync added or removed articles). */
export const forgetRegisterPresence = () => { presence = null; };

/** Whether the company has a price on any article of the register (an indexed lookup; the search then reads the register's prices). */
export async function companyHasWholesalePrices(organizationId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS "one" FROM "WholesalePrice" WHERE "organizationId" = ${organizationId} LIMIT 1`;
  return rows.length > 0;
}

/**
 * What a register search is for. By default every article of the register. With `priced` the search is the company's own
 * (`organizationId` required): "only" = the articles the company has a price on (bara artiklar jag har pris på), through one
 * supplier's imports when `supplierId` is given; "prefer" = every article, the company's priced articles ranked before the
 * others at an equal score (two searches, run side by side: the company's priced ones and all of them).
 */
export type RegisterSearchOptions = { organizationId?: string; priced?: "prefer" | "only"; supplierId?: string | null };

/** The register's matching articles, ranked (with a typo pass when the first found too little). */
export async function searchRegisterRows(query: string, limit = REGISTER_ROWS, ownCount = 0, options: RegisterSearchOptions = {}): Promise<{ rows: (RegisterSearchRow & RegisterArticleRow & { typo?: boolean })[]; fuzzy: boolean }> {
  const parsed = parseRegisterQuery(query);
  if (parsed.folded.length < 2 || !parsed.words.length) return { rows: [], fuzzy: false };
  const bounded = Math.max(1, Math.min(REGISTER_SEARCH_MAX_LIMIT, limit));
  const company = options.organizationId && options.priced ? { organizationId: options.organizationId, supplierId: options.supplierId ?? null } : undefined;
  /** One ranked search of the register, with a typo pass when it and the company's own search together found too little. */
  const rank = async (priced: typeof company, typoOk: boolean) => {
    let ranked: (RegisterSearchRow & { typo?: boolean })[] = await prisma.$queryRaw<RegisterSearchRow[]>(buildRegisterSearchSql({ query: parsed, limit: bounded, mode: "match", priced }));
    let fuzzy = false;
    // Typing errors only when the company's hits and the register's together are few (2026-10-17): a similar article never
    // pushes an exact hit down, so the typo rows are marked and always listed after every exact hit.
    if (typoOk && ranked.length + ownCount < Math.min(bounded, 5) && parsed.words.some((word) => word.fuzzy)) {
      const trigram = await trigramSchema();
      if (trigram) {
        const typo = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(ARTICLE_TYPO_SIMILARITY)}, true)`;
          return tx.$queryRaw<RegisterSearchRow[]>(buildRegisterSearchSql({ query: parsed, limit: bounded, mode: "typo", trigram, priced }));
        });
        if (typo.length > ranked.length) {
          const exact = new Set(ranked.map((row) => row.id));
          ranked = [...ranked, ...typo.filter((row) => !exact.has(row.id)).map((row) => ({ ...row, typo: true }))];
          fuzzy = true;
        }
      }
    }
    return { ranked, fuzzy };
  };
  let ranked: (RegisterSearchRow & { typo?: boolean })[];
  let fuzzy: boolean;
  // One or two letters match a large part of the register whatever the company has priced: no point ranking the priced first then.
  if (options.priced === "prefer" && company && parsed.words.some((word) => word.text.length >= 3)) {
    // The company's priced articles and all of them, side by side; at an equal score a priced article comes first, whatever the
    // register's own order of equals (its shortest description first) would have been.
    const [mine, every] = await Promise.all([rank(company, false), rank(undefined, true)]);
    const first = new Set(mine.ranked.map((row) => row.id));
    // Both lists are ordered by score; a stable sort keeps the company's priced articles ahead of the others at an equal score.
    const exact = [...mine.ranked, ...every.ranked.filter((row) => !row.typo && !first.has(row.id))].sort((x, y) => y.score - x.score);
    const total = every.ranked[0]?.total;
    ranked = [...exact, ...every.ranked.filter((row) => row.typo && !first.has(row.id))].slice(0, bounded).map((row) => (total === undefined ? row : { ...row, total }));
    fuzzy = every.fuzzy;
  } else {
    ({ ranked, fuzzy } = await rank(options.priced === "only" ? company : undefined, true));
  }
  if (!ranked.length) return { rows: [], fuzzy };
  const articles = await prisma.$queryRaw<RegisterArticleRow[]>(Prisma.sql`SELECT ${SELECT_ARTICLE} FROM "WholesaleArticle" w WHERE w."id" = ANY(${ranked.map((row) => row.id)}::text[])`);
  const byId = new Map(articles.map((article) => [article.id, article]));
  return { rows: ranked.flatMap((row) => { const article = byId.get(row.id); return article ? [{ ...article, ...row }] : []; }), fuzzy };
}

// ---------- the company's prices on register articles ----------

const day = (value: Date) => value.toISOString().slice(0, 10);

/** The supplier's latest price list of each price kind (file name and date): what "inte i senaste prisfilen" names. */
async function latestPriceFiles(organizationId: string, offers: readonly WholesaleOffer[]): Promise<Map<string, { fileName: string; date: string }>> {
  const suppliers = [...new Set(offers.map((offer) => offer.supplierId))];
  if (!suppliers.length) return new Map();
  const rows = await prisma.$queryRaw<{ supplierId: string; priceKind: string; fileName: string; createdAt: Date }[]>`
    SELECT DISTINCT ON (i."supplierId", i."priceKind") i."supplierId", i."priceKind", i."fileName", i."createdAt"
    FROM "CatalogueImport" i
    WHERE i."organizationId" = ${organizationId} AND i."kind" = 'PRICES' AND i."supplierId" = ANY(${suppliers}::text[])
    ORDER BY i."supplierId", i."priceKind", i."createdAt" DESC, i."id" DESC`;
  return new Map(rows.map((row) => [`${row.supplierId}|${row.priceKind}`, { fileName: row.fileName, date: day(row.createdAt) }]));
}

/**
 * The company's priced offers on these register articles, by running number (priser mot katalogartikeln, 2026-10-17):
 * one offer per supplier of the company that has a price on the article – the price in force, "bekräftad" and "inte i senaste
 * prisfilen" from lib/catalogue/wholesale-read.ts – and, where a discount letter of the supplier applies to a base price, the
 * company's net price computed on read (lib/catalogue/rebate-server.ts; nothing is stored). A row of the company's own file that is this
 * article (lib/catalogue/file-prices.ts, found on read) is a price on it too: per supplier the one in force. An article the company has no
 * price on is not in the map. Company-bound: another company's price is never read.
 */
export async function pricedOffersFor(organizationId: string, rows: readonly RegisterArticleRow[]): Promise<Map<number, CatalogueOffer[]>> {
  const result = new Map<number, CatalogueOffer[]>();
  if (!rows.length) return result;
  const [priceRows, fileRows] = await Promise.all([wholesaleOffers(organizationId, rows.map((row) => row.seq)), fileOffersForRegister(organizationId, rows)]);
  if (!priceRows.size && !fileRows.size) return result;
  const found = new Map([...new Set([...priceRows.keys(), ...fileRows.keys()])].map((seq) => [seq, mergeWholesaleOffers(priceRows.get(seq) ?? [], fileRows.get(seq) ?? [])]));
  const latest = await latestPriceFiles(organizationId, [...found.values()].flat().filter((offer) => offer.missingFromLatestFile));
  const rowOf = new Map(rows.map((row) => [row.seq, row]));
  const built = [...found].flatMap(([seq, offers]) => {
    const row = rowOf.get(seq);
    return row ? offers.map((offer) => ({ seq, offer: wholesaleOfferOf(row, offer, latest.get(`${offer.supplierId}|${offer.priceKind}`) ?? null) })) : [];
  });
  const withNet = await withRebates(organizationId, built.map((item) => item.offer));
  built.forEach((item, index) => result.set(item.seq, [...(result.get(item.seq) ?? []), withNet[index]]));
  return result;
}

// ---------- the rows of the company's own files ----------

/** The register's articles by running number. */
async function registerRowsBySeq(seqs: readonly number[]): Promise<RegisterArticleRow[]> {
  return seqs.length ? prisma.$queryRaw<RegisterArticleRow[]>(Prisma.sql`SELECT ${SELECT_ARTICLE} FROM "WholesaleArticle" w WHERE w."seq" = ANY(${[...seqs]}::int[]) AND w."pendingRun" IS NULL`) : [];
}

/** The register article each of the company's rows is, found on read (row id → article). A row with none is in no one's way: it stands on its own. */
export async function registerRowsOfFileRows(rows: readonly FilePriceRow[]): Promise<Map<string, RegisterArticleRow>> {
  if (!rows.length) return new Map();
  const links = await linkFileRows(rows);
  const articles = new Map((await registerRowsBySeq([...new Set(links.values())])).map((row) => [Number(row.seq), row]));
  return new Map([...links].flatMap(([id, seq]) => { const article = articles.get(seq); return article ? [[id, article] as const] : []; }));
}

/**
 * The company's rows as offers, discount letters applied: a row that is a register article is that article's priced offer, the same as a price row on it;
 * the others say what the file says. Company-bound.
 */
export async function fileOffersOf(organizationId: string, rows: readonly FilePriceRow[]): Promise<{ row: FilePriceRow; offer: CatalogueOffer; article: RegisterArticleRow | null }[]> {
  if (!rows.length) return [];
  const articles = await registerRowsOfFileRows(rows);
  const built = rows.map((row) => { const article = articles.get(row.id) ?? null; return { row, article, offer: article ? wholesaleOfferOf(article, fileWholesaleOffer(row, article)) : fileOfferOf(row) }; });
  const withNet = await withRebates(organizationId, built.map((item) => item.offer));
  return built.map((item, index) => ({ ...item, offer: withNet[index] }));
}

/** A picked row again by its offer's id: the supplier's price in force in its file, as the hit the row was made from; null when the file no longer has it. */
async function fileHitByRef(organizationId: string, ref: { wholesaler: string; articleNo: string; supplierId: string }): Promise<CatalogueHit | null> {
  const offers = await fileOffersOf(organizationId, await filePricesByNumber(organizationId, [ref], ref.supplierId));
  return offers.length ? fileHitOf(offers.map((item) => item.offer), { supplierId: ref.supplierId, exactId: offers[0].offer.id }) : null;
}

// ---------- register articles by number and by product key ----------

/** The register's articles by the wholesaler's own number (a pending, half-imported row is not one). An obsolete one is returned: it is named, not hidden. */
export async function registerRowsByNumber(refs: readonly { wholesaler: string; articleNo: string }[]): Promise<RegisterArticleRow[]> {
  if (!refs.length) return [];
  return prisma.$queryRaw<RegisterArticleRow[]>(Prisma.sql`
    SELECT ${SELECT_ARTICLE} FROM "WholesaleArticle" w
    JOIN unnest(${refs.map((ref) => ref.wholesaler)}::text[], ${refs.map((ref) => ref.articleNo)}::text[]) AS u("wholesaler", "articleNo") ON u."wholesaler" = w."wholesaler" AND u."articleNo" = w."articleNo"
    WHERE w."pendingRun" IS NULL`);
}

/**
 * The hits for register articles by the wholesaler's own number (the W:<wholesaler>:<article number> keys of favourites and
 * lists): each with the company's priced offers on the article, or – with no price of the company – the unpriced register row.
 * A number the register lacks may still be a row of the company's own file. In the order asked, null where neither has it.
 */
export async function hitsForRegisterArticles(organizationId: string, refs: readonly { wholesaler: string; articleNo: string }[]): Promise<(CatalogueHit | null)[]> {
  const rows = await registerRowsByNumber(refs);
  const priced = rows.length ? await pricedOffersFor(organizationId, rows) : new Map<number, CatalogueOffer[]>();
  const rowOf = (ref: { wholesaler: string; articleNo: string }) => rows.find((item) => item.wholesaler === ref.wholesaler && item.articleNo === ref.articleNo);
  const others = refs.filter((ref) => !rowOf(ref));
  const fileOffers = others.length ? await fileOffersOf(organizationId, await filePricesByNumber(organizationId, others)) : [];
  return refs.map((ref) => {
    const row = rowOf(ref);
    if (row) return catalogHitOf([row], priced, { exactSeq: row.seq });
    const own = fileOffers.filter(({ row: item }) => item.wholesaler === ref.wholesaler && (item.articleNo || item.eNumber) === ref.articleNo).map((item) => item.offer);
    return own.length ? fileHitOf(own) : null;
  });
}

/**
 * A picked article's priced offer again, by the id the hit gave it ("solar:<article number>:<supplier id>"): the hit the row was
 * made from, with the supplier's price in force now – null when the id is not a wholesale offer's, when the register no longer
 * has the article, or when the supplier of the company has no price on it any more (the caller then leaves the row unpriced,
 * as for a removed article). A row of the company's own file has the same form of id, with or without the register's article. Company-bound: a
 * supplier of another company never matches.
 */
export async function wholesaleHitById(organizationId: string, id: string): Promise<CatalogueHit | null> {
  const ref = parseWholesaleOfferId(id);
  if (!ref) return null;
  const [row] = await registerRowsByNumber([ref]);
  if (!row) return fileHitByRef(organizationId, ref);
  const priced = await pricedOffersFor(organizationId, [row]);
  if (!priced.get(row.seq)?.some((offer) => offer.supplierId === ref.supplierId)) return fileHitByRef(organizationId, ref);
  return catalogHitOf([row], priced, { supplierId: ref.supplierId, exactSeq: row.seq });
}

/**
 * The hits for product keys of the register ("E:1234567", "GTIN:<14 digits>", "MPN:<maker:number>"): every register article with
 * that number, one row per wholesaler, with the company's priced offers on them, and the company's rows from files of the same product. A
 * key neither has is missing from the map. Obsolete articles are included (a favourite names the status instead of losing the article).
 */
export async function hitsForRegisterKeys(organizationId: string, keys: readonly string[]): Promise<Map<string, CatalogueHit>> {
  const hits = new Map<string, CatalogueHit>();
  const eNumbers = keys.filter((key) => /^E:\d{7}$/.test(key)).map((key) => key.slice(2));
  const gtins = keys.filter((key) => /^GTIN:\d{14}$/.test(key)).map((key) => key.slice(5));
  const makers = keys.filter((key) => /^MPN:.{1,120}$/.test(key));
  const fileOffers = await fileOffersOf(organizationId, await filePricesOfProducts(organizationId, keys));
  const filesOf = (key: string) => fileOffers.filter((item) => item.row.productKey === key).map((item) => item.offer);
  const rows = eNumbers.length || gtins.length || makers.length ? await prisma.$queryRaw<RegisterArticleRow[]>(Prisma.sql`
    SELECT ${SELECT_ARTICLE} FROM "WholesaleArticle" w
    WHERE w."pendingRun" IS NULL AND (w."eNumber" = ANY(${eNumbers}::text[]) OR w."gtin" = ANY(${gtins}::text[]) OR w."productKey" = ANY(${makers}::text[]))
    ORDER BY w."wholesaler", w."articleNo" LIMIT 500`) : [];
  const priced = rows.length ? await pricedOffersFor(organizationId, rows) : new Map<number, CatalogueOffer[]>();
  for (const key of new Set(keys)) {
    // The company's priced rows first, as in the search; then by wholesaler and number.
    const own = rows.filter((row) => (key.startsWith("E:") ? row.eNumber === key.slice(2) : key.startsWith("GTIN:") ? row.gtin === key.slice(5) : key.startsWith("MPN:") ? row.productKey === key : false))
      .sort((x, y) => Number(priced.has(y.seq)) - Number(priced.has(x.seq)));
    const files = filesOf(key);
    if (own.length) hits.set(key, withFileOffers(catalogHitOf(own, priced), files, own));
    else if (files.length) hits.set(key, fileHitOf(files));
  }
  return hits;
}

// ---------- the company's own articles for register articles (its own suppliers' price files) ----------

type CompanyKeyRow = { id: string; productId: string | null; eNumber: string; gtin: string; articleNoNorm: string; wholesaler: string | null; numberKind: string | null; number: string | null; productGtin: string | null; mpnKey: string | null };

/** The keys a company's article joins on (the same forms as registerJoinKeys). */
function companyKeys(row: CompanyKeyRow): string[] {
  const keys = new Set<string>();
  if (/^\d{7}$/.test(row.eNumber)) keys.add(`E:${row.eNumber}`);
  if (row.gtin) keys.add(`GTIN:${row.gtin}`);
  if (row.productGtin) keys.add(`GTIN:${row.productGtin}`);
  if (row.numberKind && row.number) keys.add(row.numberKind === "MPN" ? `MPN:${row.number}` : `${row.numberKind}:${row.number}`);
  if (row.mpnKey) keys.add(`MPN:${row.mpnKey}`);
  if (row.wholesaler && row.articleNoNorm) keys.add(`W:${row.wholesaler}:${row.articleNoNorm}`);
  return [...keys];
}

/**
 * The company's own articles for the register's articles, by key: register article id → the company's articles (one per
 * product). These are the articles of the company's own price files (CatalogueArticle) – a wholesaler's price rows on the
 * register's article are not copies and are read by pricedOffersFor. Company-bound in every part; each part is an indexed lookup
 * of its own.
 */
export async function companyArticlesForRegister(organizationId: string, articles: readonly RegisterArticleRow[]): Promise<Map<string, { id: string; productId: string | null }[]>> {
  const result = new Map<string, { id: string; productId: string | null }[]>();
  if (!articles.length) return result;
  const es = [...new Set(articles.map((article) => article.eNumber).filter(Boolean))];
  const gtins = [...new Set(articles.map((article) => article.gtin).filter(Boolean))];
  const mpns = [...new Set(articles.map((article) => article.productKey).filter((key) => key.startsWith("MPN:")).map((key) => key.slice(4)))];
  const numbers = [...new Set(articles.map((article) => article.articleNo).filter((value) => value.length >= 8))];
  const found = await prisma.$queryRaw<CompanyKeyRow[]>`
    WITH hits AS (
      SELECT a."id" FROM "CatalogueArticle" a WHERE a."organizationId" = ${organizationId} AND a."eNumber" = ANY(${es}::text[])
      UNION SELECT a."id" FROM "CatalogueArticle" a WHERE a."organizationId" = ${organizationId} AND a."gtin" = ANY(${gtins}::text[])
      UNION SELECT a."id" FROM "CatalogueProduct" p JOIN "CatalogueArticle" a ON a."productId" = p."id" AND a."organizationId" = p."organizationId"
        WHERE p."organizationId" = ${organizationId} AND p."numberKind" = 'E' AND p."number" = ANY(${es}::text[])
      UNION SELECT a."id" FROM "CatalogueProduct" p JOIN "CatalogueArticle" a ON a."productId" = p."id" AND a."organizationId" = p."organizationId"
        WHERE p."organizationId" = ${organizationId} AND p."gtin" = ANY(${gtins}::text[])
      UNION SELECT a."id" FROM "CatalogueProduct" p JOIN "CatalogueArticle" a ON a."productId" = p."id" AND a."organizationId" = p."organizationId"
        WHERE p."organizationId" = ${organizationId} AND p."numberKind" = 'GTIN' AND p."number" = ANY(${gtins}::text[])
      UNION SELECT a."id" FROM "CatalogueProduct" p JOIN "CatalogueArticle" a ON a."productId" = p."id" AND a."organizationId" = p."organizationId"
        WHERE p."organizationId" = ${organizationId} AND p."mpnKey" = ANY(${mpns}::text[])
      UNION SELECT a."id" FROM "CatalogueProduct" p JOIN "CatalogueArticle" a ON a."productId" = p."id" AND a."organizationId" = p."organizationId"
        WHERE p."organizationId" = ${organizationId} AND p."numberKind" = 'MPN' AND p."number" = ANY(${mpns}::text[])
      UNION SELECT a."id" FROM "CatalogueArticle" a WHERE a."organizationId" = ${organizationId} AND a."articleNoNorm" = ANY(${numbers}::text[]))
    SELECT a."id", a."productId", a."eNumber", a."gtin", a."articleNoNorm", s."wholesaler", p."numberKind", p."number", p."gtin" AS "productGtin", p."mpnKey"
    FROM hits h
    JOIN "CatalogueArticle" a ON a."id" = h."id" AND a."organizationId" = ${organizationId}
    JOIN "CatalogueSupplier" s ON s."id" = a."supplierId" AND s."organizationId" = a."organizationId"
    LEFT JOIN "CatalogueProduct" p ON p."id" = a."productId" AND p."organizationId" = a."organizationId"
    LIMIT 2000`;
  const byKey = new Map<string, CompanyKeyRow[]>();
  for (const row of found) for (const key of companyKeys(row)) byKey.set(key, [...(byKey.get(key) ?? []), row]);
  for (const article of articles) {
    const seen = new Set<string>();
    const rows: { id: string; productId: string | null }[] = [];
    for (const key of registerJoinKeys(article)) for (const row of byKey.get(key) ?? []) {
      const group = row.productId ?? row.id;
      if (seen.has(group)) continue;
      seen.add(group);
      rows.push({ id: row.id, productId: row.productId });
    }
    if (rows.length) result.set(article.id, rows);
  }
  return result;
}
