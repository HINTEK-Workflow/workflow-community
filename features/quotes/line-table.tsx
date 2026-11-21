"use client";

import { Children, isValidElement, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { CopiedPrice } from "@/features/workflow/catalogue-picker";
import type { CatalogueSnapshot } from "@/lib/catalogue/snapshot";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";

/**
 * The lines of a quote and of an invoice basis as one table (2026-10-11, plan 1N): from a wide container
 * (50 rem – a computer's window; a tablet or phone is narrower) one row per post in fixed columns – Typ · Art.nr ·
 * Benämning · Antal · Enhet · À-pris · Påslag · Belopp · Ta bort – with the column headings once on top; under that each
 * line stays a small card with the labels above its fields. The width is the lines' own container, not the screen, so a
 * narrow view (a basis in a view next to a menu) never gets columns that do not fit. Both lists use these classes and
 * pieces, so their rows look and behave alike. The class strings are written out in full for Tailwind to find them.
 */

/** The container the lines stand in: around the list, never on it (a container's own classes cannot depend on it). */
export const LINE_TABLE_BOX = "@container";
/** The list of lines: separate cards, or one bordered table from 50 rem. */
export const LINE_TABLE_SHELL = "space-y-2 @[50rem]:space-y-0 @[50rem]:divide-y @[50rem]:rounded-lg @[50rem]:border @[50rem]:bg-card";
/** The nine columns; Benämning takes what is left. */
export const LINE_TABLE_GRID = "@[50rem]:grid @[50rem]:grid-cols-[7rem_5.75rem_minmax(8rem,1fr)_3.75rem_3.5rem_4.75rem_3.75rem_7rem_2.25rem] @[50rem]:items-center @[50rem]:gap-x-2";
/** A row as a table row: the card's border, padding and gap are dropped. */
export const LINE_TABLE_ROW = "@[50rem]:gap-y-0 @[50rem]:rounded-none @[50rem]:border-0 @[50rem]:bg-transparent @[50rem]:px-3 @[50rem]:py-1";
/** A field's label text: above the field in a card, only for screen readers in the table (the heading says it). */
export const LINE_TABLE_LABEL_TEXT = "block @[50rem]:sr-only";
/**
 * A field's label: the stacked card label (the field 6 px under its text), without that gap in the table. The workspace's own
 * rule puts a margin above an input in a label; `!` is what takes it away in the table.
 */
export const LINE_TABLE_LABEL = "block min-w-0 text-xs font-medium text-muted-foreground [&>*+*]:mt-1.5 @[50rem]:[&>*+*]:mt-0!";
/** Tighter side padding on the narrow fields (Antal, Enhet, À-pris, Påslag) in the table. */
export const LINE_TABLE_NARROW_INPUT = "@[50rem]:px-2";

/**
 * Variant (Inköp, 2026-10-16): a purchase's lines in the same table – Art.nr · Benämning · Leverantör · Antal · Enhet ·
 * Inköpspris · Belopp · Levererad/Ta bort. Only purchase prices: the selling price belongs to the quote.
 */
export const PURCHASE_TABLE_GRID = "@[50rem]:grid @[50rem]:grid-cols-[5.75rem_minmax(8rem,1fr)_7.5rem_3.75rem_3.5rem_5.25rem_7rem_3rem] @[50rem]:items-center @[50rem]:gap-x-2";
const QUOTE_COLUMNS = ["Typ", "Art.nr", "Benämning", "Antal", "Enhet", "À-pris", "Påslag", "Belopp", "Ta bort"];
export const PURCHASE_COLUMNS = ["Art.nr", "Benämning", "Leverantör", "Antal", "Enhet", "Inköpspris", "Belopp", "Levererad"];

/** The headings, once, on top of the table; hidden when the lines are cards. The last column is the row's action (screen readers only), the one before it the amount. */
export function LineTableHeader({ grid = LINE_TABLE_GRID, columns = QUOTE_COLUMNS, lastVisible = false }: { grid?: string; columns?: readonly string[]; lastVisible?: boolean } = {}) {
  const cell = "truncate";
  return <div role="row" className={cn(grid, "hidden rounded-t-lg bg-[var(--table-head)] px-3 py-2 text-xs font-semibold text-muted-foreground")} data-testid="line-table-header">
    {columns.map((label, index) => <span key={label} role="columnheader" className={index === columns.length - 1 ? (lastVisible ? cn(cell, "text-center") : "sr-only") : index === columns.length - 2 ? cn(cell, "text-right") : cell}>{label}</span>)}
  </div>;
}

/**
 * The cells of a line row: each part of the row is a cell for screen readers (a row of role="row" must hold cells;
 * the objective analysis 2026-10-24 found rows without them). The wrapper is display: contents, so the row's grid lays
 * out the parts themselves as before.
 */
export function LineCells({ children }: { children: ReactNode }) {
  return <>{Children.toArray(children).map((child, index) => <div key={isValidElement(child) && child.key != null ? child.key : index} role="cell" className="contents">{child}</div>)}</>;
}

/**
 * The article number of a material line (a field of its own): filled in when an article is picked from the price file,
 * typed by hand otherwise. The supplier's and the manufacturer's numbers are in its tooltip.
 */
export function ArticleNoField({ value, source, manufacturer, disabled = false, onChange, className, testId }: {
  value: string; source?: string; manufacturer?: string; disabled?: boolean; onChange: (articleNo: string) => void; className?: string; testId?: string;
}) {
  const hint = [value.trim() ? (source?.trim() ? `Artikelnummer från ${source.trim()}` : "Eget artikelnummer") : "", manufacturer?.trim() ? `Tillverkarens art.nr ${manufacturer.trim()}` : ""].filter(Boolean).join(" · ");
  return <label className={cn(LINE_TABLE_LABEL, className)}><span className={LINE_TABLE_LABEL_TEXT}>Art.nr</span>
    <Input aria-label="Artikelnummer" placeholder="Art.nr" title={hint || undefined} value={value} maxLength={60} disabled={disabled} autoComplete="off" className={LINE_TABLE_NARROW_INPUT} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
  </label>;
}

/**
 * The copied price under a material row. On a locked document the "Ta bort priset" button is not offered at all (ART-07: it
 * changed the sum on screen without being saved); on a touch screen it is 44 px high (decision 14).
 */
export function ClearablePrice({ snapshot, unitPrice, editable, onClear }: { snapshot: CatalogueSnapshot; unitPrice: string; editable: boolean; onClear: () => void }) {
  return <div className={cn("[&_button]:touch:min-h-11 [&_button]:touch:px-3", !editable && "[&_button]:hidden")}>
    <CopiedPrice snapshot={snapshot} unitPrice={unitPrice} showPrice={false} onClear={onClear} />
  </div>;
}

/** Ta bort priset with a message and Ångra (decision 13): puts back the copied price and the à-pris as they were. `patch` must be safe to call later. */
export function clearPriceWithUndo(line: { catalogue?: CatalogueSnapshot; unitPrice: string }, patch: (patch: { catalogue?: CatalogueSnapshot; unitPrice?: string }) => void) {
  const before = { catalogue: line.catalogue, unitPrice: line.unitPrice };
  patch({ catalogue: undefined, unitPrice: "" });
  announce("Priset är borttaget från raden.", false, [{ label: "Ångra", run: () => patch(before) }]);
}

/** Enter in the last field of a row adds a new row of the same kind (2026-10-11). */
export const enterAddsLine = (onAdd: () => void) => (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  onAdd();
};
