import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import type { CatalogueCaller } from "@/lib/catalogue/access";
import { suggestCatalogueColumns, type ColumnSuggestions } from "@/lib/catalogue/columns";
import type { PriceFile, PriceFileFormat, PriceFileInfo } from "@/lib/catalogue/file/open";
import { CATALOGUE_PREVIEW_ROWS, CatalogueRowParser, classifyCatalogueRows, MAX_CATALOGUE_ROWS, type CatalogueMapping, type CatalogueParseOptions, type CatalogueRow, type CatalogueRowError, type CatalogueRowErrorKind } from "@/lib/catalogue/model";
import { removeUnlinkedProducts } from "@/lib/catalogue/products";
import { importGate, wholesalerOfSupplier, type ImportGate } from "@/lib/catalogue/catalogue-gate";
import { manufacturerKey, productKeyOf } from "@/lib/catalogue/normalize";
import { rebateFileReason, type PriceKind } from "@/lib/catalogue/price-kind";
import { SeenBits, WholesalePreview, finishWholesaleImport, matchBatch, writeWholesaleBatch, type ExtraColumns, type WholesaleBatchContext } from "@/lib/catalogue/wholesale-prices";
import { assertCompanyRowLimit, catalogueRowLimit, FilePricePreview, removeFilePrices, replacePreviousFilePrices, storedCatalogueRows, writeFilePriceBatch, type FilePriceContext } from "@/lib/catalogue/file-prices";
import { companyRowLimitMessage } from "@/lib/catalogue/gate-text";
import type { WholesalerId } from "@/lib/wholesale/model";

/**
 * Prisfiler, etapp 1 (2026-10-12): the preview and the import of a price file read as a stream. Rows are parsed
 * one at a time and handled in batches – compared with the catalogue for the preview, written for the import – so a
 * list of 300 000 rows is never held in memory. The import is all or nothing, written in safe batches since 2026-10-13
 * (see importCatalogueFile): a new
 * article gets its first price, a changed price a new price row, an unchanged price only a confirmation, articles
 * missing from the file keep their last price, and each article is linked to the company's product with the same
 * E-nummer or RSK-nummer (lib/catalogue/products.ts). Everything is bound to the caller's company.
 *
 * Two ways to write (2026-10-17, alternativ C): a supplier that is a wholesaler with an API catalogue (the gate says
 * `catalogue: <wholesaler>`) gets its prices as WholesalePrice rows on the wholesaler's own article in the shared register and one
 * bit list per import instead of confirmations (lib/catalogue/wholesale-prices.ts) – nothing is written to the company's own
 * articles, products or CataloguePrice. A supplier the company named itself (`catalogue: null`) is written as described above.
 *
 * A third way (produktägaren 2026-11-01): a wholesaler without a working catalogue (the gate says `fileRows: <wholesaler>`) gets only the rows of the file, as rows
 * that need no article (lib/catalogue/file-prices.ts), within the company's limit; a new file of the same supplier and price kind replaces the previous one.
 */
const BATCH = 5000;
const COMPARE_BATCH = 5000;

/** SHA-256 of the cells read, built row by row the same way as contentHash() (JSON of [headers, rows]). */
class RowHash {
  private readonly hash = createHash("sha256");
  private first = true;
  constructor(headers: string[]) { this.hash.update(`[${JSON.stringify(headers)},[`); }
  add(cells: string[]) { this.hash.update(`${this.first ? "" : ","}${JSON.stringify(cells)}`); this.first = false; }
  digest() { this.hash.update("]]"); return this.hash.digest("hex"); }
}

export type CataloguePreviewResult = {
  rows: CatalogueRow[]; rowCount: number; errors: CatalogueRowError[]; errorCount: number; errorsByKind: Record<CatalogueRowErrorKind, number>;
  missing: string[]; total: number;
  previous: { date: string; supplierName: string } | null;
  /** Per supplier: the file's rows it already has a price for, how many keep it, and – for a wholesaler's catalogue – the rows the import will not read. */
  bySupplier: Record<string, { matched: number; unchanged: number; skipped?: number }>;
  withDiscountGroup: number; withCommonNumber: number; zeroPrices: number;
  fileTruncated: boolean; rowLimit: number;
  /** How the file was read, and the column suggestion for its headings and first rows. */
  format: PriceFileInfo;
  columns: ColumnSuggestions;
  /** The first rows as read (cells), so the page can show the columns before they are mapped. */
  sample: string[][];
  hash: string;
  /**
   * Prisexempel (2026-10-13 natt): rows from the start, the middle and the end of the file with their price as written
   * (amount for a quantity, "350 kr / 100 st"), and per supplier the largest changes against its latest prices.
   */
  examples: CatalogueRow[];
  changes: Record<string, PriceChange[]>;
  highPrices: number;
  /** Why the file looks like a discount letter rather than a price list, when it does. */
  rebate: string | null;
  /**
   * The company's limit on rows from price files, when this installation has one: the rows it holds, and per supplier the rows a file of this kind would
   * take the place of. Null without a reader or a limit.
   */
  companyRows: { limit: number; stored: number; replaced: Record<string, number> } | null;
};
/** One article whose price changes most against the supplier's latest price (unit prices compared). */
export type PriceChange = { articleNo: string; name: string; unit: string; before: number; after: number; amount: number; perQuantity: number };
const EXAMPLES_EACH = 3;
const CHANGES_EACH = 5;

/** Per supplier: how many of the rows' articles it already has and how many keep their latest price. */
async function compareBatch(organizationId: string, rows: Pick<CatalogueRow, "articleKey" | "amount" | "perQuantity">[], priceKind: PriceKind) {
  if (!rows.length) return [];
  return prisma.$queryRaw<{ supplierId: string; matched: number; unchanged: number }[]>`
    WITH f AS (SELECT * FROM unnest(${rows.map((row) => row.articleKey)}::text[], ${rows.map((row) => String(row.amount))}::text[], ${rows.map((row) => row.perQuantity)}::int[]) AS f("key", "amount", "per")),
    m AS (SELECT a."id", a."supplierId", f."amount"::numeric AS "amount", f."per" FROM f
      JOIN "CatalogueArticle" a ON a."organizationId" = ${organizationId} AND a."articleKey" = f."key")
    SELECT m."supplierId", count(*)::int AS "matched",
      (count(*) FILTER (WHERE lp."amount" = m."amount" AND lp."perQuantity" = m."per"))::int AS "unchanged"
    FROM m LEFT JOIN LATERAL (
      SELECT p."amount", p."perQuantity" FROM "CataloguePrice" p
      WHERE p."organizationId" = ${organizationId} AND p."articleId" = m."id" AND p."priceKind" = ${priceKind}
      ORDER BY p."createdAt" DESC, p."id" DESC LIMIT 1) lp ON true
    GROUP BY m."supplierId"`;
}

/** Per supplier, the batch's articles whose unit price changes the most (as a factor up or down) against the latest price. */
async function largestChanges(organizationId: string, rows: Pick<CatalogueRow, "articleKey" | "amount" | "perQuantity">[], priceKind: PriceKind) {
  if (!rows.length) return [];
  return prisma.$queryRaw<{ supplierId: string; key: string; before: Prisma.Decimal; factor: number }[]>`
    WITH f AS (SELECT * FROM unnest(${rows.map((row) => row.articleKey)}::text[], ${rows.map((row) => String(row.amount))}::text[], ${rows.map((row) => row.perQuantity)}::int[]) AS f("key", "amount", "per")),
    m AS (SELECT a."id", a."supplierId", f."key", f."amount"::numeric / f."per" AS "after" FROM f
      JOIN "CatalogueArticle" a ON a."organizationId" = ${organizationId} AND a."articleKey" = f."key"),
    c AS (SELECT m."supplierId", m."key", lp."unitPrice" AS "before",
        greatest(m."after" / lp."unitPrice", lp."unitPrice" / m."after")::float8 AS "factor"
      FROM m JOIN LATERAL (
        SELECT p."unitPrice" FROM "CataloguePrice" p
        WHERE p."organizationId" = ${organizationId} AND p."articleId" = m."id" AND p."priceKind" = ${priceKind}
        ORDER BY p."createdAt" DESC, p."id" DESC LIMIT 1) lp ON true
      WHERE lp."unitPrice" > 0 AND m."after" > 0 AND lp."unitPrice" <> m."after"),
    r AS (SELECT c.*, row_number() OVER (PARTITION BY c."supplierId" ORDER BY c."factor" DESC, c."key") AS "n" FROM c)
    SELECT "supplierId", "key", "before", "factor" FROM r WHERE "n" <= ${CHANGES_EACH}`;
}

/**
 * The company's suppliers whose files the import writes as prices on the wholesaler's catalogue articles (the gate says
 * `catalogue: <wholesaler>`) and as rows of their own (`fileRows: <wholesaler>`), so the preview compares them there and not with the company's own
 * articles.
 */
async function wholesaleSuppliers(organizationId: string): Promise<{ catalogue: { id: string; wholesaler: WholesalerId }[]; files: { id: string }[] }> {
  const suppliers = await prisma.catalogueSupplier.findMany({ where: { organizationId }, select: { id: true, name: true, wholesaler: true } });
  const gates = new Map<WholesalerId, ImportGate | null>();
  const found: { catalogue: { id: string; wholesaler: WholesalerId }[]; files: { id: string }[] } = { catalogue: [], files: [] };
  for (const supplier of suppliers) {
    const wholesaler = wholesalerOfSupplier(supplier);
    if (!wholesaler) continue;
    // A gate that cannot be read only means no comparison here – the import itself asks the gate again.
    const gate = gates.has(wholesaler) ? gates.get(wholesaler)! : await importGate(wholesaler).catch(() => null);
    gates.set(wholesaler, gate);
    if (gate?.catalogue) found.catalogue.push({ id: supplier.id, wholesaler: gate.catalogue });
    else if (gate?.fileRows) found.files.push({ id: supplier.id });
  }
  return found;
}

/** What the preview says about the company's limit: the rows it holds, and per supplier how many of them a file of this kind would take the place of. */
async function companyRowsOf(organizationId: string, priceKind: PriceKind): Promise<CataloguePreviewResult["companyRows"]> {
  const limit = catalogueRowLimit();
  if (limit === null) return null;
  const replaced = await prisma.catalogueFilePrice.groupBy({ by: ["supplierId"], where: { organizationId, priceKind }, _count: { _all: true } });
  return { limit, stored: await storedCatalogueRows(prisma, organizationId), replaced: Object.fromEntries(replaced.map((row) => [row.supplierId, row._count._all])) };
}

/**
 * The preview of a price file: every row checked, the counts against each of the company's suppliers (when the
 * person may read the catalogue), the first rows and errors, and the same content imported before. Writes nothing.
 */
export async function previewCatalogueFile(file: PriceFile, mapping: CatalogueMapping, parse: CatalogueParseOptions, today: string, reader: { organizationId: string } | null): Promise<CataloguePreviewResult> {
  const headers = file.info.headers;
  const parser = new CatalogueRowParser(headers, mapping, today, parse);
  // A file is compared with the latest price of its own kind (2026-10-15): a GNP list and a net price list of the same
  // supplier are two layers and never count as each other's changes.
  const previewKind: PriceKind = parse.priceKind === "BASE" ? "BASE" : "NET";
  const hash = new RowHash(headers);
  const kept: CatalogueRow[] = [];
  const bySupplier: Record<string, { matched: number; unchanged: number; skipped?: number }> = {};
  const changes: Record<string, (PriceChange & { factor: number })[]> = {};
  // A wholesaler's supplier is compared with its prices on the catalogue's articles, the same way the import will read the file.
  const routes = reader ? await wholesaleSuppliers(reader.organizationId) : null;
  const wholesale = reader && routes ? new WholesalePreview(prisma, reader.organizationId, previewKind, routes.catalogue, CHANGES_EACH) : null;
  const fileRows = reader && routes ? new FilePricePreview(prisma, reader.organizationId, previewKind, routes.files, CHANGES_EACH) : null;
  const elsewhere = (supplierId: string) => Boolean(wholesale?.covers(supplierId) || fileRows?.covers(supplierId));
  // Every 500th row is kept as a candidate for the middle of the file, the last rows in a short ring.
  const spread: CatalogueRow[] = [];
  let tail: CatalogueRow[] = [];
  let batch: CatalogueRow[] = [];
  let truncated = false;
  const flush = async () => {
    if (reader && batch.length) {
      for (const item of await compareBatch(reader.organizationId, batch, previewKind)) {
        if (elsewhere(item.supplierId)) continue;
        const sum = bySupplier[item.supplierId] ?? { matched: 0, unchanged: 0 };
        sum.matched += Number(item.matched); sum.unchanged += Number(item.unchanged);
        bySupplier[item.supplierId] = sum;
      }
      const byKey = new Map(batch.map((row) => [row.articleKey, row]));
      for (const item of await largestChanges(reader.organizationId, batch, previewKind)) {
        if (elsewhere(item.supplierId)) continue;
        const row = byKey.get(item.key);
        if (!row) continue;
        const list = changes[item.supplierId] ?? [];
        list.push({ articleNo: row.articleNo || (row.eNumber ? `E ${row.eNumber}` : ""), name: row.name, unit: row.unit, before: Number(item.before.toString()), after: row.unitPrice, amount: row.amount, perQuantity: row.perQuantity, factor: Number(item.factor) });
        changes[item.supplierId] = list.sort((a, b) => b.factor - a.factor).slice(0, CHANGES_EACH);
      }
      await wholesale?.add(batch);
      await fileRows?.add(batch);
    }
    batch = [];
  };
  for await (const record of file.rows()) {
    if (parser.total >= MAX_CATALOGUE_ROWS) { truncated = true; break; }
    hash.add(record.cells);
    const row = parser.push(record.line, record.cells, record.width);
    if (!row) continue;
    if (kept.length < CATALOGUE_PREVIEW_ROWS) kept.push(row);
    if (parser.accepted % 500 === 0 && spread.length < 2000) spread.push(row);
    tail.push(row); if (tail.length > EXAMPLES_EACH * 4) tail = tail.slice(-EXAMPLES_EACH);
    if (!parser.missing.length) { batch.push(row); if (batch.length >= COMPARE_BATCH) await flush(); }
  }
  await flush();
  for (const side of [wholesale, fileRows]) {
    if (!side) continue;
    for (const [supplierId, sum] of side.sums) bySupplier[supplierId] = sum;
    for (const [supplierId, list] of side.changes) {
      if (list.length) changes[supplierId] = list.map(({ row, before, factor }) => ({ articleNo: row.articleNo || (row.eNumber ? `E ${row.eNumber}` : ""), name: row.name, unit: row.unit, before, after: row.unitPrice, amount: row.amount, perQuantity: row.perQuantity, factor }));
    }
  }
  const digest = hash.digest();
  // Prisexempel: the start, the middle and the end of the file, each row once.
  const pool = spread.length >= EXAMPLES_EACH ? spread : kept;
  const middleAt = Math.floor(pool.length / 2);
  const examples: CatalogueRow[] = [];
  for (const row of [...kept.slice(0, EXAMPLES_EACH), ...pool.slice(Math.max(0, middleAt - 1), middleAt + EXAMPLES_EACH - 1), ...tail.slice(-EXAMPLES_EACH)]) if (!examples.some((item) => item.line === row.line)) examples.push(row);
  const previous = reader ? await prisma.catalogueImport.findFirst({ where: { organizationId: reader.organizationId, contentHash: digest }, orderBy: { createdAt: "desc" }, select: { createdAt: true, supplier: { select: { name: true } } } }) : null;
  return {
    rows: kept, rowCount: parser.accepted, errors: parser.errors.slice(0, CATALOGUE_PREVIEW_ROWS), errorCount: parser.errorCount, errorsByKind: { ...parser.errorsByKind },
    missing: parser.missing, total: parser.total,
    previous: previous ? { date: previous.createdAt.toISOString().slice(0, 10), supplierName: previous.supplier.name } : null,
    bySupplier, withDiscountGroup: parser.withDiscountGroup, withCommonNumber: parser.withCommonNumber, zeroPrices: parser.zeroPrices,
    fileTruncated: truncated, rowLimit: MAX_CATALOGUE_ROWS,
    format: file.info, columns: suggestCatalogueColumns(headers, file.sample, file.info), sample: file.sample.slice(0, 5), hash: digest,
    examples, changes: Object.fromEntries(Object.entries(changes).map(([id, list]) => [id, list.map(({ factor, ...change }) => { void factor; return change; })])),
    highPrices: parser.highPrices,
    rebate: file.info.rebate ?? rebateFileReason(file.info, file.sample),
    companyRows: reader ? await companyRowsOf(reader.organizationId, previewKind) : null,
  };
}

export type CatalogueFileImportInput = {
  supplier: { id: string } | { name: string; customerNumber?: string; wholesaler?: WholesalerId | null };
  file: PriceFile; mapping: CatalogueMapping; parse?: CatalogueParseOptions; format?: PriceFileFormat;
  updateNames: boolean; saveProfile: boolean;
};

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const decimal = (value: Prisma.Decimal | number) => Number(value.toString());
type ArticleFields = { name: string; unit: string; eNumber: string; rskNumber: string; manufacturerArticleNo: string; discountGroup: string; gtin: string; manufacturer: string;
  /** Förpackning, multipel, minsta beställning, lagerförd och status (2026-10-15). */ packageSize: string; orderMultiple: string; minOrderQuantity: string; stocked: string; status: string };
/** A supplier's article as the import finds it: its fields, its product's common number and its latest price. */
type Existing = ArticleFields & {
  id: string; articleKey: string; createdAt: Date;
  productId: string | null; productKind: string | null; productNumber: string | null;
  priceId: string | null; amount: Prisma.Decimal | null; perQuantity: number | null; priceKind: string | null;
};
type Patch = ArticleFields & { id: string; productId: string | null };

/**
 * The product key as the database links on it (the same order as linkProducts in lib/catalogue/products.ts): the
 * E-nummer, the RSK-nummer, the GTIN/EAN, the manufacturer with the manufacturer's number (2026-10-14); otherwise none.
 */
const commonKey = (article: ArticleFields) => productKeyOf(article);

/**
 * The company's products for the given common numbers (kind:number → id), created when missing (Ett artikelregister,
 * 2026-10-12): one select, one insert of the missing ones in a fixed order (so two imports at the same time never wait
 * on each other in a circle), and a last select for numbers another import created meanwhile. A new product takes the
 * name and unit of its first article, earliest created first (the same choice as linkProducts).
 */
type Wanted = { name: string; unit: string; gtin: string; mpnKey: string };
async function productIds(tx: Prisma.TransactionClient, organizationId: string, wanted: Map<string, Wanted>, known: Map<string, string>) {
  const ids = new Map<string, string>();
  const missing = [...wanted.keys()].filter((key) => { const id = known.get(key); if (id) ids.set(key, id); return !id; });
  if (!missing.length) return ids;
  const split = (keys: string[]) => ({ kinds: keys.map((key) => key.slice(0, key.indexOf(":"))), numbers: keys.map((key) => key.slice(key.indexOf(":") + 1)) });
  // A GTIN or a manufacturer's number also meets a product that has it on file (an E-nummer product whose article or
  // the wholesaler's catalogue gave it, 2026-10-14); an E-nummer or RSK product goes first.
  // Each kind of match is its own indexed query (one OR across them made the planner scan the products, 2026-10-14).
  const lookup = async (keys: string[]) => {
    const { kinds, numbers } = split(keys);
    for (const row of await tx.$queryRaw<{ id: string; numberKind: string; number: string }[]>`
      SELECT p."id", p."numberKind", p."number" FROM "CatalogueProduct" p
      JOIN unnest(${kinds}::text[], ${numbers}::text[]) AS u("kind", "number") ON p."numberKind" = u."kind" AND p."number" = u."number"
      WHERE p."organizationId" = ${organizationId}`) ids.set(`${row.numberKind}:${row.number}`, row.id);
    const other = keys.filter((key) => !ids.has(key) && (key.startsWith("GTIN:") || key.startsWith("MPN:")));
    if (!other.length) return;
    const gtins = other.filter((key) => key.startsWith("GTIN:")).map((key) => key.slice(5));
    const makers = other.filter((key) => key.startsWith("MPN:")).map((key) => key.slice(4));
    for (const row of await tx.$queryRaw<{ id: string; key: string }[]>`
      SELECT DISTINCT ON ("key") "id", "key" FROM (
        SELECT p."id", 'GTIN:' || p."gtin" AS "key", p."numberKind", p."createdAt" FROM "CatalogueProduct" p
        WHERE p."organizationId" = ${organizationId} AND p."gtin" = ANY(${gtins}::text[])
        UNION ALL
        SELECT p."id", 'MPN:' || p."mpnKey" AS "key", p."numberKind", p."createdAt" FROM "CatalogueProduct" p
        WHERE p."organizationId" = ${organizationId} AND p."mpnKey" = ANY(${makers}::text[])) m
      ORDER BY "key", CASE "numberKind" WHEN 'E' THEN 0 WHEN 'RSK' THEN 1 WHEN 'GTIN' THEN 2 ELSE 3 END, "createdAt", "id"`) ids.set(row.key, row.id);
  };
  await lookup(missing);
  const create = missing.filter((key) => !ids.has(key)).sort();
  if (create.length) {
    const { kinds, numbers } = split(create);
    for (const row of await tx.$queryRaw<{ id: string; numberKind: string; number: string }[]>`
      INSERT INTO "CatalogueProduct" ("id", "organizationId", "numberKind", "number", "name", "unit", "gtin", "mpnKey")
      SELECT u."id", ${organizationId}, u."kind", u."number", u."name", u."unit", u."gtin", u."mpn"
      FROM unnest(${create.map(() => randomUUID())}::text[], ${kinds}::text[], ${numbers}::text[], ${create.map((key) => wanted.get(key)!.name)}::text[], ${create.map((key) => wanted.get(key)!.unit)}::text[],
        ${create.map((key) => wanted.get(key)!.gtin)}::text[], ${create.map((key) => wanted.get(key)!.mpnKey)}::text[])
        WITH ORDINALITY AS u("id", "kind", "number", "name", "unit", "gtin", "mpn", "n")
      ORDER BY u."n"
      ON CONFLICT ("organizationId", "numberKind", "number") DO NOTHING
      RETURNING "id", "numberKind", "number"`) ids.set(`${row.numberKind}:${row.number}`, row.id);
    const raced = create.filter((key) => !ids.has(key));
    if (raced.length) await lookup(raced);
  }
  // A product found on its E-nummer learns the GTIN and the manufacturer's number of its articles when it has none, so a
  // later file with only those numbers meets it (samma produkt hos flera leverantörer, 2026-10-14).
  const learn = [...wanted.entries()].filter(([key, item]) => ids.has(key) && (item.gtin || item.mpnKey));
  if (learn.length) await tx.$executeRaw`
    UPDATE "CatalogueProduct" p SET "gtin" = CASE WHEN p."gtin" = '' THEN u."gtin" ELSE p."gtin" END, "mpnKey" = CASE WHEN p."mpnKey" = '' THEN u."mpn" ELSE p."mpnKey" END
    FROM unnest(${learn.map(([key]) => ids.get(key)!)}::text[], ${learn.map(([, item]) => item.gtin)}::text[], ${learn.map(([, item]) => item.mpnKey)}::text[]) AS u("id", "gtin", "mpn")
    WHERE p."id" = u."id" AND p."organizationId" = ${organizationId} AND ((p."gtin" = '' AND u."gtin" <> '') OR (p."mpnKey" = '' AND u."mpn" <> ''))`;
  return ids;
}

/** The company's own supplier (no wholesaler catalogue): the file's kind of price, and the import day (ÅÅÅÅ-MM-DD) the prices are confirmed on. */
type BatchContext = { organizationId: string; supplierId: string; importId: string; fileName: string; updateNames: boolean; extras: ExtraColumns; priceKind: PriceKind; today: string };
/** What a batch of either kind reports back; `patches` and `left` are only for the company's own articles. */
type BatchResult = { newArticles: number; changedPrices: number; unchangedPrices: number; prices: number; confirmed: number; patches?: Patch[]; left?: string[] };

/**
 * One batch of the file in its own transaction (snabbare import, 2026-10-13): one query for the batch's articles with
 * their product and latest price, the products looked up or created once for the batch, the new articles written with
 * their product, then the batch's prices and confirmations – each one statement over SQL arrays. Changes to existing
 * articles (filled-in numbers, discount group, names, another product) are only computed here and written when the
 * whole file has gone in, so an import that stops leaves the existing articles as they were. Only for a supplier the
 * company named itself: a wholesaler's file is written by writeWholesaleBatch (lib/catalogue/wholesale-prices.ts).
 */
async function writeBatch(tx: Prisma.TransactionClient, context: BatchContext, rows: CatalogueRow[]): Promise<BatchResult> {
  const { organizationId, supplierId, importId, fileName } = context;
  const keys = rows.map((row) => row.articleKey);
  const existing = await tx.$queryRaw<Existing[]>`
    SELECT a."id", a."articleKey", a."name", a."unit", a."eNumber", a."rskNumber", a."manufacturerArticleNo", a."discountGroup", a."gtin", a."manufacturer", a."packageSize", a."orderMultiple", a."minOrderQuantity", a."stocked", a."status", a."createdAt",
      a."productId", p."numberKind" AS "productKind", p."number" AS "productNumber", lp."id" AS "priceId", lp."amount", lp."perQuantity", lp."priceKind"
    FROM "CatalogueArticle" a
    LEFT JOIN "CatalogueProduct" p ON p."id" = a."productId" AND p."organizationId" = a."organizationId"
    LEFT JOIN LATERAL (
      SELECT c."id", c."amount", c."perQuantity", c."priceKind" FROM "CataloguePrice" c
      WHERE c."organizationId" = ${organizationId} AND c."articleId" = a."id" AND c."priceKind" = ${context.priceKind}
      ORDER BY c."createdAt" DESC, c."id" DESC LIMIT 1) lp ON true
    WHERE a."organizationId" = ${organizationId} AND a."supplierId" = ${supplierId} AND a."articleKey" = ANY(${keys}::text[])`;
  const byKey = new Map(existing.map((article) => [article.articleKey, article]));
  // Pris ändrat (2026-10-08): a new price row only for a new article or a changed price.
  const plan = classifyCatalogueRows(rows, new Map(existing.map((article) => [article.articleKey, {
    id: article.id, latest: article.priceId ? { priceId: article.priceId, amount: decimal(article.amount!), perQuantity: Number(article.perQuantity), priceKind: article.priceKind === "BASE" ? "BASE" : "NET" } : null,
  }])), context.priceKind);

  // Existing articles: the name and unit only when the person chose that; numbers the article lacked are filled in;
  // a changed discount group follows the file (the supplier's classification, not a person's wording).
  const updates: { article: Existing; next: Patch; common: string | null }[] = [];
  for (const { row } of [...plan.changed, ...plan.confirmed]) {
    const article = byKey.get(row.articleKey)!;
    const next: Patch = { id: article.id, productId: article.productId, name: article.name, unit: article.unit, eNumber: article.eNumber, rskNumber: article.rskNumber, manufacturerArticleNo: article.manufacturerArticleNo, discountGroup: article.discountGroup, gtin: article.gtin, manufacturer: article.manufacturer,
      packageSize: article.packageSize, orderMultiple: article.orderMultiple, minOrderQuantity: article.minOrderQuantity, stocked: article.stocked, status: article.status };
    if (context.updateNames && (article.name !== row.name || (row.unit && article.unit !== row.unit))) { next.name = row.name; if (row.unit) next.unit = row.unit; }
    if (!article.eNumber && row.eNumber) next.eNumber = row.eNumber;
    if (!article.rskNumber && row.rskNumber) next.rskNumber = row.rskNumber;
    if (!article.manufacturerArticleNo && row.manufacturerArticleNo) next.manufacturerArticleNo = row.manufacturerArticleNo;
    if (!article.gtin && row.gtin) next.gtin = row.gtin;
    if (!article.manufacturer && row.manufacturer) next.manufacturer = row.manufacturer;
    if (row.discountGroup && row.discountGroup !== article.discountGroup) next.discountGroup = row.discountGroup;
    // Förpackning, multipel och status follow the file when it has the column – a status gone back to normal is cleared.
    if (context.extras.packageSize) next.packageSize = row.packageSize;
    if (context.extras.orderMultiple) next.orderMultiple = row.orderMultiple;
    if (context.extras.minOrderQuantity) next.minOrderQuantity = row.minOrderQuantity;
    if (context.extras.stocked) next.stocked = row.stocked;
    if (context.extras.status) next.status = row.status;
    updates.push({ article, next, common: commonKey(next) });
  }

  // Ett artikelregister (2026-10-12): every article of the batch belongs to the company's product with its common
  // number. The products are resolved once for the batch; an article already on the right product keeps it.
  const created = plan.created.map((row) => ({ id: randomUUID(), row, common: commonKey(row) }));
  const known = new Map<string, string>();
  for (const { article } of updates) if (article.productId && article.productKind && article.productNumber) known.set(`${article.productKind}:${article.productNumber}`, article.productId);
  const wanted = new Map<string, Wanted & { order: [number, string] }>();
  const want = (common: string | null, fields: ArticleFields, order: [number, string]) => {
    if (!common) return;
    const current = wanted.get(common);
    const gtin = fields.gtin || current?.gtin || "";
    const mpnKey = manufacturerKey(fields.manufacturer, fields.manufacturerArticleNo) || current?.mpnKey || "";
    if (!current || order[0] < current.order[0] || (order[0] === current.order[0] && order[1] < current.order[1])) wanted.set(common, { name: fields.name, unit: fields.unit, gtin, mpnKey, order });
    else wanted.set(common, { ...current, gtin, mpnKey });
  };
  for (const { article, next, common } of updates) want(common, next, [article.createdAt.getTime(), article.id]);
  for (const item of created) want(item.common, item.row, [Number.MAX_SAFE_INTEGER, item.id]);
  const products = wanted.size ? await productIds(tx, organizationId, wanted, known) : new Map<string, string>();
  const productOf = (common: string | null) => (common ? products.get(common) ?? null : null);

  if (created.length) {
    const column = <T,>(pick: (row: CatalogueRow) => T) => created.map((item) => pick(item.row));
    await tx.$executeRaw`
      INSERT INTO "CatalogueArticle" ("id", "organizationId", "supplierId", "supplierArticleNo", "eNumber", "rskNumber", "manufacturerArticleNo", "articleKey", "name", "unit", "discountGroup", "gtin", "manufacturer", "packageSize", "orderMultiple", "minOrderQuantity", "stocked", "status", "productId", "createdAt", "updatedAt")
      SELECT u."id", ${organizationId}, ${supplierId}, u."no", u."e", u."rsk", u."mfr", u."key", u."name", u."unit", u."grp", u."gtin", u."maker", u."pack", u."mult", u."minq", u."stocked", u."status", u."product", now(), now()
      FROM unnest(${created.map((item) => item.id)}::text[], ${column((row) => row.articleNo)}::text[], ${column((row) => row.eNumber)}::text[], ${column((row) => row.rskNumber)}::text[],
        ${column((row) => row.manufacturerArticleNo)}::text[], ${column((row) => row.articleKey)}::text[], ${column((row) => row.name)}::text[], ${column((row) => row.unit)}::text[], ${column((row) => row.discountGroup)}::text[],
        ${column((row) => row.gtin)}::text[], ${column((row) => row.manufacturer)}::text[], ${column((row) => row.packageSize)}::text[], ${column((row) => row.orderMultiple)}::text[], ${column((row) => row.minOrderQuantity)}::text[],
        ${column((row) => row.stocked)}::text[], ${column((row) => row.status)}::text[], ${created.map((item) => productOf(item.common))}::text[])
        AS u("id", "no", "e", "rsk", "mfr", "key", "name", "unit", "grp", "gtin", "maker", "pack", "mult", "minq", "stocked", "status", "product")`;
  }
  const patches: Patch[] = [];
  const left: string[] = [];
  for (const { article, next, common } of updates) {
    next.productId = productOf(common);
    if (article.productId && article.productId !== next.productId) left.push(article.productId);
    if (next.name !== article.name || next.unit !== article.unit || next.eNumber !== article.eNumber || next.rskNumber !== article.rskNumber || next.manufacturerArticleNo !== article.manufacturerArticleNo || next.discountGroup !== article.discountGroup || next.gtin !== article.gtin || next.manufacturer !== article.manufacturer || next.productId !== article.productId
      || next.packageSize !== article.packageSize || next.orderMultiple !== article.orderMultiple || next.minOrderQuantity !== article.minOrderQuantity
      || next.stocked !== article.stocked || next.status !== article.status) patches.push(next);
  }
  const prices = [...created.map((item) => ({ articleId: item.id, row: item.row })), ...plan.changed].map((item) => ({ ...item, id: randomUUID() }));
  // As SQL arrays rather than one object per row: a batch of prices stays small in memory (2026-10-12).
  if (prices.length) await tx.$executeRaw`
    INSERT INTO "CataloguePrice" ("id", "organizationId", "articleId", "importId", "amount", "perQuantity", "unitPrice", "currency", "priceKind", "priceDate", "sourceFileName")
    SELECT u."id", ${organizationId}, u."article", ${importId}, u."amount"::numeric, u."per", u."unit"::numeric, 'SEK', ${context.priceKind}, u."day"::date, ${fileName}
    FROM unnest(${prices.map((item) => item.id)}::text[], ${prices.map((item) => item.articleId)}::text[], ${prices.map((item) => String(item.row.amount))}::text[],
      ${prices.map((item) => item.row.perQuantity)}::int[], ${prices.map((item) => String(item.row.unitPrice))}::text[], ${prices.map((item) => item.row.priceDate)}::text[])
      AS u("id", "article", "amount", "per", "unit", "day")`;
  // Bekräftad = the day the file was imported (2026-10-13 natt, B4): an unchanged price, and a new price whose date in the
  // file is earlier, are confirmed today – a list fetched today is never "older than 3 months" because of the file's dates.
  const confirmations = [...plan.confirmed.map((item) => item.priceId), ...prices.filter((item) => item.row.priceDate < context.today).map((item) => item.id)];
  if (confirmations.length) await tx.$executeRaw`
    INSERT INTO "CataloguePriceConfirmation" ("id", "organizationId", "priceId", "importId", "confirmedDate")
    SELECT u."id", ${organizationId}, u."price", ${importId}, ${context.today}::date
    FROM unnest(${confirmations.map(() => randomUUID())}::text[], ${confirmations}::text[]) AS u("id", "price")`;
  return { newArticles: plan.newArticles, changedPrices: plan.changedPrices, unchangedPrices: plan.unchangedPrices, prices: prices.length, confirmed: plan.confirmed.length, patches, left };
}

/** Writes the changes to existing articles, in statements of at most BATCH articles. */
async function writePatches(tx: Prisma.TransactionClient, organizationId: string, all: Patch[]) {
  for (let start = 0; start < all.length; start += BATCH) {
    const patches = all.slice(start, start + BATCH);
    await tx.$executeRaw`
      UPDATE "CatalogueArticle" a SET "name" = u."name", "unit" = u."unit", "eNumber" = u."e", "rskNumber" = u."rsk", "manufacturerArticleNo" = u."mfr", "discountGroup" = u."grp", "gtin" = u."gtin", "manufacturer" = u."maker",
        "packageSize" = u."pack", "orderMultiple" = u."mult", "minOrderQuantity" = u."minq", "stocked" = u."stocked", "status" = u."status", "productId" = u."product", "updatedAt" = now()
      FROM unnest(${patches.map((item) => item.id)}::text[], ${patches.map((item) => item.name)}::text[], ${patches.map((item) => item.unit)}::text[], ${patches.map((item) => item.eNumber)}::text[],
        ${patches.map((item) => item.rskNumber)}::text[], ${patches.map((item) => item.manufacturerArticleNo)}::text[], ${patches.map((item) => item.discountGroup)}::text[],
        ${patches.map((item) => item.gtin)}::text[], ${patches.map((item) => item.manufacturer)}::text[], ${patches.map((item) => item.packageSize)}::text[], ${patches.map((item) => item.orderMultiple)}::text[],
        ${patches.map((item) => item.minOrderQuantity)}::text[], ${patches.map((item) => item.stocked)}::text[], ${patches.map((item) => item.status)}::text[], ${patches.map((item) => item.productId)}::text[])
        AS u("id", "name", "unit", "e", "rsk", "mfr", "grp", "gtin", "maker", "pack", "mult", "minq", "stocked", "status", "product")
      WHERE a."id" = u."id" AND a."organizationId" = ${organizationId}`;
  }
}

/**
 * An import that did not finish is taken back (snabbare import, 2026-10-13): its prices and confirmations go with the
 * import row (a wholesaler's WholesalePrice rows and bit list too – they cascade from it), the articles it created (left
 * without a price) go, products no article links to any more go, and a supplier the import itself created goes when it has
 * no articles. The existing articles were never changed (their changes are written last), so the catalogue is as it was
 * before the import. A wholesaler's import (2026-10-17) created no company articles and leaves the company's own ones alone.
 */
async function undoImport(organizationId: string, supplierId: string, importId: string, removeSupplier: boolean, ownArticles = true) {
  await prisma.$transaction(async (tx) => {
    await tx.catalogueImport.deleteMany({ where: { id: importId, organizationId } });
    if (ownArticles) {
      await tx.catalogueArticle.deleteMany({ where: { organizationId, supplierId, prices: { none: {} } } });
      await removeUnlinkedProducts(tx, organizationId);
    }
    if (removeSupplier) await tx.catalogueSupplier.deleteMany({ where: { id: supplierId, organizationId, articles: { none: {} }, imports: { none: {} } } });
  }, { timeout: 300_000, maxWait: 10_000 });
}

/** Batches written at the same time, each on its own connection and in its own transaction. */
const WRITERS = 6;
/** An unfinished import (no content hash yet) older than this is taken to have stopped (the server restarted). */
const STALE_IMPORT_MS = 60 * 60 * 1000;

/**
 * Artiklar som saknas i senaste prisfilen (2026-10-15): the supplier's articles with a price of this import's kind
 * that the file neither priced nor confirmed. They keep their latest price; the search marks them. Only for the company's own
 * suppliers – a wholesaler's import counts them from its bit list (finishWholesaleImport, lib/catalogue/wholesale-prices.ts).
 */
async function countMissing(tx: Prisma.TransactionClient, organizationId: string, supplierId: string, importId: string, priceKind: PriceKind): Promise<number> {
  // Set-based (2026-10-17): two lists built once and a hash anti-join, not a correlated NOT EXISTS per article – that one chose a
  // nested loop on a 155 000-row file and ran for over ten minutes.
  // The rows just written have no statistics yet, so the planner takes the lists for tiny and picks a nested loop that compares every
  // article with every other (155 000 × 155 000, measured at over 25 minutes). Only this statement is kept from it.
  await tx.$executeRaw`SET LOCAL enable_nestloop = off`;
  const [row] = await tx.$queryRaw<{ missing: number }[]>`
    WITH priced AS (
      SELECT DISTINCT p."articleId" FROM "CataloguePrice" p
      JOIN "CatalogueArticle" a ON a."id" = p."articleId" AND a."organizationId" = p."organizationId"
      WHERE p."organizationId" = ${organizationId} AND a."supplierId" = ${supplierId} AND p."priceKind" = ${priceKind}),
    seen AS (
      SELECT p."articleId" FROM "CataloguePrice" p WHERE p."organizationId" = ${organizationId} AND p."importId" = ${importId}
      UNION
      SELECT p."articleId" FROM "CataloguePriceConfirmation" c JOIN "CataloguePrice" p ON p."id" = c."priceId" AND p."organizationId" = c."organizationId"
      WHERE c."organizationId" = ${organizationId} AND c."importId" = ${importId})
    SELECT count(*)::int AS "missing" FROM priced LEFT JOIN seen ON seen."articleId" = priced."articleId" WHERE seen."articleId" IS NULL`;
  return Number(row?.missing ?? 0);
}

/**
 * Imports a price file into one supplier of the caller's company (see the module comment). Throws before anything is
 * written when a required column is missing.
 *
 * Snabbare import (2026-10-13: "det är ju ingen stor fil"): the file was one transaction where every row cost
 * seven foreign-key checks, a trigger and nine indexes in a row on one connection – 45–75 s for 140 000–300 000 rows.
 * Now the batches are written WRITERS at a time in safe batches: the import row is written first with an empty
 * content hash (unfinished), each batch is its own transaction, and only when every batch is in are the changes to
 * existing articles, the counts and the content hash written in one last transaction. Anything that stops the import
 * (an unreadable file, a failed batch, no readable row) takes it back with undoImport, so the result is all or nothing
 * as before; while it runs, another import of the same supplier is refused. New prices of a running import can be
 * seen before it is done (they are the file's prices); sparade arbetsordrar och offerter ändras aldrig.
 *
 * A wholesaler's file (2026-10-17, alternativ C): the same steps, but each batch is first matched to the wholesaler's
 * catalogue articles – one batch at a time in file order, so an article reached by two rows is always priced by the first –
 * and written as WholesalePrice rows only where the price or an extra is new or changed. The articles of the whole file are
 * collected in one bit list that is written, with the final counts, in the last transaction; an import that stops leaves
 * neither rows nor a list. Rows that are no catalogue article are counted (`notInCatalogue`, `unitDiffers`) and never read.
 *
 * A wholesaler without a catalogue (produktägaren 2026-11-01): the same steps again, every row of the file written as a row of its own. They are invisible until the
 * last transaction, which removes the supplier's previous rows of the kind and finishes the import in one go. The company's limit is checked while the file is
 * read and once more in that transaction (an own supplier's file too, so a name is no way round it); going over it takes the import back with a clear message.
 */
export async function importCatalogueFile(caller: CatalogueCaller, input: CatalogueFileImportInput, today: string) {
  const headers = input.file.info.headers;
  const parse = input.parse ?? {};
  const parser = new CatalogueRowParser(headers, input.mapping, today, parse);
  if (parser.missing.length) throw new ApiError(400, `Välj kolumn för: ${parser.missing.join(", ")}.`);
  const organizationId = caller.organizationId;
  const fileName = input.file.name.slice(0, 200);
  const priceKind: PriceKind = parse.priceKind === "BASE" ? "BASE" : "NET";

  // 1. The supplier and the unfinished import row, committed at once so the batches can refer to them.
  const start = await prisma.$transaction(async (tx) => {
    let supplier: { id: string; name: string } | null;
    let createdSupplier = false;
    if ("id" in input.supplier) {
      supplier = await tx.catalogueSupplier.findFirst({ where: { id: input.supplier.id, organizationId }, select: { id: true, name: true, wholesaler: true } });
      if (!supplier) throw new ApiError(404, "Leverantören hittades inte.");
    } else {
      const name = input.supplier.name.trim().replace(/\s+/g, " ").slice(0, 120);
      if (!name) throw new ApiError(400, "Skriv leverantörens namn.");
      supplier = await tx.catalogueSupplier.findUnique({ where: { organizationId_nameKey: { organizationId, nameKey: nameKey(name) } }, select: { id: true, name: true, wholesaler: true } });
      if (!supplier) {
        supplier = await tx.catalogueSupplier.create({ data: { organizationId, name, nameKey: nameKey(name), customerNumber: (input.supplier.customerNumber ?? "").trim().slice(0, 60), wholesaler: input.supplier.wholesaler ?? input.file.info.variant?.wholesaler ?? null, createdById: caller.userId }, select: { id: true, name: true, wholesaler: true } });
        createdSupplier = true;
      }
    }
    // Which way the file goes (2026-11-01): against the wholesaler's catalogue, as rows of its own, or as the company's own supplier.
    const gate = await importGate(wholesalerOfSupplier(supplier));
    // One import per supplier at a time: the supplier's row is locked while the running imports are checked.
    await tx.$queryRaw`SELECT "id" FROM "CatalogueSupplier" WHERE "id" = ${supplier.id} AND "organizationId" = ${organizationId} FOR NO KEY UPDATE`;
    const running = await tx.catalogueImport.findMany({ where: { organizationId, supplierId: supplier.id, contentHash: "" }, select: { id: true, createdAt: true } });
    if (running.some((item) => Date.now() - item.createdAt.getTime() < STALE_IMPORT_MS)) throw new ApiError(409, "En import till den här leverantören pågår redan. Vänta tills den är klar.");
    const imported = await tx.catalogueImport.create({ data: { organizationId, supplierId: supplier.id, fileName, contentHash: "", createdById: caller.userId, priceKind }, select: { id: true } });
    return { supplier, createdSupplier, importId: imported.id, stale: running.map((item) => item.id), catalogue: gate.catalogue, fileRows: gate.catalogue ? null : gate.fileRows ?? null };
  }, { timeout: 60_000, maxWait: 10_000 });
  const { supplier, importId } = start;
  const supplierId = supplier.id;
  // An import that stopped long ago without finishing (the server restarted) is taken back first – in full, since it may have been
  // written the old way, as the company's own articles, before the supplier was marked as a wholesaler.
  for (const id of start.stale) await undoImport(organizationId, supplierId, id, false);

  const mapped = (field: string) => Boolean(input.mapping[field] && headers.includes(input.mapping[field]!));
  const extras: ExtraColumns = { packageSize: mapped("packageSize"), orderMultiple: mapped("orderMultiple"), minOrderQuantity: mapped("minOrderQuantity"), stocked: mapped("stocked"), status: mapped("status") || mapped("priceOnRequest") };
  const context: BatchContext = { organizationId, supplierId, importId, fileName, updateNames: input.updateNames, extras, priceKind, today };
  // A wholesaler's file is priced on the catalogue's articles (2026-10-17): the articles the file has are collected in `seen`.
  const wholesale = start.catalogue ? { wholesaler: start.catalogue, context: { organizationId, supplierId, importId, priceKind, extras } satisfies WholesaleBatchContext, seen: new SeenBits() } : null;
  const files: FilePriceContext | null = start.fileRows ? { organizationId, supplierId, importId, wholesaler: start.fileRows, priceKind } : null;
  // The company's limit (2026-11-01): a wholesaler's catalogue prices are no articles of the company's and go as they always have.
  const limit = wholesale ? null : catalogueRowLimit();
  let missingArticles = 0;
  const counts = { newArticles: 0, changedPrices: 0, unchangedPrices: 0, prices: 0, confirmed: 0, notInCatalogue: 0, unitDiffers: 0, sameArticle: 0 };
  const patches: Patch[] = [];
  const left = new Set<string>();
  const hash = new RowHash(headers);
  try {
    const storedBefore = limit === null ? 0 : await storedCatalogueRows(prisma, organizationId, files ? { supplierId, priceKind } : undefined);
    // 2. The batches, WRITERS at a time, while the file goes on being read.
    const running = new Set<Promise<void>>();
    let failed: { error: unknown } | null = null;
    const dispatch = async (write: (tx: Prisma.TransactionClient) => Promise<BatchResult>) => {
      while (running.size >= WRITERS) await Promise.race(running);
      if (failed) throw failed.error;
      const job: Promise<void> = prisma.$transaction(write, { timeout: 300_000, maxWait: 60_000 })
        .then((done) => {
          counts.newArticles += done.newArticles; counts.changedPrices += done.changedPrices; counts.unchangedPrices += done.unchangedPrices;
          counts.prices += done.prices; counts.confirmed += done.confirmed;
          patches.push(...(done.patches ?? []));
          for (const id of done.left ?? []) left.add(id);
        })
        .catch((error: unknown) => { failed ??= { error }; })
        .finally(() => { running.delete(job); });
      running.add(job);
    };
    const send = async (rows: CatalogueRow[]) => {
      if (limit !== null && storedBefore + (files ? parser.accepted : counts.newArticles) > limit) throw new ApiError(413, companyRowLimitMessage(limit));
      if (files) return dispatch((tx) => writeFilePriceBatch(tx, files, rows));
      if (!wholesale) return dispatch((tx) => writeBatch(tx, context, rows));
      // Matched here, in file order and one batch at a time (the match is a read; the writes below run WRITERS at a time).
      const matched = await matchBatch(prisma, wholesale.wholesaler, rows, wholesale.seen);
      counts.notInCatalogue += matched.notInCatalogue; counts.unitDiffers += matched.unitDiffers; counts.sameArticle += matched.sameArticle;
      if (matched.items.length) await dispatch((tx) => writeWholesaleBatch(tx, wholesale.context, matched.items));
    };
    let batch: CatalogueRow[] = [];
    try {
      for await (const record of input.file.rows()) {
        if (failed) break;
        if (parser.total >= MAX_CATALOGUE_ROWS) throw new ApiError(413, `Filen har fler än ${MAX_CATALOGUE_ROWS.toLocaleString("sv-SE")} rader. Dela upp den i flera filer.`);
        hash.add(record.cells);
        const row = parser.push(record.line, record.cells, record.width);
        if (row) { batch.push(row); if (batch.length >= BATCH) { await send(batch); batch = []; } }
      }
      if (batch.length && !failed) await send(batch);
    } finally {
      // Every batch has ended before the import is finished or taken back.
      await Promise.all(running);
    }
    if (failed) throw (failed as { error: unknown }).error;
    if (!parser.accepted) throw new ApiError(400, "Inga rader kunde läsas. Kontrollera kolumnerna och raderna med fel.");

    // 3. The changes to existing articles, the products they left, the counts and the content hash: the import is done.
    // A wholesaler's import has no company articles to change: its bit list is written here instead, and the supplier's
    // priced articles the list does not have are the ones "inte med i filen".
    await prisma.$transaction(async (tx) => {
      if (wholesale) {
        missingArticles = await finishWholesaleImport(tx, { organizationId, supplierId, importId, priceKind, today }, wholesale.seen);
        // The catalogue has come since the supplier's last file: this file is its list of the kind now, and no article stands twice.
        await removeFilePrices(tx, { organizationId, supplierId, importId, priceKind });
      } else if (files) {
        missingArticles = await replacePreviousFilePrices(tx, files);
        await assertCompanyRowLimit(tx, organizationId);
      } else {
        await writePatches(tx, organizationId, patches);
        if (left.size) await removeUnlinkedProducts(tx, organizationId, [...left]);
        missingArticles = await countMissing(tx, organizationId, supplierId, importId, priceKind);
        await removeFilePrices(tx, { organizationId, supplierId, importId, priceKind });
        await assertCompanyRowLimit(tx, organizationId);
      }
      await tx.catalogueImport.update({ where: { id_organizationId: { id: importId, organizationId } }, data: {
        contentHash: hash.digest(), rowCount: parser.total, newArticles: counts.newArticles, changedPrices: counts.changedPrices, unchangedPrices: counts.unchangedPrices, failedRows: parser.errorCount + counts.sameArticle, missingArticles, notInCatalogue: counts.notInCatalogue + counts.unitDiffers,
      } });
      if (input.saveProfile) {
        const fingerprint = input.file.info.fingerprint;
        const mapping = Object.fromEntries(Object.entries(input.mapping).filter(([, header]) => header && headers.includes(header)));
        const format = { ...(input.format ?? {}), ...(input.file.info.kind === "fixed" ? { fixedStarts: input.file.info.fixedStarts } : {}), header: input.file.info.hasHeader ? "yes" : "no", ...(parse.priceScale && parse.priceScale > 1 ? { priceScale: parse.priceScale } : {}), ...(parse.articleNoIsENumber ? { articleNoIsENumber: true } : {}), ...(parse.eNumberRule ? { eNumberRule: parse.eNumberRule } : {}), priceKind };
        await tx.catalogueImportProfile.upsert({ where: { organizationId_supplierId_fingerprint: { organizationId, supplierId, fingerprint } }, create: { organizationId, supplierId, fingerprint, mapping }, update: { mapping } });
        await tx.$executeRaw`UPDATE "CatalogueImportProfile" SET "format" = ${JSON.stringify(format)}::jsonb WHERE "organizationId" = ${organizationId} AND "supplierId" = ${supplierId} AND "fingerprint" = ${fingerprint}`;
      }
    }, { timeout: 300_000, maxWait: 60_000 });
  } catch (error) {
    try { await undoImport(organizationId, supplierId, importId, start.createdSupplier, !start.catalogue && !files); }
    catch (undo) { console.error("catalogue import: could not take back an unfinished import", importId, undo); }
    throw error;
  }
  const result = { importId, supplier, newArticles: counts.newArticles, changedPrices: counts.changedPrices, unchangedPrices: counts.unchangedPrices, prices: counts.prices, confirmed: counts.confirmed, failedRows: parser.errorCount + counts.sameArticle, missingArticles,
    /** Synkad mot katalogen (2026-10-17): rows that are no article of the wholesaler's catalogue, and rows with its E-nummer but another unit (never guessed). */
    notInCatalogue: counts.notInCatalogue, unitDiffers: counts.unitDiffers, synced: start.catalogue,
    /** Stored as the company's own rows (2026-11-01): this file took the place of the supplier's previous one, and `missingArticles` have no price from a file any more. */
    fileRows: start.fileRows,
    /** Rows for a catalogue article an earlier row of the file already priced (counted in `failedRows`, never written). */
    sameArticle: counts.sameArticle };
  await prisma.administrationEvent.create({ data: { actorId: caller.userId, organizationId, action: "catalogue_import",
    detail: `Artiklar och priser (${result.supplier.name}): ${result.newArticles} nya artiklar, ${result.changedPrices} ändrade priser, ${result.unchangedPrices} oförändrade (bekräftade), ${result.missingArticles} inte med i filen, ${result.failedRows} rader med fel.${result.synced && (result.notInCatalogue || result.unitDiffers) ? ` ${result.notInCatalogue + result.unitDiffers} rader fanns inte i grossistens katalog och lästes inte in.` : ""}${result.fileRows ? " Filen ersatte leverantörens förra fil av samma slag." : ""}` } });
  return result;
}
