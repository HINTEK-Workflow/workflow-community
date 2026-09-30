import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";

export const NOTIFICATION_DUE_DAYS = 7;
/** How long a finished work order from a deviation is shown to the owner of the protocol it came from. */
export const FOLLOW_UP_DAYS = 7;

export type NotificationSource = {
  id: string;
  title: string;
  kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM" | "COMMISSIONING_CONTROL" | "ROUND";
  status: string;
  dueDate?: string;
  completionErrors?: number;
  deletedAt?: string | null;
  archived?: boolean;
};
export type TaskNotification = {
  id: string;
  title: string;
  kind: NotificationSource["kind"] | "FOLLOW_UP";
  /** A line under the title, e.g. which work order was finished. */
  detail?: string;
  href: string;
  dueDate: string;
  deadline: "OVERDUE" | "DUE_SOON" | null;
  needsAction: boolean;
};

// Date-only deadlines use the same Swedish calendar in Cloud and Local.
export function notificationToday(now = new Date()) {
  return swedishDayKey(now);
}

function calendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() / 86_400_000 : null;
}

// Callers must supply only sources already authorized for the current workspace.
// These are current reminders, not persisted unread messages or mutations.
export function taskNotifications(sources: NotificationSource[], today: string): TaskNotification[] {
  const day = calendarDay(today);
  if (day === null) throw new Error("Ogiltigt kalenderdatum för notiser.");
  const items = sources.flatMap((source): TaskNotification[] => {
    if (source.status === "COMPLETED" || source.deletedAt || source.archived) return [];
    const control = source.kind === "COMMISSIONING_CONTROL";
    const needsAction = control ? (source.completionErrors ?? 0) > 0 : source.status === "NEEDS_ACTION";
    // A control's inspection date is not a deadline.
    const due = control ? null : calendarDay(source.dueDate ?? "");
    const deadline = due === null ? null : due < day ? "OVERDUE" : due - day <= NOTIFICATION_DUE_DAYS ? "DUE_SOON" : null;
    if (!needsAction && !deadline) return [];
    return [{
      id: `${source.kind}:${source.id}`, title: source.title, kind: source.kind,
      href: control ? `/?view=new&id=${encodeURIComponent(source.id)}` : `/?view=workflow_task&taskId=${encodeURIComponent(source.id)}&taskType=${source.kind}`,
      dueDate: due === null ? "" : source.dueDate!, deadline, needsAction,
    }];
  });
  const priority = (item: TaskNotification) => item.deadline === "OVERDUE" ? 0 : item.needsAction ? 1 : 2;
  return items.sort((a, b) => priority(a) - priority(b) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.title.localeCompare(b.title, "sv") || a.id.localeCompare(b.id));
}

/** A work order that was made from another task (data.details.source) and is finished. */
export type FollowUpSource = {
  workOrder: { id: string; title: string; status: string; completedAt: string | null; source?: { taskId: string } | null };
  /** The task it was made from, when the reader may see it; null otherwise. */
  origin: { id: string; title: string; kind: string; updatedAt: string; deletedAt?: string | null; archived?: boolean } | null;
};

/**
 * Flödesvåg 2 (Daniel 2026-09-30): when a work order made from a deviation is finished, the owner of the protocol it came
 * from gets a reminder in the bell to follow up the deviation. It is shown for FOLLOW_UP_DAYS after the work order was
 * finished and goes away as soon as the protocol has been saved after that (the deviation was followed up). Callers
 * pass only work orders and origins the reader may see, and only origins that are the reader's own (admins: the team's).
 */
export function followUpNotifications(sources: FollowUpSource[], now = new Date()): TaskNotification[] {
  const firstDay = swedishDayKey(addSwedishDays(now, -FOLLOW_UP_DAYS));
  return sources.flatMap(({ workOrder, origin }): TaskNotification[] => {
    if (workOrder.status !== "COMPLETED" || !workOrder.completedAt || !origin || origin.deletedAt || origin.archived) return [];
    if (!workOrder.source?.taskId || workOrder.source.taskId !== origin.id) return [];
    const finished = new Date(workOrder.completedAt);
    if (!Number.isFinite(finished.getTime()) || swedishDayKey(finished) < firstDay) return [];
    // Saved after the work order was finished: the deviation has been followed up.
    if (new Date(origin.updatedAt).getTime() > finished.getTime()) return [];
    const kind = ["WORK_ORDER", "RISK_ASSESSMENT", "FORM"].includes(origin.kind) ? origin.kind : "FORM";
    return [{
      id: `FOLLOW_UP:${workOrder.id}`, title: origin.title, kind: "FOLLOW_UP",
      detail: `Arbetsordern "${workOrder.title}" är slutförd. Följ upp avvikelsen i protokollet.`,
      href: `/?view=workflow_task&taskId=${encodeURIComponent(origin.id)}&taskType=${kind}`,
      dueDate: swedishDayKey(finished), deadline: null, needsAction: true,
    }];
  }).sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.id.localeCompare(b.id));
}
