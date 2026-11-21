"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { RowChevron } from "@/components/row-chevron";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { ListRow } from "@/components/native";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { cn } from "@/lib/utils";
import { formatSek } from "@/lib/workflow/expenses";
import { invoiceBasisStatusText, markedText, type InvoiceBasisSummary } from "@/lib/invoice-basis/model";
import { clientExtensions } from "@ee/client";
import { InvoiceBasisModal, invoiceDay, statusTone, type InvoiceBasisRef, type InvoiceBasisTarget } from "./invoice-basis-view";

/**
 * Fakturaunderlag på jobbet och projektet (2026-10-10: "på ett färdigställt jobb eller projekt räknas tid × timpris
 * + material + utgifter ihop i en lista man kan ändra … redan fakturerat markeras så det aldrig faktureras två gånger").
 * Level 2–3: the panel with the bases (F-nummer, Utkast/Fakturerat <datum>, sum excl. VAT) and Nytt fakturaunderlag,
 * inactive with its reason when nothing new can be taken; it opens a proposal that is saved only with Skapa underlaget.
 * Level 1: one row in the job's or project's menu that opens the bases as a screen. The page shows them only to someone
 * who may read them (admin or Offerter – läsa; the job's and project's pages ask before they draw this, so nobody else
 * makes a request that is refused), and the server decides (also the job/project, Local, a task linked to a work order).
 */
const { InvoiceOfBasisStatus } = clientExtensions;
const query = (ref: InvoiceBasisRef) => ref.taskId ? `taskId=${encodeURIComponent(ref.taskId)}` : `projectId=${encodeURIComponent(ref.projectId ?? "")}`;

/** `onSummary` tells the page what was read (the job hides "Skapa offert av materialet" once a basis is invoiced, 2026-10-11). */
function useInvoiceBasisSummary(ref: InvoiceBasisRef, completed: boolean | undefined, onSummary?: (summary: InvoiceBasisSummary) => void, enabled = true) {
  const [summary, setSummary] = useState<InvoiceBasisSummary | null>(null);
  const key = query(ref);
  const told = useRef(onSummary);
  useEffect(() => { told.current = onSummary; });
  const load = useCallback(async () => {
    try { const result = await api<InvoiceBasisSummary>(`/api/invoice-bases?${key}`, { cache: "no-store" }); setSummary(result); told.current?.(result); } catch { setSummary(null); }
  }, [key]);
  // Read again when the job is finished or reopened.
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api<InvoiceBasisSummary>(`/api/invoice-bases?${key}`, { cache: "no-store" })
      .then((result) => { if (active) { setSummary(result); told.current?.(result); } })
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, [key, completed, enabled]);
  return { summary: enabled ? summary : null, load };
}

/**
 * On a work order (2026-11-05): the button at the top among the page's other buttons, and what has become of the basis and
 * its invoice under Historik. The button makes a new basis while there is something to take, otherwise it opens the latest.
 */
export function useTaskInvoiceBasis({ taskId, enabled, completed, onSummary }: { taskId: string; enabled: boolean; completed: boolean; onSummary?: (summary: InvoiceBasisSummary) => void }) {
  const { summary, load } = useInvoiceBasisSummary({ taskId }, completed, onSummary, enabled);
  const [target, setTarget] = useState<InvoiceBasisTarget | null>(null);
  const reasonId = useId();
  if (!summary) return { button: null, status: null, open: null, reason: null, reasonId };
  const latest = summary.bases[0];
  const makesNew = summary.canEdit && (!latest || !summary.newReason);
  // With nothing more to take the button opens the basis; the reason says why there is no new one.
  const notes = [summary.newReason, summary.quoteNote].filter(Boolean);
  // Förenkling 0.77.0: the button at the top and the one in Nästa steg (2026-11-06) follow one rule – both inactive with the
  // same reason while there is nothing to take and no basis yet (it stood inactive at the top and active in Nästa steg).
  const reason = makesNew ? summary.newReason || null : null;
  const open = makesNew ? () => setTarget({ proposal: { taskId } }) : latest ? () => setTarget({ id: latest.id }) : null;
  return {
    open, reason, reasonId,
    button: !makesNew && !latest ? null : <>
      <Button type="button" variant="outline" disabledReason={reason} aria-describedby={reason ? reasonId : undefined} onClick={() => open?.()} data-testid={makesNew ? "invoice-basis-new" : "invoice-basis-open"}><Receipt />Fakturaunderlag</Button>
      <InvoiceBasisModal target={target} open={Boolean(target)} onClose={() => setTarget(null)} onChanged={() => void load()} />
    </>,
    status: !summary.bases.length && !notes.length ? null : <div className="w-full space-y-2 border-t pt-3" data-testid="invoice-basis-panel">
      <p className="text-sm font-semibold">Fakturering</p>
      {notes.map((note) => <p key={note} id={note === reason ? reasonId : undefined} className="text-xs leading-5 text-muted-foreground" data-testid="invoice-basis-note">{note}</p>)}
      {summary.bases.length ? <ul className="divide-y rounded-xl border bg-card">{summary.bases.map((item) => <li key={item.id} data-testid="invoice-basis-item">
        <button type="button" className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[inherit] px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-secondary/60" onClick={() => setTarget({ id: item.id })}>
          <span className="min-w-0 font-medium">{item.label}</span>
          <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", indicatorBadge(statusTone(item.status)))}>{invoiceBasisStatusText(item, invoiceDay)}</span>
        </button>
        {InvoiceOfBasisStatus ? <InvoiceOfBasisStatus basisId={item.id} /> : null}
      </li>)}</ul> : null}
    </div>,
  };
}

/** Level 2–3: the panel on a project (`projectId`). */
export function InvoiceBasisPanel({ taskId, projectId, completed, onSummary }: InvoiceBasisRef & { completed?: boolean; onSummary?: (summary: InvoiceBasisSummary) => void }) {
  const native = useNativeMode();
  const { summary, load } = useInvoiceBasisSummary({ taskId, projectId }, completed, onSummary);
  const [target, setTarget] = useState<InvoiceBasisTarget | null>(null);
  const reasonId = useId();
  // The view's page marker (&page=fakturaunderlag) stays in the address, but a reload or a direct link has no basis to open:
  // the stray marker is removed once, so the address and the page agree (PRJ-07, 2026-10-18).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("page") !== "fakturaunderlag") return;
    url.searchParams.delete("page");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);
  if (native || !summary) return null;
  // A job shows the panel once it is finished, or while it has bases (a job reopened after invoicing).
  if (taskId && !completed && !summary.bases.length) return null;
  const marked = markedText(summary.marked);
  const notes = [summary.notCompleted, summary.quoteNote].filter(Boolean);
  const ref: InvoiceBasisRef = taskId ? { taskId } : { projectId };
  return <Panel icon={Receipt} title="Fakturaunderlag" description={marked || (projectId ? "Tid × timpris, material och utgifter från projektets färdigställda arbetsordrar. Belopp exklusive moms." : "Tid × timpris, material och utgifter från jobbet. Belopp exklusive moms.")}
    actions={summary.canEdit ? <Button type="button" variant="outline" disabledReason={summary.newReason || null} aria-describedby={summary.newReason ? reasonId : undefined}
      onClick={() => setTarget({ proposal: ref })} data-testid="invoice-basis-new"><Plus />Nytt fakturaunderlag</Button> : undefined}>
    <div className="space-y-3" data-testid="invoice-basis-panel">
      {summary.canEdit ? <DisabledReason id={reasonId} reason={summary.newReason} /> : null}
      {notes.map((note) => <p key={note} className="text-xs leading-5 text-muted-foreground" data-testid="invoice-basis-note">{note}</p>)}
      {!summary.bases.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Inga fakturaunderlag än.</p> : <ul className="divide-y rounded-xl border bg-card">
        {summary.bases.map((item) => <li key={item.id} data-testid="invoice-basis-item">
          {/* The whole row opens the basis (a touch target over the row, not only its text). */}
          <button type="button" className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[inherit] px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-secondary/60" onClick={() => setTarget({ id: item.id })}>
            <span className="min-w-0 font-medium">
              {item.label} · {item.title}{projectId && item.scope === "task" ? <span className="font-normal text-muted-foreground"> (arbetsordern)</span> : taskId && item.scope === "project" ? <span className="font-normal text-muted-foreground"> (projektet)</span> : null}
            </span>
            <span className="flex items-center gap-3">
              <span className="tabular-nums">{formatSek(item.net)} kr</span>
              <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", indicatorBadge(statusTone(item.status)))}>{invoiceBasisStatusText(item, invoiceDay)}</span>
              <RowChevron />
            </span>
          </button>
        </li>)}
      </ul>}
    </div>
    <InvoiceBasisModal target={target} open={Boolean(target)} onClose={() => setTarget(null)} onChanged={() => void load()} />
  </Panel>;
}

/** Level 1 on a phone: the row "Fakturaunderlag" in the job's or project's menu, which opens the bases as a screen. */
export function InvoiceBasisNativeRow({ taskId, projectId, completed, onSummary, button = false }: InvoiceBasisRef & { completed?: boolean; onSummary?: (summary: InvoiceBasisSummary) => void; /** A button in Nästa steg on a finished job (2026-11-06) instead of the menu row. */ button?: boolean }) {
  const { summary, load } = useInvoiceBasisSummary({ taskId, projectId }, completed, onSummary);
  const [open, setOpen] = useState(false);
  if (!summary || (taskId && !completed && !summary.bases.length)) return null;
  const marked = markedText(summary.marked);
  return <>
    {button ? <Button type="button" onClick={() => setOpen(true)} data-testid="native-next-step-invoice"><Receipt />Fakturaunderlag</Button>
      : <ListRow type="quote" icon={Receipt} title="Fakturaunderlag" subtitle={marked || (summary.bases.length ? undefined : "Inga underlag än")}
        value={summary.bases.length ? String(summary.bases.length) : undefined} onClick={() => setOpen(true)} testId="native-row-faktura" />}
    <InvoiceBasisModal target={null} open={open} native summary={summary} subject={taskId ? { taskId } : { projectId }} onClose={() => setOpen(false)} onChanged={() => void load()} />
  </>;
}
