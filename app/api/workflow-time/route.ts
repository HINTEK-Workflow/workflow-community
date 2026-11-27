import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess, requireModule, requireWorkflowPermission, type Context } from "@/lib/kfid/server";
import { canViewTeam, hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { assertTimeCorrection, TimeCorrectionError, timeCorrectionReasonSchema, type TimeEntrySnapshot } from "@/lib/workflow/time-correction";
import { clockOfMinutes, weeklyWorkMinutesOverrideSchema, weeklyWorkMinutesSchema, workdaySchema } from "@/lib/workflow/work-schedule";
import { addSwedishDays, fromSwedishDateInput, swedishDayKey } from "@/lib/swedish-time";
import { capacityWeek } from "@/lib/workflow/capacity-summary";
import { timeOwnerFor } from "@/lib/kfid/work-order-link-server";
import { assertNotDormant } from "@/lib/maintenance/plan-server";
import { CLOSED_TASK_STATUSES } from "@/lib/workflow/task-cancel";
import { closeTimeEntries, pauseOtherOwnTimers, timeEntryInOrganization, timeOwnerColumns, timeOwnerSnapshot } from "@/lib/workflow/timer-server";
import { PROJECT_TIME_ENTRY_ONE_OWNER, projectTimeState } from "@/lib/workflow/time-owner";
import { checkedTimeTypeId, loadTimeTypes, moveTimeType, removeTimeType, saveTimeType, timeTypesForMember } from "@/lib/workflow/time-types-server";
import { resolveTimeType, type TimeTypeView } from "@/lib/workflow/time-types";
import { assertTimeOpen } from "@/lib/workflow/time-period-lock";

const id = z.string().min(1).max(100);
/**
 * A time entry is on a work order or a project (Arbetsordern styr, 2026-10-26): `taskId` (a task given here is
 * recorded on its work order, as before) or `projectId` – exactly one.
 */
const entryInput = z.object({
  id: id.optional(),
  taskId: id.optional(),
  projectId: id.optional(),
  // Only an organization admin may register time for another active member.
  userId: id.optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  note: z.string().trim().max(1000).default(""),
  /** Tidstyp (2026-10-29): a type of the company; null = the standard type; left out on a change = keep the entry's type. */
  timeTypeId: id.nullable().optional(),
}).refine((entry) => Boolean(entry.taskId) !== Boolean(entry.projectId), { message: PROJECT_TIME_ENTRY_ONE_OWNER, path: ["taskId"] });
const entrySelect = { id: true, userId: true, startedAt: true, endedAt: true, durationSec: true, note: true, timeTypeId: true, createdAt: true, updatedAt: true } as const;
const json = (value: unknown) => value as Prisma.InputJsonValue;
// Bounds of the Tidrapport read (quality check 2026-10-05, F6).
const TIME_DEFAULT_DAYS = 90;
const TIME_PICKER_LIMIT = 300;
const TIME_ENTRY_CAP = 5000;

export const dynamic = "force-dynamic";

/** What a time entry is registered on: a work order, or a project (kind PROJECT). */
type TimeSource = { id: string; title: string; kind: string; formArea?: string | null; status: string; archived: boolean; project: boolean };
/** The history's picture of an entry; the type by name (the history outlives a renamed or removed type). */
const snapshot = (entry: { startedAt: Date; endedAt: Date | null; durationSec: number; note: string; timeTypeId?: string | null }, source: Pick<TimeSource, "id" | "title" | "project">, types: readonly TimeTypeView[]): TimeEntrySnapshot => {
  const type = types.length ? resolveTimeType(types, entry.timeTypeId) : undefined;
  return { ...timeOwnerSnapshot(source), startedAt: entry.startedAt.toISOString(), endedAt: entry.endedAt?.toISOString() ?? null, durationSec: entry.durationSec, note: entry.note, ...(type ? { timeType: type.name } : {}) };
};
const taskState = (source: TimeSource) => ({ status: source.status, archived: source.archived });
const taskSelect = { id: true, title: true, kind: true, formArea: true, status: true, project: { select: { archivedAt: true } } } as const;
const projectSelect = { id: true, name: true, archivedAt: true, closedAt: true } as const;
type TaskRow = { id: string; title: string; kind: string; formArea?: string | null; status: string; project: { archivedAt: Date | null } | null };
type ProjectRow = { id: string; name: string; archivedAt: Date | null; closedAt: Date | null };
function sourceOf(entry: { task?: TaskRow | null; project?: ProjectRow | null }): TimeSource {
  if (entry.task) return { id: entry.task.id, title: entry.task.title, kind: entry.task.kind, formArea: entry.task.formArea, status: entry.task.status, archived: Boolean(entry.task.project?.archivedAt), project: false };
  if (entry.project) return { id: entry.project.id, title: entry.project.name, kind: "PROJECT", status: projectTimeState(entry.project).status, archived: Boolean(entry.project.archivedAt), project: true };
  throw new ApiError(404, "Arbetsordern eller projektet hittades inte.");
}
/** The right a source needs: the work order's (edit to write), or read on projects for project time (no new right). */
function requireSourceRight(ctx: Context, source: TimeSource, action: "read" | "edit") {
  if (source.project) requireWorkflowPermission(ctx, "projects", "read");
  else requireWorkflowPermission(ctx, workflowSubjectForTask(source.kind, source.formArea), action);
}

function checkCorrection(...args: Parameters<typeof assertTimeCorrection>) {
  try {
    return assertTimeCorrection(...args);
  } catch (error) {
    if (error instanceof TimeCorrectionError) throw new ApiError(error.status, error.message);
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const inOrganization = timeEntryInOrganization(ctx.organizationId);
    const historyFor = new URL(request.url).searchParams.get("history");
    if (historyFor) {
      const entryId = id.parse(historyFor);
      const events = await prisma.workflowTimeEntryEvent.findMany({ where: { organizationId: ctx.organizationId, entryId, ...(ctx.admin ? {} : { userId: ctx.user.id }) }, orderBy: { createdAt: "desc" }, take: 100 });
      return NextResponse.json({ events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const params = new URL(request.url).searchParams;
    // Tidstyper on the settings page: the list (everyone in the company reads it; admins change it).
    if (params.get("types") === "1") return NextResponse.json({ timeTypes: await timeTypesForMember(ctx), canEdit: ctx.admin }, { headers: { "Cache-Control": "private, no-store" } });
    const canRead = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    // Teamets tid is read by admins and team:read (2026-10-28), still only on what the person may read; only
    // admins correct others' time (POST below).
    const team = canViewTeam(ctx);
    // The top bar's running timer (2026-09-26): only the caller's own running entries, bounded and readable – on a
    // work order or, since 2026-10-26, a project.
    if (params.get("running") === "mine") {
      const running = await prisma.workflowTimeEntry.findMany({
        where: { userId: ctx.user.id, endedAt: null, AND: [inOrganization] },
        orderBy: { startedAt: "asc" },
        take: 10,
        select: { id: true, startedAt: true, task: { select: { id: true, title: true, kind: true, formArea: true, project: { select: { name: true } } } }, project: { select: { id: true, name: true } } },
      });
      return NextResponse.json({
        now: new Date().toISOString(),
        running: running.flatMap(({ task, project, ...entry }) => task && canRead(workflowSubjectForTask(task.kind, task.formArea))
          ? [{ entryId: entry.id, taskId: task.id, taskTitle: task.title, kind: task.kind, projectName: task.project?.name ?? null, startedAt: entry.startedAt.toISOString() }]
          : project && canRead("projects") ? [{ entryId: entry.id, taskId: project.id, taskTitle: project.name, kind: "PROJECT", projectId: project.id, projectName: project.name, startedAt: entry.startedAt.toISOString() }] : []),
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    // Planning's capacity panel (2026-09-26: fetch only what is shown): the caller's own finished time in the
    // current Swedish week and the weekly working time, nothing else.
    if (params.get("capacity") === "week") {
      const week = capacityWeek(new Date());
      const [entries, member] = await Promise.all([
        prisma.workflowTimeEntry.findMany({
          where: { userId: ctx.user.id, startedAt: { gte: week.startsAt, lt: week.endsAt }, AND: [inOrganization] },
          select: { startedAt: true, durationSec: true },
        }),
        prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: ctx.user.id } }, select: { weeklyWorkMinutes: true, noFixedHours: true } }),
      ]);
      return NextResponse.json({
        currentUserId: ctx.user.id,
        timeEntries: entries.map((entry) => ({ startedAt: entry.startedAt.toISOString(), durationSec: entry.durationSec })),
        schedule: { organizationWeeklyWorkMinutes: ctx.organization.weeklyWorkMinutes, memberWeeklyWorkMinutes: member.weeklyWorkMinutes, noFixedHours: member.noFixedHours },
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    // Every read is bounded (2026-09-26; quality check 2026-10-05, F6). Own entries come from `ownFrom` (default the
    // last 90 Swedish days; Tidrapport widens it when the person goes further back) plus any running timer; the team's
    // entries (admins and team:read) from teamFrom–teamTo (default 90 days). The picker gets the work orders and projects those entries are
    // on, the most recently changed open work orders and projects, and a focused one (a task given is its work order).
    const isoDay = z.union([z.literal(""), z.iso.date()]);
    const defaultFrom = swedishDayKey(addSwedishDays(new Date(), -TIME_DEFAULT_DAYS));
    const ownFrom = isoDay.parse(params.get("ownFrom") ?? "") || defaultFrom;
    const teamFrom = isoDay.parse(params.get("teamFrom") ?? "") || defaultFrom;
    const teamTo = isoDay.parse(params.get("teamTo") ?? "");
    const focusId = params.get("taskId") ? id.parse(params.get("taskId")) : null;
    const focusProjectId = params.get("projectId") ? id.parse(params.get("projectId")) : null;
    const teamWindow = { gte: fromSwedishDateInput(teamFrom)!, ...(teamTo ? { lt: addSwedishDays(fromSwedishDateInput(teamTo)!, 1) } : {}) };
    const ownWindow = { gte: fromSwedishDateInput(ownFrom)! };
    const timeEntries = await prisma.workflowTimeEntry.findMany({
      where: { AND: [inOrganization, { OR: [{ userId: ctx.user.id, OR: [{ startedAt: ownWindow }, { endedAt: null }] }, ...(team ? [{ startedAt: teamWindow }] : [])] }] },
      orderBy: { startedAt: "desc" },
      take: TIME_ENTRY_CAP,
      select: { ...entrySelect, taskId: true, projectId: true },
    });
    // A focused task (Se tiden from a protocol) is its work order.
    const focus = focusId ? await prisma.workflowTask.findFirst({ where: { id: focusId, organizationId: ctx.organizationId }, select: { id: true, kind: true, workOrderId: true } }) : null;
    const focusOrderId = focus ? (focus.kind === "WORK_ORDER" ? focus.id : focus.workOrderId) : null;
    // A focused id that is no task is a project (Tid opened for Projekttid).
    const focusProject = focusProjectId ?? (focusId && !focus ? focusId : null);
    const entryTaskIds = [...new Set([...timeEntries.flatMap((entry) => entry.taskId ? [entry.taskId] : []), ...(focusOrderId ? [focusOrderId] : [])])];
    const entryProjectIds = [...new Set([...timeEntries.flatMap((entry) => entry.projectId ? [entry.projectId] : []), ...(focusProject ? [focusProject] : [])])];
    const listTaskSelect = { id: true, title: true, kind: true, formArea: true, status: true, projectId: true, updatedAt: true, project: { select: { name: true, archivedAt: true } } } as const;
    const openProject = { OR: [{ projectId: null }, { project: { is: { archivedAt: null } } }] };
    // Mina jobb först (användartest 2026-10-31, F4): the open work orders the person is responsible for or booked on (from two
    // weeks back to a month ahead), read on their own so they are never cut off by the picker's limit.
    const now = new Date();
    const mineWhere = canRead("work-order") ? { organizationId: ctx.organizationId, kind: "WORK_ORDER", status: { notIn: [...CLOSED_TASK_STATUSES] }, AND: [readableTaskWhere(canRead), openProject, { OR: [
      { assignedToUserId: ctx.user.id },
      { plannedActivities: { some: { deletedAt: null, status: { in: ["PLANNED", "IN_PROGRESS"] }, endsAt: { gte: addSwedishDays(now, -14) }, startsAt: { lte: addSwedishDays(now, 31) },
        OR: [{ assignedToUserId: ctx.user.id }, { assignments: { some: { member: { userId: ctx.user.id } } } }] } } },
    ] }] } satisfies Prisma.WorkflowTaskWhereInput : null;
    const mineRows = mineWhere ? await prisma.workflowTask.findMany({ where: mineWhere, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: TIME_PICKER_LIMIT, select: { id: true } }) : [];
    const mineIds = new Set(mineRows.map((row) => row.id));
    const [taskRows, recentTasks, projectRows, recentProjects, member, events, members, corrections, timeTypes] = await Promise.all([
      entryTaskIds.length || mineIds.size ? prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, id: { in: [...new Set([...entryTaskIds, ...mineIds])] } }, select: listTaskSelect }) : Promise.resolve([]),
      // Tid rapporteras på en arbetsorder (2026-10-26): the picker offers open work orders, never a task.
      canRead("work-order") ? prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId, kind: "WORK_ORDER", status: { notIn: [...CLOSED_TASK_STATUSES] }, AND: [readableTaskWhere(canRead), openProject] },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: TIME_PICKER_LIMIT, select: listTaskSelect,
      }) : Promise.resolve([]),
      entryProjectIds.length ? prisma.project.findMany({ where: { organizationId: ctx.organizationId, id: { in: entryProjectIds } }, select: { ...projectSelect, updatedAt: true } }) : Promise.resolve([]),
      canRead("projects") ? prisma.project.findMany({ where: { organizationId: ctx.organizationId, archivedAt: null, closedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: TIME_PICKER_LIMIT, select: { ...projectSelect, updatedAt: true } }) : Promise.resolve([]),
      prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: ctx.user.id } }, select: { id: true, weeklyWorkMinutes: true, noFixedHours: true } }), prisma.workScheduleEvent.findMany({ where: { organizationId: ctx.organizationId, OR: [{ scope: "ORGANIZATION" }, { memberId: { not: null }, member: { userId: ctx.user.id } }] }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, scope: true, previousMinutes: true, nextMinutes: true, actorName: true, createdAt: true } }),
      team ? prisma.organizationMember.findMany({ where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } }, orderBy: { user: { name: "asc" } }, select: { userId: true, user: { select: { name: true, email: true } } } }) : Promise.resolve([]),
      // Entries changed by someone other than their owner are marked as corrected (only the entries sent).
      timeEntries.length ? prisma.workflowTimeEntryEvent.findMany({ where: { organizationId: ctx.organizationId, entryId: { in: timeEntries.map((entry) => entry.id) }, ...(team ? {} : { userId: ctx.user.id }), NOT: { actorUserId: { equals: prisma.workflowTimeEntryEvent.fields.userId } } }, select: { entryId: true }, distinct: ["entryId"] }) : Promise.resolve([]),
      // Tidstyper (2026-10-29): the company's list, inactive ones too so old entries keep their name.
      loadTimeTypes(ctx.organizationId),
    ]);
    const corrected = new Set(corrections.map((event) => event.entryId));
    type Source = { id: string; title: string; kind: string; status: string; updatedAt: Date; projectId: string | null; project: { name: string; archivedAt: Date | null } | null };
    const sources = new Map<string, Source>();
    for (const task of [...taskRows, ...recentTasks])
      if (canRead(workflowSubjectForTask(task.kind, task.formArea))) sources.set(task.id, { id: task.id, title: task.title, kind: task.kind, status: task.status, updatedAt: task.updatedAt, projectId: task.projectId, project: task.project });
    // Projekttid (svar 5a): the project itself as a source, kind PROJECT – shown as "Projekttid" in Tidrapport.
    if (canRead("projects"))
      for (const project of [...projectRows, ...recentProjects]) sources.set(project.id, { id: project.id, title: project.name, kind: "PROJECT", status: projectTimeState(project).status, updatedAt: project.updatedAt, projectId: project.id, project: { name: project.name, archivedAt: project.archivedAt } });
    const readable = [...sources.values()].sort((a, b) => Number(a.kind === "PROJECT") - Number(b.kind === "PROJECT") || a.title.localeCompare(b.title, "sv") || a.id.localeCompare(b.id));
    const mark = <T extends { id: string }>(entry: T) => ({ ...entry, corrected: corrected.has(entry.id) });
    const ownerOf = (entry: { taskId: string | null; projectId: string | null }) => entry.taskId ?? entry.projectId ?? "";
    // The entry as before (entrySelect's fields), without the owner ids used for grouping here.
    const entryView = (entry: (typeof timeEntries)[number]) => mark({ id: entry.id, userId: entry.userId, startedAt: entry.startedAt, endedAt: entry.endedAt, durationSec: entry.durationSec, note: entry.note, timeTypeId: entry.timeTypeId, createdAt: entry.createdAt, updatedAt: entry.updatedAt });
    return NextResponse.json({
      currentUserId: ctx.user.id,
      ownFrom,
      focusTaskId: focusOrderId ?? focusProject ?? null,
      tasks: readable.map(({ project, ...task }) => ({ ...task, project: project ? { name: project.name } : null, archived: Boolean(project?.archivedAt), ...(mineIds.has(task.id) ? { mine: true } : {}),
        timeEntries: timeEntries.filter((entry) => entry.userId === ctx.user.id && ownerOf(entry) === task.id).map(entryView) })),
      team: team ? {
        canEdit: ctx.admin,
        members: members.map((item) => ({ id: item.userId, name: item.user.name || item.user.email })),
        entries: timeEntries.filter((entry) => sources.has(ownerOf(entry)) && entry.startedAt >= teamWindow.gte && (!teamWindow.lt || entry.startedAt < teamWindow.lt)).map((entry) => ({ ...entryView(entry), taskId: ownerOf(entry) })),
        from: teamFrom,
        to: teamTo,
      } : null,
      // Arbetstid (2026-10-30): the company's workday (a suggestion for time on another day) and the person's Ingen fast arbetstid.
      schedule: { organizationWeeklyWorkMinutes: ctx.organization.weeklyWorkMinutes, memberWeeklyWorkMinutes: member.weeklyWorkMinutes, canEditOrganization: ctx.admin, events,
        workdayStartMinutes: ctx.organization.workdayStartMinutes, workdayEndMinutes: ctx.organization.workdayEndMinutes, noFixedHours: member.noFixedHours },
      timeTypes, canEditTimeTypes: ctx.admin,
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
    const inOrganization = timeEntryInOrganization(ctx.organizationId);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("save"), entry: entryInput, reason: timeCorrectionReasonSchema }),
      z.object({ action: z.literal("delete"), id, reason: timeCorrectionReasonSchema }),
      // Ingen fast arbetstid (2026-10-30) goes with the person's own hours; left out = unchanged.
      z.object({ action: z.literal("schedule_save"), scope: z.enum(["ORGANIZATION", "MEMBER"]), minutes: weeklyWorkMinutesOverrideSchema, noFixedHours: z.boolean().optional() }),
      // Företagets arbetsdag (2026-10-30): admins; only a suggestion in the time report.
      z.object({ action: z.literal("workday_save"), startMinutes: z.number(), endMinutes: z.number() }),
      // Projekttid med timer (2026-10-26, svar 5a): start and stop on a project; one running timer per person.
      z.object({ action: z.literal("project_timer"), projectId: id, command: z.enum(["START", "PAUSE"]), keepShort: z.boolean().optional() }),
      // Tidstyper (2026-10-29): the company's list, changed by admins (lib/workflow/time-types-server.ts checks the role).
      z.object({ action: z.literal("time_type_save"), type: z.unknown() }),
      z.object({ action: z.literal("time_type_move"), id, step: z.union([z.literal(-1), z.literal(1)]) }),
      z.object({ action: z.literal("time_type_remove"), id }),
    ]).parse(await body(request));
    // Företagets moduler (0.39.0): with Tid och lön off nothing new is written, but a person's running timer can always be stopped.
    if (!(input.action === "project_timer" && input.command === "PAUSE")) requireModule(ctx, "time");
    if (input.action === "time_type_save" || input.action === "time_type_move" || input.action === "time_type_remove") {
      if (ctx.integration) throw new ApiError(403, "Det här görs av en administratör i appen.");
      if (input.action === "time_type_save") await saveTimeType(ctx, input.type);
      else if (input.action === "time_type_move") await moveTimeType(ctx, input.id, input.step);
      else await removeTimeType(ctx, input.id);
      return NextResponse.json({ ok: true, timeTypes: await timeTypesForMember(ctx) });
    }
    const actorName = ctx.user.name || ctx.user.email;

    if (input.action === "workday_save") {
      if (ctx.integration) throw new ApiError(403, "Det här görs av en administratör i appen.");
      requireAdmin(ctx);
      const parsed = workdaySchema.safeParse({ startMinutes: input.startMinutes, endMinutes: input.endMinutes });
      if (!parsed.success) throw new ApiError(422, parsed.error.issues[0]?.message ?? "Kontrollera arbetsdagen.");
      const next = parsed.data;
      await prisma.$transaction(async (tx) => {
        const current = await tx.$queryRaw<{ workdayStartMinutes: number; workdayEndMinutes: number }[]>`
          SELECT "workdayStartMinutes", "workdayEndMinutes" FROM "Organization" WHERE id=${ctx.organizationId} FOR UPDATE
        `;
        if (!current[0]) throw new ApiError(404, "Företaget saknas.");
        if (current[0].workdayStartMinutes === next.startMinutes && current[0].workdayEndMinutes === next.endMinutes) return;
        await tx.organization.update({ where: { id: ctx.organizationId }, data: { workdayStartMinutes: next.startMinutes, workdayEndMinutes: next.endMinutes } });
        await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "workday",
          detail: `Arbetsdagen ändrades från ${clockOfMinutes(current[0].workdayStartMinutes)}–${clockOfMinutes(current[0].workdayEndMinutes)} till ${clockOfMinutes(next.startMinutes)}–${clockOfMinutes(next.endMinutes)}.` } });
      });
      return NextResponse.json({ ok: true });
    }

    if (input.action === "schedule_save") {
      if (input.scope === "ORGANIZATION") {
        requireAdmin(ctx);
        const minutes = weeklyWorkMinutesSchema.parse(input.minutes);
        await prisma.$transaction(async (tx) => {
          const current = await tx.$queryRaw<{ weeklyWorkMinutes: number }[]>`
            SELECT "weeklyWorkMinutes" FROM "Organization" WHERE id=${ctx.organizationId} FOR UPDATE
          `;
          if (!current[0]) throw new ApiError(404, "Företaget saknas.");
          if (current[0].weeklyWorkMinutes === minutes) return;
          await tx.organization.update({ where: { id: ctx.organizationId }, data: { weeklyWorkMinutes: minutes } });
          await tx.workScheduleEvent.create({ data: { organizationId: ctx.organizationId, scope: "ORGANIZATION", previousMinutes: current[0].weeklyWorkMinutes, nextMinutes: minutes, actorName } });
        });
      } else {
        await prisma.$transaction(async (tx) => {
          const current = await tx.$queryRaw<{ id: string; weeklyWorkMinutes: number | null; noFixedHours: boolean }[]>`
            SELECT id, "weeklyWorkMinutes", "noFixedHours" FROM "OrganizationMember"
            WHERE "organizationId"=${ctx.organizationId} AND "userId"=${ctx.user.id} FOR UPDATE
          `;
          if (!current[0]) throw new ApiError(403, "Medlemskap saknas.");
          // Ingen fast arbetstid: its own line in the company's administration history (the schedule history holds minutes).
          if (input.noFixedHours !== undefined && input.noFixedHours !== current[0].noFixedHours) {
            await tx.organizationMember.update({ where: { id: current[0].id }, data: { noFixedHours: input.noFixedHours } });
            await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "work_schedule_no_fixed_hours",
              detail: `${actorName}: ${input.noFixedHours ? "Ingen fast arbetstid" : "Fast arbetstid"}.` } });
          }
          if (current[0].weeklyWorkMinutes === input.minutes) return;
          await tx.organizationMember.update({ where: { id: current[0].id }, data: { weeklyWorkMinutes: input.minutes } });
          await tx.workScheduleEvent.create({ data: { organizationId: ctx.organizationId, memberId: current[0].id, scope: "MEMBER", previousMinutes: current[0].weeklyWorkMinutes, nextMinutes: input.minutes, actorName } });
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (input.action === "project_timer") {
      // A person's own timer: never an API/MCP key's. Read on projects is the right (as for written project time).
      if (ctx.integration) throw new ApiError(403, "Det här görs av en person i appen.");
      if (input.command === "START") requireModule(ctx, "projects");
      requireWorkflowPermission(ctx, "projects", "read");
      const project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: ctx.organizationId }, select: projectSelect });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
      const start = input.command === "START";
      if (start && project.archivedAt) throw new ApiError(409, "Återställ projektet innan du skriver tid på det.");
      if (start && project.closedAt) throw new ApiError(409, "Projektet är avslutat. Återöppna det för att skriva tid.");
      const now = new Date();
      const keep = { keepShort: Boolean(input.keepShort) };
      const owner = { id: project.id, title: project.name, project: true };
      const stopped = await prisma.$transaction(async (tx) => {
        const mine = await tx.workflowTimeEntry.findMany({ where: { projectId: project.id, userId: ctx.user.id, endedAt: null } });
        if (!start) return closeTimeEntries(tx, ctx, mine, owner, now, keep);
        if (!mine.length) {
          // Tidsperiod (2026-10-30): no new time in a sent-in or approved month.
          await assertTimeOpen(tx, ctx.organizationId, [{ userId: ctx.user.id, startedAt: now }], ctx.user.id);
          await tx.workflowTimeEntry.create({ data: { projectId: project.id, userId: ctx.user.id, startedAt: now } });
        }
        return pauseOtherOwnTimers(tx, ctx, { projectId: project.id }, now, keep);
      });
      return NextResponse.json({ ok: true, stopped });
    }

    // Members only see their own entries; admins may correct any entry in their own tenant.
    const findEntry = async (entryId: string) => {
      const entry = await prisma.workflowTimeEntry.findFirst({
        where: { id: entryId, AND: [inOrganization], ...(ctx.admin ? {} : { userId: ctx.user.id }) },
        select: { ...entrySelect, task: { select: taskSelect }, project: { select: projectSelect } },
      });
      return entry ? { ...entry, source: sourceOf(entry) } : null;
    };

    if (input.action === "delete") {
      const entry = await findEntry(input.id);
      if (!entry) throw new ApiError(404, "Tidposten hittades inte.");
      requireSourceRight(ctx, entry.source, "edit");
      const reason = checkCorrection({ actorIsAdmin: ctx.admin, actorOwnsEntry: entry.userId === ctx.user.id, source: taskState(entry.source) }, input.reason);
      const types = await loadTimeTypes(ctx.organizationId);
      await prisma.$transaction(async (tx) => {
        // Tidsperiod (2026-10-30): time in a sent-in or approved month is not removed.
        await assertTimeOpen(tx, ctx.organizationId, [entry], ctx.user.id);
        await tx.workflowTimeEntry.delete({ where: { id: entry.id } });
        await tx.workflowTimeEntryEvent.create({ data: { organizationId: ctx.organizationId, entryId: entry.id, userId: entry.userId, action: "DELETED", previous: json(snapshot(entry, entry.source, types)), reason, actorUserId: ctx.user.id, actorName } });
      });
      return NextResponse.json({ ok: true });
    }

    const data = input.entry;
    const startedAt = new Date(data.startedAt);
    const endedAt = new Date(data.endedAt);
    if (endedAt <= startedAt) throw new ApiError(422, "Sluttiden måste vara efter starttiden.");
    const durationSec = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
    if (durationSec > 24 * 60 * 60) throw new ApiError(422, "En enskild tidpost får vara högst 24 timmar.");
    // Time is what has been worked: a time later than now is refused (a few minutes of clock difference are allowed).
    if (endedAt.getTime() > Date.now() + 5 * 60 * 1000) throw new ApiError(422, "Tiden ligger i framtiden. Skriv tid som redan är arbetad.");
    // Overlapping own time is refused (2026-10-18), so one hour of work is never counted twice. Colleagues may overlap.
    const refuseOverlap = async (userId: string, exceptId?: string) => {
      // Only this company's time (2026-10-13): a person in two companies must never show one company the other's job title.
      const other = await prisma.workflowTimeEntry.findFirst({ where: { userId, AND: [inOrganization], ...(exceptId ? { id: { not: exceptId } } : {}), startedAt: { lt: endedAt }, OR: [{ endedAt: { gt: startedAt } }, { endedAt: null }] }, select: { task: { select: { title: true } }, project: { select: { name: true } } } });
      if (other) { const title = other.task?.title ?? other.project?.name; throw new ApiError(422, `Tiden överlappar en annan tidpost för dig${title ? ` (${title})` : ""}.`); }
    };
    let task: TimeSource;
    // Rapporterad från (2026-10-27): time written in a task lands on its work order and remembers the task.
    let sourceTaskId: string | null = null;
    if (data.projectId) {
      requireModule(ctx, "projects");
      // Projekttid (svar 5a): project management, meetings – time on the project itself, never also on a work order.
      task = sourceOf({ project: await prisma.project.findFirst({ where: { id: data.projectId, organizationId: ctx.organizationId }, select: projectSelect }) });
      requireSourceRight(ctx, task, "edit");
    } else {
      const picked = await prisma.workflowTask.findFirst({ where: { id: data.taskId!, organizationId: ctx.organizationId }, select: { ...taskSelect, workOrderId: true } });
      const clicked = sourceOf({ task: picked });
      requireSourceRight(ctx, clicked, "edit");
      // Tid på arbetsordern: time written on a task is recorded on its work order (the task's page says so).
      const timeOwnerId = picked ? timeOwnerFor(ctx, picked) : clicked.id;
      task = timeOwnerId === clicked.id ? clicked : sourceOf({ task: await prisma.workflowTask.findFirst({ where: { id: timeOwnerId, organizationId: ctx.organizationId, kind: "WORK_ORDER" }, select: taskSelect }) });
      if (task.id !== clicked.id) sourceTaskId = clicked.id;
      // Återkommande underhåll (2026-10-30): no time on a vilande work order until its day or Aktivera.
      await assertNotDormant(prisma, ctx.organizationId, task.id);
    }
    const types = await loadTimeTypes(ctx.organizationId);
    // Changing the work order or project moves the entry, and with it the time; the entry keeps exactly one owner.
    const owner = { ...timeOwnerColumns(task), ...(task.project ? { taskId: null } : { projectId: null }) };

    if (data.id) {
      const current = await findEntry(data.id);
      if (!current) throw new ApiError(404, "Tidposten hittades inte.");
      requireSourceRight(ctx, current.source, "edit");
      const reason = checkCorrection({ actorIsAdmin: ctx.admin, actorOwnsEntry: current.userId === ctx.user.id, source: taskState(current.source), target: taskState(task) }, input.reason);
      // The type: kept when not sent; a deactivated type stays on the entry that has it, but is never chosen anew.
      const timeTypeId = await checkedTimeTypeId(ctx.organizationId, data.timeTypeId, current.timeTypeId);
      const next = { startedAt, endedAt, durationSec, note: data.note, timeTypeId: timeTypeId === undefined ? current.timeTypeId : timeTypeId };
      await refuseOverlap(current.userId, current.id);
      // A task named again is remembered; an entry moved to another owner without one forgets the old task.
      const source = sourceTaskId ? { sourceTaskId } : current.source.id === task.id ? {} : { sourceTaskId: null };
      await prisma.$transaction(async (tx) => {
        // Tidsperiod (2026-10-30): neither the month the entry is in nor the month it moves to may be sent in or approved.
        await assertTimeOpen(tx, ctx.organizationId, [current, { userId: current.userId, startedAt }], ctx.user.id);
        await tx.workflowTimeEntry.update({ where: { id: current.id }, data: { ...owner, ...next, ...source } });
        await tx.workflowTimeEntryEvent.create({ data: { organizationId: ctx.organizationId, entryId: current.id, userId: current.userId, action: "UPDATED", previous: json(snapshot(current, current.source, types)), next: json(snapshot(next, task, types)), reason, actorUserId: ctx.user.id, actorName } });
      });
      return NextResponse.json({ id: current.id });
    }

    const ownerId = data.userId ?? ctx.user.id;
    if (ownerId !== ctx.user.id) {
      requireAdmin(ctx);
      const member = await prisma.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, userId: ownerId, isActive: true, user: { isActive: true } }, select: { id: true } });
      if (!member) throw new ApiError(400, "Medarbetaren tillhör inte arbetsytan.");
    }
    const reason = checkCorrection({ actorIsAdmin: ctx.admin, actorOwnsEntry: ownerId === ctx.user.id, target: taskState(task) }, input.reason);
    const timeTypeId = (await checkedTimeTypeId(ctx.organizationId, data.timeTypeId)) ?? null;
    await refuseOverlap(ownerId);
    const created = await prisma.$transaction(async (tx) => {
      // Tidsperiod (2026-10-30): no new time in a sent-in or approved month.
      await assertTimeOpen(tx, ctx.organizationId, [{ userId: ownerId, startedAt }], ctx.user.id);
      const entry = await tx.workflowTimeEntry.create({ data: { ...timeOwnerColumns(task), sourceTaskId, userId: ownerId, startedAt, endedAt, durationSec, note: data.note, timeTypeId }, select: { id: true } });
      await tx.workflowTimeEntryEvent.create({ data: { organizationId: ctx.organizationId, entryId: entry.id, userId: ownerId, action: "CREATED", next: json(snapshot({ startedAt, endedAt, durationSec, note: data.note, timeTypeId }, task, types)), reason, actorUserId: ctx.user.id, actorName } });
      return entry;
    });
    // Says where the time landed (Arbetsordern styr): a task's time is on its work order.
    return NextResponse.json({ ...created, owner: { id: task.id, title: task.title, kind: task.kind } });
  } catch (error) {
    return failure(error);
  }
}
