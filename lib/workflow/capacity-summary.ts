import { mondayFor } from "./time-summary";
import { addSwedishDays } from "@/lib/swedish-time";

export type CapacityActivity = {
  startsAt: string;
  endsAt: string;
  assignedToUserId: string | null;
  assignedToUserIds?: string[];
  assignments?: { userId: string; plannedMinutes: number | null; startsAt: string | null; endsAt: string | null }[];
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
  projectId: string | null;
};

export type CapacityTimeEntry = { startedAt: string; durationSec: number };

const activePlanningStatuses = new Set<CapacityActivity["status"]>(["PLANNED", "IN_PROGRESS"]);

function assignments(activity: CapacityActivity) {
  if (activity.assignments?.length) return activity.assignments;
  return [...new Set([...(activity.assignedToUserIds ?? []), ...(activity.assignedToUserId ? [activity.assignedToUserId] : [])])]
    .map((userId) => ({ userId, plannedMinutes: null, startsAt: null, endsAt: null }));
}

function assignmentMinutes(activity: CapacityActivity, assignment: ReturnType<typeof assignments>[number], windowStart: Date, windowEnd: Date) {
  const activityStart = validDate(activity.startsAt); const activityEnd = validDate(activity.endsAt);
  const start = validDate(assignment.startsAt ?? activity.startsAt); const end = validDate(assignment.endsAt ?? activity.endsAt);
  if (!activityStart || !activityEnd || !start || !end || end <= start) return 0;
  const visible = minutesWithin(start, end, windowStart, windowEnd);
  if (assignment.startsAt && assignment.endsAt) return visible;
  const duration = minutesWithin(activityStart, activityEnd, activityStart, activityEnd);
  const allocation = assignment.plannedMinutes ?? duration;
  return duration ? Math.round((allocation * visible) / duration) : 0;
}

/**
 * Read-only planned time for one internal member in any displayed interval.
 * This uses the same allocation and individual-time precedence as weekly
 * capacity, so a calendar can never invent a second planning calculation.
 */
export function plannedMinutesForUserInWindow(input: {
  activities: CapacityActivity[];
  userId: string;
  startsAt: Date;
  endsAt: Date;
}) {
  return input.activities.reduce((sum, activity) => {
    if (!activePlanningStatuses.has(activity.status)) return sum;
    const assignment = assignments(activity).find((item) => item.userId === input.userId);
    return assignment ? sum + assignmentMinutes(activity, assignment, input.startsAt, input.endsAt) : sum;
  }, 0);
}

function validDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesWithin(start: Date, end: Date, windowStart: Date, windowEnd: Date) {
  const from = Math.max(start.getTime(), windowStart.getTime());
  const to = Math.min(end.getTime(), windowEnd.getTime());
  return to > from ? Math.round((to - from) / 60_000) : 0;
}

// The Swedish Monday-to-Monday week (Europe/Stockholm), independent of the browser's time zone.
export function capacityWeek(anchor = new Date()) {
  const startsAt = mondayFor(anchor);
  return { startsAt, endsAt: addSwedishDays(startsAt, 7) };
}

/**
 * Keeps booked time, actual reported time and weekly capacity distinct.
 * A booking only consumes planned capacity; it never creates or changes a time entry.
 */
export function summarizeWeeklyCapacity(input: {
  anchor?: Date;
  weeklyWorkMinutes: number;
  userId: string;
  activities: CapacityActivity[];
  timeEntries: CapacityTimeEntry[];
}) {
  const week = capacityWeek(input.anchor);
  const plannedMinutes = plannedMinutesForUserInWindow({ activities: input.activities, userId: input.userId, startsAt: week.startsAt, endsAt: week.endsAt });
  const unassignedPlannedMinutes = input.activities.reduce((sum, activity) => {
    if (assignments(activity).length || !activePlanningStatuses.has(activity.status)) return sum;
    const start = validDate(activity.startsAt);
    const end = validDate(activity.endsAt);
    return start && end ? sum + minutesWithin(start, end, week.startsAt, week.endsAt) : sum;
  }, 0);
  const reportedMinutes = input.timeEntries.reduce((sum, entry) => {
    const startedAt = validDate(entry.startedAt);
    if (!startedAt || startedAt < week.startsAt || startedAt >= week.endsAt) return sum;
    return sum + (Number.isFinite(entry.durationSec) ? Math.max(0, Math.round(entry.durationSec / 60)) : 0);
  }, 0);
  const weeklyWorkMinutes = Number.isFinite(input.weeklyWorkMinutes) ? Math.max(0, Math.round(input.weeklyWorkMinutes)) : 0;
  const overplannedMinutes = Math.max(0, plannedMinutes - weeklyWorkMinutes);
  return {
    ...week,
    weeklyWorkMinutes,
    plannedMinutes,
    unassignedPlannedMinutes,
    reportedMinutes,
    remainingPlannedMinutes: Math.max(0, weeklyWorkMinutes - plannedMinutes),
    overplannedMinutes,
    plannedPercent: weeklyWorkMinutes ? Math.min(100, Math.round((plannedMinutes / weeklyWorkMinutes) * 100)) : 0,
  };
}

/** One activity's planned minutes: the sum of its members' time, or the whole interval when it is unassigned; null when malformed. */
function activityPlannedMinutes(activity: CapacityActivity) {
  const start = validDate(activity.startsAt); const end = validDate(activity.endsAt);
  if (!start || !end || end <= start) return null;
  const activityAssignments = assignments(activity);
  return activityAssignments.length
    ? activityAssignments.reduce((sum, assignment) => sum + assignmentMinutes(activity, assignment, start, end), 0)
    : minutesWithin(start, end, start, end);
}

export function plannedMinutesByProject(activities: CapacityActivity[]) {
  const totals = new Map<string, number>();
  for (const activity of activities) {
    const minutes = activity.projectId && activePlanningStatuses.has(activity.status) ? activityPlannedMinutes(activity) : null;
    if (minutes === null || !activity.projectId) continue;
    totals.set(activity.projectId, (totals.get(activity.projectId) ?? 0) + minutes);
  }
  return totals;
}

/**
 * Planned time per task, to compare with the task's reported time (2026-09-26, decision 14). Unlike capacity,
 * completed planning still counts (it was planned); only canceled or deleted planning is left out. Read-only: it never
 * creates or changes reported time.
 */
export function plannedMinutesByTask(activities: (CapacityActivity & { workflowTaskId?: string | null; controlId?: string | null; deletedAt?: string | null })[]) {
  const totals = new Map<string, number>();
  for (const activity of activities) {
    const taskId = activity.workflowTaskId ?? activity.controlId;
    const minutes = taskId && !activity.deletedAt && activity.status !== "CANCELED" ? activityPlannedMinutes(activity) : null;
    if (minutes === null || !taskId) continue;
    totals.set(taskId, (totals.get(taskId) ?? 0) + minutes);
  }
  return totals;
}
