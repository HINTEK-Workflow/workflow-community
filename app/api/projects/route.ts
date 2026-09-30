import { controlProgress } from "@/lib/workflow/project-progress";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiError,
  body,
  checkOrigin,
  context,
  failure,
  requireCloudStorage,
  requireCloudWriteAccess,
  requireControlDelete,
  requireWorkflowPermission,
} from "@/lib/kfid/server";
import { hasWorkflowPermission, readableTaskScope, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { workflowTaskDataSchema, workflowTaskProgress } from "@/lib/workflow/task-model";
import { normalizeControl, validateForCompletion } from "@/lib/kfid/model";
import { timeBudgetMinutesSchema } from "@/lib/workflow/planned-activity";
import { canManageProjectLifecycle, summarizeProjectStatus } from "@/lib/workflow/project-status";
import { projectDecisionInputSchema, projectFrameError, shiftDay, taskDueDateError } from "@/lib/workflow/project-frame";
import { addSwedishDays } from "@/lib/swedish-time";
import { assertFacilityLink, facilitySummarySelect } from "@/lib/kfid/facility-server";

const id = z.string().min(1).max(100);
const json = (value: unknown) => value as Prisma.InputJsonValue;
const projectInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(""),
  startDate: z.union([z.literal(""), z.iso.date()]).default(""),
  dueDate: z.union([z.literal(""), z.iso.date()]).default(""),
  client: z.string().trim().max(200).default(""),
  contactPerson: z.string().trim().max(200).default(""),
  reference: z.string().trim().max(120).default(""),
  workSite: z.string().trim().max(300).default(""),
  customerId: id.nullable().default(null),
  // Optional customer facility (decision 11); it must belong to the project's customer.
  facilityId: id.nullable().default(null),
  responsibleUserId: id.nullable().default(null),
  responsibleName: z.string().trim().max(160).default(""),
  timeBudgetMinutes: timeBudgetMinutesSchema.optional(),
  taskTypes: z.array(z.enum(["WORK_ORDER", "RISK_ASSESSMENT", "COMMISSIONING_CONTROL"])).max(3).default([]),
  workMoments: z.array(z.enum(["START_TIME", "EXECUTION", "SIGN_REPORT", "CLOSE_ORDER"])).max(4).default([]),
  /** Days to move open tasks and active planning when the frame moves; 0 saves without moving anything. */
  shiftDays: z.number().int().min(-3650).max(3650).default(0),
});

/** Moves the project's open tasks' "Klart senast" and the active planning the caller may edit by whole days. */
async function shiftProjectWork(ctx: Awaited<ReturnType<typeof context>>, projectId: string, days: number) {
  const may = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "edit");
  const [tasks, activities] = await Promise.all([
    prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, projectId, status: { not: "COMPLETED" }, dueDate: { not: "" } } }),
    prisma.plannedActivity.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, status: { in: ["PLANNED", "IN_PROGRESS"] }, OR: [{ projectId }, { workflowTask: { is: { projectId } } }, { control: { is: { projectId } } }] },
      include: { workflowTask: { select: { kind: true, formArea: true } }, assignments: true },
    }),
  ]);
  const movableTasks = tasks.filter((task) => may(workflowSubjectForTask(task.kind, task.formArea)));
  const canMove = (activity: (typeof activities)[number]) => may("projects") && (!activity.workflowTask || may(workflowSubjectForTask(activity.workflowTask.kind, activity.workflowTask.formArea))) && (!activity.controlId || may("kfid"));
  const movable = activities.filter(canMove);
  const actorName = ctx.user.name || ctx.user.email;
  const move = (value: Date) => addSwedishDays(value, days);
  await prisma.$transaction(async (tx) => {
    for (const task of movableTasks) {
      const dueDate = shiftDay(task.dueDate, days);
      const nextVersion = task.version + 1;
      await tx.workflowTask.update({ where: { id: task.id }, data: { dueDate, version: { increment: 1 }, updatedBy: ctx.user.id } });
      await tx.workflowTaskRevision.create({ data: { taskId: task.id, version: nextVersion, createdBy: ctx.user.id, snapshot: json({
        id: task.id, version: nextVersion, kind: task.kind, title: task.title, description: task.description, status: task.status, projectId: task.projectId, customerId: task.customerId,
        siteId: task.siteId, departmentId: task.departmentId, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, dueDate, data: task.data,
      }) } });
    }
    for (const activity of movable) {
      await tx.plannedActivity.update({ where: { id: activity.id }, data: { startsAt: move(activity.startsAt), endsAt: move(activity.endsAt), version: { increment: 1 }, updatedBy: ctx.user.id } });
      for (const assignment of activity.assignments.filter((item) => item.startsAt && item.endsAt))
        await tx.plannedActivityAssignment.update({ where: { id: assignment.id }, data: { startsAt: move(assignment.startsAt!), endsAt: move(assignment.endsAt!) } });
      await tx.plannedActivityEvent.create({ data: { organizationId: ctx.organizationId, plannedActivityId: activity.id, kind: "UPDATED", summary: `Planeringen ${activity.title} flyttades ${days} dagar med projektets tidsram`,
        snapshot: json({ title: activity.title, startsAt: move(activity.startsAt).toISOString(), endsAt: move(activity.endsAt).toISOString(), projectId: activity.projectId, version: activity.version + 1 }), actorName, createdBy: ctx.user.id } });
    }
  });
  return { tasks: movableTasks.length, activities: movable.length, skipped: activities.length - movable.length };
}

/** Project cards per page in "Mina projekt". */
const PROJECT_PAGE_SIZE = 12;
/** At most this many link candidates, most recently changed first. */
const LINK_CANDIDATE_LIMIT = 200;

/**
 * Tasks that may be linked to or moved into a project (decision 7): standalone tasks and controls, and those in other
 * projects that still accept work. Only fields the link guide shows are sent; editing rights are checked on link.
 */
async function linkCandidates(ctx: Awaited<ReturnType<typeof context>>, projectId: string, can: (subject: WorkflowPermissionSubject, action: "read") => boolean) {
  if (!can("projects", "read")) throw new ApiError(403, "Du saknar behörighet att läsa projekt.");
  // Protocols follow their form's permission area (Daniel 2026-09-27).
  const readable = readableTaskScope((subject) => can(subject, "read")).any ? readableTaskWhere((subject) => can(subject, "read")) : null;
  const elsewhere = { OR: [{ projectId: null }, { projectId: { not: projectId }, workflowProject: { is: { archivedAt: null, closedAt: null } } }] };
  const [tasks, controls] = await Promise.all([
    readable ? prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId, AND: [readable], OR: [{ projectId: null }, { projectId: { not: projectId }, project: { is: { archivedAt: null, closedAt: null } } }] },
      orderBy: { updatedAt: "desc" }, take: LINK_CANDIDATE_LIMIT,
      select: { id: true, title: true, kind: true, status: true, updatedAt: true, projectId: true, customerId: true, assignedToUserId: true, assignedToName: true, dueDate: true, progress: true, project: { select: { name: true } } },
    }) : [],
    can("kfid", "read") ? prisma.control.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, ...elsewhere },
      orderBy: { updatedAt: "desc" }, take: LINK_CANDIDATE_LIMIT,
      select: { id: true, number: true, title: true, status: true, updatedAt: true, projectId: true, customerId: true, lastOpenedAt: true, workflowProject: { select: { name: true } } },
    }) : [],
  ]);
  const time = await prisma.workflowTimeEntry.groupBy({ by: ["taskId"], where: { endedAt: { not: null }, taskId: { in: tasks.map((task) => task.id) } }, _sum: { durationSec: true } });
  const seconds = new Map(time.map((row) => [row.taskId, row._sum.durationSec ?? 0]));
  return {
    tasks: [
      ...tasks.map(({ project, ...task }) => ({ ...task, fromProject: project?.name, totalDurationSec: seconds.get(task.id) ?? 0 })),
      ...controls.map(({ workflowProject, ...control }) => ({ ...control, fromProject: workflowProject?.name })),
    ],
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const can = (subject: WorkflowPermissionSubject, action: "read") => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, action);
    // Older project history, one bounded page at a time (Daniel 2026-09-26).
    // Older decisions, one bounded page at a time (the log is append-only).
    const decisionsFor = new URL(request.url).searchParams.get("decisionsFor");
    if (decisionsFor) {
      if (!can("projects", "read")) throw new ApiError(403, "Du saknar behörighet att läsa projekt.");
      const before = new Date(new URL(request.url).searchParams.get("before") ?? "");
      const decisions = await prisma.projectDecision.findMany({
        where: { projectId: z.string().min(1).max(100).parse(decisionsFor), organizationId: ctx.organizationId, ...(Number.isNaN(before.getTime()) ? {} : { createdAt: { lt: before } }) },
        orderBy: { createdAt: "desc" }, take: 20,
        select: { id: true, decidedOn: true, text: true, decidedBy: true, actorName: true, createdAt: true },
      });
      return NextResponse.json({ decisions });
    }
    const eventsFor = new URL(request.url).searchParams.get("eventsFor");
    if (eventsFor) {
      if (!can("projects", "read")) throw new ApiError(403, "Du saknar behörighet att läsa projekt.");
      const before = new Date(new URL(request.url).searchParams.get("before") ?? "");
      const project = await prisma.project.findFirst({ where: { id: z.string().min(1).max(100).parse(eventsFor), organizationId: ctx.organizationId }, select: { id: true } });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      const events = await prisma.projectEvent.findMany({
        where: { projectId: project.id, organizationId: ctx.organizationId, ...(Number.isNaN(before.getTime()) ? {} : { createdAt: { lt: before } }) },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, kind: true, summary: true, taskId: true, actorName: true, createdAt: true },
      });
      return NextResponse.json({ events });
    }
    const params = new URL(request.url).searchParams;
    // Link candidates for "Koppla befintlig uppgift" (decision 7), read only when the dialog opens.
    const candidatesFor = params.get("candidatesFor");
    if (candidatesFor) return NextResponse.json(await linkCandidates(ctx, id.parse(candidatesFor), can));
    // Bounded reads (Daniel 2026-09-26: fetch only what is shown): "Mina projekt" pages one tab of project cards,
    // the project view reads one project, and only planning still reads every project with its tasks.
    const listTab = z.enum(["ongoing", "closed", "archived"]).optional().parse(params.get("list") ?? undefined);
    const onlyId = params.get("id") ? id.parse(params.get("id")) : null;
    const full = !listTab && !onlyId;
    // Planning reads every project for its pickers and totals, but never their history or decisions.
    const lean = params.get("scope") === "planning";
    const page = Math.max(1, Number(params.get("page")) || 1);
    const query = (params.get("q") ?? "").trim().slice(0, 100);
    const tabWhere = { ongoing: { archivedAt: null, closedAt: null }, closed: { archivedAt: null, closedAt: { not: null } }, archived: { archivedAt: { not: null } } } satisfies Record<string, Prisma.ProjectWhereInput>;
    const searchWhere: Prisma.ProjectWhereInput = query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }, { customer: { is: { name: { contains: query, mode: "insensitive" } } } }] } : {};
    const projectWhere: Prisma.ProjectWhereInput = { organizationId: ctx.organizationId, ...(onlyId ? { id: onlyId } : {}), ...(listTab ? { ...tabWhere[listTab], ...searchWhere } : {}) };
    const [tabCounts, listTotal] = listTab && can("projects", "read") ? await Promise.all([
      Promise.all((["ongoing", "closed", "archived"] as const).map(async (tab) => [tab, await prisma.project.count({ where: { organizationId: ctx.organizationId, ...tabWhere[tab], ...searchWhere } })] as const)).then(Object.fromEntries),
      prisma.project.count({ where: projectWhere }),
    ]) : [null, 0];
    const [projects, members] = await Promise.all([!can("projects", "read") ? Promise.resolve([]) : prisma.project.findMany({
      where: projectWhere,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      ...(listTab ? { skip: (page - 1) * PROJECT_PAGE_SIZE, take: PROJECT_PAGE_SIZE } : {}),
      select: {
        id: true,
        name: true,
        description: true,
        startDate: true,
        dueDate: true,
        client: true,
        contactPerson: true,
        reference: true,
        workSite: true,
        facilityId: true,
        facility: { select: facilitySummarySelect },
        taskTypes: true,
        workMoments: true,
        customerId: true,
        responsibleUserId: true,
        responsibleName: true,
        timeBudgetMinutes: true,
        archivedAt: true,
        closedAt: true,
        updatedAt: true,
        // Status counts all planning, whatever the viewer may read, so the project has one status for everyone.
        plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true } },
        // The project cards show neither history nor decisions, so the list reads none.
        events: { orderBy: { createdAt: "desc" }, take: listTab || lean ? 0 : 10, select: { id: true, kind: true, summary: true, taskId: true, actorName: true, createdAt: true } },
        decisions: { orderBy: { createdAt: "desc" }, take: listTab || lean ? 0 : 10, select: { id: true, decidedOn: true, text: true, decidedBy: true, actorName: true, createdAt: true } },
        _count: { select: { events: true, decisions: true } },
        customer: { select: { id: true, name: true, company: true } },
        controls: {
          where: { deletedAt: null },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            updatedAt: true,
            createdBy: true,
            performer: true,
            customerId: true,
            data: true,
            _count: { select: { attachments: true } },
          },
        },
        workflowTasks: {
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            title: true,
            kind: true,
            formArea: true,
            status: true,
            progress: true,
            dueDate: true,
            customerId: true,
            data: true,
            updatedAt: true,
            projectId: true,
            assignedToUserId: true,
            assignedToName: true,
            createdBy: true,
          },
        },
      },
    }), prisma.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } },
      orderBy: { user: { name: "asc" } },
      select: { userId: true, user: { select: { name: true, email: true } } },
    })]);
    const standaloneWorkflowTasks = full ? await prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId, projectId: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, kind: true, formArea: true, status: true, progress: true, dueDate: true, customerId: true, data: true, updatedAt: true, projectId: true, assignedToUserId: true, assignedToName: true, createdBy: true },
    }) : [];
    // Planning also lists standalone controls; they are no longer part of /api/workspace's overview.
    const standaloneControls = full && can("kfid", "read") ? await prisma.control.findMany({
      where: { organizationId: ctx.organizationId, projectId: null, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, number: true, title: true, status: true, updatedAt: true, projectId: true, customerId: true, lastOpenedAt: true, createdBy: true, performer: true, data: true, _count: { select: { attachments: true } } },
    }) : [];
    // Reported time per task is summed in the database instead of sending every time entry (Daniel 2026-09-26);
    // bounded reads only sum the time of the projects they return.
    const projectIds = projects.map((project) => project.id);
    const scoped = !full;
    const [finishedTime, controlTime, runningTime] = await Promise.all([
      prisma.workflowTimeEntry.groupBy({ by: ["taskId"], where: { endedAt: { not: null }, task: { organizationId: ctx.organizationId, ...(scoped ? { projectId: { in: projectIds } } : {}) } }, _sum: { durationSec: true } }),
      // Manual time on controls (decision 13); controls never run a timer.
      prisma.workflowTimeEntry.groupBy({ by: ["controlId"], where: { endedAt: { not: null }, control: { organizationId: ctx.organizationId, ...(scoped ? { projectId: { in: projectIds } } : {}) } }, _sum: { durationSec: true } }),
      prisma.workflowTimeEntry.findMany({ where: { endedAt: null, task: { organizationId: ctx.organizationId, ...(scoped ? { projectId: { in: projectIds } } : {}) } }, select: { taskId: true, startedAt: true } }),
    ]);
    // Reported time outside a project's frame (decision 6): allowed, but shown on the project. Swedish calendar days.
    const outsideFrame = projectIds.length ? await prisma.$queryRaw<{ projectId: string; seconds: bigint | number | null }[]>(Prisma.sql`
      select p.id as "projectId", sum(e."durationSec") as seconds
      from "WorkflowTimeEntry" e left join "WorkflowTask" t on t.id = e."taskId" left join "Control" c on c.id = e."controlId" and c."deletedAt" is null
        join "Project" p on p.id = coalesce(t."projectId", c."projectId")
      where p."organizationId" = ${ctx.organizationId} and p."startDate" <> '' and p."dueDate" <> '' and e."endedAt" is not null
        ${scoped ? Prisma.sql`and p.id in (${Prisma.join(projectIds)})` : Prisma.empty}
        and ((e."startedAt" at time zone 'Europe/Stockholm')::date < p."startDate"::date or (e."startedAt" at time zone 'Europe/Stockholm')::date > p."dueDate"::date)
      group by p.id`) : [];
    const outsideMinutes = new Map(outsideFrame.map((row) => [row.projectId, Math.round(Number(row.seconds ?? 0) / 60)]));
    const secondsByTask = new Map([...finishedTime.map((row) => [row.taskId, row._sum.durationSec ?? 0] as const), ...controlTime.map((row) => [row.controlId, row._sum.durationSec ?? 0] as const)]);
    for (const entry of runningTime) secondsByTask.set(entry.taskId, (secondsByTask.get(entry.taskId) ?? 0) + Math.max(0, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000)));
    const listMeta = listTab ? { total: listTotal, page, pages: Math.max(1, Math.ceil(listTotal / PROJECT_PAGE_SIZE)), counts: tabCounts ?? { ongoing: 0, closed: 0, archived: 0 } } : {};
    return NextResponse.json({
      ...listMeta,
      projects: projects.map(({ _count, plannedActivities, ...project }) => ({
        ...project,
        status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: [...project.controls, ...project.workflowTasks], activities: plannedActivities }),
        eventCount: _count.events,
        decisionCount: _count.decisions,
        outsideFrameMinutes: outsideMinutes.get(project.id) ?? 0,
        controls: (can("kfid", "read") ? project.controls : []).map(({ data, _count, createdBy, performer, ...control }) => {
          const completion = validateForCompletion(normalizeControl(data), {
            attachmentCount: _count.attachments,
          });
          return {
            ...control,
            completion: controlProgress(control.status, completion.progress.percent),
            totalDurationSec: secondsByTask.get(control.id) ?? 0,
            isMine: createdBy === ctx.user.id || performer === ctx.user.name || performer === ctx.user.email,
          };
        }),
        workflowTasks: project.workflowTasks.filter((task) => can(workflowSubjectForTask(task.kind, task.formArea), "read")).map(({ assignedToUserId, createdBy, data, ...task }) => ({
          ...task,
          assignedToUserId,
          progress: workflowTaskProgress({ ...task, data: workflowTaskDataSchema.parse(data) }),
          totalDurationSec: secondsByTask.get(task.id) ?? 0,
          isMine: assignedToUserId === ctx.user.id || (!assignedToUserId && createdBy === ctx.user.id),
        })),
      })),
      workflowTasks: standaloneWorkflowTasks.filter((task) => can(workflowSubjectForTask(task.kind, task.formArea), "read")).map(({ assignedToUserId, createdBy, data, ...task }) => ({
        ...task,
        assignedToUserId,
        progress: workflowTaskProgress({ ...task, data: workflowTaskDataSchema.parse(data) }),
        totalDurationSec: secondsByTask.get(task.id) ?? 0,
        isMine: assignedToUserId === ctx.user.id || (!assignedToUserId && createdBy === ctx.user.id),
      })),
      controls: standaloneControls.map(({ data, _count, createdBy, performer, ...control }) => ({
        ...control,
        completion: controlProgress(control.status, validateForCompletion(normalizeControl(data), { attachmentCount: _count.attachments }).progress.percent),
        totalDurationSec: secondsByTask.get(control.id) ?? 0,
        isMine: createdBy === ctx.user.id || performer === ctx.user.name || performer === ctx.user.email,
      })),
      members: members.map((member) => ({ id: member.userId, name: member.user.name || member.user.email })),
      // Lets the project view show "Avsluta projekt" to the responsible member; the server still decides.
      currentUserId: ctx.user.id,
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
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("save"), project: projectInput }),
      z.object({ action: z.literal("link"), projectId: id, taskId: id, taskKind: z.enum(["COMMISSIONING_CONTROL", "WORK_ORDER", "RISK_ASSESSMENT", "FORM"]),
        apply: z.object({ customer: z.boolean().default(true), responsible: z.boolean().default(false), dueDate: z.union([z.literal(""), z.iso.date()]).default("") }).default({ customer: true, responsible: false, dueDate: "" }) }),
      z.object({ action: z.literal("delete"), id }),
      z.object({ action: z.literal("archive"), id }),
      z.object({ action: z.literal("restore"), id }),
      z.object({ action: z.literal("decision"), projectId: id, decision: projectDecisionInputSchema }),
      z.object({ action: z.literal("close"), id }),
      z.object({ action: z.literal("reopen_project"), id }),
    ]).parse(await body(request));
    if (input.action === "decision") {
      requireWorkflowPermission(ctx, "projects", "edit");
      const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: ctx.organizationId }, select: { id: true, archivedAt: true } });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      if (project.archivedAt) throw new ApiError(409, "Återställ projektet innan du lägger till ett beslut.");
      const decision = await prisma.projectDecision.create({
        data: { organizationId: ctx.organizationId, projectId: project.id, ...input.decision, createdBy: ctx.user.id, actorName: ctx.user.name || ctx.user.email },
        select: { id: true },
      });
      return NextResponse.json(decision);
    }
    if (input.action === "close" || input.action === "reopen_project") {
      requireWorkflowPermission(ctx, "projects", "read");
      const close = input.action === "close";
      const project = await prisma.project.findFirst({
        where: { id: input.id, organizationId: ctx.organizationId },
        select: {
          id: true, archivedAt: true, closedAt: true, startDate: true, dueDate: true, responsibleUserId: true,
          workflowTasks: { select: { status: true } },
          controls: { where: { deletedAt: null }, select: { status: true } },
          plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true } },
        },
      });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      if (!canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project.responsibleUserId, canEditProjects: hasWorkflowPermission(ctx.workflowPermissions, "projects", "edit") }))
        throw new ApiError(403, "Bara projektansvarig eller en företagsadministratör kan avsluta eller återöppna projektet.");
      if (project.archivedAt) throw new ApiError(409, "Återställ projektet från arkivet först.");
      if (close && !project.closedAt) {
        const status = summarizeProjectStatus({ ...project, tasks: [...project.workflowTasks, ...project.controls], activities: project.plannedActivities });
        if (status.state !== "READY_TO_CLOSE") throw new ApiError(409, "Projektet kan avslutas först när alla uppgifter är slutförda och ingen planering är aktiv.");
      }
      if (Boolean(project.closedAt) !== close) await prisma.$transaction([
        prisma.project.update({ where: { id: project.id }, data: { closedAt: close ? new Date() : null, closedBy: close ? ctx.user.id : null, updatedBy: ctx.user.id } }),
        prisma.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: project.id, kind: close ? "CLOSED" : "REOPENED", summary: close ? "Projektet avslutades" : "Projektet återöppnades", actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } }),
      ]);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "link") {
      requireWorkflowPermission(ctx, "projects", "edit");
      // A protocol is checked against its form's area once it is loaded (Daniel 2026-09-27).
      if (input.taskKind !== "FORM") requireWorkflowPermission(ctx, workflowSubjectForTask(input.taskKind), "edit");
      const project = await prisma.project.findFirst({
        where: { id: input.projectId, organizationId: ctx.organizationId },
        select: { id: true, name: true, archivedAt: true, closedAt: true, customerId: true, facilityId: true, responsibleUserId: true, responsibleName: true, startDate: true, dueDate: true },
      });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      if (project.archivedAt) throw new ApiError(409, "Återställ projektet innan du kopplar en uppgift.");
      if (project.closedAt) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet innan du kopplar en uppgift.");
      // The link guide (Daniel 2026-09-26, decision 7): the user chose per field whether the project's value applies.
      // A completed task keeps its content; it is only moved. The task's planning follows it into the project.
      const apply = input.apply;
      if (apply.dueDate && taskDueDateError(apply.dueDate, project)) throw new ApiError(400, taskDueDateError(apply.dueDate, project)!);
      const actorName = ctx.user.name || ctx.user.email;
      // The facility follows the customer: taking the project's customer also takes its facility (or keeps the task's
      // own when it already belongs to that customer), so a task never points at another customer's facility.
      const facilityFor = (task: { customerId: string | null; facilityId: string | null }, applyCustomer: boolean) => applyCustomer
        ? project.facilityId ?? (task.customerId === project.customerId ? task.facilityId : null)
        : task.facilityId;
      const moveEvents = async (tx: Prisma.TransactionClient, taskId: string, title: string, fromProjectId: string | null) => {
        if (fromProjectId && fromProjectId !== project.id)
          await tx.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: fromProjectId, kind: "TASK_MOVED", summary: `Uppgiften ${title} flyttades till projektet ${project.name}`, taskId, actorName, createdBy: ctx.user.id } });
        await tx.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: project.id, kind: fromProjectId ? "TASK_MOVED" : "TASK_LINKED", summary: fromProjectId ? `Uppgiften ${title} flyttades hit från ett annat projekt` : `Uppgiften ${title} kopplades till projektet`, taskId, actorName, createdBy: ctx.user.id } });
        // Planning without a project must be included too: SQL's NOT (projectId = x) is never true for a null projectId.
        const planning = (await tx.plannedActivity.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null, OR: [{ workflowTaskId: taskId }, { controlId: taskId }] }, select: { id: true, title: true, version: true, projectId: true } }))
          .filter((activity) => activity.projectId !== project.id);
        for (const activity of planning) {
          await tx.plannedActivity.update({ where: { id: activity.id }, data: { projectId: project.id, version: { increment: 1 }, updatedBy: ctx.user.id } });
          await tx.plannedActivityEvent.create({ data: { organizationId: ctx.organizationId, plannedActivityId: activity.id, kind: "UPDATED", summary: `Planeringen ${activity.title} följde med uppgiften till projektet ${project.name}`, snapshot: json({ title: activity.title, projectId: project.id, version: activity.version + 1 }), actorName, createdBy: ctx.user.id } });
        }
      };
      if (input.taskKind === "COMMISSIONING_CONTROL") {
        const task = await prisma.control.findFirst({
          where: { id: input.taskId, organizationId: ctx.organizationId, deletedAt: null },
          select: { id: true, version: true, data: true, title: true, status: true, projectId: true, customerId: true, facilityId: true },
        });
        if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
        const applyCustomer = Boolean(apply.customer && task.status !== "COMPLETED" && project.customerId);
        const customerId = applyCustomer ? project.customerId : task.customerId;
        const facilityId = facilityFor(task, applyCustomer);
        await prisma.$transaction(async (tx) => {
          const changed = await tx.control.updateMany({
            where: { id: task.id, organizationId: ctx.organizationId, version: task.version },
            data: { projectId: project.id, customerId, facilityId, version: { increment: 1 }, updatedBy: ctx.user.id },
          });
          if (!changed.count) throw new ApiError(409, "Uppgiften har ändrats. Läs in projektet igen.");
          await tx.controlRevision.create({ data: { controlId: task.id, version: task.version + 1, data: json(task.data), createdBy: ctx.user.id } });
          await moveEvents(tx, task.id, task.title, task.projectId);
        });
      } else {
        const task = await prisma.workflowTask.findFirst({
          where: { id: input.taskId, organizationId: ctx.organizationId, kind: input.taskKind },
        });
        if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
        requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "edit");
        const open = task.status !== "COMPLETED";
        const values = {
          projectId: project.id,
          customerId: open && apply.customer && project.customerId ? project.customerId : task.customerId,
          facilityId: facilityFor(task, Boolean(open && apply.customer && project.customerId)),
          assignedToUserId: open && apply.responsible && project.responsibleUserId ? project.responsibleUserId : task.assignedToUserId,
          assignedToName: open && apply.responsible && project.responsibleUserId ? project.responsibleName : task.assignedToName,
          dueDate: open && apply.dueDate ? apply.dueDate : task.dueDate,
        };
        const nextVersion = task.version + 1;
        const snapshot = json({
          id: task.id, version: nextVersion, kind: task.kind, title: task.title, description: task.description, status: task.status,
          siteId: task.siteId, departmentId: task.departmentId, data: task.data, ...values,
        });
        await prisma.$transaction(async (tx) => {
          const changed = await tx.workflowTask.updateMany({
            where: { id: task.id, organizationId: ctx.organizationId, version: task.version },
            data: { ...values, version: { increment: 1 }, updatedBy: ctx.user.id },
          });
          if (!changed.count) throw new ApiError(409, "Uppgiften har ändrats. Läs in projektet igen.");
          await tx.workflowTaskRevision.create({ data: { taskId: task.id, version: nextVersion, snapshot, createdBy: ctx.user.id } });
          await moveEvents(tx, task.id, task.title, task.projectId);
        });
      }
      return NextResponse.json({ ok: true });
    }
    if (input.action === "archive" || input.action === "restore") {
      requireWorkflowPermission(ctx, "projects", "archive");
      const project = await prisma.project.findFirst({ where: { id: input.id, organizationId: ctx.organizationId }, select: { id: true, archivedAt: true } });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      const archive = input.action === "archive";
      if (Boolean(project.archivedAt) !== archive) await prisma.$transaction([
        prisma.project.update({ where: { id: project.id }, data: { archivedAt: archive ? new Date() : null, updatedBy: ctx.user.id } }),
        prisma.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: project.id, kind: archive ? "ARCHIVED" : "RESTORED", summary: archive ? "Projektet arkiverades" : "Projektet återställdes", actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } }),
      ]);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "delete") {
      requireWorkflowPermission(ctx, "projects", "archive");
      requireControlDelete(ctx);
      const project = await prisma.project.findFirst({
        where: { id: input.id, organizationId: ctx.organizationId },
        select: { id: true },
      });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      await prisma.$transaction([
        prisma.plannedActivity.updateMany({
          where: { organizationId: ctx.organizationId, projectId: project.id },
          data: { projectId: null, version: { increment: 1 }, updatedBy: ctx.user.id },
        }),
        prisma.control.updateMany({
          where: { organizationId: ctx.organizationId, projectId: project.id },
          data: { projectId: null },
        }),
        prisma.workflowTask.updateMany({
          where: { organizationId: ctx.organizationId, projectId: project.id },
          data: { projectId: null },
        }),
        prisma.project.delete({ where: { id: project.id } }),
      ]);
      return NextResponse.json({ ok: true });
    }
    const data = input.project;
    requireWorkflowPermission(ctx, "projects", data.id ? "edit" : "create");
    if (data.customerId && !(await prisma.customer.findFirst({
      where: { id: data.customerId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true },
    }))) throw new ApiError(400, "Kunden hittades inte.");
    if (data.responsibleUserId) {
      const member = await prisma.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, userId: data.responsibleUserId, isActive: true, user: { isActive: true } }, select: { user: { select: { name: true, email: true } } } });
      if (!member) throw new ApiError(400, "Projektansvarig tillhör inte arbetsytan.");
      data.responsibleName = member.user.name || member.user.email;
    } else data.responsibleName = "";
    // New projects need a frame; existing projects may stay without one, but a frame is always both dates in order.
    const frameError = projectFrameError({ startDate: data.startDate, dueDate: data.dueDate }, !data.id);
    if (frameError) throw new ApiError(400, frameError);
    const fields = { client: data.client, contactPerson: data.contactPerson, reference: data.reference, workSite: data.workSite, facilityId: data.facilityId };
    if (data.id) {
      const current = await prisma.project.findFirst({ where: { id: data.id, organizationId: ctx.organizationId }, select: { id: true, archivedAt: true, timeBudgetMinutes: true, startDate: true, dueDate: true, responsibleUserId: true, facilityId: true } });
      if (!current) throw new ApiError(404, "Projektet hittades inte.");
      await assertFacilityLink(ctx.organizationId, { facilityId: data.facilityId, customerId: data.customerId, previousFacilityId: current.facilityId });
      if (current.archivedAt) throw new ApiError(409, "Återställ projektet innan du redigerar det.");
      const frameChanged = current.startDate !== data.startDate || current.dueDate !== data.dueDate;
      // Only the project's responsible member or a company admin moves the frame (decision 5).
      if (frameChanged && !canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: current.responsibleUserId, canEditProjects: hasWorkflowPermission(ctx.workflowPermissions, "projects", "edit") }))
        throw new ApiError(403, "Bara projektansvarig eller en företagsadministratör kan ändra projektets tidsram.");
      const timeBudgetMinutes = data.timeBudgetMinutes ?? current.timeBudgetMinutes;
      // "Flytta allt lika mycket" (decision 5): open tasks' dates and active planning the user may edit move with
      // the frame; planning without edit rights is left and reported.
      const shiftDays = frameChanged ? data.shiftDays : 0;
      const shifted = shiftDays ? await shiftProjectWork(ctx, current.id, shiftDays) : null;
      const summary = current.timeBudgetMinutes !== timeBudgetMinutes ? `Projektets tidsbudget ändrades till ${timeBudgetMinutes} minuter`
        : frameChanged ? `Projektets tidsram ändrades till ${data.startDate || "–"} – ${data.dueDate || "–"}${shifted ? `; ${shifted.tasks} uppgifter och ${shifted.activities} planeringar flyttades ${shiftDays} dagar${shifted.skipped ? `, ${shifted.skipped} planeringar utan redigeringsrätt flyttades inte` : ""}` : ""}` : "Projektets grunduppgifter uppdaterades";
      await prisma.$transaction([
        prisma.project.update({ where: { id: current.id }, data: {
          name: data.name,
          description: data.description,
          startDate: data.startDate,
          ...fields,
          dueDate: data.dueDate,
          taskTypes: data.taskTypes,
          workMoments: data.workMoments,
          customerId: data.customerId,
          responsibleUserId: data.responsibleUserId,
          responsibleName: data.responsibleName,
          timeBudgetMinutes,
          updatedBy: ctx.user.id,
        } }),
        prisma.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: current.id, kind: current.timeBudgetMinutes !== timeBudgetMinutes ? "BUDGET_UPDATED" : "UPDATED", summary, actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } }),
      ]);
      return NextResponse.json({ id: data.id, shifted });
    }
    await assertFacilityLink(ctx.organizationId, { facilityId: data.facilityId, customerId: data.customerId });
    const project = await prisma.project.create({
      data: {
        organizationId: ctx.organizationId,
        name: data.name,
        description: data.description,
        startDate: data.startDate,
        dueDate: data.dueDate,
        ...fields,
        taskTypes: data.taskTypes,
        workMoments: data.workMoments,
        customerId: data.customerId,
        responsibleUserId: data.responsibleUserId,
        responsibleName: data.responsibleName,
        timeBudgetMinutes: data.timeBudgetMinutes ?? 0,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
        // organizationId comes from the parent project through the composite relation.
        events: { create: { kind: "CREATED", summary: "Projektet skapades", actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } },
      },
      select: { id: true },
    });
    return NextResponse.json(project);
  } catch (error) {
    return failure(error);
  }
}
