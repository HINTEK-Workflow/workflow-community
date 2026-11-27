import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule, requireWorkflowPermission } from "@/lib/kfid/server";
import { hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { canManageProjectLifecycle } from "@/lib/workflow/project-status";
import { planningFrameError } from "@/lib/workflow/project-frame";
import { bookedUserIds, bookingChangeRefusal } from "@/lib/workflow/bookings";
import { publishTaskChange } from "@/lib/workflow/live-bus";
import {
  bookingMoveRefusal, bookingShiftWorkdays, planFollowerMoves, movableBooking, predecessorError, scheduleBookingOf, scheduleChangeSummary, scheduleInputSchema,
  schedulePeriodError, shiftBookingTimes,
} from "@/lib/workflow/schedule";
import { effectiveStartDate } from "@/lib/workflow/job-planning";
import { jobObstacle } from "@/lib/workflow/obstacles";
import { swedishDayKey } from "@/lib/swedish-time";

/**
 * Tidplan (Gantt v1, 2026-10-09): the project's jobs with their period (Start → Klart senast), estimated time and
 * predecessors (Börjar efter), and the bookings on them, for the project page's time plan; and the change of one job's
 * period from it – optionally with its bookings ("Flytta även bokningarna"). Every read is bounded to the company and to
 * what the person may read; every change checks the same rights as saving the job, and moved bookings the same rights as
 * changing them in Planering (app/api/planned-activities): admin, project responsible, stand-in or one's own.
 */
const identifier = z.string().min(1).max(100);
const json = (value: unknown) => value as Prisma.InputJsonValue;
const JOB_LIMIT = 300;
const BOOKING_LIMIT = 500;
const FINISHED = ["COMPLETED", "CANCELLED"];
const projectSelect = { id: true, startDate: true, dueDate: true, archivedAt: true, closedAt: true, responsibleUserId: true, planningDelegateUserId: true } as const;
export const dynamic = "force-dynamic";

type Ctx = Awaited<ReturnType<typeof context>>;
const canFor = (ctx: Ctx) => (subject: WorkflowPermissionSubject, action: "read" | "edit") => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, action);

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireWorkflowPermission(ctx, "projects", "read");
    const projectId = identifier.parse(new URL(request.url).searchParams.get("projectId"));
    const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: ctx.organizationId }, select: projectSelect });
    if (!project) throw new ApiError(404, "Projektet hittades inte.");
    const can = canFor(ctx);
    // Etapp (plan 1M): the stages already used in the project – the job editor's suggestions (`stages=1`).
    if (new URL(request.url).searchParams.get("stages") === "1") {
      const rows = await prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId, projectId: project.id, stage: { not: "" }, AND: [readableTaskWhere((subject) => can(subject, "read"))] },
        distinct: ["stage"], orderBy: { stage: "asc" }, take: 50, select: { stage: true },
      });
      return NextResponse.json({ stages: rows.map((row) => row.stage) });
    }
    const tasks = await prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId, projectId: project.id, AND: [readableTaskWhere((subject) => can(subject, "read"))] },
      orderBy: [{ plannedStartDate: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }], take: JOB_LIMIT,
      select: { id: true, title: true, kind: true, formArea: true, status: true, progress: true, workOrderId: true, plannedStartDate: true, dueDate: true, estimatedMinutes: true, predecessorIds: true, assignedToName: true, version: true, completedAt: true, stage: true, createdAt: true },
    });
    // Hinder (plan 1M): an obstacle only stands on a job that needs action or is paused, so only those jobs' data is read.
    const holding = tasks.filter((task) => task.status === "NEEDS_ACTION" || task.status === "PAUSED").map((task) => task.id);
    const obstacleRows = holding.length ? await prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, id: { in: holding } }, select: { id: true, status: true, data: true, updatedAt: true } }) : [];
    const obstacles = new Map(obstacleRows.flatMap((row) => { const obstacle = jobObstacle(row); return obstacle ? [[row.id, obstacle] as const] : []; }));
    const locked = Boolean(project.archivedAt || project.closedAt);
    const taskIds = new Set(tasks.map((task) => task.id));
    const activities = await prisma.plannedActivity.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, status: { not: "CANCELED" }, OR: [{ projectId: project.id }, { workflowTaskId: { in: [...taskIds] } }] },
      orderBy: { startsAt: "asc" }, take: BOOKING_LIMIT,
      select: { id: true, projectId: true, workflowTaskId: true, title: true, kind: true, status: true, startsAt: true, endsAt: true, assignedToName: true, assignedToUserId: true, workflowTask: { select: { kind: true, formArea: true, projectId: true } }, assignments: { select: { member: { select: { userId: true } } } } },
    });
    const canEditProjects = can("projects", "edit");
    return NextResponse.json({
      today: swedishDayKey(new Date()),
      project: {
        id: project.id, startDate: project.startDate ?? "", dueDate: project.dueDate ?? "", locked,
        canFrameException: canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project.responsibleUserId, canEditProjects }),
      },
      // Börjar efter: only the predecessors the person can see in this project are sent; the others stay on save.
      // A finished job's bar ends the day it was finished (lib/workflow/schedule.ts jobPeriod).
      jobs: tasks.map(({ formArea, predecessorIds, completedAt, createdAt, ...task }) => ({ ...task, effectiveStart: effectiveStartDate({ plannedStartDate: task.plannedStartDate, createdAt }), obstacle: obstacles.get(task.id) ?? null, completedDay: task.status === "COMPLETED" && completedAt ? swedishDayKey(completedAt) : "", predecessorIds: (predecessorIds ?? []).filter((id) => taskIds.has(id)), canEdit: !locked && !FINISHED.includes(task.status) && can(workflowSubjectForTask(task.kind, formArea), "edit") })),
      bookings: activities.filter((activity) => canReadPlannedActivity(ctx.workflowPermissions, ctx.admin, activity)).map((activity) => {
        const people = bookedUserIds({ assignedToUserId: activity.assignedToUserId, assignments: activity.assignments.map((item) => ({ userId: item.member.userId })) });
        // "Flytta även bokningarna": whether this person may move it with its job (the same rule as Planering).
        const canMove = Boolean(activity.workflowTaskId) && movableBooking(activity) && canEditProjects
          && !bookingChangeRefusal({ admin: ctx.admin, userId: ctx.user.id, before: people, after: people, project });
        return { ...scheduleBookingOf(activity), status: activity.status, canMove };
      }),
    });
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
    requireModule(ctx, "planning");
    const input = scheduleInputSchema.parse(await body(request));
    const current = await prisma.workflowTask.findFirst({ where: { id: input.taskId, organizationId: ctx.organizationId } });
    if (!current) throw new ApiError(404, "Jobbet hittades inte.");
    if (current.projectId) requireModule(ctx, "projects");
    // The same right as saving the job itself.
    requireWorkflowPermission(ctx, workflowSubjectForTask(current.kind, current.formArea), "edit");
    if (current.status === "COMPLETED") throw new ApiError(409, "Jobbet är färdigställt. Återöppna det innan du ändrar tidplanen.");
    if (current.status === "CANCELLED") throw new ApiError(409, "Jobbet har utgått. Återuppta det innan du ändrar tidplanen.");
    if (current.version !== input.version) throw new ApiError(409, "Jobbet har ändrats. Läs in den senaste versionen.");
    const project = current.projectId ? await prisma.project.findFirst({ where: { id: current.projectId, organizationId: ctx.organizationId }, select: projectSelect }) : null;
    if (project?.archivedAt) throw new ApiError(409, "Återställ projektet innan du ändrar tidplanen.");
    if (project?.closedAt) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet innan du ändrar tidplanen.");
    const frame = project ? { startDate: project.startDate ?? "", dueDate: project.dueDate ?? "" } : null;
    const canEditProjects = hasWorkflowPermission(ctx.workflowPermissions, "projects", "edit");
    // Start på alla jobb (plan 1M): an older job without a Start counts from the day it was created; nothing is written for
    // it unless its Start is really changed, and a Start is never cleared.
    const effective = effectiveStartDate(current);
    const next = { plannedStartDate: input.plannedStartDate || effective, dueDate: input.dueDate, estimatedMinutes: input.estimatedMinutes };
    const writeStart = Boolean(current.plannedStartDate) || next.plannedStartDate !== effective;
    // Only a changed period is checked against the frame; an existing deviation stays and is shown as one (decision 15).
    const periodChanged = next.plannedStartDate !== effective || next.dueDate !== current.dueDate;
    const periodError = periodChanged ? schedulePeriodError(next, frame) : null;
    let frameException = "";
    if (periodError && !periodError.frame) throw new ApiError(400, periodError.message);
    if (periodError) {
      // Outside the project's frame: the same rule as bookings – an exception with a reason by the project manager or an administrator.
      if (!input.frameExceptionReason) throw new ApiError(409, `${periodError.message} Projektansvarig eller en företagsadministratör kan göra ett undantag med en motivering.`);
      if (!canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project?.responsibleUserId, canEditProjects }))
        throw new ApiError(403, "Bara projektansvarig eller en företagsadministratör kan göra undantag från projektets tidsram.");
      frameException = input.frameExceptionReason;
    }

    // Börjar efter (steg 4): jobs in the same project and company, no circle; predecessors the person cannot read stay.
    const previousPredecessors = current.predecessorIds ?? [];
    let predecessorIds = previousPredecessors;
    let predecessorTitles: string[] = [];
    if (input.predecessorIds) {
      const wanted = [...new Set(input.predecessorIds)];
      if (!project && wanted.length) throw new ApiError(400, "Börjar efter finns bara för jobb i ett projekt.");
      const can = canFor(ctx);
      const [projectJobs, readable] = project ? await Promise.all([
        prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, projectId: project.id }, select: { id: true, title: true, predecessorIds: true }, take: 1000 }),
        prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, projectId: project.id, AND: [readableTaskWhere((subject) => can(subject, "read"))] }, select: { id: true }, take: 1000 }),
      ]) : [[], []];
      const readableIds = new Set(readable.map((job) => job.id));
      if (wanted.some((id) => !readableIds.has(id))) throw new ApiError(400, "Börjar efter kan bara peka på jobb i samma projekt.");
      const projectIds = new Set(projectJobs.map((job) => job.id));
      predecessorIds = [...wanted, ...previousPredecessors.filter((id) => projectIds.has(id) && !readableIds.has(id) && !wanted.includes(id))];
      const problem = predecessorError(current.id, predecessorIds, projectJobs);
      if (problem) throw new ApiError(400, problem);
      predecessorTitles = wanted.map((id) => projectJobs.find((job) => job.id === id)?.title ?? "").filter(Boolean);
    }
    const predecessorsChanged = predecessorIds.length !== previousPredecessors.length || predecessorIds.some((id, index) => id !== previousPredecessors[index]);

    // Flytta även bokningarna: as many workdays as Start moved; every booking must be one this person may move, or nothing moves.
    const shift = input.moveBookings && periodChanged ? bookingShiftWorkdays({ plannedStartDate: current.plannedStartDate, effectiveStart: effective }, next) : 0;
    const moves: { id: string; version: number; title: string; from: { startsAt: Date; endsAt: Date }; to: { startsAt: Date; endsAt: Date }; assignments: { id: string; startsAt: Date | null; endsAt: Date | null }[] }[] = [];
    let bookingException = "";
    if (shift) {
      requireWorkflowPermission(ctx, "projects", "edit");
      const bookings = await prisma.plannedActivity.findMany({
        where: { organizationId: ctx.organizationId, workflowTaskId: current.id, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELED"] }, kind: { not: "DEADLINE" } },
        orderBy: { startsAt: "asc" }, take: BOOKING_LIMIT,
        select: { id: true, version: true, title: true, kind: true, status: true, startsAt: true, endsAt: true, assignedToUserId: true, assignedToName: true, workflowTaskId: true, assignments: { select: { id: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } } },
      });
      const blocked = bookings.filter((booking) => {
        const people = bookedUserIds({ assignedToUserId: booking.assignedToUserId, assignments: booking.assignments.map((item) => ({ userId: item.member.userId })) });
        return bookingChangeRefusal({ admin: ctx.admin, userId: ctx.user.id, before: people, after: people, project });
      });
      const refusal = bookingMoveRefusal(blocked.map(scheduleBookingOf));
      if (refusal) throw new ApiError(403, refusal);
      for (const booking of bookings) moves.push({
        id: booking.id, version: booking.version, title: booking.title, from: { startsAt: booking.startsAt, endsAt: booking.endsAt }, to: shiftBookingTimes(booking, shift),
        assignments: booking.assignments.map((item) => item.startsAt && item.endsAt ? { id: item.id, ...shiftBookingTimes({ startsAt: item.startsAt, endsAt: item.endsAt }, shift) } : { id: item.id, startsAt: null, endsAt: null }),
      });
      // A moved booking outside the project's frame needs the same exception as a booking saved in Planering.
      const outside = frame ? moves.filter((move) => planningFrameError(move.to, frame)) : [];
      if (outside.length) {
        if (!input.frameExceptionReason) throw new ApiError(409, `${outside.length === 1 ? "En bokning hamnar" : `${outside.length} bokningar hamnar`} utanför projektets tidsram (${frame!.startDate}–${frame!.dueDate}). Projektansvarig eller en företagsadministratör kan göra ett undantag med en motivering.`);
        if (!canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project?.responsibleUserId, canEditProjects }) && !(canEditProjects && project?.planningDelegateUserId === ctx.user.id))
          throw new ApiError(403, "Bara projektansvarig eller en företagsadministratör kan göra undantag från projektets tidsram.");
        bookingException = input.frameExceptionReason;
      }
    }

    // Flytta efterföljande jobb (plan 1M): the jobs that start after this one (in a chain) move as many workdays as it does –
    // all or none: every one must be editable by this person, none finished, and inside the frame (or an exception is made).
    const followerMoves: { id: string; title: string; version: number; to: { plannedStartDate: string; dueDate: string } }[] = [];
    let followerException = "";
    if (input.moveFollowers && periodChanged && project) {
      const mayEdit = canFor(ctx);
      const projectJobs = await prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, projectId: project.id }, select: { id: true, title: true, kind: true, formArea: true, status: true, version: true, plannedStartDate: true, dueDate: true, predecessorIds: true, createdAt: true }, take: 1000 });
      const plan = planFollowerMoves({
        jobId: current.id, previous: { plannedStartDate: effective, dueDate: current.dueDate }, next, frame,
        jobs: projectJobs.map((job) => ({ ...job, plannedStartDate: effectiveStartDate(job) })), canEdit: (job) => mayEdit(workflowSubjectForTask(job.kind, job.formArea), "edit"),
      });
      if (plan.locked.length) throw new ApiError(403, `Efterföljande jobb kan inte flyttas med: ${plan.locked.map((job) => job.title || "Utan rubrik").join(", ")}. Du får inte ändra dem. Välj Flytta bara jobbet, eller be någon med rätt behörighet flytta dem.`);
      if (plan.invalid) throw new ApiError(400, plan.invalid);
      if (plan.outsideFrame.length) {
        if (!input.frameExceptionReason) throw new ApiError(409, `${plan.outsideFrame.length === 1 ? "Ett efterföljande jobb hamnar" : `${plan.outsideFrame.length} efterföljande jobb hamnar`} utanför projektets tidsram (${frame!.startDate}–${frame!.dueDate}). Projektansvarig eller en företagsadministratör kan göra ett undantag med en motivering.`);
        if (!canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project.responsibleUserId, canEditProjects }))
          throw new ApiError(403, "Bara projektansvarig eller en företagsadministratör kan göra undantag från projektets tidsram.");
        followerException = input.frameExceptionReason;
      }
      followerMoves.push(...plan.moves.map((move) => ({ id: move.job.id, title: move.job.title, version: move.job.version, to: move.to })));
    }

    if (!periodChanged && next.estimatedMinutes === current.estimatedMinutes && !predecessorsChanged) return NextResponse.json({ id: current.id, version: current.version });
    const nextVersion = current.version + 1;
    const actorName = ctx.user.name || ctx.user.email;
    await prisma.$transaction(async (tx) => {
      const changed = await tx.workflowTask.updateMany({
        where: { id: current.id, organizationId: ctx.organizationId, version: current.version, status: { notIn: FINISHED } },
        data: { dueDate: next.dueDate, estimatedMinutes: next.estimatedMinutes, ...(writeStart ? { plannedStartDate: next.plannedStartDate } : {}), predecessorIds, version: { increment: 1 }, updatedBy: ctx.user.id },
      });
      if (!changed.count) throw new ApiError(409, "Jobbet har ändrats. Läs in den senaste versionen.");
      // The job's own history gets the version; the project's history the line (and the exception, append-only).
      await tx.workflowTaskRevision.create({ data: { taskId: current.id, version: nextVersion, snapshot: json({ ...current, ...next, predecessorIds, version: nextVersion }), createdBy: ctx.user.id } });
      for (const follower of followerMoves) {
        const done = await tx.workflowTask.updateMany({ where: { id: follower.id, organizationId: ctx.organizationId, version: follower.version, status: { notIn: FINISHED } }, data: { plannedStartDate: follower.to.plannedStartDate, dueDate: follower.to.dueDate, version: { increment: 1 }, updatedBy: ctx.user.id } });
        if (!done.count) throw new ApiError(409, `Jobbet ${follower.title || "Utan rubrik"} har ändrats. Läs in tidplanen igen.`);
        const row = await tx.workflowTask.findFirst({ where: { id: follower.id, organizationId: ctx.organizationId } });
        if (row) await tx.workflowTaskRevision.create({ data: { taskId: follower.id, version: follower.version + 1, snapshot: json(row), createdBy: ctx.user.id } });
        await tx.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: project!.id, kind: "TASK_SCHEDULED", summary: `Tidplanen för ${follower.title || "jobbet"} ändrades: start ${follower.to.plannedStartDate}${follower.to.dueDate ? `, klart senast ${follower.to.dueDate}` : ""} (flyttades efter ${current.title})`.slice(0, 500), taskId: follower.id, actorName, createdBy: ctx.user.id } });
      }
      for (const move of moves) {
        const moved = await tx.plannedActivity.updateMany({ where: { id: move.id, organizationId: ctx.organizationId, version: move.version, deletedAt: null }, data: { startsAt: move.to.startsAt, endsAt: move.to.endsAt, version: { increment: 1 }, updatedBy: ctx.user.id } });
        if (!moved.count) throw new ApiError(409, `Bokningen ${move.title} har ändrats. Läs in tidplanen igen.`);
        for (const assignment of move.assignments) if (assignment.startsAt && assignment.endsAt)
          await tx.plannedActivityAssignment.updateMany({ where: { id: assignment.id, organizationId: ctx.organizationId, plannedActivityId: move.id }, data: { startsAt: assignment.startsAt, endsAt: assignment.endsAt } });
        await tx.plannedActivityEvent.create({ data: {
          organizationId: ctx.organizationId, plannedActivityId: move.id, kind: "UPDATED", actorName, createdBy: ctx.user.id,
          summary: `Bokningen ${move.title} flyttades ${Math.abs(shift)} arbetsdagar ${shift > 0 ? "framåt" : "bakåt"} med jobbet ${current.title}${bookingException ? ` (undantag från projektets tidsram: ${bookingException})` : ""}`.slice(0, 500),
          snapshot: json({ title: move.title, startsAt: move.to.startsAt.toISOString(), endsAt: move.to.endsAt.toISOString(), previousStartsAt: move.from.startsAt.toISOString(), previousEndsAt: move.from.endsAt.toISOString(), version: move.version + 1, movedWithTaskId: current.id }),
        } });
      }
      if (project) {
        if (periodChanged || next.estimatedMinutes !== current.estimatedMinutes)
          await tx.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: project.id, kind: "TASK_SCHEDULED", summary: `${scheduleChangeSummary(current.title, next)}${moves.length ? `; ${moves.length === 1 ? "1 bokning flyttades med" : `${moves.length} bokningar flyttades med`}` : ""}`.slice(0, 500), taskId: current.id, actorName, createdBy: ctx.user.id } });
        if (predecessorsChanged)
          await tx.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: project.id, kind: "TASK_SCHEDULED", summary: (predecessorTitles.length ? `${current.title} börjar efter ${predecessorTitles.join(", ")}` : `${current.title} börjar inte längre efter något annat jobb`).slice(0, 500), taskId: current.id, actorName, createdBy: ctx.user.id } });
        if (frameException || bookingException || followerException) await tx.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: project.id, kind: "SCHEDULE_EXCEPTION", summary: `Tidplanen för ${current.title} fick undantag från projektets tidsram: ${frameException || bookingException || followerException}`.slice(0, 500), taskId: current.id, actorName, createdBy: ctx.user.id } });
      }
    });
    publishTaskChange(current.id, { version: nextVersion, byUserId: ctx.user.id, byName: actorName, status: current.status, reason: "save" });
    for (const follower of followerMoves) publishTaskChange(follower.id, { version: follower.version + 1, byUserId: ctx.user.id, byName: actorName, reason: "save" });
    return NextResponse.json({ id: current.id, version: nextVersion, movedBookings: moves.length, movedFollowers: followerMoves.length });
  } catch (error) {
    return failure(error);
  }
}
