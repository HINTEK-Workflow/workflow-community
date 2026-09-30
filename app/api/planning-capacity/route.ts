import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { hasWorkflowPermission } from "@/lib/workflow/permissions";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";

export const dynamic = "force-dynamic";

/**
 * Read-only capacity data. The organization admin may plan its own team,
 * while a regular member receives only their own schedule and permitted work.
 */
export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    if (!ctx.admin && !hasWorkflowPermission(ctx.workflowPermissions, "projects", "read"))
      throw new ApiError(403, "Du saknar behörighet att läsa planering.");
    const memberScope = ctx.admin ? {} : { userId: ctx.user.id };
    const [members, events, activities] = await Promise.all([
      prisma.organizationMember.findMany({
        where: {
          organizationId: ctx.organizationId,
          isActive: true,
          ...memberScope,
          user: { is: { isActive: true } },
        },
        orderBy: { user: { name: "asc" } },
        select: { id: true, userId: true, weeklyWorkMinutes: true, user: { select: { name: true, email: true } } },
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
        where: { organizationId: ctx.organizationId, deletedAt: null },
        orderBy: { startsAt: "asc" },
        include: {
          workflowTask: { select: { kind: true } }, control: { select: { id: true } },
          assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } },
        },
      }),
    ]);
    const visibleActivities = activities.filter((activity) => canReadPlannedActivity(ctx.workflowPermissions, ctx.admin, activity));
    return NextResponse.json({
      canViewTeam: ctx.admin,
      organizationWeeklyWorkMinutes: ctx.organization.weeklyWorkMinutes,
      members: members.map((member) => ({
        id: member.userId,
        name: member.user.name || member.user.email,
        weeklyWorkMinutes: member.weeklyWorkMinutes ?? ctx.organization.weeklyWorkMinutes,
        memberWeeklyWorkMinutes: member.weeklyWorkMinutes,
        events: events.filter((event) => event.memberId === member.id).map((event) => ({
          id: event.id,
          previousMinutes: event.previousMinutes,
          nextMinutes: event.nextMinutes,
          actorName: event.actorName,
          createdAt: event.createdAt,
        })),
      })),
      activities: visibleActivities.map((activity) => ({
        startsAt: activity.startsAt,
        endsAt: activity.endsAt,
        assignedToUserId: activity.assignedToUserId,
        assignedToUserIds: activity.assignments.map((assignment) => assignment.member.userId),
        assignments: activity.assignments.map((assignment) => ({ userId: assignment.member.userId, plannedMinutes: assignment.plannedMinutes, startsAt: assignment.startsAt, endsAt: assignment.endsAt })),
        status: activity.status,
        projectId: activity.projectId,
      })),
    });
  } catch (error) {
    return failure(error);
  }
}
