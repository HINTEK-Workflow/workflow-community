import { assertFacilityLink } from "@/lib/kfid/facility-server";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireControlDelete, requireWorkflowPermission } from "@/lib/kfid/server";
import { bindFormTask, formFamily } from "@/lib/kfid/form-server";
import { formDocumentSchema } from "@/lib/workflow/form-document";
import { FORM_TREND_LIMIT, formTrendSeries } from "@/lib/workflow/form-trend";
import { hasWorkflowPermission, readableTaskScope, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { workflowTaskCompletion, workflowTaskDataSchema, workflowTaskHasDocumentation, workflowTaskInputSchema, workflowTaskProgress, workflowTaskStatuses, resetWorkflowTaskApproval, stampWorkflowTaskApproval, type WorkflowTaskStatus } from "@/lib/workflow/task-model";
import { remove } from "@/lib/kfid/storage";
import type { StoppedTimer } from "@/lib/workflow/running-timer";
import { closeTimeEntries, pauseOtherOwnTimers } from "@/lib/workflow/timer-server";
import { taskDueDateError } from "@/lib/workflow/project-frame";
import { FORM_HISTORY_LIMIT, formHistoryItem } from "@/lib/workflow/form-history";

const identifier = z.string().min(1).max(100);
const json = (value: unknown) => value as Prisma.InputJsonValue;
export const dynamic = "force-dynamic";

async function verifyReferences(organizationId: string, input: z.infer<typeof workflowTaskInputSchema>) {
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true, archivedAt: true, closedAt: true, customerId: true, startDate: true, dueDate: true } });
    if (!project) throw new ApiError(400, "Projektet hittades inte.");
    if (project.archivedAt) throw new ApiError(409, "Återställ projektet innan du sparar en uppgift i det.");
    if (project.closedAt) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet innan du lägger till eller ändrar uppgifter i det.");
    // The project is the frame (2026-09-26): its customer applies to its tasks, and a new or changed
    // "Klart senast" must lie within its start and end. An unchanged older date outside the frame stays a warning.
    if (project.customerId && input.customerId !== project.customerId) throw new ApiError(400, "En uppgift i projektet har projektets kund.");
    const previous = input.id ? await prisma.workflowTask.findFirst({ where: { id: input.id, organizationId }, select: { dueDate: true, projectId: true } }) : null;
    const dueChanged = !previous || previous.dueDate !== input.dueDate || previous.projectId !== input.projectId;
    const dueError = dueChanged ? taskDueDateError(input.dueDate, project) : null;
    if (dueError) throw new ApiError(400, dueError);
  }
  if (input.customerId && !(await prisma.customer.findFirst({ where: { id: input.customerId, organizationId, deletedAt: null }, select: { id: true } })))
    throw new ApiError(400, "Kunden hittades inte.");
  const previousFacility = input.id && input.facilityId ? await prisma.workflowTask.findFirst({ where: { id: input.id, organizationId }, select: { facilityId: true } }) : null;
  await assertFacilityLink(organizationId, { facilityId: input.facilityId, customerId: input.customerId, previousFacilityId: previousFacility?.facilityId });
  if (input.siteId && !(await prisma.site.findFirst({ where: { id: input.siteId, organizationId, isActive: true }, select: { id: true } })))
    throw new ApiError(400, "Platsen hittades inte eller är pausad.");
  if (input.departmentId && !(await prisma.department.findFirst({ where: { id: input.departmentId, siteId: input.siteId!, organizationId, isActive: true }, select: { id: true } })))
    throw new ApiError(400, "Avdelningen hittades inte eller är pausad.");
  if (input.assignedToUserId && !(await prisma.organizationMember.findFirst({ where: { organizationId, userId: input.assignedToUserId, isActive: true }, select: { id: true } })))
    throw new ApiError(400, "Ansvarig användare tillhör inte arbetsytan.");
}

// History is paged (2026-09-26): the list carries the newest revisions and a count; older ones load on request.
const REVISION_PAGE_SIZE = 10;
type RevisionRow = { id: string; version: number; snapshot: Prisma.JsonValue; createdAt: Date };
function revisionView(task: { kind: string; title: string; description: string; status: string; data: Prisma.JsonValue }, revisions: RevisionRow[]) {
  const data = workflowTaskDataSchema.parse(task.data);
  return revisions.flatMap((revision) => {
    const snapshot = revision.snapshot && typeof revision.snapshot === "object" && !Array.isArray(revision.snapshot)
      ? revision.snapshot as Record<string, unknown>
      : {};
    const parsedData = workflowTaskDataSchema.safeParse(snapshot.data);
    if (!parsedData.success || parsedData.data.kind !== task.kind) return [];
    const status = workflowTaskStatuses.includes(snapshot.status as WorkflowTaskStatus)
      ? snapshot.status as WorkflowTaskStatus
      : task.status as WorkflowTaskStatus;
    return [{ id: revision.id, version: revision.version, createdAt: revision.createdAt, snapshot: {
      title: typeof snapshot.title === "string" ? snapshot.title : task.title,
      description: typeof snapshot.description === "string" ? snapshot.description : task.description,
      status,
      progress: typeof snapshot.progress === "number" ? Math.max(0, Math.min(100, Math.round(snapshot.progress))) : workflowTaskProgress({ ...task, data } as Parameters<typeof workflowTaskProgress>[0]),
      data: parsedData.data,
      completedAt: typeof snapshot.completedAt === "string" ? snapshot.completedAt : null,
    } }];
  });
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const url = new URL(request.url);
    const revisionTaskId = url.searchParams.get("revisionsFor");
    if (revisionTaskId) {
      const before = Number(url.searchParams.get("before"));
      const task = await prisma.workflowTask.findFirst({ where: { id: identifier.parse(revisionTaskId), organizationId: ctx.organizationId }, select: { kind: true, formArea: true, title: true, description: true, status: true, data: true } });
      if (!task || !(ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, workflowSubjectForTask(task.kind, task.formArea), "read"))) throw new ApiError(404, "Uppgiften hittades inte.");
      const page = await prisma.workflowTaskRevision.findMany({
        where: { taskId: revisionTaskId, ...(Number.isInteger(before) && before > 0 ? { version: { lt: before } } : {}) },
        orderBy: { version: "desc" },
        take: 20,
        select: { id: true, version: true, snapshot: true, createdAt: true },
      });
      return NextResponse.json({ revisions: revisionView(task, page) });
    }
    // Earlier protocols of the same form for the same facility or customer (follow-up, 2026-09-26).
    const historyTemplate = url.searchParams.get("formHistory");
    if (historyTemplate) {
      const canRead = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
      if (!readableTaskScope(canRead).areas.length) return NextResponse.json({ items: [] });
      const facilityId = url.searchParams.get("facilityId");
      const customerId = url.searchParams.get("customerId");
      if (!facilityId && !customerId) return NextResponse.json({ items: [] });
      const exclude = url.searchParams.get("exclude");
      const rows = await prisma.workflowTask.findMany({
        where: {
          organizationId: ctx.organizationId, kind: "FORM", AND: [readableTaskWhere(canRead)], data: { path: ["details", "templateId"], equals: identifier.parse(historyTemplate) },
          ...(facilityId ? { facilityId: identifier.parse(facilityId) } : { customerId: identifier.parse(customerId) }),
          ...(exclude ? { id: { not: identifier.parse(exclude) } } : {}),
        },
        orderBy: { updatedAt: "desc" }, take: FORM_HISTORY_LIMIT,
        select: { id: true, title: true, status: true, completedAt: true, updatedAt: true, data: true },
      });
      return NextResponse.json({ items: rows.map(formHistoryItem) });
    }
    // Trends (2026-09-28): the numbers marked `trend` over earlier protocols of the same form family at the same
    // facility (or customer), read with each protocol's own copy of the form; the series follow the given version.
    const trendTemplate = url.searchParams.get("formTrend");
    if (trendTemplate) {
      const canRead = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
      const facilityId = url.searchParams.get("facilityId");
      const customerId = url.searchParams.get("customerId");
      const version = Number(url.searchParams.get("version"));
      if (!readableTaskScope(canRead).areas.length || (!facilityId && !customerId)) return NextResponse.json({ series: [] });
      const { ids } = await formFamily(ctx.organizationId, identifier.parse(trendTemplate));
      const stored = Number.isInteger(version) ? await prisma.formTemplateVersion.findUnique({ where: { templateId_version: { templateId: identifier.parse(trendTemplate), version } }, select: { document: true } }) : null;
      const exclude = url.searchParams.get("exclude");
      const rows = await prisma.workflowTask.findMany({
        where: {
          organizationId: ctx.organizationId, kind: "FORM", AND: [readableTaskWhere(canRead), { OR: ids.map((id) => ({ data: { path: ["details", "templateId"], equals: id } })) }],
          ...(facilityId ? { facilityId: identifier.parse(facilityId) } : { customerId: identifier.parse(customerId) }),
          ...(exclude ? { id: { not: identifier.parse(exclude) } } : {}),
        },
        orderBy: { updatedAt: "desc" }, take: FORM_TREND_LIMIT,
        select: { id: true, status: true, completedAt: true, updatedAt: true, data: true },
      });
      const fallback = rows[0] ? formDocumentSchema.safeParse((rows[0].data as { details?: { document?: unknown } }).details?.document) : null;
      const document = stored ? formDocumentSchema.parse(stored.document) : fallback?.success ? fallback.data : null;
      return NextResponse.json({ series: document ? formTrendSeries(document, null, rows) : [] });
    }
    // The guided flow (2026-09-30): the state of linked tasks – a deviation row's work order, the protocol a work order
    // came from – and the next open task of a project, as title and status only, within what the person may read.
    const links = url.searchParams.get("links");
    const projectNext = url.searchParams.get("projectNext");
    if (links || projectNext) {
      const canRead = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
      const select = { id: true, title: true, status: true, kind: true, dueDate: true, assignedToUserId: true } as const;
      const view = (row: { id: string; title: string; status: string; kind: string; dueDate: string; assignedToUserId?: string | null }) => ({ id: row.id, title: row.title, status: row.status, kind: row.kind, dueDate: row.dueDate });
      if (links) {
        const ids = [...new Set(links.split(",").filter(Boolean))].slice(0, 50).map((value) => identifier.parse(value));
        const rows = await prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids }, AND: [readableTaskWhere(canRead)] }, select });
        return NextResponse.json({ links: rows.map(view) });
      }
      const exclude = url.searchParams.get("exclude");
      const rows = await prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId, projectId: identifier.parse(projectNext), status: { not: "COMPLETED" }, AND: [readableTaskWhere(canRead)], ...(exclude ? { id: { not: identifier.parse(exclude) } } : {}) },
        orderBy: [{ updatedAt: "desc" }], take: 50, select,
      });
      // The one due first; tasks without a date come after the dated ones.
      // Only the person's own or unassigned tasks are suggested (simulation 2026-10-02: a colleague's paused order was).
      const next = rows.filter((row) => !row.assignedToUserId || row.assignedToUserId === ctx.user.id).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))[0];
      return NextResponse.json({ next: next ? view(next) : null, open: rows.length });
    }
    // Bounded reads (2026-09-26): the editor asks for one task (`id`) or only the members (`members=only`)
    // instead of every task in the organization with its history.
    const onlyId = url.searchParams.get("id");
    const membersOnly = url.searchParams.get("members") === "only";
    const [tasks, members] = await Promise.all([
      membersOnly ? Promise.resolve([]) : prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId, ...(onlyId ? { id: identifier.parse(onlyId) } : {}) },
        orderBy: { updatedAt: "desc" },
        include: {
          project: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true, company: true } },
          site: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          timeEntries: { orderBy: { startedAt: "desc" } },
          attachments: { orderBy: { createdAt: "desc" }, select: { id: true, filename: true, mimeType: true, size: true, createdAt: true } },
          revisions: { orderBy: { version: "desc" }, take: REVISION_PAGE_SIZE, select: { id: true, version: true, snapshot: true, createdAt: true } },
          _count: { select: { revisions: true } },
        },
      }),
      prisma.organizationMember.findMany({
        where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } },
        orderBy: { user: { name: "asc" } },
        select: { userId: true, user: { select: { name: true, email: true } } },
      }),
    ]);
    return NextResponse.json({
      tasks: tasks.filter((task) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, workflowSubjectForTask(task.kind, task.formArea), "read")).map((task) => {
        const data = workflowTaskDataSchema.parse(task.data);
        return ({
        ...task,
        data,
        revisions: revisionView(task, task.revisions),
        revisionCount: task._count.revisions,
        _count: undefined,
        progress: workflowTaskProgress({ ...task, data }),
        totalDurationSec: task.timeEntries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000)) : 0), 0),
        // The editor's Starta/Pausa button reflects the caller's own timer; colleagues keep their own.
        timerRunning: task.timeEntries.some((entry) => !entry.endedAt && entry.userId === ctx.user.id),
      });}),
      members: members.map((member) => ({ id: member.userId, name: member.user.name || member.user.email })),
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
    // Stopping the timer (pause or completion) finishes an entry; it enters the append-only time history then.
    const closeRunningTimeEntries = (tx: Prisma.TransactionClient, running: { id: string; userId: string; startedAt: Date; note: string }[], owner: { id: string; title: string }, now: Date) =>
      closeTimeEntries(tx, ctx, running, owner, now);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("save"), task: workflowTaskInputSchema }),
      z.object({ action: z.literal("timer"), id: identifier, command: z.enum(["START", "PAUSE"]) }),
      z.object({ action: z.literal("reopen"), id: identifier }),
    ]).parse(await body(request));

    if (input.action === "reopen") {
      const task = await prisma.workflowTask.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
      if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
      const subject = workflowSubjectForTask(task.kind, task.formArea);
      // A completed control stays as it was signed; it is continued with Spara som (MEMORY: controls are immutable).
      if (subject === "kfid") throw new ApiError(409, "En slutförd kontroll återöppnas inte. Använd Spara som för att fortsätta i en ny kontroll.");
      requireWorkflowPermission(ctx, subject, "reopen");
      if (task.status !== "COMPLETED") return NextResponse.json({ ok: true });
      if (task.projectId) {
        const project = await prisma.project.findFirst({ where: { id: task.projectId, organizationId: ctx.organizationId }, select: { archivedAt: true, closedAt: true } });
        if (project?.archivedAt) throw new ApiError(409, "Återställ projektet innan du återöppnar uppgiften.");
        if (project?.closedAt) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet innan du återöppnar uppgiften.");
      }
      const nextVersion = task.version + 1;
      const data = resetWorkflowTaskApproval(workflowTaskDataSchema.parse(task.data));
      const reopenedInput = workflowTaskInputSchema.parse({ ...task, status: "NEEDS_ACTION", data });
      const progress = workflowTaskProgress(reopenedInput);
      const snapshot = json({ ...task, data, status: "NEEDS_ACTION", progress, completedAt: null, version: nextVersion });
      await prisma.$transaction([
        prisma.workflowTask.update({ where: { id: task.id, version: task.version, status: "COMPLETED" }, data: { data: json(data), status: "NEEDS_ACTION", progress, completedAt: null, version: { increment: 1 }, updatedBy: ctx.user.id } }),
        prisma.workflowTaskRevision.create({ data: { taskId: task.id, version: nextVersion, snapshot, createdBy: ctx.user.id } }),
        ...(task.projectId ? [prisma.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: task.projectId, kind: "TASK_REOPENED", summary: `Uppgiften ${task.title} återöppnades`, taskId: task.id, actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } })] : []),
      ]);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "timer") {
      const task = await prisma.workflowTask.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
      if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
      requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "edit");
      if (task.status === "COMPLETED") throw new ApiError(409, "En slutförd uppgift kan inte tidrapporteras.");
      const now = new Date();
      // The timer is per person (2026-09-26): start and pause only touch the caller's own entry, a colleague's
      // running entry keeps going, and starting a new timer pauses the caller's timer on any other task.
      const stopped = await prisma.$transaction(async (tx) => {
        const running = await tx.workflowTimeEntry.findMany({ where: { taskId: task.id, endedAt: null } });
        const mine = running.filter((entry) => entry.userId === ctx.user.id);
        const othersRunning = running.length - mine.length;
        const start = input.command === "START";
        // Serialize timer changes with completion using the task version/row lock.
        const changed = await tx.workflowTask.updateMany({
          where: { id: task.id, organizationId: ctx.organizationId, version: task.version, status: { not: "COMPLETED" } },
          data: { status: start || othersRunning ? "IN_PROGRESS" : "PAUSED", startedAt: start ? task.startedAt ?? now : task.startedAt, progress: workflowTaskProgress({ ...task, data: workflowTaskDataSchema.parse(task.data) }), version: { increment: 1 }, updatedBy: ctx.user.id },
        });
        if (!changed.count) throw new ApiError(409, "Uppgiften har ändrats. Läs in den senaste versionen.");
        if (!start) return closeRunningTimeEntries(tx, mine, { id: task.id, title: task.title }, now);
        if (!mine.length) await tx.workflowTimeEntry.create({ data: { taskId: task.id, userId: ctx.user.id, startedAt: now } });
        // The caller's timer on any other task or control is paused.
        return pauseOtherOwnTimers(tx, ctx, { taskId: task.id }, now);
      });
      return NextResponse.json({ ok: true, stopped });
    }

    const task = input.task;
    // A protocol always uses its stored form version (never a document sent by the client), and follows its form's
    // permission area – Kontroll före idrifttagning and Riskbedömning as forms keep their own (2026-09-27).
    const form = await bindFormTask(ctx.organizationId, task);
    const subject = workflowSubjectForTask(task.kind, form.formArea);
    requireWorkflowPermission(ctx, subject, task.id ? "edit" : "create");
    await verifyReferences(ctx.organizationId, task);
    if (task.status === "COMPLETED") {
      requireWorkflowPermission(ctx, subject, "complete");
      const completion = workflowTaskCompletion(task);
      if (!completion.ready) throw new ApiError(422, completion.issues.map((issue) => issue.message).join(" "));
    }
    const now = new Date();
    task.data = stampWorkflowTaskApproval(task.data, now.toISOString());
    const status = task.status === "PLANNED" && workflowTaskHasDocumentation(task) ? "IN_PROGRESS" : task.status;
    const progress = workflowTaskProgress({ ...task, status });
    const snapshot = json({ ...task, status, progress });
    if (task.id) {
      const current = await prisma.workflowTask.findFirst({ where: { id: task.id, organizationId: ctx.organizationId } });
      if (!current) throw new ApiError(404, "Uppgiften hittades inte.");
      if (current.kind !== task.kind) throw new ApiError(409, "Uppgiftstypen kan inte ändras.");
      if (current.status === "COMPLETED") throw new ApiError(409, "Återöppna uppgiften innan du ändrar den.");
      // After creation a task changes project only through the project's Koppla/Flytta, which always writes history.
      if (current.projectId !== task.projectId) throw new ApiError(409, "Byt projekt via projektets Koppla befintlig uppgift, så att bytet hamnar i historiken.");
      const nextVersion = current.version + 1;
      const stopped = await prisma.$transaction(async (tx) => {
        let closed: StoppedTimer[] = [];
        const changed = await tx.workflowTask.updateMany({
          where: { id: task.id, organizationId: ctx.organizationId, version: task.version, status: { not: "COMPLETED" } },
          data: { projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId, siteId: task.siteId, departmentId: task.departmentId, title: task.title, description: task.description, status, progress, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, dueDate: task.dueDate, data: json(task.data), version: { increment: 1 }, completedAt: status === "COMPLETED" ? new Date() : null, updatedBy: ctx.user.id },
        });
        if (!changed.count) throw new ApiError(409, "Uppgiften har ändrats. Läs in den senaste versionen.");
        if (status === "COMPLETED") {
          const running = await tx.workflowTimeEntry.findMany({ where: { taskId: task.id, endedAt: null } });
          closed = await closeRunningTimeEntries(tx, running, { id: task.id!, title: task.title }, now);
        }
        await tx.workflowTaskRevision.create({ data: { taskId: task.id!, version: nextVersion, snapshot, createdBy: ctx.user.id } });
        return closed;
      });
      return NextResponse.json({ id: task.id, version: nextVersion, stopped });
    }
    const created = await prisma.workflowTask.create({
      data: { organizationId: ctx.organizationId, projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId, siteId: task.siteId, departmentId: task.departmentId, kind: task.kind, ...form, title: task.title, description: task.description, status, progress, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, dueDate: task.dueDate, data: json(task.data), startedAt: status === "IN_PROGRESS" ? new Date() : null, completedAt: status === "COMPLETED" ? new Date() : null, createdBy: ctx.user.id, updatedBy: ctx.user.id, revisions: { create: { version: 1, snapshot, createdBy: ctx.user.id } } },
      select: { id: true, version: true },
    });
    return NextResponse.json(created);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireControlDelete(ctx);
    const id = identifier.parse(new URL(request.url).searchParams.get("id"));
    const task = await prisma.workflowTask.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true, kind: true, formArea: true, attachments: { select: { storagePath: true } } } });
    if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "edit");
    await prisma.$transaction([
      prisma.plannedActivity.updateMany({
        where: { organizationId: ctx.organizationId, workflowTaskId: task.id },
        data: { workflowTaskId: null, version: { increment: 1 }, updatedBy: ctx.user.id },
      }),
      prisma.workflowTask.delete({ where: { id: task.id } }),
    ]);
    await Promise.all(task.attachments.map((attachment) => remove(attachment.storagePath)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
