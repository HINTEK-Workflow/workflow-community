import { z } from "zod";
import type { ListSortKey } from "@/lib/list-filter";
import { formatPrice, formatSek, isExpenseRow, parseAmount, rowAmount, type MaterialRow } from "@/lib/workflow/expenses";
import { formatDurationSeconds } from "@/lib/workflow/duration";
import { parsePercent } from "@/lib/workflow/material-prices";
import { parseKronor, parseShare, QUOTE_LINE_DEFAULT_UNIT, QUOTE_LINE_KINDS, QUOTE_VAT_PERCENT, quoteCatalogueSchema, quoteLineInputSchema, quoteRotOf, quoteTotals, type QuoteCustomerType, type QuoteLineKind, type QuoteRot, type QuoteTotals } from "@/lib/quotes/model";
import type { CatalogueSnapshot } from "@/lib/catalogue/snapshot";
import type { TimeBillingLookup } from "@/lib/workflow/time-types";

/**
 * Fakturaunderlag från utfört arbete (2026-10-10, docs/kartlaggning-2026-10-10.md 5.6): "på ett färdigställt jobb
 * eller projekt räknas tid × timpris + material + utgifter ihop i en lista man kan ändra, export som i dag
 * (CSV/SIE/Fortnox), redan fakturerat markeras så det aldrig faktureras två gånger." Pure rules shared by the server, the
 * demo, the page and the tests:
 * - What is taken: finished time on the job (one Arbete line per job, hours × the company's hourly rate), the work order's
 *   material rows (each with its own à-pris and påslag) and its expense rows (Övrigt, the amount excl. VAT, Bilkostnad
 *   too). Each line carries the source keys it took: `time:<entryId>` and `row:<taskId>:<rowId>`.
 * - A source is taken by at most one basis ever (the database's unique key on InvoiceBasisSource); what a basis has
 *   taken stays taken when its line is removed, until the whole basis (a draft) is deleted.
 * - The list is the same line model as a quote line, so the quote's rules count the sums (net per kind, VAT, to pay).
 * - Status Utkast → Fakturerat (locked, with the day and who). F-0001 per company; a number is never given twice, not
 *   even after its draft was deleted (QA 2026-10-10).
 * - Nytt fakturaunderlag first shows a proposal built from the work (nothing saved, nothing taken); only Skapa underlaget
 *   saves it and takes its sources, and only when they are still what the proposal showed (QA 2026-10-10: Avbryt left a
 *   saved draft behind that blocked the next one).
 * - Markera som fakturerat needs a price on every line (QA 2026-10-10: material was locked at 0 kr for ever).
 */
export const INVOICE_BASIS_STATUSES = ["DRAFT", "INVOICED"] as const;
export type InvoiceBasisStatus = (typeof INVOICE_BASIS_STATUSES)[number];
export const INVOICE_BASIS_STATUS_LABELS: Record<InvoiceBasisStatus, string> = { DRAFT: "Utkast", INVOICED: "Fakturerat" };
export const INVOICE_BASIS_MAX_LINES = 300;
/** The panels list at most this many bases (newest first). */
export const INVOICE_BASIS_LIST_LIMIT = 50;

/** "F-0007". */
export const invoiceBasisLabel = (number: number) => `F-${String(Math.max(0, Math.trunc(number))).padStart(4, "0")}`;

export const timeSourceKey = (entryId: string) => `time:${entryId}`;
export const rowSourceKey = (taskId: string, rowId: string) => `row:${taskId}:${rowId}`;

/** A line of the list: the same fields as a quote line (text as typed), and what it took. */
export type InvoiceBasisLine = {
  id: string; kind: QuoteLineKind; name: string; quantity: string; unit: string; unitPrice: string; markupPercent: string;
  /** Artikelnummer (2026-10-11): from the work order's material row or the picked article, or typed by hand; absent when none. */
  articleNo?: string; articleSource?: string; manufacturerArticleNo?: string;
  /**
   * Priskopia (2026-10-15: "låst pris"): where a material line's price came from – the price file, its date and the
   * discount or agreed net price – copied from the work order's row or the picked article, as on a quote line. The price
   * itself is the line's own unitPrice, so a new price file never changes a basis that is made.
   */
  catalogue?: CatalogueSnapshot;
  /** ROT (2026-11-01): the line is labour in the ROT basis, as on a quote line. */
  rotLabour?: boolean;
  /** The source keys this line took; empty for a line the person added. */
  sources: string[];
};

const storedLineSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(QUOTE_LINE_KINDS),
  name: z.string().max(300).catch(""),
  quantity: z.string().max(40).catch(""),
  unit: z.string().max(40).catch(""),
  unitPrice: z.string().max(40).catch(""),
  markupPercent: z.string().max(20).catch(""),
  articleNo: z.string().max(60).optional().catch(undefined),
  articleSource: z.string().max(200).optional().catch(undefined),
  manufacturerArticleNo: z.string().max(60).optional().catch(undefined),
  catalogue: quoteCatalogueSchema.optional().catch(undefined),
  rotLabour: z.boolean().optional().catch(undefined),
  sources: z.array(z.string().max(250)).max(10_000).catch([]),
});

/**
 * Moms och ROT på underlaget (2026-11-01): reverse VAT for construction, or ROT with the share and cap the company
 * entered, carried over from the accepted quote and chosen by the person. Workflow assumes no rate. It is kept beside the
 * lines in the same JSON column, as one entry `{ documentTax }` that is no line (`invoiceBasisLinesOf` leaves it out).
 */
export type InvoiceBasisTax = { reverseVat: boolean; buyerVatNumber: string; rotEnabled: boolean; rotPercent: number | null; rotCap: number | null };
export const NO_INVOICE_TAX: InvoiceBasisTax = { reverseVat: false, buyerVatNumber: "", rotEnabled: false, rotPercent: null, rotCap: null };
const storedTaxSchema = z.object({
  reverseVat: z.boolean().catch(false), buyerVatNumber: z.string().max(40).catch(""), rotEnabled: z.boolean().catch(false),
  rotPercent: z.number().nullable().catch(null), rotCap: z.number().nullable().catch(null),
});
/** The basis's tax choice from the stored column; none when there is no such entry. */
export function invoiceBasisTaxOf(value: unknown): InvoiceBasisTax {
  if (!Array.isArray(value)) return NO_INVOICE_TAX;
  const entry = value.find((item) => item && typeof item === "object" && "documentTax" in item) as { documentTax?: unknown } | undefined;
  const parsed = entry ? storedTaxSchema.safeParse(entry.documentTax) : null;
  return parsed?.success ? parsed.data : NO_INVOICE_TAX;
}
/** What the column stores: the lines, and the tax choice only when there is one. */
export function invoiceBasisStored(lines: readonly InvoiceBasisLine[], tax: InvoiceBasisTax): unknown[] {
  return tax.reverseVat || tax.rotEnabled ? [...lines, { documentTax: tax }] : [...lines];
}
/** The ROT the sums count with, or null: only for a private person with ROT on and a readable share and cap. */
export const invoiceBasisRot = (tax: InvoiceBasisTax, customerType: QuoteCustomerType = "COMPANY") => quoteRotOf({ customerType, rotEnabled: tax.rotEnabled, rotPercent: tax.rotPercent, rotCap: tax.rotCap });
/** Why the choice does not fit the customer ("" when it does). The server decides again whatever the page sends. */
export function invoiceTaxProblem(tax: Pick<InvoiceBasisTax, "reverseVat" | "rotEnabled">, customerType: QuoteCustomerType): string {
  if (tax.rotEnabled && customerType !== "PRIVATE") return "ROT-avdrag gäller bara underlag till privatpersoner.";
  if (tax.reverseVat && customerType === "PRIVATE") return "Omvänd moms gäller bara underlag till företag.";
  return "";
}

/**
 * What a new basis takes from the accepted quote: its tax choice and VAT rate. A choice that does not fit the customer is
 * left out, and a reverse-VAT quote's 0 % goes with it (null: the product's own rate), so a basis never shows 0 % VAT
 * without the statement that explains it.
 */
export function invoiceTaxFromQuote(quote: { vatPercent: number | null; reverse: { buyerVatNumber: string } | null; rotEnabled: boolean; rotPercent: number | null; rotCap: number | null }, customerType: QuoteCustomerType): { tax: InvoiceBasisTax; vatPercent: number | null } {
  const tax: InvoiceBasisTax = { reverseVat: Boolean(quote.reverse), buyerVatNumber: quote.reverse?.buyerVatNumber ?? "", rotEnabled: quote.rotEnabled, rotPercent: quote.rotPercent, rotCap: quote.rotCap };
  if (invoiceTaxProblem(tax, customerType)) return { tax: NO_INVOICE_TAX, vatPercent: quote.reverse ? null : quote.vatPercent };
  return { tax, vatPercent: quote.vatPercent };
}

/** The stored list as lines; anything unreadable is left out rather than failing the page. */
export function invoiceBasisLinesOf(value: unknown): InvoiceBasisLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = storedLineSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

// ---------- building the list from the work ----------

export type InvoiceSourceJob = {
  id: string; title: string;
  /** Finished time entries on the job (a linked task's time is already on its work order). */
  entries: readonly { id: string; durationSec: number; timeTypeId?: string | null }[];
  /** The work order's rows (material and expenses); empty for other jobs. */
  materials: readonly MaterialRow[];
};

export type BuiltInvoiceBasis = {
  lines: InvoiceBasisLine[];
  /** Every source key the lines take. */
  sources: string[];
  /** How many sources there are on the jobs at all, taken or not. */
  candidates: number;
};

const hoursText = (seconds: number) => formatPrice(Math.round(seconds / 36) / 100);

/** A short, stable hash (53 bits, hex) – not a secret, only a fingerprint of a list of keys. */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * The line ids of a built list come from what the line takes, so the proposal the page shows and the list the server
 * builds again when it is created match line by line: "labour:<job>" and the row's own source key.
 */
const labourLineId = (jobId: string, typeId?: string) => (typeId ? `labour:${jobId}:${typeId}` : `labour:${jobId}`).slice(0, 100);
const rowLineId = (key: string) => key.length <= 100 ? key : `row:${fingerprint(key)}`;

/**
 * The fingerprint of what a proposal takes (its source keys in order, and how many): Skapa underlaget sends it back, and
 * the server creates the basis only when the work it would take now is the same.
 */
export function invoiceProposalKey(sources: readonly string[]): string {
  return `${sources.length}-${fingerprint(sources.join("\n"))}`;
}
const priceText = (value: number | null) => value === null ? "" : formatPrice(value);

/** Every source key on the jobs, in the order the lines are built. */
export function invoiceSourceKeys(jobs: readonly InvoiceSourceJob[], timeBilling?: TimeBillingLookup): string[] {
  const keys: string[] = [];
  for (const job of jobs) for (const entry of job.entries) if (entry.durationSec > 0 && timeBilling?.(entry.timeTypeId).billing !== "none") keys.push(timeSourceKey(entry.id));
  for (const job of jobs) for (const row of job.materials) if (billableRow(row)) keys.push(rowSourceKey(job.id, row.id));
  return keys;
}

const text = (value: unknown) => typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
/**
 * A work order's rows read from its stored data, tolerantly (a row that cannot be read is left out, never the whole job):
 * what a basis needs – id, kind, benämning, antal, enhet, à-pris, påslag, amount and the quote it came from.
 */
export function materialsFromData(data: unknown): MaterialRow[] {
  const record = data && typeof data === "object" ? data as { kind?: unknown; details?: { materials?: unknown } } : null;
  if (record?.kind !== "WORK_ORDER" || !Array.isArray(record.details?.materials)) return [];
  return record.details.materials.flatMap((item): MaterialRow[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    if (!id) return [];
    const quoteRef = row.quoteRef && typeof row.quoteRef === "object" ? row.quoteRef as MaterialRow["quoteRef"] : undefined;
    const catalogue = row.catalogue ? quoteCatalogueSchema.safeParse(row.catalogue) : null;
    return [{
      id, name: text(row.name), quantity: text(row.quantity), unit: text(row.unit),
      ...(row.kind === "expense" ? { kind: "expense" as const } : {}),
      unitPrice: text(row.unitPrice), markupPercent: text(row.markupPercent), amount: text(row.amount),
      ...(quoteRef && typeof quoteRef.quoteLabel === "string" ? { quoteRef } : {}),
      ...(catalogue?.success ? { catalogue: catalogue.data as CatalogueSnapshot } : {}),
      ...(text(row.articleNo) ? { articleNo: text(row.articleNo), ...(text(row.articleSource) ? { articleSource: text(row.articleSource) } : {}) } : {}),
      ...(text(row.manufacturerArticleNo) ? { manufacturerArticleNo: text(row.manufacturerArticleNo) } : {}),
    }];
  });
}

/** A material row with a name, or an expense row with a name or an amount. */
function billableRow(row: MaterialRow): boolean {
  if (!row.id) return false;
  if (isExpenseRow(row)) return Boolean(row.name.trim()) || (parseAmount(row.amount) ?? rowAmount(row)) !== null;
  return Boolean(row.name.trim());
}

/**
 * The lines of a new basis from what is not yet taken: one Arbete line per job (on a project "Arbete – <the job>"),
 * then the material rows and the expense rows, each as its own line. `taken` holds the source keys already on a basis.
 */
export function linesFromWork(jobs: readonly InvoiceSourceJob[], options: { taken: ReadonlySet<string>; hourlyRate: string; perJob: boolean; timeBilling?: TimeBillingLookup }): BuiltInvoiceBasis {
  const rate = parseAmount(options.hourlyRate);
  const labour: InvoiceBasisLine[] = [], material: InvoiceBasisLine[] = [], other: InvoiceBasisLine[] = [];
  let candidates = 0;
  for (const job of jobs) {
    // Beslut 8 (2026-11-01): a type the company does not bill is no source at all; a type with its own price is a line of its own.
    const billed = job.entries.filter((entry) => entry.durationSec > 0 && options.timeBilling?.(entry.timeTypeId).billing !== "none");
    candidates += billed.length;
    const free = billed.filter((entry) => !options.taken.has(timeSourceKey(entry.id)));
    const title = job.title.replace(/\s+/g, " ").trim();
    const labourLine = (name: string, entries: typeof free, unitPrice: string, typeId?: string): InvoiceBasisLine => ({
      id: labourLineId(job.id, typeId), kind: "LABOUR", name: (options.perJob && title ? `${name} – ${title}` : name).slice(0, 300),
      quantity: hoursText(entries.reduce((sum, entry) => sum + entry.durationSec, 0)), unit: QUOTE_LINE_DEFAULT_UNIT.LABOUR, unitPrice, markupPercent: "",
      sources: entries.map((entry) => timeSourceKey(entry.id)),
    });
    const ownLine = (entry: (typeof free)[number]) => { const type = options.timeBilling?.(entry.timeTypeId); return type?.billing === "own" ? type : null; };
    const standard = free.filter((entry) => !ownLine(entry));
    if (standard.length) labour.push(labourLine("Arbete", standard, rate === null || rate < 0 ? "" : formatPrice(rate)));
    const ownTypes = new Map(free.flatMap((entry) => { const type = ownLine(entry); return type ? [[type.typeId, type] as const] : []; }));
    for (const [typeId, type] of ownTypes) labour.push(labourLine(type.name || "Arbete", free.filter((entry) => ownLine(entry)?.typeId === typeId), priceText(parseAmount(type.price)), typeId));
    for (const row of job.materials) {
      if (!billableRow(row)) continue;
      candidates += 1;
      const key = rowSourceKey(job.id, row.id);
      if (options.taken.has(key)) continue;
      if (isExpenseRow(row)) {
        // Utgift och Bilkostnad: Övrigt, excl. VAT. The row's own antal, enhet and à-pris are kept when they give its
        // amount ("2 h × 1 250,50"); a row whose amount was typed by itself becomes one item of that amount.
        const amount = parseAmount(row.amount);
        const product = rowAmount(row);
        const quantity = parseAmount(row.quantity);
        const own = product !== null && quantity !== null && (amount === null || Math.abs(amount - product) < 0.005);
        other.push({
          id: rowLineId(key), kind: "OTHER", name: (row.name.trim() || "Utgift").slice(0, 300),
          quantity: own ? formatPrice(quantity).slice(0, 40) : "1", unit: (own && row.unit.trim() ? row.unit.trim() : QUOTE_LINE_DEFAULT_UNIT.OTHER).slice(0, 40),
          unitPrice: own ? priceText(parseAmount(row.unitPrice)) : priceText(amount ?? product), markupPercent: "", sources: [key],
        });
        continue;
      }
      // A quantity that is not a number is kept as written, so the person sees it and corrects it before saving.
      const quantity = row.quantity.trim();
      const parsed = parseAmount(quantity);
      material.push({
        id: rowLineId(key), kind: "MATERIAL", name: row.name.trim().slice(0, 300), quantity: (parsed === null ? quantity : formatPrice(parsed)).slice(0, 40),
        unit: (row.unit.trim() || QUOTE_LINE_DEFAULT_UNIT.MATERIAL).slice(0, 40), unitPrice: priceText(parseAmount(row.unitPrice)), markupPercent: priceText(parsePercent(row.markupPercent)),
        ...(row.articleNo?.trim() ? { articleNo: row.articleNo.trim().slice(0, 60), ...(row.articleSource?.trim() ? { articleSource: row.articleSource.trim().slice(0, 200) } : {}) } : {}),
        ...(row.manufacturerArticleNo?.trim() ? { manufacturerArticleNo: row.manufacturerArticleNo.trim().slice(0, 60) } : {}),
        ...(row.catalogue ? { catalogue: row.catalogue } : {}),
        sources: [key],
      });
    }
  }
  const lines = [...labour, ...material, ...other];
  return { lines, sources: lines.flatMap((line) => line.sources), candidates };
}

/** The accepted quotes the work orders' material came from (rows with `quoteRef`), e.g. ["O-0003"]. */
export function quoteLabelsOf(jobs: readonly Pick<InvoiceSourceJob, "materials">[]): string[] {
  return [...new Set(jobs.flatMap((job) => job.materials.flatMap((row) => row.quoteRef?.quoteLabel ? [row.quoteRef.quoteLabel] : [])))].sort();
}

/** The neutral line about an accepted quote; "" when none. */
export function quoteNoteText(labels: readonly string[], project = false): string {
  if (!labels.length) return "";
  const list = labels.length === 1 ? `offert ${labels[0]}` : `offerterna ${labels.slice(0, -1).join(", ")} och ${labels.at(-1)}`;
  return `${project ? "Arbetsorder i projektet kommer" : "Arbetsordern kommer"} från ${list} – kontrollera att inget faktureras två gånger.`;
}

/** "2 jobb är inte färdigställda och tas inte med." */
export function notCompletedText(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "1 jobb är inte färdigställt och tas inte med." : `${count} jobb är inte färdigställda och tas inte med.`;
}

const listLabels = (labels: readonly string[]) => {
  const unique = [...new Set(labels)].sort();
  const shown = unique.slice(0, 3);
  const text = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} och ${shown.at(-1)}` : shown[0] ?? "";
  return unique.length > 3 ? `${shown.join(", ")} m.fl.` : text;
};

/**
 * Why no new basis can be made now ("" when it can): the job is not finished, there is nothing to invoice, or all of it
 * is already on a basis (named). `takenBy` = the labels of the bases holding the job's sources.
 */
export function newBasisReason(state: { project: boolean; completedJobs: number; candidates: number; available: number; takenBy: readonly string[] }): string {
  if (!state.completedJobs) return state.project ? "Inget jobb i projektet är färdigställt än." : "Färdigställ jobbet först.";
  if (!state.candidates) return state.project
    ? "Det finns inget att fakturera i projektets färdigställda jobb: ingen avslutad tid, inget material och inga utgifter."
    : "Det finns inget att fakturera på jobbet: ingen avslutad tid, inget material och inga utgifter.";
  if (!state.available) {
    const where = state.takenBy.length ? ` finns redan i ${listLabels(state.takenBy)}` : " är redan med i ett fakturaunderlag";
    return state.project ? `Allt i projektets färdigställda jobb${where}.` : `Allt på jobbet${where}.`;
  }
  return "";
}

/**
 * Why a basis cannot be marked as invoiced ("" when it can): it has no lines, or lines without a price – an invoiced basis
 * is locked, so a line at 0 kr could never be invoiced afterwards.
 */
export function invoiceReadyProblem(lines: readonly (Pick<InvoiceBasisLine, "kind" | "quantity" | "unitPrice" | "markupPercent"> & { rotLabour?: boolean })[], tax: Pick<InvoiceBasisTax, "reverseVat" | "buyerVatNumber" | "rotEnabled"> = NO_INVOICE_TAX): string {
  if (!lines.length) return "Underlaget har inga rader.";
  const unpriced = invoiceBasisTotals(lines).unpriced;
  if (unpriced) return `${unpriced} ${unpriced === 1 ? "rad saknar" : "rader saknar"} pris.`;
  // An invoiced basis is locked: what the invoice must say about the tax choice has to be there first.
  if (tax.reverseVat && !tax.buyerVatNumber.trim()) return "Ange köparens momsregistreringsnummer.";
  if (tax.rotEnabled && !lines.some((line) => line.rotLabour)) return "Markera vilka rader som är arbete för ROT.";
  return "";
}

// ---------- the list as the person changes it ----------

/** A line as the page sends it: the quote line's fields, text as typed; its id ties it to what it took. */
export const invoiceBasisLineInputSchema = quoteLineInputSchema.extend({ id: z.string().trim().min(1).max(100), /* Absent keeps what the stored line has. */ rotLabour: z.boolean().optional() });
export type InvoiceBasisLineInput = z.input<typeof invoiceBasisLineInputSchema>;

/** The tax choice as the page sends it (text as typed). Absent keeps what the basis has, so a tool that does not know it changes nothing. */
export const invoiceBasisTaxInputSchema = z.object({
  reverseVat: z.boolean().default(false),
  buyerVatNumber: z.string().trim().max(40).default(""),
  rotEnabled: z.boolean().default(false),
  rotPercent: z.string().trim().max(20).default(""),
  rotCap: z.string().trim().max(20).default(""),
}).superRefine((value, context) => {
  if (value.reverseVat && value.rotEnabled) context.addIssue({ code: "custom", path: ["rotEnabled"], message: "Ett underlag har antingen omvänd moms eller ROT-avdrag." });
  if (!value.rotEnabled) return;
  if (parseShare(value.rotPercent) === null) context.addIssue({ code: "custom", path: ["rotPercent"], message: "Skriv ROT-andelen i procent, mellan 0 och 100." });
  if (parseKronor(value.rotCap) === null) context.addIssue({ code: "custom", path: ["rotCap"], message: "Skriv taket för ROT-avdraget i kronor." });
});
export type InvoiceBasisTaxInput = z.input<typeof invoiceBasisTaxInputSchema>;
export function invoiceTaxFromInput(input: z.output<typeof invoiceBasisTaxInputSchema>): InvoiceBasisTax {
  return {
    reverseVat: input.reverseVat, buyerVatNumber: input.reverseVat ? input.buyerVatNumber : "", rotEnabled: input.rotEnabled,
    rotPercent: input.rotEnabled ? parseShare(input.rotPercent) : null, rotCap: input.rotEnabled ? parseKronor(input.rotCap) : null,
  };
}

export const invoiceBasisInputSchema = z.object({
  title: z.string().trim().min(1, "Skriv en rubrik för underlaget.").max(200),
  note: z.string().trim().max(2000).default(""),
  vatPercent: z.string().trim().max(20).default(String(QUOTE_VAT_PERCENT)).refine((value) => parseShare(value) !== null, "Momssatsen skrivs i procent, mellan 0 och 100."),
  lines: z.array(invoiceBasisLineInputSchema).max(INVOICE_BASIS_MAX_LINES, `Ett fakturaunderlag har högst ${INVOICE_BASIS_MAX_LINES} rader.`).default([]),
  tax: invoiceBasisTaxInputSchema.optional(),
  /** Grunduppgifter (Lika är rätt, 2026-11-14): absent keeps what the basis has; null clears it. The project only on a basis that took nothing. */
  customerId: z.string().trim().min(1).max(100).nullable().optional(),
  facilityId: z.string().trim().min(1).max(100).nullable().optional(),
  projectId: z.string().trim().min(1).max(100).nullable().optional(),
}).superRefine((value, context) => {
  const ids = new Set<string>();
  for (const line of value.lines) {
    if (ids.has(line.id)) { context.addIssue({ code: "custom", path: ["lines"], message: "Två rader har samma id. Läs in underlaget igen." }); return; }
    ids.add(line.id);
  }
});
export type InvoiceBasisInput = z.output<typeof invoiceBasisInputSchema>;

/**
 * The saved list: every line keeps the sources its stored line took (matched by id); a line the person added takes none.
 * Sources can never be moved by the page – the server keeps them – and a removed line's sources stay taken by the basis.
 */
export function mergeLineSources(stored: readonly InvoiceBasisLine[], input: readonly z.output<typeof invoiceBasisLineInputSchema>[]): InvoiceBasisLine[] {
  const byId = new Map(stored.map((line) => [line.id, line.sources]));
  const rotById = new Map(stored.map((line) => [line.id, line.rotLabour]));
  return input.map((line) => ({
    id: line.id, kind: line.kind, name: line.name, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, markupPercent: line.markupPercent,
    ...(line.articleNo ? { articleNo: line.articleNo, ...(line.articleSource ? { articleSource: line.articleSource } : {}) } : {}),
    ...(line.manufacturerArticleNo ? { manufacturerArticleNo: line.manufacturerArticleNo } : {}),
    ...(line.catalogue ? { catalogue: line.catalogue as CatalogueSnapshot } : {}),
    ...((line.rotLabour ?? rotById.get(line.id)) ? { rotLabour: true } : {}),
    sources: byId.get(line.id) ?? [],
  }));
}

/** Net per kind, VAT, ROT and the sum to pay – the quote's own rule, whole öre. */
export const invoiceBasisTotals = (lines: readonly (Pick<InvoiceBasisLine, "kind" | "quantity" | "unitPrice" | "markupPercent"> & { rotLabour?: boolean })[], vatPercent = QUOTE_VAT_PERCENT, rot: QuoteRot | null = null): QuoteTotals => quoteTotals(lines, vatPercent, rot);

// ---------- what the page reads ----------

export type InvoiceBasisListItem = {
  id: string; number: number; label: string; title: string; status: InvoiceBasisStatus;
  /** Summa exkl. moms and how many lines lack a price. */
  net: number; unpriced: number;
  invoicedAt: string | null;
  /** Made on the job itself, on the project, or (on a project's panel) on one of its jobs. */
  scope: "task" | "project";
  subjectTitle: string;
};

export type InvoiceBasisSummary = {
  bases: InvoiceBasisListItem[];
  /** Offerter – redigera (or admin): may make, change, mark and delete. */
  canEdit: boolean;
  /** The sources a new basis would take now; 0 with `newReason`. */
  available: number;
  newReason: string;
  /** "2 jobb är inte färdigställda och tas inte med." (projects). */
  notCompleted: string;
  /** The neutral line about an accepted quote. */
  quoteNote: string;
  /** What of the job/project is already on a basis: invoiced and draft labels. */
  marked: { invoiced: string[]; draft: string[] };
};

/** The company's prices under Priser och offert, filled in like the quote: Timpris on a new Arbete line, Påslag on material. */
export type InvoicePriceDefaults = { hourlyRate: string; markupPercent: string; /** ROT's share and cap under Priser och offert, filled in when ROT is switched on. */ rotPercent?: string; rotCap?: string };

export type InvoiceBasisView = {
  /** Empty, with number 0 and revision 0, for a proposal that is not saved yet. */
  id: string; number: number; label: string; revision: number;
  title: string; status: InvoiceBasisStatus; vatPercent: number; note: string;
  /** Omvänd byggmoms and ROT (2026-11-01), and the customer's type, which decides which of them can be chosen. */
  tax?: InvoiceBasisTax; customerType?: QuoteCustomerType;
  lines: InvoiceBasisLine[]; totals: QuoteTotals;
  invoicedAt: string | null; invoicedByName: string; createdAt: string; updatedAt: string;
  task: { id: string; title: string } | null; project: { id: string; name: string } | null;
  /** Plats (2026-11-14): the customer's place the basis is about. */
  facility?: { id: string; name: string } | null;
  /** The project follows the work order or the work the basis took, and is not changed on the basis. */
  projectLocked?: boolean;
  /** The customer's heading and (PDF review 2026-11-03, finding 10) contact person and address as on the quote; "" or absent = none. */
  customer: { id: string; name: string; contactName?: string; address?: string } | null;
  canEdit: boolean;
  quoteNote: string;
  priceDefaults: InvoicePriceDefaults;
  /** A proposal (Nytt fakturaunderlag, nothing saved): the key Skapa underlaget sends back (`invoiceProposalKey`). */
  proposal?: string;
  /** A new basis without a job or project, not saved yet (Nytt fakturaunderlag, 2026-11-14): saved at its first change. */
  blank?: boolean;
};

/** Nytt fakturaunderlag from the list (Lika är rätt, 2026-11-14): an empty basis to fill in, nothing saved yet. */
export function blankInvoiceBasisView(priceDefaults: InvoicePriceDefaults, now = new Date().toISOString()): InvoiceBasisView {
  return {
    id: "", number: 0, label: "", revision: 0, title: "", status: "DRAFT", vatPercent: QUOTE_VAT_PERCENT, note: "", tax: NO_INVOICE_TAX, customerType: "COMPANY",
    lines: [], totals: invoiceBasisTotals([], QUOTE_VAT_PERCENT), invoicedAt: null, invoicedByName: "", createdAt: now, updatedAt: now,
    task: null, project: null, facility: null, projectLocked: false, customer: null, canEdit: true, quoteNote: "", priceDefaults, blank: true,
  };
}

/** "Fakturerat: F-0002 · Utkast: F-0003" – the short marking in the panel's header; "" when nothing is on a basis. */
export function markedText(marked: InvoiceBasisSummary["marked"]): string {
  return [marked.invoiced.length ? `Fakturerat: ${listLabels(marked.invoiced)}` : "", marked.draft.length ? `Utkast: ${listLabels(marked.draft)}` : ""].filter(Boolean).join(" · ");
}

/** "Fakturerat 2026-10-10" / "Utkast". */
export function invoiceBasisStatusText(basis: { status: InvoiceBasisStatus; invoicedAt: string | null }, day: (iso: string) => string): string {
  return basis.status === "INVOICED" && basis.invoicedAt ? `Fakturerat ${day(basis.invoicedAt)}` : INVOICE_BASIS_STATUS_LABELS[basis.status];
}

const companyMarkup = (defaults: InvoicePriceDefaults | null | undefined) => { const value = parsePercent(defaults?.markupPercent); return value === null ? "" : formatPrice(value); };
const companyRate = (defaults: InvoicePriceDefaults | null | undefined) => { const value = parseAmount(defaults?.hourlyRate ?? ""); return value === null || value < 0 ? "" : formatPrice(value); };

/**
 * A new line the person adds, filled in as the quote does: Arbete with the company's hourly rate, Material with the
 * company's markup; it takes nothing.
 */
export function blankInvoiceLine(kind: QuoteLineKind, id: string, defaults?: InvoicePriceDefaults | null): InvoiceBasisLine {
  return {
    id, kind, name: kind === "LABOUR" ? "Arbete" : "", quantity: "1", unit: QUOTE_LINE_DEFAULT_UNIT[kind],
    unitPrice: kind === "LABOUR" ? companyRate(defaults) : "", markupPercent: kind === "MATERIAL" ? companyMarkup(defaults) : "", sources: [],
  };
}

/**
 * A change to a line as the person types it. A material line that gets its first à-pris without a markup of its own gets
 * the company's markup (as on the work order's material row and in the quote); a line made Arbete without a price gets
 * the company's hourly rate.
 */
export function patchInvoiceLine(line: InvoiceBasisLine, patch: Partial<InvoiceBasisLine>, defaults?: InvoicePriceDefaults | null): InvoiceBasisLine {
  const next = { ...line, ...patch };
  if (next.kind === "MATERIAL" && patch.markupPercent === undefined && !line.unitPrice.trim() && next.unitPrice.trim() && !next.markupPercent.trim()) next.markupPercent = companyMarkup(defaults);
  if (patch.kind === "LABOUR" && line.kind !== "LABOUR" && !next.unitPrice.trim()) next.unitPrice = companyRate(defaults);
  return next;
}

const HOUR_UNITS = new Set(["h", "tim", "timme", "timmar"]);
/**
 * "3 h 4 min" beside an Arbete line's decimal hours (3,06 h), as the job reports its time; "" for whole hours (nothing to
 * add), other lines or an antal that is not a number.
 */
export function invoiceLineHoursText(line: Pick<InvoiceBasisLine, "kind" | "quantity" | "unit">): string {
  if (line.kind !== "LABOUR" || !HOUR_UNITS.has(line.unit.trim().toLocaleLowerCase("sv"))) return "";
  const hours = parseAmount(line.quantity);
  if (hours === null || hours < 0) return "";
  const text = formatDurationSeconds(hours * 3600);
  return text.endsWith(" 0 min") ? "" : text;
}

/** "3,06 h (3 h 4 min) · à 650,00 kr" – the line under a row at level 1: antal, enhet and à-pris. */
export function invoiceLineSubtitle(line: Pick<InvoiceBasisLine, "kind" | "quantity" | "unit" | "unitPrice">): string {
  const hours = invoiceLineHoursText(line);
  const amount = [line.quantity, line.unit].filter((part) => part.trim()).join(" ");
  const price = parseAmount(line.unitPrice);
  return [hours ? `${amount} (${hours})` : amount, line.unitPrice.trim() ? `à ${price === null ? line.unitPrice : formatSek(price)} kr` : "Inget pris"].filter(Boolean).join(" · ");
}

// ---------- the company's list (2026-10-28) ----------

/**
 * Fakturaunderlag as one list (2026-10-28: "en samlad lista över fakturaunderlag"): every basis of the company the
 * person may read, newest number first, a page at a time. The status filter and the page come from the address
 * (lib/url-filters.ts), so anything else is ignored.
 */
export const INVOICE_BASIS_FILTERS = ["all", ...INVOICE_BASIS_STATUSES] as const;
export type InvoiceBasisFilter = (typeof INVOICE_BASIS_FILTERS)[number];
export const INVOICE_BASIS_FILTER_LABELS: Record<InvoiceBasisFilter, string> = { all: "Alla", ...INVOICE_BASIS_STATUS_LABELS };
export const INVOICE_BASIS_PAGE_SIZE = 25;
/** The list's sort (toppvisningen, 2026-10-31): the newest number first (as before), newest change, or name. */
export const INVOICE_BASIS_SORTS = ["number", "updated", "title"] as const satisfies readonly ListSortKey[];
export type InvoiceBasisSort = (typeof INVOICE_BASIS_SORTS)[number];
/** Pages beyond this are not read (25 000 bases); the search narrows instead. */
export const INVOICE_BASIS_MAX_PAGE = 1000;

/** The list's query as the server reads it: a known filter (else Alla), a page 1–1000 (else 1) and a short search. */
export type InvoiceBasisListQuery = { filter: InvoiceBasisFilter; page: number; q: string; mine: boolean; sort: InvoiceBasisSort; counts: boolean };
/**
 * Toppvisningen (2026-10-31) adds `mine=1` (the bases I made), `sort` (INVOICE_BASIS_SORTS, else the newest number
 * first) and `counts=1` (the chips' counts; the route decides whether they are given).
 */
export function invoiceBasisListQuery(params: { get(name: string): string | null }): InvoiceBasisListQuery {
  const raw = params.get("status") ?? params.get("filter");
  const filter = (INVOICE_BASIS_FILTERS as readonly string[]).includes(raw ?? "") ? raw as InvoiceBasisFilter : "all";
  const page = Number.parseInt(params.get("page") ?? "1", 10);
  const sort = params.get("sort");
  return {
    filter, page: Number.isFinite(page) ? Math.min(INVOICE_BASIS_MAX_PAGE, Math.max(1, page)) : 1, q: (params.get("q") ?? "").trim().slice(0, 100),
    mine: params.get("mine") === "1", sort: (INVOICE_BASIS_SORTS as readonly string[]).includes(sort ?? "") ? sort as InvoiceBasisSort : "number", counts: params.get("counts") === "1",
  };
}

/** "F-12", "f0012" or "12" searches by number; anything else by words. */
export function invoiceBasisNumberSearch(q: string): number | null {
  const match = /^f?-?0*(\d{1,9})$/i.exec(q.replace(/\s+/g, ""));
  return match ? Number(match[1]) : null;
}

/** One row of the company's list: the panel's row, and where it was made. */
export type InvoiceBasisRow = InvoiceBasisListItem & { customerName: string; taskId: string | null; projectId: string | null; createdAt: string };
export type InvoiceBasisPage = { items: InvoiceBasisRow[]; total: number; page: number; pageSize: number; hasMore: boolean; canEdit: boolean; /** Per status filter (toppvisningen), null when not given. */ counts?: Record<InvoiceBasisFilter, number> | null };
