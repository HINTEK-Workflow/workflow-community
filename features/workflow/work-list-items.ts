import { formatSwedish, fromSwedishDateInput, swedishDayKey } from "@/lib/swedish-time";
import { workStateOf, type WorkState } from "@/lib/workflow/work-list";
import { progressTone, type IndicatorTone } from "./indicator-tone";
import { taskNeedsWorkOrder, WORK_ORDER_MISSING_LABEL, workOrderLinkLabel } from "@/lib/workflow/work-order-link";
import type { WorkListItem } from "./work-list";
import { typeOfTaskKind, type TypeKey } from "@/lib/workflow/native-mode";
import { isLateTask } from "@/lib/workflow/late-tasks";
import { isUrgentOpen, MAINTENANCE_PRIORITIES, MAINTENANCE_PRIORITY_LABELS, workOrderStatusLabel, type MaintenancePriority } from "@/lib/workflow/maintenance";

/** A task, work order or protocol as the lists receive it from the server, Local or the demo. */
export type TaskListSource = {
  id: string;
  kind?: string | null;
  title: string;
  status: string;
  updatedAt: string;
  projectId?: string | null;
  projectName?: string;
  progress?: number;
  customerName?: string;
  placeName?: string;
  responsibleName?: string;
  assignedToName?: string;
  dueDate?: string;
  /** Local: when it was completed, for "Färdigställda från" (`from`, dashboard etapp 3); the servers filter it themselves. */
  completedAt?: string | null;
  plannedAt?: string | null;
  isMine?: boolean;
  /** A work order's maintenance facts: the priority and waiting reason shown in the row (Local and the demo also filter on them). */
  maintenance?: { type?: string; priority?: string; waitingOn?: string } | null;
  /** Hör till arbetsorder (Fas 2): the work order the task belongs to; the title is empty without read on work orders. */
  workOrderId?: string | null;
  workOrderTitle?: string;
  /** Rondordrar (2026-10-26): the round a work order was made for, for the list's Ursprung filter. */
  roundScheduleId?: string | null;
};

/** A work order's priority as a badge: Akut red, Hög amber, the rest neutral (2026-10-06). */
export function priorityBadge(maintenance: TaskListSource["maintenance"]): { label: string; tone: IndicatorTone } | null {
  const priority = maintenance?.priority;
  if (!priority || !(MAINTENANCE_PRIORITIES as readonly string[]).includes(priority)) return null;
  const value = priority as MaintenancePriority;
  return { label: MAINTENANCE_PRIORITY_LABELS[value], tone: value === "URGENT" ? "danger" : value === "HIGH" ? "warning" : "neutral" };
}

/** "15 dec 2026": one date format in every list, rows and cards alike. */
export const listDate = (day: string) => {
  const date = fromSwedishDateInput(day);
  return date ? formatSwedish(date, { day: "numeric", month: "short", year: "numeric" }) : day;
};

/** Done, under way (started or with progress) or planned – the same rule as the server's list. */
export function taskWorkState(task: TaskListSource): WorkState {
  return workStateOf(task);
}

export const taskKindLabel = (kind?: string | null) =>
  kind === "WORK_ORDER" ? "Arbetsorder" : kind === "RISK_ASSESSMENT" ? "Riskbedömning" : "Formulär";

export const taskListHref = (task: Pick<TaskListSource, "id" | "kind">) => `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}`;

/**
 * Where the task belongs, compactly: its project and "Arbetsorder: <title>" (Arbetsordern styr, 2026-10-26) – or, for a draft
 * without one (2026-10-27), "Saknar arbetsorder".
 */
export function taskListContext(task: Pick<TaskListSource, "projectName" | "workOrderId" | "workOrderTitle"> & { kind?: string | null }) {
  const order = task.workOrderId ? workOrderLinkLabel(task.workOrderTitle ?? "") : task.kind && taskNeedsWorkOrder({ kind: task.kind, workOrderId: task.workOrderId }) ? WORK_ORDER_MISSING_LABEL : "";
  if (task.projectName) return order ? `Projekt: ${task.projectName} · ${order}` : `Projekt: ${task.projectName}`;
  return order;
}

/** One task as a row or card: status and progress as in the editors, and the next step as the action. */
export function taskListItem(task: TaskListSource, today: string): WorkListItem {
  const state = taskWorkState(task);
  const cancelled = state === "cancelled";
  const attention = state !== "done" && !cancelled && task.status === "NEEDS_ACTION";
  const percent = state === "done" ? 100 : Math.max(0, Math.min(100, task.progress ?? 0));
  // A paused work order says what it waits for ("Väntar på material", Underhåll 2026-10-06).
  const statusLabel = state === "done" ? "Färdigställd" : cancelled ? "Utgått" : attention ? "Behöver åtgärdas" : task.status === "PAUSED" ? workOrderStatusLabel(task.status, task.maintenance, "Pausad") : state === "active" ? "Pågår" : "Planerad";
  const statusTone: IndicatorTone = state === "done" ? "success" : cancelled ? "neutral" : attention ? "danger" : task.status === "PAUSED" ? "neutral" : state === "active" ? "warning" : "neutral";
  const overdue = state !== "done" && !cancelled && isLateTask(task, today);
  return {
    key: `${task.kind}-${task.id}`,
    href: taskListHref(task),
    title: task.title,
    icon: task.kind === "WORK_ORDER" ? "work-order" : "task",
    kindLabel: taskKindLabel(task.kind),
    context: taskListContext(task),
    customer: task.customerName ?? "",
    place: task.placeName ?? "",
    responsible: task.responsibleName || task.assignedToName || "",
    date: task.dueDate ? { label: "Klart senast", value: listDate(task.dueDate), ...(overdue ? { tone: "danger" as const } : {}) } : null,
    planned: task.plannedAt ? `Planerad ${formatSwedish(task.plannedAt, { dateStyle: "short", timeStyle: "short" })}` : undefined,
    status: { label: statusLabel, tone: statusTone },
    progress: { percent, tone: progressTone({ percent, completed: state === "done", attention }), note: state === "done" ? "Inget återstår" : cancelled ? "Utgår – görs inte" : `${100 - percent}% återstår` },
    action: state === "planned" ? "Starta" : state === "done" || cancelled ? "Visa" : "Fortsätt",
    ...(task.kind === "WORK_ORDER" ? { priority: priorityBadge(task.maintenance), urgent: isUrgentOpen(task.status, task.maintenance) } : {}),
    // Uppgifter får skapas först (2026-10-27): a draft without a work order is marked in every list until it is linked.
    ...(task.kind && taskNeedsWorkOrder({ kind: task.kind, workOrderId: task.workOrderId }) && !cancelled && state !== "done" ? { priority: { label: WORK_ORDER_MISSING_LABEL, tone: "warning" as const } } : {}),
    // Nivå 1 på mobil: grouped by the booked day, else the due day.
    day: task.plannedAt ? swedishDayKey(task.plannedAt) : task.dueDate ?? "", open: state !== "done" && !cancelled, type: typeOfTaskKind(task.kind),
  };
}

/** The area of a row whose list gave no type (a task violet, a work order red, a project blue); also the desktop rows' icon colour. */
export const NATIVE_ROW_TYPE: Record<WorkListItem["icon"], TypeKey> = { task: "control", "work-order": "work-order", project: "project" };

/**
 * One job as a row at level 1 (B3, 2026-10-21: "samma rad överallt"): the Jobb tab, the old Mina arbetsordrar and
 * the project's jobs draw the same ListRow – the icon of its kind, the title on up to two lines, where it is (or its
 * context) with the responsible person when asked and the date, and the status as a pill (Förfallen when it is late).
 * An open urgent work order has its line in red.
 */
export function nativeJobRow(item: WorkListItem, options: { responsible?: boolean } = {}) {
  const late = item.date?.tone === "danger";
  const where = [item.customer, item.place].filter(Boolean).join(" · ");
  return {
    type: item.type ?? NATIVE_ROW_TYPE[item.icon],
    subtitle: [where || item.context, options.responsible ? item.responsible : "", item.date ? (late ? `Förfallen ${item.date.value}` : item.date.value) : ""].filter(Boolean).join(" · "),
    subtitleTone: item.urgent ? "danger" as const : undefined,
    pill: late ? { label: "Förfallen", tone: "danger" as const } : item.status,
  };
}

/** A project's job (features/workflow/native-project.tsx) as the shared list item: its step as the context, the project left out. */
export function projectJobListItem(job: { id: string; kind: string; title: string; status: string; dueDate?: string; progress: number; step?: { label: string } | null; assignedToName?: string }, today: string): WorkListItem {
  const item = taskListItem({ id: job.id, kind: job.kind, title: job.title || "Utan rubrik", status: job.status, updatedAt: "", progress: job.progress, dueDate: job.dueDate, assignedToName: job.assignedToName }, today);
  return { ...item, context: job.step?.label ?? "" };
}
