import { z } from "zod";
import type { ListSortKey } from "@/lib/list-filter";
import type { CatalogueSnapshot } from "@/lib/catalogue/snapshot";
import { cleanRowWholesale, readRowWholesale, rowWholesaleSchema, WHOLESALERS, type RowWholesale } from "@/lib/wholesale/model";
import { formatPrice, parseAmount } from "@/lib/workflow/expenses";
import { purchaseRefSchema, readPurchaseRef, type PurchaseRef } from "@/lib/purchases/ref";
import { productInfoSchema, readProductInfo, type ProductInfo } from "@/lib/catalogue/product-info";
import { parsePercent, roundOre } from "@/lib/workflow/material-prices";
import type { QuoteCustomerLinkView, QuoteCustomerResponseView } from "./customer-link";

/**
 * Offert (2026-10-09, steg B, docs/proposals/material-pris-offert-2026-10-09.md): the company's quote to its
 * customer as a document of its own. Pure rules shared by the server, the page and the tests:
 * - lines of kind Material, Arbete (hours × hourly rate) and Övrigt, each with benämning, antal, enhet, à-pris and påslag;
 * - a line's amount = antal × à-pris × (1 + påslag), whole öre; the quote's sum excl. VAT is the sum of the lines, the
 *   VAT is shown separately (25 % by default, editable per quote) and the sum to pay includes it;
 * - steg C + moms/ROT (2026-10-09): a quote is for a company or a private person; a private person's quote may
 *   carry a ROT deduction on the lines marked as labour – share × labour cost incl. VAT, at most the cap – with the
 *   share and cap the company entered (its own figures, never assumed by Workflow). RUT is not handled. An accepted
 *   quote is changed only by an ÄTA: a new version naming the accepted one, shown with its changes (`quoteVersionDiff`);
 * - status Utkast → Skickad → Accepterad / Avböjd / Utgången. A quote is sent only when every line has a price and a
 *   valid-until date that has not passed; once sent it is locked, and a change is made as a new version with the same
 *   number. A sent quote whose date has passed reads as Utgången.
 */
export const QUOTE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_LINE_KINDS = ["MATERIAL", "LABOUR", "OTHER"] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = { DRAFT: "Utkast", SENT: "Skickad", ACCEPTED: "Accepterad", DECLINED: "Avböjd", EXPIRED: "Utgången" };
export const QUOTE_LINE_KIND_LABELS: Record<QuoteLineKind, string> = { MATERIAL: "Material", LABOUR: "Arbete", OTHER: "Övrigt" };
/** The unit a new line of the kind starts with. */
export const QUOTE_LINE_DEFAULT_UNIT: Record<QuoteLineKind, string> = { MATERIAL: "st", LABOUR: "h", OTHER: "st" };

/** Swedish VAT on a quote by default; editable per quote and stored on it, so a sent quote never changes. */
export const QUOTE_VAT_PERCENT = 25;

export const QUOTE_CUSTOMER_TYPES = ["COMPANY", "PRIVATE"] as const;
export type QuoteCustomerType = (typeof QUOTE_CUSTOMER_TYPES)[number];
export const QUOTE_CUSTOMER_TYPE_LABELS: Record<QuoteCustomerType, string> = { COMPANY: "Företag", PRIVATE: "Privatperson" };

/** A percentage 0–100 (VAT rate, ROT share) as typed ("25", "12,5 %") or stored; null when empty or out of range. */
export function parseShare(value: string | number | null | undefined): number | null {
  const parsed = typeof value === "number" ? (Number.isFinite(value) ? value : null) : parseAmount((value ?? "").replace("%", ""));
  return parsed === null || parsed < 0 || parsed > 100 ? null : parsed;
}
/** An amount in kronor ≥ 0 (the ROT cap); null when empty or not a number. */
export function parseKronor(value: string | number | null | undefined): number | null {
  const parsed = typeof value === "number" ? (Number.isFinite(value) ? value : null) : parseAmount(value ?? "");
  return parsed === null || parsed < 0 || parsed >= 1e9 ? null : parsed;
}

/** ROT on a quote: the share (%) of the labour cost incl. VAT and the cap (kr), both entered by the company. */
export type QuoteRot = { percent: number; cap: number };
/** The quote's ROT, or null: only a private person's quote with ROT switched on and a readable share and cap. */
export function quoteRotOf(quote: { customerType: QuoteCustomerType; rotEnabled: boolean; rotPercent: string | number | null | undefined; rotCap: string | number | null | undefined }): QuoteRot | null {
  if (quote.customerType !== "PRIVATE" || !quote.rotEnabled) return null;
  const percent = parseShare(quote.rotPercent);
  const cap = parseKronor(quote.rotCap);
  return percent === null || cap === null ? null : { percent, cap };
}

/** The ROT deduction: share × labour cost incl. VAT, whole öre, never above the cap and never negative. */
export function rotDeduction(labourInclVat: number, rot: QuoteRot | null): number {
  if (!rot || !(labourInclVat > 0)) return 0;
  return roundOre(Math.max(0, Math.min(rot.cap, labourInclVat * rot.percent / 100)));
}
export const QUOTE_MAX_LINES = 300;
/** The list is read 20 at a time ("Visa fler"). */
export const QUOTE_PAGE_SIZE = 20;

/** "O-0012", and "O-0012 v2" from the second version. */
export const quoteNumberText = (number: number) => `O-${String(Math.max(0, Math.trunc(number))).padStart(4, "0")}`;
export const quoteLabel = (quote: { number: number; version: number }) => `${quoteNumberText(quote.number)}${quote.version > 1 ? ` v${quote.version}` : ""}`;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange datumet som ÅÅÅÅ-MM-DD.");
const id = z.string().trim().min(1).max(100);
export const quoteCatalogueSchema = z.object({
  articleId: z.string().trim().max(100).default(""), supplierName: z.string().trim().max(200).default(""), supplierArticleNo: z.string().trim().max(60).default(""),
  eNumber: z.string().trim().max(20).default(""), unitPrice: z.string().trim().max(40).default(""), unit: z.string().trim().max(40).default(""),
  source: z.string().trim().max(200).default(""), priceDate: day, confirmedDate: day.optional(), importId: z.string().trim().max(100).optional(),
  manufacturerArticleNo: z.string().trim().max(60).optional(),
  priceKind: z.literal("BASE").optional(),
  wholesaler: z.enum(WHOLESALERS).optional(),
  // Rabattbrev (2026-10-14): the base price and the discount, or an agreed net price, copied with the price.
  rebate: z.object({ basePrice: z.string().trim().max(40), percent: z.string().trim().max(12).optional(), fixedNet: z.literal(true).optional() }).optional(),
});

/**
 * Artikelnummer on a line (2026-10-11): the number the row shows – from the picked article or typed by hand –
 * and, for a picked one, its supplier and the manufacturer's number. No schema change: it is kept in the line's existing
 * `catalogue` JSON next to the price copy (`{ ...copy, articleNo, articleSource }`), or alone (`{ articleNo }`) for a
 * line without a price copy. Lines saved before this have no `articleNo` key and show the copy's own number.
 */
export type LineArticle = { articleNo?: string; articleSource?: string; manufacturerArticleNo?: string; /** Grossistexport (2026-10-12): see lib/wholesale/model.ts. */ wholesale?: RowWholesale;
  /** Inköp (2026-10-16): the purchase the line came from, in the same JSON (lib/purchases/ref.ts). */ purchaseRef?: PurchaseRef;
  /** Produktens uppgifter (2026-10-16), in the same JSON (lib/catalogue/product-info.ts). */ product?: ProductInfo;
  /**
   * Omvänd byggmoms (2026-11-01): set on every line of a quote with reverse VAT, in the same JSON (the quote has no
   * JSON of its own), so a new version and a sent quote carry it with their lines. `quoteReverseVatOf` reads it.
   */
  reverseVat?: { buyerVatNumber: string } };

/** The quote's reverse VAT, or null. */
export function quoteReverseVatOf(lines: readonly { reverseVat?: { buyerVatNumber: string } }[]): { buyerVatNumber: string } | null {
  return lines.find((line) => line.reverseVat)?.reverseVat ?? null;
}
/** The document's words about reverse VAT. The person chooses it; Workflow only states it. */
export const REVERSE_VAT_LABEL = "Omvänd betalningsskyldighet";
export const REVERSE_VAT_TEXT = "Omvänd betalningsskyldighet för moms gäller. Köparen redovisar momsen.";

/** What is stored in a line's `catalogue` column: the price copy and/or the article number; null when the line has neither. */
export function lineCatalogueJson(line: { catalogue?: CatalogueSnapshot | null } & LineArticle): Record<string, unknown> | null {
  const articleNo = (line.articleNo ?? "").trim().slice(0, 60);
  const source = (line.articleSource ?? "").trim().slice(0, 200);
  const manufacturer = (line.manufacturerArticleNo ?? "").trim().slice(0, 60);
  const wholesale = cleanRowWholesale(line.wholesale);
  const purchaseRef = line.purchaseRef ? readPurchaseRef(line.purchaseRef) : undefined;
  const product = line.product ? readProductInfo(line.product) : null;
  const extra = { ...(wholesale ? { wholesale } : {}), ...(purchaseRef ? { purchaseRef } : {}), ...(product ? { product } : {}), ...(line.reverseVat ? { reverseVat: { buyerVatNumber: line.reverseVat.buyerVatNumber.trim().slice(0, 40) } } : {}) };
  if (line.catalogue) return { ...line.catalogue, articleNo, ...(source ? { articleSource: source } : {}), ...(manufacturer && !line.catalogue.manufacturerArticleNo ? { manufacturerArticleNo: manufacturer } : {}), ...extra };
  if (!articleNo && !wholesale && !purchaseRef && !product && !line.reverseVat) return null;
  return { articleNo, ...(source ? { articleSource: source } : {}), ...(manufacturer ? { manufacturerArticleNo: manufacturer } : {}), ...extra };
}

/** The price copy and the article number of a stored `catalogue` value (anything unreadable is left out). */
export function readLineCatalogue(value: unknown): { catalogue?: CatalogueSnapshot } & LineArticle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const parsed = quoteCatalogueSchema.safeParse(raw);
  const catalogue = parsed.success ? parsed.data as CatalogueSnapshot : undefined;
  const text = (key: string, max: number) => typeof raw[key] === "string" ? (raw[key] as string).trim().slice(0, max) : undefined;
  const stored = text("articleNo", 60);
  const articleNo = stored ?? (catalogue ? (catalogue.supplierArticleNo || (catalogue.eNumber ? `E ${catalogue.eNumber}` : "")).slice(0, 60) : "");
  const articleSource = text("articleSource", 200) ?? (catalogue && articleNo ? catalogue.supplierName : "");
  const manufacturerArticleNo = text("manufacturerArticleNo", 60) ?? catalogue?.manufacturerArticleNo;
  const wholesale = readRowWholesale(raw.wholesale);
  const purchaseRef = readPurchaseRef(raw.purchaseRef);
  const product = readProductInfo(raw.product);
  const reverse = raw.reverseVat && typeof raw.reverseVat === "object" ? raw.reverseVat as { buyerVatNumber?: unknown } : null;
  return { ...(reverse ? { reverseVat: { buyerVatNumber: typeof reverse.buyerVatNumber === "string" ? reverse.buyerVatNumber.slice(0, 40) : "" } } : {}), ...(product ? { product } : {}), ...(purchaseRef ? { purchaseRef } : {}), ...(catalogue ? { catalogue } : {}), ...(articleNo ? { articleNo } : {}), ...(articleSource && articleNo ? { articleSource } : {}), ...(manufacturerArticleNo ? { manufacturerArticleNo } : {}), ...(wholesale ? { wholesale } : {}) };
}

/**
 * What is wrong with an antal, or null (2026-10-18, decision 1): a number above 0; 0 and negative numbers are refused
 * with their own text, so the row can be pointed out. Shared by the page (live) and the schemas (the server decides again).
 */
export function quantityProblem(value: string): string | null {
  const parsed = parseAmount(value);
  if (parsed === null || parsed >= 1e9) return "Antal måste vara ett tal, till exempel 12 eller 2,5.";
  return parsed <= 0 ? "Antal ska vara större än 0." : null;
}

/** A line as the page sends it: numbers as the person typed them ("12,5"). */
export const quoteLineInputSchema = z.object({
  id: id.optional(),
  kind: z.enum(QUOTE_LINE_KINDS),
  name: z.string().trim().min(1, "Skriv en benämning på varje rad.").max(300),
  quantity: z.string().trim().max(40).superRefine((value, ctx) => { const problem = quantityProblem(value); if (problem) ctx.addIssue({ code: "custom", message: problem }); }),
  unit: z.string().trim().max(40).default(""),
  unitPrice: z.string().trim().max(40).default("").refine((value) => { const parsed = parseAmount(value); return !value || (parsed !== null && parsed >= 0 && parsed < 1e9); }, "À-pris måste vara ett belopp i kronor."),
  markupPercent: z.string().trim().max(20).default("").refine((value) => !value || parsePercent(value) !== null, "Påslag skrivs i procent, mellan -100 och 1000."),
  catalogue: quoteCatalogueSchema.optional(),
  /** Artikelnummer (2026-10-11): from the picked article or typed by hand; kept inside the line's `catalogue` JSON. */
  articleNo: z.string().trim().max(60).default(""),
  articleSource: z.string().trim().max(200).default(""),
  manufacturerArticleNo: z.string().trim().max(60).default(""),
  /** Grossistexport (2026-10-12): the number to order with at a wholesaler and the order unit conversion; kept in the line's `catalogue` JSON. */
  wholesale: rowWholesaleSchema.optional(),
  /** Inköp (2026-10-16): the purchase the line came from; kept in the line's `catalogue` JSON. */
  purchaseRef: purchaseRefSchema.optional(),
  /** Produktens uppgifter (2026-10-16); kept in the line's `catalogue` JSON. */
  product: productInfoSchema.optional(),
  /** ROT: the line is labour cost in the ROT basis (used only on a private person's quote with ROT). */
  rotLabour: z.boolean().default(false),
});
export type QuoteLineInput = z.input<typeof quoteLineInputSchema>;

export const quoteInputSchema = z.object({
  title: z.string().trim().min(1, "Skriv en rubrik för offerten.").max(200),
  description: z.string().trim().max(5000).default(""),
  customerId: id.nullable().default(null),
  facilityId: id.nullable().default(null),
  projectId: id.nullable().default(null),
  validUntil: z.union([z.literal(""), day]).default(""),
  terms: z.string().trim().max(5000).default(""),
  customerType: z.enum(QUOTE_CUSTOMER_TYPES).default("COMPANY"),
  vatPercent: z.string().trim().max(20).default(String(QUOTE_VAT_PERCENT)).refine((value) => parseShare(value) !== null, "Momssatsen skrivs i procent, mellan 0 och 100."),
  rotEnabled: z.boolean().default(false),
  rotPercent: z.string().trim().max(20).default(""),
  rotCap: z.string().trim().max(20).default(""),
  /** Omvänd byggmoms (2026-11-01): the person chooses it for a company customer; the quote then has no VAT of its own. */
  reverseVat: z.boolean().default(false),
  buyerVatNumber: z.string().trim().max(40).default(""),
  lines: z.array(quoteLineInputSchema).max(QUOTE_MAX_LINES, `En offert har högst ${QUOTE_MAX_LINES} rader.`).default([]),
}).superRefine((value, context) => {
  if (value.reverseVat && value.customerType !== "COMPANY") context.addIssue({ code: "custom", path: ["reverseVat"], message: "Omvänd moms gäller bara offerter till företag." });
  // The choice is stored on the lines (LineArticle.reverseVat): a quote without lines could not keep it, and would read as 0 % VAT with no reason given.
  if (value.reverseVat && !value.lines.length) context.addIssue({ code: "custom", path: ["reverseVat"], message: "Lägg till minst en rad innan du väljer omvänd byggmoms." });
  // ROT only for a private person, and then with a readable share and cap (the company's own figures).
  if (!value.rotEnabled) return;
  if (value.customerType !== "PRIVATE") context.addIssue({ code: "custom", path: ["rotEnabled"], message: "ROT-avdrag gäller bara offerter till privatpersoner." });
  if (parseShare(value.rotPercent) === null) context.addIssue({ code: "custom", path: ["rotPercent"], message: "Skriv ROT-andelen i procent, mellan 0 och 100." });
  if (parseKronor(value.rotCap) === null) context.addIssue({ code: "custom", path: ["rotCap"], message: "Skriv taket för ROT-avdraget i kronor." });
});
export type QuoteInput = z.output<typeof quoteInputSchema>;

/** A line's numbers: the amount at the selling price, and the purchase amount for the company's own eyes. */
export type QuoteLineNumbers = { quantity: number | null; unitPrice: number | null; markup: number | null; saleUnitPrice: number | null; amount: number | null; purchase: number | null };

/** antal × à-pris × (1 + påslag), whole öre; null without a price. Works on typed text or on stored numbers. */
export function quoteLineNumbers(line: { quantity: string | number; unitPrice: string | number | null | undefined; markupPercent?: string | number | null }): QuoteLineNumbers {
  const read = (value: string | number | null | undefined) => typeof value === "number" ? (Number.isFinite(value) ? value : null) : parseAmount(value ?? "");
  const quantity = read(line.quantity);
  const unitPrice = read(line.unitPrice);
  const markup = typeof line.markupPercent === "number" ? line.markupPercent : parsePercent(line.markupPercent ?? "");
  const factor = 1 + (markup ?? 0) / 100;
  const saleUnitPrice = unitPrice === null ? null : roundOre(unitPrice * factor);
  if (quantity === null || unitPrice === null) return { quantity, unitPrice, markup, saleUnitPrice, amount: null, purchase: null };
  return { quantity, unitPrice, markup, saleUnitPrice, amount: roundOre(Math.max(quantity, 0) * unitPrice * factor), purchase: roundOre(Math.max(quantity, 0) * unitPrice) };
}

export type QuoteTotals = {
  /** Per kind, at the selling price excl. VAT. */
  byKind: Record<QuoteLineKind, number>;
  /** Summa exkl. moms: the sum of the lines' rounded amounts. */
  net: number;
  vatPercent: number;
  /** Moms on the sum, whole öre. */
  vat: number;
  /** Att betala inkl. moms. */
  gross: number;
  /**
   * The company's own figures: the material's purchase price (antal × à-pris of the material lines – simulation 0.6.3:
   * "Inköp" also counted the hours of work) and the markup in kronor (what the lines' påslag adds, on every kind).
   */
  purchase: number;
  margin: number;
  /** Lines without a readable price (counted, never as 0 kr in silence). */
  unpriced: number;
  /** ROT (only with `rot`): the marked labour lines excl. VAT, the same incl. VAT, the deduction and whether the cap applied. */
  rotBase: number;
  rotBaseInclVat: number;
  rot: number;
  rotCapped: boolean;
  /** Att betala: incl. VAT, after the ROT deduction when there is one. */
  toPay: number;
};

type TotalsLine = { kind: QuoteLineKind; quantity: string | number; unitPrice: string | number | null | undefined; markupPercent?: string | number | null; rotLabour?: boolean };

/**
 * The quote's sums. Every line's amount is rounded to whole öre first and the sums add the rounded amounts; VAT is
 * computed on the sum excl. VAT. With `rot` the deduction is share × (marked labour lines incl. VAT), at most the cap.
 */
export function quoteTotals(lines: readonly TotalsLine[], vatPercent = QUOTE_VAT_PERCENT, rot: QuoteRot | null = null): QuoteTotals {
  const byKind: Record<QuoteLineKind, number> = { MATERIAL: 0, LABOUR: 0, OTHER: 0 };
  let net = 0, purchase = 0, margin = 0, unpriced = 0, rotBase = 0;
  for (const line of lines) {
    const numbers = quoteLineNumbers(line);
    if (numbers.amount === null || numbers.purchase === null) { unpriced += 1; continue; }
    byKind[line.kind] = roundOre(byKind[line.kind] + numbers.amount);
    net += numbers.amount;
    if (line.kind === "MATERIAL") purchase += numbers.purchase;
    margin += numbers.amount - numbers.purchase;
    if (line.rotLabour) rotBase += numbers.amount;
  }
  net = roundOre(net);
  purchase = roundOre(purchase);
  margin = roundOre(margin);
  const vat = roundOre(net * vatPercent / 100);
  const gross = roundOre(net + vat);
  rotBase = rot ? roundOre(rotBase) : 0;
  const rotBaseInclVat = rot ? roundOre(rotBase * (1 + vatPercent / 100)) : 0;
  const deduction = rotDeduction(rotBaseInclVat, rot);
  const rotCapped = Boolean(rot && rotBaseInclVat * rot.percent / 100 > rot.cap);
  return { byKind, net, vatPercent, vat, gross, purchase, margin, unpriced, rotBase, rotBaseInclVat, rot: deduction, rotCapped, toPay: roundOre(gross - deduction) };
}

export type QuoteDiffLine = {
  kind: QuoteLineKind; name: string; unit: string;
  change: "added" | "removed" | "changed";
  /** Antal and amount (selling price, excl. VAT) before and after; null on the side where the line does not exist. */
  before: { quantity: number; amount: number | null } | null;
  after: { quantity: number; amount: number | null } | null;
  /** after − before in kr excl. VAT (a missing price counts as 0 here). */
  amountDelta: number;
};
export type QuoteVersionDiff = { lines: QuoteDiffLine[]; netBefore: number; netAfter: number; netDelta: number };

const tidyText = (text: string) => text.replace(/\s+/g, " ").trim();
const diffKey = (line: { kind: string; name: string; unit: string }) => `${line.kind}\u0000${tidyText(line.name).toLocaleLowerCase("sv-SE")}\u0000${tidyText(line.unit).toLocaleLowerCase("sv-SE")}`;

/**
 * ÄTA: what a version changes compared with an earlier one. Lines are matched on kind, benämning and enhet (case and
 * spacing ignored; several lines with the same key are summed). Unchanged lines are left out. Amounts are the selling
 * amounts excl. VAT, whole öre.
 */
export function quoteVersionDiff(before: readonly (TotalsLine & { name: string; unit: string })[], after: readonly (TotalsLine & { name: string; unit: string })[]): QuoteVersionDiff {
  type Acc = { kind: QuoteLineKind; name: string; unit: string; quantity: number; amount: number | null };
  const collect = (lines: readonly (TotalsLine & { name: string; unit: string })[]) => {
    const map = new Map<string, Acc>();
    for (const line of lines) {
      const numbers = quoteLineNumbers(line);
      const key = diffKey(line);
      const acc = map.get(key) ?? { kind: line.kind, name: tidyText(line.name), unit: tidyText(line.unit), quantity: 0, amount: 0 };
      acc.quantity = Math.round((acc.quantity + (numbers.quantity ?? 0)) * 10000) / 10000;
      acc.amount = acc.amount === null || numbers.amount === null ? null : roundOre(acc.amount + numbers.amount);
      map.set(key, acc);
    }
    return map;
  };
  const was = collect(before), now = collect(after);
  const lines: QuoteDiffLine[] = [];
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(key), b = now.get(key);
    const side = (acc: Acc | undefined) => acc ? { quantity: acc.quantity, amount: acc.amount } : null;
    const amountDelta = roundOre((b?.amount ?? 0) - (a?.amount ?? 0));
    if (a && b && a.quantity === b.quantity && a.amount === b.amount) continue;
    const head = b ?? a!;
    lines.push({ kind: head.kind, name: head.name, unit: head.unit, change: !a ? "added" : !b ? "removed" : "changed", before: side(a), after: side(b), amountDelta });
  }
  lines.sort((x, y) => QUOTE_LINE_KINDS.indexOf(x.kind) - QUOTE_LINE_KINDS.indexOf(y.kind) || x.name.localeCompare(y.name, "sv-SE", { sensitivity: "base" }));
  const netBefore = quoteTotals(before).net, netAfter = quoteTotals(after).net;
  return { lines, netBefore, netAfter, netDelta: roundOre(netAfter - netBefore) };
}

/**
 * What an ÄTA changes the amount by, VAT included: the difference between the two versions' totals, each rounded as a
 * quote's total is. Under reverse charge no VAT is added, so `vatPercent` is 0 there.
 */
export function quoteChangeWithVat(change: Pick<QuoteVersionDiff, "netBefore" | "netAfter">, vatPercent: number) {
  const gross = (net: number) => roundOre(net + roundOre(net * vatPercent / 100));
  return roundOre(gross(change.netAfter) - gross(change.netBefore));
}

/** The status a person reads: a sent quote whose valid-until date has passed is Utgången. */
export function effectiveQuoteStatus(quote: { status: QuoteStatus; validUntil: string }, today: string): QuoteStatus {
  return quote.status === "SENT" && quote.validUntil && quote.validUntil < today ? "EXPIRED" : quote.status;
}

export const QUOTE_ACTIONS = ["edit", "send", "accept", "decline", "expire", "new_version", "delete"] as const;
export type QuoteAction = (typeof QUOTE_ACTIONS)[number];

type QuoteState = { status: QuoteStatus; validUntil: string; superseded?: boolean };
/**
 * What may be done with a quote now. A draft is written, sent or deleted. A sent quote is answered (accepted, declined,
 * marked as expired) or changed as a new version – an expired one only gets a new version. A declined or expired quote
 * may get a new version. An accepted one is the agreement: it is changed only by an ÄTA (ändrings- och tilläggsarbete),
 * a new version that names it and is sent and answered like any version (steg C). An older version, replaced by a newer,
 * is read only.
 */
export function quoteActions(quote: QuoteState, today: string): QuoteAction[] {
  if (quote.superseded) return [];
  const status = effectiveQuoteStatus(quote, today);
  if (quote.status === "DRAFT") return ["edit", "send", "delete"];
  if (quote.status === "SENT") return status === "EXPIRED" ? ["expire", "decline", "new_version"] : ["accept", "decline", "expire", "new_version"];
  if (quote.status === "DECLINED" || quote.status === "EXPIRED" || quote.status === "ACCEPTED") return ["new_version"];
  return [];
}

/** Why a status change cannot be made now, in the person's words; "" when it can. */
export function quoteActionError(quote: QuoteState, action: QuoteAction, today: string): string {
  if (quoteActions(quote, today).includes(action)) return "";
  if (quote.superseded) return "Det finns en nyare version av offerten. Öppna den senaste versionen.";
  if (action === "edit" || action === "delete") return quote.status === "DRAFT" ? "Offerten kan inte ändras just nu." : "Offerten är skickad och låst. Gör en ny version för att ändra den.";
  if (action === "accept" && quote.status === "SENT") return "Offerten har gått ut. Gör en ny version med nytt giltighetsdatum.";
  if (action === "send") return "Offerten är redan skickad.";
  if (action === "new_version") return "Ett utkast ändras direkt, utan ny version.";
  return `Offerten är ${QUOTE_STATUS_LABELS[effectiveQuoteStatus(quote, today)].toLowerCase()} och kan inte ändras så.`;
}

/** What is missing before a draft can be sent: at least one line, a price on every line and a valid-until date ahead. */
export function quoteSendIssues(quote: { lines: readonly TotalsLine[]; validUntil: string; vatPercent?: string | number; customerType?: QuoteCustomerType; rotEnabled?: boolean; rotPercent?: string | number | null; rotCap?: string | number | null }, today: string): string[] {
  const issues: string[] = [];
  if (!quote.lines.length) issues.push("Lägg till minst en rad.");
  const unpriced = quoteTotals(quote.lines).unpriced;
  if (unpriced) issues.push(`${unpriced} ${unpriced === 1 ? "rad saknar" : "rader saknar"} à-pris.`);
  if (!quote.validUntil) issues.push("Ange hur länge offerten gäller (Giltig till).");
  else if (quote.validUntil < today) issues.push("Giltig till har redan passerat.");
  if (quote.vatPercent !== undefined && parseShare(quote.vatPercent) === null) issues.push("Ange momssatsen i procent.");
  if (quote.rotEnabled && quote.customerType === "PRIVATE" && !quoteRotOf({ customerType: quote.customerType, rotEnabled: true, rotPercent: quote.rotPercent, rotCap: quote.rotCap })) issues.push("Ange ROT-andel och tak.");
  if (quote.rotEnabled && quote.customerType === "PRIVATE" && !quote.lines.some((line) => line.rotLabour)) issues.push("Markera vilka rader som är arbete för ROT.");
  return issues;
}

/** A line as the page edits it: text fields, as on a material row. */
export type QuoteLineView = { id: string; kind: QuoteLineKind; name: string; quantity: string; unit: string; unitPrice: string; markupPercent: string; catalogue?: CatalogueSnapshot; rotLabour?: boolean } & LineArticle;
/** Numbers from the database (Decimal or number) as text with decimal comma; "" for none. */
export const numberText = (value: { toString(): string } | number | null | undefined) => value === null || value === undefined ? "" : formatPrice(Number(value.toString()));

export type QuoteListItem = {
  id: string; number: number; version: number; label: string; title: string; status: QuoteStatus; validUntil: string;
  customerName: string; projectName: string; net: number; unpriced: number; updatedAt: string;
  /** The sum incl. VAT (before any ROT), shown at level 1 on a phone. */
  gross?: number;
  /** ÄTA: the accepted version this version changes. */
  changeOfVersion?: number | null;
};

export type QuoteView = {
  id: string; number: number; version: number; label: string; revision: number;
  title: string; description: string; status: QuoteStatus; storedStatus: QuoteStatus; validUntil: string; terms: string; vatPercent: number;
  /** Steg C + moms/ROT: customer type, ROT as entered (null = none), and for an ÄTA the accepted version it changes with the changes. */
  customerType: QuoteCustomerType; rotEnabled: boolean; rotPercent: number | null; rotCap: number | null;
  /** Omvänd byggmoms (2026-11-01): read from the lines. */
  reverseVat?: boolean; buyerVatNumber?: string;
  changeOfVersion: number | null; change: QuoteVersionDiff | null;
  /** ÄTA: the accepted version’s lines, so the page shows the changes while they are written. */
  changeBase?: QuoteLineView[];
  /** The latest work order made from this accepted quote (only when the caller may read work orders). */
  workOrder: { id: string; title: string } | null;
  /** Every work order made from the quote (plan 1D, 2026-10-11), newest first; empty without Arbetsorder – läsa. */
  workOrders: { id: string; title: string; status: string }[];
  /** Accepted, and the caller may create work orders. */
  canCreateWorkOrder: boolean;
  /** The customer's name, and (2026-10-10, for the PDF) its contact person and address – both may be empty. */
  customer: { id: string; name: string; contactName?: string; address?: string } | null; facility: { id: string; name: string; /** The place's address for the PDF, if it has one. */ address?: string } | null; project: { id: string; name: string } | null;
  lines: QuoteLineView[]; totals: QuoteTotals;
  sentAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; superseded: boolean;
  versions: { id: string; version: number; status: QuoteStatus }[];
  actions: QuoteAction[]; canEdit: boolean;
  /** Offert per e-post (steg E): the latest link sent to the customer, and the customer's answer through a link. */
  customerLink?: QuoteCustomerLinkView | null;
  customerResponse?: QuoteCustomerResponseView | null;
};

/** The list's status filter: open = drafts and sent quotes still valid. */
export const QUOTE_FILTERS = ["open", "all", ...QUOTE_STATUSES] as const;
export type QuoteFilter = (typeof QUOTE_FILTERS)[number];
export const QUOTE_FILTER_LABELS: Record<QuoteFilter, string> = { open: "Pågående", all: "Alla", ...QUOTE_STATUS_LABELS };
/**
 * The list's sort (toppvisningen, 2026-10-31): newest change first, nearest Giltig till (undated last), name, or the
 * newest number first. The first is the default.
 */
export const QUOTE_SORTS = ["updated", "due", "title", "number"] as const satisfies readonly ListSortKey[];
export type QuoteSort = (typeof QUOTE_SORTS)[number];

/** A place's address on one line, for the offer PDF. */
export const placeAddress = (place: { address: string; postalCode: string; city: string }) => [place.address, [place.postalCode, place.city].filter(Boolean).join(" ")].map((part) => part.trim()).filter(Boolean).join(", ");
