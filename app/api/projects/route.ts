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
  requireModule,
  requireWorkflowPermission,
} from "@/lib/kfid/server";
import { requireCustomersOrOwn } from "@/lib/kfid/own-company-server";
import { hasWorkflowPermission, readableTaskScope, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { workflowTaskDataSchema, workflowTaskProgress } from "@/lib/workflow/task-model";
import { timeBudgetMinutesSchema } from "@/lib/workflow/planned-activity";
import { canArchiveProject, canManageProjectLifecycle, summarizeProjectStatus } from "@/lib/workflow/project-status";
import { projectDecisionInputSchema, projectFrameError, taskDueDateError } from "@/lib/workflow/project-frame";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { assertFacilityLink, facilitySummarySelect, loadPlaceSummaries, placeSourceText } from "@/lib/kfid/facility-server";
import { WORK_LIST_SCOPES, WORK_LIST_SORTS, workListCountsAllowed } from "@/lib/workflow/work-list";
import { myProjectWhere, PROJECT_ATTENTION } from "@/lib/workflow/project-filters";
import { projectIdsNeedingAttention } from "@/lib/workflow/project-attention-server";
import { allowedFilter } from "@/lib/url-filters";
import { requireAssignLevels } from "@/lib/self-inspection/levels-server";
import { canSwitchStaffRegister, EMPTY_STAFF_REGISTER, STAFF_REGISTER_ACTIVATION_DENIED, staffRegisterActivationChange, staffRegisterInputSchema, staffRegisterOf } from "@/lib/workflow/staff-register";
import { projectHasRegister } from "@/lib/staff-register/server";
import { PROJECT_LINK_WORK_ORDER_ONLY, tasksFollowingWorkOrder } from "@/lib/workflow/work-order-link";
import { followWorkOrder, requireFollowingLevels } from "@/lib/kfid/work-order-link-server";
import { jobStepOf, type JobStep } from "@/lib/workflow/project-jobs";
import { summarizeProjectMaterials, type ProjectMaterialSummary } from "@/lib/workflow/project-materials";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { riskStepApplies } from "@/lib/workflow/risk-step";
import { riskStepOf } from "@/lib/workflow/risk-step-server";
import { CLOSED_TASK_STATUSES, isTaskOpen } from "@/lib/workflow/task-cancel";
import { canHandOverPlanning, planningDelegateSummary } from "@/lib/workflow/bookings";
import { projectCustomerFields } from "@/lib/workflow/project-customer";
import { planProjectCustomerChange, ProjectCustomerChangeRequired, projectJobMoveWrites } from "@/lib/kfid/project-customer-server";
import { datesOnProjectLink, holdsOwnPeriod, projectShift } from "@/lib/workflow/job-planning";
import { jobObstacle } from "@/lib/workflow/obstacles";

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
  // Personalliggare, steg 0 (2026-10-08). Optional so an older client that does not send it keeps the stored value.
  staffRegister: staffRegisterInputSchema.optional(),
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
  /** Kundbyte (2026-10-10): "move_jobs" is the person's explicit choice to move the project's open jobs to the new customer. */
  customerChange: z.enum(["move_jobs"]).optional(),
});

/** Flytta allt: the project's open jobs (Start and Klart senast, projectShift) and the active planning the caller may edit, by whole days. */
async function shiftProjectWork(ctx: Awaited<ReturnType<typeof context>>, projectId: string, days: number) {
  const may = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "edit");
  const [tasks, activities] = await Promise.all([
    prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, projectId, status: { notIn: [...CLOSED_TASK_STATUSES] } } }),
    prisma.plannedActivity.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, status: { in: ["PLANNED", "IN_PROGRESS"] }, OR: [{ projectId }, { workflowTask: { is: { projectId } } }] },
      include: { workflowTask: { select: { kind: true, formArea: true, roundScheduleId: true, maintenancePlanId: true } }, assignments: true },
    }),
  ]);
  const shift = projectShift(tasks, days);
  const movableTasks = shift.moves.filter(({ job }) => may(workflowSubjectForTask(job.kind, job.formArea)));
  // A job that keeps its period keeps its bookings.
  const following = activities.filter((activity) => !(activity.workflowTaskId && shift.kept.has(activity.workflowTaskId)) && !(activity.workflowTask && holdsOwnPeriod(activity.workflowTask)));
  const canMove = (activity: (typeof activities)[number]) => may("projects") && (!activity.workflowTask || may(workflowSubjectForTask(activity.workflowTask.kind, activity.workflowTask.formArea)));
  const movable = following.filter(canMove);
  const actorName = ctx.user.name || ctx.user.email;
  const move = (value: Date) => addSwedishDays(value, days);
  await prisma.$transaction(async (tx) => {
    for (const { job: task, dueDate, plannedStartDate } of movableTasks) {
      const nextVersion = task.version + 1;
      await tx.workflowTask.update({ where: { id: task.id }, data: { plannedStartDate, dueDate, version: { increment: 1 }, updatedBy: ctx.user.id } });
      await tx.workflowTaskRevision.create({ data: { taskId: task.id, version: nextVersion, createdBy: ctx.user.id, snapshot: json({
        id: task.id, version: nextVersion, kind: task.kind, title: task.title, description: task.description, status: task.status, projectId: task.projectId, customerId: task.customerId,
        assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, plannedStartDate, dueDate, data: task.data,
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
  return { tasks: movableTasks.length, skippedTasks: shift.moves.length - movableTasks.length, activities: movable.length, skipped: following.length - movable.length, kept: tasks.filter((task) => shift.kept.has(task.id) && !task.workOrderId).length };
}

/** Project cards per page in "Mina projekt". */
const PROJECT_PAGE_SIZE = 12;
const PROJECT_OPTION_LIMIT = 1000;
// Planning reads tasks without their data (quality check 2026-10-05, F5) and uses the progress stored at every save;
// the other reads compute it from the data as before.
function taskProgressOf(task: { title: string; status: string; progress: number }, data: Prisma.JsonValue | undefined) {
  return data === undefined ? task.progress : workflowTaskProgress({ ...task, data: workflowTaskDataSchema.parse(data) });
}
/**
 * Samlad bild (Fas 4B): each job's current step on the project page, from the same flows as the task page. Read only for
 * the one project the page shows (never for the lists or planning); the risk step is read for the open tasks that have it.
 */
type StepTask = { id: string; kind: string; formArea: string | null; formTemplateId: string | null; title: string; status: string; workOrderId: string | null; data?: Prisma.JsonValue };
async function jobStepsOf(organizationId: string, tasks: StepTask[]): Promise<Map<string, JobStep>> {
  const steps = new Map<string, JobStep>();
  await Promise.all(tasks.map(async (task) => {
    if (task.data === undefined) return;
    const parsed = workflowTaskDataSchema.safeParse(task.data);
    if (!parsed.success) return;
    const required = riskStepApplies({ kind: task.kind, formArea: task.formArea, data: task.data, workOrderId: task.workOrderId });
    const riskDone = !required ? null : task.status === "COMPLETED" ? true : (await riskStepOf(organizationId, { ...task, data: task.data })).state.done;
    steps.set(task.id, jobStepOf({ title: task.title, status: task.status, data: parsed.data }, riskDone));
  }));
  return steps;
}

/** At most this many link candidates, most recently changed first. */
const LINK_CANDIDATE_LIMIT = 200;

/**
 * Tasks that may be linked to or moved into a project (decision 7): standalone tasks, and those in other
 * projects that still accept work. Only fields the link guide shows are sent; editing rights are checked on link.
 */
async function linkCandidates(ctx: Awaited<ReturnType<typeof context>>, projectId: string, can: (subject: WorkflowPermissionSubject, action: "read") => boolean) {
  if (!can("projects", "read")) throw new ApiError(403, "Du saknar behörighet att läsa projekt.");
  // Protocols follow their form's permission area (2026-09-27).
  const readable = readableTaskScope((subject) => can(subject, "read")).any ? readableTaskWhere((subject) => can(subject, "read")) : null;
  const tasks = readable ? await prisma.workflowTask.findMany({
      // Only work orders move to a project; their tasks follow (Arbetsordern styr, 2026-10-26).
      where: { organizationId: ctx.organizationId, kind: "WORK_ORDER", AND: [readable], OR: [{ projectId: null }, { projectId: { not: projectId }, project: { is: { archivedAt: null, closedAt: null } } }] },
      orderBy: { updatedAt: "desc" }, take: LINK_CANDIDATE_LIMIT,
      select: { id: true, title: true, kind: true, status: true, updatedAt: true, projectId: true, customerId: true, assignedToUserId: true, assignedToName: true, dueDate: true, plannedStartDate: true, roundScheduleId: true, progress: true, project: { select: { name: true } } },
    }) : [];
  const [time, plannedByTask] = await Promise.all([
    prisma.workflowTimeEntry.groupBy({ by: ["taskId"], where: { endedAt: { not: null }, taskId: { in: tasks.map((task) => task.id) } }, _sum: { durationSec: true } }),
    // The planning that follows each task into the project, for the link guide: the project view reads only its own
    // planning since the bounded reads (2026-10-06), so the count comes from here.
    tasks.length ? prisma.plannedActivity.groupBy({ by: ["workflowTaskId"], where: { organizationId: ctx.organizationId, deletedAt: null, workflowTaskId: { in: tasks.map((task) => task.id) } }, _count: { _all: true } }) : [],
  ]);
  const seconds = new Map(time.map((row) => [row.taskId, row._sum.durationSec ?? 0]));
  const planned = new Map(plannedByTask.map((row) => [row.workflowTaskId, row._count._all] as const));
  return {
    tasks: tasks.map(({ project, ...task }) => ({ ...task, fromProject: project?.name, totalDurationSec: seconds.get(task.id) ?? 0, plannedCount: planned.get(task.id) ?? 0 })),
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const can = (subject: WorkflowPermissionSubject, action: "read") => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, action);
    // Older project history, one bounded page at a time (2026-09-26).
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
    // Project choices only (id and name), e.g. Driftronder's project field (quality check 2026-10-05, F5: it read the
    // whole planning payload for the names).
    if (params.get("scope") === "options") {
      if (!can("projects", "read")) return NextResponse.json({ projects: [] });
      const options = await prisma.project.findMany({
        where: { organizationId: ctx.organizationId }, orderBy: [{ name: "asc" }, { id: "asc" }], take: PROJECT_OPTION_LIMIT,
        select: { id: true, name: true, archivedAt: true, closedAt: true },
      });
      return NextResponse.json({ projects: options });
    }
    // Bounded reads (2026-09-26: fetch only what is shown): "Mina projekt" pages one tab of project cards,
    // the project view reads one project, and only planning still reads every project with its tasks.
    const listTab = z.enum(["ongoing", "closed", "archived"]).optional().parse(params.get("list") ?? undefined);
    const onlyId = params.get("id") ? id.parse(params.get("id")) : null;
    const full = !listTab && !onlyId;
    // Planning reads every project for its pickers and totals, but never their history or decisions.
    const lean = params.get("scope") === "planning";
    const page = Math.max(1, Number(params.get("page")) || 1);
    const query = (params.get("q") ?? "").trim().slice(0, 100);
    // Mina / Alla and sorting (2026-10-05). "all" stays the default for older callers such as the list_projects
    // tool; "Mina" is the projects I am responsible for, created, or have work assigned in.
    const listScope = z.enum(WORK_LIST_SCOPES).catch("all").parse(params.get("scope") ?? "all");
    const listSort = z.enum(WORK_LIST_SORTS).catch("updated").parse(params.get("sort") ?? "updated");
    const tabWhere = { ongoing: { archivedAt: null, closedAt: null }, closed: { archivedAt: null, closedAt: { not: null } }, archived: { archivedAt: { not: null } } } satisfies Record<string, Prisma.ProjectWhereInput>;
    const searchWhere: Prisma.ProjectWhereInput = query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }, { responsibleName: { contains: query, mode: "insensitive" } }, { customer: { is: { OR: [{ name: { contains: query, mode: "insensitive" } }, { company: { contains: query, mode: "insensitive" } }] } } }] } : {};
    // Mina projekt by the shared rule (lib/workflow/project-filters.ts), the same as the key figure's (dashboard etapp 3):
    // jobs booked on me count too.
    const mineWhere: Prisma.ProjectWhereInput = listScope === "mine" ? myProjectWhere(ctx.user.id) : {};
    // Status (dashboard etapp 3, 2026-10-28): within Pågående, the projects that are late, over budget or ready to
    // close by the key figure's rule (projectAttention), worked out before the page is read.
    const attention = listTab === "ongoing" && can("projects", "read") ? allowedFilter(params.get("status"), PROJECT_ATTENTION) : null;
    const attentionIds = attention ? await projectIdsNeedingAttention(ctx.organizationId, { AND: [searchWhere, mineWhere] }, attention) : null;
    const listWhere = (tab: keyof typeof tabWhere): Prisma.ProjectWhereInput => ({ AND: [tabWhere[tab], searchWhere, mineWhere, ...(tab === "ongoing" && attentionIds ? [{ id: { in: attentionIds } }] : [])] });
    const projectWhere: Prisma.ProjectWhereInput = { organizationId: ctx.organizationId, ...(onlyId ? { id: onlyId } : {}), ...(listTab ? listWhere(listTab) : {}) };
    // Tab counts are aggregates: in "Alla" only for a company admin (an ordinary member never gets team aggregates).
    const withCounts = workListCountsAllowed(listScope, ctx.admin);
    const [tabCounts, listTotal] = listTab && can("projects", "read") ? await Promise.all([
      withCounts ? Promise.all((["ongoing", "closed", "archived"] as const).map(async (tab) => [tab, await prisma.project.count({ where: { organizationId: ctx.organizationId, ...listWhere(tab) } })] as const)).then(Object.fromEntries) : Promise.resolve(null),
      prisma.project.count({ where: projectWhere }),
    ]) : [null, 0];
    // "Närmaste datum": dated projects by end date, then those without one – in two bounded reads, since an empty
    // end date is stored as "" and would otherwise sort first.
    const skip = (page - 1) * PROJECT_PAGE_SIZE;
    const datedCount = listTab && listSort === "due" && can("projects", "read") ? await prisma.project.count({ where: { AND: [projectWhere, { dueDate: { not: "" } }] } }) : 0;
    const listReads: { where: Prisma.ProjectWhereInput; orderBy: Prisma.ProjectOrderByWithRelationInput[]; skip?: number; take?: number }[] = !listTab
      ? [{ where: projectWhere, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] }]
      : listSort === "title" ? [{ where: projectWhere, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take: PROJECT_PAGE_SIZE }]
      : listSort === "due" ? [
        ...(skip < datedCount ? [{ where: { AND: [projectWhere, { dueDate: { not: "" } }] }, orderBy: [{ dueDate: "asc" as const }, { updatedAt: "desc" as const }, { id: "asc" as const }], skip, take: PROJECT_PAGE_SIZE }] : []),
        ...(skip + PROJECT_PAGE_SIZE > datedCount ? [{ where: { AND: [projectWhere, { dueDate: "" }] }, orderBy: [{ updatedAt: "desc" as const }, { id: "asc" as const }], skip: Math.max(0, skip - datedCount), take: Math.min(PROJECT_PAGE_SIZE, skip + PROJECT_PAGE_SIZE - datedCount) }] : []),
      ]
      : [{ where: projectWhere, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip, take: PROJECT_PAGE_SIZE }];
    const [projects, members] = await Promise.all([!can("projects", "read") ? Promise.resolve([]) : Promise.all(listReads.map((read) => prisma.project.findMany({
      ...read,
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
        staffRegister: true,
        facilityId: true,
        facility: { select: facilitySummarySelect },
        taskTypes: true,
        workMoments: true,
        customerId: true,
        responsibleUserId: true,
        planningDelegateUserId: true,
        responsibleName: true,
        timeBudgetMinutes: true,
        archivedAt: true,
        closedAt: true,
        updatedAt: true,
        // Status counts all planning, whatever the viewer may read, so the project has one status for everyone.
        plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true, workflowTaskId: true } },
        // The project cards show neither history nor decisions, so the list reads none.
        events: { orderBy: { createdAt: "desc" }, take: listTab || lean ? 0 : 10, select: { id: true, kind: true, summary: true, taskId: true, actorName: true, createdAt: true } },
        decisions: { orderBy: { createdAt: "desc" }, take: listTab || lean ? 0 : 10, select: { id: true, decidedOn: true, text: true, decidedBy: true, actorName: true, createdAt: true } },
        _count: { select: { events: true, decisions: true } },
        customer: { select: { id: true, name: true, company: true, customerType: true } },
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
            // Tidplan (steg 2): Uppskattat and the completion weighted by it on the project page.
            plannedStartDate: true,
            estimatedMinutes: true,
            // Flytta allt (2026-11-02): a round's or a plan's work order keeps its dates, so the preview leaves it out.
            roundScheduleId: true,
            maintenancePlanId: true,
            // Plan 1M: the stage groups the project page's jobs; createdAt is the start of an older job without a Start.
            stage: true,
            createdAt: true,
            customerId: true,
            data: !lean,
            updatedAt: true,
            projectId: true,
            assignedToUserId: true,
            assignedToName: true,
            createdBy: true,
            // Hör till arbetsorder (Fas 2): the project page nests a work order's tasks under it (Fas 4B).
            workOrderId: true,
            formTemplateId: true,
          },
        },
      },
    }))).then((pages) => pages.flat()), prisma.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } },
      orderBy: { user: { name: "asc" } },
      select: { userId: true, user: { select: { name: true, email: true } } },
    })]);
    const standaloneWorkflowTasks = full ? await prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId, projectId: null },
      orderBy: { updatedAt: "desc" },
      // Boka (2026-11-02): the form fills Start from the job; a round's holder is told apart.
      select: { id: true, title: true, kind: true, formArea: true, status: true, progress: true, dueDate: true, plannedStartDate: true, createdAt: true, roundScheduleId: true, customerId: true, data: !lean, updatedAt: true, projectId: true, assignedToUserId: true, assignedToName: true, createdBy: true },
    }) : [];
    // Reported time per task is summed in the database instead of sending every time entry (2026-09-26);
    // bounded reads only sum the time of the projects they return.
    const projectIds = projects.map((project) => project.id);
    const scoped = !full;
    const projectScope = { organizationId: ctx.organizationId, ...(scoped ? { id: { in: projectIds } } : {}) };
    const [finishedTime, runningTime, projectOwnTime, projectRunning] = await Promise.all([
      prisma.workflowTimeEntry.groupBy({ by: ["taskId"], where: { endedAt: { not: null }, task: { organizationId: ctx.organizationId, ...(scoped ? { projectId: { in: projectIds } } : {}) } }, _sum: { durationSec: true } }),
      prisma.workflowTimeEntry.findMany({ where: { endedAt: null, task: { organizationId: ctx.organizationId, ...(scoped ? { projectId: { in: projectIds } } : {}) } }, select: { taskId: true, startedAt: true } }),
      // Projekttid (2026-10-26, svar 5a): the project's own time, without a work order, shown on its own line.
      prisma.workflowTimeEntry.groupBy({ by: ["projectId"], where: { endedAt: { not: null }, project: { is: projectScope } }, _sum: { durationSec: true } }),
      prisma.workflowTimeEntry.findMany({ where: { endedAt: null, project: { is: projectScope } }, select: { projectId: true, startedAt: true } }),
    ]);
    const projectSeconds = new Map(projectOwnTime.map((row) => [row.projectId, row._sum.durationSec ?? 0] as const));
    for (const entry of projectRunning) projectSeconds.set(entry.projectId, (projectSeconds.get(entry.projectId) ?? 0) + Math.max(0, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000)));
    // Reported time outside a project's frame (decision 6): allowed, but shown on the project. Swedish calendar days.
    const outsideFrame = projectIds.length ? await prisma.$queryRaw<{ projectId: string; seconds: bigint | number | null }[]>(Prisma.sql`
      select p.id as "projectId", sum(e."durationSec") as seconds
      from "WorkflowTimeEntry" e left join "WorkflowTask" t on t.id = e."taskId"
        join "Project" p on p.id = coalesce(e."projectId", t."projectId")
      where p."organizationId" = ${ctx.organizationId} and p."startDate" <> '' and p."dueDate" <> '' and e."endedAt" is not null
        ${scoped ? Prisma.sql`and p.id in (${Prisma.join(projectIds)})` : Prisma.empty}
        and ((e."startedAt" at time zone 'Europe/Stockholm')::date < p."startDate"::date or (e."startedAt" at time zone 'Europe/Stockholm')::date > p."dueDate"::date)
      group by p.id`) : [];
    const outsideMinutes = new Map(outsideFrame.map((row) => [row.projectId, Math.round(Number(row.seconds ?? 0) / 60)]));
    const secondsByTask = new Map(finishedTime.map((row) => [row.taskId, row._sum.durationSec ?? 0] as const));
    for (const entry of runningTime) secondsByTask.set(entry.taskId, (secondsByTask.get(entry.taskId) ?? 0) + Math.max(0, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000)));
    const listMeta = listTab ? { total: listTotal, page, pages: Math.max(1, Math.ceil(listTotal / PROJECT_PAGE_SIZE)), counts: withCounts ? tabCounts ?? { ongoing: 0, closed: 0, archived: 0 } : null } : {};
    // A project's place with its whole way and the facility's address (Platser, 2026-10-04).
    const places = await loadPlaceSummaries(ctx.organizationId, projects.map((project) => project.facilityId));
    // Material i projektet (2026-10-09): the project view's summed material rows, from the work orders this
    // person may read – only for the one project the page shows and only with work-order:read.
    const showMaterials = Boolean(onlyId) && !lean && can("work-order", "read");
    // Priser (steg A, 2026-10-09): the amounts and the project's sums only for someone who may see prices.
    const materialsOf = (tasks: StepTask[]): ProjectMaterialSummary => summarizeProjectMaterials(tasks.flatMap((task) => {
      if (task.kind !== "WORK_ORDER" || task.data === undefined) return [];
      const parsed = workflowTaskDataSchema.safeParse(task.data);
      return parsed.success && parsed.data.kind === "WORK_ORDER" ? [{ id: task.id, title: task.title, materials: parsed.data.details.materials }] : [];
    }), undefined, { prices: canSeePrices({ admin: ctx.admin, permissions: ctx.workflowPermissions }) });
    const jobSteps = onlyId ? await jobStepsOf(ctx.organizationId, projects.flatMap((project) => project.workflowTasks.filter((task) => can(workflowSubjectForTask(task.kind, task.formArea), "read")))) : new Map<string, JobStep>();
    return NextResponse.json({
      ...listMeta,
      projects: projects.map(({ _count, plannedActivities, ...project }) => ({
        ...project,
        staffRegister: staffRegisterOf(project.staffRegister),
        facility: project.facilityId ? places.get(project.facilityId) ?? project.facility : null,
        status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: project.workflowTasks, activities: plannedActivities }),
        eventCount: _count.events,
        decisionCount: _count.decisions,
        outsideFrameMinutes: outsideMinutes.get(project.id) ?? 0,
        projectTimeSec: projectSeconds.get(project.id) ?? 0,
        ...(showMaterials ? { materials: materialsOf(project.workflowTasks) } : {}),
        workflowTasks: project.workflowTasks.filter((task) => can(workflowSubjectForTask(task.kind, task.formArea), "read")).map(({ assignedToUserId, createdBy, data, ...task }) => ({
          ...task,
          ...(jobSteps.has(task.id) ? { step: jobSteps.get(task.id) } : {}),
          // Rapportera hinder (plan 1M): what the job waits for, marked in the project's job list.
          ...(jobObstacle({ status: task.status, data, updatedAt: task.updatedAt }) ? { obstacle: jobObstacle({ status: task.status, data, updatedAt: task.updatedAt }) } : {}),
          assignedToUserId,
          progress: taskProgressOf(task, data),
          totalDurationSec: secondsByTask.get(task.id) ?? 0,
          isMine: assignedToUserId === ctx.user.id || (!assignedToUserId && createdBy === ctx.user.id),
        })),
      })),
      workflowTasks: standaloneWorkflowTasks.filter((task) => can(workflowSubjectForTask(task.kind, task.formArea), "read")).map(({ assignedToUserId, createdBy, data, ...task }) => ({
        ...task,
        assignedToUserId,
        progress: taskProgressOf(task, data),
        totalDurationSec: secondsByTask.get(task.id) ?? 0,
        isMine: assignedToUserId === ctx.user.id || (!assignedToUserId && createdBy === ctx.user.id),
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
    requireModule(ctx, "projects");
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("save"), project: projectInput }),
      z.object({ action: z.literal("link"), projectId: id, taskId: id, taskKind: z.enum(["WORK_ORDER", "RISK_ASSESSMENT", "FORM"]),
        apply: z.object({ customer: z.boolean().default(true), responsible: z.boolean().default(false), dueDate: z.union([z.literal(""), z.iso.date()]).default("") }).default({ customer: true, responsible: false, dueDate: "" }) }),
      z.object({ action: z.literal("delete"), id }),
      z.object({ action: z.literal("archive"), id, confirmOpen: z.boolean().optional() }),
      z.object({ action: z.literal("restore"), id }),
      z.object({ action: z.literal("decision"), projectId: id, decision: projectDecisionInputSchema }),
      z.object({ action: z.literal("close"), id }),
      z.object({ action: z.literal("reopen_project"), id }),
      // Ställföreträdare (2026-10-09): hand over the right to change others' bookings, or take it back (null).
      z.object({ action: z.literal("planning_delegate"), id, userId: id.nullable() }),
    ]).parse(await body(request));
    if (input.action === "planning_delegate") {
      requireWorkflowPermission(ctx, "projects", "read");
      const project = await prisma.project.findFirst({
        where: { id: input.id, organizationId: ctx.organizationId },
        select: { id: true, archivedAt: true, responsibleUserId: true, planningDelegateUserId: true, planningDelegate: { select: { user: { select: { name: true, email: true } } } } },
      });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      if (!canHandOverPlanning({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project.responsibleUserId, canEditProjects: hasWorkflowPermission(ctx.workflowPermissions, "projects", "edit") }))
        throw new ApiError(403, "Bara projektansvarig eller en företagsadministratör kan lämna över eller ta tillbaka rätten att ändra andras bokningar.");
      if (project.archivedAt) throw new ApiError(409, "Återställ projektet från arkivet först.");
      if (input.userId && input.userId === project.responsibleUserId) throw new ApiError(400, "Projektansvarig har redan rätten. Välj en annan person som ställföreträdare.");
      const next = input.userId ? await prisma.organizationMember.findFirst({
        where: { organizationId: ctx.organizationId, userId: input.userId, isActive: true, user: { is: { isActive: true } } },
        select: { userId: true, user: { select: { name: true, email: true } } },
      }) : null;
      if (input.userId && !next) throw new ApiError(400, "Ställföreträdaren måste vara en aktiv medlem i företaget.");
      if ((next?.userId ?? null) === project.planningDelegateUserId) return NextResponse.json({ ok: true, planningDelegateUserId: project.planningDelegateUserId });
      const previousName = project.planningDelegate ? project.planningDelegate.user.name || project.planningDelegate.user.email : "";
      const nextName = next ? next.user.name || next.user.email : "";
      await prisma.$transaction([
        prisma.project.update({ where: { id: project.id }, data: { planningDelegateUserId: next?.userId ?? null, updatedBy: ctx.user.id } }),
        prisma.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: project.id, kind: next ? "PLANNING_DELEGATED" : "PLANNING_DELEGATE_REVOKED", summary: planningDelegateSummary(previousName, nextName), actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } }),
      ]);
      return NextResponse.json({ ok: true, planningDelegateUserId: next?.userId ?? null });
    }
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
          workflowTasks: { select: { id: true, status: true } },
          plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true, workflowTaskId: true } },
        },
      });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      if (!canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project.responsibleUserId, canEditProjects: hasWorkflowPermission(ctx.workflowPermissions, "projects", "edit") }))
        throw new ApiError(403, "Bara projektansvarig eller en företagsadministratör kan avsluta eller återöppna projektet.");
      if (project.archivedAt) throw new ApiError(409, "Återställ projektet från arkivet först.");
      if (close && !project.closedAt) {
        const status = summarizeProjectStatus({ ...project, tasks: project.workflowTasks, activities: project.plannedActivities });
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
      // Arbetsordern styr (2026-10-26): a task follows its work order, so only a work order is moved to a project,
      // and the tasks in it come along ("Koppla befintlig uppgift" is gone).
      if (input.taskKind !== "WORK_ORDER") throw new ApiError(409, PROJECT_LINK_WORK_ORDER_ONLY);
      requireWorkflowPermission(ctx, "work-order", "edit");
      const project = await prisma.project.findFirst({
        where: { id: input.projectId, organizationId: ctx.organizationId },
        select: { id: true, name: true, archivedAt: true, closedAt: true, customerId: true, facilityId: true, responsibleUserId: true, responsibleName: true, startDate: true, dueDate: true },
      });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      if (project.archivedAt) throw new ApiError(409, "Återställ projektet innan du kopplar en uppgift.");
      if (project.closedAt) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet innan du kopplar en uppgift.");
      // The link guide (2026-09-26, decision 7): the user chose per field whether the project's value applies.
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
        const planning = (await tx.plannedActivity.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null, workflowTaskId: taskId }, select: { id: true, title: true, version: true, projectId: true } }))
          .filter((activity) => activity.projectId !== project.id);
        for (const activity of planning) {
          await tx.plannedActivity.update({ where: { id: activity.id }, data: { projectId: project.id, version: { increment: 1 }, updatedBy: ctx.user.id } });
          await tx.plannedActivityEvent.create({ data: { organizationId: ctx.organizationId, plannedActivityId: activity.id, kind: "UPDATED", summary: `Planeringen ${activity.title} följde med uppgiften till projektet ${project.name}`, snapshot: json({ title: activity.title, projectId: project.id, version: activity.version + 1 }), actorName, createdBy: ctx.user.id } });
        }
      };
      const task = await prisma.workflowTask.findFirst({
        where: { id: input.taskId, organizationId: ctx.organizationId, kind: input.taskKind },
      });
      if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
      requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "edit");
      const open = isTaskOpen(task.status);
      const values = {
        projectId: project.id,
        customerId: open && apply.customer && project.customerId ? project.customerId : task.customerId,
        facilityId: facilityFor(task, Boolean(open && apply.customer && project.customerId)),
        assignedToUserId: open && apply.responsible && project.responsibleUserId ? project.responsibleUserId : task.assignedToUserId,
        assignedToName: open && apply.responsible && project.responsibleUserId ? project.responsibleName : task.assignedToName,
        ...datesOnProjectLink(task, { open, chosenDue: apply.dueDate, today: swedishDayKey(new Date()), frame: { startDate: project.startDate ?? "", dueDate: project.dueDate ?? "" } }),
      };
      // Roller med nivå (2026-10-07): the project's responsible takes the task over only when the person reaches its risk class.
      if (values.assignedToUserId && values.assignedToUserId !== task.assignedToUserId)
        await requireAssignLevels(ctx.organizationId, task, [{ id: values.assignedToUserId, name: values.assignedToName }], ctx.user);
      if (open && values.assignedToUserId && values.assignedToUserId !== task.assignedToUserId)
        await requireFollowingLevels(ctx.organizationId, ctx.user, { id: task.id, assignedToUserId: values.assignedToUserId, assignedToName: values.assignedToName });
      const nextVersion = task.version + 1;
      const snapshot = json({
        id: task.id, version: nextVersion, kind: task.kind, title: task.title, description: task.description, status: task.status,
        data: task.data, ...values,
      });
      await prisma.$transaction(async (tx) => {
        const changed = await tx.workflowTask.updateMany({
          where: { id: task.id, organizationId: ctx.organizationId, version: task.version },
          data: { ...values, version: { increment: 1 }, updatedBy: ctx.user.id },
        });
        if (!changed.count) throw new ApiError(409, "Uppgiften har ändrats. Läs in projektet igen.");
        await tx.workflowTaskRevision.create({ data: { taskId: task.id, version: nextVersion, snapshot, createdBy: ctx.user.id } });
        await moveEvents(tx, task.id, task.title, task.projectId);
        // The tasks in the work order take its project and customer (and its place when their customer changes).
        const order = { id: task.id, kind: "WORK_ORDER", status: task.status, projectId: values.projectId, customerId: values.customerId, facilityId: values.facilityId };
        // Grunduppgifter are the same data (2026-10-30): the open tasks take all of them, also the dates and the responsible
        // person the link just changed, as in Local and the demo. A finished task only follows the project, customer and place.
        if (open) await followWorkOrder(tx, ctx.organizationId, { ...order, assignedToUserId: values.assignedToUserId, assignedToName: values.assignedToName, plannedStartDate: values.plannedStartDate ?? task.plannedStartDate, dueDate: values.dueDate, roundScheduleId: task.roundScheduleId }, ctx.user.id);
        const inside = await tx.workflowTask.findMany({ where: { organizationId: ctx.organizationId, workOrderId: task.id, ...(open ? { status: { in: ["COMPLETED", "CANCELLED"] } } : {}) }, select: { id: true, kind: true, projectId: true, customerId: true, facilityId: true, workOrderId: true } });
        for (const next of tasksFollowingWorkOrder(order, inside))
          await tx.workflowTask.update({ where: { id: next.id }, data: { projectId: next.projectId, customerId: next.customerId, facilityId: next.facilityId ?? null, version: { increment: 1 }, updatedBy: ctx.user.id } });
      });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "archive" || input.action === "restore") {
      const project = await prisma.project.findFirst({ where: { id: input.id, organizationId: ctx.organizationId }, select: { id: true, archivedAt: true, responsibleUserId: true } });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      if (!canArchiveProject({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project.responsibleUserId, canEditProjects: hasWorkflowPermission(ctx.workflowPermissions, "projects", "edit"), canArchiveProjects: hasWorkflowPermission(ctx.workflowPermissions, "projects", "archive") }))
        throw new ApiError(403, "Bara projektansvarig, en företagsadministratör eller den som fått rätten kan arkivera projektet.");
      const archive = input.action === "archive";
      // Archiving freezes the work (2026-10-02, the simulation): with unfinished tasks it needs the person's confirmation.
      if (archive && !project.archivedAt && !(input as { confirmOpen?: boolean }).confirmOpen) {
        const open = await prisma.workflowTask.count({ where: { organizationId: ctx.organizationId, projectId: project.id, status: { notIn: [...CLOSED_TASK_STATUSES] } } });
        if (open) throw new ApiError(409, `Projektet har ${open} ${open === 1 ? "oavslutad uppgift" : "oavslutade uppgifter"}. Slutför dem eller bekräfta att projektet ändå ska arkiveras.`);
      }
      if (Boolean(project.archivedAt) !== archive) await prisma.$transaction([
        prisma.project.update({ where: { id: project.id }, data: { archivedAt: archive ? new Date() : null, updatedBy: ctx.user.id } }),
        prisma.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: project.id, kind: archive ? "ARCHIVED" : "RESTORED", summary: archive ? "Projektet arkiverades" : "Projektet återställdes", actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } }),
      ]);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "delete") {
      // Said in its own words (PRJ-19): the shared texts talk of "arkivera" and "kontroller".
      if (!ctx.canDeleteControls || !(ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "projects", "archive"))) throw new ApiError(403, "Du saknar behörighet att radera projekt.");
      const project = await prisma.project.findFirst({
        where: { id: input.id, organizationId: ctx.organizationId },
        select: { id: true },
      });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      // Personalliggare (steg 1): the register must be kept for its retention time, so the project stays (the database
      // refuses the deletion too). Archiving keeps it readable for an inspection.
      if (await projectHasRegister(ctx.organizationId, project.id)) throw new ApiError(409, "Projektet har en personalliggare som ska sparas. Arkivera projektet i stället.");
      // Projekttid (2026-10-26) is reported work: a project with time of its own is archived, never deleted.
      if (await prisma.workflowTimeEntry.count({ where: { projectId: project.id } })) throw new ApiError(409, "Projektet har rapporterad projekttid. Arkivera projektet i stället.");
      await prisma.$transaction([
        prisma.plannedActivity.updateMany({
          where: { organizationId: ctx.organizationId, projectId: project.id },
          data: { projectId: null, version: { increment: 1 }, updatedBy: ctx.user.id },
        }),
        // The older controls' table is unused (2026-10-06) but keeps its foreign key to the project.
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
    const customer = data.customerId ? await prisma.customer.findFirst({
      where: { id: data.customerId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true, company: true, customerType: true },
    }) : null;
    if (data.customerId && !customer) throw new ApiError(400, "Kunden hittades inte.");
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
      const current = await prisma.project.findFirst({ where: { id: data.id, organizationId: ctx.organizationId }, select: { id: true, archivedAt: true, timeBudgetMinutes: true, startDate: true, dueDate: true, responsibleUserId: true, facilityId: true, staffRegister: true, customerId: true, customer: { select: { name: true, company: true, customerType: true } } } });
      if (!current) throw new ApiError(404, "Projektet hittades inte.");
      // Företagets moduler (0.39.0): with Kunder off a project is tied to no new customer; the one it has stays.
      if (data.customerId && data.customerId !== current.customerId) await requireCustomersOrOwn(ctx, data.customerId);
      // Beställare and Kontaktperson follow the customer (2026-10-10), like Arbetsplats / anläggning follows the place.
      Object.assign(fields, projectCustomerFields({ customer, previousCustomer: current.customer, client: fields.client, contactPerson: fields.contactPerson }));
      // Workflow's staff register is switched on or off only by the project's responsible member or an admin (2026-10-09 evening).
      if (data.staffRegister && staffRegisterActivationChange(current.staffRegister, data.staffRegister)) requireModule(ctx, "staff_register");
      if (data.staffRegister && staffRegisterActivationChange(current.staffRegister, data.staffRegister) && !canSwitchStaffRegister({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: current.responsibleUserId, canEditProjects: hasWorkflowPermission(ctx.workflowPermissions, "projects", "edit") }))
        throw new ApiError(403, STAFF_REGISTER_ACTIVATION_DENIED);
      await assertFacilityLink(ctx.organizationId, { facilityId: data.facilityId, customerId: data.customerId, previousFacilityId: current.facilityId });
      fields.workSite = (await placeSourceText(ctx.organizationId, { facilityId: data.facilityId, previousFacilityId: current.facilityId, current: fields.workSite })) ?? fields.workSite;
      if (current.archivedAt) throw new ApiError(409, "Återställ projektet innan du redigerar det.");
      const frameChanged = current.startDate !== data.startDate || current.dueDate !== data.dueDate;
      // Only the project's responsible member or a company admin moves the frame (decision 5).
      if (frameChanged && !canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: current.responsibleUserId, canEditProjects: hasWorkflowPermission(ctx.workflowPermissions, "projects", "edit") }))
        throw new ApiError(403, "Bara projektansvarig eller en företagsadministratör kan ändra projektets tidsram.");
      const timeBudgetMinutes = data.timeBudgetMinutes ?? current.timeBudgetMinutes;
      // "Flytta allt lika mycket" (decision 5): open tasks' dates and active planning the user may edit move with
      // the frame; planning without edit rights is left and reported.
      const shiftDays = frameChanged ? data.shiftDays : 0;
      // Kundbyte (2026-10-10): the same rule as the work order's customer – jobs with the old customer move only on the
      // person's explicit choice, and completed work never changes customer (409 with the choice, see the catch below).
      const customerMove = await planProjectCustomerChange(ctx, { projectId: current.id, fromCustomerId: current.customerId, toCustomerId: data.customerId, toFacilityId: data.facilityId, move: data.customerChange === "move_jobs" });
      const shifted = shiftDays ? await shiftProjectWork(ctx, current.id, shiftDays) : null;
      const summary = current.timeBudgetMinutes !== timeBudgetMinutes ? `Projektets tidsbudget ändrades till ${timeBudgetMinutes} minuter`
        : customerMove.summary ? customerMove.summary
        : frameChanged ? `Projektets tidsram ändrades till ${data.startDate || "–"} – ${data.dueDate || "–"}${shifted ? `; ${shifted.tasks} uppgifter och ${shifted.activities} planeringar flyttades ${shiftDays} dagar${shifted.skippedTasks ? `, ${shifted.skippedTasks} ${shifted.skippedTasks === 1 ? "uppgift" : "uppgifter"} utan redigeringsrätt flyttades inte` : ""}${shifted.skipped ? `, ${shifted.skipped} planeringar utan redigeringsrätt flyttades inte` : ""}${shifted.kept ? `; ${shifted.kept} ${shifted.kept === 1 ? "arbetsorder" : "arbetsordrar"} med egen period behöll sina datum` : ""}` : ""}` : "Projektets grunduppgifter uppdaterades";
      await prisma.$transaction([
        prisma.project.update({ where: { id: current.id }, data: {
          name: data.name,
          description: data.description,
          startDate: data.startDate,
          ...fields,
          dueDate: data.dueDate,
          taskTypes: data.taskTypes,
          workMoments: data.workMoments,
          ...(data.staffRegister ? { staffRegister: json(data.staffRegister) } : {}),
          customerId: data.customerId,
          responsibleUserId: data.responsibleUserId,
          responsibleName: data.responsibleName,
          timeBudgetMinutes,
          updatedBy: ctx.user.id,
        } }),
        ...(data.customerId ? projectJobMoveWrites(prisma, ctx.organizationId, data.customerId, customerMove.moves) : []),
        prisma.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: current.id, kind: current.timeBudgetMinutes !== timeBudgetMinutes ? "BUDGET_UPDATED" : "UPDATED", summary, actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } }),
      ]);
      return NextResponse.json({ id: data.id, shifted });
    }
    if (data.customerId) await requireCustomersOrOwn(ctx, data.customerId);
    // A new project starts without Workflow's register unless an admin, or the creator as its responsible, chooses it.
    if (data.staffRegister && staffRegisterActivationChange(EMPTY_STAFF_REGISTER, data.staffRegister)) requireModule(ctx, "staff_register");
    if (data.staffRegister && staffRegisterActivationChange(EMPTY_STAFF_REGISTER, data.staffRegister) && !canSwitchStaffRegister({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: data.responsibleUserId, canEditProjects: true }))
      throw new ApiError(403, STAFF_REGISTER_ACTIVATION_DENIED);
    await assertFacilityLink(ctx.organizationId, { facilityId: data.facilityId, customerId: data.customerId });
    Object.assign(fields, projectCustomerFields({ customer, client: fields.client, contactPerson: fields.contactPerson }));
    fields.workSite = (await placeSourceText(ctx.organizationId, { facilityId: data.facilityId, current: fields.workSite })) ?? fields.workSite;
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
        staffRegister: json(data.staffRegister ?? EMPTY_STAFF_REGISTER),
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
    // Kundbyte (2026-10-10): the form shows the reason and offers "Flytta jobben" / "Behåll kunden".
    if (error instanceof ProjectCustomerChangeRequired) return NextResponse.json({ error: error.message, customerChange: error.change }, { status: 409 });
    return failure(error);
  }
}
