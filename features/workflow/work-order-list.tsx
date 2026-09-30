"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarClock, ClipboardList, Plus, Search, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { ShowMore } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { formatSwedish } from "@/lib/swedish-time";
import type { WorkItemFilter } from "@/lib/workflow/work-items";
import { listWorkOrders, type WorkOrderRow, type WorkOrderScope, type WorkOrderSource } from "@/lib/workflow/work-orders";
import { indicatorBadge, indicatorBar, type IndicatorTone } from "./indicator-tone";

type Page = { items: WorkOrderRow[]; total: number; page: number; pages: number; counts: Record<WorkItemFilter, number> };

const FILTERS: [WorkItemFilter, string][] = [["open", "Öppna"], ["active", "Pågår"], ["planned", "Planerade"], ["action", "Behöver åtgärdas"], ["done", "Slutförda"], ["all", "Alla"]];
const STATUS: Record<string, [string, IndicatorTone]> = {
  PLANNED: ["Planerad", "neutral"], IN_PROGRESS: ["Pågår", "warning"], PAUSED: ["Pausad", "neutral"], NEEDS_ACTION: ["Behöver åtgärdas", "danger"], COMPLETED: ["Slutförd", "success"],
};
const NEW_WORK_ORDER = "/?view=workflow_task&taskType=WORK_ORDER";
const openHref = (row: WorkOrderRow) => `/?view=workflow_task&taskId=${encodeURIComponent(row.id)}&taskType=WORK_ORDER`;
const planned = (row: WorkOrderRow) => row.plannedAt ? formatSwedish(row.plannedAt, { dateStyle: "short", timeStyle: "short" }) : "";

/**
 * Mina arbetsordrar (2026-09-26): work orders as their own workflow, with status, customer, responsible,
 * planned date and project. Cloud reads one page at a time from the server; Local lists the open file with the same rules.
 */
export function WorkOrderList({ canCreate, local }: { canCreate: boolean; local?: { tasks: WorkOrderSource[]; userId: string } }) {
  const [scope, setScope] = useState<WorkOrderScope>("mine");
  const [filter, setFilter] = useState<WorkItemFilter>("open");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [localPage, setLocalPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const timer = setTimeout(() => setSearch(query), 250); return () => clearTimeout(timer); }, [query]);

  const localResult = useMemo(() => {
    if (!local) return null;
    // Local pages the rendering only; the file is already in memory.
    const pages = Array.from({ length: localPage }, (_, index) => listWorkOrders(local.tasks, { scope, filter, q: search, page: index + 1, userId: local.userId }));
    return { ...pages[pages.length - 1], items: pages.flatMap((item) => item.items) };
  }, [local, scope, filter, search, localPage]);

  async function load(next: number, append: boolean) {
    setBusy(true); setError("");
    try {
      const result = await api<Page>(`/api/work-orders?scope=${scope}&filter=${filter}&page=${next}${search ? `&q=${encodeURIComponent(search)}` : ""}`);
      setPage((current) => append && current ? { ...result, items: [...current.items, ...result.items] } : result);
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { if (!local) void load(1, false); }, [scope, filter, search, local]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLocalPage(1); }, [scope, filter, search]);
  const shown = local ? localResult : page;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="page-title">Mina arbetsordrar</h1><p className="page-description mt-2">Arbetsordrar med status, kund, ansvarig, planerat datum och projekt. Välj Alla för att se hela företagets arbetsordrar.</p></div>
      {canCreate ? <Button asChild><Link href={NEW_WORK_ORDER}><Plus />Ny arbetsorder</Link></Button> : null}
    </div>
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-2.5 shadow-xs xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex shrink-0 rounded-lg border p-0.5" role="group" aria-label="Visa arbetsordrar">{([["mine", "Mina"], ["all", "Alla"]] as const).map(([value, label]) => <Button key={value} type="button" size="sm" variant={scope === value ? "secondary" : "ghost"} aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</Button>)}</div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 xl:flex-wrap xl:overflow-visible" role="group" aria-label="Filtrera arbetsordrar">{FILTERS.map(([value, label]) => <Button key={value} type="button" size="sm" variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} ({shown?.counts[value] ?? 0})</Button>)}</div>
      </div>
      <div className="relative xl:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input type="search" aria-label="Sök bland arbetsordrar" placeholder="Sök rubrik, kund, projekt eller ansvarig" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" /></div>
    </div>
    {!shown ? <p role="status" className="text-sm text-muted-foreground">Hämtar arbetsordrar…</p> : shown.items.length ? <>
      {/* Desktop: a dense table. Phone and tablet: one card per work order. */}
      <div className="hidden overflow-hidden rounded-xl border bg-card shadow-xs lg:block" aria-busy={busy}>
        <table className="w-full text-sm" data-testid="work-order-table">
          <thead><tr className="bg-[var(--panel-header)] text-left text-xs text-muted-foreground">
            <th className="px-4 py-2.5 font-semibold">Arbetsorder</th><th className="px-3 py-2.5 font-semibold">Status</th><th className="px-3 py-2.5 font-semibold">Kund</th>
            <th className="px-3 py-2.5 font-semibold">Ansvarig</th><th className="px-3 py-2.5 font-semibold">Planerat</th><th className="px-3 py-2.5 font-semibold">Klart senast</th><th className="px-3 py-2.5 font-semibold">Projekt</th><th className="w-10" />
          </tr></thead>
          <tbody>{shown.items.map((row) => <tr key={row.id} className="border-t transition-colors hover:bg-muted/40">
            <td className="max-w-72 px-4 py-2.5"><Link href={openHref(row)} className="line-clamp-2 font-medium hover:text-primary hover:underline">{row.title}</Link><Progress row={row} /></td>
            <td className="px-3 py-2.5"><StatusBadge status={row.status} /></td>
            <td className="px-3 py-2.5 text-muted-foreground">{row.customerName || "–"}</td>
            <td className="px-3 py-2.5 text-muted-foreground">{row.assignedToName || "Inte tilldelad"}</td>
            <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{planned(row) || "–"}</td>
            <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{row.dueDate || "–"}</td>
            <td className="px-3 py-2.5">{row.projectId && row.projectName ? <Link href={`/?view=project&projectId=${encodeURIComponent(row.projectId)}`} className="text-muted-foreground hover:text-primary hover:underline">{row.projectName}</Link> : <span className="text-muted-foreground">Fristående</span>}</td>
            <td className="pr-3"><Link href={openHref(row)} aria-label={`Öppna ${row.title}`} className="text-primary"><ArrowRight className="size-4" /></Link></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:hidden" aria-busy={busy} data-testid="work-order-cards">{shown.items.map((row) => <Link key={row.id} href={openHref(row)} className="workflow-card group flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-feature-control-soft text-feature-control"><ClipboardList className="size-4" /></span>
          <div className="min-w-0 flex-1"><h2 className="line-clamp-2 text-sm font-semibold group-hover:text-primary">{row.title}</h2><p className="mt-0.5 truncate text-xs text-muted-foreground">{row.customerName || "Ingen kund"} · {row.projectName ? `Projekt: ${row.projectName}` : "Fristående"}</p></div>
          <StatusBadge status={row.status} />
        </div>
        <dl className="grid grid-cols-2 gap-2 text-xs"><div className="flex items-center gap-1.5 text-muted-foreground"><UserRound className="size-3.5" /><dd className="truncate">{row.assignedToName || "Inte tilldelad"}</dd></div><div className="flex items-center gap-1.5 text-muted-foreground"><CalendarClock className="size-3.5" /><dd className="truncate">{planned(row) || (row.dueDate ? `Klart senast ${row.dueDate}` : "Inget datum")}</dd></div></dl>
        <Progress row={row} />
      </Link>)}</div>
      {local ? shown.total > shown.items.length ? <div className="flex justify-center"><Button type="button" variant="outline" onClick={() => setLocalPage((current) => current + 1)}>Visa fler</Button></div> : null
        : <ShowMore shown={shown.items.length} total={shown.total} busy={busy} onMore={() => page && void load(page.page + 1, true)} />}
    </> : <div className="rounded-xl border border-dashed bg-card/60 px-5 py-10 text-center">
      <ClipboardList className="mx-auto size-7 text-primary" />
      <p className="mt-3 text-sm font-semibold">{shown.counts.all ? "Inga arbetsordrar matchar urvalet" : scope === "mine" ? "Du har inga arbetsordrar ännu" : "Företaget har inga arbetsordrar ännu"}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{shown.counts.all ? "Ändra filter eller sökning." : "Skapa en arbetsorder fristående eller i ett projekt. Den visas här med status, kund och planerat datum."}</p>
      {canCreate && !shown.counts.all ? <Button asChild className="mt-4" size="sm"><Link href={NEW_WORK_ORDER}><Plus />Ny arbetsorder</Link></Button> : null}
    </div>}
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  const [label, tone] = STATUS[status] ?? [status, "neutral"];
  return <Badge variant="outline" className={cn("shrink-0", indicatorBadge(tone))}>{label}</Badge>;
}

function Progress({ row }: { row: WorkOrderRow }) {
  const value = row.status === "COMPLETED" ? 100 : Math.min(95, Math.max(0, row.progress));
  return <div className="mt-1.5 flex items-center gap-2"><div className="h-1 w-24 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", indicatorBar(row.status === "COMPLETED" ? "success" : row.status === "NEEDS_ACTION" ? "danger" : "info"))} style={{ width: `${value}%` }} /></div><span className="text-[11px] text-muted-foreground">{value}%</span></div>;
}
