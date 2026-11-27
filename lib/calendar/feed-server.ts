import { Prisma } from "@prisma/client";
import { canAccessTest } from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { absoluteUrl } from "@/lib/env";
import { ApiError } from "@/lib/kfid/errors";
import { assertRequiredLegalAccess } from "@/lib/legal";
import { isErasedCompany } from "@/lib/kfid/paused-company";
import { dormantDay, notDormantSql } from "@/lib/maintenance/plan-server";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { addSwedishDays, startOfSwedishDay, swedishDayKey } from "@/lib/swedish-time";
import { mineTaskSql } from "@/lib/workflow/my-day-server";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { hasWorkflowPermission, normalizeWorkflowPermissionProfile, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { CLOSED_TASK_STATUSES } from "@/lib/workflow/task-cancel";
import { CALENDAR_DAYS_AHEAD, CALENDAR_DAYS_BACK, CALENDAR_ROW_LIMIT, calendarEvents, type BookingRow, type OnCallRow, type WorkOrderRow } from "./feed";
import { buildCalendar } from "./ical";
import { calendarTokenMatches, calendarTokenUser, readCalendarLink } from "./link";

/**
 * The personal calendar file (PL14, 2026-11-01). A link is not a sign-in, so nothing is taken from when it was made: every read
 * asks again whether the person is an active member of an active Cloud company, may sign in at all and has accepted the terms, and
 * what they may read now. A removed or paused member, or a paused or local company, gets the same answer as an unknown link. The
 * link's own company is the only one read.
 */
export type CalendarAccess = { userId: string; organizationId: string; admin: boolean; workflowPermissions: WorkflowPermissionProfile; organization?: { disabledModules: readonly string[] } };

export async function calendarAccess(raw: string): Promise<CalendarAccess | null> {
  const userId = calendarTokenUser(raw);
  // The hash is always read and compared, so an id that does not exist takes the same way as one that does.
  const stored = userId ? await prisma.userPreferences.findUnique({ where: { userId }, select: { data: true } }) : null;
  const link = readCalendarLink(stored?.data);
  if (!calendarTokenMatches(link?.tokenHash, raw) || !link || !userId) return null;
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: link.organizationId, userId } },
    select: {
      role: true, isActive: true, workflowPermissions: true,
      user: { select: { id: true, email: true, isActive: true, emailVerifiedAt: true } },
      organization: { select: { id: true, slug: true, isActive: true, storageMode: true, disabledModules: true } },
    },
  });
  if (!membership?.isActive || !canAccessTest(membership.user)) return null;
  const organization = membership.organization;
  if (!organization.isActive || organization.storageMode !== "HINTEK_CLOUD" || isErasedCompany(organization)) return null;
  try {
    await assertRequiredLegalAccess({ user: membership.user, organizationId: organization.id, organization });
  } catch (error) {
    // Terms not accepted is a refusal like the others; a database that does not answer is not.
    if (error instanceof ApiError) return null;
    throw error;
  }
  return { userId, organizationId: organization.id, organization, admin: membership.role === "OWNER" || membership.role === "ADMIN", workflowPermissions: normalizeWorkflowPermissionProfile(membership.workflowPermissions) };
}

/** The rows of the file: only the fields below reach it, never a description, a customer's notes, a fault report's text or a price. */
export async function loadCalendarRows(access: CalendarAccess, now = new Date()): Promise<{ bookings: BookingRow[]; workOrders: WorkOrderRow[]; onCall: OnCallRow[] }> {
  const { organizationId, userId } = access;
  const today = startOfSwedishDay(now);
  const from = addSwedishDays(today, -CALENDAR_DAYS_BACK);
  const to = addSwedishDays(today, CALENDAR_DAYS_AHEAD);
  const readsWorkOrders = access.admin || hasWorkflowPermission(access.workflowPermissions, "work-order", "read");

  // Företagets moduler (0.39.0): the file stops holding what the company has turned off.
  const bookings = !organizationModuleOn(access.organization, "planning") ? [] : (await prisma.plannedActivity.findMany({
    where: {
      organizationId, deletedAt: null, status: { not: "CANCELED" }, startsAt: { lt: to }, endsAt: { gt: from },
      OR: [{ assignedToUserId: userId }, { assignments: { some: { member: { userId } } } }],
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: CALENDAR_ROW_LIMIT,
    select: {
      id: true, title: true, startsAt: true, endsAt: true, updatedAt: true, projectId: true,
      workflowTask: { select: { id: true, kind: true, formArea: true, projectId: true } },
      assignments: { where: { member: { userId } }, select: { startsAt: true, endsAt: true }, take: 1 },
    },
  })).filter((row) => canReadPlannedActivity(access.workflowPermissions, access.admin, row));

  const workOrders = readsWorkOrders ? await prisma.$queryRaw<WorkOrderRow[]>`
    select t.id, t.title, t."plannedStartDate", t."dueDate", t."updatedAt"
    from "WorkflowTask" t
    where t."organizationId" = ${organizationId} and t.kind = 'WORK_ORDER' and t.status not in (${Prisma.join([...CLOSED_TASK_STATUSES])})
      and ${mineTaskSql({ organizationId, user: { id: userId } })} and ${notDormantSql("t", dormantDay(access.organization ?? {}, swedishDayKey(now)))}
      and coalesce(nullif(t."plannedStartDate", ''), t."dueDate") <= ${swedishDayKey(to)}
      and coalesce(nullif(t."dueDate", ''), t."plannedStartDate") >= ${swedishDayKey(from)}
    order by t.id
    limit ${CALENDAR_ROW_LIMIT}` : [];

  const onCall: OnCallRow[] = [];
  if (readsWorkOrders && organizationModuleOn(access.organization, "upkeep")) {
    const reports = await prisma.operatorFaultReport.findMany({
      where: { organizationId, onCall: true, acknowledgedById: userId, taskId: { not: null }, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: "asc" }, take: CALENDAR_ROW_LIMIT, select: { id: true, taskId: true, createdAt: true, acknowledgedAt: true },
    });
    const taskIds = [...new Set(reports.flatMap((report) => (report.taskId ? [report.taskId] : [])))];
    const tasks = taskIds.length ? await prisma.workflowTask.findMany({ where: { id: { in: taskIds }, organizationId, kind: "WORK_ORDER", status: { not: "CANCELLED" } }, select: { id: true, title: true } }) : [];
    const titles = new Map(tasks.map((task) => [task.id, task.title]));
    for (const report of reports) {
      const title = report.taskId ? titles.get(report.taskId) : undefined;
      if (report.taskId && title) onCall.push({ id: report.id, taskId: report.taskId, title, at: report.acknowledgedAt ?? report.createdAt });
    }
  }
  return {
    bookings: bookings.map((row) => ({
      id: row.id, title: row.title, startsAt: row.startsAt, endsAt: row.endsAt, updatedAt: row.updatedAt,
      own: row.assignments[0] ?? null, workflowTask: row.workflowTask ? { id: row.workflowTask.id, kind: row.workflowTask.kind } : null,
    })),
    workOrders, onCall,
  };
}

/** The whole file for a person who has passed calendarAccess on this read. */
export async function calendarFile(access: CalendarAccess, now = new Date()): Promise<string> {
  return buildCalendar(calendarEvents({ ...(await loadCalendarRows(access, now)), appUrl: absoluteUrl }), now);
}
