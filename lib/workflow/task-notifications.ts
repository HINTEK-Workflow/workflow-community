import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";

export const NOTIFICATION_DUE_DAYS = 7;
/** How long a finished work order from a deviation is shown to the owner of the protocol it came from. */
export const FOLLOW_UP_DAYS = 7;

export type NotificationSource = {
  id: string;
  title: string;
  kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM" | "ROUND";
  status: string;
  dueDate?: string;
  deletedAt?: string | null;
  archived?: boolean;
  /** An open work order marked Akut (Underhåll, 2026-10-06): always a reminder, first in the bell. */
  urgent?: boolean;
};
export type TaskNotification = {
  id: string;
  title: string;
  /** NEWSLETTER_DRAFT (2026-10-07): a veckobrev draft waits for the superadmin's approval (lib/mail/mailing-drafts.ts). */
  /** SERVER_UPDATES (2026-10-25): a server waits for updates or a restart, or its automatic updates are off (lib/ops/host-status.ts). */
  /** CLOSURE (Radering efter avslut, 2026-10-10): the Cloud agreement has ended; export before the date (lib/company-closure). */
  /** ISSUE_REPORT (2026-11-13): a new report through Rapportera fel eller förslag, for the superadmin (lib/workflow/issue-report-notice.ts). */
  /** OPERATOR (operatörssidan, 2026-10-30): a new operator account came through the Microsoft group and sees no machines yet (lib/operator/admin-notice.ts). */
  kind: NotificationSource["kind"] | "FOLLOW_UP" | "SELF_INSPECTION" | "NEWSLETTER_DRAFT" | "ASSIGNED" | "OBSTACLE" | "QUOTE" | "CLOSURE" | "MACHINE_ALARM" | "MACHINE_NOTE" | "SERVER_UPDATES" | "OPERATOR" | "TEAM" | "COMMENT" | "ISSUE_REPORT";
  /** QUOTE, "Offert besvarad" (lib/quotes/quote-notice.ts): the customer's answer through the link; unread until opened. */
  decision?: "ACCEPTED" | "DECLINED";
  /** What the notice is called when its kind says too little (a deviation among the self-inspection reminders, TE7). */
  label?: string;
  /** A line under the title, e.g. which work order was finished. */
  detail?: string;
  href: string;
  dueDate: string;
  deadline: "OVERDUE" | "DUE_SOON" | null;
  needsAction: boolean;
  /** An urgent work order: marked Akut in red and listed first. */
  urgent?: boolean;
  /** ASSIGNED, "Tilldelad dig" (lib/workflow/task-assignment-notice.ts): who assigned the task and when; unread until opened. */
  assignedBy?: string;
  assignedAt?: string;
  /** MACHINE_ALARM, "Larm från <källa>" (lib/machine/alarm-notice.ts): taskId is the automatic work order (null while only a suggestion waits); canAck shows Kvittera. */
  machineAlarm?: { taskId: string | null; canAck: boolean };
  /** Notislistan (beslut 4, lib/workflow/notification-list.ts): the person has read it; it stays under Läst while it is current. */
  read?: boolean;
  /** Which tab it belongs to: the person's own, or someone else's in the team. Absent = own. */
  audience?: "mine" | "team";
  /** A deviation the person reported themselves: it stands in their list, but "Kräver åtgärd" does not mail it back to them. */
  selfReported?: boolean;
  /** A row that stands for this many repeated reminders of the same day. */
  repeats?: number;
};

/** The bell's page (quality check 2026-10-05, F3): the server sends the total and at most this many reminders. */
export const NOTIFICATION_PAGE = 50;
export const NOTIFICATION_MAX = 500;
export function notificationLimit(raw: string | null) {
  const value = Number(raw);
  return raw && Number.isInteger(value) && value > 0 ? Math.min(NOTIFICATION_MAX, value) : NOTIFICATION_PAGE;
}

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
    if (source.status === "COMPLETED" || source.status === "CANCELLED" || source.deletedAt || source.archived) return [];
    const needsAction = source.status === "NEEDS_ACTION";
    const due = calendarDay(source.dueDate ?? "");
    const deadline = due === null ? null : due < day ? "OVERDUE" : due - day <= NOTIFICATION_DUE_DAYS ? "DUE_SOON" : null;
    // An urgent work order is told to its responsible person (or the admins) whatever its date (2026-10-06).
    const urgent = source.kind === "WORK_ORDER" && source.urgent === true;
    if (!needsAction && !deadline && !urgent) return [];
    return [{
      id: `${source.kind}:${source.id}`, title: source.title, kind: source.kind,
      href: `/?view=workflow_task&taskId=${encodeURIComponent(source.id)}&taskType=${source.kind}`,
      dueDate: due === null ? "" : source.dueDate!, deadline, needsAction,
      ...(urgent ? { urgent: true, detail: "Akut arbetsorder." } : {}),
    }];
  });
  const priority = (item: TaskNotification) => item.urgent ? -1 : item.deadline === "OVERDUE" ? 0 : item.needsAction ? 1 : 2;
  return items.sort((a, b) => priority(a) - priority(b) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.title.localeCompare(b.title, "sv") || a.id.localeCompare(b.id));
}

/**
 * One notice for a new job (användartest 2026-10-31, TE13): while "Tilldelad dig" is unread it already says the job is the
 * person's, with its date, so "Snart förfallande" for the same job waits until it has been opened. Förfallen, Behöver åtgärdas
 * and Akut are always told.
 */
export function withoutAssignedDueSoon<T extends Pick<TaskNotification, "href" | "deadline" | "needsAction" | "urgent">>(items: readonly T[], assigned: readonly Pick<TaskNotification, "href">[]): T[] {
  const told = new Set(assigned.map((item) => item.href));
  return items.filter((item) => !(item.deadline === "DUE_SOON" && !item.needsAction && !item.urgent && told.has(item.href)));
}

/** Notices about the company or the installation itself (the closure countdown, a veckobrev draft): always on top. */
const SYSTEM_KINDS = new Set<TaskNotification["kind"]>(["CLOSURE", "NEWSLETTER_DRAFT", "SERVER_UPDATES"]);
/**
 * The bell's order (simulation 0.6.3: "Förslag till kompetenskortet" stood above an Akut work order, although the page
 * says urgent work orders always come first): the company's own notices, then every urgent work order, then the rest
 * in the order they were given. Stable, so each kind keeps its own order inside.
 */
export function orderNotifications<T extends Pick<TaskNotification, "kind" | "urgent">>(items: readonly T[]): T[] {
  const rank = (item: T) => SYSTEM_KINDS.has(item.kind) ? 0 : item.urgent ? 1 : 2;
  return items.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map(({ item }) => item);
}

/** A work order that was made from another task (data.details.source) and is finished. */
export type FollowUpSource = {
  workOrder: { id: string; title: string; status: string; completedAt: string | null; source?: { taskId: string; rowId?: string } | null };
  /** The task it was made from, when the reader may see it; null otherwise. */
  origin: { id: string; title: string; kind: string; updatedAt: string; deletedAt?: string | null; archived?: boolean } | null;
};

/**
 * Flödesvåg 2 (2026-09-30): when a work order made from a deviation is finished, the owner of the protocol it came
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
      detail: `Arbetsordern ”${workOrder.title}” är färdigställd. Följ upp avvikelsen i protokollet.`,
      // Straight to the row the order was made from (2026-10-06).
      href: `/?view=workflow_task&taskId=${encodeURIComponent(origin.id)}&taskType=${kind}${workOrder.source.rowId ? `&row=${encodeURIComponent(workOrder.source.rowId)}` : ""}`,
      dueDate: swedishDayKey(finished), deadline: null, needsAction: true,
    }];
  }).sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.id.localeCompare(b.id));
}
