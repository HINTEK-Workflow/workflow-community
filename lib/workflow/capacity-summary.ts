import { mondayFor } from "./time-summary";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { bookingLoadByDay, bookingMinutesInWindow, dailyWorkMinutes, DEFAULT_WEEKLY_WORK_MINUTES, isSwedishWorkday } from "./booking-load";
import { absentShare, wholeDayAway, type AbsenceHours, type AbsenceSpan } from "./absence";
import { bookingOnCancelledJob } from "./task-cancel";
import { organizationModuleOn } from "./modules";

export type CapacityActivity = {
  startsAt: string;
  endsAt: string;
  assignedToUserId: string | null;
  assignedToUserIds?: string[];
  assignments?: { userId: string; plannedMinutes: number | null; startsAt: string | null; endsAt: string | null }[];
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
  projectId: string | null;
  /** The booked job (work order), when known: a round occurrence booked through it is not counted again (2026-10-28). */
  workflowTaskId?: string | null;
  /** The booked job's status, when known: a job that has utgått does not count (2026-10-09). */
  workflowTask?: { status?: string | null } | null;
};

/**
 * Företagets moduler (0.39.0): a booking on a project is no load while the company has turned Projekt off; the booking itself is
 * kept and counts again when the module is on. A booking on a job counts as before.
 */
export function activitiesInUse<T extends { projectId: string | null }>(activities: readonly T[], organization: { disabledModules?: readonly string[] | null } | null | undefined): T[] {
  return organizationModuleOn(organization, "projects") ? [...activities] : activities.filter((activity) => !activity.projectId);
}

/** How a person's weekly working time is found; 40 h when unknown. */
export type WeeklyWorkMinutesFor = (userId: string) => number | null | undefined;

const activePlanningStatuses = new Set<CapacityActivity["status"]>(["PLANNED", "IN_PROGRESS"]);
// A booking on a job that has utgått (2026-10-09) holds no planned load.
const activePlanning = (activity: CapacityActivity) => activePlanningStatuses.has(activity.status) && !bookingOnCancelledJob(activity);

function assignments(activity: CapacityActivity) {
  if (activity.assignments?.length) return activity.assignments;
  return [...new Set([...(activity.assignedToUserIds ?? []), ...(activity.assignedToUserId ? [activity.assignedToUserId] : [])])]
    .map((userId) => ({ userId, plannedMinutes: null, startsAt: null, endsAt: null }));
}

const weeklyFor = (lookup: WeeklyWorkMinutesFor | undefined, userId: string) => (lookup ? lookup(userId) : null) ?? DEFAULT_WEEKLY_WORK_MINUTES;

/**
 * One person's load from one booking inside a window, per working day (projektförslaget steg 1, 2026-10-09): without
 * hours each working day takes the day's working time or the booked part of the day; given hours are spread evenly
 * over the booking's working days; an individual interval counts as a booking of its own without hours.
 * See lib/workflow/booking-load.ts.
 */
function assignmentMinutes(activity: CapacityActivity, assignment: ReturnType<typeof assignments>[number], windowStart: Date, windowEnd: Date, weeklyWorkMinutes: number) {
  const individual = Boolean(assignment.startsAt && assignment.endsAt);
  const start = validDate(individual ? assignment.startsAt! : activity.startsAt); const end = validDate(individual ? assignment.endsAt! : activity.endsAt);
  if (!start || !end || end <= start || end <= windowStart || start >= windowEnd) return 0;
  const days = bookingLoadByDay({ startsAt: start, endsAt: end, plannedMinutes: individual ? null : assignment.plannedMinutes, dailyWorkMinutes: dailyWorkMinutes(weeklyWorkMinutes) });
  return bookingMinutesInWindow(days, windowStart, windowEnd);
}

/** An unassigned booking's load inside a window: as one person with the default working time, without hours. */
function unassignedMinutes(activity: CapacityActivity, windowStart: Date, windowEnd: Date) {
  const start = validDate(activity.startsAt); const end = validDate(activity.endsAt);
  if (!start || !end || end <= start || end <= windowStart || start >= windowEnd) return 0;
  return bookingMinutesInWindow(bookingLoadByDay({ startsAt: start, endsAt: end, plannedMinutes: null, dailyWorkMinutes: dailyWorkMinutes(DEFAULT_WEEKLY_WORK_MINUTES) }), windowStart, windowEnd);
}

/**
 * Read-only planned time for one internal member in any displayed interval.
 * This uses the same allocation and individual-time precedence as weekly
 * capacity, so a calendar can never invent a second planning calculation.
 */
export function plannedMinutesForUserInWindow(input: {
  activities: readonly CapacityActivity[];
  userId: string;
  startsAt: Date;
  endsAt: Date;
  /** The person's weekly working time (a day is a fifth of it); 40 h when left out. */
  weeklyWorkMinutes?: number | null;
}) {
  const weekly = input.weeklyWorkMinutes ?? DEFAULT_WEEKLY_WORK_MINUTES;
  return input.activities.reduce((sum, activity) => {
    if (!activePlanning(activity)) return sum;
    const assignment = assignments(activity).find((item) => item.userId === input.userId);
    return assignment ? sum + assignmentMinutes(activity, assignment, input.startsAt, input.endsAt, weekly) : sum;
  }, 0);
}

function validDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The Swedish Monday-to-Monday week (Europe/Stockholm), independent of the browser's time zone.
export function capacityWeek(anchor = new Date()) {
  const startsAt = mondayFor(anchor);
  return { startsAt, endsAt: addSwedishDays(startsAt, 7) };
}

/** A person as the count sees them. Ingen fast arbetstid (2026-10-30): no capacity; the weekly time only spreads their bookings over the days. */
export type CapacityPerson = { id: string; weeklyWorkMinutes: number; noFixedHours?: boolean };

/**
 * En räkning av kapacitet (2026-11-02): one person in one window of whole Swedish days, the same count on Kapacitet, in
 * Kalender's day and week figures, on Teamet and in the booking form's warnings. What counts as booked is activePlanning (a booking
 * on a job that has utgått does not; one on a färdigställd job does until it is removed, Färdigställ asks) and the person's own
 * weekly time spreads it (assignmentMinutes). Rounds with beräknad tid are passed in with the bookings (capacityLoads).
 *
 * Available is the window's working days, a fifth of the weekly time each, less the share away (absentShare): a holiday neither
 * loads nor gives capacity, the same rule as the bookings' load. conflictMinutes is what is booked on whole days away, Teamet's
 * Krock. Ingen fast arbetstid has no available time at all: null, and never "för mycket". Read-only: never a time entry.
 */
export function capacityInWindow(input: {
  person: CapacityPerson;
  activities: readonly CapacityActivity[];
  absences?: readonly AbsenceSpan[];
  startsAt: Date;
  endsAt: Date;
}) {
  const { person, activities, startsAt, endsAt } = input;
  const absences = input.absences ?? [];
  const weeklyWorkMinutes = Number.isFinite(person.weeklyWorkMinutes) ? Math.max(0, Math.round(person.weeklyWorkMinutes)) : 0;
  const dayMinutes = weeklyWorkMinutes / 5;
  const plannedMinutes = plannedMinutesForUserInWindow({ activities, userId: person.id, startsAt, endsAt, weeklyWorkMinutes });
  let available = 0;
  let conflictMinutes = 0;
  for (let day = startsAt, guard = 0; day < endsAt && guard < 400; guard += 1) {
    const next = addSwedishDays(day, 1);
    const away = absentShare(absences, person.id, swedishDayKey(day), dayMinutes);
    if (isSwedishWorkday(day)) available += dayMinutes * (1 - away);
    if (wholeDayAway(absences, person.id, swedishDayKey(day), dayMinutes)) conflictMinutes += plannedMinutesForUserInWindow({ activities, userId: person.id, startsAt: day, endsAt: next, weeklyWorkMinutes });
    day = next;
  }
  const availableMinutes = person.noFixedHours ? null : Math.round(available);
  return {
    plannedMinutes,
    availableMinutes,
    conflictMinutes,
    remainingPlannedMinutes: availableMinutes === null ? 0 : Math.max(0, availableMinutes - plannedMinutes),
    overplannedMinutes: availableMinutes === null ? 0 : Math.max(0, plannedMinutes - availableMinutes),
    plannedPercent: availableMinutes ? Math.min(100, Math.round((plannedMinutes / availableMinutes) * 100)) : plannedMinutes ? 100 : 0,
  };
}

/** The window's active bookings without anyone responsible: they count for no one, as one person with the default working time. */
export function unassignedMinutesInWindow(activities: readonly CapacityActivity[], startsAt: Date, endsAt: Date) {
  return activities.reduce((sum, activity) => assignments(activity).length || !activePlanning(activity) ? sum : sum + unassignedMinutes(activity, startsAt, endsAt), 0);
}

const ALL_TIME = { from: new Date(-8.64e15), to: new Date(8.64e15) };

/** One activity's planned minutes: the sum of its members' load, or as one person when it is unassigned; null when malformed. */
function activityPlannedMinutes(activity: CapacityActivity, weeklyWorkMinutesFor?: WeeklyWorkMinutesFor) {
  const start = validDate(activity.startsAt); const end = validDate(activity.endsAt);
  if (!start || !end || end <= start) return null;
  const activityAssignments = assignments(activity);
  return activityAssignments.length
    ? activityAssignments.reduce((sum, assignment) => sum + assignmentMinutes(activity, assignment, ALL_TIME.from, ALL_TIME.to, weeklyFor(weeklyWorkMinutesFor, assignment.userId)), 0)
    : unassignedMinutes(activity, ALL_TIME.from, ALL_TIME.to);
}

/**
 * What one person's part of a booking counts as, whatever its status (2026-11-02): the number Planeringsdetaljer and the form
 * show instead of words, since a 1 h booking is 1 h, and a Monday-to-Friday one the person's week.
 */
export function assignmentLoadMinutes(activity: CapacityActivity, userId: string, weeklyWorkMinutes?: number | null) {
  const assignment = assignments(activity).find((item) => item.userId === userId);
  return assignment ? assignmentMinutes(activity, assignment, ALL_TIME.from, ALL_TIME.to, weeklyWorkMinutes ?? DEFAULT_WEEKLY_WORK_MINUTES) : 0;
}

/**
 * Planned time per task, to compare with the task's reported time (2026-09-26, decision 14). Unlike capacity,
 * completed planning still counts (it was planned); only canceled or deleted planning is left out. Read-only: it never
 * creates or changes reported time.
 */
export function plannedMinutesByTask(activities: (CapacityActivity & { workflowTaskId?: string | null; deletedAt?: string | null })[], weeklyWorkMinutesFor?: WeeklyWorkMinutesFor) {
  const totals = new Map<string, number>();
  for (const activity of activities) {
    const taskId = activity.workflowTaskId;
    const minutes = taskId && !activity.deletedAt && activity.status !== "CANCELED" ? activityPlannedMinutes(activity, weeklyWorkMinutesFor) : null;
    if (minutes === null || !taskId) continue;
    totals.set(taskId, (totals.get(taskId) ?? 0) + minutes);
  }
  return totals;
}

/** Whole hours, or hours and minutes: 24 h, 7 h 30 min. */
export function formatCapacityMinutes(minutes: number) {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Hours with one decimal: 25,6 h, 40 h. The same form on Kapacitet and Teamet (2026-11-02), so the two can be compared at a glance. */
export const formatCapacityHours = (minutes: number) => `${(Math.round(minutes / 6) / 10).toLocaleString("sv-SE")} h`;

/** What Planering's view Kapacitet reads from /api/planning-capacity. */
export type CapacityData = {
  /** Whoever may see Teamet gets the team, everyone else themself. */
  canViewTeam?: boolean;
  organizationWeeklyWorkMinutes?: number;
  members: (CapacityPerson & { name: string; memberWeeklyWorkMinutes?: number | null; events?: { id: string; previousMinutes: number | null; nextMinutes: number | null; actorName: string; createdAt: string }[] })[];
  /** With id and title (the person may read these bookings through /api/planned-activities too), so the clashes can name them. */
  activities: (CapacityActivity & { id: string; title: string })[];
  /** The words the viewer may see, and the hours of an absence of some hours: only they take less than the whole day. */
  absences?: { userId: string; label: string; from: string; to: string; hours?: AbsenceHours | null }[];
};

/**
 * One row per person for the week of `anchor`: booked hours against the time available that week (capacityInWindow), rounds
 * with beräknad tid included when the caller adds them (capacityLoads). Ingen fast arbetstid (2026-10-30) has no capacity,
 * so that person is not listed. Absence that touches the week lowers the available time and is named on the row (
 * 2026-11-02). Bookings without anyone responsible count for no one, and are given once.
 */
export function capacityRows(data: Pick<CapacityData, "members" | "absences"> & { activities: readonly CapacityActivity[] }, anchor: Date) {
  const week = capacityWeek(anchor);
  const firstDay = swedishDayKey(week.startsAt);
  const lastDay = swedishDayKey(new Date(week.endsAt.getTime() - 1));
  const rows = data.members.filter((member) => !member.noFixedHours).map((member) => {
    const summary = capacityInWindow({ person: member, activities: data.activities, absences: data.absences, ...week });
    return { id: member.id, name: member.name, weeklyWorkMinutes: Math.max(0, Math.round(member.weeklyWorkMinutes)), plannedMinutes: summary.plannedMinutes, availableMinutes: summary.availableMinutes ?? 0, conflictMinutes: summary.conflictMinutes,
      remainingPlannedMinutes: summary.remainingPlannedMinutes, overplannedMinutes: summary.overplannedMinutes, plannedPercent: summary.plannedPercent,
      absences: (data.absences ?? []).filter((absence) => absence.userId === member.id && absence.from <= lastDay && absence.to >= firstDay) };
  });
  return { rows, unassignedMinutes: unassignedMinutesInWindow(data.activities, week.startsAt, week.endsAt) };
}
