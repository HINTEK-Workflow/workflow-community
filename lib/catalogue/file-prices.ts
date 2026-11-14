import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { matchAgainstCatalogue } from "@/lib/catalogue/catalogue-gate";
import { CATALOGUE_ROW_LIMIT, filePriceColumns, fileWholesaleOffer, type FilePriceRow } from "@/lib/catalogue/file-price-model";
import { companyRowLimitMessage } from "@/lib/catalogue/gate-text";
import type { CatalogueRow } from "@/lib/catalogue/model";
import type { PriceKind } from "@/lib/catalogue/price-kind";
import type { RegisterArticleRow } from "@/lib/catalogue/register-hit";
import { buildFilePricePageSql, buildFilePriceSearchSql, parseArticleQuery, type ArticleQuery, type FilePriceSearchRow } from "@/lib/catalogue/search-sql";
import { classifyWholesaleRow, type SeqHistory, type WholesaleBatchResult, type WholesalePreviewChange, type WholesalePreviewSum } from "@/lib/catalogue/wholesale-prices";
import type { WholesaleOffer } from "@/lib/catalogue/wholesale-read";
import { EMPTY_PRICE_EXTRAS } from "@/lib/catalogue/wholesale-model";
import type { WholesalerId } from "@/lib/wholesale/model";

/**
 * Prisfil utan grossistens katalog (produktägaren 2026-11-01), the database side; the rules are in file-price-model.ts. Every query is
 * limited to one company (`organizationId`) and reads only finished imports, so a file that is still being written or that stopped is never seen.
 *
 * A file is written the way the other two kinds are: batch by batch under an unfinished import, then one last transaction. That one removes the
 * previous rows of the same supplier and price kind and finishes the import, so a reader sees either the old file or the new one – never both and
 * never neither. Removing a row touches nothing else: quotes, work orders and purchases have their own copies of what was picked.
 */
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;

/** Whether the company has any such row (one indexed lookup): without one every read here is skipped. */
export async function companyHasFilePrices(organizationId: string, db: Reader = prisma): Promise<boolean> {
  const rows = await db.$queryRaw<{ one: number }[]>`SELECT 1 AS "one" FROM "CatalogueFilePrice" WHERE "organizationId" = ${organizationId} LIMIT 1`;
  return rows.length > 0;
}

/**
 * How many rows the company has stored from price files: these rows and its own suppliers' articles, so a name of the company's own is no way
 * round the limit. `replacing`: the rows a new file of that supplier and kind will take the place of are not counted. A wholesaler's prices on the
 * shared register's articles (WholesalePrice) are not articles of the company's and are not counted.
 */
export async function storedCatalogueRows(db: Reader, organizationId: string, replacing?: { supplierId: string; priceKind: PriceKind }): Promise<number> {
  const [row] = await db.$queryRaw<{ stored: number }[]>`
    SELECT ((SELECT count(*) FROM "CatalogueFilePrice" f WHERE f."organizationId" = ${organizationId} AND NOT (f."supplierId" = ${replacing?.supplierId ?? ""} AND f."priceKind" = ${replacing?.priceKind ?? ""}))
      + (SELECT count(*) FROM "CatalogueArticle" a WHERE a."organizationId" = ${organizationId}))::int AS "stored"`;
  return Number(row?.stored ?? 0);
}

/** Only for tests of the limit itself (no test writes 300 000 rows): replaces the installation's value. */
let testLimit: { limit: number | null } | null = null;
export function overrideCatalogueRowLimitForTests(limit: number | null | undefined) { testLimit = limit === undefined ? null : { limit }; }
/** The limit on rows from price files in this installation; null = none. */
export const catalogueRowLimit = () => (testLimit ? testLimit.limit : CATALOGUE_ROW_LIMIT);

/** Refuses when the company has more rows than the installation allows (in the transaction that finishes an import, so the import is taken back). */
export async function assertCompanyRowLimit(db: Reader, organizationId: string) {
  const limit = catalogueRowLimit();
  if (limit !== null && (await storedCatalogueRows(db, organizationId)) > limit) throw new ApiError(413, companyRowLimitMessage(limit));
}

export type FilePriceContext = { organizationId: string; supplierId: string; importId: string; wholesaler: WholesalerId; priceKind: PriceKind };

/** The supplier's earlier rows for these articles, from finished imports: what a preview and an import compare a file with. */
async function earlierRows(db: Reader, organizationId: string, supplierIds: readonly string[], keys: readonly string[]) {
  if (!keys.length || !supplierIds.length) return [];
  return db.$queryRaw<{ supplierId: string; articleKey: string; priceKind: string; amount: string; perQuantity: number; unitPrice: string }[]>`
    SELECT f."supplierId", f."articleKey", f."priceKind", f."amount"::text AS "amount", f."perQuantity", f."unitPrice"::text AS "unitPrice"
    FROM "CatalogueFilePrice" f
    JOIN "CatalogueImport" i ON i."id" = f."importId" AND i."organizationId" = f."organizationId" AND i."contentHash" <> ''
    WHERE f."organizationId" = ${organizationId} AND f."supplierId" = ANY(${[...supplierIds]}::text[]) AND f."articleKey" = ANY(${[...keys]}::text[])`;
}

/** What the earlier rows say about one article at one supplier, in the shape the wholesaler's rule reads (`classifyWholesaleRow`). */
function historyOf(rows: readonly { articleKey: string; priceKind: string; amount: string; perQuantity: number; unitPrice: string }[], priceKind: PriceKind): Map<string, SeqHistory> {
  const history = new Map<string, SeqHistory>();
  for (const row of rows) {
    const entry = history.get(row.articleKey) ?? { known: true, latest: null };
    if (row.priceKind === priceKind) entry.latest = { ...EMPTY_PRICE_EXTRAS, amount: Number(row.amount), perQuantity: Number(row.perQuantity), unitPrice: Number(row.unitPrice) };
    history.set(row.articleKey, entry);
  }
  return history;
}

/** One batch of a file in its own transaction: compared with the supplier's earlier rows for the counts, then every row written. */
export async function writeFilePriceBatch(tx: Prisma.TransactionClient, context: FilePriceContext, rows: readonly CatalogueRow[]): Promise<WholesaleBatchResult> {
  const { organizationId, supplierId, importId, wholesaler, priceKind } = context;
  const history = historyOf(await earlierRows(tx, organizationId, [supplierId], rows.map((row) => row.articleKey)), priceKind);
  const counts = { newArticles: 0, changedPrices: 0, unchangedPrices: 0 };
  for (const row of rows) {
    const kind = classifyWholesaleRow(row, history.get(row.articleKey));
    if (kind === "new") counts.newArticles += 1; else if (kind === "changed") counts.changedPrices += 1; else counts.unchangedPrices += 1;
  }
  const columns = rows.map(filePriceColumns);
  const column = <T,>(pick: (row: CatalogueRow) => T) => rows.map(pick);
  await tx.$executeRaw`
    INSERT INTO "CatalogueFilePrice" ("organizationId", "supplierId", "importId", "wholesaler", "articleNo", "articleKey", "articleNoNorm", "eNumber", "rskNumber", "gtin", "manufacturer", "manufacturerArticleNo", "productKey",
      "name", "unit", "searchText", "amount", "perQuantity", "unitPrice", "currency", "priceKind", "priceDate", "discountGroup", "packageSize", "orderMultiple", "minOrderQuantity", "stocked", "status")
    SELECT ${organizationId}, ${supplierId}, ${importId}, ${wholesaler}, u."no", u."key", u."norm", u."e", u."rsk", u."gtin", u."maker", u."mfr", u."product", u."name", u."unit", u."text", u."amount"::numeric, u."per", u."unit_price"::numeric, 'SEK', ${priceKind}, u."day"::date,
      u."grp", u."pack", u."mult", u."minq", u."stocked", u."status"
    FROM unnest(${column((row) => row.articleNo)}::text[], ${column((row) => row.articleKey)}::text[], ${columns.map((item) => item.articleNoNorm)}::text[], ${column((row) => row.eNumber)}::text[], ${column((row) => row.rskNumber)}::text[],
      ${column((row) => row.gtin)}::text[], ${column((row) => row.manufacturer)}::text[], ${column((row) => row.manufacturerArticleNo)}::text[], ${columns.map((item) => item.productKey)}::text[], ${column((row) => row.name)}::text[], ${column((row) => row.unit)}::text[],
      ${columns.map((item) => item.searchText)}::text[], ${column((row) => String(row.amount))}::text[], ${column((row) => row.perQuantity)}::int[], ${column((row) => String(row.unitPrice))}::text[], ${column((row) => row.priceDate)}::text[],
      ${column((row) => row.discountGroup)}::text[], ${column((row) => row.packageSize)}::text[], ${column((row) => row.orderMultiple)}::text[], ${column((row) => row.minOrderQuantity)}::text[], ${column((row) => row.stocked)}::text[], ${column((row) => row.status)}::text[])
      AS u("no", "key", "norm", "e", "rsk", "gtin", "maker", "mfr", "product", "name", "unit", "text", "amount", "per", "unit_price", "day", "grp", "pack", "mult", "minq", "stocked", "status")`;
  return { ...counts, prices: rows.length, confirmed: 0 };
}

/**
 * The swap, in the transaction that finishes the new import: the supplier's rows of the same price kind from any other import go. Returns how many
 * articles the previous file had that the new one does not – they have no price from the file any more. Quotes and material rows have their own copies.
 */
export async function replacePreviousFilePrices(tx: Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">, context: Pick<FilePriceContext, "organizationId" | "supplierId" | "importId" | "priceKind">): Promise<number> {
  const { organizationId, supplierId, importId, priceKind } = context;
  const [row] = await tx.$queryRaw<{ missing: number }[]>`
    SELECT count(*)::int AS "missing" FROM "CatalogueFilePrice" o
    WHERE o."organizationId" = ${organizationId} AND o."supplierId" = ${supplierId} AND o."priceKind" = ${priceKind} AND o."importId" <> ${importId}
      AND NOT EXISTS (SELECT 1 FROM "CatalogueFilePrice" n WHERE n."importId" = ${importId} AND n."articleKey" = o."articleKey")`;
  await removeFilePrices(tx, { ...context });
  return Number(row?.missing ?? 0);
}

/**
 * The supplier's rows of the kind from other imports than this one. Also when a file goes the other ways (the wholesaler's catalogue is on now, or the
 * supplier is the company's own): the new file is the supplier's list of that kind, so no article stands twice.
 */
export async function removeFilePrices(tx: Pick<Prisma.TransactionClient, "$executeRaw">, context: Pick<FilePriceContext, "organizationId" | "supplierId" | "importId" | "priceKind">): Promise<number> {
  return tx.$executeRaw`DELETE FROM "CatalogueFilePrice" WHERE "organizationId" = ${context.organizationId} AND "supplierId" = ${context.supplierId} AND "priceKind" = ${context.priceKind} AND "importId" <> ${context.importId}`;
}

/** The preview's numbers for suppliers whose file is written as rows: the same rule and shape as `WholesalePreview`, without a catalogue to skip against. */
export class FilePricePreview {
  readonly sums = new Map<string, WholesalePreviewSum>();
  readonly changes = new Map<string, WholesalePreviewChange[]>();

  constructor(private readonly db: Reader, private readonly organizationId: string, private readonly priceKind: PriceKind, private readonly suppliers: readonly { id: string }[], private readonly changesEach: number) {
    for (const supplier of suppliers) this.sums.set(supplier.id, { matched: 0, unchanged: 0, skipped: 0 });
  }

  covers(supplierId: string) { return this.sums.has(supplierId); }

  async add(rows: readonly CatalogueRow[]) {
    if (!this.suppliers.length) return;
    const found = await earlierRows(this.db, this.organizationId, this.suppliers.map((supplier) => supplier.id), rows.map((row) => row.articleKey));
    for (const supplier of this.suppliers) {
      const own = found.filter((row) => row.supplierId === supplier.id);
      if (!own.length) continue;
      const history = historyOf(own, this.priceKind);
      const sum = this.sums.get(supplier.id)!;
      const biggest = this.changes.get(supplier.id) ?? [];
      for (const row of rows) {
        const known = history.get(row.articleKey);
        const kind = classifyWholesaleRow(row, known);
        if (kind === "new") continue;
        sum.matched += 1;
        if (kind === "unchanged") { sum.unchanged += 1; continue; }
        const before = known?.latest?.unitPrice ?? 0;
        if (before > 0 && row.unitPrice > 0 && before !== row.unitPrice) biggest.push({ row, before, factor: Math.max(row.unitPrice / before, before / row.unitPrice) });
      }
      this.changes.set(supplier.id, biggest.sort((a, b) => b.factor - a.factor || a.row.line - b.row.line).slice(0, this.changesEach));
    }
  }
}

// ---------- reading ----------

/**
 * The price in force per supplier and article among the rows the condition picks (a net price before a base price, the newest first), from finished
 * imports only, with the supplier's name and the file. `where` is written by this module, with `f` as the row; the company is always in the query.
 */
async function rowsInForce(organizationId: string, where: Prisma.Sql): Promise<FilePriceRow[]> {
  return prisma.$queryRaw<FilePriceRow[]>(Prisma.sql`
    SELECT DISTINCT ON (f."supplierId", f."articleKey") f."id"::text AS "id", f."supplierId", s."name" AS "supplierName", f."wholesaler", f."articleNo", f."articleKey", f."eNumber", f."rskNumber", f."gtin", f."manufacturer", f."manufacturerArticleNo", f."productKey",
      f."name", f."unit", f."amount"::text AS "amount", f."perQuantity", f."unitPrice"::text AS "unitPrice", f."currency", f."priceKind", f."priceDate", f."createdAt", f."importId", i."fileName" AS "sourceFileName", i."createdAt" AS "importedAt",
      f."discountGroup", f."packageSize", f."orderMultiple", f."minOrderQuantity", f."stocked", f."status"
    FROM "CatalogueFilePrice" f
    JOIN "CatalogueImport" i ON i."id" = f."importId" AND i."organizationId" = f."organizationId" AND i."contentHash" <> ''
    JOIN "CatalogueSupplier" s ON s."id" = f."supplierId" AND s."organizationId" = f."organizationId"
    WHERE f."organizationId" = ${organizationId} AND ${where}
    ORDER BY f."supplierId", f."articleKey", (f."priceKind" = 'NET') DESC, f."createdAt" DESC, f."id" DESC`);
}

/** The rows matching a search, ranked by the article search's own score; each is the article's price in force, also when only its other layer matched. */
export async function searchFilePrices(organizationId: string, query: string, options: { supplierId?: string | null; limit: number }): Promise<{ rows: FilePriceRow[]; total: number }> {
  const parsed = parseArticleQuery(query);
  if (parsed.folded.length < 2 || !parsed.words.length) return { rows: [], total: 0 };
  const ranked = await prisma.$queryRaw<FilePriceSearchRow[]>(buildFilePriceSearchSql({ organizationId, query: parsed, supplierId: options.supplierId ?? null, limit: options.limit }));
  if (!ranked.length) return { rows: [], total: 0 };
  const found = await rowsInForce(organizationId, Prisma.sql`(f."supplierId", f."articleKey") IN (SELECT * FROM unnest(${ranked.map((row) => row.supplierId)}::text[], ${ranked.map((row) => row.articleKey)}::text[]))`);
  const byPair = new Map(found.map((row) => [`${row.supplierId}|${row.articleKey}`, row]));
  return {
    rows: ranked.flatMap((row) => { const item = byPair.get(`${row.supplierId}|${row.articleKey}`); return item ? [{ ...item, score: Number(row.score), exact: Boolean(row.exact) }] : []; }),
    total: Number(ranked[0].total),
  };
}

/** The company's rows of these products ("E:…", "RSK:…", "GTIN:…", "MPN:…"): every supplier's, beside the product's other offers. */
export async function filePricesOfProducts(organizationId: string, keys: readonly string[]): Promise<FilePriceRow[]> {
  const wanted = [...new Set(keys.filter(Boolean))];
  return wanted.length ? rowsInForce(organizationId, Prisma.sql`f."productKey" = ANY(${wanted}::text[])`) : [];
}

/** The company's rows by the wholesaler's own number (the file's article number, or the E-nummer of a row that has only that), optionally for one supplier. */
export async function filePricesByNumber(organizationId: string, refs: readonly { wholesaler: string; articleNo: string }[], supplierId?: string | null): Promise<FilePriceRow[]> {
  if (!refs.length) return [];
  const numbers = [...new Set(refs.map((ref) => ref.articleNo))];
  const rows = await rowsInForce(organizationId, Prisma.sql`f."wholesaler" = ANY(${[...new Set(refs.map((ref) => ref.wholesaler))]}::text[]) AND (f."articleNo" = ANY(${numbers}::text[]) OR (f."articleNo" = '' AND f."eNumber" = ANY(${numbers}::text[])))
    ${supplierId ? Prisma.sql`AND f."supplierId" = ${supplierId}` : Prisma.empty}`);
  return rows.filter((row) => refs.some((ref) => ref.wholesaler === row.wholesaler && ref.articleNo === (row.articleNo || row.eNumber)));
}

/**
 * Which rows are articles of the wholesaler's register, found when they are read (row id → the article's running number): the same rule as a file
 * matched at import (`matchAgainstCatalogue`), so nothing has to be rewritten when a catalogue is fetched or switched on later. Reads only the register.
 */
export async function linkFileRows(rows: readonly FilePriceRow[]): Promise<Map<string, number>> {
  const links = new Map<string, number>();
  for (const wholesaler of new Set(rows.map((row) => row.wholesaler))) {
    const own = rows.filter((row) => row.wholesaler === wholesaler);
    const match = await matchAgainstCatalogue(prisma, wholesaler as WholesalerId, own.map((row) => ({ articleNo: row.articleNo, eNumber: row.eNumber, unit: row.unit })));
    match.matched.forEach((index, at) => links.set(own[index].id, match.seqs[at]));
  }
  return links;
}

/**
 * The company's prices from its files on these register articles (by running number): per supplier the price in force, as a price on the article.
 * Company-bound; an article with no such row is not in the map.
 */
export async function fileOffersForRegister(organizationId: string, articles: readonly Pick<RegisterArticleRow, "seq" | "wholesaler" | "articleNo" | "eNumber">[]): Promise<Map<number, WholesaleOffer[]>> {
  const result = new Map<number, WholesaleOffer[]>();
  if (!articles.length) return result;
  const eNumbers = [...new Set(articles.map((article) => article.eNumber).filter((value) => /^\d{7}$/.test(value)))];
  const numbers = [...new Set([...articles.map((article) => article.articleNo), ...eNumbers].filter(Boolean))];
  const rows = await rowsInForce(organizationId, Prisma.sql`f."wholesaler" = ANY(${[...new Set(articles.map((article) => article.wholesaler))]}::text[])
    AND (f."articleNo" = ANY(${numbers}::text[]) OR f."productKey" = ANY(${eNumbers.map((value) => `E:${value}`)}::text[]))`);
  if (!rows.length) return result;
  const links = await linkFileRows(rows);
  const bySeq = new Map(articles.map((article) => [article.seq, article]));
  for (const row of rows) {
    const seq = links.get(row.id);
    const article = seq === undefined ? undefined : bySeq.get(seq);
    if (article) result.set(article.seq, [...(result.get(article.seq) ?? []), fileWholesaleOffer(row, article)]);
  }
  return result;
}

/** One page of the company's rows for the Import page's list: the price in force per supplier and article, by name, with the total. "missing" has none: a row is always from the latest file. */
export async function filePricePage(organizationId: string, options: { filter: "" | "unmatched" | "missing"; supplierId: string | null; query: ArticleQuery | null; skip: number; take: number }): Promise<{ rows: FilePriceRow[]; total: number }> {
  if (options.filter === "missing" || options.take < 1) return { rows: [], total: 0 };
  const page = await prisma.$queryRaw<{ supplierId: string; articleKey: string; total: number }[]>(buildFilePricePageSql({ organizationId, ...options, filter: options.filter }));
  if (!page.length) return { rows: [], total: options.skip > 0 ? (await prisma.$queryRaw<{ total: number }[]>(buildFilePricePageSql({ organizationId, ...options, filter: options.filter, skip: 0, take: 1 })))[0]?.total ?? 0 : 0 };
  const found = await rowsInForce(organizationId, Prisma.sql`(f."supplierId", f."articleKey") IN (SELECT * FROM unnest(${page.map((row) => row.supplierId)}::text[], ${page.map((row) => row.articleKey)}::text[]))`);
  const byPair = new Map(found.map((row) => [`${row.supplierId}|${row.articleKey}`, row]));
  return { rows: page.flatMap((row) => byPair.get(`${row.supplierId}|${row.articleKey}`) ?? []), total: Number(page[0].total) };
}

/** Per supplier: how many articles its rows are, and how many of them have no common number (for the wholesaler boxes). */
export async function filePriceCounts(organizationId: string): Promise<Map<string, { articles: number; unmatched: number }>> {
  const rows = await prisma.$queryRaw<{ supplierId: string; articles: number; unmatched: number }[]>`
    SELECT f."supplierId", count(DISTINCT f."articleKey")::int AS "articles", (count(DISTINCT f."articleKey") FILTER (WHERE f."productKey" = ''))::int AS "unmatched"
    FROM "CatalogueFilePrice" f
    JOIN "CatalogueImport" i ON i."id" = f."importId" AND i."organizationId" = f."organizationId" AND i."contentHash" <> ''
    WHERE f."organizationId" = ${organizationId} GROUP BY f."supplierId"`;
  return new Map(rows.map((row) => [row.supplierId, { articles: Number(row.articles), unmatched: Number(row.unmatched) }]));
}
