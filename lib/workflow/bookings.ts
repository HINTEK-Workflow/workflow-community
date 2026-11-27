import { formatSwedish, swedishDayKey, swedishParts } from "@/lib/swedish-time";
import { canManageProjectLifecycle } from "./project-status";

/**
 * Bokningar på jobbet (projektförslaget 2026-10-09, steg 1) and who may change whose bookings (2026-10-09:
 * "Admin + projektansvarig, men måste kunna lämna över rättigheten om personen är sjuk"). Pure rules shared by the
 * server, the demo and the pages; the server is the only authority.
 */

type BookingLike = {
  workflowTaskId?: string | null;
  status: string;
  startsAt: string | Date;
  endsAt: string | Date;
  deletedAt?: string | Date | null;
  assignedToUserId?: string | null;
  assignedToUserIds?: string[];
  assignments?: { userId: string }[];
};

/**
 * Boka från jobbet (2026-11-02): one address, from the work order, Teamet and the list Att boka. `new=1` opens the form on
 * display levels 2–3, `step=ny` opens the phone's form screen; each ignores the other. `bookTaskId` is its own name because the shell
 * reads `taskId` for itself. The caller adds the way back (withReturn).
 */
export const bookJobHref = (taskId: string) => `/?view=planning&new=1&step=ny&bookTaskId=${encodeURIComponent(taskId)}`;

/** The people a booking holds (Bokad personal), old single-responsible records included. */
export function bookedUserIds(booking: Pick<BookingLike, "assignedToUserId" | "assignedToUserIds" | "assignments">) {
  return [...new Set([...(booking.assignments ?? []).map((item) => item.userId), ...(booking.assignedToUserIds ?? []), ...(booking.assignedToUserId ? [booking.assignedToUserId] : [])])];
}

/** The jobs a person is booked on (not cancelled, not deleted): "Mina" includes them beside assigned and created work. */
export function bookedTaskIdsForUser(bookings: BookingLike[], userId: string) {
  const ids = new Set<string>();
  if (!userId) return ids;
  for (const booking of bookings)
    if (booking.workflowTaskId && !booking.deletedAt && booking.status !== "CANCELED" && bookedUserIds(booking).includes(userId)) ids.add(booking.workflowTaskId);
  return ids;
}

/** A job's coming bookings: planned or in progress, not deleted, not yet ended; the nearest first. */
export function upcomingTaskBookings<T extends BookingLike>(bookings: T[], taskId: string, now = new Date()) {
  return bookings
    .filter((booking) => booking.workflowTaskId === taskId && !booking.deletedAt && ["PLANNED", "IN_PROGRESS"].includes(booking.status) && new Date(booking.endsAt).getTime() > now.getTime())
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
}

const clock = (value: Date) => {
  const parts = swedishParts(value);
  return parts.minute ? `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}` : String(parts.hour).padStart(2, "0");
};
const dayLabel = (value: Date) => `${formatSwedish(value, { weekday: "short" }).replace(".", "")} ${formatSwedish(value, { day: "numeric", month: "numeric" })}`;

/** "tis 14/10 07–16", or "mån 13/10 07 – fre 17/10 16" over several days. */
export function bookingPeriodLabel(startsAt: string | Date, endsAt: string | Date) {
  const start = new Date(startsAt); const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  return swedishDayKey(start) === swedishDayKey(new Date(end.getTime() - 1))
    ? `${dayLabel(start)} ${clock(start)}–${clock(end)}`
    : `${dayLabel(start)} ${clock(start)} – ${dayLabel(end)} ${clock(end)}`;
}

/**
 * Whose bookings a task's page reads (2026-11-18): a booking lands on the work order, so a protocol or a risk
 * assessment in a work order reads its work order's bookings ("Ingen bokning" stood on a protocol whose work order was booked).
 */
export const bookingTaskId = (task: { id: string; kind?: string; workOrderId?: string | null }) =>
  task.kind !== "WORK_ORDER" && task.workOrderId ? task.workOrderId : task.id;

/**
 * The line on the job's page: "Bokad: tis 14/10 07–16 · Anna, Erik" for the nearest coming booking (and how many more),
 * or "Ingen bokning".
 */
export function taskBookingLine(upcoming: (BookingLike & { assignedToName?: string })[], nameOf: (userId: string) => string | undefined = () => undefined) {
  const next = upcoming[0];
  if (!next) return "Ingen bokning";
  const names = bookedUserIds(next).map((id) => nameOf(id)).filter(Boolean).join(", ") || next.assignedToName || "";
  const more = upcoming.length > 1 ? ` (+${upcoming.length - 1} ${upcoming.length === 2 ? "bokning" : "bokningar"} till)` : "";
  return `Bokad: ${bookingPeriodLabel(next.startsAt, next.endsAt)}${names ? ` · ${names}` : ""}${more}`;
}

export type BookingProject = { responsibleUserId?: string | null; planningDelegateUserId?: string | null } | null | undefined;

/**
 * Others' bookings may be changed only by a company admin, the project's responsible person or the stand-in the
 * responsible person (or an admin) named for the project. A booking without a project is changed by an admin only.
 */
export function canChangeOthersBookings(input: { admin: boolean; userId: string; project: BookingProject }) {
  if (input.admin) return true;
  const project = input.project;
  return Boolean(project && input.userId && (project.responsibleUserId === input.userId || project.planningDelegateUserId === input.userId));
}

/**
 * Whether one save or delete of a booking is allowed for the person. Everyone changes their own bookings: when the
 * booked people, before and after the change, are only the person (or nobody), nothing more is needed. Ordinary
 * permissions (projects:edit, the job's own permission) are checked separately. Returns the reason when refused.
 */
export function bookingChangeRefusal(input: { admin: boolean; userId: string; before: string[]; after: string[]; project: BookingProject }) {
  const others = [...input.before, ...input.after].some((id) => id !== input.userId);
  if (!others || canChangeOthersBookings(input)) return null;
  return input.project
    ? "Andras bokningar ändras bara av projektansvarig, projektets ställföreträdare eller en företagsadministratör. Du kan ändra dina egna bokningar."
    : "Andras bokningar utan projekt ändras bara av en företagsadministratör. Du kan ändra dina egna bokningar.";
}

/**
 * Who may hand over and take back the booking right on a project: the project's responsible person (with permission
 * to edit projects) or an admin. The stand-in cannot hand it on.
 */
export const canHandOverPlanning = canManageProjectLifecycle;

/** The history line for a hand-over or take-back, logged on the project. */
export function planningDelegateSummary(previousName: string, nextName: string) {
  if (nextName && previousName) return `Rätten att ändra andras bokningar lämnades över från ${previousName} till ${nextName}`;
  if (nextName) return `Rätten att ändra andras bokningar lämnades över till ${nextName} (ställföreträdare)`;
  return `Rätten att ändra andras bokningar togs tillbaka${previousName ? ` från ${previousName}` : ""}`;
}
