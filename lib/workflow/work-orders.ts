import { WORK_ITEM_FILTERS, type WorkItemFilter } from "./work-items";

/**
 * Mina arbetsordrar (2026-09-26): work orders are their own workflow with a menu group of their own. The list
 * shows status, customer, responsible, planned date and project. "Mina" follows the same rule as Mina uppgifter
 * (assigned to me, or created by me when nobody is assigned); "Alla" shows every work order the member may read.
 * The filters are the same as in Mina uppgifter. Cloud filters and pages in PostgreSQL; Local and the demo use the
 * pure functions below on the data they already hold.
 */
export const WORK_ORDER_SCOPES = ["mine", "all"] as const;
export type WorkOrderScope = (typeof WORK_ORDER_SCOPES)[number];
export const WORK_ORDER_PAGE_SIZE = 12;

export type WorkOrderRow = {
  id: string; title: string; status: string; progress: number; customerName: string; assignedToName: string;
  dueDate: string; plannedAt: string | null; projectId: string | null; projectName: string; updatedAt: string;
};

export type WorkOrderSource = {
  id: string; kind: string; title: string; status: string; progress: number; customerName?: string; assignedToUserId: string | null; assignedToName: string;
  createdBy?: string | null; dueDate: string; projectId: string | null; projectName?: string; updatedAt: string; plannedAt?: string | null;
};

/** The same states as Mina uppgifter: done, active (started or needs action) and planned. */
export function workOrderMatches(task: Pick<WorkOrderSource, "status" | "progress">, filter: WorkItemFilter) {
  const state = task.status === "COMPLETED" ? "done" : ["IN_PROGRESS", "PAUSED", "NEEDS_ACTION"].includes(task.status) || task.progress > 0 ? "active" : "planned";
  switch (filter) {
    case "open": return state !== "done";
    case "active": return state === "active" && task.status !== "NEEDS_ACTION";
    case "planned": return state === "planned";
    case "action": return state !== "done" && task.status === "NEEDS_ACTION";
    case "done": return state === "done";
    case "all": return true;
  }
}

export const isMyWorkOrder = (task: Pick<WorkOrderSource, "assignedToUserId" | "createdBy">, userId: string) =>
  task.assignedToUserId === userId || (!task.assignedToUserId && task.createdBy === userId);

/** Local and the demo: the same list, filters, counts and pages as the server. */
export function listWorkOrders(tasks: WorkOrderSource[], input: { scope: WorkOrderScope; filter: WorkItemFilter; q: string; page: number; userId: string }) {
  const needle = input.q.trim().toLocaleLowerCase("sv-SE");
  const base = tasks.filter((task) => task.kind === "WORK_ORDER" && (input.scope === "all" || isMyWorkOrder(task, input.userId))
    && (!needle || [task.title, task.customerName ?? "", task.projectName ?? "", task.assignedToName].some((value) => value.toLocaleLowerCase("sv-SE").includes(needle))));
  const counts = Object.fromEntries(WORK_ITEM_FILTERS.map((filter) => [filter, base.filter((task) => workOrderMatches(task, filter)).length])) as Record<WorkItemFilter, number>;
  const matching = base.filter((task) => workOrderMatches(task, input.filter)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const total = matching.length;
  const page = Math.max(1, input.page);
  const items: WorkOrderRow[] = matching.slice((page - 1) * WORK_ORDER_PAGE_SIZE, page * WORK_ORDER_PAGE_SIZE).map((task) => ({
    id: task.id, title: task.title, status: task.status, progress: task.progress, customerName: task.customerName ?? "", assignedToName: task.assignedToName,
    dueDate: task.dueDate, plannedAt: task.plannedAt ?? null, projectId: task.projectId, projectName: task.projectName ?? "", updatedAt: task.updatedAt,
  }));
  return { items, total, page, pages: Math.max(1, Math.ceil(total / WORK_ORDER_PAGE_SIZE)), counts };
}

/** The next planned activity of a work order: the first one that has not ended, else none. */
export function nextPlannedAt(activities: { startsAt: string; endsAt: string; deletedAt?: string | null }[], now = new Date()) {
  return activities.filter((item) => !item.deletedAt && new Date(item.endsAt) >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]?.startsAt ?? null;
}
