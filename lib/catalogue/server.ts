import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import type { CatalogueCaller } from "@/lib/catalogue/access";
import type { CatalogueMapping, CatalogueRow } from "@/lib/catalogue/model";
import type { CatalogueHit, CatalogueOffer } from "@/lib/catalogue/snapshot";
import { searchWithRegister } from "@/lib/catalogue/register-search";
import { buildArticlePageSql, parseArticleQuery } from "@/lib/catalogue/search-sql";
import { priceFileFromGrid } from "@/lib/catalogue/file/open";
import { importCatalogueFile } from "@/lib/catalogue/import-file";
import { removeUnlinkedProducts } from "@/lib/catalogue/products";
import { priceKindOfHeading, type PriceKind } from "@/lib/catalogue/price-kind";
import { WHOLESALERS, WHOLESALER_LABELS, type WholesalerId } from "@/lib/wholesale/model";
import { importGate } from "@/lib/catalogue/catalogue-gate";
import { latestRebates, withRebates } from "@/lib/catalogue/rebate-server";
import { parseRegisterQuery, type RegisterQuery } from "@/lib/catalogue/register-text";
import { parseWholesaleOfferId, registerNameOf, type RegisterArticleRow } from "@/lib/catalogue/register-hit";
import { companyHasWholesalePrices, fileOffersOf, pricedOffersFor, registerRowsByNumber, wholesaleHitById } from "@/lib/catalogue/register-rows";
import { companyHasFilePrices, fileOffersForRegister, filePriceCounts, filePricePage, filePricesByNumber } from "@/lib/catalogue/file-prices";
import { wholesaleIdentity } from "@/lib/catalogue/lists";
import { wholesalePriceHistory } from "@/lib/catalogue/wholesale-read";
import { promoteWholesaleRows } from "@/lib/catalogue/wholesale-prices";
import type { ImportGateReason } from "@/lib/catalogue/gate-text";

/**
 * Artiklar och priser, steg 1 (2026-10-08): the company's own catalogue on the server. Every query is bound to
 * the caller's organization; every link between the tables is also a composite [x, organizationId] key, so the
 * database refuses a link into another company even if a query here were wrong. Prices are history: an import adds a
 * row when an article is new or its price changed, confirms an unchanged price, and never changes an earlier row.
 * A price file is never sent to the AI. The read tools search_articles / get_article_price_history (2026-10-08) return
 * bounded search results and history to the caller – API, MCP or the person's own Workflow AI chat under the company's
 * AI sharing choices – through the catalogue route and its read permission.
 *
 * Priser direkt mot grossistens katalogartikel (2026-10-17, alternativ C): a price file from a wholesaler with a catalogue
 * is stored as price rows on the register's article (WholesalePrice) and one bit list per import (WholesaleImportSeen), not as
 * copies of the article. This file reads both worlds side by side – the company's own suppliers' articles as before, and the
 * wholesaler suppliers' prices on the register – for the overview, the tools, the price history and "Ta bort import".
 *
 * Prisfil utan grossistens katalog (produktägaren 2026-11-01): the rows of a file for a wholesaler without a catalogue (CatalogueFilePrice,
 * lib/catalogue/file-prices.ts) are the third side here, read beside those two. They go with their import and their supplier.
 */

export { catalogueAccess, requireCatalogue, type CatalogueCaller } from "@/lib/catalogue/access";

/** How a saved profile reads its file (prisfiler etapp 1, 2026-10-12): headings, fixed-width positions, price scale, E-nummer. */
export type SavedPriceFormat = { header?: "auto" | "yes" | "no"; fixedStarts?: number[]; sheet?: string; priceScale?: 1 | 100 | 1000; articleNoIsENumber?: boolean; priceKind?: "NET" | "BASE"; eNumberRule?: { column: string; values: string[] } };

const decimal = (value: Prisma.Decimal | number) => Number(value.toString());
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

/**
 * The price in force with its latest confirmation (pris ändrat 2026-10-08): one row each, never the history. A net price
 * list is a layer above the GNP list of the same supplier (2026-10-15): the latest NET row first ("NET" sorts after
 * "BASE", so descending puts it first), otherwise the latest base price – the same order as the search's SQL.
 */
const latestPrice = {
  orderBy: [{ priceKind: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }], take: 1,
  select: { unitPrice: true, amount: true, perQuantity: true, priceDate: true, sourceFileName: true, importId: true, priceKind: true,
    confirmations: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 1, select: { confirmedDate: true } } },
};
type ArticleWithPrice = { id: string; name: string; unit: string; supplierArticleNo: string; eNumber: string; manufacturerArticleNo: string; discountGroup: string; packageSize: string; orderMultiple: string; minOrderQuantity: string; stocked: string; status: string; supplier: { name: string; wholesaler: string | null }; prices: { unitPrice: Prisma.Decimal; priceDate: Date; sourceFileName: string; importId: string; priceKind: string; confirmations: { confirmedDate: Date }[] }[] };
/** The article's own fields the page and the tools list (2026-10-15: förpackning, multipel, minsta beställning, lagerförd, status). */
const articleSelect = { id: true, name: true, unit: true, supplierArticleNo: true, eNumber: true, manufacturerArticleNo: true, discountGroup: true, packageSize: true, orderMultiple: true, minOrderQuantity: true, stocked: true, status: true, supplier: { select: { name: true, wholesaler: true } }, prices: latestPrice } as const;

const toHit = (article: ArticleWithPrice): CatalogueHit => {
  const price = article.prices[0];
  const priceDate = price ? isoDate(price.priceDate) : "";
  const confirmed = price?.confirmations[0] ? isoDate(price.confirmations[0].confirmedDate) : "";
  return {
    id: article.id, name: article.name, unit: article.unit, supplierArticleNo: article.supplierArticleNo, eNumber: article.eNumber, manufacturerArticleNo: article.manufacturerArticleNo, discountGroup: article.discountGroup, supplierName: article.supplier.name,
    ...((WHOLESALERS as readonly string[]).includes(article.supplier.wholesaler ?? "") ? { wholesaler: article.supplier.wholesaler as WholesalerId } : {}),
    ...(article.packageSize ? { packageSize: article.packageSize } : {}), ...(article.orderMultiple ? { orderMultiple: article.orderMultiple } : {}), ...(article.minOrderQuantity ? { minOrderQuantity: article.minOrderQuantity } : {}),
    ...(article.stocked === "J" || article.stocked === "N" ? { stocked: article.stocked === "J" } : {}), ...(article.status === "UTGAR" || article.status === "PRIS_PA_BEGARAN" ? { status: article.status } : {}),
    price: price ? { unitPrice: decimal(price.unitPrice), priceDate, ...(confirmed > priceDate ? { confirmedDate: confirmed } : {}), sourceFileName: price.sourceFileName, importId: price.importId, ...(price.priceKind === "BASE" ? { priceKind: "BASE" as const } : {}) } : null,
  };
};

/**
 * Articles for the material row's and the quote line's search (prisfiler etapp 1, 2026-10-12): the company's one
 * register searched as products, ranked, at most 20, each with its suppliers' offers side by side (lib/catalogue/search.ts).
 */
export async function searchCatalogue(organizationId: string, query: string, limit = 20, options: { supplierId?: string | null } = {}): Promise<CatalogueHit[]> {
  if (query.trim().length < 2) return [];
  // The company's own articles and – when the shared register has articles – the wholesalers' catalogue articles with the company's
  // price rows on them (2026-10-17); without register articles it is the company's own search exactly as before.
  return (await searchWithRegister(organizationId, query, { limit: Math.min(20, limit), supplierId: options.supplierId ?? null })).hits;
}

/**
 * Whether the company has no article at all in its catalogue: the search then says so and points to Import. A price on a
 * wholesaler's catalogue article is an article of the company's catalogue too (priser mot katalogartikeln, 2026-10-17).
 */
export async function catalogueIsEmpty(organizationId: string): Promise<boolean> {
  if (await prisma.catalogueArticle.findFirst({ where: { organizationId }, select: { id: true } })) return false;
  return !(await companyHasWholesalePrices(organizationId)) && !(await companyHasFilePrices(organizationId));
}

/**
 * One article of the company with its latest price, or null (also for another company's id). The id is a supplier's own article
 * (the company's CatalogueArticle) or the company's offer on a wholesaler's catalogue article ("solar:<number>:<supplier id>",
 * lib/catalogue/register-hit.ts), priced again from the company's price rows – a picked article is priced on save from it.
 */
export async function articleHitById(organizationId: string, id: string): Promise<CatalogueHit | null> {
  const article = await prisma.catalogueArticle.findFirst({
    where: { id, organizationId },
    select: articleSelect,
  });
  if (article) return (await withRebates(organizationId, [toHit(article)]))[0];
  return wholesaleHitById(organizationId, id);
}

/** The tools' bounds (2026-10-08): at most 20 articles per search and 50 price rows per history. */
export const TOOL_ARTICLE_LIMIT = 20;
export const TOOL_HISTORY_LIMIT = 50;

/**
 * search_articles (API, MCP, Workflow AI): the material-row search with an optional supplier (its id or part of its
 * name), at most 20 articles with their latest price, the price date and the latest confirmation. Company-bound.
 */
export async function searchArticlesForTool(organizationId: string, options: { query: string; supplier?: string; limit?: number }) {
  const query = options.query.trim().slice(0, 120);
  if (query.length < 2) return { articles: [], total: 0 };
  const supplierText = (options.supplier ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  let supplierId: string | null = null;
  if (supplierText) {
    const supplier = await prisma.catalogueSupplier.findFirst({ where: { organizationId, OR: [{ id: supplierText }, { nameKey: { contains: supplierText.toLowerCase() } }] }, orderBy: { name: "asc" }, select: { id: true } });
    if (!supplier) return { articles: [], total: 0 };
    supplierId = supplier.id;
  }
  const take = Math.max(1, Math.min(TOOL_ARTICLE_LIMIT, options.limit ?? TOOL_ARTICLE_LIMIT));
  const found = await searchWithRegister(organizationId, query, { supplierId, limit: take });
  const shape = (offer: CatalogueOffer) => ({
    id: offer.id, articleNo: offer.supplierArticleNo, eNumber: offer.eNumber, rskNumber: offer.rskNumber ?? "", manufacturerArticleNo: offer.manufacturerArticleNo ?? "", name: offer.name, unit: offer.unit, supplier: offer.supplierName,
    unitPrice: offer.price ? offer.price.unitPrice : null, currency: "SEK", priceDate: offer.price ? offer.price.priceDate : null, confirmedDate: offer.price?.confirmedDate ?? null,
    // Grundpris (2026-10-13 natt): the wholesaler's price before the company's discount, not what the company pays.
    priceKind: offer.price ? (offer.price.priceKind === "BASE" ? "grundpris" : "nettopris") : null,
  });
  // The tool answers with the company's own prices (own suppliers' articles and its price rows on a wholesaler's catalogue articles):
  // a catalogue article the company has no price on (the register's, 2026-10-17) is not an answer, so it is left out.
  const priced = found.hits.flatMap((hit) => {
    if (hit.catalogOnly) return [];
    const offers = (hit.offers ?? []).filter((offer) => !offer.catalogOnly);
    return [{ ...shape(hit), productId: hit.productId ?? null, commonNumber: hit.common ? `${hit.common.kind} ${hit.common.number}` : null, offers: offers.map(shape) }];
  });
  return {
    // One entry per product (2026-10-12): the offer a row would take, and every supplier's offer of the same product.
    articles: priced,
    // With the register the search's total also counts articles the company has no price on, which the answer does not list.
    total: found.register ? priced.length : found.total,
  };
}

/** The ids a history may be asked for: a supplier's own article, or a wholesaler's catalogue article – its W key, the register's id, or the company's offer id. */
async function registerArticleOfId(id: string): Promise<(Pick<RegisterArticleRow, "seq" | "wholesaler" | "articleNo" | "eNumber" | "name" | "description" | "unit">) | null> {
  const identity = wholesaleIdentity(id);
  if (identity) {
    const split = identity.indexOf(":");
    const [row] = await registerRowsByNumber([{ wholesaler: identity.slice(0, split), articleNo: identity.slice(split + 1) }]);
    return row ?? null;
  }
  return prisma.wholesaleArticle.findFirst({ where: { id, pendingRun: null }, select: { seq: true, wholesaler: true, articleNo: true, eNumber: true, name: true, description: true, unit: true } });
}

/**
 * For each price row of a wholesaler's article: how many later price lists still had the article at that price and the latest of
 * them – the bit lists read per row (priser mot katalogartikeln). A list counts for a row from the import after the row's own until the
 * import that wrote the series' next row; a list the file never finished (no bit list) confirms nothing.
 */
async function wholesaleConfirmations(organizationId: string, priceIds: readonly string[]): Promise<Map<string, { count: number; date: string }>> {
  if (!priceIds.length) return new Map();
  const rows = await prisma.$queryRaw<{ id: string; count: number; date: Date }[]>`
    SELECT p."id"::text AS "id", count(*)::int AS "count", max(w."confirmedDate") AS "date"
    FROM "WholesalePrice" p
    JOIN "CatalogueImport" pi ON pi."id" = p."importId" AND pi."organizationId" = p."organizationId"
    LEFT JOIN LATERAL (
      SELECT ni."createdAt" AS "at", ni."id" AS "importId"
      FROM "WholesalePrice" q
      JOIN "CatalogueImport" ni ON ni."id" = q."importId" AND ni."organizationId" = q."organizationId"
      WHERE q."organizationId" = p."organizationId" AND q."seq" = p."seq" AND q."priceKind" = p."priceKind" AND ni."supplierId" = pi."supplierId"
        AND (q."createdAt", q."id") > (p."createdAt", p."id")
      ORDER BY q."createdAt", q."id" LIMIT 1) nxt ON true
    JOIN "CatalogueImport" li ON li."organizationId" = p."organizationId" AND li."supplierId" = pi."supplierId" AND li."kind" = 'PRICES' AND li."priceKind" = p."priceKind"
      AND (li."createdAt", li."id") > (pi."createdAt", pi."id") AND (nxt."at" IS NULL OR (li."createdAt", li."id") < (nxt."at", nxt."importId"))
    JOIN "WholesaleImportSeen" w ON w."importId" = li."id" AND w."organizationId" = li."organizationId"
    WHERE p."organizationId" = ${organizationId} AND p."id" = ANY(${[...priceIds]}::bigint[])
      AND CASE WHEN p."seq" < octet_length(w."seen") * 8 THEN get_bit(w."seen", p."seq") ELSE 0 END = 1
    GROUP BY p."id"`;
  return new Map(rows.map((row) => [row.id, { count: Number(row.count), date: isoDate(row.date) }]));
}

/** The price history of a wholesaler's catalogue article for the company: its price rows on the article, newest first (bounded). */
async function wholesaleArticleHistory(organizationId: string, id: string, limit: number) {
  const article = await registerArticleOfId(id);
  if (!article) return null;
  // The id may name the company's supplier (the offer's id): then the history is that supplier's.
  const supplierId = parseWholesaleOfferId(id)?.supplierId;
  const rows = (await wholesalePriceHistory(organizationId, article.seq, supplierId)).slice(0, Math.max(1, Math.min(TOOL_HISTORY_LIMIT, limit)));
  // A row of the company's own file that is this article: the file's price, which has no history of its own.
  const fileRows = ((await fileOffersForRegister(organizationId, [article])).get(article.seq) ?? []).filter((offer) => !supplierId || offer.supplierId === supplierId);
  const [confirmed, total, suppliers] = await Promise.all([
    wholesaleConfirmations(organizationId, rows.map((row) => row.id)),
    prisma.wholesalePrice.count({ where: { organizationId, seq: article.seq, ...(supplierId ? { import: { supplierId } } : {}) } }),
    prisma.catalogueSupplier.findMany({ where: { organizationId, id: { in: [...new Set([...rows, ...fileRows].map((row) => row.supplierId))] } }, select: { id: true, name: true } }),
  ]);
  const supplierName = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  return {
    article: { id, articleNo: article.articleNo, eNumber: article.eNumber, name: registerNameOf(article), unit: article.unit,
      supplier: [...new Set([...rows, ...fileRows].map((row) => supplierName.get(row.supplierId) ?? ""))].filter(Boolean).join(", ") || WHOLESALER_LABELS[article.wholesaler as WholesalerId] || article.wholesaler },
    prices: [...fileRows.map((price) => ({
      unitPrice: Number(price.unitPrice), amount: Number(price.amount), perQuantity: price.perQuantity, currency: price.currency, priceKind: price.priceKind === "BASE" ? "grundpris" : "nettopris", priceDate: price.priceDate,
      confirmedDate: price.confirmedDate > price.priceDate ? price.confirmedDate : null, confirmations: 0, sourceFileName: price.sourceFileName, supplier: supplierName.get(price.supplierId) ?? "",
    })), ...rows.map((price) => ({
      unitPrice: Number(price.unitPrice), amount: Number(price.amount), perQuantity: price.perQuantity, currency: price.currency, priceKind: price.priceKind === "BASE" ? "grundpris" : "nettopris", priceDate: price.priceDate,
      confirmedDate: confirmed.get(price.id)?.date ?? null, confirmations: confirmed.get(price.id)?.count ?? 0, sourceFileName: price.sourceFileName, supplier: supplierName.get(price.supplierId) ?? "",
    }))],
    total: total + fileRows.length,
  };
}

/** The price of a row in the company's own file that the register does not have: one price, since a new file replaces the row. Company-bound. */
async function fileRowHistory(organizationId: string, id: string) {
  const identity = wholesaleIdentity(id);
  if (!identity) return null;
  const split = identity.indexOf(":");
  const rows = await filePricesByNumber(organizationId, [{ wholesaler: identity.slice(0, split), articleNo: identity.slice(split + 1) }], parseWholesaleOfferId(id)?.supplierId ?? null);
  const first = rows[0];
  if (!first) return null;
  return {
    article: { id, articleNo: first.articleNo, eNumber: first.eNumber, name: first.name, unit: first.unit, supplier: [...new Set(rows.map((row) => row.supplierName))].join(", ") },
    prices: rows.map((row) => ({ unitPrice: Number(row.unitPrice), amount: Number(row.amount), perQuantity: row.perQuantity, currency: row.currency, priceKind: row.priceKind === "BASE" ? "grundpris" : "nettopris", priceDate: isoDate(row.priceDate),
      confirmedDate: isoDate(row.importedAt) > isoDate(row.priceDate) ? isoDate(row.importedAt) : null, confirmations: 0, sourceFileName: row.sourceFileName, supplier: row.supplierName })),
    total: rows.length,
  };
}

/**
 * get_article_price_history: one article of the company with its newest price rows (bounded), each with its latest confirmation. The
 * article is a supplier's own article, or a wholesaler's catalogue article – asked for by its W key, the register's id or the
 * company's offer id – whose history is the company's price rows on it (2026-10-17); another company's rows are never read.
 */
export async function articlePriceHistory(organizationId: string, articleId: string, limit = 20) {
  const article = await prisma.catalogueArticle.findFirst({ where: { id: articleId, organizationId },
    select: { id: true, name: true, unit: true, supplierArticleNo: true, eNumber: true, manufacturerArticleNo: true, supplier: { select: { name: true } }, _count: { select: { prices: true } } } });
  if (!article) {
    const wholesale = await wholesaleArticleHistory(organizationId, articleId, limit) ?? await fileRowHistory(organizationId, articleId);
    if (!wholesale) throw new ApiError(404, "Artikeln hittades inte.");
    return wholesale;
  }
  const prices = await prisma.cataloguePrice.findMany({
    where: { organizationId, articleId: article.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: Math.max(1, Math.min(TOOL_HISTORY_LIMIT, limit)),
    select: { amount: true, perQuantity: true, unitPrice: true, currency: true, priceDate: true, sourceFileName: true, priceKind: true,
      confirmations: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { confirmedDate: true } }, _count: { select: { confirmations: true } } },
  });
  return {
    article: { id: article.id, articleNo: article.supplierArticleNo, eNumber: article.eNumber, name: article.name, unit: article.unit, supplier: article.supplier.name },
    prices: prices.map((price) => ({
      unitPrice: decimal(price.unitPrice), amount: decimal(price.amount), perQuantity: price.perQuantity, currency: price.currency, priceKind: price.priceKind === "BASE" ? "grundpris" : "nettopris", priceDate: isoDate(price.priceDate),
      confirmedDate: price.confirmations[0] ? isoDate(price.confirmations[0].confirmedDate) : null, confirmations: price._count.confirmations, sourceFileName: price.sourceFileName,
    })),
    total: article._count.prices,
  };
}

const PAGE = 50;

/** The catalogue page: suppliers with their saved mappings, the latest imports and one page of articles. Bounded lists. */
export type CatalogueFilter = "" | "unmatched" | "missing";
export const CATALOGUE_FILTERS: readonly CatalogueFilter[] = ["", "unmatched", "missing"];

/**
 * Omatchade artiklar och artiklar som saknas i senaste prisfilen (2026-10-15): one page of ids by name, with the
 * total. "unmatched" = no E-nummer, RSK, EAN or manufacturer's number, so only that supplier's product; "missing" = the
 * price in force came from an earlier file than the supplier's latest finished file of the same kind, which neither
 * priced nor confirmed the article (it keeps its last price). A plain name search narrows either.
 */
async function filteredArticlePage(organizationId: string, filter: Exclude<CatalogueFilter, "">, options: { supplierId: string | null; q: string; skip: number; take: number }) {
  const supplier = options.supplierId ?? "";
  // The narrowing as a plain pattern; %, _ and \ in what was typed are escaped so they match themselves.
  const like = options.q.trim() ? `%${options.q.trim().replace(/[%_\\]/g, (char) => `\\${char}`)}%` : "";
  const condition = filter === "unmatched" ? Prisma.sql`a."productId" IS NULL` : Prisma.sql`lp."importId" IS NOT NULL AND li."id" IS NOT NULL AND lp."importId" <> li."id"
      AND NOT EXISTS (SELECT 1 FROM "CataloguePrice" sp WHERE sp."organizationId" = a."organizationId" AND sp."articleId" = a."id" AND sp."importId" = li."id")
      AND NOT EXISTS (SELECT 1 FROM "CataloguePrice" sp JOIN "CataloguePriceConfirmation" sc ON sc."priceId" = sp."id" AND sc."organizationId" = sp."organizationId"
        WHERE sp."organizationId" = a."organizationId" AND sp."articleId" = a."id" AND sc."importId" = li."id")`;
  return prisma.$queryRaw<{ id: string; total: number }[]>`
    SELECT a."id", count(*) OVER ()::int AS "total" FROM "CatalogueArticle" a
    LEFT JOIN LATERAL (SELECT p."importId", p."priceKind" FROM "CataloguePrice" p WHERE p."organizationId" = a."organizationId" AND p."articleId" = a."id"
      ORDER BY (p."priceKind" = 'NET') DESC, p."createdAt" DESC, p."id" DESC LIMIT 1) lp ON true
    LEFT JOIN LATERAL (SELECT i."id" FROM "CatalogueImport" i WHERE i."organizationId" = a."organizationId" AND i."supplierId" = a."supplierId" AND i."kind" = 'PRICES' AND i."contentHash" <> '' AND i."priceKind" = lp."priceKind"
      ORDER BY i."createdAt" DESC, i."id" DESC LIMIT 1) li ON true
    WHERE a."organizationId" = ${organizationId} AND (${supplier} = '' OR a."supplierId" = ${supplier}) AND (${like} = '' OR a."name" ILIKE ${like} OR a."supplierArticleNo" ILIKE ${like} OR a."eNumber" ILIKE ${like})
      AND ${condition}
    ORDER BY a."name", a."id" OFFSET ${options.skip} LIMIT ${options.take}`;
}

type WholesalePageRow = { seq: number; supplierId: string; wholesaler: string; articleNo: string };

/**
 * The company's prices on wholesalers' catalogue articles for the Import page's list (2026-10-17): one row per supplier and
 * article, by name, with the total. The price in force of a supplier's article is its latest net row, otherwise its latest base
 * row, as everywhere (lib/catalogue/wholesale-read.ts). The same narrowing as the company's own articles: "unmatched" = the article
 * has no E-nummer, EAN or manufacturer's number in the register, "missing" = the supplier's latest finished price list of that kind did
 * not have it, and a name search is a plain narrowing on the register's search text and numbers. Company-bound.
 */
async function wholesaleArticlePage(organizationId: string, filter: CatalogueFilter, options: { supplierId: string | null; query: RegisterQuery | null; skip: number; take: number }): Promise<{ rows: WholesalePageRow[]; total: number }> {
  const like = (value: string) => value.replace(/[\\%_]/g, "\\$&");
  const conditions: Prisma.Sql[] = [];
  for (const word of options.query?.words ?? []) {
    const parts = [
      ...word.alternatives.map((alternative) => Prisma.sql`w."searchText" LIKE ${`%${like(alternative)}%`}`),
      ...(word.norm && word.norm !== word.text && word.norm.length >= 2 ? [Prisma.sql`w."searchText" LIKE ${`%${like(word.norm)}%`}`] : []),
      ...(word.digits.length === 7 ? [Prisma.sql`w."eNumber" = ${word.digits}`] : []),
      ...(word.gtin ? [Prisma.sql`w."gtin" = ${word.gtin}`] : []),
      ...(word.idLike && word.digits.length >= 5 && word.digits === word.norm ? [Prisma.sql`w."articleNo" = ${word.digits}`] : []),
      ...(word.norm.length >= 4 && (word.idLike || word.norm.length >= 6) ? [Prisma.sql`w."mpnNorm" = ${word.norm}`] : []),
    ];
    conditions.push(Prisma.sql`(${Prisma.join(parts, " OR ")})`);
  }
  if (filter === "unmatched") conditions.push(Prisma.sql`w."productKey" = ''`);
  if (filter === "missing") conditions.push(Prisma.sql`latest."seen" IS NOT NULL AND CASE WHEN r."seq" < octet_length(latest."seen") * 8 THEN get_bit(latest."seen", r."seq") ELSE 0 END = 0`);
  const latestList = filter === "missing" ? Prisma.sql`LEFT JOIN LATERAL (
      SELECT s."seen" FROM "CatalogueImport" i3
      LEFT JOIN "WholesaleImportSeen" s ON s."importId" = i3."id" AND s."organizationId" = i3."organizationId"
      WHERE i3."organizationId" = ${organizationId} AND i3."supplierId" = r."supplierId" AND i3."kind" = 'PRICES' AND i3."priceKind" = r."priceKind"
      ORDER BY i3."createdAt" DESC, i3."id" DESC LIMIT 1) latest ON true` : Prisma.empty;
  const supplier = options.supplierId ? Prisma.sql`AND i."supplierId" = ${options.supplierId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<(WholesalePageRow & { total: number })[]>(Prisma.sql`
    WITH ranked AS (
      SELECT p."seq", i."supplierId", p."priceKind",
        row_number() OVER (PARTITION BY p."seq", i."supplierId" ORDER BY (p."priceKind" = 'NET') DESC, p."createdAt" DESC, p."id" DESC) AS "rn"
      FROM "WholesalePrice" p
      JOIN "CatalogueImport" i ON i."id" = p."importId" AND i."organizationId" = p."organizationId"
      WHERE p."organizationId" = ${organizationId} ${supplier})
    SELECT r."seq", r."supplierId", w."wholesaler", w."articleNo", count(*) OVER ()::int AS "total"
    FROM ranked r
    JOIN "WholesaleArticle" w ON w."seq" = r."seq"
    ${latestList}
    WHERE ${Prisma.join([Prisma.sql`r."rn" = 1`, ...conditions], " AND ")}
    ORDER BY coalesce(nullif(w."description", ''), w."name"), w."id", r."supplierId" OFFSET ${options.skip} LIMIT ${options.take}`);
  return { rows: rows.map(({ total, ...row }) => { void total; return row; }), total: Number(rows[0]?.total ?? 0) };
}

/** The Import page's rows for the company's prices on wholesalers' articles: the supplier's priced offer on each article (rebates applied). */
async function wholesaleOffersOfRows(organizationId: string, rows: readonly WholesalePageRow[]): Promise<CatalogueHit[]> {
  if (!rows.length) return [];
  const articles = await registerRowsByNumber(rows.map((row) => ({ wholesaler: row.wholesaler, articleNo: row.articleNo })));
  const priced = await pricedOffersFor(organizationId, articles);
  return rows.flatMap((row) => priced.get(row.seq)?.find((offer) => offer.supplierId === row.supplierId) ?? []);
}

export async function catalogueOverview(organizationId: string, options: { supplierId?: string; q?: string; page?: number; filter?: CatalogueFilter } = {}) {
  const page = Math.max(1, Math.min(200, options.page ?? 1));
  const skip = (page - 1) * PAGE;
  // A search on the page uses the register's indexed search text (2026-10-12), so 500 000 articles stay fast; the page
  // without a search lists the articles by name as before. A filter (2026-10-15) lists by name with a plain narrowing.
  const query = parseArticleQuery(options.q ?? "");
  const ownIds = async (from: number, take: number) => (options.filter
    ? await filteredArticlePage(organizationId, options.filter, { supplierId: options.supplierId ?? null, q: options.q ?? "", skip: from, take })
    : query.folded.length >= 2 && query.words.length
      ? await prisma.$queryRaw<{ id: string; total: number }[]>(buildArticlePageSql({ organizationId, query, supplierId: options.supplierId ?? null, skip: from, take }))
      : null);
  const found = await ownIds(skip, PAGE);
  const where: Prisma.CatalogueArticleWhereInput = found ? { organizationId, id: { in: found.map((row) => row.id) } } : { organizationId, ...(options.supplierId ? { supplierId: options.supplierId } : {}) };
  const [suppliers, imports, articles, counted] = await Promise.all([
    prisma.catalogueSupplier.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: 200,
      select: { id: true, name: true, customerNumber: true, wholesaler: true, _count: { select: { articles: true } }, profiles: { orderBy: { updatedAt: "desc" }, take: 10, select: { fingerprint: true, mapping: true, updatedAt: true } } } }),
    prisma.catalogueImport.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, fileName: true, createdAt: true, createdById: true, rowCount: true, newArticles: true, changedPrices: true, unchangedPrices: true, failedRows: true, priceKind: true, supplierId: true, supplier: { select: { name: true } }, _count: { select: { prices: true, wholesalePrices: true, filePrices: true } } } }),
    prisma.catalogueArticle.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: found ? 0 : skip, take: PAGE,
      select: articleSelect }),
    found ? Promise.resolve(Number(found[0]?.total ?? 0)) : prisma.catalogueArticle.count({ where }),
  ]);
  // A page past the company's own articles has none of them to take the total from.
  const ownCount = found && !found.length && skip > 0 ? Number((await ownIds(0, 1))?.[0]?.total ?? 0) : counted;
  // The company's prices on wholesalers' catalogue articles (2026-10-17) come after its own articles in the list.
  const registerQuery = parseRegisterQuery(options.q ?? "");
  const wholesaleQuery = registerQuery.folded.length >= 2 && registerQuery.words.length ? registerQuery : null;
  const hasWholesale = await companyHasWholesalePrices(organizationId);
  const wholesaleFrom = Math.max(0, skip - ownCount);
  const wholesaleOptions = { supplierId: options.supplierId ?? null, query: wholesaleQuery };
  let wholesale = hasWholesale ? await wholesaleArticlePage(organizationId, options.filter ?? "", { ...wholesaleOptions, skip: wholesaleFrom, take: Math.max(1, PAGE - articles.length) }) : { rows: [] as WholesalePageRow[], total: 0 };
  if (hasWholesale && !wholesale.rows.length && wholesaleFrom > 0) wholesale = { rows: [], total: (await wholesaleArticlePage(organizationId, options.filter ?? "", { ...wholesaleOptions, skip: 0, take: 1 })).total };
  const wholesaleHits = await wholesaleOffersOfRows(organizationId, wholesale.rows.slice(0, Math.max(0, PAGE - articles.length)));
  // The rows of the company's own files (2026-11-01) come last in the list; a row that is a register article with a price row above is not listed again.
  const fileFrom = Math.max(0, skip - ownCount - wholesale.total);
  const fileQuery = query.folded.length >= 2 && query.words.length ? query : null;
  const hasFiles = await companyHasFilePrices(organizationId);
  const filePage = hasFiles ? await filePricePage(organizationId, { filter: options.filter ?? "", supplierId: options.supplierId ?? null, query: fileQuery, skip: fileFrom, take: Math.max(1, PAGE - articles.length - wholesaleHits.length) }) : { rows: [], total: 0 };
  const fileHits = (await fileOffersOf(organizationId, filePage.rows.slice(0, Math.max(0, PAGE - articles.length - wholesaleHits.length)))).map((item) => item.offer).filter((offer) => !wholesaleHits.some((hit) => hit.id === offer.id));
  const articleCount = ownCount + wholesale.total + filePage.total;
  // How each saved profile reads the file (prisfiler etapp 1): a column Prisma's client does not map, read as such.
  const formats = suppliers.length ? await prisma.$queryRaw<{ supplierId: string; fingerprint: string; format: unknown }[]>`
    SELECT "supplierId", "fingerprint", "format" FROM "CatalogueImportProfile" WHERE "organizationId" = ${organizationId} AND "format" IS NOT NULL` : [];
  const formatOf = (supplierId: string, fingerprint: string) => formats.find((item) => item.supplierId === supplierId && item.fingerprint === fingerprint)?.format ?? null;
  // Grossistrutorna (2026-10-13 natt): each supplier's latest finished import with the span of its price dates – per kind
  // since 2026-10-15, so the GNP list and a net price list of the same supplier show as the two layers they are.
  const latestByKind = suppliers.length ? (await prisma.$queryRaw<{ supplierId: string; fileName: string; createdAt: Date; rowCount: number; priceKind: string; missingArticles: number; oldest: Date | null; newest: Date | null }[]>`
    SELECT DISTINCT ON (i."supplierId", i."priceKind") i."supplierId", i."fileName", i."createdAt", i."rowCount", i."priceKind", i."missingArticles",
      LEAST((SELECT min(p."priceDate") FROM "CataloguePrice" p WHERE p."organizationId" = i."organizationId" AND p."importId" = i."id"),
        (SELECT min(p."priceDate") FROM "WholesalePrice" p WHERE p."organizationId" = i."organizationId" AND p."importId" = i."id"),
        (SELECT min(p."priceDate") FROM "CatalogueFilePrice" p WHERE p."organizationId" = i."organizationId" AND p."importId" = i."id")) AS "oldest",
      GREATEST((SELECT max(p."priceDate") FROM "CataloguePrice" p WHERE p."organizationId" = i."organizationId" AND p."importId" = i."id"),
        (SELECT max(p."priceDate") FROM "WholesalePrice" p WHERE p."organizationId" = i."organizationId" AND p."importId" = i."id"),
        (SELECT max(p."priceDate") FROM "CatalogueFilePrice" p WHERE p."organizationId" = i."organizationId" AND p."importId" = i."id")) AS "newest"
    FROM "CatalogueImport" i WHERE i."organizationId" = ${organizationId} AND i."contentHash" <> '' AND i."kind" = 'PRICES'
    ORDER BY i."supplierId", i."priceKind", i."createdAt" DESC`).map((item) => ({ supplierId: item.supplierId, fileName: item.fileName, date: isoDate(item.createdAt), at: item.createdAt.getTime(), rowCount: Number(item.rowCount),
      priceKind: item.priceKind === "BASE" ? "BASE" as const : "NET" as const, missing: Number(item.missingArticles), oldest: item.oldest ? isoDate(item.oldest) : null, newest: item.newest ? isoDate(item.newest) : null })) : [];
  const latestOf = (supplierId: string) => latestByKind.filter((item) => item.supplierId === supplierId).sort((a, b) => b.at - a.at)[0] ?? null;
  // Omatchade artiklar (2026-10-15): the supplier's articles with no common number – only that supplier's product.
  const unmatched = suppliers.length ? new Map((await prisma.$queryRaw<{ supplierId: string; count: number }[]>`
    SELECT a."supplierId", count(*)::int AS "count" FROM "CatalogueArticle" a WHERE a."organizationId" = ${organizationId} AND a."productId" IS NULL GROUP BY a."supplierId"`)
    .map((row) => [row.supplierId, Number(row.count)])) : new Map<string, number>();
  // The company's prices on wholesalers' catalogue articles (2026-10-17) are the wholesaler suppliers' articles: counted per supplier,
  // and "utan gemensamt nummer" = the register's article has no E-nummer, EAN or manufacturer's number.
  const wholesaleCounts = suppliers.length && hasWholesale ? new Map((await prisma.$queryRaw<{ supplierId: string; articles: number; unmatched: number }[]>`
    SELECT i."supplierId", count(DISTINCT p."seq")::int AS "articles", (count(DISTINCT p."seq") FILTER (WHERE w."productKey" = ''))::int AS "unmatched"
    FROM "WholesalePrice" p
    JOIN "CatalogueImport" i ON i."id" = p."importId" AND i."organizationId" = p."organizationId"
    JOIN "WholesaleArticle" w ON w."seq" = p."seq"
    WHERE p."organizationId" = ${organizationId} GROUP BY i."supplierId"`).map((row) => [row.supplierId, { articles: Number(row.articles), unmatched: Number(row.unmatched) }])) : new Map<string, { articles: number; unmatched: number }>();
  const fileCounts = suppliers.length && hasFiles ? await filePriceCounts(organizationId) : new Map<string, { articles: number; unmatched: number }>();
  const rebates = suppliers.length ? await latestRebates(organizationId) : new Map<string, { fileName: string; date: string; rules: number }>();
  const kinds = imports.length ? new Map((await prisma.$queryRaw<{ id: string; kind: string }[]>`SELECT "id", "kind" FROM "CatalogueImport" WHERE "organizationId" = ${organizationId} AND "id" = ANY(${imports.map((item) => item.id)}::text[])`).map((row) => [row.id, row.kind])) : new Map<string, string>();
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(imports.map((item) => item.createdById).filter((id): id is string => Boolean(id)))] } }, select: { id: true, name: true, email: true } });
  // The box's short line (användartest 2026-10-31, S3): per wholesaler, null with a working catalogue, otherwise why there is none. A file can be read in either way.
  const gateList = await Promise.all(WHOLESALERS.map(async (id) => [id, await importGate(id)] as const));
  const gateReasons = Object.fromEntries(gateList.map(([id, gate]) => [id, gate.reason ?? null])) as Record<WholesalerId, ImportGateReason | null>;
  return {
    gateReasons,
    suppliers: suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, customerNumber: supplier.customerNumber, wholesaler: supplier.wholesaler, articles: supplier._count.articles + (wholesaleCounts.get(supplier.id)?.articles ?? 0) + (fileCounts.get(supplier.id)?.articles ?? 0),
      latestImport: latestOf(supplier.id),
      priceLists: Object.fromEntries(latestByKind.filter((item) => item.supplierId === supplier.id).map((item) => [item.priceKind, item])) as Partial<Record<"BASE" | "NET", (typeof latestByKind)[number]>>,
      unmatched: (unmatched.get(supplier.id) ?? 0) + (wholesaleCounts.get(supplier.id)?.unmatched ?? 0) + (fileCounts.get(supplier.id)?.unmatched ?? 0),
      latestRebate: rebates.get(supplier.id) ?? null,
      profiles: supplier.profiles.map((profile) => ({ fingerprint: profile.fingerprint, mapping: profile.mapping as CatalogueMapping, format: formatOf(supplier.id, profile.fingerprint) as SavedPriceFormat | null, updatedAt: profile.updatedAt.toISOString() })) })),
    imports: imports.map((item) => ({ id: item.id, fileName: item.fileName, supplierName: item.supplier.name, createdAt: item.createdAt.toISOString(),
      createdBy: people.find((person) => person.id === item.createdById)?.name || people.find((person) => person.id === item.createdById)?.email || "",
      rowCount: item.rowCount, newArticles: item.newArticles, changedPrices: item.changedPrices, unchangedPrices: item.unchangedPrices, failedRows: item.failedRows, prices: item._count.prices + item._count.wholesalePrices + item._count.filePrices, priceKind: item.priceKind === "BASE" ? "BASE" : "NET", ...(kinds.get(item.id) === "REBATE" ? { rebate: true } : {}) })),
    articles: [...(await withRebates(organizationId, articles.map(toHit))), ...wholesaleHits, ...fileHits], articleCount, page, pageSize: PAGE,
  };
}

/** SHA-256 of the cells read, to recognise the same file imported again. */
export const contentHash = (headers: string[], rows: string[][]) => createHash("sha256").update(JSON.stringify([headers, rows])).digest("hex");

/** The import of the same content made earlier in this company, if any. */
export async function previousImport(organizationId: string, hash: string) {
  const found = await prisma.catalogueImport.findFirst({ where: { organizationId, contentHash: hash }, orderBy: { createdAt: "desc" }, select: { createdAt: true, supplier: { select: { name: true } } } });
  return found ? { date: isoDate(found.createdAt), supplierName: found.supplier.name } : null;
}

/**
 * Pris ändrat (2026-10-08), for the preview: per supplier of the company, how many of the file's articles it
 * already has and how many of those keep their latest price. One query for the whole file (the keys and prices go as
 * three arrays), so the person sees new / changed / unchanged for whichever supplier they pick without another upload.
 */
export async function compareWithCatalogue(organizationId: string, rows: Pick<CatalogueRow, "articleKey" | "amount" | "perQuantity">[]): Promise<Record<string, { matched: number; unchanged: number }>> {
  if (!rows.length) return {};
  const keys = rows.map((row) => row.articleKey);
  const amounts = rows.map((row) => String(row.amount));
  const per = rows.map((row) => row.perQuantity);
  const found = await prisma.$queryRaw<{ supplierId: string; matched: number; unchanged: number }[]>`
    WITH f AS (SELECT * FROM unnest(${keys}::text[], ${amounts}::text[], ${per}::int[]) AS f("key", "amount", "per")),
    m AS (SELECT a."id", a."supplierId", f."amount"::numeric AS "amount", f."per" FROM f
      JOIN "CatalogueArticle" a ON a."organizationId" = ${organizationId} AND a."articleKey" = f."key")
    SELECT m."supplierId", count(*)::int AS "matched",
      (count(*) FILTER (WHERE lp."amount" = m."amount" AND lp."perQuantity" = m."per"))::int AS "unchanged"
    FROM m LEFT JOIN LATERAL (
      SELECT p."amount", p."perQuantity" FROM "CataloguePrice" p
      WHERE p."organizationId" = ${organizationId} AND p."articleId" = m."id"
      ORDER BY p."createdAt" DESC, p."id" DESC LIMIT 1) lp ON true
    GROUP BY m."supplierId"`;
  return Object.fromEntries(found.map((item) => [item.supplierId, { matched: Number(item.matched), unchanged: Number(item.unchanged) }]));
}

export type CatalogueImportInput = {
  supplier: { id: string } | { name: string; customerNumber?: string; wholesaler?: WholesalerId | null };
  fileName: string; headers: string[]; rows: string[][]; mapping: CatalogueMapping;
  updateNames: boolean; saveProfile: boolean;
  /** What the prices are; without it the price column's heading decides (GNP, Listpris → grundpris). */
  priceKind?: PriceKind;
};

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Rows per insert: well below Postgres' 65 535 parameters per statement. */
const INSERT_BATCH = 2000;
function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let start = 0; start < items.length; start += size) yield items.slice(start, start + size);
}

/**
 * Imports a price file given as headings and rows (the API, the tests): the same import as the Import page's file
 * (lib/catalogue/import-file.ts) – new articles with their price, a new price row only for a changed price, an
 * unchanged price confirmed, articles missing from the file keep their last price, and the company's products linked.
 */
export async function importCatalogue(caller: CatalogueCaller, input: CatalogueImportInput, today: string) {
  return importCatalogueFile(caller, { supplier: input.supplier, file: priceFileFromGrid(input.fileName, input.headers, input.rows), mapping: input.mapping, updateNames: input.updateNames, saveProfile: input.saveProfile,
    parse: { priceKind: input.priceKind ?? priceKindOfHeading(input.mapping.price) } }, today);
}

/**
 * Removes an import: its prices go, and articles left without any price go with them. Its confirmations go too, so a
 * price it only confirmed is back on the previous confirmation (pris ändrat 2026-10-08). A price it set that a later
 * import confirmed is not lost: the earliest of those confirmations becomes the price row, as if that later import had
 * set it (the later confirmations move with it) – the same result as before, when every import stored its own row.
 * Work orders keep their copied prices – they never point at the catalogue for their values.
 *
 * A wholesaler supplier's import (priser mot katalogartikeln, 2026-10-17) took its price rows (WholesalePrice) and its bit list
 * (WholesaleImportSeen) with it – both go with the import – but a price a later price list still had must not vanish, as above:
 * promoteWholesaleRows (lib/catalogue/wholesale-prices.ts) writes it again under the earliest later list, in this transaction. The rows of a file for a
 * wholesaler without a catalogue (2026-11-01) simply go with the import: the file was the supplier's whole list of the kind, and the one before it was replaced then.
 */
export async function deleteCatalogueImport(caller: CatalogueCaller, importId: string) {
  const organizationId = caller.organizationId;
  const found = await prisma.catalogueImport.findFirst({ where: { id: importId, organizationId }, select: { id: true, supplierId: true, fileName: true, kind: true } });
  if (!found) throw new ApiError(404, "Importen hittades inte.");
  const result = await prisma.$transaction(async (tx) => {
    const wholesalePrices = found.kind === "PRICES" ? await tx.wholesalePrice.count({ where: { organizationId, importId: found.id } }) : 0;
    const filePrices = found.kind === "PRICES" ? await tx.catalogueFilePrice.count({ where: { organizationId, importId: found.id } }) : 0;
    const kept = wholesalePrices ? await promoteWholesaleRows(tx, organizationId, found.id) : 0;
    const promoted = await tx.$queryRaw<{ priceId: string; confirmationId: string; importId: string; confirmedDate: Date; createdAt: Date; fileName: string; articleId: string; amount: Prisma.Decimal; perQuantity: number; unitPrice: Prisma.Decimal; currency: string; priceKind: string }[]>`
      SELECT DISTINCT ON (c."priceId") c."priceId", c."id" AS "confirmationId", c."importId", c."confirmedDate", c."createdAt", i."fileName",
        p."articleId", p."amount", p."perQuantity", p."unitPrice", p."currency", p."priceKind"
      FROM "CataloguePriceConfirmation" c
      JOIN "CataloguePrice" p ON p."id" = c."priceId" AND p."organizationId" = c."organizationId"
      JOIN "CatalogueImport" i ON i."id" = c."importId" AND i."organizationId" = c."organizationId"
      WHERE c."organizationId" = ${organizationId} AND p."importId" = ${found.id} AND c."importId" <> ${found.id}
      ORDER BY c."priceId", c."createdAt", c."id"`;
    for (const batch of chunks(promoted, INSERT_BATCH)) {
      const ids = batch.map(() => randomUUID());
      await tx.cataloguePrice.createMany({ data: batch.map((item, index) => ({
        id: ids[index], organizationId, articleId: item.articleId, importId: item.importId, amount: item.amount, perQuantity: Number(item.perQuantity), unitPrice: item.unitPrice,
        currency: item.currency, priceKind: item.priceKind, priceDate: item.confirmedDate, sourceFileName: item.fileName.slice(0, 200), createdAt: item.createdAt,
      })) });
      // The later confirmations of the same price follow it to its new row; the earliest one goes with the old row.
      await tx.$executeRaw`
        UPDATE "CataloguePriceConfirmation" c SET "priceId" = m."next"
        FROM unnest(${batch.map((item) => item.priceId)}::text[], ${ids}::text[], ${batch.map((item) => item.confirmationId)}::text[]) AS m("old", "next", "first")
        WHERE c."organizationId" = ${organizationId} AND c."priceId" = m."old" AND c."id" <> m."first"`;
    }
    await tx.catalogueImport.delete({ where: { id: found.id } });
    const orphans = await tx.catalogueArticle.deleteMany({ where: { organizationId, supplierId: found.supplierId, prices: { none: {} } } });
    await removeUnlinkedProducts(tx, organizationId);
    return { removedArticles: orphans.count, removedWholesalePrices: wholesalePrices - kept, keptWholesalePrices: kept, removedFilePrices: filePrices };
  }, { timeout: 300_000, maxWait: 10_000 });
  await prisma.administrationEvent.create({ data: { actorId: caller.userId, organizationId, action: "catalogue_import_delete",
    detail: `Artiklar och priser: importen ${found.fileName} togs bort (${result.removedArticles} artiklar utan pris togs bort${result.removedWholesalePrices || result.keptWholesalePrices ? `, ${result.removedWholesalePrices} priser på grossistens artiklar togs bort och ${result.keptWholesalePrices} flyttades till en senare prislista som hade samma pris` : ""}${result.removedFilePrices ? `, ${result.removedFilePrices} prisrader ur filen togs bort` : ""}).` } });
  return result;
}

/** Renames a supplier or changes its customer number. */
export async function updateSupplier(caller: CatalogueCaller, id: string, input: { name: string; customerNumber: string; wholesaler?: WholesalerId | null }) {
  const organizationId = caller.organizationId;
  const supplier = await prisma.catalogueSupplier.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!supplier) throw new ApiError(404, "Leverantören hittades inte.");
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name) throw new ApiError(400, "Skriv leverantörens namn.");
  const clash = await prisma.catalogueSupplier.findFirst({ where: { organizationId, nameKey: nameKey(name), NOT: { id } }, select: { id: true } });
  if (clash) throw new ApiError(409, "Det finns redan en leverantör med det namnet.");
  await prisma.catalogueSupplier.update({ where: { id: supplier.id }, data: { name, nameKey: nameKey(name), customerNumber: input.customerNumber.trim().slice(0, 60), ...(input.wholesaler !== undefined ? { wholesaler: input.wholesaler } : {}) } });
}

/** Removes a supplier with its articles, prices, imports and saved mappings. Work orders keep their copies. */
export async function deleteSupplier(caller: CatalogueCaller, id: string) {
  const organizationId = caller.organizationId;
  const supplier = await prisma.catalogueSupplier.findFirst({ where: { id, organizationId }, select: { id: true, name: true } });
  if (!supplier) throw new ApiError(404, "Leverantören hittades inte.");
  await prisma.$transaction(async (tx) => {
    await tx.catalogueSupplier.delete({ where: { id: supplier.id } });
    // Products only this supplier had go with it; products other suppliers also have stay.
    await removeUnlinkedProducts(tx, organizationId);
  });
  await prisma.administrationEvent.create({ data: { actorId: caller.userId, organizationId, action: "catalogue_supplier_delete", detail: `Artiklar och priser: leverantören ${supplier.name} togs bort med sina artiklar och priser.` } });
}
