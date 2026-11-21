import { applyArticle, type CatalogueHit } from "@/lib/catalogue/snapshot";
import { formatPrice, isExpenseRow, type MaterialRow } from "./expenses";
import { withCompanyMarkup } from "./material-prices";

/**
 * Uttag ur förrådet på arbetsordern (2026-10-30): a spare part drawn from the store (lib/maintenance/store-server.ts)
 * is put on the work order as an ordinary material row at the same moment, in the same transaction, marked with the
 * store's log row (`storeRef`). So the work order's material, its report and the invoice basis read it like any other row,
 * and it counts exactly once – the invoice basis takes a row by its id, and the machine's cost leaves these rows out of
 * the order's material because it counts the store's withdrawals itself.
 *
 * The row is locked: Benämning, Antal, Enhet and Art.nr change only through the store (Lämna tillbaka). À-pris and Påslag
 * stay the price right's, as on every material row. A save can neither add, change nor remove such a row
 * (`keepStoreRows`); only the store writes them. Cloud only – Local has no store and never gets one.
 *
 * A return takes the row away while no invoice basis has taken it. Once it is taken, the row stays (it is billed) and a
 * negative row "Åter till förråd …" is added, so the next basis credits it – still each row exactly once.
 */
export { storeRefSchema, type StoreRef } from "./store-ref";

export const isStoreRow = (row: Pick<MaterialRow, "storeRef">) => Boolean(row.storeRef);

/** "Från förråd Servicebil 1" / "Åter till förråd Förråd A". */
export function storeRowLabel(row: Pick<MaterialRow, "storeRef">): string {
  const ref = row.storeRef;
  if (!ref) return "";
  const place = ref.locationName.trim();
  return ref.return ? `Åter till förråd${place ? ` ${place}` : ""}` : `Från förråd${place ? ` ${place}` : ""}`;
}

/** The fields of a store row that someone with the price right may still change. */
const EDITABLE_PRICE_FIELDS = ["unitPrice", "markupPercent"] as const;

/**
 * A save of a work order (the API and a re-imported Local file): the stored store rows win. A row the save sends with a
 * stored store row's id becomes that stored row, with only its à-pris and påslag taken from the save; a store row the
 * save no longer has is put back; a row the save marks as a store row that is not stored (made up, or already returned)
 * is left out. Every other row is the save's own.
 */
export function keepStoreRows<T extends MaterialRow>(incoming: readonly T[], stored: readonly MaterialRow[]): T[] {
  const storedById = new Map(stored.filter((row) => row && isStoreRow(row) && !isExpenseRow(row)).map((row) => [row.id, row]));
  const used = new Set<string>();
  const kept: T[] = [];
  for (const row of incoming) {
    const before = storedById.get(row.id);
    if (before) {
      if (used.has(row.id)) continue;
      used.add(row.id);
      const next = { ...before } as T;
      if (!isExpenseRow(row)) for (const key of EDITABLE_PRICE_FIELDS) {
        if (row[key] === undefined) delete next[key]; else next[key] = row[key];
      }
      kept.push(next);
      continue;
    }
    if (row.storeRef) continue;
    kept.push(row);
  }
  for (const row of stored) if (row && storedById.has(row.id) && !used.has(row.id)) kept.push({ ...row } as T);
  return kept;
}

/** The quantity as the row shows it and a person types it: "2", "0,5", "-2" (a plain minus, not the typographic one). */
const quantityText = (value: number) => `${value < 0 ? "-" : ""}${formatPrice(Math.abs(value))}`;

export type StoreArticle = { name: string; unit: string; articleNo: string; supplierName: string };

/**
 * The material row of a withdrawal: the store's article (name, unit, its number) with the register's facts and price when
 * it came from the register (the same copy as when an article is picked on the row) and the company's markup; an own
 * article of the store has no price until someone with the price right gives it one.
 */
export function storeWithdrawalRow(input: {
  id: string; transactionId: string; locationName: string; article: StoreArticle; quantity: number; hit: CatalogueHit | null; markupPercent: string;
}): MaterialRow {
  const base: MaterialRow = { id: input.id, name: input.article.name.slice(0, 300), quantity: quantityText(input.quantity), unit: (input.article.unit || "st").slice(0, 40) };
  let row = input.hit ? applyArticle(base, { ...input.hit, priceHidden: false }) : base;
  // The store counts in its own unit and name; the register's copy keeps its price and source.
  row = { ...row, name: base.name, unit: base.unit, quantity: base.quantity };
  if (!row.articleNo && input.article.articleNo.trim()) {
    row.articleNo = input.article.articleNo.trim().slice(0, 60);
    if (input.article.supplierName.trim()) row.articleSource = input.article.supplierName.trim().slice(0, 200);
  }
  delete row.pickedArticleId;
  delete row.wholesale;
  row = withCompanyMarkup(row, input.markupPercent);
  return { ...row, storeRef: { transactionId: input.transactionId, locationName: input.locationName.slice(0, 120) } };
}

/** The negative row of a return, a copy of the withdrawal's row (its price and markup too) with the quantity turned. */
export function storeReturnRow(input: { id: string; transactionId: string; locationName: string; withdrawal: MaterialRow; quantity: number }): MaterialRow {
  const { storeRef: _ref, ...rest } = input.withdrawal;
  void _ref;
  return { ...rest, id: input.id, quantity: quantityText(-Math.abs(input.quantity)), storeRef: { transactionId: input.transactionId, locationName: input.locationName.slice(0, 120), return: true } };
}

/** The work order's row of a store log row, if it has one. */
export const storeRowOf = (rows: readonly MaterialRow[], transactionId: string) => rows.find((row) => row?.storeRef?.transactionId === transactionId && !row.storeRef.return);

/**
 * The rows after a return: without the withdrawal's row while no invoice basis has taken it, otherwise with a negative
 * return row added. Nothing changes when the order has no row for the withdrawal (one drawn before rows were written).
 */
export function rowsAfterReturn(rows: readonly MaterialRow[], input: { withdrawalId: string; billed: boolean; returnRow: (withdrawal: MaterialRow) => MaterialRow }): MaterialRow[] {
  const row = storeRowOf(rows, input.withdrawalId);
  if (!row) return [...rows];
  return input.billed ? [...rows, input.returnRow(row)] : rows.filter((item) => item.id !== row.id);
}

/** Store rows never count in a work order's own material for the machine's cost: the store's withdrawals already do. */
export const withoutStoreRows = <T extends Pick<MaterialRow, "storeRef">>(rows: readonly T[]): T[] => rows.filter((row) => !row?.storeRef);
