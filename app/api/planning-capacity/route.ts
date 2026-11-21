import { NextResponse } from "next/server";
import { activitiesInUse } from "@/lib/workflow/capacity-summary";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { canViewTeam, hasWorkflowPermission, readableTaskScope } from "@/lib/workflow/permissions";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { loadAbsences } from "@/lib/absence/server";
import { absenceLabel, countsInPlanning } from "@/lib/workflow/absence";
import { swedishDayKey } from "@/lib/swedish-time";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { addDays } from "@/lib/workflow/schedule";

export const dynamic = "force-dynamic";

/**
 * Read-only capacity data. Whoever may see Teamet (company admins or team:read, 2026-10-28) gets the whole team's
 * working time and load, while a regular member receives only their own schedule. Bookings follow the module rights for both.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    // Planering is read with the project right or a job right (2026-10-10): a standalone job's bookings follow the job.
    const team = canViewTeam(ctx);
    // Teamet alone also opens it: the team's load, with only the bookings the person may read (2026-10-28).
    if (!team && !hasWorkflowPermission(ctx.workflowPermissions, "projects", "read") && !readableTaskScope((subject) => hasWorkflowPermission(ctx.workflowPermissions, subject, "read")).any)
      throw new ApiError(403, "Du saknar behörighet att läsa planering.");
    const memberScope = team ? {} : { userId: ctx.user.id };
    // The same optional from/to window as /api/planned-activities (quality check 2026-10-05, F5): Planning asks only
    // for the period it shows instead of every activity ever planned.
    const params = new URL(request.url).searchParams;
    const day = (value: string | null, end: boolean) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`) : null;
    const [windowFrom, windowTo] = [day(params.get("from"), false), day(params.get("to"), true)];
    const [members, events, activities] = await Promise.all([
      prisma.organizationMember.findMany({
        where: {
          organizationId: ctx.organizationId,
          isActive: true,
          ...memberScope,
          user: { is: { isActive: true } },
        },
        orderBy: { user: { name: "asc" } },
        select: { id: true, userId: true, weeklyWorkMinutes: true, noFixedHours: true, user: { select: { name: true, email: true } } },
      }),
      prisma.workScheduleEvent.findMany({
        where: {
          organizationId: ctx.organizationId,
          scope: "MEMBER",
          member: {
            is: {
              isActive: true,
              ...memberScope,
              user: { is: { isActive: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: { id: true, memberId: true, previousMinutes: true, nextMinutes: true, actorName: true, createdAt: true },
      }),
      prisma.plannedActivity.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null, ...(windowFrom ? { endsAt: { gte: windowFrom } } : {}), ...(windowTo ? { startsAt: { lte: windowTo } } : {}) },
        orderBy: { startsAt: "asc" },
        include: {
          // The job's status (2026-11-02): a booking on a job that has utgått counts for nothing, as in every other count.
          workflowTask: { select: { kind: true, formArea: true, projectId: true, status: true } }, control: { select: { id: true } },
          assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } },
        },
      }),
    ]);
    const visibleActivities = activities.filter((activity) => canReadPlannedActivity(ctx.workflowPermissions, ctx.admin, activity));
    // Frånvaro (2026-10-29): approved absence of the members shown, with only the words this person may see. It lowers the available
    // time (2026-11-02), so past weeks keep theirs: without `from` a year back. Only while the Tid module is on, as Teamet.
    const viewer = { id: ctx.user.id, admin: ctx.admin, team };
    const absences = organizationModuleOn(ctx.organization, "time") ? await loadAbsences(ctx.organizationId, params.get("from") && /^\d{4}-\d{2}-\d{2}$/.test(params.get("from")!) ? params.get("from")! : addDays(swedishDayKey(new Date()), -366),
      { userIds: members.map((member) => member.userId), ...(params.get("to") && /^\d{4}-\d{2}-\d{2}$/.test(params.get("to")!) ? { toDay: params.get("to")! } : {}) }) : [];
    const memberName = new Map(members.map((member) => [member.userId, member.user.name || member.user.email]));
    return NextResponse.json({
      absences: absences.filter(countsInPlanning).map((absence) => ({ userId: absence.userId, name: memberName.get(absence.userId) ?? "", label: absenceLabel(viewer, absence), from: absence.from, to: absence.to, hours: absence.hours })),
      canViewTeam: team,
      organizationWeeklyWorkMinutes: ctx.organization.weeklyWorkMinutes,
      members: members.map((member) => ({
        id: member.userId,
        name: member.user.name || member.user.email,
        weeklyWorkMinutes: member.weeklyWorkMinutes ?? ctx.organization.weeklyWorkMinutes,
        memberWeeklyWorkMinutes: member.weeklyWorkMinutes,
        // Ingen fast arbetstid (2026-10-30): no capacity; weeklyWorkMinutes above only spreads bookings over the days.
        noFixedHours: member.noFixedHours,
        events: events.filter((event) => event.memberId === member.id).map((event) => ({
          id: event.id,
          previousMinutes: event.previousMinutes,
          nextMinutes: event.nextMinutes,
          actorName: event.actorName,
          createdAt: event.createdAt,
        })),
      })),
      activities: activitiesInUse(visibleActivities, ctx.organization).map((activity) => ({
        id: activity.id,
        title: activity.title,
        startsAt: activity.startsAt,
        endsAt: activity.endsAt,
        assignedToUserId: activity.assignedToUserId,
        assignedToUserIds: activity.assignments.map((assignment) => assignment.member.userId),
        assignments: activity.assignments.map((assignment) => ({ userId: assignment.member.userId, plannedMinutes: assignment.plannedMinutes, startsAt: assignment.startsAt, endsAt: assignment.endsAt })),
        status: activity.status,
        projectId: activity.projectId,
        // The booked job (2026-10-28): a round occurrence booked through its work order is not counted twice.
        workflowTaskId: activity.workflowTaskId,
        workflowTask: activity.workflowTask ? { status: activity.workflowTask.status } : null,
      })),
    });
  } catch (error) {
    return failure(error);
  }
}
