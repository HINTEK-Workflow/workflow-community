"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState, type ReactNode } from "react";
import { CalendarClock, ChevronRight, ClipboardCheck, ClipboardList, FolderKanban, MapPin, Plus, SlidersHorizontal, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AreaIcon } from "@/components/area-icon";
import { Button } from "@/components/ui/button";
import { ShowMore } from "@/features/kfid/ui";
import { DelayedSkeleton, RowsSkeleton } from "@/components/skeleton";
import { cn } from "@/lib/utils";
import { deviceClass } from "@/lib/workflow/detail-level";
import {
  defaultWorkListView, parseWorkListPrefs, resolveWorkListScope, WORK_LIST_SCOPE_LABEL, WORK_LIST_SORT_LABEL, WORK_LIST_SORTS,
  WORK_LIST_NAMES, workListPrefKey, type WorkListName, type WorkListPrefs,type WorkListScope, type WorkListSort, type WorkListView,
} from "@/lib/workflow/work-list";
import { workListStartScope, workViewStamp } from "@/lib/workflow/work-view";
import { useWorkView } from "./use-work-view";
import { indicatorBadge, indicatorBar, indicatorText, PILL_FIXED_WIDTH_MD, type IndicatorTone } from "./indicator-tone";
import { PageHeader } from "@/components/page-shell";
import { ActionHint, ListFilterBar, type ListExtraFilter } from "@/components/list-filter-bar";
import { WorkProfileNextSteps } from "@/features/workflow/work-profile-hints";
import { ListEmpty, ListGroup, ListRow, ListSkeleton, NativeLargeTitle, NativePage, NativePickerRow, NativeSearch, NativeSegmented, useNativeTopBar } from "@/components/native";
import { NATIVE_ROW_TYPE, nativeJobRow } from "./work-list-items";
import { PersonAvatars } from "./person-avatars";
import type { ProjectPerson } from "@/lib/workflow/project-people";
import { groupByDate, type TypeKey } from "@/lib/workflow/native-mode";
import { swedishDayKey } from "@/lib/swedish-time";
import { useNativeMode } from "./use-detail-level";
import { useAddressEntryState } from "@/components/use-address-filter";
import { allowedFilter } from "@/lib/url-filters";

/**
 * One row or card of work (2026-10-05): tasks, work orders and projects show the same things in the same
 * places – title, type, customer and place, responsible, date, status, progress and one action.
 */
export type WorkListItem = {
  key: string;
  href: string;
  title: string;
  icon: "task" | "work-order" | "project";
  kindLabel: string;
  /** "Projekt: X · Arbetsorder: Y", or a project's description. */
  context: string;
  customer: string;
  /** The register place, "Tillfällig: …" or both (listPlaceLabel), in the same column so rows stay aligned. */
  place: string;
  responsible: string;
  date: { label: string; value: string; tone?: IndicatorTone } | null;
  planned?: string;
  status: { label: string; tone: IndicatorTone };
  progress: { percent: number; tone: IndicatorTone; note?: ReactNode };
  action: string;
  /** Extra lines on the card only (a project's time budget). */
  cardExtra?: ReactNode;
  /** A work order's priority (Underhåll, 2026-10-06): its own column in the work order list, a badge on the card. */
  priority?: { label: string; tone: IndicatorTone } | null;
  /** An open work order marked Akut: a red edge on the row or card. */
  urgent?: boolean;
  /** Nivå 1 på mobil: the day the list groups by (booked, else due; YYYY-MM-DD), whether it is still open, and its icon colour. */
  day?: string;
  open?: boolean;
  type?: TypeKey;
  /** A project's people as name badges (2026-10-22): on the card, and in the row's Ansvarig column. */
  people?: readonly ProjectPerson[];
};

export type WorkListFilter<F extends string> = { value: F; label: string; count: number | null };
/** An extra filter: its name (the select's label), the choice "" = all first among the options, and the select's look. */
export type WorkListExtraFilter = ListExtraFilter;

function readPrefs(list: WorkListName, personId: string) {
  try { return parseWorkListPrefs(window.localStorage.getItem(workListPrefKey(list, personId))); } catch { return {}; }
}

/**
 * View, scope and sort remembered per person and list on this device (like Visningsnivå, which is per device): a phone
 * may show cards while the computer shows rows. Display only; the server decides what each scope contains.
 */
export function useWorkListPrefs(list: WorkListName, personId: string, scopes: readonly WorkListScope[]) {
  // Arbetsvy (2026-10-08): Mina or Alla starts as the admin's work view says, unless the person chose under that view.
  const workView = useWorkView();
  const [prefs, setPrefs] = useState(() => {
    if (typeof window === "undefined") return { view: "rows" as WorkListView, scope: scopes[0] ?? "mine", sort: "updated" as WorkListSort };
    const saved = readPrefs(list, personId);
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    return {
      view: saved.view ?? defaultWorkListView(deviceClass(window.innerWidth, touch, window.innerHeight)),
      scope: resolveWorkListScope(workListStartScope(saved, workView), scopes),
      sort: saved.sort ?? "updated" as WorkListSort,
    };
  });
  // Mina / Alla from the address (dashboard etapp 3, 2026-10-28: a key figure for Teamet opens Alla, for Jag Mina) holds
  // for the visit only and is not remembered; a scope the person may not choose is ignored. "" = none.
  const [visitScope, setVisitScope] = useAddressEntryState<WorkListScope | "">(`${list}.scope`, "scope", (raw) => allowedFilter(raw, scopes), "");
  const scope = resolveWorkListScope(visitScope || prefs.scope, scopes);
  const basis = workViewStamp(workView);
  // Only what the person chose is stored, so a view never chosen still follows the device. A chosen scope carries the
  // stamp of the view it was chosen under.
  const update = useCallback((change: Partial<typeof prefs>) => {
    const stored = { ...readPrefs(list, personId), ...change, ...(change.scope ? { basis } : {}) };
    try { window.localStorage.setItem(workListPrefKey(list, personId), JSON.stringify(stored)); } catch { /* storage is optional */ }
    if (change.scope) setVisitScope("");
    setPrefs((current) => ({ ...current, ...change }));
  }, [list, personId, basis, setVisitScope]);
  return { view: prefs.view, scope, sort: prefs.sort, update };
}

/** Återställ till standard (Arbetsvy, 2026-10-08): the remembered Mina/Alla of every list is forgotten on this device. */
export function forgetWorkListScopes(personId: string) {
  for (const list of WORK_LIST_NAMES) {
    try {
      const rest: WorkListPrefs = { ...readPrefs(list, personId) };
      delete rest.scope;
      delete rest.basis;
      window.localStorage.setItem(workListPrefKey(list, personId), JSON.stringify(rest));
    } catch { /* storage is optional */ }
  }
}

export { Segmented } from "@/components/list-filter-bar";

const WORK_LIST_SORT_OPTIONS = WORK_LIST_SORTS.map((value) => ({ value, label: WORK_LIST_SORT_LABEL[value] }));

const ICONS = { task: ClipboardCheck, "work-order": ClipboardList, project: FolderKanban } as const;
/** The icon standard (2026-10-24): a list row's icon is the shared soft square in its function's colour. */
function ItemIcon({ item }: { item: WorkListItem }) {
  return <AreaIcon area={item.type ?? NATIVE_ROW_TYPE[item.icon]} icon={ICONS[item.icon]} tone="soft" />;
}

/** `column`: the row's status column, where every pill has one width from md (PILL_FIXED_WIDTH_MD); a card's pill keeps its own. */
function StatusBadge({ status, column = false }: { status: WorkListItem["status"]; column?: boolean }) {
  return <Badge variant="outline" className={cn("max-w-full shrink-0", column && PILL_FIXED_WIDTH_MD, indicatorBadge(status.tone))}>{status.label}</Badge>;
}

function ProgressBar({ progress, wide = false }: { progress: WorkListItem["progress"]; wide?: boolean }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  return <div className="min-w-0">
    <div className="flex items-baseline justify-between gap-2 text-xs"><span className={cn("font-semibold tabular-nums", percent === 100 && indicatorText("success"))}>{percent}%</span>{wide && progress.note ? <span className="truncate text-muted-foreground">{progress.note}</span> : null}</div>
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", indicatorBar(progress.tone))} style={{ width: `${percent}%` }} /></div>
  </div>;
}

const dateText = (item: WorkListItem) => item.date ? `${item.date.label} ${item.date.value}` : "";
const where = (item: WorkListItem) => [item.customer, item.place].filter(Boolean).join(" · ");

/**
 * A row: status, progress and action sit in fixed columns so they line up whatever the text length
 * (2026-09-29). Phone: title and facts with status and progress under them; tablet: four columns; wide: all.
 */
// The work order list has one more fixed column, Prioritet, before Status (2026-10-06); the class names are
// written out in full so Tailwind finds them.
const HEAD_GRID = {
  plain: "md:grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_6.5rem] xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1fr)_6.5rem_8.5rem_6.5rem_6.5rem]",
  priority: "md:grid-cols-[minmax(0,1fr)_5rem_8.5rem_6.5rem_6.5rem] xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1fr)_6.5rem_5rem_8.5rem_6.5rem_6.5rem]",
} as const;
const CELLS = {
  plain: { status: "md:col-start-2 xl:col-start-5", progress: "md:col-start-3 xl:col-start-6", action: "md:col-start-4 xl:col-start-7" },
  priority: { status: "md:col-start-3 xl:col-start-6", progress: "md:col-start-4 xl:col-start-7", action: "md:col-start-5 xl:col-start-8" },
} as const;

function PriorityBadge({ priority }: { priority: WorkListItem["priority"] }) {
  return priority ? <Badge variant="outline" data-testid="work-priority" className={cn("max-w-full shrink-0", indicatorBadge(priority.tone), priority.tone === "danger" && "font-semibold")}>{priority.label}</Badge> : <span className="text-xs text-muted-foreground">–</span>;
}

function WorkRow({ item, priorityColumn = false }: { item: WorkListItem; priorityColumn?: boolean }) {
  const facts = [where(item), item.responsible, dateText(item)].filter(Boolean).join(" · ");
  const actionId = useId();
  const layout = priorityColumn ? "priority" : "plain";
  return <div role="row" data-work-key={item.key} data-urgent={item.urgent || undefined} className={cn("tap-card group grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-[var(--surface-hover)]", HEAD_GRID[layout], item.urgent && "bg-[color-mix(in_srgb,var(--destructive)_6%,transparent)]")}>
    <div role="cell" className="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
      <ItemIcon item={item} />
      <div className="min-w-0">
        <Link href={item.href} aria-describedby={actionId} className="stretched-link line-clamp-2 text-sm font-semibold group-hover:text-primary">{item.title}</Link>
        <p className="line-clamp-2 break-words text-xs text-muted-foreground">{[item.kindLabel, item.context].filter(Boolean).join(" · ")}</p>
        {facts ? <p className="line-clamp-2 break-words text-xs text-muted-foreground xl:hidden" title={facts}>{facts}</p> : null}
        {item.people?.length ? <div className="mt-1 xl:hidden"><PersonAvatars people={item.people} /></div> : null}
      </div>
    </div>
    {/* Shortened names and dates carry the whole text as a tooltip (plan 1A, 2026-10-11). */}
    <div role="cell" className="hidden min-w-0 text-xs text-muted-foreground xl:col-start-2 xl:row-start-1 xl:block"><p className="truncate" title={item.customer || undefined}>{item.customer || "Ingen kund"}</p>{item.place ? <p className="truncate" title={item.place}>{item.place}</p> : null}</div>
    {item.people ? <div role="cell" className="hidden min-w-0 xl:col-start-3 xl:row-start-1 xl:block"><PersonAvatars people={item.people} /></div>
      : <div role="cell" className="hidden min-w-0 truncate text-xs text-muted-foreground xl:col-start-3 xl:row-start-1 xl:block" title={item.responsible || undefined}>{item.responsible || "Inte tilldelad"}</div>}
    <div role="cell" className="hidden min-w-0 text-xs xl:col-start-4 xl:row-start-1 xl:block">{item.date ? <><p className="text-muted-foreground">{item.date.label}</p><p className={cn("tabular-nums", item.date.tone ? `font-semibold ${indicatorText(item.date.tone)}` : "text-foreground")}>{item.date.value}</p></> : <span className="text-muted-foreground">–</span>}</div>
    {priorityColumn ? <div role="cell" className="hidden min-w-0 md:col-start-2 md:row-start-1 md:block xl:col-start-5"><PriorityBadge priority={item.priority} /></div> : null}
    <div role="cell" className={cn("col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-1.5 md:row-start-1", CELLS[layout].status)}>{priorityColumn && item.priority ? <span className="md:hidden"><PriorityBadge priority={item.priority} /></span> : null}<StatusBadge status={item.status} column /></div>
    <div role="cell" className={cn("col-start-2 row-start-2 min-w-0 md:row-start-1", CELLS[layout].progress)}><ProgressBar progress={item.progress} /></div>
    <div role="cell" className={cn("col-start-2 row-start-1 flex min-w-0 justify-end", CELLS[layout].action)}>
      <ActionHint id={actionId} label={item.action} />
    </div>
  </div>;
}

/** A card: the whole card opens the item, with a chevron and the action at the bottom. */
function WorkCard({ item }: { item: WorkListItem }) {
  const actionId = useId();
  return <article data-work-key={item.key} data-urgent={item.urgent || undefined} className={cn("workflow-card tap-card group flex min-w-0 flex-col gap-3 p-4", item.urgent && "bg-[color-mix(in_srgb,var(--destructive)_6%,transparent)]")}>
    <div className="flex min-w-0 items-start gap-3">
      <ItemIcon item={item} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold" data-card-title=""><Link href={item.href} title={item.title} aria-describedby={actionId} className="stretched-link group-hover:text-primary">{item.title}</Link></h2>
        <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">{[item.kindLabel, item.context].filter(Boolean).join(" · ")}</p>
      </div>
      <ChevronRight className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
    </div>
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{item.priority ? <PriorityBadge priority={item.priority} /> : null}<StatusBadge status={item.status} />{item.date ? <span className={cn("text-xs tabular-nums", item.date.tone ? `font-semibold ${indicatorText(item.date.tone)}` : "text-muted-foreground")}>{dateText(item)}</span> : null}</div>
    <dl className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-start gap-1.5"><dt className="sr-only">Kund och plats</dt><MapPin className="mt-px size-3.5 shrink-0" aria-hidden="true" /><dd className="line-clamp-2 min-w-0 break-words" title={where(item) || undefined}>{where(item) || "Ingen kund"}</dd></div>
      <div className="flex min-w-0 items-center gap-1.5"><dt className="sr-only">Ansvarig</dt><UserRound className="size-3.5 shrink-0" aria-hidden="true" /><dd className="truncate" title={item.responsible || undefined}>{item.responsible || "Inte tilldelad"}</dd></div>
      {item.planned ? <div className="flex min-w-0 items-center gap-1.5"><dt className="sr-only">Planerat</dt><CalendarClock className="size-3.5 shrink-0" aria-hidden="true" /><dd className="truncate" title={item.planned}>{item.planned}</dd></div> : null}
    </dl>
    <div className="mt-auto space-y-3">
      <ProgressBar progress={item.progress} wide />
      {item.people || item.cardExtra ? <div className="space-y-2">{item.people ? <PersonAvatars people={item.people} /> : null}{item.cardExtra}</div> : null}
      <ActionHint id={actionId} label={item.action} wide />
    </div>
  </article>;
}

export type WorkListProps<F extends string> = {
  list: WorkListName;
  title: string;
  description: string;
  create?: { href: string; label: string } | null;
  /** Buttons to the page's own subpages, left of the create button (Projekt: Planering, 2026-10-30) – outline buttons. */
  actions?: ReactNode;
  scopes: readonly WorkListScope[];
  scope: WorkListScope;
  onScope: (scope: WorkListScope) => void;
  filterLabel: string;
  filters: WorkListFilter<F>[];
  filter: F;
  onFilter: (filter: F) => void;
  query: string;
  onQuery: (query: string) => void;
  searchLabel: string;
  searchPlaceholder: string;
  sort: WorkListSort;
  onSort: (sort: WorkListSort) => void;
  view: WorkListView;
  onView: (view: WorkListView) => void;
  /** null while the first page is read. */
  items: WorkListItem[] | null;
  total: number;
  busy: boolean;
  error: string;
  onMore: () => void;
  /** Shown when the scope has nothing at all (not when a filter or search hides everything). */
  empty: ReactNode;
  isEmpty: boolean;
  testId: string;
  /**
   * Extra filters (Underhåll: type and priority on Mina arbetsordrar): selects in the filter bar; at level 1 on a phone
   * picker rows behind the one Filter row.
   */
  extraFilters?: WorkListExtraFilter[];
  /** The column Prioritet (Mina arbetsordrar). */
  priorityColumn?: boolean;
  /**
   * Rows to the pages of the list's main object in the app (Projekt: Planering and Projektstatistik, 2026-10-23),
   * under the filter; a computer has the page's tab row instead.
   */
  nativeLinks?: ReactNode;
};

/** The shared list page: heading, the same filter bar, and rows or cards with "Visa fler". */
export function WorkList<F extends string>(props: WorkListProps<F>) {
  // Nivå 1 på mobil (2026-10-09): the same list as the phone's settings, grouped by day.
  if (useNativeMode()) return <NativeWorkList {...props} />;
  return <ClassicWorkList {...props} />;
}

/**
 * Jobs at level 1 in groups – Försenat, I dag, Denna vecka, Senare – by the booked or due day, one shared row each (B3,
 * 2026-10-21: the Jobb tab and the project's jobs draw the same row, nativeJobRow). A job past its Klart senast
 * stands under Försenat even when it is booked later; long names take two lines.
 */
export function NativeJobGroups({ items, responsible = false, rowTestId = "native-work-row" }: { items: readonly WorkListItem[]; responsible?: boolean; rowTestId?: string }) {
  const today = swedishDayKey(new Date());
  const groups = groupByDate(items, (item) => item.day, today, (item) => item.open !== false, (item) => item.date?.tone === "danger");
  return <>{groups.map((group) => <ListGroup key={group.key} title={group.label} testId={`native-group-${group.key}`} alignPills>
    {group.items.map((item) => { const row = nativeJobRow(item, { responsible }); return <ListRow key={item.key} href={item.href} title={item.title} twoLines subtitleTwoLines testId={rowTestId} {...row} />; })}
  </ListGroup>)}</>;
}

/**
 * Nivå 1 på mobil: a large title, a compact search, Mina/Alla and the filter, and the rows in groups – Försenat, I dag,
 * Denna vecka, Senare – by the booked or due day. The same items, scope, filters and paging as the ordinary list.
 */
function NativeWorkList<F extends string>(props: WorkListProps<F>) {
  const { items } = props;
  // M1: the top bar names the list and goes back to Hem; the page keeps no large title of its own.
  // The Jobb tab's list is a root (no back); "Ny" sits at the bar's right, not alone on a row of its own (2026-10-12).
  const router = useRouter();
  const createHref = props.create?.href;
  useNativeTopBar({ title: props.list === "tasks" ? "Mina jobb" : props.title, back: props.list === "tasks" ? null : { label: "Hem" },
    // The Jobb tab has no Ny of its own: the tab bar's Ny right below offers the same choices everywhere (2026-10-13).
    save: createHref && props.list !== "tasks" ? { label: "Ny", onClick: () => router.push(createHref) } : null });
  // A list of "Mina" with nothing in it says why and offers Alla (2026-10-12), when the person may read all.
  const canShowAll = props.scope === "mine" && props.scopes.includes("all" as never) && !props.query.trim() && props.filter === props.filters[0]?.value;
  const filterText = (filter: WorkListFilter<F>) => filter.count === null ? filter.label : `${filter.label} (${filter.count})`;
  return <NativePage testId={`${props.testId}-list`}>
    <div data-view="native" data-scope={props.scope} className="contents">
      <NativeLargeTitle inBar>{props.list === "tasks" ? "Mina jobb" : props.title}</NativeLargeTitle>
      <NativeSearch value={props.query} onChange={props.onQuery} label={props.searchLabel} placeholder="Sök" />
      {/* Mina | Alla as the phone's segmented control, full width; the filter as a field that opens the phone's own list. */}
      {props.scopes.length > 1 ? <NativeSegmented label="Mina eller alla" testId={`${props.testId}-scope`} value={props.scope} onChange={props.onScope} options={props.scopes.map((value) => [value, WORK_LIST_SCOPE_LABEL[value]] as const)} /> : null}
      <NativeWorkListFilter {...props} filterText={filterText} />
      {props.nativeLinks}
      {props.error ? <p role="alert" className="notice mt-3 text-destructive">{props.error}</p> : null}
      {/* The rows' own grey shape while the first page is read, so nothing jumps when they come (ListSkeleton, 2026-10-15). */}
      {!items ? <DelayedSkeleton><ListSkeleton rows={6} testId={`${props.testId}-native-loading`} /></DelayedSkeleton>
        : (props.isEmpty || !items.length) && canShowAll ? <ListGroup testId="native-mine-empty">
          <ListEmpty>Du har inga jobb just nu. Jobb som är tilldelade eller bokade på dig visas här.</ListEmpty>
          <div role="listitem" className="p-3"><Button type="button" variant="outline" className="w-full" onClick={() => props.onScope("all")} data-testid="native-show-all">Visa alla</Button><WorkProfileNextSteps here="work_orders" className="mt-3" /></div>
        </ListGroup>
        : props.isEmpty ? <div className="pt-3 [&>*]:rounded-[.875rem] [&>*]:border-0 [&>*]:bg-card">{props.empty}</div>
        : items.length ? <div aria-busy={props.busy} data-testid={`${props.testId}-native-rows`}>
          {/* In Alla the rows also name who has the job; in Mina it is the person's own. */}
          <NativeJobGroups items={items} responsible={props.scope === "all"} />
          <ShowMore shown={items.length} total={props.total} busy={props.busy} onMore={props.onMore} />
        </div>
        : <ListGroup><ListEmpty>Inget matchar urvalet. Ändra filter eller sökning.</ListEmpty></ListGroup>}
    </div>
  </NativePage>;
}

/**
 * The list's filters at level 1 (2026-10-10, docs/ui-system.md 9: filters fold behind one row "Filter"). With the
 * status filter alone it is one picker row that opens the phone's own list; with extra filters (Mina arbetsordrar: type
 * of upkeep, priority) the row Filter shows what is chosen and folds out a picker row for each, and Rensa filter.
 */
function NativeWorkListFilter<F extends string>(props: WorkListProps<F> & { filterText: (filter: WorkListFilter<F>) => string }) {
  const [open, setOpen] = useState(false);
  const current = props.filters.find((filter) => filter.value === props.filter) ?? props.filters[0];
  const statusSelect = <select aria-label={props.filterLabel} value={props.filter} onChange={(event) => props.onFilter(event.target.value as F)}>
    {props.filters.map((filter) => <option key={filter.value} value={filter.value}>{props.filterText(filter)}</option>)}
  </select>;
  const extras = props.extraFilters ?? [];
  if (!extras.length) return <ListGroup testId={`${props.testId}-filter`}>
    <NativePickerRow label="Filter" display={current ? props.filterText(current) : ""}>{statusSelect}</NativePickerRow>
  </ListGroup>;
  const chosen = extras.filter((extra) => extra.value);
  const summary = [current?.label, ...chosen.map((extra) => extra.options.find((option) => option.value === extra.value)?.label ?? extra.value)].filter(Boolean).join(" · ");
  return <ListGroup testId={`${props.testId}-filter`}>
    <ListRow type="neutral" icon={SlidersHorizontal} title="Filter" value={summary} onClick={() => setOpen((value) => !value)} chevron={false}
      ariaLabel={open ? "Dölj filter" : "Visa filter"} testId={`${props.testId}-filter-toggle`} />
    {open ? <>
      <NativePickerRow label="Status" display={current ? props.filterText(current) : ""}>{statusSelect}</NativePickerRow>
      {extras.map((extra) => <NativePickerRow key={extra.key} label={extra.label} display={extra.options.find((option) => option.value === extra.value)?.label ?? ""}>
        <select aria-label={extra.label} data-testid={extra.testId} value={extra.value} onChange={(event) => extra.onChange(event.target.value)}>
          {extra.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </NativePickerRow>)}
      {chosen.length ? <ListRow title={<span className="text-primary">Rensa filter</span>} chevron={false} onClick={() => { for (const extra of chosen) extra.onChange(""); }} testId={`${props.testId}-filter-clear`} /> : null}
    </> : null}
  </ListGroup>;
}

function ClassicWorkList<F extends string>(props: WorkListProps<F>) {
  const { items, view } = props;
  return <div className="space-y-5" data-testid={`${props.testId}-list`} data-view={view} data-scope={props.scope}>
    <PageHeader title={props.title} description={props.description}
      actions={props.actions || props.create ? <>{props.actions}{props.create ? <Button asChild><Link href={props.create.href}><Plus />{props.create.label}</Link></Button> : null}</> : null} />
    {props.error ? <p role="alert" className="notice text-destructive">{props.error}</p> : null}
    {/* The filter row and the rows keep the page's phone margin (12 px, 2026-10-17) like the lists of Kundregister and
        Mina offerter: they are not bleed boxes (app-bleed is for a Panel-like section such as Uppdraget). */}
    <ListFilterBar testId={props.testId}
      scope={{ value: props.scope, scopes: props.scopes, onChange: props.onScope }}
      chips={{ label: props.filterLabel, chips: props.filters, value: props.filter, onChange: props.onFilter }}
      search={{ label: props.searchLabel, placeholder: props.searchPlaceholder, value: props.query, onChange: props.onQuery }}
      extras={props.extraFilters}
      sort={{ value: props.sort, options: WORK_LIST_SORT_OPTIONS, onChange: props.onSort }}
      view={{ value: view, onChange: props.onView }} />
    {/* The rows' grey shape in the list's frame while the first page is read (stabil sidladdning steg 6), seen after ~150 ms. */}
    {!items ? <DelayedSkeleton testId={`${props.testId}-loading`}><div className="rounded-lg border bg-card px-4 py-3"><RowsSkeleton rows={7} label="Hämtar…" /></div></DelayedSkeleton>
      : props.isEmpty ? props.empty
      : items.length ? <>
        {view === "rows"
          ? <div role="table" aria-label={props.title} aria-busy={props.busy} data-testid={`${props.testId}-table`} className="overflow-hidden rounded-lg border bg-card">
            <div role="row" className={cn("hidden gap-x-3 border-b bg-[var(--table-head)] px-4 py-2 text-xs font-semibold text-muted-foreground md:grid", HEAD_GRID[props.priorityColumn ? "priority" : "plain"])}>
              <span role="columnheader">Rubrik</span>
              <span role="columnheader" className="hidden xl:block">Kund och plats</span>
              <span role="columnheader" className="hidden xl:block">Ansvarig</span>
              <span role="columnheader" className="hidden xl:block">Datum</span>
              {props.priorityColumn ? <span role="columnheader">Prioritet</span> : null}
              <span role="columnheader">Status</span>
              <span role="columnheader">Progression</span>
              <span role="columnheader" className="text-right"><span className="sr-only">Åtgärd</span></span>
            </div>
            <div role="rowgroup" className="divide-y">{items.map((item) => <WorkRow key={item.key} item={item} priorityColumn={props.priorityColumn} />)}</div>
          </div>
          : <div aria-busy={props.busy} data-testid={`${props.testId}-cards`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">{items.map((item) => <WorkCard key={item.key} item={item} />)}</div>}
        <ShowMore shown={items.length} total={props.total} busy={props.busy} onMore={props.onMore} />
      </> : <div className="notice">Inget matchar urvalet. Ändra filter eller sökning.</div>}
  </div>;
}
