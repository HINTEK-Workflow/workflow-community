import { z } from "zod";
import type { ListSortKey } from "@/lib/list-filter";
import { formatPrice, parseAmount, type MaterialRow } from "@/lib/workflow/expenses";
import { roundOre } from "@/lib/workflow/material-prices";
import type { CatalogueSnapshot } from "@/lib/catalogue/snapshot";
import { quantityProblem, quoteCatalogueSchema, type LineArticle } from "@/lib/quotes/model";
import { rowWholesaleSchema } from "@/lib/wholesale/model";
import { productInfoSchema } from "@/lib/catalogue/product-info";

/**
 * Inköp (2026-10-16, docs/proposals/inkop-och-artiklar-2026-10-16.md): the company's list of articles from one or
 * more suppliers. While it is a draft it is the underlag (like a shopping cart) for a quote or a work order; once it is
 * marked ordered it is a purchase, and every line is ticked off when it has come. Pure rules shared by the server, the
 * pages and the tests:
 * - only purchase prices: the selling price and the markup belong to the quote ("försäljningspris … tillhör offerten");
 * - Utkast → Beställd (marked by hand after the order file went to the wholesaler) → Levererad when every line has come;
 *   Makulerad ends it. An ordered purchase's lines are locked except for the delivery tick;
 * - a quote line or a work order's material row made from a purchase keeps a `purchaseRef` (the purchase, its revision
 *   then, and the line – or "sum" for one line with the whole sum), so the document can say when the purchase changed.
 */
export const PURCHASE_STATUSES = ["DRAFT", "ORDERED", "DELIVERED", "CANCELLED"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = { DRAFT: "Utkast", ORDERED: "Beställd", DELIVERED: "Levererad", CANCELLED: "Makulerad" };
export const PURCHASE_FILTERS = ["open", "draft", "ordered", "delivered", "all"] as const;
export type PurchaseFilter = (typeof PURCHASE_FILTERS)[number];
export const PURCHASE_FILTER_LABELS: Record<PurchaseFilter, string> = { open: "Pågående", draft: "Utkast", ordered: "Beställda", delivered: "Levererade", all: "Alla" };
/** The list's sort (toppvisningen, 2026-10-31): newest change first, name, or the newest number first. */
export const PURCHASE_SORTS = ["updated", "title", "number"] as const satisfies readonly ListSortKey[];
export type PurchaseSort = (typeof PURCHASE_SORTS)[number];
export const PURCHASE_MAX_LINES = 300;
export const PURCHASE_PAGE_SIZE = 20;

/** "I-0007". */
export const purchaseNumberText = (number: number) => `I-${String(Math.max(0, Math.trunc(number))).padStart(4, "0")}`;

/** The document a line was picked on, so that document's later changes follow the line. */
export const PURCHASE_SOURCE_KINDS = ["quote", "work_order"] as const;
export type PurchaseSourceKind = (typeof PURCHASE_SOURCE_KINDS)[number];

export { purchaseRefSchema, readPurchaseRef, type PurchaseRef } from "./ref";
import type { PurchaseRef } from "./ref";

const amount = z.string().trim().max(40);
/** A line as the page sends it: numbers as typed ("12,5"). */
export const purchaseLineInputSchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1, "Skriv en benämning på varje rad.").max(300),
  quantity: amount.superRefine((value, ctx) => { const problem = quantityProblem(value); if (problem) ctx.addIssue({ code: "custom", message: problem }); }),
  unit: z.string().trim().max(40).default(""),
  unitPrice: amount.default("").refine((value) => { const parsed = parseAmount(value); return !value || (parsed !== null && parsed >= 0 && parsed < 1e9); }, "Inköpspris måste vara ett belopp i kronor."),
  catalogue: quoteCatalogueSchema.optional(),
  articleNo: z.string().trim().max(60).default(""),
  articleSource: z.string().trim().max(200).default(""),
  manufacturerArticleNo: z.string().trim().max(60).default(""),
  wholesale: rowWholesaleSchema.optional(),
  /** Produktens uppgifter (2026-10-16). */
  product: productInfoSchema.optional(),
  /** Picked by someone who may not see prices: the server copies the article's price (as on a work order). */
  pickedArticleId: z.string().trim().max(100).optional(),
  /** The supplier, typed for a line without a picked article; a picked one takes the article's supplier. */
  supplierName: z.string().trim().max(200).default(""),
});
export type PurchaseLineInput = z.input<typeof purchaseLineInputSchema>;

const optionalId = z.string().trim().min(1).max(100).nullable().default(null);
export const purchaseInputSchema = z.object({
  title: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(5000).default(""),
  projectId: optionalId,
  customerId: optionalId,
  workOrderId: optionalId,
  lines: z.array(purchaseLineInputSchema).max(PURCHASE_MAX_LINES, `Ett inköp har högst ${PURCHASE_MAX_LINES} rader.`).default([]),
});
export type PurchaseInput = z.output<typeof purchaseInputSchema>;

/** One line as the pages read it. `unitPrice` is "" for someone who may not see prices. */
export type PurchaseLineView = {
  id: string; name: string; quantity: string; unit: string; unitPrice: string; supplierName: string;
  catalogue?: CatalogueSnapshot; deliveredAt: string | null; sourceKind: PurchaseSourceKind | null; sourceId: string | null;
} & LineArticle;

export type PurchaseSupplierTotal = { supplierName: string; lines: number; amount: number };
export type PurchaseTotals = { lines: number; amount: number; unpriced: number; delivered: number; bySupplier: PurchaseSupplierTotal[] };

/** The supplier a line is grouped under: the picked article's, otherwise the one typed, otherwise "Utan leverantör". */
export const lineSupplier = (line: Pick<PurchaseLineView, "supplierName" | "catalogue">) => (line.catalogue?.supplierName || line.supplierName || "").trim() || "Utan leverantör";

/** antal × inköpspris, whole öre; null without a readable price. */
export function purchaseLineAmount(line: { quantity: string | number; unitPrice: string | number | null | undefined }): number | null {
  const read = (value: string | number | null | undefined) => typeof value === "number" ? (Number.isFinite(value) ? value : null) : parseAmount(value ?? "");
  const quantity = read(line.quantity), price = read(line.unitPrice);
  // A negative antal (typed, not yet saved: Spara refuses it) never gives a negative sum (R2-ART-04).
  return quantity === null || price === null ? null : roundOre(Math.max(quantity, 0) * price);
}

/** Sum per supplier and in all; unpriced lines are counted, never added as 0 kr in silence. */
export function purchaseTotals(lines: readonly Pick<PurchaseLineView, "quantity" | "unitPrice" | "supplierName" | "catalogue" | "deliveredAt">[]): PurchaseTotals {
  const bySupplier = new Map<string, PurchaseSupplierTotal>();
  let amount = 0, unpriced = 0, delivered = 0;
  for (const line of lines) {
    const supplierName = lineSupplier(line);
    const entry = bySupplier.get(supplierName) ?? { supplierName, lines: 0, amount: 0 };
    entry.lines += 1;
    const value = purchaseLineAmount(line);
    if (value === null) unpriced += 1; else { entry.amount = roundOre(entry.amount + value); amount = roundOre(amount + value); }
    if (line.deliveredAt) delivered += 1;
    bySupplier.set(supplierName, entry);
  }
  return { lines: lines.length, amount, unpriced, delivered, bySupplier: [...bySupplier.values()].sort((a, b) => b.amount - a.amount || a.supplierName.localeCompare(b.supplierName, "sv")) };
}

/** The status after a delivery tick: Levererad when every line has come, Beställd again when one is unticked. */
export function statusAfterDelivery(status: PurchaseStatus, lines: readonly { deliveredAt: string | Date | null }[]): PurchaseStatus {
  if (status !== "ORDERED" && status !== "DELIVERED") return status;
  return lines.length > 0 && lines.every((line) => Boolean(line.deliveredAt)) ? "DELIVERED" : "ORDERED";
}

export type PurchaseAction = "order" | "reopen" | "cancel" | "delete";
/** What may be done with a purchase in its status (the server checks the same). */
export function purchaseActions(status: PurchaseStatus, lineCount: number): PurchaseAction[] {
  if (status === "DRAFT") return [...(lineCount > 0 ? ["order" as const] : []), "cancel", "delete"];
  if (status === "ORDERED") return ["reopen", "cancel"];
  if (status === "CANCELLED") return ["reopen"];
  return [];
}
export const purchaseEditable = (status: PurchaseStatus) => status === "DRAFT";

export type PurchaseView = {
  id: string; number: number; label: string; title: string; notes: string; status: PurchaseStatus; revision: number;
  project: { id: string; name: string } | null; customer: { id: string; name: string } | null; workOrder: { id: string; title: string } | null;
  orderedAt: string | null; deliveredAt: string | null; createdAt: string; updatedAt: string; createdByName: string;
  lines: PurchaseLineView[]; totals: PurchaseTotals; canEdit: boolean; pricesHidden: boolean; actions: PurchaseAction[];
};
export type PurchaseListItem = {
  id: string; label: string; title: string; status: PurchaseStatus; suppliers: string[]; lines: number; delivered: number; amount: number | null;
  project: { id: string; name: string } | null; workOrder: { id: string; title: string } | null; updatedAt: string; mine: boolean;
};

/** The purchase's name in lists and on documents: its title, or "Inköp I-0007". */
export const purchaseName = (purchase: { title: string; label: string }) => purchase.title.trim() || `Inköp ${purchase.label}`;

// ---------- from a purchase to a quote and a work order ----------

/** A quote line as the quote editor keeps it (the subset made here). */
export type QuoteLineFromPurchase = {
  kind: "MATERIAL"; name: string; quantity: string; unit: string; unitPrice: string; markupPercent: string;
  catalogue?: CatalogueSnapshot; articleNo?: string; articleSource?: string; manufacturerArticleNo?: string; wholesale?: LineArticle["wholesale"]; product?: LineArticle["product"]; purchaseRef: PurchaseRef;
};

const refOf = (purchase: Pick<PurchaseView, "id" | "label" | "revision">, extra: Partial<PurchaseRef>): PurchaseRef => ({ purchaseId: purchase.id, label: purchase.label, revision: purchase.revision, ...extra });

/**
 * Som rader: one material line per purchase line, with the purchase price as à-pris and the company's material markup
 * (the quote owns the selling price). The markup a line already had for the same purchase line is kept (`keep`).
 */
export function quoteLinesFromPurchase(purchase: Pick<PurchaseView, "id" | "label" | "revision" | "lines">, companyMarkup: string, keep: ReadonlyMap<string, string> = new Map()): QuoteLineFromPurchase[] {
  return purchase.lines.map((line) => ({
    kind: "MATERIAL", name: line.name, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, markupPercent: keep.get(line.id) ?? companyMarkup,
    ...(line.catalogue ? { catalogue: line.catalogue } : {}), ...(line.articleNo ? { articleNo: line.articleNo } : {}), ...(line.articleSource ? { articleSource: line.articleSource } : {}),
    ...(line.manufacturerArticleNo ? { manufacturerArticleNo: line.manufacturerArticleNo } : {}), ...(line.wholesale ? { wholesale: line.wholesale } : {}), ...(line.product ? { product: line.product } : {}),
    purchaseRef: refOf(purchase, { lineId: line.id }),
  }));
}

/** The default name of the one line that carries a purchase's whole sum; the customer sees only this and the amount. */
export const PURCHASE_SUM_LINE_NAME = "Material";

/** Som en summa: one material line, antal 1, à-pris = the purchase sum, the company's material markup (both editable). */
export function quoteSumLineFromPurchase(purchase: Pick<PurchaseView, "id" | "label" | "revision" | "totals">, companyMarkup: string, name = PURCHASE_SUM_LINE_NAME): QuoteLineFromPurchase {
  return { kind: "MATERIAL", name, quantity: "1", unit: "st", unitPrice: formatPrice(purchase.totals.amount), markupPercent: companyMarkup, purchaseRef: refOf(purchase, { sum: true }) };
}

/**
 * Uppdatera offerten: the lines of the purchase replace the lines that came from it (at the place of the first one); a
 * sum line only gets the new sum as à-pris and keeps its name, antal and markup. Lines from other places are untouched.
 */
export function refreshQuoteLines<T extends { purchaseRef?: PurchaseRef; markupPercent?: string; name: string; unitPrice?: string; quantity: string }>(
  lines: readonly T[], purchase: Pick<PurchaseView, "id" | "label" | "revision" | "lines" | "totals">, companyMarkup: string, make: (line: QuoteLineFromPurchase) => T,
): T[] {
  const ofPurchase = (line: T) => line.purchaseRef?.purchaseId === purchase.id;
  const keep = new Map(lines.filter((line) => ofPurchase(line) && line.purchaseRef?.lineId && line.markupPercent !== undefined).map((line) => [line.purchaseRef!.lineId!, line.markupPercent!]));
  const result: T[] = [];
  let placed = false;
  for (const line of lines) {
    if (!ofPurchase(line)) { result.push(line); continue; }
    if (line.purchaseRef?.sum) { result.push({ ...line, unitPrice: formatPrice(purchase.totals.amount), purchaseRef: refOf(purchase, { sum: true }) }); continue; }
    if (placed) continue;
    placed = true;
    result.push(...quoteLinesFromPurchase(purchase, companyMarkup, keep).map(make));
  }
  return result;
}

/** The purchases a document's lines came from, with the revision each was taken at (the lowest when it differs). */
export function purchaseRefsOf(lines: readonly { purchaseRef?: PurchaseRef }[]): Map<string, number> {
  const refs = new Map<string, number>();
  for (const line of lines) {
    const ref = line.purchaseRef;
    if (!ref) continue;
    refs.set(ref.purchaseId, Math.min(refs.get(ref.purchaseId) ?? ref.revision, ref.revision));
  }
  return refs;
}

/** Lägg som material: the purchase lines a work order does not already have, as material rows with their price copy. */
export function materialRowsFromPurchase(purchase: Pick<PurchaseView, "id" | "label" | "revision" | "lines">, existing: readonly Pick<MaterialRow, "purchaseRef">[], newId: () => string, companyMarkup: string): MaterialRow[] {
  const have = new Set(existing.map((row) => row.purchaseRef?.purchaseId === purchase.id ? row.purchaseRef.lineId : undefined).filter(Boolean));
  return purchase.lines.filter((line) => !have.has(line.id)).map((line) => ({
    id: newId(), kind: "material", name: line.name, quantity: line.quantity, unit: line.unit,
    ...(line.unitPrice ? { unitPrice: line.unitPrice, markupPercent: companyMarkup } : {}),
    ...(line.catalogue ? { catalogue: line.catalogue } : {}), ...(line.articleNo ? { articleNo: line.articleNo } : {}), ...(line.articleSource ? { articleSource: line.articleSource } : {}),
    ...(line.manufacturerArticleNo ? { manufacturerArticleNo: line.manufacturerArticleNo } : {}), ...(line.wholesale ? { wholesale: line.wholesale } : {}), ...(line.product ? { product: line.product } : {}),
    purchaseRef: refOf(purchase, { lineId: line.id }),
  }));
}

/**
 * Skapa inköp på arbetsordern (2026-11-18): the material rows a purchase is made of, and what is left out.
 * Utgifter, rows taken from the store (they are already in the house), rows already in a purchase or taken from one, and
 * empty rows never go in; a free-text row goes in as a text line. A row whose antal is not a number above zero is left
 * out, since a purchase never guesses how many to order.
 */
export type WorkOrderPurchasePick<T> = { rows: T[]; leftOut: { store: number; purchased: number; noQuantity: number } };
export function workOrderPurchaseRows<T extends Pick<MaterialRow, "kind" | "name" | "quantity" | "storeRef" | "purchaseRef">>(rows: readonly T[]): WorkOrderPurchasePick<T> {
  const pick: WorkOrderPurchasePick<T> = { rows: [], leftOut: { store: 0, purchased: 0, noQuantity: 0 } };
  for (const row of rows) {
    if (row.kind === "expense" || !row.name.trim()) continue;
    if (row.storeRef) { pick.leftOut.store += 1; continue; }
    if (row.purchaseRef) { pick.leftOut.purchased += 1; continue; }
    const quantity = parseAmount(row.quantity);
    if (quantity === null || quantity <= 0) { pick.leftOut.noQuantity += 1; continue; }
    pick.rows.push(row);
  }
  return pick;
}

/** The new purchase's title: "Material – <the work order's title>", as the snabbval named it. */
export const workOrderPurchaseTitle = (title: string) => (title.trim() ? `Material – ${title.trim()}`.slice(0, 200) : "Material");

/** What Skapa inköp says afterwards: how many rows went to which purchase, and why the others did not. */
export function workOrderPurchaseMessage(result: { label: string; added: number; existing: boolean }, leftOut: WorkOrderPurchasePick<unknown>["leftOut"]) {
  const rows = (count: number) => `${count} ${count === 1 ? "rad" : "rader"}`;
  const head = !result.added ? (result.label ? `Alla rader finns redan i inköp ${result.label}.` : "Det finns inget material att köpa in.")
    : result.existing ? `${rows(result.added)} lades till i inköp ${result.label}.` : `Inköp ${result.label} är skapat med ${rows(result.added)}.`;
  const notes = [leftOut.store ? `${rows(leftOut.store)} från förrådet` : "", leftOut.noQuantity ? `${rows(leftOut.noQuantity)} utan antal` : ""].filter(Boolean);
  return notes.length ? `${head} ${notes.join(" och ").replace(/^./, (first) => first.toUpperCase())} togs inte med.` : head;
}

/** A line for the purchase from a row picked on a document (snabbvalet), as the purchase API takes it. */
export function purchaseLineFromRow(row: { name: string; quantity: string; unit: string; unitPrice?: string; catalogue?: CatalogueSnapshot; articleNo?: string; articleSource?: string; manufacturerArticleNo?: string; wholesale?: LineArticle["wholesale"]; product?: LineArticle["product"]; pickedArticleId?: string }): PurchaseLineInput {
  return {
    name: row.name.trim() || "Artikel", quantity: parseAmount(row.quantity) === null ? "1" : row.quantity, unit: row.unit, unitPrice: row.unitPrice ?? "",
    ...(row.catalogue ? { catalogue: row.catalogue } : {}), articleNo: row.articleNo ?? "", articleSource: row.articleSource ?? "", manufacturerArticleNo: row.manufacturerArticleNo ?? "",
    ...(row.wholesale ? { wholesale: row.wholesale } : {}), ...(row.product ? { product: row.product } : {}), ...(row.pickedArticleId ? { pickedArticleId: row.pickedArticleId } : {}),
  };
}
