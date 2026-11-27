"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { formatSwedishDate } from "@/lib/swedish-time";
import { workOrderChoiceAllowed, workOrderOptionsQuery, workflowTaskHref, type WorkOrderOption } from "@/lib/workflow/work-order-link";

/** The task as the field needs it: what decides which work orders it may belong to. */
export type WorkOrderFieldTask = { id: string; kind: string; projectId: string | null; customerId: string | null; facilityId?: string | null; workOrderId: string | null };

/**
 * Arbetsorder (2026-10-26, Arbetsordern styr; was "Hör till arbetsorder", Fas 2 2026-10-08): the work order a task
 * is in, and the choice to move it to another open one – never none, a task always has a work order. Searchable when there
 * are many; Cloud and the demo ask the server (bounded), Local passes the orders in its file. Moving takes the new order's
 * customer and project (the editor does that); the server checks the same rules again.
 */
export function WorkOrderField({ id, task, current, local, disabled = false, onChange }: {
  id: string;
  task: WorkOrderFieldTask;
  /** The order the task belongs to now, as the server sent it (its title is empty without read on work orders). */
  current: { id: string; title: string; status: string; readable?: boolean } | null;
  /** Local: the file's work orders; Cloud and the demo read them from the server. */
  local?: WorkOrderOption[];
  disabled?: boolean;
  onChange: (option: WorkOrderOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [fetched, setFetched] = useState<WorkOrderOption[]>([]);
  const [failed, setFailed] = useState("");
  const params = workOrderOptionsQuery(task, query);
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
  const options = useMemo(() => (local ?? fetched).filter((option) => option.id === task.workOrderId
    || (workOrderChoiceAllowed(task, option) && (!local || !needle || option.title.toLocaleLowerCase("sv-SE").includes(needle)))), [fetched, local, needle, task]);
  const chosen = options.find((option) => option.id === task.workOrderId);
  const baseLabel = (option: WorkOrderOption) => [option.title, option.customerName, option.projectName].filter(Boolean).join(" · ") + (option.status === "COMPLETED" ? " (färdigställd)" : "");
  // Orders that read exactly the same are told apart by a number (KTR-12), so the list never holds identical rows.
  const numbers = useMemo(() => {
    // First the creation day tells equal names apart ("… · skapad 12 okt."), then a number for what still reads the same.
    const count = new Map<string, number>();
    for (const option of options) count.set(baseLabel(option), (count.get(baseLabel(option)) ?? 0) + 1);
    const dated = (option: WorkOrderOption) => (count.get(baseLabel(option)) ?? 0) > 1 && option.createdAt ? `${baseLabel(option)} · skapad ${formatSwedishDate(option.createdAt, { day: "numeric", month: "short" })}` : baseLabel(option);
    const seen = new Map<string, number>();
    const total = new Map<string, number>();
    for (const option of options) total.set(dated(option), (total.get(dated(option)) ?? 0) + 1);
    const result = new Map<string, string>();
    for (const option of options) { const text = dated(option); const nth = (seen.get(text) ?? 0) + 1; seen.set(text, nth); result.set(option.id, (total.get(text) ?? 0) > 1 ? `${text} (${nth})` : text); }
    return result;
  }, [options]);
  const label = (option: WorkOrderOption) => numbers.get(option.id) ?? baseLabel(option);
  const searchable = Boolean(query) || options.length > 8;
  // A block label with the shared 6 px step, level with the fields beside it (QA 2026-10-10).
  return <div className="space-y-1.5 text-xs font-medium text-muted-foreground" data-testid="work-order-field">
    <label htmlFor={`${id}-work-order`} className="block">Arbetsorder</label>
    {searchable && !disabled ? <Input type="search" aria-label="Sök arbetsorder" placeholder="Sök arbetsorder" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} /> : null}
    <div className="flex gap-2">
      <select id={`${id}-work-order`} className="form-select min-w-0 flex-1" value={task.workOrderId ?? ""} disabled={disabled}
        onChange={(event) => { const option = options.find((item) => item.id === event.target.value); if (option) onChange(option); }}>
        {!task.workOrderId ? <option value="">Välj arbetsorder</option> : null}
        {/* The order the task belongs to stays visible while the choices are read (or when the person may not read it). */}
        {task.workOrderId && !chosen ? <option value={task.workOrderId}>{current?.title || (current?.readable === false ? "Arbetsorder" : "Hämtar arbetsorder…")}</option> : null}
        {options.map((option) => <option key={option.id} value={option.id}>{label(option)}</option>)}
      </select>
      {task.workOrderId && current?.readable !== false ? <Button asChild variant="outline" size="icon" className="size-[var(--control-h)] shrink-0"><Link href={workflowTaskHref({ id: task.workOrderId, kind: "WORK_ORDER" })} aria-label="Öppna arbetsordern" title="Öppna arbetsordern" data-testid="work-order-open"><ExternalLink /></Link></Button> : null}
    </div>
    <p className="font-normal" data-testid="work-order-field-note">{failed || "Tiden räknas på arbetsordern. Kund och projekt följer arbetsordern."}</p>
  </div>;
}
