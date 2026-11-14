import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { trigramSchema } from "@/lib/search/trgm";
import { commonNumberOf } from "@/lib/catalogue/normalize";
import { ARTICLE_SEARCH_MAX_LIMIT, ARTICLE_TYPO_SIMILARITY, buildArticleSearchSql, parseArticleQuery, type ArticleSearchRow } from "@/lib/catalogue/search-sql";
import { pickOffer, type CatalogueHit, type CatalogueOffer } from "@/lib/catalogue/snapshot";
import { WHOLESALERS, type WholesalerId } from "@/lib/wholesale/model";
import { withRebates } from "@/lib/catalogue/rebate-server";
import { productInfoOfMaster } from "@/lib/catalogue/product-info";
import { signedProductImage } from "@/lib/catalogue/product-image";
import { solarStatusText } from "@/lib/integrations/solar";
import { catalogHitOf, withRegisters, type RegisterArticleRow } from "@/lib/catalogue/register-hit";
import { REGISTER_SEARCH_MAX_LIMIT } from "@/lib/catalogue/register-sql";
import { companyArticlesForRegister, companyHasWholesalePrices, fileOffersOf, pricedOffersFor, REGISTER_ROWS, registerHasArticles, registerRowsOfFileRows, searchRegisterRows } from "@/lib/catalogue/register-rows";
import { companyHasFilePrices, filePricesOfProducts, searchFilePrices } from "@/lib/catalogue/file-prices";
import { fileEntryKey, fileHitOf, fileRowAsRegister, productKeysOfHit, withFileOffers, type FilePriceRow } from "@/lib/catalogue/file-price-model";

const isWholesalerId = (value: string | null): value is WholesalerId => (WHOLESALERS as readonly string[]).includes(value ?? "");

/**
 * Artikelsökningen (prisfiler etapp 1, 2026-10-12): the company's register searched as products. A product with
 * the same E-nummer or RSK-nummer at several of the company's suppliers is one hit, with every supplier's own article
 * number, unit and latest price side by side (`offers`); an article without a common number is a hit of its own,
 * marked as only that supplier's. Bounded (at most 50 hits, 12 offers each), company-bound in every query.
 *
 * Priser direkt mot grossistens katalogartikel (2026-10-17, alternativ C): a price file from a wholesaler with a catalogue
 * is stored as the company's price rows on the shared register's articles, not as copies of them. "The company's articles" are
 * therefore the rows of its own suppliers' catalogue AND the register's articles it has a price on (`searchArticles`); the search
 * of the catalogue page, the tools and the article lists reads both, and `searchWithRegister` adds the register's other articles
 * without a price (lib/catalogue/register-search.ts).
 *
 * Prisfil utan grossistens katalog (produktägaren 2026-11-01): the rows of a file for a wholesaler without a catalogue (lib/catalogue/file-prices.ts) are
 * the third side of the same search and follow the same rule: one score, one hit per product, every supplier's offer side by side. A row that is a
 * register article is that article's priced offer; a row with a product joins that product's hit; any other row is a hit of its own, without picture or stock.
 */
const MAX_OFFERS = 12;

type OfferRow = {
  id: string; productId: string | null; name: string; unit: string; supplierArticleNo: string; eNumber: string; rskNumber: string; manufacturerArticleNo: string; discountGroup: string; gtin: string; manufacturer: string;
  supplierId: string; supplierName: string; wholesaler: string | null;
  unitPrice: Prisma.Decimal | null; amount: Prisma.Decimal | null; perQuantity: number | null; priceDate: Date | null; sourceFileName: string | null; importId: string | null; confirmedDate: Date | null;
  priceKind: string | null;
  packageSize: string; orderMultiple: string; minOrderQuantity: string; stocked: string; status: string;
  /** The supplier's latest import of the price's kind, when it neither priced nor confirmed this article. */
  latestFileName: string | null; latestAt: Date | null; seenInLatest: boolean | null;
};

const iso = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "");

function offerOf(row: OfferRow): CatalogueOffer {
  const priceDate = iso(row.priceDate);
  const confirmed = iso(row.confirmedDate);
  return {
    id: row.id, name: row.name, unit: row.unit, supplierArticleNo: row.supplierArticleNo, eNumber: row.eNumber, rskNumber: row.rskNumber, manufacturerArticleNo: row.manufacturerArticleNo,
    ...(row.gtin ? { gtin: row.gtin } : {}), ...(row.manufacturer ? { manufacturer: row.manufacturer } : {}),
    discountGroup: row.discountGroup, supplierId: row.supplierId, supplierName: row.supplierName, ...(isWholesalerId(row.wholesaler) ? { wholesaler: row.wholesaler } : {}),
    ...(row.packageSize ? { packageSize: row.packageSize } : {}), ...(row.orderMultiple ? { orderMultiple: row.orderMultiple } : {}),
    ...(row.minOrderQuantity ? { minOrderQuantity: row.minOrderQuantity } : {}), ...(row.stocked === "J" || row.stocked === "N" ? { stocked: row.stocked === "J" } : {}),
    ...(row.status === "UTGAR" || row.status === "PRIS_PA_BEGARAN" ? { status: row.status } : {}),
    ...(row.seenInLatest === false && row.latestFileName && row.latestAt ? { notInLatest: { fileName: row.latestFileName, date: iso(row.latestAt) } } : {}),
    price: row.unitPrice !== null && row.importId ? {
      unitPrice: Number(row.unitPrice.toString()), priceDate, ...(confirmed > priceDate ? { confirmedDate: confirmed } : {}), sourceFileName: row.sourceFileName ?? "", importId: row.importId,
      ...(row.perQuantity && row.perQuantity !== 1 ? { perQuantity: Number(row.perQuantity), amount: Number(row.amount?.toString() ?? 0) } : {}),
      ...(row.priceKind === "BASE" ? { priceKind: "BASE" as const } : {}),
    } : null,
  };
}

/** The articles of the given products and single articles, each with supplier and latest price. */
async function offersFor(organizationId: string, productIds: string[], articleIds: string[]): Promise<OfferRow[]> {
  if (!productIds.length && !articleIds.length) return [];
  return prisma.$queryRaw<OfferRow[]>`
    SELECT * FROM (
      SELECT a."id", a."productId", a."name", a."unit", a."supplierArticleNo", a."eNumber", a."rskNumber", a."manufacturerArticleNo", a."discountGroup", a."gtin", a."manufacturer",
        a."packageSize", a."orderMultiple", a."minOrderQuantity", a."stocked", a."status",
        s."id" AS "supplierId", s."name" AS "supplierName", s."wholesaler",
        lp."unitPrice", lp."amount", lp."perQuantity", lp."priceDate", lp."sourceFileName", lp."importId", lp."confirmedDate", lp."priceKind",
        li."fileName" AS "latestFileName", li."createdAt" AS "latestAt",
        CASE WHEN li."id" IS NULL OR lp."importId" IS NULL THEN NULL ELSE (lp."importId" = li."id" OR EXISTS (
          SELECT 1 FROM "CataloguePrice" sp JOIN "CataloguePriceConfirmation" sc ON sc."priceId" = sp."id" AND sc."organizationId" = sp."organizationId"
          WHERE sp."organizationId" = a."organizationId" AND sp."articleId" = a."id" AND sc."importId" = li."id")
          OR EXISTS (SELECT 1 FROM "CataloguePrice" sp WHERE sp."organizationId" = a."organizationId" AND sp."articleId" = a."id" AND sp."importId" = li."id")) END AS "seenInLatest",
        row_number() OVER (PARTITION BY coalesce(a."productId", a."id") ORDER BY s."name", a."supplierArticleNo", a."id") AS "position"
      FROM "CatalogueArticle" a
      JOIN "CatalogueSupplier" s ON s."id" = a."supplierId" AND s."organizationId" = a."organizationId"
      LEFT JOIN LATERAL (
        SELECT p."unitPrice", p."amount", p."perQuantity", p."priceDate", p."sourceFileName", p."importId", p."priceKind",
          (SELECT c."confirmedDate" FROM "CataloguePriceConfirmation" c WHERE c."organizationId" = p."organizationId" AND c."priceId" = p."id" ORDER BY c."createdAt" DESC, c."id" DESC LIMIT 1) AS "confirmedDate"
        FROM "CataloguePrice" p WHERE p."organizationId" = ${organizationId} AND p."articleId" = a."id"
        ORDER BY (p."priceKind" = 'NET') DESC, p."createdAt" DESC, p."id" DESC LIMIT 1) lp ON true
      -- The supplier's latest finished price file of the same kind as the price in force (2026-10-15).
      LEFT JOIN LATERAL (
        SELECT i."id", i."fileName", i."createdAt" FROM "CatalogueImport" i
        WHERE i."organizationId" = a."organizationId" AND i."supplierId" = a."supplierId" AND i."kind" = 'PRICES' AND i."contentHash" <> '' AND i."priceKind" = lp."priceKind"
        ORDER BY i."createdAt" DESC, i."id" DESC LIMIT 1) li ON true
      WHERE a."organizationId" = ${organizationId}
        AND (a."productId" = ANY(${productIds}::text[]) OR a."id" = ANY(${articleIds}::text[]))
    ) o WHERE o."position" <= ${MAX_OFFERS}`;
}

export type ArticleSearchOptions = { supplierId?: string | null; limit?: number };

/**
 * Products matching the query among the company's articles: its own suppliers' catalogue and the register's articles it has a
 * price on (bara artiklar jag har pris på, 2026-10-17) – hits with their offers, the total number of products found, and
 * whether typing errors were allowed. Used by the catalogue's search, the tools and the lists; no article without a price.
 */
export async function searchArticles(organizationId: string, query: string, options: ArticleSearchOptions = {}): Promise<{ hits: CatalogueHit[]; total: number; fuzzy: boolean }> {
  const { hits, total, fuzzy } = await searchMerged(organizationId, query, { supplierId: options.supplierId ?? null, limit: options.limit, scope: "priced" });
  return { hits, total, fuzzy };
}

/** The company's matching articles, ranked and one per product (the rows `hitsForRows` turns into hits). */
export async function searchArticleRows(organizationId: string, query: string, options: ArticleSearchOptions = {}): Promise<{ rows: ArticleSearchRow[]; fuzzy: boolean }> {
  const parsed = parseArticleQuery(query);
  if (parsed.folded.length < 2 || !parsed.words.length) return { rows: [], fuzzy: false };
  const limit = Math.max(1, Math.min(ARTICLE_SEARCH_MAX_LIMIT, options.limit ?? 20));
  const base = { organizationId, query: parsed, supplierId: options.supplierId ?? null, limit };
  let rows = await prisma.$queryRaw<ArticleSearchRow[]>(buildArticleSearchSql({ ...base, mode: "match" }));
  let fuzzy = false;
  // Few hits and a word long enough to be misspelt: once more, allowing typing errors (pg_trgm, when installed).
  if (rows.length < Math.min(limit, 5) && parsed.words.some((word) => word.fuzzy)) {
    const trigram = await trigramSchema();
    if (trigram) {
      const typo = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(ARTICLE_TYPO_SIMILARITY)}, true)`;
        return tx.$queryRaw<ArticleSearchRow[]>(buildArticleSearchSql({ ...base, mode: "typo", trigram }));
      });
      if (typo.length > rows.length) { rows = typo; fuzzy = true; }
    }
  }
  return { rows, fuzzy };
}

/**
 * The register's hits for the given articles (Favoriter och artikellistor, 2026-10-16): each row is an article of the
 * company (its product, if any), and the answer is the same hit the search gives – every supplier's offer with the price
 * in force, the offer a row takes, the product's facts – in the rows' order, null where the article is not the company's.
 * `exact` keeps the row's own article as the offer a row takes (a supplier's article that was marked); `anyOffer` stands for
 * the product as a whole (a marked product): the hit is found even when the row's article is not among the offers shown.
 * The rows are articles of the company's own suppliers' catalogue (CatalogueArticle); the register's articles with the
 * company's price rows come from lib/catalogue/register-rows.ts (hitsForRegisterArticles, hitsForRegisterKeys, wholesaleHitById).
 */
export async function hitsForRows(organizationId: string, rows: readonly { id: string; productId: string | null; exact?: boolean; anyOffer?: boolean }[], supplierId: string | null = null): Promise<(CatalogueHit | null)[]> {
  const productIds = rows.filter((row) => row.productId).map((row) => row.productId!);
  const singles = rows.filter((row) => !row.productId).map((row) => row.id);
  const found = await offersFor(organizationId, productIds, singles);
  // Rabattbrev (2026-10-14): a base price with the supplier's discount letter becomes the company's net price.
  const priced = await withRebates(organizationId, found.map(offerOf));
  const offers = found.map((row, index) => ({ row, offer: priced[index] }));
  const byGroup = new Map<string, CatalogueOffer[]>();
  for (const { row, offer } of offers) {
    const key = row.productId ?? row.id;
    const list = byGroup.get(key) ?? [];
    list.push(offer);
    byGroup.set(key, list);
  }
  // Produktens uppgifter (2026-10-16): what an API told about the same product (picture, status), read with the hits.
  const masters = productIds.length ? await prisma.catalogueProduct.findMany({ where: { organizationId, id: { in: [...new Set(productIds)] }, master: { not: Prisma.DbNull } }, select: { id: true, master: true } }) : [];
  const apiInfo = new Map(masters.flatMap((item) => { const info = productInfoOfMaster(item.master, solarStatusText); return info ? [[item.id, signedProductImage(info)] as const] : []; }));
  return rows.map((row): CatalogueHit | null => {
    const list = byGroup.get(row.productId ?? row.id) ?? [];
    const matched = list.find((offer) => offer.id === row.id) ?? (row.anyOffer ? list[0] : undefined);
    if (!matched) return null;
    const primary = pickOffer(list, { matched: matched.id, exact: Boolean(row.exact), supplierId });
    const common = commonNumberOf(primary);
    const product = row.productId ? apiInfo.get(row.productId) : undefined;
    return { ...primary, ...(row.productId ? { productId: row.productId } : {}), ...(row.productId && common ? { common } : {}), ...(product ? { product } : {}), offers: list, supplierOnly: !row.productId };
  });
}

// ---------- the company's own articles and the register, merged per product ----------

/** A typing-error hit is always listed after every exact hit. */
const TYPO_PENALTY = 100_000;

type CompanyRow = { id: string; productId: string | null; exact?: boolean; anyOffer?: boolean };
/** One product in the merged list: the company's own article (with the register rows of its wholesalers beside it) or register rows alone – and the rows of its files that matched. */
type Entry =
  | { kind: "company"; key: string; row: CompanyRow; score: number; registers: RegisterArticleRow[]; exactSeq?: number; files?: FilePriceRow[] }
  | { kind: "catalog"; key: string; registers: RegisterArticleRow[]; score: number; priced: boolean; exactSeq?: number; files?: FilePriceRow[] };

/**
 * What a merged search covers: "priced" = the company's articles only – its own suppliers' catalogue and the register's articles it
 * has a price on; "all" = also every other article of the register, without a price (the article search of the pages).
 */
export type SearchScope = "priced" | "all";

/**
 * The company's articles and the shared register searched together, merged per product, at most `limit` (2026-10-17).
 * - The company's own search (CatalogueArticle, its own suppliers' price files) runs as it always has.
 * - The register is searched too: the articles the company has a price on (WholesalePrice, an EXISTS on the company's price rows)
 *   and – for scope "all" without a supplier chosen – every other article, the priced ones first at an equal score. A register
 *   article the company has a price on is a normal priced hit (one offer per supplier, lib/catalogue/register-rows.ts
 *   pricedOffersFor); one it has no price on is the wholesaler's unpriced row. Each wholesaler keeps its own row: the same
 *   E-nummer only gathers the rows into one product and never moves a price, a number or a status between wholesalers.
 * - A register article that is the same product as an article of the company's own suppliers (the same E-nummer, GTIN or
 *   manufacturer's number – or the wholesaler's own number at the company's supplier that is that wholesaler) joins that hit.
 * With a supplier chosen the search is that supplier's price files only (its own articles and the register articles it has priced).
 * Without any register article – and, in the company's articles only (scope "priced"), without any price of the company on one – it
 * is the company's own search exactly as before.
 */
export async function searchMerged(organizationId: string, query: string, options: { supplierId?: string | null; limit?: number; scope: SearchScope }): Promise<{ hits: CatalogueHit[]; total: number; fuzzy: boolean; register: boolean }> {
  const limit = Math.max(1, Math.min(REGISTER_SEARCH_MAX_LIMIT, options.limit ?? 20));
  const supplierId = options.supplierId ?? null;
  const everything = options.scope === "all" && !supplierId;
  // The article found by its exact number keeps its own offer in the company's articles-only search (the tools, the catalogue
  // page); the article search of the pages takes the lowest price as it always has.
  const keepExact = options.scope === "priced";
  // The company's own search first (it is fast), so the register knows how many exact hits there already are.
  const own = await searchArticleRows(organizationId, query, { supplierId, limit });
  const [hasPrices, hasFiles] = await Promise.all([companyHasWholesalePrices(organizationId), companyHasFilePrices(organizationId)]);
  // The rows of the company's own files that match; one that is a register article takes that article's place in the list below.
  const fileFound = hasFiles ? await searchFilePrices(organizationId, query, { supplierId, limit: REGISTER_ROWS }) : { rows: [] as FilePriceRow[], total: 0 };
  const fileArticles = await registerRowsOfFileRows(fileFound.rows);
  // A company with a price on a register article proves the register has articles; otherwise ask (kept a minute).
  const useRegister = hasPrices || (everything && await registerHasArticles());
  const register = useRegister
    ? await searchRegisterRows(query, REGISTER_ROWS, own.fuzzy ? 0 : own.rows.length, { organizationId, priced: everything ? (hasPrices ? "prefer" : undefined) : "only", supplierId })
    : { rows: [], fuzzy: false };
  const registerRows = [...register.rows, ...fileFound.rows.flatMap((row) => {
    const article = fileArticles.get(row.id);
    return article ? [{ ...article, score: row.score ?? 0, exact: Boolean(row.exact), total: 0, typo: false as boolean | undefined }] : [];
  })];
  const plainRows = fileFound.rows.filter((row) => !fileArticles.has(row.id));
  const [priced, linked, plainLinked] = await Promise.all([
    hasPrices || hasFiles ? pricedOffersFor(organizationId, registerRows) : Promise.resolve(new Map<number, CatalogueOffer[]>()),
    companyArticlesForRegister(organizationId, registerRows),
    companyArticlesForRegister(organizationId, plainRows.map(fileRowAsRegister)),
  ]);
  const entries = new Map<string, Entry>();
  const put = (entry: Entry) => {
    const known = entries.get(entry.key);
    if (!known) { entries.set(entry.key, entry); return; }
    // The same product from both sides: the better score, and every wholesaler's register row beside the company's hit.
    const score = Math.max(known.score, entry.score);
    const registers = [...known.registers, ...entry.registers.filter((row) => !known.registers.some((item) => item.id === row.id))];
    const files = [...(known.files ?? []), ...(entry.files ?? [])];
    if (known.kind === "company") entries.set(entry.key, { ...known, score, registers, files, exactSeq: known.exactSeq ?? (entry.kind === "company" ? entry.exactSeq : undefined) });
    else if (entry.kind === "company") entries.set(entry.key, { ...entry, score, registers, files });
    else entries.set(entry.key, { ...known, score, registers, files, priced: known.priced || entry.priced, exactSeq: known.exactSeq ?? entry.exactSeq });
  };
  for (const row of own.rows) put({ kind: "company", key: row.productId ?? row.id, row: { id: row.id, productId: row.productId, ...(keepExact && row.exact ? { exact: true } : {}) }, score: Number(row.score), registers: [] });
  for (const article of registerRows) {
    const score = Number(article.score) - (article.typo ? TYPO_PENALTY : 0);
    const rows = linked.get(article.id);
    if (rows?.length) for (const row of rows) put({ kind: "company", key: row.productId ?? row.id, row: { ...row, anyOffer: true }, score, registers: [article], ...(keepExact && article.exact ? { exactSeq: article.seq } : {}) });
    else put({ kind: "catalog", key: article.productKey ? `register:${article.productKey}` : `register:${article.id}`, registers: [article], score, priced: priced.has(article.seq), ...(keepExact && article.exact ? { exactSeq: article.seq } : {}) });
  }
  for (const row of plainRows) {
    const score = row.score ?? 0;
    const rows = plainLinked.get(fileRowAsRegister(row).id);
    if (rows?.length) for (const item of rows) put({ kind: "company", key: item.productId ?? item.id, row: { ...item, anyOffer: true }, score, registers: [], files: [row] });
    else put({ kind: "catalog", key: fileEntryKey(row), registers: [], score, priced: true, files: [row] });
  }
  // At an equal score: the company's own articles, then register articles the company has a price on, then the others.
  const order = (entry: Entry) => (entry.kind === "company" ? 0 : entry.priced ? 1 : 2);
  const ranked = [...entries.values()].sort((a, b) => b.score - a.score || order(a) - order(b));
  const shown = ranked.slice(0, limit);
  const company = shown.filter((entry): entry is Extract<Entry, { kind: "company" }> => entry.kind === "company");
  const companyHits = await hitsForRows(organizationId, company.map((entry) => entry.row), supplierId);
  const byKey = new Map(company.map((entry, index) => [entry.key, companyHits[index]]));
  const built = shown.map((entry) => {
    if (entry.kind === "catalog") return { entry, hit: entry.registers.length ? catalogHitOf(entry.registers, priced, { supplierId, exactSeq: entry.exactSeq }) : null };
    const hit = byKey.get(entry.key);
    return { entry, hit: hit ? withRegisters(hit, entry.registers, priced, { supplierId, exact: Boolean(entry.row.exact), exactSeq: entry.exactSeq }) : null };
  });
  // The company's rows from files beside each hit: the ones the search found, and the same product's other rows, whose words may differ.
  const keysOf = ({ entry, hit }: (typeof built)[number]) => [...entry.registers.map((row) => row.productKey), ...(entry.files ?? []).map((row) => row.productKey), ...(hit ? productKeysOfHit(hit) : [])].filter(Boolean);
  const sameProduct = hasFiles ? await filePricesOfProducts(organizationId, built.flatMap(keysOf)) : [];
  const fileOffers = hasFiles ? await fileOffersOf(organizationId, [...new Map([...built.flatMap(({ entry }) => entry.files ?? []), ...sameProduct].map((row) => [row.id, row])).values()]) : [];
  const hits = built.flatMap((item): CatalogueHit[] => {
    const { entry, hit } = item;
    const keys = new Set(keysOf(item));
    const ownRows = new Set((entry.files ?? []).map((row) => row.id));
    const offers = fileOffers.filter(({ row }) => ownRows.has(row.id) || keys.has(row.productKey)).map((found) => found.offer);
    // The row found by its exact number keeps its own offer in the company's articles-only search, as a register article does.
    const exactRow = keepExact ? (entry.files ?? []).find((row) => row.exact) : undefined;
    const exactId = exactRow ? fileOffers.find(({ row }) => row.id === exactRow.id)?.offer.id : undefined;
    if (hit) return [withFileOffers(hit, offers, entry.registers, { supplierId, exact: entry.kind === "company" && Boolean(entry.row.exact), ...(exactId ? { exactId } : {}) })];
    return offers.length ? [fileHitOf(offers, { supplierId, ...(exactId ? { exactId } : {}) })] : [];
  });
  const total = Math.max(Number(own.rows[0]?.total ?? 0), 0) + (register.rows.length ? Math.max(0, Number(register.rows[0]?.total ?? 0) - linked.size) : 0) + plainRows.length;
  return { hits, total: Math.max(total, hits.length), fuzzy: own.fuzzy || register.fuzzy, register: everything && useRegister };
}
