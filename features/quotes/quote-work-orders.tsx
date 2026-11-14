"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { ListGroup, ListRow } from "@/components/native";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { taskHref } from "@/features/workflow/next-steps";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { QuoteComparisonView } from "@/features/quotes/quote-comparison";
import { JOB_STATUS_LABELS } from "@/lib/workflow/job-state";
import { cn } from "@/lib/utils";
import type { QuoteWorkOrderSummary } from "@/lib/quotes/flow-server";
import type { QuoteView } from "@/lib/quotes/model";

/**
 * Arbetsordrar från offerten (plan 1D och 1K, 2026-10-11): every work order made from the quote – not only the
 * latest – as links, and for an accepted quote Offererat mot använt against exactly those orders (the project's rule,
 * lib/quotes/flow-server.ts quoteWorkOrderSummary), so an order made from a quote without a project reads the same as
 * one in a project. The list comes with the quote; the comparison is read on its own and only when it can be shown.
 */
const statusTone = (status: string) => status === "COMPLETED" ? "success" : status === "CANCELLED" ? "neutral" : status === "IN_PROGRESS" ? "info" : status === "NEEDS_ACTION" ? "danger" : "warning";
const statusLabel = (status: string) => JOB_STATUS_LABELS[status] ?? status;

function useComparison(quote: QuoteView) {
  const wanted = quote.storedStatus === "ACCEPTED" && quote.workOrders.length > 0;
  const [summary, setSummary] = useState<QuoteWorkOrderSummary | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let active = true;
    api<QuoteWorkOrderSummary>(`/api/quotes?part=work_orders&id=${encodeURIComponent(quote.id)}`, { cache: "no-store" })
      .then((result) => { if (active) setSummary(result); })
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, [quote.id, quote.workOrders.length, quote.storedStatus, wanted]);
  return wanted ? summary?.comparison ?? null : null;
}

const LABOUR_SCOPE = "Avslutad tid på arbetsordrarna från offerten.";

/** Level 2–3: a panel with the orders as rows and the comparison beneath. */
export function QuoteWorkOrdersPanel({ quote }: { quote: QuoteView }) {
  const comparison = useComparison(quote);
  if (!quote.workOrders.length) return null;
  const several = quote.workOrders.length > 1;
  return <Panel title={several ? "Arbetsordrar från offerten" : "Arbetsorder från offerten"} description={quote.storedStatus === "ACCEPTED" ? "Det som använts på arbetsordrarna mot det offererade. Belopp exklusive moms." : undefined}>
    <div className="space-y-4" data-testid="quote-work-orders">
      <ul className="divide-y rounded-xl border bg-card">
        {quote.workOrders.map((order) => <li key={order.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-2.5 text-sm" data-testid="quote-work-order-link">
          <Link className="min-w-0 font-medium hover:text-primary hover:underline" href={taskHref({ id: order.id, kind: "WORK_ORDER" })}>{order.title}</Link>
          <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", indicatorBadge(statusTone(order.status)))}>{statusLabel(order.status)}</span>
        </li>)}
      </ul>
      {comparison ? <div data-testid="quote-comparison">
        <h3 className="mb-2 text-sm font-semibold">Offererat mot använt</h3>
        <QuoteComparisonView comparison={comparison} testId="quote" labourScope={LABOUR_SCOPE} />
      </div> : null}
    </div>
  </Panel>;
}

/** Level 1 on a phone: the orders as rows in the quote's menu; the comparison as its own group of facts. */
export function NativeQuoteWorkOrders({ quote }: { quote: QuoteView }) {
  const comparison = useComparison(quote);
  if (!quote.workOrders.length) return null;
  return <>
    <ListGroup title={quote.workOrders.length > 1 ? "Arbetsordrar från offerten" : "Arbetsorder från offerten"} testId="native-quote-work-orders">
      {quote.workOrders.map((order) => <ListRow key={order.id} type="work-order" icon={ClipboardList} title={order.title} pill={{ label: statusLabel(order.status), tone: statusTone(order.status) }}
        href={taskHref({ id: order.id, kind: "WORK_ORDER" })} testId="quote-work-order-link" />)}
    </ListGroup>
    {comparison ? <div className="px-4 pb-2" data-testid="quote-comparison"><h3 className="mb-2 text-sm font-semibold">Offererat mot använt</h3><QuoteComparisonView comparison={comparison} testId="quote" labourScope={LABOUR_SCOPE} /></div> : null}
  </>;
}
