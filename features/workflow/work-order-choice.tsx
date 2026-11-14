"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-shell";
import { ListEmpty, ListGroup, ListRow, NativePage, NativeSearch } from "@/components/native";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { useHere, usePicked, useReturnTo } from "@/features/kfid/use-return-to";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { formatSwedishDate } from "@/lib/swedish-time";
import { withReturn } from "@/lib/workflow/return-link";
import { withParam } from "@/lib/workflow/navigation";
import { workOrderOptionsQuery, type WorkOrderOption } from "@/lib/workflow/work-order-link";

/**
 * "Vilken arbetsorder?" (2026-10-26, svar 3b): Ny uppgift starts with the work order the task goes into – an open one
 * (the latest first, searchable) or Ny arbetsorder, which opens a new work order and comes back here with it chosen
 * (`pickTask`, the samband rule). Nothing is made without the person knowing. Shown by Ny uppgift and by a new task opened
 * without a work order; Cloud and the demo ask the server (bounded), Local passes the file's work orders.
 */
export function WorkOrderChoice({ context, local, canCreateWorkOrder, onChoose, title = "Ny uppgift" }: {
  /** The project, customer and place the task was opened with: a new work order starts with them, the list prefers them. */
  context: { projectId?: string | null; customerId?: string | null; facilityId?: string | null };
  local?: WorkOrderOption[];
  canCreateWorkOrder: boolean;
  onChoose: (option: Pick<WorkOrderOption, "id"> & Partial<WorkOrderOption>) => void;
  title?: string;
}) {
  const native = useNativeMode();
  const way = useReturnTo();
  const router = useRouter();
  const here = useHere();
  const [query, setQuery] = useState("");
  const [fetched, setFetched] = useState<WorkOrderOption[] | null>(null);
  const [failed, setFailed] = useState("");
  // Back from Ny arbetsorder with the new one marked: it is the choice.
  usePicked("Task", (id) => { onChoose({ id }); });
  const params = workOrderOptionsQuery({ projectId: context.projectId ?? null, customerId: context.customerId ?? null }, query);
  useEffect(() => {
    if (local) return;
    let active = true;
    const timer = window.setTimeout(() => {
      api<{ options: WorkOrderOption[] }>(`/api/workflow-tasks/work-order-links?${params}`)
        .then((result) => { if (active) { setFetched(result.options); setFailed(""); } })
        .catch((issue) => { if (active) setFailed((issue as Error).message); });
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [local, params, query]);
  const needle = query.trim().toLocaleLowerCase("sv-SE");
  const options = useMemo(() => (local ?? fetched ?? []).filter((option) => option.status !== "COMPLETED" && option.status !== "CANCELLED"
    && (!local || !needle || `${option.title} ${option.customerName ?? ""} ${option.projectName ?? ""}`.toLocaleLowerCase("sv-SE").includes(needle))), [fetched, local, needle]);
  const newOrderHref = withReturn(([["projectId", context.projectId], ["customerId", context.customerId], ["facilityId", context.facilityId]] as const)
    .reduce((href, [key, value]) => value ? withParam(href, key, value) : href, "/?view=workflow_task&taskType=WORK_ORDER"), here);
  const subtitle = (option: WorkOrderOption) => [option.customerName, option.projectName ? `Projekt ${option.projectName}` : "", option.createdAt ? `skapad ${formatSwedishDate(option.createdAt, { day: "numeric", month: "short" })}` : ""].filter(Boolean).join(" · ");
  const loading = !local && fetched === null && !failed;
  const empty = loading ? "Hämtar arbetsordrar…" : failed || (query ? "Ingen öppen arbetsorder matchar sökningen." : "Det finns ingen öppen arbetsorder. Skapa en ny.");
  const lead = "Uppgiften läggs i en arbetsorder. Välj en öppen arbetsorder eller skapa en ny.";

  if (native) return <NativePage testId="work-order-choice">
    <p className="px-1 pb-2 text-sm text-muted-foreground">{lead}</p>
    {canCreateWorkOrder ? <ListGroup><ListRow type="work-order" icon={Plus} title="Ny arbetsorder" href={newOrderHref} testId="work-order-choice-new" /></ListGroup> : null}
    <NativeSearch value={query} onChange={setQuery} label="Sök arbetsorder" placeholder="Sök arbetsorder" />
    <ListGroup title="Öppna arbetsordrar">
      {options.length ? options.map((option) => <ListRow key={option.id} type="work-order" title={option.title || "(utan rubrik)"} subtitle={subtitle(option) || undefined}
        onClick={() => onChoose(option)} testId="work-order-choice-option" />) : <ListEmpty>{empty}</ListEmpty>}
    </ListGroup>
  </NativePage>;

  return <div className="space-y-6" data-testid="work-order-choice">
    <PageHeader title={title} description={lead}
      actions={<>
        {/* Avbryt before the main action, which stands furthest right (one template for page tops, 2026-11-02). */}
        <Button type="button" variant="outline" onClick={() => { if (way) way.cancel(); else router.back(); }} data-testid="work-order-choice-cancel">Avbryt</Button>
        {canCreateWorkOrder ? <Button asChild><Link href={newOrderHref} data-testid="work-order-choice-new"><Plus />Ny arbetsorder</Link></Button> : null}
      </>} />
    <Panel icon={ClipboardList} title="Vilken arbetsorder?" description="De senast ändrade öppna arbetsordrarna först.">
      <Input type="search" aria-label="Sök arbetsorder" placeholder="Sök arbetsorder" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} />
      {options.length ? <ul className="-mx-4 mt-3 divide-y border-y">{options.map((option) => <li key={option.id}>
        <button type="button" onClick={() => onChoose(option)} data-testid="work-order-choice-option"
          className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-ring">
          <ClipboardList className="size-4 shrink-0 text-feature-control" aria-hidden="true" />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{option.title || "(utan rubrik)"}</span>
            {subtitle(option) ? <span className="block truncate text-xs text-muted-foreground">{subtitle(option)}</span> : null}</span>
          <span className="shrink-0 text-xs font-medium text-primary">Välj</span>
        </button>
      </li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground" role={failed ? "alert" : "status"}>{empty}</p>}
    </Panel>
  </div>;
}

/** The address of Ny uppgift (or a new task) with the chosen work order: its id and title, and its project, customer and place. */
export function withChosenWorkOrder(href: string, option: Pick<WorkOrderOption, "id"> & Partial<WorkOrderOption>) {
  let next = withParam(href, "workOrderId", option.id);
  if (option.title?.trim()) next = withParam(next, "workOrderTitle", option.title.trim().slice(0, 120));
  for (const [key, value] of [["projectId", option.projectId], ["customerId", option.customerId], ["facilityId", option.facilityId]] as const)
    if (value) next = withParam(next, key, value);
  return next;
}
