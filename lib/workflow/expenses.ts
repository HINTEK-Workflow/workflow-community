import { parseDecimal } from "@/lib/calculators/number";
import type { PurchaseRef } from "@/lib/purchases/ref";
import type { ProductInfo } from "@/lib/catalogue/product-info";
import type { DistanceBasis } from "@/lib/geo/routing";
import type { RowWholesale } from "@/lib/wholesale/model";
import type { CatalogueSnapshot } from "@/lib/catalogue/snapshot";
import type { StoreRef } from "./store-ref";

/**
 * Material och utgifter on a work order (2026-10-08, item 2 of the specification). A material row is what it
 * always was; a row with `kind: "expense"` also carries a unit price and an amount in SEK excluding VAT, as free
 * decimal text like every other amount a person types. The core has no VAT handling, so amounts are stored excluding
 * VAT and the UI says so; no VAT rate and no tax-free mileage allowance is assumed. A car cost is one expense row
 * with a readable description and structured facts (`carCost`) so it can be reviewed and updated on purpose.
 */
export type ExpenseKind = "material" | "expense";
export type CarCostMeta = { distanceKm: number; roundTrip: boolean; pricePerKm: number; basis: DistanceBasis };
export type MaterialRow = {
  id: string; name: string; quantity: string; unit: string;
  kind?: ExpenseKind; unitPrice?: string; amount?: string; carCost?: CarCostMeta;
  /** Artiklar och priser (2026-10-08): a copy of the picked article's price and where it came from (lib/catalogue/snapshot.ts). */
  catalogue?: CatalogueSnapshot;
  /**
   * Priser på materialraden (2026-10-09, steg A): the markup in percent as typed ("15", "12,5"), copied from the
   * company's setting when the row got its price, so an old work order never changes with the setting. Material rows only.
   */
  markupPercent?: string;
  /**
   * An article picked by someone who may not see prices: the server copies the article's price into the row when the
   * work order is saved and removes this field (lib/workflow/material-prices-server.ts). Never stored.
   */
  pickedArticleId?: string;
  /**
   * Artikelnummer with its source (2026-10-09): copied from a picked article (the supplier's number, or its
   * E-nummer, and the supplier as source) or typed by hand (source "" = the company's own). Material rows only.
   */
  articleNo?: string;
  articleSource?: string;
  /** Tillverkarens artikelnummer, when known – from the price file or typed by hand. */
  manufacturerArticleNo?: string;
  /** Grossistexport (2026-10-12): the article number to order with at a wholesaler and the order unit conversion, entered by the person. */
  wholesale?: RowWholesale;
  /**
   * Offert → arbetsorder (steg C, 2026-10-09): a copy of the accepted quote line the row was made from, with its
   * selling price (lib/quotes/conversion.ts). A price field: only someone with the price right reads it.
   */
  quoteRef?: { quoteId: string; quoteLabel: string; version: number; lineId: string; unitPrice: string };
  /** Inköp (2026-10-16): the purchase the row came from or was added to (lib/purchases/ref.ts). */
  purchaseRef?: PurchaseRef;
  /** Produktens uppgifter (2026-10-16): numbers, manufacturer, picture and status of the picked product (lib/catalogue/product-info.ts). */
  product?: ProductInfo;
  /**
   * Uttag ur förrådet (2026-10-30): the store's log row the row was written by (lib/workflow/store-rows.ts). Such a
   * row is locked – only the store adds, changes or takes it away. Cloud only.
   */
  storeRef?: StoreRef;
};

/** Enhet is free text; these are only suggestions in the field (2026-10-09). */
export const MATERIAL_UNIT_SUGGESTIONS = ["st", "m", "m²", "m³", "kg", "l", "h", "rulle", "förp"] as const;

export const isExpenseRow =(row: Pick<MaterialRow, "kind">) => row.kind === "expense";
export const isCarCostRow = (row: Pick<MaterialRow, "kind" | "carCost">) => row.kind === "expense" && Boolean(row.carCost);

/** A row with nothing in it: no name, amount, unit, price, article or car cost (a row just added with Lägg till). */
export function isBlankMaterialRow(row: MaterialRow) {
  const text = [row.name, row.quantity, row.unit, row.unitPrice, row.amount, row.markupPercent, row.articleNo, row.manufacturerArticleNo, row.pickedArticleId];
  return text.every((value) => !value?.trim()) && !row.carCost && !row.catalogue && !row.quoteRef && !row.purchaseRef;
}

/**
 * The rows a save sends (simulation 2026-10-10, telefon fynd 4): a new row that is still blank is not saved – it is
 * kept on screen while it is filled in, and dropped when the person leaves without writing anything (an empty "Ny
 * utgift", 0 kr, stayed on the job). A blank row that is already saved stays, so clearing a row never deletes it.
 * Returns the same array when nothing is left out.
 */
export function withoutNewBlankRows<T extends MaterialRow>(rows: T[], savedIds: ReadonlySet<string>): T[] {
  const kept = rows.filter((row) => savedIds.has(row.id) || !isBlankMaterialRow(row));
  return kept.length === rows.length ? rows : kept;
}

const NBSP = "\u00a0";

/** "1 234,50" – an amount in SEK with two decimals, Swedish decimal comma and a no-break space between thousands. */
export function formatSek(value: number): string {
  if (!Number.isFinite(value)) return "–";
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  const [whole, fraction] = rounded.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${value < 0 && rounded > 0 ? "-" : ""}${grouped},${fraction}`;
}

/** Kilometres as a person reads them: "23,4", "120". */
export function formatKm(km: number): string {
  if (!Number.isFinite(km)) return "–";
  return (Math.round(km * 10) / 10).toLocaleString("sv-SE", { maximumFractionDigits: 1 });
}

/** A price as typed: no trailing zeros, decimal comma ("3,5", "35"). */
export const formatPrice = (value: number) => Number.isFinite(value) ? (Math.round(value * 10000) / 10000).toLocaleString("sv-SE", { maximumFractionDigits: 4 }) : "–";

/** The amount text of a row as a number, or null when empty or not a number. */
export function parseAmount(text: string | undefined): number | null {
  const parsed = parseDecimal(text ?? "");
  return parsed.state === "ok" ? parsed.value : null;
}

/** Sum of the expense rows' amounts (rows without a readable amount count as 0) and how many rows lack one. */
export function expenseTotal(rows: readonly Pick<MaterialRow, "kind" | "amount">[]) {
  let total = 0, missing = 0, count = 0;
  for (const row of rows) {
    if (!isExpenseRow(row)) continue;
    count += 1;
    const amount = parseAmount(row.amount);
    if (amount === null) { if ((row.amount ?? "").trim()) missing += 1; } else total += amount;
  }
  return { total: Math.round(total * 100) / 100, count, missing };
}

/** quantity × unit price when both read as numbers, else null – for filling an expense row's amount. */
export function rowAmount(row: Pick<MaterialRow, "quantity" | "unitPrice">): number | null {
  const quantity = parseAmount(row.quantity);
  const price = parseAmount(row.unitPrice);
  return quantity === null || price === null ? null : Math.round(quantity * price * 100) / 100;
}

// ---------- car cost ----------

export type DistanceUnit = "km" | "mil";
export const KM_PER_MIL = 10;

export type CarCostInput = {
  /** One-way distance in kilometres. */
  distanceKm: number;
  roundTrip: boolean;
  /** Price as typed, in SEK per `unit`, excluding VAT. */
  price: number;
  unit: DistanceUnit;
  basis: DistanceBasis;
};

export type CarCost = { distanceKm: number; totalKm: number; pricePerKm: number; amount: number; roundTrip: boolean; basis: DistanceBasis; unit: DistanceUnit; price: number };

/** Converts the price to per km and multiplies by the travelled distance; the amount is rounded to whole öre. */
export function computeCarCost(input: CarCostInput): CarCost {
  const distanceKm = Math.max(0, Math.round(input.distanceKm * 10) / 10);
  const totalKm = Math.round(distanceKm * (input.roundTrip ? 2 : 1) * 10) / 10;
  const pricePerKm = input.unit === "mil" ? input.price / KM_PER_MIL : input.price;
  const amount = Math.round(totalKm * pricePerKm * 100) / 100;
  return { distanceKm, totalKm, pricePerKm, amount, roundTrip: input.roundTrip, basis: input.basis, unit: input.unit, price: input.price };
}

/** Converts a typed price between kr/km and kr/mil without losing what the person typed beyond rounding. */
export const convertPrice = (price: number, from: DistanceUnit, to: DistanceUnit) => from === to ? price : from === "km" ? price * KM_PER_MIL : price / KM_PER_MIL;

const basisText = (basis: DistanceBasis) => basis === "straight_line" ? "fågelvägen" : basis === "road" ? "längs väg" : "enligt bilens mätare";

/** "Bilkostnad: tur och retur 2 × 23,4 km (fågelvägen) × 35 kr/mil" – the row's name; the basis is always named. */
export function describeCarCost(cost: CarCost): string {
  const trip = cost.roundTrip ? `tur och retur 2 × ${formatKm(cost.distanceKm)} km` : `enkel resa ${formatKm(cost.distanceKm)} km`;
  return `Bilkostnad: ${trip} (${basisText(cost.basis)}) × ${formatPrice(cost.price)} kr/${cost.unit}`;
}

/** An expense's name without the rate the car cost's description ends with ("… × 35 kr/mil"), for a report without prices. */
export const withoutRate = (name: string) => name.replace(/\s*×\s*\d[\d\s.,]*\s*kr\/(?:km|mil)\b/gi, "").trim();

/** The expense row for a car cost; `id` is kept when an existing row is updated on purpose. */
export function carCostRow(cost: CarCost, id: string): MaterialRow {
  return {
    id, kind: "expense", name: describeCarCost(cost),
    quantity: formatKm(cost.totalKm), unit: "km",
    unitPrice: formatPrice(cost.pricePerKm), amount: formatSek(cost.amount),
    carCost: { distanceKm: cost.distanceKm, roundTrip: cost.roundTrip, pricePerKm: Math.round(cost.pricePerKm * 10000) / 10000, basis: cost.basis },
  };
}

export const CAR_COST_UNIT_LABELS: Record<DistanceUnit, string> = { km: "kr/km", mil: "kr/mil" };
