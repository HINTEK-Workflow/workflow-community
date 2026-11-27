"use client";

import { useSubPageHref } from "@/features/kfid/use-return-to";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PackageOpen, Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { NativeActions } from "@/components/native";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { quoteStatusTone } from "@/features/quotes/quotes-list";
import { QuoteComparisonView } from "@/features/quotes/quote-comparison";
import { cn } from "@/lib/utils";
import { formatSek } from "@/lib/workflow/expenses";
import { QUOTE_STATUS_LABELS } from "@/lib/quotes/model";
import type { ProjectQuoteSummary } from "@/lib/quotes/flow-server";

/**
 * Offerter i projektet (steg C, 2026-10-09): the project's quotes (latest version of each), "Skapa offert från
 * materialet" (the project's work orders' material rows as lines of a new draft) and Offererat mot använt – the accepted
 * quotes' material against the material rows of the project's work orders, per Benämning and Enhet, at selling price excl.
 * VAT (the shared QuoteComparisonView). Shown only to someone the server lets read quotes (Offerter – läsa); the
 * comparison needs Arbetsorder – läsa too. Nothing is shown when the server refuses (no right, Local, the demo).
 */
export function ProjectQuotes({ projectId }: { projectId: string }) {
  const native = useNativeMode();
  const [summary, setSummary] = useState<ProjectQuoteSummary | null>(null);
  useEffect(() => {
    let active = true;
    api<ProjectQuoteSummary>(`/api/quotes?part=project&projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then((result) => { if (active) setSummary(result); })
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, [projectId]);
  // A quote started here leads back to the project (samband, 2026-10-26).
  const subPage = useSubPageHref();
  if (!summary) return null;
  const comparison = summary.comparison;
  const newHref = `/?view=quote&projectId=${encodeURIComponent(projectId)}`;
  // The same header as the project's other panels (Material i projektet): no icon, the buttons to the right of a short description.
  return <Panel icon={FileText} title="Offerter och utfall" description="Projektets offerter jämförda med det som har använts. Belopp exklusive moms."
    actions={summary.canCreate && !native ? <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline"><Link href={subPage(`${newHref}&from=project`)} data-testid="project-quote-from-materials"><PackageOpen />Offert från materialet</Link></Button>
      <Button asChild variant="outline"><Link href={subPage(newHref)} data-testid="project-quote-new"><Plus />Ny offert</Link></Button>
    </div> : undefined}>
    <div className="space-y-4" data-testid="project-quotes">
      {/* Level 1: the two buttons are rows of the list (audit 2026-10-12). */}
      {native && summary.canCreate ? <NativeActions testId="native-project-quote-actions">
        <Link href={subPage(`${newHref}&from=project`)} data-testid="project-quote-from-materials"><PackageOpen />Offert från materialet</Link>
        <Link href={subPage(newHref)} data-testid="project-quote-new"><Plus />Ny offert</Link>
      </NativeActions> : null}
      {!summary.quotes.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Projektet har inga offerter än.</p> : <ul className="divide-y rounded-xl border bg-card">
        {summary.quotes.map((quote) => <li key={quote.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-2.5 text-sm" data-testid="project-quote">
          <Link className="min-w-0 font-medium hover:text-primary hover:underline" href={`/?view=quote&quoteId=${encodeURIComponent(quote.id)}`}>{quote.label} · {quote.title}{quote.changeOfVersion ? <span className="font-normal text-muted-foreground"> (ÄTA)</span> : null}</Link>
          <span className="flex items-center gap-3">
            <span className="tabular-nums">{formatSek(quote.net)} kr</span>
            <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", indicatorBadge(quoteStatusTone(quote.status)))}>{QUOTE_STATUS_LABELS[quote.status]}</span>
          </span>
        </li>)}
      </ul>}

      {comparison ? <div data-testid="project-quote-comparison">
        <h3 className="mb-2 text-sm font-semibold">Offererat mot använt</h3>
        {!summary.agreed.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Ingen offert i projektet är accepterad än. Jämförelsen visar accepterade offerter (senaste ÄTA räknas).</p> : <>
          <p className="mb-2 text-xs text-muted-foreground">Räknar {summary.agreed.map((item) => item.label).join(", ")}. Material per benämning och enhet; arbete och övrigt jämförs längst ned.</p>
          <QuoteComparisonView comparison={comparison} testId="project-quote"
            labourScope="Avslutad tid på projektets arbetsordrar. Rapporterat under Projektprogression räknar all tid på projektets jobb, även kontroller, riskbedömningar och tid som pågår." />
        </>}
      </div> : null}
    </div>
  </Panel>;
}
