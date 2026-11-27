import { hasWorkflowPermission, type WorkflowPermissionProfile } from "./permissions";
import { expenseTotal, formatPrice, isExpenseRow, parseAmount, type MaterialRow } from "./expenses";

/**
 * Priser på materialraden (2026-10-09, steg A, docs/proposals/material-pris-offert-2026-10-09.md): a material row
 * may carry an à-pris (the purchase price per unit, excl. VAT) and its own copy of the company's markup. The row's
 * amount is antal × à-pris, and its selling amount adds the markup. Rows without a readable price are counted as
 * "utan pris" – never as 0 kr in silence. Purchase price and markup are the company's business secrets: only someone with
 * the price right sees them (`canSeePrices`), the server removes them from what everyone else reads and keeps the stored
 * values when such a person saves. Pure, so Cloud, Local (.hwf), the demo and the tests share it.
 */

/** Whole öre, with the float noise of products like 1,005 × 100 removed first (1,005 kr → 1,01 kr). */
export const roundOre = (value: number) => Math.round(Number((value * 100).toPrecision(12))) / 100;

/** Who sees purchase prices and markup: company admins, Artiklar och priser – läsa, or Offerter – läsa. */
export function canSeePrices(caller: { admin: boolean; permissions: WorkflowPermissionProfile }) {
  return caller.admin || hasWorkflowPermission(caller.permissions, "catalogue", "read") || hasWorkflowPermission(caller.permissions, "quotes", "read");
}

/** A markup is a percentage between -100 (everything off) and 1000. */
export const MARKUP_MIN = -100;
export const MARKUP_MAX = 1000;
/** The markup as a number, or null when empty or not a readable percentage within the bounds. */
export function parsePercent(text: string | null | undefined): number | null {
  const value = parseAmount((text ?? "").replace("%", ""));
  return value === null || value < MARKUP_MIN || value > MARKUP_MAX ? null : value;
}

export type MaterialRowPrice = {
  /** antal × à-pris in kr excl. VAT, whole öre; null when either is missing or not a number. */
  purchase: number | null;
  /** The purchase amount with the row's markup; equals `purchase` without a markup. */
  sale: number | null;
  /** The row's markup in percent, or null. */
  markup: number | null;
  /** The selling price of one unit (à-pris with the markup), rounded to whole öre; null without an à-pris. */
  saleUnitPrice: number | null;
};

/** The row's amounts; the selling amount is computed from the unrounded product so it is not off by an öre. */
export function materialRowPrice(row: Pick<MaterialRow, "quantity" | "unitPrice" | "markupPercent">): MaterialRowPrice {
  const quantity = parseAmount(row.quantity);
  const price = parseAmount(row.unitPrice);
  const markup = parsePercent(row.markupPercent);
  const factor = 1 + (markup ?? 0) / 100;
  const saleUnitPrice = price === null ? null : roundOre(price * factor);
  if (quantity === null || price === null) return { purchase: null, sale: null, markup, saleUnitPrice };
  return { purchase: roundOre(quantity * price), sale: roundOre(quantity * price * factor), markup, saleUnitPrice };
}

export type WorkOrderTotals = {
  material: {
    /** Sum of the priced material rows: purchase and selling amount, kr excl. VAT. */
    purchase: number; sale: number;
    /** Material rows with a name: how many have a price and how many lack one. */
    priced: number; unpriced: number;
  };
  /** The expense rows (Material och utgifter, 2026-10-08), as before. */
  expenses: { total: number; count: number; missing: number };
  /** Material at its selling amount plus the expenses, kr excl. VAT. */
  total: number;
};

/** The work order's sums: material (purchase and with markup), expenses and the total excl. VAT. */
export function workOrderTotals(rows: readonly Pick<MaterialRow, "kind" | "name" | "quantity" | "unitPrice" | "markupPercent" | "amount">[]): WorkOrderTotals {
  let purchase = 0, sale = 0, priced = 0, unpriced = 0;
  for (const row of rows) {
    if (isExpenseRow(row) || !row.name.trim()) continue;
    const price = materialRowPrice(row);
    if (price.purchase === null || price.sale === null) { unpriced += 1; continue; }
    priced += 1;
    purchase += price.purchase;
    sale += price.sale;
  }
  const expenses = expenseTotal(rows);
  return { material: { purchase: roundOre(purchase), sale: roundOre(sale), priced, unpriced }, expenses, total: roundOre(sale + expenses.total) };
}

/** A type of time with its own price on a customer report (beslut 8): `rate` null when the company has set none. */
export type OwnPriceLabour = { name: string; seconds: number; rate: number | null };
export type CustomerPriceTotals = {
  /** The types with their own price, each its own line; amount null without a price. */
  ownLabour: { name: string; hours: number; rate: number | null; amount: number | null }[];
  /** The reported time: hours, the company's hourly rate and hours × rate in whole öre; amount null without a rate. */
  labour: { hours: number; rate: number | null; amount: number | null };
  /** Material at its price to the customer (with the markup); `unpriced` rows lack a price and are not counted. */
  material: { sale: number; unpriced: number };
  expenses: WorkOrderTotals["expenses"];
  /** Arbete + material + utgifter, kr excl. VAT; the work is left out only when it has time but no rate (`labourMissing`). */
  total: number;
  labourMissing: boolean;
};

/**
 * Priser till kunden (2026-11-01, användartest 2026-10-31 F2): what a work order report with "Visa priser" may show –
 * the price to the customer only, never the purchase price or the markup – and a total that includes the work (the
 * reported time × the company's hourly rate). The purchase sums stay for the internal views (workOrderTotals).
 */
export function customerPriceTotals(rows: Parameters<typeof workOrderTotals>[0], durationSec: number, hourlyRate: number | null | undefined, ownLabour: readonly OwnPriceLabour[] = []): CustomerPriceTotals {
  const totals = workOrderTotals(rows);
  // Beslut 8 (2026-11-01): a type of time with its own price is a line of its own here too, and a blank price says so.
  const own = ownLabour.map((line) => {
    const lineHours = Math.max(0, line.seconds) / 3600;
    return { name: line.name, hours: lineHours, rate: line.rate, amount: line.rate === null ? null : roundOre(lineHours * line.rate) };
  });
  const ownAmount = own.reduce((sum, line) => sum + (line.amount ?? 0), 0);
  const hours = Math.max(0, durationSec) / 3600;
  const rate = typeof hourlyRate === "number" && Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : null;
  const amount = rate === null ? (hours > 0 ? null : 0) : roundOre(hours * rate);
  return {
    labour: { hours, rate, amount },
    ownLabour: own,
    material: { sale: totals.material.sale, unpriced: totals.material.unpriced },
    expenses: totals.expenses,
    total: roundOre((amount ?? 0) + ownAmount + totals.material.sale + totals.expenses.total),
    labourMissing: amount === null || own.some((line) => line.amount === null),
  };
}

/** "3 rader saknar pris" / "1 rad saknar pris". */
export const unpricedText = (count: number) => `${count} ${count === 1 ? "rad" : "rader"} saknar pris`;

/** The company's markup copied to a row that has just got its price and has no markup of its own yet. */
export function withCompanyMarkup<T extends Pick<MaterialRow, "unitPrice" | "markupPercent">>(row: T, companyMarkup: string | null | undefined): T {
  const markup = parsePercent(companyMarkup);
  if (markup === null || row.markupPercent !== undefined || !(row.unitPrice ?? "").trim()) return row;
  return { ...row, markupPercent: formatPrice(markup) };
}

// quoteRef carries the quote's selling price (steg C), so it follows the same right as the price itself.
const PRICE_FIELDS = ["unitPrice", "markupPercent", "catalogue", "quoteRef"] as const;
type PriceFields = Pick<MaterialRow, (typeof PRICE_FIELDS)[number]>;

/** A material row as someone without the price right reads it: Benämning, Antal and Enhet. Expense rows are unchanged. */
export function withoutMaterialPrices<T extends MaterialRow>(rows: readonly T[]): T[] {
  return rows.map((row) => {
    if (isExpenseRow(row)) return row;
    const copy = { ...row };
    for (const key of PRICE_FIELDS) delete copy[key];
    delete copy.pickedArticleId;
    return copy;
  });
}

/**
 * A save by someone without the price right: whatever price they sent on a material row is ignored, and the stored
 * row's price, markup and price copy are kept (matched by the row's id). A row they add has no price until someone
 * with the right gives it one – or the server prices an article they picked (`pickedArticleId`, kept here).
 */
export function keepStoredMaterialPrices<T extends MaterialRow>(incoming: readonly T[], stored: readonly MaterialRow[]): T[] {
  const byId = new Map(stored.filter((row) => !isExpenseRow(row)).map((row) => [row.id, row]));
  return incoming.map((row) => {
    if (isExpenseRow(row)) return row;
    const copy = { ...row };
    for (const key of PRICE_FIELDS) delete copy[key];
    const before = row.pickedArticleId ? undefined : byId.get(row.id);
    if (!before) return copy;
    const kept: PriceFields = {};
    for (const key of PRICE_FIELDS) if (before[key] !== undefined) (kept as Record<string, unknown>)[key] = before[key];
    return { ...copy, ...kept };
  });
}

type WorkOrderData = { kind: string; details?: unknown };
/** The task data with the material rows' prices removed (work orders only; other kinds are returned as they are). */
export function redactTaskPrices<T extends WorkOrderData>(data: T): T {
  if (data.kind !== "WORK_ORDER") return data;
  const details = data.details as { materials?: MaterialRow[] } | undefined;
  if (!details || !Array.isArray(details.materials)) return data;
  return { ...data, details: { ...details, materials: withoutMaterialPrices(details.materials) } };
}
