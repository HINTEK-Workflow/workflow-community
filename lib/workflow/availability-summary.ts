export type AvailabilityAssignment = {
  userId: string;
  startsAt: string | null;
  endsAt: string | null;
};

export type AvailabilityActivity = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
  assignedToUserId: string | null;
  assignedToUserIds?: string[];
  assignments?: AvailabilityAssignment[];
};

export type AvailabilityConflict = {
  userId: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  first: { activityId: string; title: string; startsAt: string; endsAt: string };
  second: { activityId: string; title: string; startsAt: string; endsAt: string };
};

const activeStatuses = new Set<AvailabilityActivity["status"]>(["PLANNED", "IN_PROGRESS"]);

function validDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function internalAssignments(activity: AvailabilityActivity): AvailabilityAssignment[] {
  if (activity.assignments?.length) return activity.assignments;
  return [...new Set([...(activity.assignedToUserIds ?? []), ...(activity.assignedToUserId ? [activity.assignedToUserId] : [])])]
    .map((userId) => ({ userId, startsAt: null, endsAt: null }));
}

/**
 * Read-only booking-overlap detector. Planned work remains distinct from actual
 * time: this only warns when one internal member has overlapping active bookings.
 */
export function summarizeAvailability(activities: AvailabilityActivity[]) {
  const intervalsByUser = new Map<string, { activityId: string; title: string; startsAt: Date; endsAt: Date }[]>();
  for (const activity of activities) {
    if (!activeStatuses.has(activity.status)) continue;
    for (const assignment of internalAssignments(activity)) {
      const startsAt = validDate(assignment.startsAt ?? activity.startsAt);
      const endsAt = validDate(assignment.endsAt ?? activity.endsAt);
      if (!startsAt || !endsAt || endsAt <= startsAt) continue;
      const intervals = intervalsByUser.get(assignment.userId) ?? [];
      intervals.push({ activityId: activity.id, title: activity.title, startsAt, endsAt });
      intervalsByUser.set(assignment.userId, intervals);
    }
  }

  const conflicts: AvailabilityConflict[] = [];
  for (const [userId, intervals] of intervalsByUser) {
    const ordered = intervals.slice().sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime() || left.endsAt.getTime() - right.endsAt.getTime());
    for (let index = 0; index < ordered.length; index += 1) {
      for (let next = index + 1; next < ordered.length; next += 1) {
        const first = ordered[index]; const second = ordered[next];
        if (second.startsAt >= first.endsAt) break;
        if (first.activityId === second.activityId) continue;
        const overlapStart = new Date(Math.max(first.startsAt.getTime(), second.startsAt.getTime()));
        const overlapEnd = new Date(Math.min(first.endsAt.getTime(), second.endsAt.getTime()));
        if (overlapEnd <= overlapStart) continue;
        conflicts.push({
          userId,
          startsAt: overlapStart.toISOString(),
          endsAt: overlapEnd.toISOString(),
          minutes: Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 60_000),
          first: { activityId: first.activityId, title: first.title, startsAt: first.startsAt.toISOString(), endsAt: first.endsAt.toISOString() },
          second: { activityId: second.activityId, title: second.title, startsAt: second.startsAt.toISOString(), endsAt: second.endsAt.toISOString() },
        });
      }
    }
  }
  return { conflicts, userIds: [...intervalsByUser.keys()] };
}
