import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { canViewTeam, hasWorkflowPermission } from "@/lib/workflow/permissions";
import { planningFrameError } from "@/lib/workflow/project-frame";
import { canManageProjectLifecycle } from "@/lib/workflow/project-status";
import { plannedActivityAssignments, plannedActivityInputSchema, plannedActivitySummary } from "@/lib/workflow/planned-activity";
import { requireAssignLevels } from "@/lib/self-inspection/levels-server";
import { canReadPlannedActivity, plannedActivityWriteRefusal, workToBookScope } from "@/lib/workflow/planned-activity-access";
import { TO_BOOK_LIMIT, workToBook } from "@/lib/overview/team-followup";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { dormantDay } from "@/lib/maintenance/plan-server";
import { customerTitle } from "@/lib/kfid/customer-name";
import { bookingChangeRefusal, bookedUserIds } from "@/lib/workflow/bookings";
import { bookingNoticeChanges, recordTeamNotice } from "@/lib/workflow/team-notice";
import { bookingClashes, bookingWarningText } from "@/lib/workflow/booking-warning";
import type { Absence, AbsenceType } from "@/lib/workflow/absence";
import { swedishClock, swedishDayKey } from "@/lib/swedish-time";

const identifier = z.string().min(1).max(100);
const json = (value: unknown) => value as Prisma.InputJsonValue;
export const dynamic = "force-dynamic";

type ActivityInput = z.infer<typeof plannedActivityInputSchema>;

function snapshot(activity: {
  title: string; description: string; kind: string; status: string; startsAt: Date; endsAt: Date;
  projectId: string | null; workflowTaskId: string | null;
  assignedToUserId: string | null; assignedToUserIds?: string[]; assignments?: { userId: string; plannedMinutes: number | null; startsAt: string | null; endsAt: string | null }[]; assignedToName: string; version: number; deletedAt: Date | null;
}) {
  return {
    title: activity.title, description: activity.description, kind: activity.kind, status: activity.status,
    startsAt: activity.startsAt.toISOString(), endsAt: activity.endsAt.toISOString(), projectId: activity.projectId,
    workflowTaskId: activity.workflowTaskId, assignedToUserId: activity.assignedToUserId,
    assignedToUserIds: activity.assignedToUserIds ?? (activity.assignedToUserId ? [activity.assignedToUserId] : []),
    assignments: activity.assignments ?? [],
    assignedToName: activity.assignedToName, version: activity.version, deletedAt: activity.deletedAt?.toISOString() ?? null,
  };
}

async function verifyReferences(ctx: Awaited<ReturnType<typeof context>>, data: ActivityInput) {
  // Arbetsordern styr (2026-10-26): a booking is on a work order or a project; a task named here books its work order.
  if (data.workflowTaskId) {
    const named = await prisma.workflowTask.findFirst({ where: { id: data.workflowTaskId, organizationId: ctx.organizationId }, select: { kind: true, workOrderId: true } });
    if (named && named.kind !== "WORK_ORDER" && named.workOrderId) data.workflowTaskId = named.workOrderId;
    // A draft without a work order (2026-10-27) is linked before it is booked.
    if (named && named.kind !== "WORK_ORDER" && !named.workOrderId) throw new ApiError(409, "Koppla uppgiften till en arbetsorder innan du bokar den.");
  }
  const projectSelect = { id: true, archivedAt: true, closedAt: true, startDate: true, dueDate: true, responsibleUserId: true, planningDelegateUserId: true } as const;
  const [project, workflowTask, previous] = await Promise.all([
    data.projectId ? prisma.project.findFirst({ where: { id: data.projectId, organizationId: ctx.organizationId }, select: projectSelect }) : null,
    data.workflowTaskId ? prisma.workflowTask.findFirst({ where: { id: data.workflowTaskId, organizationId: ctx.organizationId }, select: { id: true, kind: true, formArea: true, formTemplateId: true, assignedToUserId: true, projectId: true, status: true, project: { select: projectSelect } } }) : null,
    data.id ? prisma.plannedActivity.findFirst({ where: { id: data.id, organizationId: ctx.organizationId }, select: { startsAt: true, endsAt: true, projectId: true, workflowTaskId: true, assignedToUserId: true, workflowTask: { select: { projectId: true } }, assignments: { select: { member: { select: { userId: true } } } } } }) : null,
  ]);
  if (data.workflowTaskId && !workflowTask) throw new ApiError(400, "Uppgiften hittades inte.");
  // Booking follows the job's own rights (2026-10-10, kartläggningen 5.11): a standalone job needs edit on the job,
  // never the project right; planning in a project needs the project right too. A change is also checked against the
  // booking as it was (requireExistingEditPermission).
  const refusal = plannedActivityWriteRefusal(ctx.workflowPermissions, ctx.admin, { projectId: data.projectId, workflowTask: workflowTask ? { kind: workflowTask.kind, formArea: workflowTask.formArea, projectId: workflowTask.projectId } : null }, !data.id);
  if (refusal) throw new ApiError(403, refusal);
  // The project is the frame (2026-09-26, decision 4). Only new planning, or planning whose time, project or
  // task changes, is checked; existing planning outside the frame stays as it is and is shown as a deviation.
  // Företagets moduler (0.39.0): a booking is tied to no new project while Projekt is off; one it already has stays.
  if (data.projectId && previous?.projectId !== data.projectId) requireModule(ctx, "projects");
  const active = !["COMPLETED", "CANCELED"].includes(data.status);
  const changed = !previous || previous.startsAt.toISOString() !== new Date(data.startsAt).toISOString() || previous.endsAt.toISOString() !== new Date(data.endsAt).toISOString()
    || previous.projectId !== data.projectId || previous.workflowTaskId !== data.workflowTaskId;
  if (active && changed && workflowTask?.status === "COMPLETED")
    throw new ApiError(409, "Uppgiften är slutförd. Återöppna den innan du planerar mer arbete på den.");
  if (active && changed && workflowTask?.status === "CANCELLED")
    throw new ApiError(409, "Jobbet har utgått. Återuppta det innan du planerar arbete på det.");
  const frameProject = project ?? workflowTask?.project ?? null;
  const frameError = active && changed ? planningFrameError(data, frameProject) : null;
  let frameException = "";
  if (frameError) {
    if (!data.frameExceptionReason) throw new ApiError(409, `${frameError} Projektansvarig eller en företagsadministratör kan göra ett undantag med en motivering.`);
    // The project's stand-in (ställföreträdare, 2026-10-09) acts for the responsible person in planning.
    const canEditProjects = hasWorkflowPermission(ctx.workflowPermissions, "projects", "edit");
    if (!canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: frameProject?.responsibleUserId, canEditProjects })
      && !(canEditProjects && frameProject?.planningDelegateUserId === ctx.user.id))
      throw new ApiError(403, "Bara projektansvarig eller en företagsadministratör kan göra undantag från projektets tidsram.");
    frameException = data.frameExceptionReason;
  }
  if (data.projectId && !project) throw new ApiError(400, "Projektet hittades inte.");
  if (project?.archivedAt) throw new ApiError(409, "Återställ projektet innan du planerar arbete i det.");
  // A closed project takes no new or active planning; marking old planning completed or cancelled is still allowed.
  if (project?.closedAt && !["COMPLETED", "CANCELED"].includes(data.status)) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet innan du planerar arbete i det.");
  const linkedProjectId = workflowTask?.projectId ?? null;
  if (data.projectId && linkedProjectId && data.projectId !== linkedProjectId)
    throw new ApiError(400, "Den valda uppgiften tillhör ett annat projekt.");
  const assignmentInputs = plannedActivityAssignments(data);
  const assignedToUserIds = assignmentInputs.map((assignment) => assignment.userId);
  // Others' bookings (2026-10-09): only an admin, the project's responsible person or its stand-in; one's own
  // bookings are always one's own. Both the project before and after a move must allow it.
  await requireBookingRight(ctx, {
    before: previous ? bookedUserIds({ assignedToUserId: previous.assignedToUserId, assignments: previous.assignments.map((item) => ({ userId: item.member.userId })) }) : [],
    after: assignedToUserIds,
    projectIds: [frameProject?.id ?? null, ...(previous ? [previous.projectId ?? previous.workflowTask?.projectId ?? null] : [])],
  });
  const members = assignedToUserIds.length ? await prisma.organizationMember.findMany({
    where: {
      organizationId: ctx.organizationId, isActive: true, userId: { in: assignedToUserIds },
      user: { is: { isActive: true } },
    },
    select: { id: true, userId: true, user: { select: { name: true, email: true } } },
  }) : [];
  if (members.length !== assignedToUserIds.length)
    throw new ApiError(400, "Varje ansvarig måste vara en aktiv medlem i arbetsytan.");
  // Roller med nivå (2026-10-07): a person newly planned on a task must reach its risk class, or work under supervision of the
  // task's responsible person; people already planned there, and a finished or cancelled planning, are left as they are.
  if (workflowTask && active) {
    const already = new Set(previous?.assignments.map((item) => item.member.userId) ?? []);
    await requireAssignLevels(ctx.organizationId, workflowTask, members.filter((member) => !already.has(member.userId)).map((member) => ({ id: member.userId, name: member.user.name || member.user.email })), ctx.user,
      { responsibleId: workflowTask.assignedToUserId });
  }
  const memberByUserId = new Map(members.map((member) => [member.userId, member]));
  const assignments = assignedToUserIds.map((userId) => memberByUserId.get(userId)!);
  const assignedToName = assignments.length
    ? assignments.map((member) => member.user.name || member.user.email).join(", ")
    : data.assignedToName;
  return { assignedToUserIds, assignedToName, assignments, assignmentInputs, workflowTask, frameException, frameProjectId: frameProject?.id ?? null };
}

/**
 * Who may change whose bookings (2026-10-09: "Admin + projektansvarig, men måste kunna lämna över rättigheten om
 * personen är sjuk"). Every project the booking belongs to, before and after the change, must allow it; a booking
 * without a project holding other people is an admin's.
 */
async function requireBookingRight(ctx: Awaited<ReturnType<typeof context>>, input: { before: string[]; after: string[]; projectIds: (string | null)[] }) {
  if (ctx.admin) return;
  if (![...input.before, ...input.after].some((userId) => userId !== ctx.user.id)) return;
  const ids = [...new Set(input.projectIds)];
  const projects = await prisma.project.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids.filter((value): value is string => Boolean(value)) } }, select: { id: true, responsibleUserId: true, planningDelegateUserId: true } });
  for (const projectId of ids) {
    const refusal = bookingChangeRefusal({ admin: ctx.admin, userId: ctx.user.id, before: input.before, after: input.after, project: projectId ? projects.find((project) => project.id === projectId) ?? null : null });
    if (refusal) throw new ApiError(403, refusal);
  }
}

// A frame exception is logged on the planning and on the project (append-only).
async function logFrameException(tx: Prisma.TransactionClient, ctx: Awaited<ReturnType<typeof context>>, references: { frameException: string; frameProjectId: string | null }, title: string) {
  if (!references.frameException || !references.frameProjectId) return;
  await tx.projectEvent.create({ data: { organizationId: ctx.organizationId, projectId: references.frameProjectId, kind: "PLANNING_EXCEPTION", summary: `Planeringen ${title} fick undantag från projektets tidsram: ${references.frameException}`, actorName: ctx.user.name || ctx.user.email, createdBy: ctx.user.id } });
}

const namesOf = (references: { assignments: { userId: string; user: { name: string | null; email: string } }[] }) => new Map(references.assignments.map((member) => [member.userId, member.user.name || member.user.email]));

async function requireExistingEditPermission(ctx: Awaited<ReturnType<typeof context>>, id: string) {
  const current = await prisma.plannedActivity.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
    include: { workflowTask: { select: { kind: true, formArea: true, projectId: true } }, assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } } },
  });
  if (!current) throw new ApiError(404, "Den planerade aktiviteten hittades inte.");
  // The same rule as a new booking, on the booking as it is now (a standalone job's booking: edit on the job).
  const refusal = plannedActivityWriteRefusal(ctx.workflowPermissions, ctx.admin, current, false);
  if (refusal) throw new ApiError(403, refusal);
  return current;
}

/**
 * Teamets notiser (användartest 2026-10-31, F1): the people added to a booking, removed from it, or whose booking moved are told
 * in the bell – never the person who made the change (lib/workflow/team-notice.ts). The recipients are active members: the
 * booking route checked every booked person (verifyReferences); a removed person is told only while still in the company.
 */
async function recordBookingNotices(tx: Prisma.TransactionClient, ctx: Awaited<ReturnType<typeof context>>, input: { activityId: string; before: string[]; after: string[]; active: boolean; timeChanged: boolean }) {
  const change = bookingNoticeChanges({ before: input.before, after: input.after, actorId: ctx.user.id, active: input.active, timeChanged: input.timeChanged });
  const removed = change.removed.length ? (await tx.organizationMember.findMany({ where: { organizationId: ctx.organizationId, isActive: true, userId: { in: change.removed } }, select: { userId: true } })).map((member) => member.userId) : [];
  const base = { organizationId: ctx.organizationId, ref: input.activityId, actorId: ctx.user.id };
  if (change.added.length) await recordTeamNotice(tx, { ...base, type: "BOOKED", userIds: change.added });
  if (change.moved.length) await recordTeamNotice(tx, { ...base, type: "MOVED", userIds: change.moved });
  if (removed.length) await recordTeamNotice(tx, { ...base, type: "UNBOOKED", userIds: removed });
}

/**
 * Varning vid bokning (användartest 2026-10-31, F8): whether a booked person is already booked at the same time or away that day.
 * Advisory – the booking is saved – and only times and days are named (lib/workflow/booking-warning.ts). Bounded reads.
 */
async function bookingWarning(ctx: Awaited<ReturnType<typeof context>>, booking: { id: string; startsAt: string; endsAt: string; status: string; userIds: string[]; names: Map<string, string> }) {
  if (!booking.userIds.length || !["PLANNED", "IN_PROGRESS"].includes(booking.status)) return "";
  const startsAt = new Date(booking.startsAt), endsAt = new Date(booking.endsAt);
  const people = { OR: [{ assignedToUserId: { in: booking.userIds } }, { assignments: { some: { member: { userId: { in: booking.userIds } } } } }] };
  const [others, absences] = await Promise.all([
    prisma.plannedActivity.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, id: { not: booking.id }, status: { in: ["PLANNED", "IN_PROGRESS"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, AND: [people] },
      take: 50, orderBy: { startsAt: "asc" },
      select: { id: true, startsAt: true, endsAt: true, assignedToUserId: true, assignments: { select: { startsAt: true, endsAt: true, member: { select: { userId: true } } } } },
    }),
    prisma.absence.findMany({
      where: { organizationId: ctx.organizationId, userId: { in: booking.userIds }, status: "APPROVED", fromDate: { lte: swedishDayKey(endsAt) }, toDate: { gte: swedishDayKey(startsAt) } },
      take: 50, select: { id: true, userId: true, type: true, fromDate: true, toDate: true, startTime: true, endTime: true },
    }),
  ]);
  const clashes = bookingClashes({
    booking: { id: booking.id, startsAt: booking.startsAt, endsAt: booking.endsAt, userIds: booking.userIds },
    // Each booked person on the other booking, with their own interval when they have one.
    others: others.flatMap((other) => {
      const own = other.assignments.filter((item) => item.startsAt && item.endsAt);
      const shared = { id: other.id, startsAt: other.startsAt.toISOString(), endsAt: other.endsAt.toISOString(), userIds: [...new Set([...(other.assignedToUserId && !own.some((item) => item.member.userId === other.assignedToUserId) ? [other.assignedToUserId] : []), ...other.assignments.filter((item) => !item.startsAt || !item.endsAt).map((item) => item.member.userId)])] };
      return [shared, ...own.map((item) => ({ id: other.id, startsAt: item.startsAt!.toISOString(), endsAt: item.endsAt!.toISOString(), userIds: [item.member.userId] }))];
    }),
    absences: absences.map((row): Absence => ({ id: row.id, userId: row.userId, type: row.type as AbsenceType, note: "", from: row.fromDate, to: row.toDate, hours: row.startTime && row.endTime ? { start: row.startTime, end: row.endTime } : null, createdBy: "", createdAt: "", handled: [], status: "APPROVED" })),
    swedishDay: (iso) => swedishDayKey(new Date(iso)), swedishClock: (iso) => swedishClock(new Date(iso)),
  });
  return bookingWarningText(clashes, (userId) => booking.names.get(userId) ?? "Personen");
}

/**
 * Att boka (2026-11-02): the work orders that await their first booking (awaitsBooking, lib/overview/team-followup.ts) and that
 * this person may book, read in the database with the same conditions and bounded. A booking counts whoever it is for, and whether or
 * not the person may read it: only the yes or no is used, and only for jobs they already read. The server still judges each booking.
 */
async function loadWorkToBook(ctx: Awaited<ReturnType<typeof context>>) {
  const scope = workToBookScope(ctx.workflowPermissions, ctx.admin, canViewTeam(ctx));
  if (!scope.any || !organizationModuleOn(ctx.organization, "planning")) return { total: 0, rows: [] };
  const today = swedishDayKey(new Date());
  const inProjects = scope.inProjects && organizationModuleOn(ctx.organization, "projects");
  const where: Prisma.WorkflowTaskWhereInput = {
    organizationId: ctx.organizationId, kind: "WORK_ORDER", status: "PLANNED", progress: 0, startedAt: null, roundScheduleId: null,
    plannedActivities: { none: { deletedAt: null, status: { not: "CANCELED" } } },
    NOT: { maintenancePlanId: { not: null }, maintenanceActivatedAt: null, maintenanceDue: { gt: dormantDay(ctx.organization, today) } },
    AND: [
      { OR: [{ plannedStartDate: { not: "" } }, { dueDate: { not: "" } }] },
      { OR: [{ dueDate: "" }, { dueDate: { gte: today } }] },
      inProjects ? { OR: [{ projectId: null }, { project: { is: { archivedAt: null, closedAt: null } } }] } : { projectId: null },
      ...(scope.everyone ? [] : [{ OR: [
        { assignedToUserId: ctx.user.id }, { assignedToUserId: null, createdBy: ctx.user.id },
        ...(inProjects ? [{ project: { is: { OR: [{ responsibleUserId: ctx.user.id }, { planningDelegateUserId: ctx.user.id }] } } }] : []),
      ] }]),
    ],
  };
  // The list is soonest first by Start, else Klart senast. A job with no Start sorts by its Klart senast, so each kind takes its own first
  // rows and workToBook keeps the first of them all: no job is left out because another has an empty Start.
  const select = { id: true, title: true, status: true, plannedStartDate: true, dueDate: true, assignedToUserId: true, assignedToName: true, projectId: true, project: { select: { name: true } }, customer: { select: { name: true, company: true, customerType: true } } } satisfies Prisma.WorkflowTaskSelect;
  const [total, withStart, withoutStart] = await Promise.all([
    prisma.workflowTask.count({ where }),
    prisma.workflowTask.findMany({ where: { AND: [where, { plannedStartDate: { not: "" } }] }, take: TO_BOOK_LIMIT, orderBy: [{ plannedStartDate: "asc" }, { dueDate: "asc" }, { id: "asc" }], select }),
    prisma.workflowTask.findMany({ where: { AND: [where, { plannedStartDate: "" }] }, take: TO_BOOK_LIMIT, orderBy: [{ dueDate: "asc" }, { id: "asc" }], select }),
  ]);
  const { rows } = workToBook({ today, workOrders: [...withStart, ...withoutStart].map(({ project, customer, ...order }) => ({ ...order, booked: false, projectName: project?.name ?? "", customerName: customer ? customer.customerType === "PRIVATE" ? customer.name : customerTitle(customer) : "" })) });
  return { total, rows: rows.slice(0, TO_BOOK_LIMIT) };
}

/** Deleting a booking that holds other people needs the same right as changing it. */
async function requireDeleteRight(ctx: Awaited<ReturnType<typeof context>>, current: Awaited<ReturnType<typeof requireExistingEditPermission>>) {
  await requireBookingRight(ctx, {
    before: bookedUserIds({ assignedToUserId: current.assignedToUserId, assignments: current.assignments.map((item) => ({ userId: item.member.userId })) }),
    after: [], projectIds: [current.projectId ?? current.workflowTask?.projectId ?? null],
  });
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
    if (params.get("toBook") === "1") return NextResponse.json(await loadWorkToBook(ctx));
    // Planning's totals over every readable activity, as numbers only (quality check 2026-10-05, F5): the page reads
    // the full activities for the period it shows, and these keep the job filter the same as when every activity was sent.
    if (params.get("summary") === "1") {
      const light = await prisma.plannedActivity.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null },
        select: { status: true, projectId: true, workflowTaskId: true, workflowTask: { select: { kind: true, formArea: true, status: true, projectId: true } } },
      });
      const readable = light.filter((activity) => canReadPlannedActivity(ctx.workflowPermissions, ctx.admin, activity));
      return NextResponse.json({
        total: readable.length,
        inProgress: readable.filter((activity) => activity.status === "IN_PROGRESS").length,
        taskIds: [...new Set(readable.flatMap((activity) => activity.workflowTaskId ? [activity.workflowTaskId] : []))],
      });
    }
    // One project's planning (the project view): the activities on the project or its tasks, plus everyone's activities
    // overlapping the project's frame and those activities, for the advisory clash check. Not the whole plan.
    const forProject = params.get("forProject") ? identifier.parse(params.get("forProject")) : null;
    let projectWhere: Prisma.PlannedActivityWhereInput | null = null;
    if (forProject) {
      const project = await prisma.project.findFirst({ where: { id: forProject, organizationId: ctx.organizationId }, select: { startDate: true, dueDate: true } });
      if (!project) return NextResponse.json({ activities: [] });
      const linked: Prisma.PlannedActivityWhereInput = { OR: [{ projectId: forProject }, { workflowTask: { is: { projectId: forProject } } }] };
      const span = await prisma.plannedActivity.aggregate({ where: { organizationId: ctx.organizationId, deletedAt: null, AND: [linked] }, _min: { startsAt: true }, _max: { endsAt: true } });
      const starts = [span._min.startsAt, day(project.startDate || null, false)].filter((value): value is Date => Boolean(value));
      const ends = [span._max.endsAt, day(project.dueDate || null, true)].filter((value): value is Date => Boolean(value));
      const frame = starts.length && ends.length ? { endsAt: { gte: new Date(Math.min(...starts.map(Number))) }, startsAt: { lte: new Date(Math.max(...ends.map(Number))) } } : null;
      projectWhere = frame ? { OR: [linked, frame] } : linked;
    }
    // One activity by id (the delete tool reads its version without reading the whole plan).
    const onlyId = params.get("id") ? identifier.parse(params.get("id")) : null;
    // One job's bookings (the "Bokad:" line on the job's page, steg 1 2026-10-09); with upcoming=1 only those not yet ended.
    const forTask = params.get("forTask") ? identifier.parse(params.get("forTask")) : null;
    const upcomingOnly = forTask && params.get("upcoming") === "1" ? { endsAt: { gt: new Date() } } : {};
    const activities = await prisma.plannedActivity.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, ...(onlyId ? { id: onlyId } : {}), ...(forTask ? { workflowTaskId: forTask, ...upcomingOnly } : {}), ...(windowFrom ? { endsAt: { gte: windowFrom } } : {}), ...(windowTo ? { startsAt: { lte: windowTo } } : {}), ...(projectWhere ? { AND: [projectWhere] } : {}) },
      orderBy: { startsAt: "asc" },
      include: {
        project: { select: { id: true, name: true, timeBudgetMinutes: true } },
        workflowTask: { select: { id: true, title: true, kind: true, formArea: true, projectId: true, status: true } },
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
    requireModule(ctx, "planning");
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("save"), activity: plannedActivityInputSchema }),
      z.object({ action: z.literal("delete"), id: identifier, version: z.number().int().positive() }),
    ]).parse(await body(request));
    const actorName = ctx.user.name || ctx.user.email;

    if (input.action === "delete") {
      const current = await requireExistingEditPermission(ctx, input.id);
      await requireDeleteRight(ctx, current);
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
        await recordBookingNotices(tx, ctx, { activityId: current.id, before: bookedUserIds({ assignedToUserId: current.assignedToUserId, assignments: current.assignments.map((item) => ({ userId: item.member.userId })) }), after: [], active: false, timeChanged: false });
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
        workflowTaskId: data.workflowTaskId, assignedToUserId: references.assignedToUserIds[0] ?? null,
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
        await recordBookingNotices(tx, ctx, { activityId: current.id, before: bookedUserIds({ assignedToUserId: current.assignedToUserId, assignments: current.assignments.map((item) => ({ userId: item.member.userId })) }), after: references.assignedToUserIds,
          active: ["PLANNED", "IN_PROGRESS"].includes(data.status), timeChanged: current.startsAt.getTime() !== values.startsAt.getTime() || current.endsAt.getTime() !== values.endsAt.getTime() });
      });
      const warning = await bookingWarning(ctx, { id: current.id, startsAt: values.startsAt.toISOString(), endsAt: values.endsAt.toISOString(), status: data.status, userIds: references.assignedToUserIds, names: namesOf(references) });
      return NextResponse.json({ id: current.id, version: current.version + 1, ...(warning ? { warning } : {}) });
    }

    const created = await prisma.$transaction(async (tx) => {
      const activity = await tx.plannedActivity.create({
        data: {
          organizationId: ctx.organizationId, title: data.title, description: data.description, kind: data.kind, status: data.status,
          startsAt: new Date(data.startsAt), endsAt: new Date(data.endsAt), projectId: data.projectId,
          workflowTaskId: data.workflowTaskId, assignedToUserId: references.assignedToUserIds[0] ?? null,
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
      await recordBookingNotices(tx, ctx, { activityId: activity.id, before: [], after: references.assignedToUserIds, active: ["PLANNED", "IN_PROGRESS"].includes(data.status), timeChanged: false });
      await tx.plannedActivityEvent.create({ data: { organizationId: ctx.organizationId, plannedActivityId: activity.id, kind: "CREATED", summary: `${plannedActivitySummary("CREATED", activity.title)}${references.frameException ? ` (undantag från projektets tidsram: ${references.frameException})` : ""}`, snapshot: json(snapshot({ ...activity, assignedToUserIds: references.assignedToUserIds, assignments: references.assignmentInputs })), actorName, createdBy: ctx.user.id } });
      return activity;
    });
    const warning = await bookingWarning(ctx, { id: created.id, startsAt: created.startsAt.toISOString(), endsAt: created.endsAt.toISOString(), status: data.status, userIds: references.assignedToUserIds, names: namesOf(references) });
    return NextResponse.json({ id: created.id, version: created.version, ...(warning ? { warning } : {}) });
  } catch (error) {
    return failure(error);
  }
}
