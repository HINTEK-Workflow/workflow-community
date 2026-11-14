/** Filters for Mina uppgifter, shared by the server list, the demo backend and the client. */
// "cancelled" is Utgått (2026-10-09): jobs that will not be done, listed apart and never among the open ones.
// "overdue" is Förfallna (dashboard etapp 3, 2026-10-28): the key figure's rule, isLateTask in lib/workflow/late-tasks.ts.
// "late_start" is Försenad start and "blocked" Hinder (beslut 15, 2026-11-01): Teamet's figures open these lists.
export const WORK_ITEM_FILTERS = ["open", "active", "planned", "action", "blocked", "overdue", "late_start", "done", "cancelled", "all"] as const;
export type WorkItemFilter = (typeof WORK_ITEM_FILTERS)[number];

const kindLabels = [
  ["WORK_ORDER", "arbetsorder"],
  ["RISK_ASSESSMENT", "riskbedömning"],
  ["FORM", "formulär"],
] as const;

/** Task kinds whose Swedish name contains the search text, so "arbetsorder" finds all work orders. */
export function workItemKindsForQuery(query: string) {
  const needle = query.trim().toLocaleLowerCase("sv-SE");
  return needle ? kindLabels.filter(([, label]) => label.includes(needle)).map(([kind]) => kind) : [];
}

/**
 * En jobblista på nivå 1 (B3, 2026-10-21): the Jobb tab lists work orders and tasks together, with a type filter so
 * the fitter never has to know which is which. "all" is both; "work_orders" only work orders; "tasks" every other kind
 * (protocols and risk assessments). The server receives it as `kind` (WORK_ORDER / TASK) and checks read permission as before.
 */
export const WORK_ITEM_TYPES = ["all", "work_orders", "tasks"] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];
export const WORK_ITEM_TYPE_LABEL: Record<WorkItemType, string> = { all: "Alla", work_orders: "Arbetsordrar", tasks: "Uppgifter" };
/** The server's `kind` for a type: work orders, everything that is not a work order, or no limit. */
export const WORK_ITEM_KINDS = ["WORK_ORDER", "TASK"] as const;
export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];
export function workItemTypeKind(type: WorkItemType): WorkItemKind | undefined {
  return type === "work_orders" ? "WORK_ORDER" : type === "tasks" ? "TASK" : undefined;
}
/** The same rule in memory (Local and the demo): does a task of `kind` belong to the chosen type or server kind? */
export function workItemKindMatches(kind: string | null | undefined, wanted: WorkItemKind | undefined) {
  if (!wanted) return true;
  return wanted === "WORK_ORDER" ? kind === "WORK_ORDER" : kind !== "WORK_ORDER";
}
export const workItemTypeMatches = (kind: string | null | undefined, type: WorkItemType) => workItemKindMatches(kind, workItemTypeKind(type));
/**
 * Rondordrar (2026-10-26, svar 1a): the work orders made for a round's occurrences can be filtered out or in, and
 * grouped per round (`round`, a schedule's id, e.g. from Driftronder). "" is every work order.
 */
export const WORK_ORDER_ORIGINS = ["", "rounds", "other"] as const;
export type WorkOrderOrigin = (typeof WORK_ORDER_ORIGINS)[number];
export const WORK_ORDER_ORIGIN_LABEL: Record<WorkOrderOrigin, string> = { "": "Alla", rounds: "Rondordrar", other: "Övriga" };
export const parseWorkOrderOrigin = (value: unknown): WorkOrderOrigin => (WORK_ORDER_ORIGINS as readonly unknown[]).includes(value) ? value as WorkOrderOrigin : "";
/** The same rule in memory (Local and the demo) as the server's: a round's work orders, the others, or one round's. */
export function workOrderOriginMatches(task: { roundScheduleId?: string | null }, origin: WorkOrderOrigin, round?: string | null) {
  if (round) return task.roundScheduleId === round;
  if (origin === "rounds") return Boolean(task.roundScheduleId);
  if (origin === "other") return !task.roundScheduleId;
  return true;
}

/** A type from an address (`?type=work_orders`, the old Mina arbetsordrar at level 1) or a stored choice; anything else is "all". */
export function parseWorkItemType(value: unknown): WorkItemType {
  return (WORK_ITEM_TYPES as readonly unknown[]).includes(value) ? value as WorkItemType : "all";
}
/** The filter is offered only to someone who may read both work orders and some other kind; otherwise it would choose nothing. */
export const workItemTypesOffered = (input: { canReadWorkOrders: boolean; canReadOtherTasks: boolean }) => input.canReadWorkOrders && input.canReadOtherTasks;
