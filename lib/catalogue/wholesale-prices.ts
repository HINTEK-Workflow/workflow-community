import { Prisma } from "@prisma/client";
import { matchAgainstCatalogue } from "@/lib/catalogue/catalogue-gate";
import { samePrice, type CatalogueRow } from "@/lib/catalogue/model";
import type { PriceKind } from "@/lib/catalogue/price-kind";
import { EMPTY_PRICE_EXTRAS, type WholesalePriceExtras } from "@/lib/catalogue/wholesale-model";
import type { WholesalerId } from "@/lib/wholesale/model";

/**
 * Skrivvägen för priser direkt mot grossistens katalogartikel (2026-10-17, alternativ C i
 * docs/proposals/priser-mot-katalogartikel-2026-10-17.md). A price file for a supplier that is a wholesaler with a catalogue is
 * matched to the wholesaler's own articles in the shared register (lib/catalogue/catalogue-gate.ts) and each matched row is a
 * price on that article's running number – nothing is copied into the company's own CatalogueArticle, CatalogueProduct,
 * CataloguePrice or CataloguePriceConfirmation. The rows are read back by lib/catalogue/wholesale-read.ts.
 *
 * - **A price row is written** when the article is new to the company and supplier, or when the amount, the quantity the price
 *   is for, or one of the file's extras (discount group, package, order multiple, minimum order, stocked, status) differs from
 *   the latest row of the same series. A series is the company's rows for one supplier, one article and one price kind: a base
 *   price after a net price is a series of its own. Rows are only ever added (the database refuses UPDATE).
 * - **Extras follow the file only where the file has the column** – a column the file lacks keeps what the series' latest row
 *   said, and a blank discount group keeps the earlier one, exactly as the company's own article did.
 * - **"Confirmed" is not a row.** Every matched article of the file – changed or not – is one bit in the import's bit list
 *   (WholesaleImportSeen), built here as the batches pass and written once, when the whole file is in.
 * - **One article, one row per import.** Should two rows of a file be the same catalogue article (a wholesaler number and an
 *   E-nummer that meet), the first one in file order prices it and the others are counted, never written.
 * - Every query is limited to one company (`organizationId`) and the price rows reach their import through the composite key.
 */

/** Which of the file's extras the file has a column for: only those follow the file on an article that already has a price. */
export type ExtraColumns = { packageSize: boolean; orderMultiple: boolean; minOrderQuantity: boolean; stocked: boolean; status: boolean };

/** A row of the file that is an article of the wholesaler's catalogue: the row and the running number of the article it prices. */
export type WholesaleItem = { seq: number; row: CatalogueRow };

/** What the company's earlier rows say about one article at one supplier. */
export type SeqHistory = {
  /** Some row exists for the supplier, of either price kind: the article is not new to the company and the supplier. */
  known: boolean;
  /** The latest row of the file's price kind, null when the series is new. */
  latest: (WholesalePriceExtras & { amount: number; perQuantity: number; unitPrice: number }) | null;
};

type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * The bit list of an import while it is built: the running numbers of the catalogue articles the file had, one bit each – byte
 * `seq >> 3`, bit `seq & 7` from the least significant, which is Postgres' get_bit (lib/catalogue/wholesale-model.ts). `add` says
 * whether the article was new to the list, which is how a second row for the same article is found. About 20 kB for 166 000
 * articles, so a file of any size keeps the memory bounded.
 */
export class SeenBits {
  private bytes = new Uint8Array(1024);
  private top = 0;
  /** How many articles the list holds. */
  count = 0;

  /** Marks the article; false when it was marked before. */
  add(seq: number): boolean {
    if (!Number.isInteger(seq) || seq < 1) throw new Error(`A running number is a whole number from 1: ${seq}`);
    const byte = seq >> 3;
    if (byte >= this.bytes.length) {
      const grown = new Uint8Array(Math.max(byte + 1, this.bytes.length * 2));
      grown.set(this.bytes);
      this.bytes = grown;
    }
    const mask = 1 << (seq & 7);
    if (this.bytes[byte] & mask) return false;
    this.bytes[byte] |= mask;
    this.count += 1;
    if (seq > this.top) this.top = seq;
    return true;
  }

  has(seq: number): boolean {
    if (!Number.isInteger(seq) || seq < 1) return false;
    const byte = seq >> 3;
    return byte < this.bytes.length && (this.bytes[byte] & (1 << (seq & 7))) !== 0;
  }

  /** The list as WholesaleImportSeen.seen holds it: no longer than the highest number needs, nothing at all for an empty list. */
  toBytes(): Uint8Array<ArrayBuffer> {
    return this.bytes.slice(0, this.top ? (this.top >> 3) + 1 : 0);
  }
}

/** A matched batch: the rows that price an article for the first time in this file, and what the others were. */
export type MatchedBatch = {
  items: WholesaleItem[];
  /** Rows that are no article of the wholesaler's catalogue (or only an obsolete one). */
  notInCatalogue: number;
  /** Rows with an E-nummer of a catalogue article but another unit: never guessed. */
  unitDiffers: number;
  /** Rows for an article an earlier row of the file already prices. */
  sameArticle: number;
};

/**
 * One batch of the file against the wholesaler's catalogue. `claimed` is the file's bit list: an article is priced by the first
 * row that reaches it, so batches must come through here in file order (the same file then always gives the same prices).
 */
export async function matchBatch(db: Reader, wholesaler: WholesalerId, rows: readonly CatalogueRow[], claimed: SeenBits): Promise<MatchedBatch> {
  const match = await matchAgainstCatalogue(db, wholesaler, rows);
  const items: WholesaleItem[] = [];
  let sameArticle = 0;
  match.matched.forEach((index, at) => {
    if (claimed.add(match.seqs[at])) items.push({ seq: match.seqs[at], row: rows[index] });
    else sameArticle += 1;
  });
  return { items, notInCatalogue: match.notInCatalogue, unitDiffers: match.unitDiffers, sameArticle };
}

/** What a row's extras are once the file's columns are taken into account: the file's values, the series' earlier ones where the file has no column. */
export function effectiveExtras(row: CatalogueRow, latest: WholesalePriceExtras | null, columns: ExtraColumns): WholesalePriceExtras {
  const before = latest ?? EMPTY_PRICE_EXTRAS;
  return {
    discountGroup: row.discountGroup || before.discountGroup,
    packageSize: columns.packageSize ? row.packageSize : before.packageSize,
    orderMultiple: columns.orderMultiple ? row.orderMultiple : before.orderMultiple,
    minOrderQuantity: columns.minOrderQuantity ? row.minOrderQuantity : before.minOrderQuantity,
    stocked: columns.stocked ? row.stocked : before.stocked,
    status: columns.status ? row.status : before.status,
  };
}

const extrasDiffer = (a: WholesalePriceExtras, b: WholesalePriceExtras) =>
  a.discountGroup !== b.discountGroup || a.packageSize !== b.packageSize || a.orderMultiple !== b.orderMultiple
  || a.minOrderQuantity !== b.minOrderQuantity || a.stocked !== b.stocked || a.status !== b.status;

/**
 * How a row meets the company's earlier prices (pris ändrat, 2026-10-08): "new" – the supplier has no row for the
 * article; "changed" – it has, but none of this price kind or another amount or quantity; "unchanged" – the same price.
 * The price date, name and unit never make a price changed.
 */
export function classifyWholesaleRow(row: CatalogueRow, history: SeqHistory | undefined): "new" | "changed" | "unchanged" {
  if (!history?.known) return "new";
  return history.latest && samePrice(history.latest, row) ? "unchanged" : "changed";
}

export type WholesalePlan = {
  /** The rows to add: new articles, changed prices, and unchanged prices whose extras changed (a new row, the same price). */
  write: { item: WholesaleItem; extras: WholesalePriceExtras }[];
  newArticles: number;
  changedPrices: number;
  /** The price is the same – also when an extra changed and a row was written for it. */
  unchangedPrices: number;
};

/** The rows a batch needs, from the company's earlier rows. Pure. */
export function planWholesalePrices(items: readonly WholesaleItem[], history: ReadonlyMap<number, SeqHistory>, columns: ExtraColumns): WholesalePlan {
  const plan: WholesalePlan = { write: [], newArticles: 0, changedPrices: 0, unchangedPrices: 0 };
  for (const item of items) {
    const known = history.get(item.seq);
    const extras = effectiveExtras(item.row, known?.latest ?? null, columns);
    const kind = classifyWholesaleRow(item.row, known);
    if (kind === "new") plan.newArticles += 1;
    else if (kind === "changed") plan.changedPrices += 1;
    else plan.unchangedPrices += 1;
    if (kind !== "unchanged" || (known?.latest && extrasDiffer(known.latest, extras))) plan.write.push({ item, extras });
  }
  return plan;
}

type HistoryRow = WholesalePriceExtras & { seq: number; priceKind: string; amount: string; perQuantity: number; unitPrice: string };

/**
 * The company's latest row per article and price kind at one supplier, for the articles of a batch – one query. The supplier is
 * the import's (a price row has none of its own), reached through the composite key; the company's id is in every condition.
 */
export async function wholesaleHistory(db: Reader, organizationId: string, supplierId: string, priceKind: PriceKind, seqs: readonly number[]): Promise<Map<number, SeqHistory>> {
  const history = new Map<number, SeqHistory>();
  if (!seqs.length) return history;
  const rows = await db.$queryRaw<HistoryRow[]>(Prisma.sql`
    SELECT DISTINCT ON (p."seq", p."priceKind") p."seq", p."priceKind", p."amount"::text AS "amount", p."perQuantity", p."unitPrice"::text AS "unitPrice",
      p."discountGroup", p."packageSize", p."orderMultiple", p."minOrderQuantity", p."stocked", p."status"
    FROM "WholesalePrice" p
    JOIN "CatalogueImport" i ON i."id" = p."importId" AND i."organizationId" = p."organizationId"
    WHERE p."organizationId" = ${organizationId} AND i."supplierId" = ${supplierId} AND p."seq" = ANY(${[...seqs]}::int[])
    ORDER BY p."seq", p."priceKind", p."createdAt" DESC, p."id" DESC`);
  for (const row of rows) {
    const entry = history.get(Number(row.seq)) ?? { known: true, latest: null };
    if (row.priceKind === priceKind) {
      entry.latest = {
        amount: Number(row.amount), perQuantity: Number(row.perQuantity), unitPrice: Number(row.unitPrice),
        discountGroup: row.discountGroup, packageSize: row.packageSize, orderMultiple: row.orderMultiple, minOrderQuantity: row.minOrderQuantity, stocked: row.stocked, status: row.status,
      };
    }
    history.set(Number(row.seq), entry);
  }
  return history;
}

export type WholesaleBatchContext = { organizationId: string; supplierId: string; importId: string; priceKind: PriceKind; extras: ExtraColumns };
export type WholesaleBatchResult = { newArticles: number; changedPrices: number; unchangedPrices: number; prices: number; confirmed: number };

/**
 * One batch of matched rows in its own transaction (2026-10-17): one query for the batch's earlier rows, then one insert
 * of the rows that are new or changed – as SQL arrays, so a batch stays small in memory. An unchanged price writes nothing;
 * it is confirmed by the bit list at the end of the import.
 */
export async function writeWholesaleBatch(tx: Prisma.TransactionClient, context: WholesaleBatchContext, items: readonly WholesaleItem[]): Promise<WholesaleBatchResult> {
  const { organizationId, supplierId, importId, priceKind } = context;
  const history = await wholesaleHistory(tx, organizationId, supplierId, priceKind, items.map((item) => item.seq));
  const plan = planWholesalePrices(items, history, context.extras);
  const rows = plan.write;
  if (rows.length) {
    await tx.$executeRaw`
      INSERT INTO "WholesalePrice" ("organizationId", "importId", "seq", "amount", "perQuantity", "unitPrice", "currency", "priceKind", "priceDate",
        "discountGroup", "packageSize", "orderMultiple", "minOrderQuantity", "stocked", "status")
      SELECT ${organizationId}, ${importId}, u."seq", u."amount"::numeric, u."per", u."unit"::numeric, 'SEK', ${priceKind}, u."day"::date,
        u."grp", u."pack", u."mult", u."minq", u."stocked", u."status"
      FROM unnest(${rows.map(({ item }) => item.seq)}::int[], ${rows.map(({ item }) => String(item.row.amount))}::text[],
        ${rows.map(({ item }) => item.row.perQuantity)}::int[], ${rows.map(({ item }) => String(item.row.unitPrice))}::text[], ${rows.map(({ item }) => item.row.priceDate)}::text[],
        ${rows.map(({ extras }) => extras.discountGroup)}::text[], ${rows.map(({ extras }) => extras.packageSize)}::text[], ${rows.map(({ extras }) => extras.orderMultiple)}::text[],
        ${rows.map(({ extras }) => extras.minOrderQuantity)}::text[], ${rows.map(({ extras }) => extras.stocked)}::text[], ${rows.map(({ extras }) => extras.status)}::text[])
        AS u("seq", "amount", "per", "unit", "day", "grp", "pack", "mult", "minq", "stocked", "status")
      ORDER BY u."seq"`;
  }
  return { newArticles: plan.newArticles, changedPrices: plan.changedPrices, unchangedPrices: plan.unchangedPrices, prices: rows.length, confirmed: plan.unchangedPrices };
}

/**
 * The last step of a finished import, in the same transaction that sets the final counts: the bit list of the file's articles is
 * written (once, never changed), and the articles the supplier has a price of this kind on that the list does not have are
 * counted – "saknas i senaste filen". That count is the list against the supplier's distinct priced articles: one pass over the
 * company's rows, `get_bit` per article, no join between the lists and no per-article subquery.
 */
export async function finishWholesaleImport(tx: Prisma.TransactionClient, context: { organizationId: string; supplierId: string; importId: string; priceKind: PriceKind; today: string }, seen: SeenBits): Promise<number> {
  const { organizationId, supplierId, importId, priceKind } = context;
  const confirmedDate = new Date(`${context.today}T00:00:00.000Z`);
  if (Number.isNaN(confirmedDate.getTime())) throw new Error(`The import date must be written YYYY-MM-DD: ${context.today}`);
  await tx.wholesaleImportSeen.create({ data: { importId, organizationId, seen: seen.toBytes(), count: seen.count, confirmedDate } });
  const [row] = await tx.$queryRaw<{ missing: number }[]>`
    SELECT count(*)::int AS "missing"
    FROM (
      SELECT DISTINCT p."seq" FROM "WholesalePrice" p
      WHERE p."organizationId" = ${organizationId} AND p."priceKind" = ${priceKind}
        AND p."importId" IN (SELECT i."id" FROM "CatalogueImport" i WHERE i."organizationId" = ${organizationId} AND i."supplierId" = ${supplierId})
    ) priced
    JOIN "WholesaleImportSeen" w ON w."importId" = ${importId} AND w."organizationId" = ${organizationId}
    WHERE (CASE WHEN priced."seq" < octet_length(w."seen") * 8 THEN get_bit(w."seen", priced."seq") ELSE 0 END) = 0`;
  return Number(row?.missing ?? 0);
}

/**
 * Before an import is removed (2026-10-17; the same rule as for the company's own prices since 2026-10-08): a price the
 * import set that a later file only confirmed is not lost. Removing the import deletes its rows (they cascade from it), and the
 * later file has no row of its own for an unchanged price – so the article would be left without any price. This writes the
 * removed row again under the earliest later import of the same supplier and price kind whose bit list has the article, as if
 * that file had set the price on the day it confirmed it. When that file wrote a row of its own for the article (a new price)
 * the old row is simply history and is not written again. Call it in the removing transaction, before the import is deleted.
 * Returns how many rows were written again.
 */
export async function promoteWholesaleRows(tx: Pick<Prisma.TransactionClient, "$executeRaw">, organizationId: string, importId: string): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO "WholesalePrice" ("organizationId", "importId", "seq", "amount", "perQuantity", "unitPrice", "currency", "priceKind", "priceDate",
      "discountGroup", "packageSize", "orderMultiple", "minOrderQuantity", "stocked", "status", "createdAt")
    SELECT p."organizationId", e."id", p."seq", p."amount", p."perQuantity", p."unitPrice", p."currency", p."priceKind", e."confirmedDate",
      p."discountGroup", p."packageSize", p."orderMultiple", p."minOrderQuantity", p."stocked", p."status", e."createdAt"
    FROM "WholesalePrice" p
    JOIN "CatalogueImport" i ON i."id" = p."importId" AND i."organizationId" = p."organizationId"
    JOIN LATERAL (
      SELECT i2."id", i2."createdAt", w."confirmedDate"
      FROM "CatalogueImport" i2
      JOIN "WholesaleImportSeen" w ON w."importId" = i2."id" AND w."organizationId" = i2."organizationId"
      WHERE i2."organizationId" = p."organizationId" AND i2."supplierId" = i."supplierId" AND i2."kind" = 'PRICES' AND i2."priceKind" = p."priceKind"
        AND (i2."createdAt", i2."id") > (i."createdAt", i."id")
        AND (CASE WHEN p."seq" < octet_length(w."seen") * 8 THEN get_bit(w."seen", p."seq") ELSE 0 END) = 1
      ORDER BY i2."createdAt", i2."id" LIMIT 1) e ON true
    WHERE p."organizationId" = ${organizationId} AND p."importId" = ${importId}
      AND NOT EXISTS (SELECT 1 FROM "WholesalePrice" later WHERE later."organizationId" = p."organizationId" AND later."importId" = e."id" AND later."seq" = p."seq" AND later."priceKind" = p."priceKind")`;
}

/** One article whose price changes most against the company's latest row (unit prices compared) – for the preview. */
export type WholesalePreviewChange = { row: CatalogueRow; before: number; factor: number };
export type WholesalePreviewSum = { matched: number; unchanged: number; skipped: number };

/**
 * The preview's numbers for the company's suppliers that are wholesalers with a catalogue (the same match and the same rule as
 * the import, so the page says what the import will do): per supplier, how many of the file's rows already have a row for it
 * (`matched`), how many of those keep their price (`unchanged`) and how many rows the import will not read (`skipped`: not in
 * the catalogue, another unit, or an article an earlier row already prices). Batches must come in file order.
 */
export class WholesalePreview {
  readonly sums = new Map<string, WholesalePreviewSum>();
  readonly changes = new Map<string, WholesalePreviewChange[]>();
  private readonly claimed = new Map<WholesalerId, SeenBits>();

  constructor(
    private readonly db: Reader,
    private readonly organizationId: string,
    private readonly priceKind: PriceKind,
    private readonly suppliers: readonly { id: string; wholesaler: WholesalerId }[],
    private readonly changesEach: number,
  ) {
    for (const supplier of suppliers) this.sums.set(supplier.id, { matched: 0, unchanged: 0, skipped: 0 });
  }

  /** Whether this supplier is compared here instead of with the company's own articles. */
  covers(supplierId: string) { return this.sums.has(supplierId); }

  async add(rows: readonly CatalogueRow[]) {
    for (const wholesaler of new Set(this.suppliers.map((supplier) => supplier.wholesaler))) {
      const claimed = this.claimed.get(wholesaler) ?? new SeenBits();
      this.claimed.set(wholesaler, claimed);
      const batch = await matchBatch(this.db, wholesaler, rows, claimed);
      const skipped = batch.notInCatalogue + batch.unitDiffers + batch.sameArticle;
      for (const supplier of this.suppliers.filter((item) => item.wholesaler === wholesaler)) {
        const sum = this.sums.get(supplier.id)!;
        sum.skipped += skipped;
        const history = await wholesaleHistory(this.db, this.organizationId, supplier.id, this.priceKind, batch.items.map((item) => item.seq));
        const biggest = this.changes.get(supplier.id) ?? [];
        for (const item of batch.items) {
          const known = history.get(item.seq);
          const kind = classifyWholesaleRow(item.row, known);
          if (kind === "new") continue;
          sum.matched += 1;
          if (kind === "unchanged") { sum.unchanged += 1; continue; }
          const before = known?.latest?.unitPrice ?? 0;
          if (before > 0 && item.row.unitPrice > 0 && before !== item.row.unitPrice) biggest.push({ row: item.row, before, factor: Math.max(item.row.unitPrice / before, before / item.row.unitPrice) });
        }
        this.changes.set(supplier.id, biggest.sort((a, b) => b.factor - a.factor || a.row.line - b.row.line).slice(0, this.changesEach));
      }
    }
  }
}
