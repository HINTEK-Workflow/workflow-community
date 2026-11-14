import { addDays } from "@/lib/workflow/schedule";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule, type Context } from "@/lib/kfid/server";
import { callRoute, ToolError } from "@/lib/tools/call-route";
import { addSwedishDays, fromSwedishDateInput, swedishClock, swedishDayKey } from "@/lib/swedish-time";
import { plannedMinutesForUserInWindow, type CapacityActivity } from "@/lib/workflow/capacity-summary";
import { memberMayReadJob } from "@/lib/workflow/assignee-access";
import { canViewTeam, hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import {
  absenceInputSchema, absenceLabel, absenceLocked, absentShare, affectedWork, mayRegisterAbsence, suggestReplacements,
  type Absence, type AbsenceSource, type AbsenceStatus, type AbsenceType,
} from "@/lib/workflow/absence";
import { sourceSystemLabel } from "@/lib/payroll/codes";
import { memberApproves } from "@/lib/workflow/time-periods-server";
import { ABSENCE_REMOVAL_CONFIRM, absenceExtra, absenceNoticeRecipients, absenceRemovalNeedsConfirm, recordTeamNotice } from "@/lib/workflow/team-notice";

// Re-planning runs the usual tools and routes (the person's own rights apply); loaded only when someone re-plans.
const runTool = async (...args: Parameters<typeof import("@/lib/tools/registry").runTool>) => (await import("@/lib/tools/registry")).runTool(...args);
const planningPost = async () => (await import("@/app/api/planned-activities/route")).POST;
import type { TeamAffectedRow, TeamTabData } from "@/lib/overview/team-server";
import type { MeTabData } from "@/lib/overview/me";
import { expectedWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";

/**
 * Frånvaro med serverlagring (2026-10-29): GET and POST /api/absence with the rules of lib/workflow/absence.ts – the same as the
 * demo (features/demo/demo-absence.ts). Every call checks the session, the company and membership, Cloud storage, write access
 * and Origin on changes. Everyone registers their own absence; admins and the Teamet right anyone's; colleagues see only
 * "Frånvarande". An absence imported from a payroll or HR system is locked here unless the company's setting allows changes.
 * Re-planning goes through the planning and task routes, so the person's own rights decide what can be moved. The history
 * (AbsenceEvent) never holds the reason.
 */
const MAX_ROWS = 2000;
type Row = { id: string; userId: string; type: string; note: string; fromDate: string; toDate: string; startTime: string | null; endTime: string | null; status: string; source: string; externalSystem: string | null; handled: string[]; createdById: string; createdAt: Date };
const SELECT = { id: true, userId: true, type: true, note: true, fromDate: true, toDate: true, startTime: true, endTime: true, status: true, source: true, externalSystem: true, handled: true, createdById: true, createdAt: true } as const;

export const absenceOf = (row: Row): Absence => ({
  id: row.id, userId: row.userId, type: row.type as AbsenceType, note: row.note, from: row.fromDate, to: row.toDate,
  hours: row.startTime && row.endTime ? { start: row.startTime, end: row.endTime } : null, createdBy: row.createdById, createdAt: row.createdAt.toISOString(),
  handled: row.handled, status: row.status as AbsenceStatus, source: row.source as AbsenceSource, externalSystem: row.externalSystem,
});

/** The company's absences that end on or after a day (bounded), optionally for some people. */
export async function loadAbsences(organizationId: string, fromDay: string, options: { userIds?: string[]; toDay?: string } = {}) {
  const rows = await prisma.absence.findMany({
    where: { organizationId, toDate: { gte: fromDay }, ...(options.toDay ? { fromDate: { lte: options.toDay } } : {}), ...(options.userIds ? { userId: { in: options.userIds } } : {}) },
    orderBy: [{ fromDate: "asc" }, { id: "asc" }], take: MAX_ROWS, select: SELECT,
  });
  return rows.map(absenceOf);
}

/** The company's setting for imported absence, and the name of its system. */
export async function absenceSettings(organizationId: string) {
  const row = await prisma.payrollIntegration.findUnique({ where: { organizationId }, select: { importedEditable: true, systemName: true } });
  return { importedEditable: row?.importedEditable ?? false, systemName: row?.systemName ?? "" };
}

export const viewerOf = (ctx: Context) => ({ id: ctx.user.id, admin: ctx.admin, team: canViewTeam(ctx) });
const sees = (viewer: ReturnType<typeof viewerOf>, userId: string) => viewer.admin || viewer.team || viewer.id === userId;

async function activeMembers(organizationId: string) {
  return prisma.organizationMember.findMany({
    where: { organizationId, isActive: true, user: { is: { isActive: true } } }, orderBy: { user: { name: "asc" } }, take: 200,
    select: { userId: true, role: true, workflowPermissions: true, weeklyWorkMinutes: true, noFixedHours: true, user: { select: { name: true, email: true } } },
  });
}
type Member = Awaited<ReturnType<typeof activeMembers>>[number];
const nameOf = (members: readonly Member[], id: string) => { const member = members.find((item) => item.userId === id); return member ? member.user.name || member.user.email : "Tidigare medarbetare"; };
const taskHref = (id: string, kind: string) => `/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=${kind}`;

/** The absences as this viewer may see them: the type only for themselves and the Teamet right; locked when imported. */
export function absenceView(viewer: ReturnType<typeof viewerOf>, absences: readonly Absence[], members: readonly Member[], settings: { importedEditable: boolean; systemName: string }) {
  return absences.map((absence) => {
    const own = sees(viewer, absence.userId);
    return {
      id: absence.id, userId: absence.userId, name: nameOf(members, absence.userId), label: absenceLabel(viewer, absence), from: absence.from, to: absence.to, hours: absence.hours,
      type: own ? absence.type : null, note: own ? absence.note : "", status: absence.status ?? "APPROVED",
      mine: absence.userId === viewer.id, byOther: Boolean(absence.createdBy) && absence.createdBy !== absence.userId, locked: absenceLocked(absence, settings.importedEditable),
      sourceLabel: (absence.source ?? "MANUAL") === "MANUAL" ? "" : `Från ${sourceSystemLabel(absence.externalSystem, settings.systemName)}`,
      canEdit: mayRegisterAbsence(viewer, absence.userId) && !absenceLocked(absence, settings.importedEditable),
    };
  }).sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name, "sv"));
}

/**
 * The planned work the company's approved absences touch from today on, with who could take each over (Teamet only): the
 * people's bookings (only those the viewer may read) and their open work orders.
 */
export async function loadAffected(ctx: Context, now: Date, absences: readonly Absence[], members: readonly Member[]): Promise<TeamAffectedRow[]> {
  const today = swedishDayKey(now);
  const relevant = absences.filter((absence) => absence.to >= today);
  if (!relevant.length) return [];
  const last = relevant.reduce((max, absence) => (absence.to > max ? absence.to : max), today);
  const startsAt = fromSwedishDateInput(today)!; const endsAt = addSwedishDays(fromSwedishDateInput(last)!, 1);
  const userIds = [...new Set(relevant.map((absence) => absence.userId))];
  const [activities, tasks] = await Promise.all([
    prisma.plannedActivity.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, status: { in: ["PLANNED", "IN_PROGRESS"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      take: 3000,
      select: { id: true, title: true, status: true, startsAt: true, endsAt: true, projectId: true, assignedToUserId: true, workflowTaskId: true,
        workflowTask: { select: { id: true, kind: true, formArea: true, title: true, status: true, projectId: true } },
        assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } } },
    }),
    prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId, kind: "WORK_ORDER", assignedToUserId: { in: userIds }, status: { notIn: ["COMPLETED", "CANCELLED"] },
        OR: [{ plannedStartDate: { gte: today, lte: last } }, { dueDate: { gte: today, lte: last } }] },
      take: 1000, select: { id: true, title: true, status: true, assignedToUserId: true, dueDate: true, plannedStartDate: true },
    }),
  ]);
  const readable = activities.filter((activity) => canReadPlannedActivity(ctx.workflowPermissions, ctx.admin, activity));
  const bookings = readable.map((activity) => ({
    id: activity.id, title: activity.title || activity.workflowTask?.title || "Bokning", startsAt: activity.startsAt.toISOString(), endsAt: activity.endsAt.toISOString(),
    userIds: [...new Set([...activity.assignments.map((item) => item.member.userId), ...(activity.assignedToUserId ? [activity.assignedToUserId] : [])])], status: activity.status,
    href: activity.workflowTask ? taskHref(activity.workflowTask.id, activity.workflowTask.kind) : "/?view=planning", workOrderId: activity.workflowTaskId,
  }));
  const mayReadOrders = ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "read");
  const workOrders = mayReadOrders ? tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, assignedToUserId: task.assignedToUserId, dueDate: task.dueDate ?? "", plannedStartDate: task.plannedStartDate ?? "", href: taskHref(task.id, "WORK_ORDER") })) : [];
  const rows = affectedWork({ absences: relevant, bookings, workOrders, today, swedishDay: (iso) => swedishDayKey(new Date(iso)), swedishClock: (iso) => swedishClock(new Date(iso)) });
  const capacity: CapacityActivity[] = activities.map((activity) => ({
    startsAt: activity.startsAt.toISOString(), endsAt: activity.endsAt.toISOString(), assignedToUserId: activity.assignedToUserId,
    assignments: activity.assignments.map((item) => ({ userId: item.member.userId, plannedMinutes: item.plannedMinutes, startsAt: item.startsAt?.toISOString() ?? null, endsAt: item.endsAt?.toISOString() ?? null })),
    status: activity.status as CapacityActivity["status"], projectId: activity.projectId, workflowTaskId: activity.workflowTaskId, workflowTask: activity.workflowTask ? { status: activity.workflowTask.status } : null,
  }));
  const viewer = viewerOf(ctx);
  return rows.map((row) => {
    const absence = relevant.find((item) => item.id === row.absenceId)!;
    const activity = row.kind === "booking" ? activities.find((item) => item.id === row.id) : undefined;
    const subject: WorkflowPermissionSubject | null = row.kind === "work-order" ? "work-order" : activity?.workflowTask ? workflowSubjectForTask(activity.workflowTask.kind, activity.workflowTask.formArea) : null;
    const dayStart = fromSwedishDateInput(row.day)!;
    const people = members.map((member) => {
      const weekly = member.weeklyWorkMinutes ?? ctx.organization.weeklyWorkMinutes;
      const planned = plannedMinutesForUserInWindow({ activities: capacity, userId: member.userId, startsAt: dayStart, endsAt: addSwedishDays(dayStart, 1), weeklyWorkMinutes: weekly });
      const away = absentShare(absences, member.userId, row.day, weekly / 5);
      // Ingen fast arbetstid (2026-10-30): no capacity, so never suggested as free.
      const day = expectedWeeklyWorkMinutes(ctx.organization.weeklyWorkMinutes, member) / 5;
      return { id: member.userId, name: member.user.name || member.user.email, freeMinutes: Math.max(0, Math.round(day * (1 - away) - planned)), away: away >= 1,
        mayDo: subject ? memberMayReadJob({ role: member.role, workflowPermissions: member.workflowPermissions }, subject) : true };
    });
    return { ...row, personName: nameOf(members, row.userId), label: absenceLabel(viewer, absence), suggestions: suggestReplacements(people, row.userId).map(({ id, name, freeMinutes }) => ({ id, name, freeMinutes })) };
  });
}

/** Jag: my own absence from today on, and that I may register it (Cloud only; null for local storage). */
export async function loadMeAbsence(ctx: Context, now: Date): Promise<MeTabData["absence"]> {
  if (ctx.organization.storageMode !== "HINTEK_CLOUD") return null;
  const today = swedishDayKey(now);
  const [absences, settings] = await Promise.all([loadAbsences(ctx.organizationId, today, { userIds: [ctx.user.id] }), absenceSettings(ctx.organizationId)]);
  const viewer = viewerOf(ctx);
  return { userId: ctx.user.id, mine: absenceView(viewer, absences, [], settings).map(({ id, label, from, to, hours, type, note, locked, sourceLabel, status, byOther }) => ({ id, label, from, to, hours, type, note, locked, sourceLabel, status, byOther })) };
}

/** Teamet: who is away today (approved), the work it touches, and that this viewer registers for others. */
export async function loadTeamAbsence(ctx: Context, now: Date): Promise<{ section: NonNullable<TeamTabData["absence"]>; absences: Absence[] }> {
  const today = swedishDayKey(now);
  // From two weeks back (2026-11-02): an absence earlier this week lowers the week's figure, and the checked days of unreported time.
  const [absences, members] = await Promise.all([loadAbsences(ctx.organizationId, addDays(today, -14)), activeMembers(ctx.organizationId)]);
  const viewer = viewerOf(ctx);
  const approved = absences.filter((absence) => (absence.status ?? "APPROVED") === "APPROVED");
  const affected = await loadAffected(ctx, now, approved, members);
  return {
    absences: approved,
    section: {
      canRegister: viewer.team || viewer.admin,
      today: approved.filter((absence) => absence.from <= today && absence.to >= today).map((absence) => ({ userId: absence.userId, name: nameOf(members, absence.userId), label: absenceLabel(viewer, absence), to: absence.to })),
      affected,
    },
  };
}

const handleSchema = z.object({ action: z.literal("handle"), key: z.string().min(1).max(200), choice: z.enum(["reassign", "postpone", "wait"]), toUserId: z.string().max(60).optional() });
/** `confirm`: the person removes an absence someone else registered for them, and has said yes (användartest 2026-10-31, F7). */
const deleteSchema = z.object({ action: z.literal("delete"), id: z.string().min(1).max(60), confirm: z.boolean().optional() });

/**
 * Teamets notiser (användartest 2026-10-31, F7): an absence someone else saved or removed is told to the person; one the person
 * registered themselves is told to those who plan (admins and the Teamet right), with how many planned jobs it touches; a
 * removal of an absence someone else registered is told to that someone. Only the dates, never the reason. A notice is a
 * courtesy: a failure to write it never undoes the absence.
 */
async function tellAbsence(ctx: Context, input: { absence: Absence; createdById: string | null; removed: boolean; affected: number }) {
  try {
    const members = await activeMembers(ctx.organizationId);
    const active = new Set(members.map((member) => member.userId));
    const groups = absenceNoticeRecipients({ userId: input.absence.userId, actorId: ctx.user.id, createdById: input.createdById, removed: input.removed,
      planners: members.filter(memberApproves).map((member) => member.userId) });
    const at = new Date();
    for (const group of groups)
      await recordTeamNotice(prisma, { organizationId: ctx.organizationId, type: group.type, ref: input.absence.id, actorId: ctx.user.id, userIds: group.userIds.filter((id) => active.has(id)), at, extra: absenceExtra(input.absence, input.affected) });
  } catch (error) {
    console.error("Frånvaronotisen kunde inte sparas", error instanceof Error ? error.message : error);
  }
}
const saveSchema = z.object({ action: z.literal("save"), absence: z.unknown() });
const describe = (absence: { from: string; to: string; hours: { start: string; end: string } | null }) => `${absence.from === absence.to ? absence.from : `${absence.from}–${absence.to}`}${absence.hours ? ` ${absence.hours.start}–${absence.hours.end}` : ""}`;

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const viewer = viewerOf(ctx);
    const from = new URL(request.url).searchParams.get("from");
    const day = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : swedishDayKey(new Date());
    const [absences, members, settings] = await Promise.all([loadAbsences(ctx.organizationId, day), activeMembers(ctx.organizationId), absenceSettings(ctx.organizationId)]);
    const others = viewer.team || viewer.admin;
    return NextResponse.json({
      absences: absenceView(viewer, absences.filter((absence) => (absence.status ?? "APPROVED") === "APPROVED" || sees(viewer, absence.userId)), members, settings),
      canRegisterOthers: others, me: ctx.user.id,
      people: (others ? members : members.filter((member) => member.userId === ctx.user.id)).map((member) => ({ id: member.userId, name: member.user.name || member.user.email })),
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
    requireModule(ctx, "time");
    const viewer = viewerOf(ctx);
    const raw = await body(request) as { action?: string };
    const settings = await absenceSettings(ctx.organizationId);
    if (raw.action === "delete") {
      const input = deleteSchema.parse(raw);
      const current = await prisma.absence.findFirst({ where: { id: input.id, organizationId: ctx.organizationId }, select: SELECT });
      if (!current) throw new ApiError(404, "Frånvaron finns inte längre.");
      if (!mayRegisterAbsence(viewer, current.userId)) throw new ApiError(403, "Du får bara ta bort din egen frånvaro.");
      if (absenceLocked(absenceOf(current), settings.importedEditable)) throw new ApiError(409, `Frånvaron kommer från ${sourceSystemLabel(current.externalSystem, settings.systemName)} och ändras där.`);
      if (absenceRemovalNeedsConfirm({ actorId: ctx.user.id, userId: current.userId, createdById: current.createdById, planner: viewer.team || viewer.admin }) && !input.confirm) throw new ApiError(409, ABSENCE_REMOVAL_CONFIRM);
      await prisma.$transaction([
        prisma.absence.delete({ where: { id: current.id } }),
        prisma.absenceEvent.create({ data: { organizationId: ctx.organizationId, absenceId: current.id, userId: current.userId, actorId: ctx.user.id, action: "deleted", detail: describe(absenceOf(current)) } }),
      ]);
      await tellAbsence(ctx, { absence: absenceOf(current), createdById: current.createdById, removed: true, affected: 0 });
      return NextResponse.json({ ok: true });
    }
    if (raw.action === "handle") {
      const input = handleSchema.parse(raw);
      if (!viewer.team && !viewer.admin) throw new ApiError(403, "Det är arbetsledaren som planerar om.");
      return NextResponse.json(await handle(ctx, input));
    }
    const { absence: candidate } = saveSchema.parse(raw);
    const input = absenceInputSchema.parse(candidate);
    if (!mayRegisterAbsence(viewer, input.userId)) throw new ApiError(403, "Du får bara lägga in din egen frånvaro.");
    const member = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: input.userId } }, select: { isActive: true } });
    if (!member?.isActive) throw new ApiError(400, "Personen finns inte i företaget.");
    const current = input.id ? await prisma.absence.findFirst({ where: { id: input.id, organizationId: ctx.organizationId }, select: SELECT }) : null;
    if (input.id && !current) throw new ApiError(404, "Frånvaron finns inte längre.");
    if (current && !mayRegisterAbsence(viewer, current.userId)) throw new ApiError(403, "Du får bara ändra din egen frånvaro.");
    if (current && absenceLocked(absenceOf(current), settings.importedEditable)) throw new ApiError(409, `Frånvaron kommer från ${sourceSystemLabel(current.externalSystem, settings.systemName)} och ändras där.`);
    const overlap = await prisma.absence.findFirst({
      where: { organizationId: ctx.organizationId, userId: input.userId, status: "APPROVED", fromDate: { lte: input.to }, toDate: { gte: input.from }, ...(current ? { id: { not: current.id } } : {}) },
      select: { fromDate: true, toDate: true, startTime: true, endTime: true },
    });
    // Two absences of some hours the same day may sit side by side; any other overlap is refused.
    const clash = overlap && !(input.hours && overlap.startTime && overlap.endTime && overlap.fromDate === input.from && (overlap.endTime <= input.hours.start || overlap.startTime >= input.hours.end));
    if (overlap && clash) throw new ApiError(409, `Det finns redan frånvaro ${overlap.fromDate === overlap.toDate ? overlap.fromDate : `${overlap.fromDate}–${overlap.toDate}`}. Ändra den i stället.`);
    const data = { userId: input.userId, type: input.type, note: input.type === "OTHER" ? input.note : "", fromDate: input.from, toDate: input.to, startTime: input.hours?.start ?? null, endTime: input.hours?.end ?? null, updatedById: ctx.user.id };
    const saved = current
      ? await prisma.absence.update({ where: { id: current.id }, data, select: SELECT })
      : await prisma.absence.create({ data: { ...data, organizationId: ctx.organizationId, createdById: ctx.user.id }, select: SELECT });
    await prisma.absenceEvent.create({ data: { organizationId: ctx.organizationId, absenceId: saved.id, userId: saved.userId, actorId: ctx.user.id, action: current ? "updated" : "created", detail: describe(absenceOf(saved)) } });
    // How much planned work it touches: told to those who re-plan, and in the notice to them when the person registered it.
    let affected = 0;
    if (viewer.team || viewer.admin || saved.userId === ctx.user.id) {
      const members = await activeMembers(ctx.organizationId);
      affected = (await loadAffected(ctx, new Date(), [absenceOf(saved)], members)).length;
    }
    // A change of dates is told as a new absence; a change by the person of their own is told to the planners again.
    await tellAbsence(ctx, { absence: absenceOf(saved), createdById: saved.createdById, removed: false, affected });
    return NextResponse.json({ ok: true, id: saved.id, affected: viewer.team || viewer.admin ? affected : 0 });
  } catch (error) {
    if (error instanceof ToolError) return failure(new ApiError(error.status, error.message));
    return failure(error);
  }
}

/** Planera om: Byt person, Skjut upp to the first day back, or Låt vänta – through the ordinary routes and the person's rights. */
async function handle(ctx: Context, input: z.infer<typeof handleSchema>) {
  const now = new Date();
  const today = swedishDayKey(now);
  const [absences, members] = await Promise.all([loadAbsences(ctx.organizationId, today), activeMembers(ctx.organizationId)]);
  const approved = absences.filter((absence) => (absence.status ?? "APPROVED") === "APPROVED");
  const row = (await loadAffected(ctx, now, approved, members)).find((item) => item.key === input.key);
  if (!row) throw new ApiError(409, "Jobbet påverkas inte längre – läs in sidan igen.");
  const absence = approved.find((item) => item.id === row.absenceId)!;
  if (input.choice === "wait") {
    await prisma.$transaction([
      prisma.absence.update({ where: { id: absence.id }, data: { handled: { push: row.key } } }),
      prisma.absenceEvent.create({ data: { organizationId: ctx.organizationId, absenceId: absence.id, userId: absence.userId, actorId: ctx.user.id, action: "handled", detail: "Låt vänta" } }),
    ]);
    return { ok: true, message: "Jobbet ligger kvar som det är." };
  }
  const to = input.choice === "reassign" ? members.find((member) => member.userId === input.toUserId) : null;
  if (input.choice === "reassign" && !to) throw new ApiError(400, "Välj vem som tar över.");
  const toName = to ? to.user.name || to.user.email : "";
  if (row.kind === "work-order") {
    if (input.choice === "reassign") { await runTool("update_task", { taskId: row.id, assignedToUserId: to!.userId }); return { ok: true, message: `${toName} är ansvarig för ${row.title}.` }; }
    const task = await prisma.workflowTask.findFirst({ where: { id: row.id, organizationId: ctx.organizationId }, select: { plannedStartDate: true, dueDate: true } });
    if (!task) throw new ApiError(404, "Arbetsordern finns inte längre.");
    const within = (value: string | null) => Boolean(value && value >= absence.from && value <= absence.to);
    await runTool("update_task", { taskId: row.id, ...(within(task.plannedStartDate) ? { plannedStartDate: row.backOn } : {}), ...(within(task.dueDate) ? { dueDate: row.backOn } : {}) });
    return { ok: true, message: `${row.title} är flyttad till ${row.backOn}.` };
  }
  const activity = await prisma.plannedActivity.findFirst({
    where: { id: row.id, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, version: true, title: true, description: true, kind: true, status: true, startsAt: true, endsAt: true, projectId: true, workflowTaskId: true, assignedToUserId: true,
      assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } } },
  });
  if (!activity) throw new ApiError(404, "Bokningen finns inte längre.");
  const shift = input.choice === "postpone" ? Math.round((Date.parse(`${row.backOn}T12:00:00Z`) - Date.parse(`${swedishDayKey(activity.startsAt)}T12:00:00Z`)) / 86_400_000) : 0;
  const moved = (date: Date | null) => (date ? addSwedishDays(date, shift).toISOString() : null);
  const swap = (userId: string) => (input.choice === "reassign" && userId === row.userId ? to!.userId : userId);
  const assignments = activity.assignments.map((item) => ({ userId: swap(item.member.userId), plannedMinutes: item.plannedMinutes, startsAt: moved(item.startsAt), endsAt: moved(item.endsAt) }));
  const userIds = [...new Set(assignments.map((item) => item.userId))];
  await callRoute(await planningPost(), "POST", "/api/planned-activities", { action: "save", activity: {
    id: activity.id, version: activity.version, title: activity.title, description: activity.description, kind: activity.kind, status: activity.status,
    startsAt: moved(activity.startsAt), endsAt: moved(activity.endsAt), projectId: activity.projectId, workflowTaskId: activity.workflowTaskId,
    assignedToUserId: activity.assignedToUserId ? swap(activity.assignedToUserId) : userIds[0] ?? null, assignedToUserIds: userIds, assignments: assignments.filter((item, index) => assignments.findIndex((other) => other.userId === item.userId) === index), assignedToName: "",
  } });
  // Byt person moves only this booking (användartest 2026-10-31, F1): the work order's responsible stays as it is – changing it
  // is a choice of its own on the work order. The planning route tells the new and the removed person (lib/workflow/team-notice.ts).
  return { ok: true, message: input.choice === "reassign" ? `${toName} har tagit över bokningen ${row.title}.` : `${row.title} är flyttad till ${row.backOn}.` };
}
