"use client";

import Link from "next/link";
import { TriangleAlert, ChevronRight, Info, Scale } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { indicatorBadge, indicatorText, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { cn } from "@/lib/utils";
import { noteText, quantityParts, resultText, REMINDER } from "@/lib/calculators/present";
import type { CalcModule, Note, Outcome, OutputQuantity, Tone } from "@/lib/calculators/types";

/**
 * The result of a calculator (Räkneverktyg, 2026-10-07): the answers the person came for, the other figures, the
 * comparisons with a limit, notes (including a value the company has not entered, with a way to enter it), "Så
 * räknades det" with the formulas and the numbers put in, and a button that copies it all as text. Colours mean what
 * they do everywhere: green fine, amber to look at, red over the limit.
 */
const TONE: Record<Tone, IndicatorTone> = { ok: "success", warn: "warning", alarm: "danger", neutral: "neutral" };

export function CalculatorResult({ tool, outcome, admin, notify }: { tool: CalcModule; outcome: Outcome; admin: boolean; notify: (text: string, error?: boolean) => void }) {
  if (outcome.status === "incomplete") return <p className="text-sm leading-6 text-muted-foreground" role="status" data-testid="calc-result-waiting">{outcome.message}</p>;
  if (outcome.status === "invalid") {
    const general = outcome.errors.filter((error) => !error.field);
    return <div className="space-y-2" role={general.length ? "alert" : "status"} data-testid="calc-result-invalid">
      {general.length ? general.map((error) => <p key={error.message} className="text-sm leading-6 text-destructive">{error.message}</p>) : <p className="text-sm leading-6 text-muted-foreground">Rätta de markerade fälten så visas resultatet här.</p>}
    </div>;
  }
  const quantities = outcome.rows.filter((row): row is OutputQuantity => row.kind === "quantity");
  const main = quantities.filter((row) => row.primary);
  const others = quantities.filter((row) => !row.primary);
  const verdicts = outcome.rows.filter((row) => row.kind === "verdict");
  return <div className="space-y-4" aria-live="polite" data-testid="calc-result">
    {main.length ? <div className="grid gap-3 sm:grid-cols-2">
      {main.map((row) => {
        const { value, unit } = quantityParts(row);
        return <div key={row.id} className="rounded-xl border bg-secondary/40 p-4" data-testid={`calc-result-${row.id}`} data-value={row.value}>
          <p className="text-xs font-medium text-muted-foreground">{row.label}</p>
          <p className={cn("mt-1 text-2xl font-semibold tabular-nums", row.tone ? indicatorText(TONE[row.tone]) : "text-primary")}>{value}{unit ? <>{" "}<span className="ml-0.5 text-base font-medium">{unit}</span></> : null}</p>
          {row.note ? <p className="mt-1 text-xs text-muted-foreground">{row.note}</p> : null}
        </div>;
      })}
    </div> : null}
    {verdicts.length ? <ul className="space-y-2">
      {verdicts.map((row) => row.kind === "verdict" ? <li key={row.id} className={cn("rounded-lg border px-3 py-2 text-sm leading-6", indicatorBadge(TONE[row.tone]))} data-testid={`calc-result-${row.id}`} data-tone={row.tone}>{row.text}</li> : null)}
    </ul> : null}
    {others.length ? <dl className="divide-y rounded-lg border text-sm">
      {others.map((row) => {
        const { value, unit } = quantityParts(row);
        return <div key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2" data-testid={`calc-result-${row.id}`} data-value={row.value}>
          <dt className="min-w-0 text-muted-foreground">{row.label}{row.note ? <span className="block text-xs">{row.note}</span> : null}</dt>
          <dd className={cn("font-medium tabular-nums", row.tone ? indicatorText(TONE[row.tone]) : "")}>{value}{unit ? ` ${unit}` : ""}</dd>
        </div>;
      })}
    </dl> : null}
    {outcome.notes.length ? <ul className="space-y-2" data-testid="calc-notes">{outcome.notes.map((note, index) => <NoteLine key={`${index}-${note.text}`} note={note} admin={admin} />)}</ul> : null}
    <details className="group rounded-lg border" data-testid="calc-steps">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />Så räknades det
      </summary>
      <div className="space-y-3 border-t px-3 py-3">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">{outcome.steps.map((step, index) => <li key={index} className="[overflow-wrap:anywhere]">{step}</li>)}</ol>
        <p className="text-xs leading-5 text-muted-foreground">Resultaten visas med tre värdesiffror. {REMINDER}</p>
      </div>
    </details>
    <CopyButton value={() => resultText(tool, outcome)} label="Kopiera resultat" data-testid="calc-copy" className="mobile-form-action"
      onCopied={() => notify("Resultatet är kopierat.")} onFailed={() => notify("Resultatet kunde inte kopieras. Markera texten och kopiera för hand.", true)} />
  </div>;
}

function NoteLine({ note, admin }: { note: Note; admin: boolean }) {
  const Icon = note.tone === "info" ? Info : note.tone === "missing" ? Scale : TriangleAlert;
  return <li className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm leading-6", note.tone === "info" ? "bg-muted/30 text-muted-foreground" : indicatorBadge("warning"))} data-testid={note.tone === "missing" ? "calc-missing-value" : undefined}>
    <Icon className="mt-1 size-4 shrink-0" aria-hidden="true" />
    <span className="min-w-0 [overflow-wrap:anywhere]">
      {note.link
        ? <>{note.text}{" "}{admin
          ? <Link href={`/?view=${note.link.view}`} className="font-medium underline underline-offset-2" data-testid="calc-company-values-link">{note.link.label}</Link>
          : <span className="font-medium">{note.link.label}</span>}.
          {admin ? null : " Det görs av en företagsadministratör."}
          {note.detail ? ` ${note.detail}` : ""}</>
        : noteText(note)}
    </span>
  </li>;
}
