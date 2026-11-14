import type { TimeEntryEvent } from "@/lib/workflow/time-correction";

/**
 * Arbetsordern styr in a Local file (2026-10-26): the same model as Cloud – every task in a work order (since
 * 2026-10-27 a draft may wait for its link), time only on a work order or a project. This module holds what the upgrade of
 * an older file needs, without the store itself (features/kfid/local-workspace-store.ts uses it).
 */

type Entry = { id: string; userId: string; startedAt: string; endedAt: string | null; durationSec: number; note: string; createdAt: string; updatedAt: string; cloudOrigin?: { id: string } };
type UpgradeTask = {
  id: string; kind: string; title: string; status: string; progress: number; projectId: string | null; customerId: string | null; facilityId?: string | null;
  workOrderId?: string | null; assignedToUserId: string | null; assignedToName: string; dueDate: string; data: unknown; startedAt: string | null; completedAt: string | null;
  createdAt: string; updatedAt: string; timeEntries: Entry[]; plannedStartDate?: string; estimatedMinutes?: number | null; stage?: string;
  cancellation?: { at: string; by: string; reason: string; fromStatus: string | null };
};
type UpgradeActivity = { id: string; workflowTaskId?: string | null; projectId?: string | null };
type UpgradeWorkspace<T extends UpgradeTask, A extends UpgradeActivity> = { workflowTasks: T[]; plannedActivities: A[]; timeEntryEvents: TimeEntryEvent[]; localIdentity?: { name: string } };

const HEX = "0123456789abcdef";
/**
 * The id of the work order made around a task when an older file is read: derived from the task's own id, so the same
 * file read twice (or imported to Cloud twice) gives the same work order. Still a valid version-4 UUID.
 */
export function wrapperOrderId(taskId: string): string {
  const chars = taskId.toLowerCase().split("");
  return chars.map((char, index) => {
    if (char === "-" || index === 14 || index === 19) return char;
    const value = HEX.indexOf(char);
    return value < 0 ? char : HEX[(value + 7) % 16];
  }).join("");
}

const emptyOrderDetails = () => ({ executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" });

/**
 * An older file (before schema 12) has standalone tasks and time on tasks: each standalone task gets a work order around
 * it (title, project, customer, place, responsible, dates, status and risk step from the task), and time on tasks moves to
 * the task's work order with a line in the time history – the same as Cloud's migration 20261026120000_work_order_required.
 * Bookings follow. Nothing in a task's own content changes, so completed and signed protocols stay as they were.
 */
export function upgradeLocalWorkOrders<T extends UpgradeTask, A extends UpgradeActivity, W extends UpgradeWorkspace<T, A>>(workspace: W, now = new Date().toISOString()): W {
  const ids = new Set(workspace.workflowTasks.map((task) => task.id));
  const wrappers: T[] = [];
  const tasks = workspace.workflowTasks.map((task) => {
    if (task.kind === "WORK_ORDER" || (task.workOrderId && ids.has(task.workOrderId))) return task;
    const orderId = wrapperOrderId(task.id);
    const data = (task.data ?? {}) as { riskStep?: unknown; riskCheck?: unknown; tempPlace?: unknown };
    const orderData = { kind: "WORK_ORDER", details: emptyOrderDetails(), ...(data.riskStep !== undefined ? { riskStep: data.riskStep } : {}), ...(data.riskCheck !== undefined ? { riskCheck: data.riskCheck } : {}), ...(data.tempPlace !== undefined ? { tempPlace: data.tempPlace } : {}) };
    wrappers.push({
      id: orderId, version: 1, kind: "WORK_ORDER", title: task.title, description: "", status: task.status, progress: task.status === "COMPLETED" ? 100 : 0,
      projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId ?? null, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName,
      dueDate: task.dueDate, plannedStartDate: task.plannedStartDate ?? "", estimatedMinutes: task.estimatedMinutes ?? null, ...(task.stage !== undefined ? { stage: task.stage } : {}),
      ...(task.cancellation ? { cancellation: task.cancellation } : {}),
      data: orderData, startedAt: task.startedAt, completedAt: task.completedAt, createdAt: task.createdAt, updatedAt: now, timeEntries: [], revisions: [],
    } as unknown as T);
    return { ...task, workOrderId: orderId };
  });
  const all = [...tasks, ...wrappers];
  const byId = new Map(all.map((task) => [task.id, task]));
  // Time on tasks moves to their work order.
  const moved = new Map<string, Entry[]>();
  const events: TimeEntryEvent[] = [];
  const withoutTime = all.map((task) => {
    if (task.kind === "WORK_ORDER" || !task.timeEntries.length || !task.workOrderId) return task;
    const order = byId.get(task.workOrderId)!;
    moved.set(order.id, [...(moved.get(order.id) ?? []), ...task.timeEntries]);
    for (const entry of task.timeEntries) if (entry.endedAt) events.push({
      id: wrapperOrderId(entry.id), entryId: entry.id, userId: entry.userId, action: "UPDATED",
      previous: { taskId: task.id, taskTitle: task.title, startedAt: entry.startedAt, endedAt: entry.endedAt, durationSec: entry.durationSec, note: entry.note },
      next: { taskId: order.id, taskTitle: order.title, startedAt: entry.startedAt, endedAt: entry.endedAt, durationSec: entry.durationSec, note: entry.note },
      reason: "Flyttad till arbetsorder (modellbyte 2026-10-26)", actorUserId: entry.userId, actorName: workspace.localIdentity?.name ?? "", createdAt: now,
    });
    return { ...task, timeEntries: [] };
  });
  const workflowTasks = withoutTime.map((task) => moved.has(task.id) ? { ...task, timeEntries: [...task.timeEntries, ...moved.get(task.id)!] } : task);
  const orderOf = (taskId: string | null | undefined) => { const task = taskId ? byId.get(taskId) : undefined; return task && task.kind !== "WORK_ORDER" ? task.workOrderId ?? null : null; };
  const plannedActivities = workspace.plannedActivities.map((activity) => {
    const order = orderOf(activity.workflowTaskId);
    if (!order) return activity;
    const task = byId.get(activity.workflowTaskId!)!;
    return { ...activity, workflowTaskId: order, projectId: activity.projectId ?? task.projectId ?? null };
  });
  if (!wrappers.length && !moved.size && plannedActivities.every((activity, index) => activity === workspace.plannedActivities[index])) return workspace;
  return { ...workspace, workflowTasks, plannedActivities, timeEntryEvents: [...events, ...workspace.timeEntryEvents] };
}
