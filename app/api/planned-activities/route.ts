import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireWorkflowPermission } from "@/lib/kfid/server";
import { hasWorkflowPermission, workflowSubjectForTask } from "@/lib/workflow/permissions";
import { planningFrameError } from "@/lib/workflow/project-frame";
import { canManageProjectLifecycle } from "@/lib/workflow/project-status";
import { plannedActivityAssignments, plannedActivityInputSchema, plannedActivitySummary } from "@/lib/workflow/planned-activity";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";

const identifier = z.string().min(1).max(100);
const json = (value: unknown) => value as Prisma.InputJsonValue;
export const dynamic = "force-dynamic";

type ActivityInput = z.infer<typeof plannedActivityInputSchema>;

function snapshot(activity: {
  title: string; description: string; kind: string; status: string; startsAt: Date; endsAt: Date;
  projectId: string | null; workflowTaskId: string | null; controlId: string | null;
  assignedToUserId: string | null; assignedToUserIds?: string[]; assignments?: { userId: string; plannedMinutes: number | null; startsAt: string | null; endsAt: string | null }[]; assignedToName: string; version: number; deletedAt: Date | null;
}) {
  return {
    title: activity.title, description: activity.description, kind: activity.kind, status: activity.status,
    startsAt: activity.startsAt.toISOString(), endsAt: activity.endsAt.toISOString(), projectId: activity.projectId,
    workflowTaskId: activity.workflowTaskId, controlId: activity.controlId, assignedToUserId: activity.assignedToUserId,
    assignedToUserIds: activity.assignedToUserIds ?? (activity.assignedToUserId ? [activity.assignedToUserId] : []),
    assignments: activity.assignments ?? [],
    assignedToName: activity.assignedToName, version: activity.version, deletedAt: activity.deletedAt?.toISOString() ?? null,
  };
}

async function verifyReferences(ctx: Awaited<ReturnType<typeof context>>, data: ActivityInput) {
  requireWorkflowPermission(ctx, "projects", data.id ? "edit" : "create");
  const projectSelect = { id: true, archivedAt: true, closedAt: true, startDate: true, dueDate: true, responsibleUserId: true } as const;
  const [project, workflowTask, control, previous] = await Promise.all([
    data.projectId ? prisma.project.findFirst({ where: { id: data.projectId, organizationId: ctx.organizationId }, select: projectSelect }) : null,
    data.workflowTaskId ? prisma.workflowTask.findFirst({ where: { id: data.workflowTaskId, organizationId: ctx.organizationId }, select: { id: true, kind: true, formArea: true, projectId: true, status: true, project: { select: projectSelect } } }) : null,
    data.controlId ? prisma.control.findFirst({ where: { id: data.controlId, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true, projectId: true, status: true, workflowProject: { select: projectSelect } } }) : null,
    data.id ? prisma.plannedActivity.findFirst({ where: { id: data.id, organizationId: ctx.organizationId }, select: { startsAt: true, endsAt: true, projectId: true, workflowTaskId: true, controlId: true } }) : null,
  ]);
  // The project is the frame (2026-09-26, decision 4). Only new planning, or planning whose time, project or
  // task changes, is checked; existing planning outside the frame stays as it is and is shown as a deviation.
  const active = !["COMPLETED", "CANCELED"].includes(data.status);
  const changed = !previous || previous.startsAt.toISOString() !== new Date(data.startsAt).toISOString() || previous.endsAt.toISOString() !== new Date(data.endsAt).toISOString()
    || previous.projectId !== data.projectId || previous.workflowTaskId !== data.workflowTaskId || previous.controlId !== data.controlId;
  if (active && changed && (workflowTask?.status === "COMPLETED" || control?.status === "COMPLETED"))
    throw new ApiError(409, "Uppgiften är slutförd. Återöppna den innan du planerar mer arbete på den.");
  const frameProject = project ?? workflowTask?.project ?? control?.workflowProject ?? null;
  const frameError = active && changed ? planningFrameError(data, frameProject) : null;
  let frameException = "";
  if (frameError) {
    if (!data.frameExceptionReason) throw new ApiError(409, `${frameError} Projektansvarig eller en företagsadministratör kan göra ett undantag med en motivering.`);
    if (!canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: frameProject?.responsibleUserId, canEditProjects: hasWorkflowPermission(ctx.workflowPermissions, "projects", "edit") }))
      throw new ApiError(403, "Bara projektansvarig eller en företagsadministratör kan göra undantag från projektets tidsram.");
    frameException = data.frameExceptionReason;
  }
  if (data.projectId && !project) throw new ApiError(400, "Projektet hittades inte.");
  if (project?.archivedAt) throw new ApiError(409, "Återställ projektet innan du planerar arbete i det.");
  // A closed project takes no new or active planning; marking old planning completed or cancelled is still allowed.
  if (project?.closedAt && !["COMPLETED", "CANCELED"].includes(data.status)) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet innan du planerar arbete i det.");
  if (data.workflowTaskId && !workflowTask) throw new ApiError(400, "Uppgiften hittades inte.");
  if (data.controlId && !control) throw new ApiError(400, "Kontrollen hittades inte.");
  if (workflowTask) requireWorkflowPermission(ctx, workflowSubjectForTask(workflowTask.kind, workflowTask.formArea), "edit");
  if (control) requireWorkflowPermission(ctx, "kfid", "edit");
  const linkedProjectId = workflowTask?.projectId ?? control?.projectId ?? null;
  if (data.projectId && linkedProjectId && data.projectId !== linkedProjectId)
    throw new ApiError(400, "Den valda uppgiften tillhör ett annat projekt.");
  const assignmentInputs = plannedActivityAssignments(data);
  const assignedToUserIds = assignmentInputs.map((assignment) => assignment.userId);
  const members = assignedToUserIds.length ? await prisma.organizationMember.findMany({
    where: {
      organizationId: ctx.organizationId, isActive: true, userId: { in: assignedToUserIds },
      user: { is: { isActive: true } },
    },
    select: { id: true, userId: true, user: { select: { name: true, email: true } } },
  }) : [];
  if (members.length !== assignedToUserIds.length)
    throw new ApiError(400, "Varje ansvarig måste vara en aktiv medlem i arbetsytan.");
  const memberByUserId = new Map(members.map((member) => [member.userId, member]));
  const assignments = assignedToUserIds.map((userId) => memberByUserId.get(userId)!);
  const assignedToName = assignments.length
    ? assignments.map((member) => member.user.name || member.user.email).join(", ")
    : data.assignedToName;
  return { assignedToUserIds, assignedToName, assignments, assignmentInputs, workflowTask, control, frameException, frameProjectId: frameProject?.id ?? null };
}

// A frame exception is logged on the planning and on the project (append-only).
async function logFrameException(tx: Prisma.TransactionClient, ctx: Awaited<ReturnType<typeof context>>, references: { frameException: string; frameProjectId: string | null }, title: string) {
  if (!references.frameException || !references.frameProjectId) return;
  await tx.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: references.frameProjectId, kind: "PLANNING_EXCEPTION", summary: `Planeringen ${title} fick undantag från projektets tidsram: ${references.frameException}`, actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } });
}

async function requireExistingEditPermission(ctx: Awaited<ReturnType<typeof context>>, id: string) {
  const current = await prisma.plannedActivity.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
    include: { workflowTask: { select: { kind: true, formArea: true } }, assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } } },
  });
  if (!current) throw new ApiError(404, "Den planerade aktiviteten hittades inte.");
  requireWorkflowPermission(ctx, "projects", "edit");
  if (current.workflowTask) requireWorkflowPermission(ctx, workflowSubjectForTask(current.workflowTask.kind, current.workflowTask.formArea), "edit");
  if (current.controlId) requireWorkflowPermission(ctx, "kfid", "edit");
  return current;
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    // An optional window (2026-09-30): from/to (YYYY-MM-DD) read only the activities overlapping those days, so the
    // API/MCP/AI tools never read the whole plan; without them the planning page reads everything as before.
    const params = new URL(request.url).searchParams;
    const day = (value: string | null, end: boolean) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`) : null;
    const [windowFrom, windowTo] = [day(params.get("from"), false), day(params.get("to"), true)];
    const activities = await prisma.plannedActivity.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, ...(windowFrom ? { endsAt: { gte: windowFrom } } : {}), ...(windowTo ? { startsAt: { lte: windowTo } } : {}) },
      orderBy: { startsAt: "asc" },
      include: {
        project: { select: { id: true, name: true, timeBudgetMinutes: true } },
        workflowTask: { select: { id: true, title: true, kind: true, projectId: true } },
        control: { select: { id: true, title: true, projectId: true } },
        assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true, user: { select: { name: true, email: true } } } } } },
        // Bounded history (2026-09-26): the newest events and a count. Snapshots stay in the database and export.
        events: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, kind: true, summary: true, actorName: true, createdAt: true } },
        _count: { select: { events: true } },
      },
    });
    return NextResponse.json({ activities: activities.filter((activity) => canReadPlannedActivity(ctx.workflowPermissions, ctx.admin, activity)).map(({ _count, ...activity }) => ({
      ...activity,
      eventCount: _count.events,
      assignedToUserIds: activity.assignments.map((assignment) => assignment.member.userId),
      assignments: activity.assignments.map((assignment) => ({ userId: assignment.member.userId, plannedMinutes: assignment.plannedMinutes, startsAt: assignment.startsAt, endsAt: assignment.endsAt })),
      assignedToName: activity.assignments.length
        ? activity.assignments.map((assignment) => assignment.member.user.name || assignment.member.user.email).join(", ")
        : activity.assignedToName,
    })) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("save"), activity: plannedActivityInputSchema }),
      z.object({ action: z.literal("delete"), id: identifier, version: z.number().int().positive() }),
    ]).parse(await body(request));
    const actorName = ctx.user.name || ctx.user.email;

    if (input.action === "delete") {
      const current = await requireExistingEditPermission(ctx, input.id);
      if (current.version !== input.version) throw new ApiError(409, "Planeringen har ändrats. Läs in den senaste versionen.");
      const now = new Date();
      const nextVersion = current.version + 1;
      const after = { ...current, assignedToUserIds: current.assignments.map((assignment) => assignment.member.userId), assignments: current.assignments.map((assignment) => ({ userId: assignment.member.userId, plannedMinutes: assignment.plannedMinutes, startsAt: assignment.startsAt?.toISOString() ?? null, endsAt: assignment.endsAt?.toISOString() ?? null })), version: nextVersion, deletedAt: now };
      await prisma.$transaction(async (tx) => {
        const changed = await tx.plannedActivity.updateMany({
          where: { id: current.id, organizationId: ctx.organizationId, version: current.version, deletedAt: null },
          data: { version: { increment: 1 }, deletedAt: now, updatedBy: ctx.user.id },
        });
        if (!changed.count) throw new ApiError(409, "Planeringen har ändrats. Läs in den senaste versionen.");
        await tx.plannedActivityEvent.create({ data: { organizationId: ctx.organizationId, plannedActivityId: current.id, kind: "DELETED", summary: plannedActivitySummary("DELETED", current.title), snapshot: json(snapshot(after)), actorName, createdBy: ctx.user.id } });
      });
      return NextResponse.json({ ok: true });
    }

    const data = input.activity;
    const references = await verifyReferences(ctx, data);
    if (data.id) {
      const current = await requireExistingEditPermission(ctx, data.id);
      if (data.version !== current.version) throw new ApiError(409, "Planeringen har ändrats. Läs in den senaste versionen.");
      const values = {
        title: data.title, description: data.description, kind: data.kind, status: data.status,
        startsAt: new Date(data.startsAt), endsAt: new Date(data.endsAt), projectId: data.projectId,
        workflowTaskId: data.workflowTaskId, controlId: data.controlId, assignedToUserId: references.assignedToUserIds[0] ?? null,
        assignedToName: references.assignedToName,
      };
      const after = { ...values, assignedToUserIds: references.assignedToUserIds, assignments: references.assignmentInputs, version: current.version + 1, deletedAt: null };
      await prisma.$transaction(async (tx) => {
        const changed = await tx.plannedActivity.updateMany({
          where: { id: current.id, organizationId: ctx.organizationId, version: current.version, deletedAt: null },
          data: { ...values, version: { increment: 1 }, updatedBy: ctx.user.id },
        });
        if (!changed.count) throw new ApiError(409, "Planeringen har ändrats. Läs in den senaste versionen.");
        await tx.plannedActivityAssignment.deleteMany({ where: { organizationId: ctx.organizationId, plannedActivityId: current.id } });
        if (references.assignments.length) await tx.plannedActivityAssignment.createMany({
          data: references.assignments.map((member) => {
            const allocation = references.assignmentInputs.find((item) => item.userId === member.userId)!;
            return { organizationId: ctx.organizationId, plannedActivityId: current.id, memberId: member.id,
              plannedMinutes: allocation.plannedMinutes, startsAt: allocation.startsAt ? new Date(allocation.startsAt) : null, endsAt: allocation.endsAt ? new Date(allocation.endsAt) : null };
          }),
        });
        await tx.plannedActivityEvent.create({ data: { organizationId: ctx.organizationId, plannedActivityId: current.id, kind: "UPDATED", summary: `${plannedActivitySummary("UPDATED", data.title)}${references.frameException ? ` (undantag från projektets tidsram: ${references.frameException})` : ""}`, snapshot: json(snapshot(after)), actorName, createdBy: ctx.user.id } });
        await logFrameException(tx, ctx, references, data.title);
      });
      return NextResponse.json({ id: current.id, version: current.version + 1 });
    }

    const created = await prisma.$transaction(async (tx) => {
      const activity = await tx.plannedActivity.create({
        data: {
          organizationId: ctx.organizationId, title: data.title, description: data.description, kind: data.kind, status: data.status,
          startsAt: new Date(data.startsAt), endsAt: new Date(data.endsAt), projectId: data.projectId,
          workflowTaskId: data.workflowTaskId, controlId: data.controlId, assignedToUserId: references.assignedToUserIds[0] ?? null,
          assignedToName: references.assignedToName, createdBy: ctx.user.id, updatedBy: ctx.user.id,
        },
      });
      if (references.assignments.length) await tx.plannedActivityAssignment.createMany({
        data: references.assignments.map((member) => {
          const allocation = references.assignmentInputs.find((item) => item.userId === member.userId)!;
          return { organizationId: ctx.organizationId, plannedActivityId: activity.id, memberId: member.id,
            plannedMinutes: allocation.plannedMinutes, startsAt: allocation.startsAt ? new Date(allocation.startsAt) : null, endsAt: allocation.endsAt ? new Date(allocation.endsAt) : null };
        }),
      });
      await logFrameException(tx, ctx, references, activity.title);
      await tx.plannedActivityEvent.create({ data: { organizationId: ctx.organizationId, plannedActivityId: activity.id, kind: "CREATED", summary: `${plannedActivitySummary("CREATED", activity.title)}${references.frameException ? ` (undantag från projektets tidsram: ${references.frameException})` : ""}`, snapshot: json(snapshot({ ...activity, assignedToUserIds: references.assignedToUserIds, assignments: references.assignmentInputs })), actorName, createdBy: ctx.user.id } });
      return activity;
    });
    return NextResponse.json({ id: created.id, version: created.version });
  } catch (error) {
    return failure(error);
  }
}
