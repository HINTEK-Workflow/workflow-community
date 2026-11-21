import { prisma } from "@/lib/db";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { metricAccess } from "../metrics";
import type { MetricCaller } from "../metrics-server";
import { calendarShape, calendarWindow, type CalendarSource } from "./calendar";
import type { SourceResult } from "./server";

/**
 * Kalenderkortet på servern: Planering's bookings of the day or the week, with the same module and right as Dagens planering
 * (lib/boards/metrics.ts planning_today) and each booking filtered with Planering's own rule (canReadPlannedActivity).
 */
export async function readCalendar(viewer: MetricCaller, source: CalendarSource, now: Date): Promise<SourceResult> {
  const access = metricAccess("planning_today", viewer);
  if (access !== "ok") return { ok: false, reason: access };
  const window = calendarWindow(source.range ?? "today", now);
  const rows = await prisma.plannedActivity.findMany({
    where: { organizationId: viewer.organizationId, deletedAt: null, status: { not: "CANCELED" }, startsAt: { lt: window.to }, endsAt: { gt: window.from } },
    orderBy: { startsAt: "asc" }, take: 500,
    select: { title: true, startsAt: true, endsAt: true, projectId: true, assignedToName: true, workflowTask: { select: { kind: true, formArea: true, title: true, projectId: true } }, assignments: { select: { member: { select: { user: { select: { name: true, email: true } } } } } } },
  });
  const readable = rows.filter((row) => canReadPlannedActivity(viewer.workflowPermissions, viewer.admin, row as never));
  return {
    ok: true,
    data: calendarShape(readable.map((row) => ({
      startsAt: row.startsAt, endsAt: row.endsAt, title: row.workflowTask?.title || row.title,
      people: row.assignments.length ? row.assignments.map((item) => item.member.user.name?.trim() || item.member.user.email.split("@")[0]!) : row.assignedToName ? [row.assignedToName] : [],
    })), source, now),
  };
}
