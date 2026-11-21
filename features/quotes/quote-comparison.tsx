"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPrice, formatSek } from "@/lib/workflow/expenses";
import type { QuoteComparison } from "@/lib/quotes/conversion";

/**
 * Offererat mot använt (steg C, 2026-10-09; shared since plan 1K 2026-10-11 by the project's panel and the quote's
 * own): the agreed quote lines against the work orders' material rows per Benämning and Enhet at selling price excl.
 * VAT, then Arbete (hours against reported time) and Övrigt (against the expense rows). The same rows wherever it is
 * shown, so a work order made from a quote without a project reads exactly as one in a project. `testId` prefixes the
 * rows' test ids ("project-quote" or "quote").
 */
const COMPARISON_GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 @3xl:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_8rem_8rem]";
const PAGE = 50;
const quantity = (value: number | null) => value === null ? "–" : formatPrice(value);
const signed = (value: number) => `${value > 0 ? "+" : ""}${formatPrice(value)}`;
const hours = (minutes: number) => formatPrice(Math.round(minutes / 6) / 10);
const signedSek = (value: number) => `${value > 0 ? "+" : ""}${formatSek(value)} kr`;

export function QuoteComparisonView({ comparison, testId, labourScope }: {
  comparison: QuoteComparison;
  testId: string;
  /** What the reported time counts (the project's and the quote's differ in wording). */
  labourScope: string;
}) {
  const [shown, setShown] = useState(PAGE);
  const lines = comparison.lines;
  return <>
    {!lines.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Inget material att jämföra än.</p> : <div role="table" aria-label="Offererat mot använt" className="@container overflow-hidden rounded-xl border bg-card">
      <div role="row" className={cn(COMPARISON_GRID, "hidden border-b bg-muted/40 px-3.5 py-2 text-xs font-medium text-muted-foreground @3xl:grid")}>
        <span role="columnheader">Benämning</span><span role="columnheader" className="text-right">Offererat</span><span role="columnheader" className="text-right">Använt</span><span role="columnheader" className="text-right">Skillnad</span><span role="columnheader" className="text-right">Offererat (kr)</span><span role="columnheader" className="text-right">Använt (kr)</span>
      </div>
      <div className="divide-y">
        {lines.slice(0, shown).map((line) => <div key={`${line.name}\u0000${line.unit}`} role="row" data-testid={`${testId}-comparison-line`} className={cn(COMPARISON_GRID, "px-3.5 py-2.5 text-sm")}>
          <span role="cell" className="min-w-0 break-words font-medium">{line.name}{line.unit ? <span className="font-normal text-muted-foreground"> ({line.unit})</span> : null}</span>
          <span role="cell" className="text-right tabular-nums @3xl:hidden">{quantity(line.quoted)} → {quantity(line.used)}</span>
          <span role="cell" className="hidden text-right tabular-nums @3xl:block">{quantity(line.quoted)}</span>
          <span role="cell" className="hidden text-right tabular-nums @3xl:block">{quantity(line.used)}{line.usedOther.length ? <span className="block text-xs text-muted-foreground">+ {line.usedOther.join(", ")}</span> : null}</span>
          <span role="cell" className={cn("hidden text-right tabular-nums @3xl:block", line.difference !== null && line.difference > 0 && "font-semibold")}>{line.difference === null ? "–" : signed(line.difference)}</span>
          <span role="cell" className="col-span-2 text-xs tabular-nums text-muted-foreground @3xl:hidden">Offererat {line.quotedAmount === null ? "–" : `${formatSek(line.quotedAmount)} kr`} · Använt {line.usedAmount === null ? "–" : `${formatSek(line.usedAmount)} kr`}{line.usedOther.length ? ` · + ${line.usedOther.join(", ")}` : ""}</span>
          <span role="cell" className="hidden text-right tabular-nums @3xl:block">{line.quotedAmount === null ? "–" : formatSek(line.quotedAmount)}</span>
          <span role="cell" className="hidden text-right tabular-nums @3xl:block">{line.usedAmount === null ? "–" : formatSek(line.usedAmount)}</span>
        </div>)}
      </div>
      {lines.length > shown ? <div className="border-t px-3.5 py-2"><Button type="button" size="sm" variant="ghost" onClick={() => setShown((current) => current + PAGE)}>Visa fler ({lines.length - shown})</Button></div> : null}
    </div>}
    <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3" data-testid={`${testId}-comparison-totals`}>
      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Offererat material</dt><dd className="whitespace-nowrap tabular-nums">{formatSek(comparison.totals.quotedAmount)} kr</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Använt material</dt><dd className="whitespace-nowrap tabular-nums">{formatSek(comparison.totals.usedAmount)} kr</dd></div>
      <div className="flex justify-between gap-3 font-semibold"><dt>Skillnad</dt><dd className="whitespace-nowrap tabular-nums">{comparison.totals.difference > 0 ? "+" : ""}{formatSek(comparison.totals.difference)} kr</dd></div>
      {comparison.totals.usedUnpriced ? <p className="text-xs text-muted-foreground sm:col-span-3">{comparison.totals.usedUnpriced} {comparison.totals.usedUnpriced === 1 ? "använd rad saknar" : "använda rader saknar"} pris och ingår inte i summan.</p> : null}
    </dl>
    {comparison.labour && comparison.other ? <QuotedWorkAndOther labour={comparison.labour} other={comparison.other} testId={testId} labourScope={labourScope} /> : null}
  </>;
}

/**
 * Arbete och övrigt (2026-10-09, "bygg klart"): the agreed quotes' Arbete hours against the time reported on the
 * work orders, and their Övrigt lines against the work orders' expense rows. Same rows as the material totals.
 */
function QuotedWorkAndOther({ labour, other, testId, labourScope }: { labour: QuoteComparison["labour"]; other: QuoteComparison["other"]; testId: string; labourScope: string }) {
  const row = "flex justify-between gap-3";
  return <div className="mt-4 space-y-3 border-t pt-3" data-testid={`${testId}-work-other`}>
    <div>
      <h4 className="mb-1 text-sm font-semibold">Arbete</h4>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3" data-testid={`${testId}-labour`}>
        <div className={row}><dt className="text-muted-foreground">Offererad tid</dt><dd className="whitespace-nowrap tabular-nums">{labour.quotedMinutes === null ? "–" : `${hours(labour.quotedMinutes)} h`}</dd></div>
        <div className={row}><dt className="text-muted-foreground">Rapporterat på arbetsordrarna</dt><dd className="whitespace-nowrap tabular-nums">{labour.reportedMinutes === null ? "–" : `${hours(labour.reportedMinutes)} h`}</dd></div>
        <div className={cn(row, "font-semibold")}><dt>Skillnad</dt><dd className="whitespace-nowrap tabular-nums">{labour.differenceMinutes === null ? "–" : `${labour.differenceMinutes > 0 ? "+" : ""}${hours(labour.differenceMinutes)} h`}</dd></div>
        {/* Why this can differ from Rapporterat in Projektprogression (QA 2026-10-10: 62,5 h here, 68,5 h there): the quote's
            hours are compared with the finished time on the work orders only. */}
        <p className="text-xs text-muted-foreground sm:col-span-3" data-testid={`${testId}-labour-scope`}>{labourScope}</p>
        {labour.uncounted ? <p className="text-xs text-muted-foreground sm:col-span-3">{labour.uncounted} {labour.uncounted === 1 ? "arbetsrad är inte" : "arbetsrader är inte"} i timmar och räknas inte som tid.</p> : null}
      </dl>
    </div>
    <div>
      <h4 className="mb-1 text-sm font-semibold">Övrigt och utgifter</h4>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3" data-testid={`${testId}-other`}>
        <div className={row}><dt className="text-muted-foreground">Offererat övrigt</dt><dd className="whitespace-nowrap tabular-nums">{formatSek(other.quotedAmount)} kr</dd></div>
        <div className={row}><dt className="text-muted-foreground">Utgifter</dt><dd className="whitespace-nowrap tabular-nums">{formatSek(other.usedAmount)} kr</dd></div>
        <div className={cn(row, "font-semibold")}><dt>Skillnad</dt><dd className="whitespace-nowrap tabular-nums">{signedSek(other.difference)}</dd></div>
        {other.usedMissing ? <p className="text-xs text-muted-foreground sm:col-span-3">{other.usedMissing} {other.usedMissing === 1 ? "utgiftsrad saknar" : "utgiftsrader saknar"} belopp och ingår inte i summan.</p> : null}
      </dl>
    </div>
  </div>;
}
