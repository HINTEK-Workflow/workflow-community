import { formatPrice, type MaterialRow } from "@/lib/workflow/expenses";
import type { CommonNumber } from "@/lib/catalogue/normalize";
import { WHOLESALERS, type WholesalerId } from "@/lib/wholesale/model";
import { supplierIsWholesaler } from "@/lib/wholesale/prepare";
import { BASE_PRICE_NOTE, type PriceKind } from "@/lib/catalogue/price-kind";
import { hasProductFacts, productInfoOfOffer, type ProductInfo } from "@/lib/catalogue/product-info";
import { tradeUnit } from "@/lib/catalogue/units";

/**
 * Artiklar och priser on a work order (2026-10-08, steg 1): picking an article COPIES its price, unit, supplier,
 * article number, source and price date into the material row. The row never points back for its values – a later
 * import, a deleted import or a removed supplier never changes a saved work order. Pure, so Cloud, Local (.hwf) and the
 * demo read a row the same way; only the search itself needs the Cloud catalogue.
 */
export type CatalogueSnapshot = {
  /** The article the price came from, only to say where it came from; never read back for values. */
  articleId: string;
  supplierName: string;
  supplierArticleNo: string;
  eNumber: string;
  /** The manufacturer's article number, when the price file had one (2026-10-09). */
  manufacturerArticleNo?: string;
  /** Price of one unit in SEK excluding VAT, as text with decimal comma ("12,5"). */
  unitPrice: string;
  unit: string;
  /** The file the price was imported from. */
  source: string;
  /** ÅÅÅÅ-MM-DD: when the price was set. */
  priceDate: string;
  /** ÅÅÅÅ-MM-DD: when a later import last found the same price (pris ändrat 2026-10-08); absent when never confirmed. */
  confirmedDate?: string;
  importId?: string;
  /** "BASE" when the price is the wholesaler's base price before the company's discount (2026-10-13 natt); absent = net. */
  priceKind?: "BASE";
  /** Which wholesaler the supplier is, as the company set it (2026-10-13 natt); the export reads it before the name. */
  wholesaler?: WholesalerId;
  /**
   * Rabattbrev (2026-10-14): the net price came from the base price with the company's discount letter – the base
   * price (GNP) and the discount in percent, or fixedNet for an agreed net price. Copied, so an old row keeps it.
   */
  rebate?: CatalogueRebateCopy;
};
/** The discount letter's part of a copied price: texts with a decimal comma, as unitPrice. */
export type CatalogueRebateCopy = { basePrice: string; percent?: string; fixedNet?: true };

/**
 * One supplier's article: its own number, unit and latest price, if it has one. The company's own suppliers' articles are rows
 * of its catalogue (`id` = the article's id). A company's price on a wholesaler's article is a price row on the shared register's
 * article (2026-10-17, alternativ C): that offer's `id` is "<wholesaler>:<article number>:<supplier id>" (lib/catalogue/register-hit.ts
 * parseWholesaleOfferId), one per supplier of the company, and it has the register's words in `catalog`. The unpriced register row
 * is `catalogOnly` with the id "<wholesaler>:<article number>".
 */
export type CatalogueOffer = {
  id: string; name: string; unit: string; supplierArticleNo: string; eNumber: string; supplierName: string;
  supplierId?: string;
  /** The supplier's wholesaler (solar/ahlsell/sonepar/rexel), when the company set it. */
  wholesaler?: WholesalerId | null;
  /** RSK-nummer (VVS) from the price file, "" or absent when none (2026-10-12). */
  rskNumber?: string;
  /** GTIN/EAN and manufacturer from the price file or the wholesaler's catalogue, absent when none (2026-10-14). */
  gtin?: string;
  manufacturer?: string;
  /** The manufacturer's article number from the price file, "" or absent when none (2026-10-09). */
  manufacturerArticleNo?: string;
  /** The supplier's discount group, shown in the catalogue (prisfil 2026-10-08); not copied to a material row. */
  discountGroup?: string;
  /** Förpackning (pieces per package), beställningsmultipel and status from the price file (2026-10-15); absent when none. */
  packageSize?: string;
  orderMultiple?: string;
  minOrderQuantity?: string;
  /** Lagerförd hos grossisten: true/false when the file says, absent when not. */
  stocked?: boolean;
  status?: "UTGAR" | "PRIS_PA_BEGARAN";
  /** The supplier's latest price file of this price's kind did not have the article (2026-10-15): it keeps its last price. */
  notInLatest?: { fileName: string; date: string };
  /**
   * The shared register's article at this offer's wholesaler (2026-10-17): the wholesaler's own number, words and
   * status – only on the wholesaler's own row, never on another wholesaler's. An offer that is only the register's article
   * (no price file of the company has it at that wholesaler) is `catalogOnly` and has no price.
   */
  catalog?: CatalogueRegisterInfo;
  catalogOnly?: boolean;
  /** The link to the register is uncertain (the same E-nummer but another unit): said for the person to check, never guessed. */
  catalogCheck?: string;
  /**
   * priceDate = when the price was set; confirmedDate = the latest later import that found it unchanged, if any;
   * perQuantity/amount when the price is for more than one unit ("350 kr / 100 st").
   */
  price: { unitPrice: number; priceDate: string; confirmedDate?: string; sourceFileName: string; importId: string; perQuantity?: number; amount?: number;
    /** "BASE" = the wholesaler's base price before the company's discount, shown as such (2026-10-13 natt); absent = net. */
    priceKind?: PriceKind;
    /** The net price was computed from the base price with the supplier's discount letter (2026-10-14). */
    rebate?: { basePrice: number; percent: number; rule: "GROUP" | "ARTICLE" | "NET"; fileName: string; date: string } } | null;
};

/**
 * An article as the catalogue search answers (2026-10-12: as a product of the company's one register): the offer the
 * row takes when picked, and – when the product has the same E-nummer or RSK-nummer at several of the company's
 * suppliers – every supplier's offer side by side. `supplierOnly`: the article has no common number and is only that
 * supplier's product.
 */
export type CatalogueHit = CatalogueOffer & {
  /** What an API has told about the same product (picture, status, numbers the file lacked), 2026-10-16. */
  product?: ProductInfo;
  /** The searcher may not see prices (2026-10-09): `price` is null even if the article has one; the server prices the row. */
  priceHidden?: boolean;
  productId?: string;
  common?: CommonNumber;
  offers?: CatalogueOffer[];
  supplierOnly?: boolean;
  /** The shared register's article for the same product (2026-10-17): the wholesaler's own number, words and status. Never a price. */
};

/** What the shared register knows of an article at one wholesaler (lib/catalogue/register-hit.ts); `statusText` in plain words, "" when current. */
export type CatalogueRegisterInfo = { wholesaler: WholesalerId; articleNo: string; name: string; description: string; productType: string; series: string; status: string; statusText: string };

/** The register's product type of a hit, from any of its offers (the product's identity, the same at every wholesaler). */
export const hitProductType = (hit: Pick<CatalogueHit, "catalog" | "offers">) => hit.catalog?.productType || hit.offers?.find((offer) => offer.catalog?.productType)?.catalog?.productType || "";

/** Offers are compared on price only when they sell the same thing: the same unit and the same package (2026-10-17). */
export const sameUnitAndPackage = (a: Pick<CatalogueOffer, "unit" | "packageSize">, b: Pick<CatalogueOffer, "unit" | "packageSize">) =>
  tradeUnit(a.unit || "st").toLowerCase() === tradeUnit(b.unit || "st").toLowerCase() && Number(a.packageSize || 1) === Number(b.packageSize || 1);

/**
 * The offer a product hit takes (2026-10-12): the chosen supplier's when the search is limited to one; the article
 * found by its exact number; otherwise the lowest price above zero – among the net prices when there are any, since a
 * base price before the discount is not comparable with a net price (2026-10-13 natt); otherwise the article that matched.
 */
export function pickOffer(offers: readonly CatalogueOffer[], options: { matched: string; exact?: boolean; supplierId?: string | null }): CatalogueOffer {
  const matched = offers.find((offer) => offer.id === options.matched) ?? offers[0];
  if (options.supplierId) { const own = offers.find((offer) => offer.supplierId === options.supplierId && offer.id === options.matched) ?? offers.find((offer) => offer.supplierId === options.supplierId); if (own) return own; }
  if (options.exact) return matched;
  const priced = offers.filter((offer) => offer.price && offer.price.unitPrice > 0);
  // Prices are compared only between offers that sell the same unit and package (2026-10-17): the matched offer's
  // when it has a price, otherwise the first priced one's. A price per metre is never "lower" than a price per package.
  const reference = priced.find((offer) => offer.id === matched.id) ?? priced[0];
  const comparable = reference ? priced.filter((offer) => sameUnitAndPackage(offer, reference)) : [];
  // An article going out, with price on request or missing from its supplier's latest price file is never the default
  // while another supplier has the product as a current article (2026-10-15); the rule within is unchanged.
  const current = comparable.filter((offer) => !offer.status && !offer.notInLatest);
  const pool = current.length ? current : comparable;
  const net = pool.filter((offer) => offer.price!.priceKind !== "BASE");
  return (net.length ? net : pool).sort((a, b) => a.price!.unitPrice - b.price!.unitPrice)[0] ?? matched;
}

/** The same product hit with another supplier's offer as the one the row takes (picking a supplier in the hit). */
export function hitWithOffer(hit: CatalogueHit, offerId: string): CatalogueHit {
  const offer = hit.offers?.find((item) => item.id === offerId);
  if (!offer) return hit;
  return { ...hit, ...offer, priceHidden: hit.priceHidden, ...(hit.priceHidden ? { price: null } : {}) };
}

/**
 * Grossistexport (2026-10-12): the other wholesalers' own article numbers of the same product, from the company's own
 * price files – so the export can order the product at a wholesaler other than the one the price came from. A product is the
 * company's own (`productId`) or a product of the shared register that has a common number (`common`, 2026-10-17:
 * the company's price on a wholesaler's article is a price row on the register's article, which has no product row of the company).
 */
export function linkedWholesaleIds(hit: CatalogueHit): Partial<Record<WholesalerId, string>> {
  const ids: Partial<Record<WholesalerId, string>> = {};
  if (!hit.productId && !hit.common) return ids;
  for (const offer of hit.offers ?? []) {
    if (offer.id === hit.id || !offer.supplierArticleNo.trim()) continue;
    for (const wholesaler of WHOLESALERS) {
      if (ids[wholesaler] || offerIsWholesaler(hit, wholesaler)) continue;
      if (offerIsWholesaler(offer, wholesaler)) ids[wholesaler] = offer.supplierArticleNo.trim().slice(0, 60);
    }
  }
  return ids;
}

/** Whether an offer's supplier is the wholesaler: as the company set it, otherwise by its name. */
const offerIsWholesaler = (offer: Pick<CatalogueOffer, "supplierName" | "wholesaler">, wholesaler: WholesalerId) => (offer.wholesaler ? offer.wholesaler === wholesaler : supplierIsWholesaler(offer.supplierName, wholesaler));

/** The date a price was last known to be right: the latest confirmation, otherwise the price date. */
export const checkedDate = (price: { priceDate: string; confirmedDate?: string }) =>
  price.confirmedDate && price.confirmedDate > price.priceDate ? price.confirmedDate : price.priceDate;

/** After this many months a price is shown with a hint to check it. */
export const PRICE_AGE_MONTHS = 3;

/** The article number a picked article gives the row: the supplier's, otherwise its E-nummer. */
export const articleNumberOf = (hit: Pick<CatalogueHit, "supplierArticleNo" | "eNumber">) => hit.supplierArticleNo ? hit.supplierArticleNo.slice(0, 60) : hit.eNumber ? `E ${hit.eNumber}`.slice(0, 60) : "";

/**
 * The material row with the article picked: Benämning, unit, the article number with its source (the supplier) and the
 * manufacturer's number copied, and the price when the person may see it; the quantity the person typed stays
 * (Materialsökningen, 2026-10-09).
 */
export function applyArticle(row: MaterialRow, hit: CatalogueHit): MaterialRow {
  const price = hit.price;
  const next: MaterialRow = { ...row, name: hit.name.slice(0, 300), unit: (hit.unit || row.unit).slice(0, 40) };
  const articleNo = articleNumberOf(hit);
  if (articleNo) { next.articleNo = articleNo; next.articleSource = hit.supplierName.slice(0, 200); } else { delete next.articleNo; delete next.articleSource; }
  if (hit.manufacturerArticleNo) next.manufacturerArticleNo = hit.manufacturerArticleNo.slice(0, 60);
  // Produktens uppgifter (2026-10-16): the same facts on the row as in the hit, from the file and any API, kept as a copy.
  const product = productInfoOfOffer(hit, hit.product ?? null);
  if (hasProductFacts(product)) next.product = product; else delete next.product;
  delete next.pickedArticleId;
  // Another article is another product: what was noted for a wholesaler (Grossistexport) belonged to the old one. The
  // product's own numbers at the company's other wholesalers come with it (one register, 2026-10-12).
  delete next.wholesale;
  const linked = linkedWholesaleIds(hit);
  if (Object.keys(linked).length) next.wholesale = { ids: { ...linked }, linked };
  // Picked by someone who may not see prices (2026-10-09): the server copies the price on save.
  if (hit.priceHidden) { delete next.catalogue; delete next.unitPrice; delete next.markupPercent; next.pickedArticleId = hit.id.slice(0, 100); return next; }
  // A new price is a new purchase: the row's markup is taken again from the company's setting.
  delete next.markupPercent;
  if (!price) { delete next.catalogue; delete next.unitPrice; return next; }
  const unitPrice = formatPrice(price.unitPrice);
  next.unitPrice = unitPrice;
  next.catalogue = {
    articleId: hit.id, supplierName: hit.supplierName.slice(0, 200), supplierArticleNo: hit.supplierArticleNo.slice(0, 60), eNumber: hit.eNumber.slice(0, 20),
    ...(hit.manufacturerArticleNo ? { manufacturerArticleNo: hit.manufacturerArticleNo.slice(0, 60) } : {}),
    unitPrice, unit: hit.unit.slice(0, 40), source: (price.rebate ? `${price.sourceFileName} · ${rebateText(price.rebate)}` : price.sourceFileName).slice(0, 200), priceDate: price.priceDate,
    ...(checkedDate(price) !== price.priceDate ? { confirmedDate: checkedDate(price) } : {}), importId: price.importId,
    ...(price.priceKind === "BASE" ? { priceKind: "BASE" as const } : {}),
    ...(hit.wholesaler ? { wholesaler: hit.wholesaler } : {}),
    ...(price.rebate ? { rebate: rebateCopy(price.rebate) } : {}),
  };
  return next;
}

/** The discount letter's part of the copy on the row: the base price and the percent, or that it is an agreed net price. */
export function rebateCopy(rebate: NonNullable<NonNullable<CatalogueOffer["price"]>["rebate"]>): CatalogueRebateCopy {
  return rebate.rule === "NET" ? { basePrice: formatPrice(rebate.basePrice), fixedNet: true } : { basePrice: formatPrice(rebate.basePrice), percent: percentText(rebate.percent) };
}

/** 32.98 → "32,98" (at most two decimals, no trailing zeros). */
export const percentText = (value: number) => String(Math.round(value * 100) / 100).replace(".", ",");

/**
 * What the price field shows above the price (2026-10-14, as the wholesalers' web shops): the discount in percent
 * or "Avtalspris", with the base price struck through beside it; "Grundpris" for a base price without a letter; nothing
 * once the person has typed another price than the copied one, or for a price not from the catalogue.
 */
export function priceMarkOf(snapshot: Pick<CatalogueSnapshot, "unitPrice" | "priceKind" | "rebate"> | undefined, unitPrice: string | undefined): { label: string; basePrice?: string; tone: "discount" | "base" } | null {
  if (!snapshot || (unitPrice ?? "").trim() !== snapshot.unitPrice.trim()) return null;
  if (snapshot.rebate) return { label: snapshot.rebate.fixedNet ? "Avtalspris" : `${snapshot.rebate.percent ?? ""} %`, basePrice: snapshot.rebate.basePrice, tone: "discount" };
  if (snapshot.priceKind === "BASE") return { label: "Grundpris", tone: "base" };
  return null;
}

/** "rabattbrev Avtal.csv −42,5 %" / "nettopris i rabattbrev Avtal.csv": where a computed net price came from. */
export function rebateText(rebate: NonNullable<NonNullable<CatalogueOffer["price"]>["rebate"]>): string {
  return rebate.rule === "NET" ? `nettopris i rabattbrev ${rebate.fileName}` : `rabattbrev ${rebate.fileName} −${String(rebate.percent).replace(".", ",")} %`;
}

/** Whole months between a price date and today (ÅÅÅÅ-MM-DD); null when the date cannot be read. */
export function priceAgeMonths(priceDate: string, today: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(priceDate);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!a || !b) return null;
  let months = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
  if (Number(b[3]) < Number(a[3])) months -= 1;
  return months;
}

/**
 * "Prisdatum äldre än 3 månader – kontrollera priset" when the price is old, otherwise "". Pass the price itself (or
 * its date) – a later confirmation counts (pris ändrat 2026-10-08): a price confirmed last week is not old.
 */
export function priceAgeHint(price: string | { priceDate: string; confirmedDate?: string }, today: string, months = PRICE_AGE_MONTHS): string {
  const age = priceAgeMonths(typeof price === "string" ? price : checkedDate(price), today);
  return age !== null && age >= months ? `Prisdatum äldre än ${months} månader – kontrollera priset` : "";
}

/** "prisdatum 2026-07-01, bekräftad 2026-10-01" – when the price was set and, when later, when it was last confirmed. */
export function priceDateText(price: { priceDate: string; confirmedDate?: string }): string {
  if (!price.priceDate) return "";
  const checked = checkedDate(price);
  return checked !== price.priceDate ? `prisdatum ${price.priceDate}, bekräftad ${checked}` : `prisdatum ${price.priceDate}`;
}

/** "Leverantör AB · art.nr 123 · E 1234567 · prislista.xlsx, prisdatum 2026-10-01" – where a copied price came from. */
export function priceSourceText(snapshot: Pick<CatalogueSnapshot, "supplierName" | "supplierArticleNo" | "eNumber" | "source" | "priceDate" | "confirmedDate" | "priceKind">): string {
  return [
    snapshot.priceKind === "BASE" ? BASE_PRICE_NOTE : "",
    snapshot.supplierName,
    snapshot.supplierArticleNo ? `art.nr ${snapshot.supplierArticleNo}` : "",
    snapshot.eNumber ? `E ${snapshot.eNumber}` : "",
    [snapshot.source, priceDateText(snapshot)].filter(Boolean).join(", "),
  ].filter(Boolean).join(" · ");
}

/** Today as ÅÅÅÅ-MM-DD in Swedish time. */
export const todayInSweden = (now = new Date()) => now.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

const quantity = (value: string) => Number(value).toLocaleString("sv-SE", { maximumFractionDigits: 4 });

/**
 * Förpackning, multipel, minsta beställning och lagervara of an offer as short facts for a search hit (2026-10-15):
 * "250 st per förpackning", "Beställs i 500 m", "Minst 100 st", "Lagervara". Only what the price file says; the price
 * itself is always for the article's own unit (kr/st, kr/förp, kr/m) and is never recomputed from these.
 */
export function offerFacts(offer: Pick<CatalogueOffer, "unit" | "packageSize" | "orderMultiple" | "minOrderQuantity" | "stocked">): string[] {
  const unit = offer.unit || "st";
  return [
    offer.packageSize ? `${quantity(offer.packageSize)} st per förpackning` : "",
    offer.orderMultiple && Number(offer.orderMultiple) > 1 ? `Beställs i ${quantity(offer.orderMultiple)} ${unit}` : "",
    offer.minOrderQuantity && Number(offer.minOrderQuantity) > 1 ? `Minst ${quantity(offer.minOrderQuantity)} ${unit}` : "",
    offer.stocked === true ? "Lagervara" : "",
  ].filter(Boolean);
}

/** A status or a missing price file as a warning for the hit (2026-10-15), "" when the article is current. */
export function offerWarning(offer: Pick<CatalogueOffer, "status" | "notInLatest" | "catalog" | "catalogCheck">): string {
  if (offer.status === "UTGAR") return "Utgår – så länge lagret räcker";
  if (offer.status === "PRIS_PA_BEGARAN") return "Pris på begäran";
  // The wholesaler's own status from the shared register, on the wholesaler's own row only (2026-10-17).
  if (offer.catalog?.statusText) return offer.catalog.statusText;
  if (offer.catalogCheck) return offer.catalogCheck;
  if (offer.notInLatest) return `Inte i senaste prisfilen (${offer.notInLatest.date})`;
  return "";
}
