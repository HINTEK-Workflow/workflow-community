"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/features/kfid/api";
import { keepLoadedPages, useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { swedishDayKey } from "@/lib/swedish-time";
import { parseWorkItemType, parseWorkOrderOrigin, WORK_ITEM_FILTERS, WORK_ITEM_TYPE_LABEL, WORK_ITEM_TYPES, WORK_ORDER_ORIGIN_LABEL, WORK_ORDER_ORIGINS, workItemKindMatches, workItemTypeKind, workOrderOriginMatches, type WorkItemFilter, type WorkItemType, type WorkOrderOrigin } from "@/lib/workflow/work-items";
import { completedFrom, listWork, WORK_FILTER_LABEL, WORK_LIST_PAGE_SIZE, workListScopes, workStateMatches, type WorkState } from "@/lib/workflow/work-list";
import { WorkList, useWorkListPrefs, type WorkListExtraFilter } from "./work-list";
import { isUrgentOpen, MAINTENANCE_PRIORITIES, MAINTENANCE_PRIORITY_LABELS, MAINTENANCE_TYPES, MAINTENANCE_TYPE_LABELS, type MaintenanceListFilter } from "@/lib/workflow/maintenance";
import { listDate, taskKindLabel, taskListItem, taskWorkState, type TaskListSource } from "./work-list-items";
import { useEntryState } from "@/components/history-nav";
import { useAddressEntryState } from "@/components/use-address-filter";
import { allowedFilter, filterDay } from "@/lib/url-filters";
import { useNativeMode } from "./use-detail-level";

type Page = { items: TaskListSource[]; total: number; page: number; pages: number; counts: Record<WorkItemFilter, number> | null };

const COPY = {
  tasks: {
    // The list is called as its menu button (2026-10-23); Mina / Alla is the list's own choice.
    title: "Uppgifter",
    mine: "Uppgifter som är tilldelade till dig, och de du har skapat utan ansvarig.",
    all: "Alla uppgifter du har behörighet att se i företaget.",
    filterLabel: "Filtrera uppgifter", searchLabel: "Sök bland uppgifter", searchPlaceholder: "Sök uppgift, projekt, kund eller ansvarig",
    create: { href: "/?view=new_task", label: "Ny uppgift" },
  },
  work_orders: {
    title: "Arbetsordrar",
    mine: "Arbetsordrar som är tilldelade till dig, och de du har skapat utan ansvarig.",
    all: "Alla arbetsordrar du har behörighet att se i företaget.",
    filterLabel: "Filtrera arbetsordrar", searchLabel: "Sök bland arbetsordrar", searchPlaceholder: "Sök rubrik, kund, projekt eller ansvarig",
    create: { href: "/?view=workflow_task&taskType=WORK_ORDER", label: "Ny arbetsorder" },
  },
} as const;

/**
 * Mina uppgifter and Mina arbetsordrar on the shared list (2026-10-05). Cloud reads one page at a time from
 * /api/work-items, which checks the scope against the member's permissions; Local and the demo's in-memory data use
 * the same rules (lib/workflow/work-list.ts). Work orders are the same list limited to work orders.
 *
 * En jobblista på nivå 1 (B3, 2026-10-21): in the app look the Jobb tab ("tasks") is the one list of work orders and
 * tasks, with Typ (Alla · Arbetsordrar · Uppgifter) behind the Filter row, and with Arbetsordrar chosen also the work
 * orders' own Typ av underhåll and Prioritet. The old Mina arbetsordrar address opens it with Arbetsordrar chosen
 * (`?type=work_orders`). The computer's and the tablet's lists are unchanged.
 */
export function TaskWorkList({ list, personId, canCreate, canReadArea, types = false, empty, local }: {
  list: "tasks" | "work_orders";
  personId: string;
  canCreate: boolean;
  /** Read permission in the list's area; "Alla" is offered only then (the server checks it again). */
  canReadArea: boolean;
  /** The type filter of the Jobb tab: only for someone who may read work orders and other kinds (workItemTypesOffered). */
  types?: boolean;
  empty: ReactNode;
  /** Local: the open file's tasks; everything in a Local file is the owner's. */
  local?: { tasks: TaskListSource[] };
}) {
  const copy = COPY[list];
  const native = useNativeMode();
  const address = useSearchParams();
  const scopes = useMemo(() => workListScopes({ canReadArea }), [canReadArea]);
  const prefs = useWorkListPrefs(list, personId, scopes);
  const { scope, sort, view } = prefs;
  // Search and filters come back with a step back from a row (2026-10-09), kept per visit of the list.
  // Filter, Typ, Mina / Alla and "Färdigställda från" may come from the address (dashboard etapp 3, 2026-10-28: a key
  // figure opens this list with its own filter; lib/url-filters.ts); a choice made on the visit wins after that.
  const [filter, setFilter] = useAddressEntryState<WorkItemFilter>(`${list}.filter`, "filter", (raw) => allowedFilter(raw, WORK_ITEM_FILTERS), "open");
  const [doneFrom, setDoneFrom] = useAddressEntryState(`${list}.from`, "from", filterDay, "");
  const [query, setQuery] = useEntryState(`${list}.query`, "");
  const [upkeep, setUpkeep] = useEntryState<MaintenanceListFilter>(`${list}.upkeep`, { mtype: "", priority: "" });
  // Rondordrar (2026-10-26): the work orders of rounds, the others, or one round's (`&round=` from Driftronder).
  const [origin, setOrigin] = useEntryState<WorkOrderOrigin>(`${list}.origin`, address.get("round") ? "rounds" : "");
  const round = list === "work_orders" ? address.get("round")?.slice(0, 100) || null : null;
  const originFilter = list === "work_orders" ? parseWorkOrderOrigin(origin) : "";
  // The type a visit starts with comes from the address (the old Mina arbetsordrar, a key figure); a choice made on the visit wins after that.
  const [chosenType, setType] = useAddressEntryState<WorkItemType>(`${list}.type`, "type", (raw) => allowedFilter(raw, WORK_ITEM_TYPES), "all");
  // Uppgifter on a computer and a tablet lists only tasks – work orders have their own menu button (2026-10-23:
  // "arbetsordrar under Uppgifter" was left from when a work order was a kind of task). The phone's Jobb tab (B3) shows
  // both with Typ. A key figure counts every kind, so an address with `type` (dashboard etapp 3) gives the computer the
  // same list with Typ, too.
  const typeFromAddress = list === "tasks" && allowedFilter(address.get("type"), WORK_ITEM_TYPES) !== null;
  const withTypes = list === "tasks" && types && (native || typeFromAddress);
  const type: WorkItemType = withTypes || typeFromAddress ? parseWorkItemType(chosenType) : list === "tasks" && !native ? "tasks" : "all";
  const kind = list === "work_orders" ? "WORK_ORDER" as const : workItemTypeKind(type);
  // Underhåll (2026-10-06; the facts on maintenance items since 2026-10-30): Mina arbetsordrar filters on the items'
  // type and priority; the Jobb tab does so when Arbetsordrar is chosen. Cloud and the demo only – Local has no items.
  const withUpkeep = !local && (list === "work_orders" || kind === "WORK_ORDER");
  const upkeepFilter = withUpkeep ? upkeep : { mtype: "" as const, priority: "" as const };
  const [search, setSearch] = useState(() => query.trim());
  const [localPage, setLocalPage] = useState(1);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState("");
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  // A new choice starts Local's list on page 1 again, set while rendering (React's "adjust state when a value changes").
  const listFor = JSON.stringify([scope, filter, search, sort, kind, upkeepFilter.mtype, upkeepFilter.priority, originFilter, round, doneFrom]);
  const [listSeen, setListSeen] = useState(listFor);
  if (listSeen !== listFor) { setListSeen(listFor); setLocalPage(1); }

  const localResult = useMemo(() => {
    if (!local) return null;
    const entries = local.tasks.filter((task) => workItemKindMatches(task.kind, kind) && workOrderOriginMatches(task, originFilter, round) && completedFrom(task, doneFrom)).map((task) => ({
      ...task, date: task.dueDate ?? "", state: taskWorkState(task) as WorkState, mine: task.isMine !== false,
      urgent: task.kind === "WORK_ORDER" && isUrgentOpen(task.status, task.maintenance),
      search: [task.title, task.projectName ?? "", task.customerName ?? "", task.responsibleName ?? task.assignedToName ?? "", taskKindLabel(task.kind), task.workOrderTitle ?? ""],
    }));
    const result = listWork(entries, { filters: WORK_ITEM_FILTERS, matches: workStateMatches, filter, scope, sort, q: search, page: 1, limit: WORK_LIST_PAGE_SIZE * localPage });
    return { ...result, page: localPage };
  }, [local, kind, filter, scope, sort, search, localPage, upkeepFilter.mtype, upkeepFilter.priority, originFilter, round, doneFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Steg 7 (stabil sidladdning): the first page through the workspace's memory cache – Bakåt to the list draws the rows
  // kept from before at once (and the pages Visa fler added), while the same page is read again; a new choice keeps the
  // old rows (aria-busy) until its answer comes. "Visa fler" adds pages to what is kept.
  const listParams = (page: number) => new URLSearchParams({ scope, filter, sort, page: String(page), limit: String(WORK_LIST_PAGE_SIZE), ...(search ? { q: search } : {}), ...(kind ? { kind } : {}), ...(upkeepFilter.mtype ? { mtype: upkeepFilter.mtype } : {}), ...(upkeepFilter.priority ? { priority: upkeepFilter.priority } : {}), ...(originFilter ? { origin: originFilter } : {}), ...(round ? { round } : {}), ...(doneFrom ? { from: doneFrom } : {}) });
  const remoteKey = local ? null : `/api/work-items?${listParams(1)}`;
  const read = useWorkspaceData<Page>(remoteKey, (signal) => api<Page>(remoteKey!, { signal }), { keepPrevious: true, merge: keepLoadedPages });
  const remote = read.data ?? null;
  const busy = read.fetching || moreBusy;
  const error = read.error || moreError;
  async function more(current: Page) {
    setMoreBusy(true);
    try {
      const next = await api<Page>(`/api/work-items?${listParams(current.page + 1)}`);
      read.mutate((previous) => previous ? { ...next, items: [...previous.items, ...next.items.filter((item) => !previous.items.some((seen) => seen.id === item.id))] } : next);
      setMoreError("");
    } catch (issue) {
      setMoreError((issue as Error).message);
    } finally {
      setMoreBusy(false);
    }
  }

  const shown = local ? localResult : remote;
  const today = swedishDayKey(new Date());
  const items = shown ? shown.items.map((task) => taskListItem(task, today)) : null;
  const counts = shown?.counts ?? null;
  // Typ first, as the Jobb tab's own question; "" is Alla, like the other extra filters, so Rensa filter clears it too.
  const typeFilters: WorkListExtraFilter[] = withTypes ? [{ key: "type", label: "Typ", testId: "work-type", value: type === "all" ? "" : type,
    options: WORK_ITEM_TYPES.map((value) => ({ value: value === "all" ? "" : value, label: WORK_ITEM_TYPE_LABEL[value] })),
    onChange: (value) => setType(parseWorkItemType(value)) }] : [];
  const upkeepFilters: WorkListExtraFilter[] = withUpkeep ? [
    // Short labels that fit half a phone row (D3, UX punkt 8: "Alla typer av und…" at 390 px); beside the Jobb list's own Typ
    // the maintenance type is called Underhåll.
    { key: "mtype", label: withTypes ? "Underhåll" : "Typ", testId: "work-order-maintenance-type", className: "sm:w-48 sm:flex-none", value: upkeep.mtype,
      options: [{ value: "", label: "Alla typer" }, ...MAINTENANCE_TYPES.map((value) => ({ value, label: MAINTENANCE_TYPE_LABELS[value] }))],
      onChange: (value) => setUpkeep((current) => ({ ...current, mtype: value as MaintenanceListFilter["mtype"] })) },
    { key: "priority", label: "Prioritet", testId: "work-order-maintenance-priority", className: "sm:w-44 sm:flex-none", value: upkeep.priority,
      options: [{ value: "", label: "Alla prioriteter" }, ...MAINTENANCE_PRIORITIES.map((priority) => ({ value: priority, label: MAINTENANCE_PRIORITY_LABELS[priority] }))],
      onChange: (value) => setUpkeep((current) => ({ ...current, priority: value as MaintenanceListFilter["priority"] })) },
  ] : [];
  const originFilters: WorkListExtraFilter[] = list === "work_orders" ? [{ key: "origin", label: "Ursprung", testId: "work-order-origin", className: "sm:w-44 sm:flex-none", value: round ? "rounds" : originFilter,
    options: WORK_ORDER_ORIGINS.map((value) => ({ value, label: WORK_ORDER_ORIGIN_LABEL[value] })), onChange: (value) => setOrigin(parseWorkOrderOrigin(value)) }] : [];
  // "Klara, 30 dagar" (dashboard etapp 3): only while a day is chosen, so the list says why older completed jobs are missing;
  // Alla datum (or Rensa filter) shows every completed job again.
  const fromFilters: WorkListExtraFilter[] = doneFrom ? [{ key: "from", label: "Färdigställda", testId: "work-done-from", className: "sm:w-52 sm:flex-none", value: doneFrom,
    options: [{ value: "", label: "Alla datum" }, { value: doneFrom, label: `Från ${listDate(doneFrom)}` }], onChange: (value) => setDoneFrom(filterDay(value) ?? "") }] : [];
  const extraFilters = [...typeFilters, ...upkeepFilters, ...originFilters, ...fromFilters];
  return <WorkList
    list={list} testId={list === "tasks" ? "task" : "work-order"}
    title={copy.title} description={scope === "all" ? copy.all : copy.mine}
    create={canCreate ? copy.create : null}
    scopes={scopes} scope={scope} onScope={(value) => prefs.update({ scope: value })}
    filterLabel={copy.filterLabel} filter={filter} onFilter={setFilter}
    filters={WORK_ITEM_FILTERS.map((value) => ({ value, label: WORK_FILTER_LABEL[value], count: counts ? counts[value] ?? 0 : null }))}
    query={query} onQuery={(value) => { setQuery(value); if (value.trim() && filter !== "all") setFilter("all"); }}
    searchLabel={copy.searchLabel} searchPlaceholder={copy.searchPlaceholder}
    sort={sort} onSort={(value) => prefs.update({ sort: value })}
    view={view} onView={(value) => prefs.update({ view: value })}
    items={items} total={shown?.total ?? 0} busy={busy} error={error}
    onMore={() => { if (local) setLocalPage((page) => page + 1); else if (remote) void more(remote); }}
    // A chosen type that has nothing says "Inget matchar urvalet", not that there is no work at all.
    isEmpty={Boolean(counts && counts.all === 0 && !search && type === "all" && !upkeepFilter.mtype && !upkeepFilter.priority && !originFilter && !round && !doneFrom)} empty={empty}
    priorityColumn={list === "work_orders"}
    extraFilters={extraFilters.length ? extraFilters : undefined}
  />;
}
