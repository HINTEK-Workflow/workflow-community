import type { DeviceClass } from "./detail-level";
import type { WorkItemFilter } from "./work-items";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { isLateStart, isLateTask } from "./late-tasks";
import { waitingReasonOf } from "./maintenance";

/**
 * One way to list work (2026-10-05: "mina uppgifter och mina arbetsorder och mina projekt delar samma sätt att
 * visa informationen, både som rader och kort, och … mina / alla"). Tasks, work orders and projects share the scopes,
 * sorting, view and paging below; the server lists apply the same rules in PostgreSQL, Local and the demo use the pure
 * functions on the data they hold.
 *
 * Scopes: "mine" is what is assigned to me or created by me; "all" is everything my permission profile lets me read in
 * the area. "Teamets" is left out (2026-10-05): members are not linked to a Kontor or avdelning, so there is no
 * team to filter by. Read permission on an area already lets a member open any item in it, so "all" is offered to
 * everyone who may read the area and checked again on the server.
 */
export const WORK_LIST_SCOPES = ["mine", "all"] as const;
export type WorkListScope = (typeof WORK_LIST_SCOPES)[number];
export const WORK_LIST_SCOPE_LABEL: Record<WorkListScope, string> = { mine: "Mina", all: "Alla" };

export const WORK_LIST_SORTS = ["updated", "due", "title"] as const;
export type WorkListSort = (typeof WORK_LIST_SORTS)[number];
export const WORK_LIST_SORT_LABEL: Record<WorkListSort, string> = { updated: "Senast ändrad", due: "Närmaste datum", title: "Namn A–Ö" };

export const WORK_LIST_VIEWS = ["rows", "cards"] as const;
export type WorkListView = (typeof WORK_LIST_VIEWS)[number];
export const WORK_LIST_VIEW_LABEL: Record<WorkListView, string> = { rows: "Rader", cards: "Kort" };

export const WORK_LIST_NAMES = ["tasks", "work_orders", "projects"] as const;
export type WorkListName = (typeof WORK_LIST_NAMES)[number];
export const WORK_LIST_PAGE_SIZE = 12;

/** The scopes a person may choose: "all" only with read permission in the list's area. Never empty. */
export function workListScopes(input: { canReadArea: boolean }): WorkListScope[] {
  return input.canReadArea ? ["mine", "all"] : ["mine"];
}

/** A remembered or requested scope, kept only when it is still allowed. */
export function resolveWorkListScope(value: unknown, allowed: readonly WorkListScope[]): WorkListScope {
  return allowed.includes(value as WorkListScope) ? value as WorkListScope : allowed[0] ?? "mine";
}

/**
 * Filter counts are aggregates: in "Mina" they count the person's own work; in "Alla" they count the team's, which an
 * ordinary member never gets (Översikt rule). The page total stays, since it only pages a list the person may read.
 */
export const workListCountsAllowed = (scope: WorkListScope, admin: boolean) => scope === "mine" || admin;

/**
 * Rows on a computer, cards on phones and touch tablets (the same device classes as Visningsnivå). Only the first
 * choice; what the person picks is remembered per list on the device.
 */
export const defaultWorkListView = (device: DeviceClass): WorkListView => device === "desktop" ? "rows" : "cards";

/** `basis`: the stamp of the admin's work view the scope was chosen under (lib/workflow/work-view.ts); missing = before any. */
export type WorkListPrefs = { view?: WorkListView; scope?: WorkListScope; sort?: WorkListSort; basis?: string };
export const workListPrefKey = (list: WorkListName, personId: string) => `hintek.work-list.${list}.${personId || "local"}`;

/** Remembered choices from the device's storage; anything unknown is dropped. */
export function parseWorkListPrefs(raw: string | null | undefined): WorkListPrefs {
  try {
    const value = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
    if (!value || typeof value !== "object") return {};
    return {
      ...(WORK_LIST_VIEWS.includes(value.view as WorkListView) ? { view: value.view as WorkListView } : {}),
      ...(WORK_LIST_SCOPES.includes(value.scope as WorkListScope) ? { scope: value.scope as WorkListScope } : {}),
      ...(WORK_LIST_SORTS.includes(value.sort as WorkListSort) ? { sort: value.sort as WorkListSort } : {}),
      ...(typeof value.basis === "string" && value.basis.length <= 40 ? { basis: value.basis } : {}),
    };
  } catch {
    return {};
  }
}

/** "Mina": assigned to me, or created by me when nobody is assigned (the rule Mina uppgifter has always had). */
export const isMyWork = (item: { assignedToUserId?: string | null; createdBy?: string | null }, userId: string) =>
  Boolean(userId) && (item.assignedToUserId === userId || (!item.assignedToUserId && item.createdBy === userId));

/** "Mina projekt": I am responsible, I created it, or I have work assigned in it. */
export const isMyProject = (project: { responsibleUserId?: string | null; createdBy?: string | null }, userId: string, assignedInProject = false) =>
  Boolean(userId) && (project.responsibleUserId === userId || project.createdBy === userId || assignedInProject);

/** `urgent`: an open work order marked Akut, always first whatever the sort (Underhåll, 2026-10-06). */
export type SortableWork = { id: string; title: string; updatedAt: string; date?: string; urgent?: boolean };

/** The same order as the server: open urgent work orders first, then newest change; nearest date with undated last; or by name. */
export function compareWork(sort: WorkListSort) {
  return (a: SortableWork, b: SortableWork) => {
    const urgent = Number(b.urgent === true) - Number(a.urgent === true);
    if (urgent) return urgent;
    const tie = b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
    if (sort === "title") return a.title.localeCompare(b.title, "sv-SE", { sensitivity: "base" }) || a.id.localeCompare(b.id);
    if (sort === "due") return (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99") || tie;
    return tie;
  };
}

export type WorkListEntry = SortableWork & { mine: boolean; search: string[] };
export type WorkListPage<T, F extends string> = { items: T[]; total: number; page: number; pages: number; counts: Record<F, number> | null };

/**
 * Local and the demo: scope, search, filter counts, sort and page in memory with the same rules as the server.
 * Counts are left out (null) where workListCountsAllowed says so.
 */
export function listWork<T extends WorkListEntry, F extends string>(entries: readonly T[], input: {
  filters: readonly F[]; matches: (entry: T, filter: F) => boolean; filter: F; scope: WorkListScope; sort: WorkListSort;
  q: string; page: number; limit?: number; counts?: boolean;
}): WorkListPage<T, F> {
  const limit = input.limit ?? WORK_LIST_PAGE_SIZE;
  const needle = input.q.trim().toLocaleLowerCase("sv-SE");
  const base = entries.filter((entry) => (input.scope === "all" || entry.mine)
    && (!needle || entry.search.some((value) => value.toLocaleLowerCase("sv-SE").includes(needle))));
  const counts = input.counts === false ? null : Object.fromEntries(input.filters.map((filter) => [filter, base.filter((entry) => input.matches(entry, filter)).length])) as Record<F, number>;
  const matching = base.filter((entry) => input.matches(entry, input.filter)).sort(compareWork(input.sort));
  const page = Math.max(1, input.page);
  return { items: matching.slice((page - 1) * limit, page * limit), total: matching.length, page, pages: Math.max(1, Math.ceil(matching.length / limit)), counts };
}

export type WorkState = "planned" | "active" | "done" | "cancelled";
/** Done, cancelled (Utgått, 2026-10-09), under way (started or with progress) or planned – the same rule as the server's list. */
export function workStateOf(task: { status: string; progress?: number | null }): WorkState {
  if (task.status === "COMPLETED") return "done";
  if (task.status === "CANCELLED") return "cancelled";
  if (["IN_PROGRESS", "PAUSED", "NEEDS_ACTION"].includes(task.status) || (task.progress ?? 0) > 0) return "active";
  return "planned";
}
/** The task states behind the filters of Mina uppgifter and Arbetsorder. */
export const WORK_FILTER_LABEL: Record<WorkItemFilter, string> = { open: "Öppna", active: "Pågår", planned: "Planerade", action: "Behöver åtgärdas", blocked: "Hinder", overdue: "Förfallna", late_start: "Försenad start", done: "Färdigställda", cancelled: "Utgått", all: "Alla" };
/**
 * The one rule per filter (dashboard etapp 3, 2026-10-28: "Samma beräkningsregel i nyckeltal och lista"): the lists
 * (Local, the demo, the work order list) and the overview's key figures (lib/workflow/overview-kpis.ts) both count with it,
 * and /api/work-items says the same in SQL. "overdue" is isLateTask and "late_start" isLateStart on `today` (Swedish day, default now);
 * "blocked" (Hinder) is Behöver åtgärdas or a Pausad work order waiting for something (the rule of lib/workflow/obstacles.ts jobObstacle).
 */
export function workStateMatches(entry: { state: WorkState; status: string; dueDate?: string | null; plannedStartDate?: string | null; progress?: number | null; startedAt?: Date | string | null; waitingOn?: string | null }, filter: WorkItemFilter, today?: string) {
  const open = entry.state !== "done" && entry.state !== "cancelled";
  switch (filter) {
    case "open": return open;
    case "active": return entry.state === "active" && entry.status !== "NEEDS_ACTION";
    case "planned": return entry.state === "planned";
    case "action": return open && entry.status === "NEEDS_ACTION";
    case "blocked": return open && (entry.status === "NEEDS_ACTION" || Boolean(waitingReasonOf(entry.status, entry)));
    case "overdue": return open && isLateTask(entry, today ?? swedishDayKey(new Date()));
    case "late_start": return isLateStart(entry, today ?? swedishDayKey(new Date()));
    case "done": return entry.state === "done";
    case "cancelled": return entry.state === "cancelled";
    case "all": return true;
  }
}

/**
 * "Klara, 30 dagar" and the list's `from` (dashboard etapp 3, 2026-10-28): a completed job counts when it was
 * completed on or after the Swedish day `from`; a job that is not completed is never cut by it. The key figure counts the
 * completed jobs from `recentDoneFrom(now)`, and its tile opens the list with filter=done&from=<the same day>.
 */
export function completedFrom(task: { status: string; completedAt?: string | Date | null }, from: string | null | undefined) {
  if (!from || task.status !== "COMPLETED") return true;
  return Boolean(task.completedAt) && swedishDayKey(task.completedAt!) >= from;
}
export const recentDoneFrom = (now: Date = new Date()) => swedishDayKey(addSwedishDays(now, -30));

/** The tabs of Mina projekt, decided by the project's lifecycle. */
export const PROJECT_LIST_FILTERS = ["ongoing", "closed", "archived"] as const;
export type ProjectListFilter = (typeof PROJECT_LIST_FILTERS)[number];
export const PROJECT_FILTER_LABEL: Record<ProjectListFilter, string> = { ongoing: "Pågående", closed: "Avslutade", archived: "Arkiverade" };
export const projectListTab = (project: { archivedAt?: string | null; closedAt?: string | null }): ProjectListFilter =>
  project.archivedAt ? "archived" : project.closedAt ? "closed" : "ongoing";
