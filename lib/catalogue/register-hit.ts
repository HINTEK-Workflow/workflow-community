import { commonNumberOf } from "@/lib/catalogue/normalize";
import { PRODUCT_SOURCES, productInfoOfApi, type ProductSource } from "@/lib/catalogue/product-info";
import { pickOffer, sameUnitAndPackage, type CatalogueHit, type CatalogueOffer, type CatalogueRegisterInfo } from "@/lib/catalogue/snapshot";
import type { WholesaleOffer } from "@/lib/catalogue/wholesale-read";
import { tradeUnit } from "@/lib/catalogue/units";
import { supplierIsWholesaler } from "@/lib/wholesale/prepare";
import { solarStatusText } from "@/lib/integrations/solar";
import { WHOLESALER_LABELS, WHOLESALERS, type WholesalerId } from "@/lib/wholesale/model";

/**
 * Gemensamt artikelregister (2026-10-17): a register article as the article search shows it. Pure, so the server,
 * the pages and the tests make the same hit.
 *
 * Varje grossist har sin egen rad (2026-10-17): the register's article is the wholesaler's own row of the product –
 * "Solars katalog · Solars nummer · inget pris" – beside the company's own rows from its price files. It gets the company's
 * price only through the company's price file from that same wholesaler: the wholesaler's own article number exactly, or
 * the same E-nummer with the same unit. The same E-nummer at another wholesaler (Rexel) joins the rows into one product
 * but never moves a price or a status between them. An uncertain link (the same E-nummer, another unit) is said for the
 * person to check, never guessed. A register article never carries a price itself.
 *
 * Priser direkt mot katalogartikeln (2026-10-17, alternativ C): a company's price file from a wholesaler with a
 * catalogue is stored as price rows on the register's article (WholesalePrice, read by lib/catalogue/wholesale-read.ts), not
 * as copies of the article. The company's price on a register article is therefore that article's own, priced offer – one
 * per supplier of the company – and an article without a price of the company is still the unpriced "catalogOnly" row.
 */
export type RegisterArticleRow = {
  id: string;
  /** WholesaleArticle.seq – the running number the company's price rows point at. */
  seq: number;
  wholesaler: string; articleNo: string; eNumber: string; gtin: string; manufacturer: string; manufacturerArticleNo: string;
  name: string; description: string; productType: string; series: string; unit: string; status: string; productKey: string;
};

/** The company's priced offers on register articles, by the articles' running numbers (rebates applied, see register-rows.ts). */
export type PricedOffers = ReadonlyMap<number, readonly CatalogueOffer[]>;

const isWholesaler = (value: string): value is WholesalerId => (WHOLESALERS as readonly string[]).includes(value);

/** The wholesaler's status in plain words ("Utgången hos Solar"); "" for an active article or another wholesaler (no codes known yet). */
export const registerStatusText = (wholesaler: string, status: string) => (wholesaler === "solar" ? solarStatusText(status) : "");

/** "Solars katalog": the source line of a register article. */
export const registerSourceName = (wholesaler: string) => `${isWholesaler(wholesaler) ? WHOLESALER_LABELS[wholesaler] : wholesaler}s katalog`;

export function registerInfoOf(row: RegisterArticleRow): CatalogueRegisterInfo {
  return {
    wholesaler: isWholesaler(row.wholesaler) ? row.wholesaler : "solar", articleNo: row.articleNo, name: row.name, description: row.description,
    productType: row.productType, series: row.series, status: row.status, statusText: registerStatusText(row.wholesaler, row.status),
  };
}

/** The register article's words as a name: the short description when it has one (Solar's MaterialName is a terse code-like line). */
export const registerNameOf = (row: Pick<RegisterArticleRow, "name" | "description">) => (row.description || row.name).slice(0, 300) || "Artikel";

/** The product's facts from the register – numbers and manufacturer, never the wholesaler's status (that is the row's). */
function productOf(row: RegisterArticleRow) {
  const source: ProductSource = (PRODUCT_SOURCES as readonly string[]).includes(row.wholesaler) ? row.wholesaler as ProductSource : "solar";
  return productInfoOfApi(source, { eNumber: row.eNumber, gtin: row.gtin, manufacturer: row.manufacturer, manufacturerArticleNo: row.manufacturerArticleNo });
}

/** The wholesaler's own row of the product, from the register: its number as the article number, its unit, no price. */
export function registerOfferOf(row: RegisterArticleRow): CatalogueOffer {
  const info = registerInfoOf(row);
  return {
    id: `${row.wholesaler}:${row.articleNo}`.slice(0, 100), name: registerNameOf(row), unit: row.unit, supplierArticleNo: row.articleNo, eNumber: row.eNumber,
    supplierName: registerSourceName(row.wholesaler), wholesaler: info.wholesaler, manufacturerArticleNo: row.manufacturerArticleNo,
    ...(row.gtin ? { gtin: row.gtin } : {}), ...(row.manufacturer ? { manufacturer: row.manufacturer } : {}),
    price: null, catalog: info, catalogOnly: true,
  };
}

/**
 * The id of a company supplier's priced offer on a register article (2026-10-17): "solar:<article number>:<supplier id>" –
 * the wholesaler's own row plus the company's supplier, so two suppliers of one wholesaler are two offers on the one article. It
 * starts like the unpriced register row's id ("solar:<article number>"), is at most 100 characters and is read back by
 * `parseWholesaleOfferId` (a picked article is priced again from it, lib/catalogue/register-rows.ts `wholesaleHitById`).
 */
export const wholesaleOfferId = (row: Pick<RegisterArticleRow, "wholesaler" | "articleNo">, supplierId: string) => `${row.wholesaler}:${row.articleNo}:${supplierId}`.slice(0, 100);

const OFFER_ID = /^([a-z]+):(.{1,60}):([A-Za-z0-9_-]{8,64})$/;

/** "solar:1000000004:<supplier id>" → the wholesaler, the wholesaler's article number and the company's supplier; null for any other id. */
export function parseWholesaleOfferId(id: string | null | undefined): { wholesaler: WholesalerId; articleNo: string; supplierId: string } | null {
  const match = OFFER_ID.exec(id ?? "");
  return match && isWholesaler(match[1]) ? { wholesaler: match[1], articleNo: match[2], supplierId: match[3] } : null;
}
export const isWholesaleOfferId = (id: string | null | undefined) => parseWholesaleOfferId(id) !== null;

/**
 * The company's price on a register article as an offer of the company's supplier: the wholesaler's own number, name, unit and
 * status from the register, the price in force, its dates, the file's extras and "inte i senaste prisfilen" from the company's
 * price rows. `latest` is the supplier's latest price list of the price's kind (the warning names its date). The same shape as an
 * offer from a copy of the article in the company's own catalogue, so the search, the pick and the row copy read it alike.
 */
export function wholesaleOfferOf(row: RegisterArticleRow, offer: WholesaleOffer, latest: { fileName: string; date: string } | null = null): CatalogueOffer {
  const info = registerInfoOf(row);
  return {
    id: wholesaleOfferId(row, offer.supplierId), name: registerNameOf(row), unit: row.unit, supplierArticleNo: row.articleNo, eNumber: row.eNumber,
    manufacturerArticleNo: row.manufacturerArticleNo, ...(row.gtin ? { gtin: row.gtin } : {}), ...(row.manufacturer ? { manufacturer: row.manufacturer } : {}),
    discountGroup: offer.discountGroup, supplierId: offer.supplierId, supplierName: offer.supplierName, wholesaler: info.wholesaler,
    ...(offer.packageSize ? { packageSize: offer.packageSize } : {}), ...(offer.orderMultiple ? { orderMultiple: offer.orderMultiple } : {}),
    ...(offer.minOrderQuantity ? { minOrderQuantity: offer.minOrderQuantity } : {}), ...(offer.stocked === "J" || offer.stocked === "N" ? { stocked: offer.stocked === "J" } : {}),
    ...(offer.status === "UTGAR" || offer.status === "PRIS_PA_BEGARAN" ? { status: offer.status } : {}),
    ...(offer.missingFromLatestFile && latest ? { notInLatest: latest } : {}),
    // The wholesaler's own words and status are on its own row – and this is that row.
    catalog: info,
    price: {
      unitPrice: Number(offer.unitPrice), priceDate: offer.priceDate, ...(offer.confirmedDate > offer.priceDate ? { confirmedDate: offer.confirmedDate } : {}),
      sourceFileName: offer.sourceFileName, importId: offer.importId,
      ...(offer.perQuantity !== 1 ? { perQuantity: offer.perQuantity, amount: Number(offer.amount) } : {}),
      ...(offer.priceKind === "BASE" ? { priceKind: "BASE" as const } : {}),
    },
  };
}

/** The offers of one register article: the company's priced offers (one per supplier), otherwise the unpriced register row. */
const offersOfRow = (row: RegisterArticleRow, priced?: PricedOffers): CatalogueOffer[] => (priced?.get(row.seq)?.length ? [...priced.get(row.seq)!] : [registerOfferOf(row)]);

/**
 * Register articles as one product hit: one row per wholesaler, with the product's facts. A row the company has a price on
 * (`priced`, by running number) is the company's priced offer – a hit with a price, one offer per supplier of the company –
 * and a row it has no price on is the wholesaler's unpriced row. The offer a hit takes is picked as in any hit (`pickOffer`):
 * the searched supplier's, the article found by its exact number (`exactSeq`), otherwise the lowest comparable net price.
 */
export function catalogHitOf(rows: RegisterArticleRow | readonly RegisterArticleRow[], priced?: PricedOffers, pick: { supplierId?: string | null; exactSeq?: number } = {}): CatalogueHit {
  const list = Array.isArray(rows) ? rows as readonly RegisterArticleRow[] : [rows as RegisterArticleRow];
  const perRow = list.map((row) => offersOfRow(row, priced));
  const offers = perRow.flat();
  const row = list[0];
  const common = commonNumberOf({ eNumber: row.eNumber, gtin: row.gtin });
  const matchedAt = Math.max(0, list.findIndex((item) => item.seq === pick.exactSeq));
  const primary = pickOffer(offers, { matched: perRow[matchedAt][0].id, exact: pick.exactSeq !== undefined, supplierId: pick.supplierId ?? null });
  return { ...primary, product: productOf(row), ...(common ? { common } : {}), offers };
}

/**
 * How a company's own article relates to a register article (the import's product rule, lib/catalogue/normalize.ts):
 * - "own": the same wholesaler's article – the wholesaler's own number exactly, or the same E-nummer with the same unit and
 *   package – so the register's words and status belong to that row;
 * - "check": the same wholesaler and E-nummer but another unit – said for the person to check, no link;
 * - "product": another wholesaler (or none) with the same product – one hit, separate rows, nothing moved between them.
 */
export type RegisterLink = "own" | "check" | "product";

export function registerLinkOf(row: Pick<RegisterArticleRow, "wholesaler" | "articleNo" | "eNumber" | "unit">, offer: Pick<CatalogueOffer, "wholesaler" | "supplierName" | "supplierArticleNo" | "eNumber" | "unit" | "packageSize">): RegisterLink {
  // The company's supplier is the wholesaler as the company set it, otherwise as its name says (a word, never a similar name).
  const wholesaler = offer.wholesaler ?? (isWholesaler(row.wholesaler) && supplierIsWholesaler(offer.supplierName, row.wholesaler) ? row.wholesaler : null);
  if (wholesaler !== row.wholesaler) return "product";
  if (offer.supplierArticleNo.replace(/\D/g, "") && offer.supplierArticleNo.replace(/\D/g, "") === row.articleNo) return "own";
  if (row.eNumber && offer.eNumber === row.eNumber) return sameUnitAndPackage({ unit: offer.unit, packageSize: offer.packageSize }, { unit: row.unit }) ? "own" : "check";
  return "product";
}

/** "Enheten skiljer sig …": the check note for an uncertain link. */
export const registerCheckText = (row: Pick<RegisterArticleRow, "wholesaler" | "unit">, offer: Pick<CatalogueOffer, "unit">) =>
  `Samma E-nummer som ${isWholesaler(row.wholesaler) ? WHOLESALER_LABELS[row.wholesaler] : row.wholesaler}s katalog men annan enhet (${tradeUnit(offer.unit) || "okänd"} mot ${row.unit || "okänd"}) – kontrollera`;

/** Which offer a merged hit takes: the searched supplier's, the company's own article found by its exact number, the register article found by its exact number. */
export type RegisterPick = { supplierId?: string | null; exact?: boolean; exactSeq?: number };

/**
 * The company's hit for the same product with the register's article beside it: the register's words and status go on
 * the company's row from the same wholesaler when the link is certain; otherwise the wholesaler's own row from the register
 * is added without a price (and an uncertain row is marked for checking). The company's rows, prices and names never change.
 *
 * Where the company has a price on the register's article (`priced`, by running number) that article is the company's own
 * priced offer, one per supplier, and it is added instead of the unpriced row (2026-10-17, alternativ C). The offer the
 * hit takes is then chosen again among all the offers – the searched supplier's, the register article found by its exact number
 * (`exactSeq`), otherwise the lowest comparable net price – unless the company's own article was found by its exact article
 * number (`exact`), when it stays the hit's.
 */
export function withRegisters(hit: CatalogueHit, rows: readonly RegisterArticleRow[], priced?: PricedOffers, pick: RegisterPick = {}): CatalogueHit {
  return rows.reduce((current, row) => withRegister(current, row, priced, pick), hit);
}

export function withRegister(hit: CatalogueHit, row: RegisterArticleRow, priced?: PricedOffers, pick: RegisterPick = {}): CatalogueHit {
  const info = registerInfoOf(row);
  const offers = hit.offers?.length ? hit.offers : [hit as CatalogueOffer];
  const own = priced?.get(row.seq) ?? [];
  let linked = false;
  const next = offers.map((offer) => {
    // An offer that is itself a register article's priced offer already knows its article; it never links to another row.
    if (isWholesaleOfferId(offer.id)) return offer;
    const link = registerLinkOf(row, offer);
    if (link === "own" && !linked) { linked = true; return { ...offer, catalog: info }; }
    if (link === "check") return { ...offer, catalogCheck: registerCheckText(row, offer) };
    return offer;
  });
  if (own.length) next.push(...own.filter((item) => !next.some((known) => known.id === item.id)));
  else if (!linked) next.push(registerOfferOf(row));
  // A priced offer may be the better one to take: choose again among all of them, and put the hit's own fields on the chosen one.
  const found = own.length && pick.exactSeq === row.seq;
  const best = own.length && !pick.exact ? pickOffer(next, { matched: found ? own[0].id : hit.id, exact: Boolean(found), supplierId: pick.supplierId ?? null }) : null;
  if (best && best.id !== hit.id) {
    const product = hit.product ?? productOf(row);
    return { ...best, product, ...(hit.productId ? { productId: hit.productId } : {}), ...(hit.common ? { common: hit.common } : {}), ...(hit.supplierOnly !== undefined ? { supplierOnly: hit.supplierOnly } : {}),
      ...(hit.priceHidden !== undefined ? { priceHidden: hit.priceHidden } : {}), offers: next };
  }
  const primary = next.find((offer) => offer.id === hit.id) ?? hit;
  return { ...hit, ...(primary.catalog ? { catalog: primary.catalog } : {}), ...(primary.catalogCheck ? { catalogCheck: primary.catalogCheck } : {}), ...(hit.product ? {} : { product: productOf(row) }), offers: next };
}

/**
 * The keys a company's article or product joins a register article on (the import's product rule, lib/catalogue/normalize.ts):
 * the E-nummer, the GTIN, the manufacturer with the manufacturer's number – and, only at the company's supplier that is the
 * same wholesaler, the wholesaler's own article number. Never a name, never a guess.
 */
export function registerJoinKeys(row: Pick<RegisterArticleRow, "wholesaler" | "articleNo" | "eNumber" | "gtin" | "productKey">): string[] {
  return [
    ...(row.eNumber ? [`E:${row.eNumber}`] : []), ...(row.gtin ? [`GTIN:${row.gtin}`] : []),
    ...(row.productKey.startsWith("MPN:") ? [row.productKey] : []),
    // Exactly as written, leading zeros too: Solar's ten-digit number never meets a seven-digit E-nummer used as an article number.
    ...(row.articleNo ? [`W:${row.wholesaler}:${row.articleNo}`] : []),
  ];
}
