import { INSTANCE_DEFAULTS } from "@/lib/instance-defaults";
import { commonNumberOf, manufacturerKey, normalizeArticleNo, productKeyOf } from "@/lib/catalogue/normalize";
import type { CatalogueRow } from "@/lib/catalogue/model";
import type { PriceKind } from "@/lib/catalogue/price-kind";
import { registerCheckText, registerLinkOf, wholesaleOfferId, type RegisterArticleRow } from "@/lib/catalogue/register-hit";
import { pickOffer, type CatalogueHit, type CatalogueOffer } from "@/lib/catalogue/snapshot";
import type { WholesaleOffer } from "@/lib/catalogue/wholesale-read";
import { WHOLESALERS, type WholesalerId } from "@/lib/wholesale/model";
import { foldText } from "@/lib/search/normalize";

/**
 * Prisfil utan grossistens katalog (produktägaren 2026-11-01): the pure rules of a price row that needs no article. A company may read
 * in its own file for a wholesaler that has no working catalogue in the shared register – the API is switched off, not fetched yet, or
 * does not exist. Only the file's rows are stored (CatalogueFilePrice), one company at a time and within a limit, and a new file of
 * the same supplier and price kind replaces the previous one. The database side is lib/catalogue/file-prices.ts.
 *
 * - **Identity:** the wholesaler, its number and the company's supplier – the same offer id as a price on a register article
 *   ("solar:<number>:<supplier id>", register-hit.ts `wholesaleOfferId`). So a rule, a favourite, a list line and a picked article read a
 *   row the same way whether or not the register has the article, also after a catalogue is switched on later.
 * - **Link:** a row that is an article of the wholesaler's register (the rule of catalogue-gate.ts `matchAgainstCatalogue`) is shown as that
 *   article's own priced offer, with the register's words. A row that is not has what the file says, and no picture and no stock.
 * - **Never between wholesalers:** the same number gathers rows into one product; it moves no price, number or status.
 */

/** A row as the read path has it: the price in force of one article at one supplier (a net price before a base price). */
export type FilePriceRow = {
  id: string;
  supplierId: string; supplierName: string; wholesaler: string;
  articleNo: string; articleKey: string; eNumber: string; rskNumber: string; gtin: string; manufacturer: string; manufacturerArticleNo: string; productKey: string;
  name: string; unit: string;
  /** Decimal strings, SEK excluding VAT, as the row holds them. */
  amount: string; perQuantity: number; unitPrice: string; currency: string; priceKind: string;
  priceDate: Date; createdAt: Date;
  importId: string; sourceFileName: string; importedAt: Date;
  discountGroup: string; packageSize: string; orderMultiple: string; minOrderQuantity: string; stocked: string; status: string;
  /** Set by a search: the same score as the other sides of the article search, and whether a number matched exactly. */
  score?: number; exact?: boolean;
};

const day = (value: Date) => value.toISOString().slice(0, 10);
const isWholesaler = (value: string): value is WholesalerId => (WHOLESALERS as readonly string[]).includes(value);

/**
 * How many rows a company may hold from price files in this installation: about one large wholesaler list and a little more (the largest
 * measured is 293 000 rows). Null = no limit, on an installation that pays for its own database.
 */
export const CATALOGUE_ROW_LIMIT: number | null = INSTANCE_DEFAULTS.catalogueRowLimit;

/** The columns a file's row writes besides what the file says. */
export function filePriceColumns(row: Pick<CatalogueRow, "articleNo" | "eNumber" | "rskNumber" | "gtin" | "manufacturer" | "manufacturerArticleNo" | "name">) {
  const norm = normalizeArticleNo(row.articleNo);
  const makerNumber = normalizeArticleNo(row.manufacturerArticleNo);
  return {
    articleNoNorm: norm,
    productKey: productKeyOf(row) ?? "",
    // The same parts as the article search's text for the company's own articles (the trigger of 20261012170000), with the EAN too.
    searchText: foldText([row.name, row.articleNo, norm, row.manufacturerArticleNo, makerNumber, row.eNumber, row.rskNumber, row.gtin, row.manufacturer].filter(Boolean).join(" ")).slice(0, 2000),
  };
}

/** The number that names a row: the article number, otherwise the E-nummer (a file may have only that). */
export const fileRowNumber = (row: Pick<FilePriceRow, "articleNo" | "eNumber">) => row.articleNo || row.eNumber;

/** The offer id of a row: the same form as a price on a register article (see the module comment). */
export const fileOfferId = (row: Pick<FilePriceRow, "wholesaler" | "supplierId" | "articleNo" | "eNumber">) => wholesaleOfferId({ wholesaler: row.wholesaler, articleNo: fileRowNumber(row) }, row.supplierId);

/** When a file's price was last known to be right: the day the file was read, never earlier than its own date. */
const confirmedOf = (row: Pick<FilePriceRow, "priceDate" | "importedAt">) => { const date = day(row.priceDate); const read = day(row.importedAt); return read > date ? read : date; };

/** The price part of an offer. */
const priceOf = (row: FilePriceRow): NonNullable<CatalogueOffer["price"]> => {
  const priceDate = day(row.priceDate);
  const confirmed = confirmedOf(row);
  return {
    unitPrice: Number(row.unitPrice), priceDate, ...(confirmed > priceDate ? { confirmedDate: confirmed } : {}), sourceFileName: row.sourceFileName, importId: row.importId,
    ...(row.perQuantity !== 1 ? { perQuantity: row.perQuantity, amount: Number(row.amount) } : {}),
    ...(row.priceKind === "BASE" ? { priceKind: "BASE" as PriceKind } : {}),
  };
};

/** A row that is no article of the register, as an offer: what the file says. No shared product info, so no picture and no stock of its own. */
export function fileOfferOf(row: FilePriceRow): CatalogueOffer {
  return {
    id: fileOfferId(row), name: row.name, unit: row.unit, supplierArticleNo: row.articleNo, eNumber: row.eNumber,
    ...(row.rskNumber ? { rskNumber: row.rskNumber } : {}), ...(row.gtin ? { gtin: row.gtin } : {}), ...(row.manufacturer ? { manufacturer: row.manufacturer } : {}),
    manufacturerArticleNo: row.manufacturerArticleNo, discountGroup: row.discountGroup, supplierId: row.supplierId, supplierName: row.supplierName,
    ...(isWholesaler(row.wholesaler) ? { wholesaler: row.wholesaler } : {}),
    ...(row.packageSize ? { packageSize: row.packageSize } : {}), ...(row.orderMultiple ? { orderMultiple: row.orderMultiple } : {}),
    ...(row.minOrderQuantity ? { minOrderQuantity: row.minOrderQuantity } : {}), ...(row.stocked === "J" || row.stocked === "N" ? { stocked: row.stocked === "J" } : {}),
    ...(row.status === "UTGAR" || row.status === "PRIS_PA_BEGARAN" ? { status: row.status } : {}),
    price: priceOf(row),
  };
}

/** A row that is an article of the register, as the company's price on that article: the same shape as a price row on it (wholesale-read.ts). */
export function fileWholesaleOffer(row: FilePriceRow, article: Pick<RegisterArticleRow, "seq" | "wholesaler" | "articleNo">): WholesaleOffer {
  return {
    seq: article.seq, wholesaler: article.wholesaler as WholesalerId, articleNo: article.articleNo, supplierId: row.supplierId, supplierName: row.supplierName,
    priceRowId: `file:${row.id}`, importId: row.importId, priceKind: row.priceKind === "BASE" ? "BASE" : "NET", amount: row.amount, perQuantity: row.perQuantity, unitPrice: row.unitPrice, currency: row.currency,
    priceDate: day(row.priceDate), confirmedDate: confirmedOf(row), createdAt: row.createdAt.toISOString(),
    discountGroup: row.discountGroup, packageSize: row.packageSize, orderMultiple: row.orderMultiple, minOrderQuantity: row.minOrderQuantity, stocked: row.stocked, status: row.status,
    sourceFileName: row.sourceFileName, missingFromLatestFile: false,
  };
}

/**
 * The offers of one register article from both kinds of row: per supplier the price in force, the latest NET, otherwise the latest BASE –
 * the same rule as lib/catalogue/wholesale-read.ts, so a file read while the API was off and a price row from before never give two offers.
 */
export function mergeWholesaleOffers(first: readonly WholesaleOffer[], second: readonly WholesaleOffer[]): WholesaleOffer[] {
  const bySupplier = new Map<string, WholesaleOffer>();
  for (const offer of [...first, ...second]) {
    const known = bySupplier.get(offer.supplierId);
    const better = !known || (known.priceKind !== "NET" && offer.priceKind === "NET") || (known.priceKind === offer.priceKind && offer.createdAt > known.createdAt);
    if (better) bySupplier.set(offer.supplierId, offer);
  }
  return [...bySupplier.values()];
}

/** What a row joins the company's own articles on: the register's join (register-rows.ts), with the row in a register article's place. */
export function fileRowAsRegister(row: FilePriceRow): RegisterArticleRow {
  return { id: `file:${row.id}`, seq: 0, wholesaler: row.wholesaler, articleNo: row.articleNo, eNumber: /^\d{7}$/.test(row.eNumber) ? row.eNumber : "", gtin: row.gtin, manufacturer: row.manufacturer, manufacturerArticleNo: row.manufacturerArticleNo,
    name: row.name, description: "", productType: "", series: "", unit: row.unit, status: "", productKey: row.productKey };
}

/** The merged search's key of a row without any other side: its product, otherwise the row alone. */
export const fileEntryKey = (row: Pick<FilePriceRow, "productKey" | "supplierId" | "articleKey">) => (row.productKey ? `register:${row.productKey}` : `file:${row.supplierId}:${row.articleKey}`);

/** A hit made of rows alone: one product at the company's suppliers, or a row that is only that supplier's. */
export function fileHitOf(offers: readonly CatalogueOffer[], pick: { supplierId?: string | null; exactId?: string } = {}): CatalogueHit {
  const primary = pickOffer(offers, { matched: pick.exactId ?? offers[0].id, exact: Boolean(pick.exactId), supplierId: pick.supplierId ?? null });
  const common = commonNumberOf(primary);
  const shared = Boolean(common) || Boolean(manufacturerKey(primary.manufacturer, primary.manufacturerArticleNo));
  return { ...primary, ...(common ? { common } : {}), ...(shared ? {} : { supplierOnly: true }), offers: [...offers] };
}

/**
 * A hit with the company's rows of the same product beside its other offers. An offer already there (the same id) stays as it is; a row with the
 * same E-nummer as a register article at the same wholesaler but another unit is marked for the person to check, never guessed. The offer the
 * hit takes is chosen again among all of them, as for a price on a register article – unless the company's own article was found by its exact number.
 */
export function withFileOffers(hit: CatalogueHit, offers: readonly CatalogueOffer[], registers: readonly RegisterArticleRow[] = [], pick: { supplierId?: string | null; exact?: boolean; exactId?: string } = {}): CatalogueHit {
  const known = hit.offers?.length ? hit.offers : [hit as CatalogueOffer];
  const added = offers.filter((offer, index) => !known.some((item) => item.id === offer.id) && offers.findIndex((item) => item.id === offer.id) === index).map((offer) => {
    const uncertain = offer.catalog ? undefined : registers.find((row) => registerLinkOf(row, offer) === "check");
    return uncertain ? { ...offer, catalogCheck: registerCheckText(uncertain, offer) } : offer;
  });
  if (!added.length && !pick.exactId) return hit;
  const next = [...known, ...added];
  if (pick.exact) return { ...hit, offers: next };
  const best = pickOffer(next, { matched: pick.exactId ?? hit.id, exact: Boolean(pick.exactId), supplierId: pick.supplierId ?? null });
  if (best.id === hit.id) return { ...hit, offers: next };
  return { ...best, ...(hit.product ? { product: hit.product } : {}), ...(hit.productId ? { productId: hit.productId } : {}), ...(hit.common ? { common: hit.common } : {}),
    ...(hit.supplierOnly !== undefined ? { supplierOnly: hit.supplierOnly } : {}), ...(hit.priceHidden !== undefined ? { priceHidden: hit.priceHidden } : {}), offers: next };
}

/** The product keys a hit stands for, as a row writes them: what its other offers of the same product are found by. */
export const productKeysOfHit = (hit: Pick<CatalogueHit, "common" | "manufacturer" | "manufacturerArticleNo">) => {
  const maker = manufacturerKey(hit.manufacturer, hit.manufacturerArticleNo);
  return [...(hit.common ? [`${hit.common.kind}:${hit.common.number}`] : []), ...(maker ? [`MPN:${maker}`] : [])];
};
