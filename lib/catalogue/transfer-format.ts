import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/lib/kfid/errors";
import { WHOLESALERS, type WholesalerId } from "@/lib/wholesale/model";

/**
 * Artiklar och priser in the Cloud company export (2026-10-08). The catalogue travels in the .hwf file as its own section
 * `workspace.catalogue` (format HWF_CATALOGUE); Local mode never reads or changes it (the catalogue is
 * Cloud only), it only carries it so that the copy can be imported back into Cloud. The format is documented in
 * docs/proposals/grossistimport-2026-10-08.md, 4.7. Rows refer to each other with refs that only exist in the file
 * (s1, i1, a1, p1), never with Cloud ids. Importing it back adds what Cloud lacks and never changes or removes what
 * Cloud has: suppliers by name, imports by supplier + content hash + time, articles by supplier + article key, prices
 * and confirmations by their values (prices stay append-only), saved mappings only where Cloud has none.
 *
 * **Version 2 (2026-10-17, priser direkt mot grossistens katalogartikel):** a price a company has on a wholesaler's
 * catalogue article is not a row of the company's own article but a price row on the register's article (WholesalePrice), and
 * the register is shared – its running numbers and ids mean nothing in another database. So `wholesale` carries those prices
 * by the article's natural key (the wholesaler and its own article number), one group per import, with the import's bit list of
 * the articles the file had (`seen`, as article numbers) beside it. Reading it back finds each article in the target's register:
 * one the register does not have is counted as "inte i katalogen" and left out. A supplier also tells which wholesaler it is.
 * A version 1 file reads exactly as before (it has no `wholesale` and no wholesaler on its suppliers).
 *
 * **Version 3 (produktägaren 2026-11-01, prisfil utan grossistens katalog):** `fileRows` carries the rows of a file for a wholesaler without a catalogue (CatalogueFilePrice),
 * one group per import. They need no article, so all of them come back; each group's rows are what the file had. Earlier versions have none and read as before.
 */

export const CATALOGUE_TRANSFER_FORMAT = "HWF_CATALOGUE";
export const CATALOGUE_TRANSFER_VERSION = 3;
/** What one file may hold; the export refuses (no partial copy) rather than leave rows out. */
export const CATALOGUE_TRANSFER_LIMITS = { suppliers: 200, imports: 2_000, articles: 300_000, prices: 300_000, confirmations: 300_000, mappings: 1_000,
  /** The company's prices on wholesalers' catalogue articles, and the article numbers in all the imports' bit lists together. */
  wholesalePrices: 300_000, seenArticles: 1_000_000,
  /** The rows of files for wholesalers without a catalogue. */
  fileRows: 300_000 } as const;
/**
 * The section's own size. A company must always be able to take its data out (2026-11-02), so this leaves room for everything the limits above
 * allow: a copy past 50 MB comes as the zip file, whose head part may be 200 MB (features/kfid/local-export-zip.ts).
 */
export const MAX_CATALOGUE_TRANSFER_BYTES = 150_000_000;

const ref = z.string().min(2).max(12).regex(/^[siap]\d+$/);
const at = z.iso.datetime();
const date = z.iso.date();
const money = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/);
const count = z.number().int().min(0).max(10_000_000);
// Grundpris or nettopris (2026-10-15): optional, so a file written before the kinds existed reads as before (nettopris).
const priceKind = z.enum(["NET", "BASE"]).optional();

const wholesaler = z.enum(WHOLESALERS);
const wholesaleArticleNo = z.string().min(1).max(100);
/**
 * A price row on a wholesaler's article as a list, since a full price list is a hundred thousand rows: the wholesaler's own
 * article number, the amount, the quantity it is for, the price of one unit, N (net) or B (base) price, the price date, when the
 * row was written, then what the file said about the article (discount group, package, order multiple, minimum order, stocked,
 * status; empty when the file had none). The source file is the import's.
 */
const wholesalePriceRow = z.tuple([wholesaleArticleNo, money, z.number().int().min(1).max(100_000), money, z.enum(["N", "B"]), date, at,
  z.string().max(40), z.string().max(20), z.string().max(20), z.string().max(20), z.string().max(4), z.string().max(20)]);
export type WholesalePriceRow = z.infer<typeof wholesalePriceRow>;
/**
 * A row of a file as a list: article number, article key, E-nummer, RSK-nummer, GTIN, manufacturer, manufacturer's number, name, unit, the price as in `wholesalePriceRow`
 * (amount, quantity, one unit, N or B, price date, when written), then what the file said about the article.
 */
const fileRow = z.tuple([z.string().max(60), z.string().min(1).max(100), z.string().regex(/^\d{0,20}$/), z.string().regex(/^\d{0,20}$/), z.string().max(20), z.string().max(120), z.string().max(60), z.string().min(1).max(300), z.string().max(40),
  money, z.number().int().min(1).max(100_000), money, z.enum(["N", "B"]), date, at,
  z.string().max(40), z.string().max(20), z.string().max(20), z.string().max(20), z.string().max(4), z.string().max(20)]);
export type FileRow = z.infer<typeof fileRow>;
/** One import's rows, from one wholesaler. */
const fileGroup = z.object({ import: ref, wholesaler, rows: z.array(fileRow).max(CATALOGUE_TRANSFER_LIMITS.fileRows) }).strict();
/** One import's data on one wholesaler's articles: its price rows and – when it finished – the bit list as article numbers. */
const wholesaleGroup = z.object({
  import: ref, wholesaler,
  prices: z.array(wholesalePriceRow).max(CATALOGUE_TRANSFER_LIMITS.wholesalePrices),
  seen: z.object({ confirmedDate: date, articles: z.array(wholesaleArticleNo).max(CATALOGUE_TRANSFER_LIMITS.seenArticles) }).strict().optional(),
}).strict();

export const catalogueTransferSchema = z.object({
  format: z.literal(CATALOGUE_TRANSFER_FORMAT),
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(CATALOGUE_TRANSFER_VERSION)]),
  suppliers: z.array(z.object({ ref, name: z.string().trim().min(1).max(120), customerNumber: z.string().max(60).default(""), wholesaler: wholesaler.optional(), createdAt: at })).max(CATALOGUE_TRANSFER_LIMITS.suppliers),
  imports: z.array(z.object({ ref, supplier: ref, fileName: z.string().max(200), contentHash: z.string().regex(/^[0-9a-f]{64}$/), rowCount: count, newArticles: count, changedPrices: count, unchangedPrices: count, failedRows: count, priceKind, createdAt: at })).max(CATALOGUE_TRANSFER_LIMITS.imports),
  articles: z.array(z.object({ ref, supplier: ref, articleNo: z.string().max(60), eNumber: z.string().regex(/^\d{0,20}$/), manufacturerArticleNo: z.string().max(60).optional(), articleKey: z.string().min(1).max(100), name: z.string().min(1).max(300), unit: z.string().max(20), discountGroup: z.string().max(40).default(""), createdAt: at })).max(CATALOGUE_TRANSFER_LIMITS.articles),
  prices: z.array(z.object({ ref, article: ref, import: ref, amount: money, perQuantity: z.number().int().min(1).max(100_000), unitPrice: money, currency: z.literal("SEK"), priceKind, priceDate: date, sourceFileName: z.string().max(200), createdAt: at })).max(CATALOGUE_TRANSFER_LIMITS.prices),
  confirmations: z.array(z.object({ price: ref, import: ref, confirmedDate: date, createdAt: at })).max(CATALOGUE_TRANSFER_LIMITS.confirmations),
  mappings: z.array(z.object({ supplier: ref, fingerprint: z.string().max(2000), mapping: z.record(z.string().max(40), z.string().max(200).nullable()), updatedAt: at })).max(CATALOGUE_TRANSFER_LIMITS.mappings),
  wholesale: z.array(wholesaleGroup).max(CATALOGUE_TRANSFER_LIMITS.imports).default([]),
  fileRows: z.array(fileGroup).max(CATALOGUE_TRANSFER_LIMITS.imports).default([]),
}).strict().superRefine((value, ctx) => {
  // Every ref is unique and points at a row of the right kind in the same file.
  const refs = (rows: { ref: string }[], prefix: string, path: string) => {
    const set = new Set<string>();
    for (const row of rows) { if (!row.ref.startsWith(prefix) || set.has(row.ref)) ctx.addIssue({ code: "custom", path: [path], message: "Ogiltig eller dubblerad referens." }); set.add(row.ref); }
    return set;
  };
  const suppliers = refs(value.suppliers, "s", "suppliers");
  const imports = refs(value.imports, "i", "imports");
  const articles = refs(value.articles, "a", "articles");
  const prices = refs(value.prices, "p", "prices");
  const missing = (ok: boolean, path: string) => { if (!ok) ctx.addIssue({ code: "custom", path: [path], message: "Referensen pekar inte på något i filen." }); };
  for (const row of value.imports) missing(suppliers.has(row.supplier), "imports");
  for (const row of value.articles) missing(suppliers.has(row.supplier), "articles");
  for (const row of value.prices) missing(articles.has(row.article) && imports.has(row.import), "prices");
  for (const row of value.confirmations) missing(prices.has(row.price) && imports.has(row.import), "confirmations");
  for (const row of value.mappings) missing(suppliers.has(row.supplier), "mappings");
  // The wholesaler's part exists from version 2; an import has one group per wholesaler; the totals stay within the limits.
  if (value.schemaVersion < 2 && value.wholesale.length) ctx.addIssue({ code: "custom", path: ["wholesale"], message: "Version 1 har inga priser på grossistens artiklar." });
  const groups = new Set<string>();
  let wholesalePrices = 0;
  let seenArticles = 0;
  for (const group of value.wholesale) {
    missing(imports.has(group.import), "wholesale");
    const key = `${group.import}|${group.wholesaler}`;
    if (groups.has(key)) ctx.addIssue({ code: "custom", path: ["wholesale"], message: "Ogiltig eller dubblerad referens." });
    groups.add(key);
    wholesalePrices += group.prices.length;
    seenArticles += group.seen?.articles.length ?? 0;
  }
  if (wholesalePrices > CATALOGUE_TRANSFER_LIMITS.wholesalePrices || seenArticles > CATALOGUE_TRANSFER_LIMITS.seenArticles) ctx.addIssue({ code: "custom", path: ["wholesale"], message: "För många rader." });
  // The rows of files exist from version 3; each group's import is in the file; the total stays within the limit.
  if (value.schemaVersion < 3 && value.fileRows.length) ctx.addIssue({ code: "custom", path: ["fileRows"], message: "Äldre versioner har inga rader ur prisfiler." });
  for (const group of value.fileRows) missing(imports.has(group.import), "fileRows");
  if (value.fileRows.reduce((sum, group) => sum + group.rows.length, 0) > CATALOGUE_TRANSFER_LIMITS.fileRows) ctx.addIssue({ code: "custom", path: ["fileRows"], message: "För många rader." });
});
export type CatalogueTransfer = z.infer<typeof catalogueTransferSchema>;

// ---------- Export ----------
export type Decimalish = Prisma.Decimal | number | string;
/** A company's price on a wholesaler's article, with the article's natural key (the register's running number never leaves the database). */
export type WholesalePriceExportRow = {
  importId: string; wholesaler: string; articleNo: string; amount: Decimalish; perQuantity: number; unitPrice: Decimalish; priceKind: string; priceDate: Date; createdAt: Date;
  discountGroup: string; packageSize: string; orderMultiple: string; minOrderQuantity: string; stocked: string; status: string;
};
/** A row of a file for a wholesaler without a catalogue, as the database holds it. */
export type FilePriceExportRow = { importId: string; wholesaler: string; articleNo: string; articleKey: string; eNumber: string; rskNumber: string; gtin: string; manufacturer: string; manufacturerArticleNo: string; name: string; unit: string;
  amount: Decimalish; perQuantity: number; unitPrice: Decimalish; priceKind: string; priceDate: Date; createdAt: Date; discountGroup: string; packageSize: string; orderMultiple: string; minOrderQuantity: string; stocked: string; status: string };
/** An import's bit list as the article numbers of one wholesaler. */
export type WholesaleSeenExportRow = { importId: string; wholesaler: string; confirmedDate: Date; articleNos: string[] };
export type CatalogueExportRows = {
  suppliers: { id: string; name: string; customerNumber: string; wholesaler?: string | null; createdAt: Date }[];
  imports: { id: string; supplierId: string; fileName: string; contentHash: string; rowCount: number; newArticles: number; changedPrices: number; unchangedPrices: number; failedRows: number; priceKind?: string; createdAt: Date }[];
  articles: { id: string; supplierId: string; supplierArticleNo: string; eNumber: string; manufacturerArticleNo?: string; articleKey: string; name: string; unit: string; discountGroup: string; createdAt: Date }[];
  prices: { id: string; articleId: string; importId: string; amount: Decimalish; perQuantity: number; unitPrice: Decimalish; currency: string; priceKind?: string; priceDate: Date; sourceFileName: string; createdAt: Date }[];
  confirmations: { priceId: string; importId: string; confirmedDate: Date; createdAt: Date }[];
  profiles: { supplierId: string; fingerprint: string; mapping: unknown; updatedAt: Date }[];
  wholesalePrices?: WholesalePriceExportRow[];
  wholesaleSeen?: WholesaleSeenExportRow[];
  fileRows?: FilePriceExportRow[];
};

export const decimalText = (value: Decimalish) => new Prisma.Decimal(value.toString()).toFixed(4);
export const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const day = isoDay;
const wholesalerOf = (value: string | null | undefined): WholesalerId | null => ((WHOLESALERS as readonly string[]).includes(value ?? "") ? value as WholesalerId : null);

/** The file's section from the company's rows (pure): Cloud ids become refs, rows whose parent is missing are left out. */
export function buildCatalogueTransfer(rows: CatalogueExportRows): CatalogueTransfer {
  const refsFor = (prefix: string, ids: string[]) => new Map(ids.map((id, index) => [id, `${prefix}${index + 1}`]));
  const s = refsFor("s", rows.suppliers.map((row) => row.id));
  const i = refsFor("i", rows.imports.filter((row) => s.has(row.supplierId)).map((row) => row.id));
  const a = refsFor("a", rows.articles.filter((row) => s.has(row.supplierId)).map((row) => row.id));
  const p = refsFor("p", rows.prices.filter((row) => a.has(row.articleId) && i.has(row.importId)).map((row) => row.id));
  const mapping = (value: unknown) => Object.fromEntries(Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {})
    .filter(([, header]) => header === null || typeof header === "string").map(([key, header]) => [key.slice(0, 40), header === null ? null : String(header).slice(0, 200)]));
  // Prices on a wholesaler's articles, one group per import and wholesaler; an article number the file cannot hold is left out.
  const groups = new Map<string, CatalogueTransfer["wholesale"][number]>();
  const groupOf = (importId: string, wholesalerId: WholesalerId) => {
    const key = `${importId}|${wholesalerId}`;
    let group = groups.get(key);
    if (!group) { group = { import: i.get(importId)!, wholesaler: wholesalerId, prices: [] }; groups.set(key, group); }
    return group;
  };
  const usable = (articleNo: string) => articleNo.length >= 1 && articleNo.length <= 100;
  for (const row of rows.wholesalePrices ?? []) {
    const wholesalerId = wholesalerOf(row.wholesaler);
    if (!wholesalerId || !i.has(row.importId) || !usable(row.articleNo)) continue;
    groupOf(row.importId, wholesalerId).prices.push([row.articleNo, decimalText(row.amount), row.perQuantity, decimalText(row.unitPrice), row.priceKind === "BASE" ? "B" : "N", day(row.priceDate), row.createdAt.toISOString(),
      row.discountGroup.slice(0, 40), row.packageSize.slice(0, 20), row.orderMultiple.slice(0, 20), row.minOrderQuantity.slice(0, 20), row.stocked.slice(0, 4), row.status.slice(0, 20)]);
  }
  for (const row of rows.wholesaleSeen ?? []) {
    const wholesalerId = wholesalerOf(row.wholesaler);
    if (!wholesalerId || !i.has(row.importId)) continue;
    groupOf(row.importId, wholesalerId).seen = { confirmedDate: day(row.confirmedDate), articles: row.articleNos.filter(usable) };
  }
  // The rows of files, one group per import and wholesaler.
  const fileGroups = new Map<string, CatalogueTransfer["fileRows"][number]>();
  for (const row of rows.fileRows ?? []) {
    const wholesalerId = wholesalerOf(row.wholesaler);
    if (!wholesalerId || !i.has(row.importId)) continue;
    const key = `${row.importId}|${wholesalerId}`;
    const group = fileGroups.get(key) ?? { import: i.get(row.importId)!, wholesaler: wholesalerId, rows: [] };
    fileGroups.set(key, group);
    group.rows.push([row.articleNo, row.articleKey, row.eNumber, row.rskNumber, row.gtin.slice(0, 20), row.manufacturer.slice(0, 120), row.manufacturerArticleNo.slice(0, 60), row.name, row.unit.slice(0, 40),
      decimalText(row.amount), row.perQuantity, decimalText(row.unitPrice), row.priceKind === "BASE" ? "B" : "N", day(row.priceDate), row.createdAt.toISOString(),
      row.discountGroup.slice(0, 40), row.packageSize.slice(0, 20), row.orderMultiple.slice(0, 20), row.minOrderQuantity.slice(0, 20), row.stocked.slice(0, 4), row.status.slice(0, 20)]);
  }
  return {
    format: CATALOGUE_TRANSFER_FORMAT, schemaVersion: CATALOGUE_TRANSFER_VERSION,
    suppliers: rows.suppliers.map((row) => ({ ref: s.get(row.id)!, name: row.name, customerNumber: row.customerNumber, ...(wholesalerOf(row.wholesaler) ? { wholesaler: wholesalerOf(row.wholesaler)! } : {}), createdAt: row.createdAt.toISOString() })),
    imports: rows.imports.filter((row) => i.has(row.id)).map((row) => ({ ref: i.get(row.id)!, supplier: s.get(row.supplierId)!, fileName: row.fileName, contentHash: row.contentHash,
      rowCount: row.rowCount, newArticles: row.newArticles, changedPrices: row.changedPrices, unchangedPrices: row.unchangedPrices, failedRows: row.failedRows, ...(row.priceKind === "BASE" ? { priceKind: "BASE" as const } : {}), createdAt: row.createdAt.toISOString() })),
    articles: rows.articles.filter((row) => a.has(row.id)).map((row) => ({ ref: a.get(row.id)!, supplier: s.get(row.supplierId)!, articleNo: row.supplierArticleNo, eNumber: row.eNumber, ...(row.manufacturerArticleNo ? { manufacturerArticleNo: row.manufacturerArticleNo } : {}), articleKey: row.articleKey,
      name: row.name, unit: row.unit, discountGroup: row.discountGroup, createdAt: row.createdAt.toISOString() })),
    prices: rows.prices.filter((row) => p.has(row.id)).map((row) => ({ ref: p.get(row.id)!, article: a.get(row.articleId)!, import: i.get(row.importId)!, amount: decimalText(row.amount), perQuantity: row.perQuantity,
      unitPrice: decimalText(row.unitPrice), currency: "SEK" as const, ...(row.priceKind === "BASE" ? { priceKind: "BASE" as const } : {}), priceDate: day(row.priceDate), sourceFileName: row.sourceFileName, createdAt: row.createdAt.toISOString() })),
    confirmations: rows.confirmations.filter((row) => p.has(row.priceId) && i.has(row.importId)).map((row) => ({ price: p.get(row.priceId)!, import: i.get(row.importId)!, confirmedDate: day(row.confirmedDate), createdAt: row.createdAt.toISOString() })),
    mappings: rows.profiles.filter((row) => s.has(row.supplierId)).map((row) => ({ supplier: s.get(row.supplierId)!, fingerprint: row.fingerprint, mapping: mapping(row.mapping), updatedAt: row.updatedAt.toISOString() })),
    wholesale: [...groups.values()],
    fileRows: [...fileGroups.values()],
  };
}

// ---------- Import back into Cloud ----------
/** The file's catalogue section, checked; null when the file has none. A damaged section is the person's input (422). */
export function parseCatalogueTransfer(value: unknown): CatalogueTransfer | null {
  if (value === undefined || value === null) return null;
  const parsed = catalogueTransferSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(422, "Cloud-kopians del Artiklar och priser är ogiltig eller för stor. Ingenting importerades.");
  return parsed.data;
}

/** How many price rows the file holds in all (the company's own articles' and the prices on a wholesaler's articles): what the Cloud import's time limit counts. */
export const catalogueTransferRows = (value: CatalogueTransfer | null) => (value ? value.prices.length + value.wholesale.reduce((sum, group) => sum + group.prices.length, 0) + value.fileRows.reduce((sum, group) => sum + group.rows.length, 0) : 0);

/** What the preview tells about the file's catalogue (counts in the file only). */
export function catalogueTransferCounts(value: CatalogueTransfer | null) {
  return value ? { suppliers: value.suppliers.length, articles: value.articles.length, prices: value.prices.length, confirmations: value.confirmations.length, mappings: value.mappings.length,
    wholesalePrices: value.wholesale.reduce((sum, group) => sum + group.prices.length, 0), fileRows: value.fileRows.reduce((sum, group) => sum + group.rows.length, 0) } : null;
}
