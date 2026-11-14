import { INVOICE_BASIS_STATUS_LABELS, type InvoiceBasisLine, type InvoiceBasisListItem, type InvoiceBasisSummary, type InvoiceBasisView } from "@/lib/invoice-basis/model";
import { QUOTE_LINE_KIND_LABELS, quoteLineNumbers, type QuoteLineKind } from "@/lib/quotes/model";

/**
 * Fakturaunderlag through the API and MCP (plan 1J, 2026-10-11): what a key or a connected app gets of a basis.
 * Built field by field from the app's own view, never spread, so the purchase price (à-pris) and the markup never leave –
 * a line is given at its selling price per unit and its amount, a basis its sums per kind, net, VAT and gross. The
 * sources a line took, the company's price defaults and every internal id beyond the basis's own stay in the app.
 */
export type InvoiceBasisToolLine = {
  id: string; kind: QuoteLineKind; kindLabel: string; name: string; quantity: string; unit: string;
  /** The selling price per unit excl. VAT (à-pris with markup), and antal × price; null while the line has no price. */
  price: number | null; amount: number | null;
  /** The line was built from the job's work (time, material or expenses); false for a line a person added. */
  fromWork: boolean;
};
export type InvoiceBasisToolTotals = { material: number; labour: number; other: number; net: number; vatPercent: number; vat: number; gross: number; unpriced: number };
export type InvoiceBasisToolView = {
  id: string; number: number; label: string; title: string; status: InvoiceBasisView["status"]; statusLabel: string; note: string;
  task: InvoiceBasisView["task"]; project: InvoiceBasisView["project"]; customer: InvoiceBasisView["customer"];
  invoicedAt: string | null; invoicedByName: string; createdAt: string; updatedAt: string; canEdit: boolean; quoteNote: string;
  lines: InvoiceBasisToolLine[]; totals: InvoiceBasisToolTotals;
  /** Only on a proposal: the key create_invoice_basis sends back. */
  proposal?: string;
};

/** Keys that must never appear in what the tools answer (checked by the tests). */
export const INVOICE_BASIS_TOOL_FORBIDDEN_KEYS = ["unitPrice", "markupPercent", "purchase", "margin", "priceDefaults", "hourlyRate", "sources", "rotBase", "revision"] as const;

export function invoiceBasisToolLine(line: InvoiceBasisLine): InvoiceBasisToolLine {
  const numbers = quoteLineNumbers(line);
  return {
    id: line.id, kind: line.kind, kindLabel: QUOTE_LINE_KIND_LABELS[line.kind] ?? "", name: line.name, quantity: line.quantity, unit: line.unit,
    price: numbers.saleUnitPrice, amount: numbers.amount, fromWork: line.sources.length > 0,
  };
}

export function invoiceBasisToolView(view: InvoiceBasisView): InvoiceBasisToolView {
  const totals = view.totals;
  return {
    id: view.id, number: view.number, label: view.label, title: view.title, status: view.status, statusLabel: INVOICE_BASIS_STATUS_LABELS[view.status], note: view.note,
    task: view.task, project: view.project, customer: view.customer,
    invoicedAt: view.invoicedAt, invoicedByName: view.invoicedByName, createdAt: view.createdAt, updatedAt: view.updatedAt, canEdit: view.canEdit, quoteNote: view.quoteNote,
    lines: view.lines.map(invoiceBasisToolLine),
    totals: { material: totals.byKind.MATERIAL, labour: totals.byKind.LABOUR, other: totals.byKind.OTHER, net: totals.net, vatPercent: totals.vatPercent, vat: totals.vat, gross: totals.gross, unpriced: totals.unpriced },
    ...(view.proposal ? { proposal: view.proposal } : {}),
  };
}

export type InvoiceBasisToolListItem = InvoiceBasisListItem & { statusLabel: string };
export type InvoiceBasisToolList = {
  bases: InvoiceBasisToolListItem[];
  /** Whether a new basis can be made now: how many sources it would take, else why none (newReason). */
  available: number; newReason: string; notCompleted: string; quoteNote: string;
  marked: InvoiceBasisSummary["marked"]; canEdit: boolean;
};

export function invoiceBasisToolList(summary: InvoiceBasisSummary): InvoiceBasisToolList {
  return {
    bases: summary.bases.map((item) => ({
      id: item.id, number: item.number, label: item.label, title: item.title, status: item.status, statusLabel: INVOICE_BASIS_STATUS_LABELS[item.status],
      net: item.net, unpriced: item.unpriced, invoicedAt: item.invoicedAt, scope: item.scope, subjectTitle: item.subjectTitle,
    })),
    available: summary.available, newReason: summary.newReason, notCompleted: summary.notCompleted, quoteNote: summary.quoteNote, marked: summary.marked, canEdit: summary.canEdit,
  };
}
