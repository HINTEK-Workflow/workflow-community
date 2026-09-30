import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess, requireWorkflowPermission } from "@/lib/kfid/server";
import { hasWorkflowPermission, workflowSubjectForTask } from "@/lib/workflow/permissions";
import { assertTimeCorrection, TimeCorrectionError, timeCorrectionReasonSchema, type TimeEntrySnapshot } from "@/lib/workflow/time-correction";
import { weeklyWorkMinutesOverrideSchema, weeklyWorkMinutesSchema } from "@/lib/workflow/work-schedule";
import { addSwedishDays, fromSwedishDateInput, swedishDayKey } from "@/lib/swedish-time";
import { capacityWeek } from "@/lib/workflow/capacity-summary";
import { closeTimeEntries, pauseOtherOwnTimers } from "@/lib/workflow/timer-server";

const id = z.string().min(1).max(100);
const entryInput = z.object({
  id: id.optional(),
  taskId: id,
  // Only an organization admin may register time for another active member.
  userId: id.optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  note: z.string().trim().max(1000).default(""),
});
const entrySelect = { id: true, userId: true, startedAt: true, endedAt: true, durationSec: true, note: true, createdAt: true, updatedAt: true } as const;
const json = (value: unknown) => value as Prisma.InputJsonValue;

export const dynamic = "force-dynamic";

/**
 * What a time entry is registered on: a work order/risk assessment, or (2026-09-26, decision 13) a commissioning
 * control. Controls only get manual registration; the same correction rules and history apply to both.
 */
type TimeSource = { id: string; title: string; kind: string; formArea?: string | null; status: string; archived: boolean; control: boolean };
const snapshot = (entry: { startedAt: Date; endedAt: Date | null; durationSec: number; note: string }, source: { id: string; title: string }): TimeEntrySnapshot => ({
  taskId: source.id, taskTitle: source.title, startedAt: entry.startedAt.toISOString(), endedAt: entry.endedAt?.toISOString() ?? null, durationSec: entry.durationSec, note: entry.note,
});
const taskState = (source: TimeSource) => ({ status: source.status, archived: source.archived });
const taskSelect = { id: true, title: true, kind: true, formArea: true, status: true, project: { select: { archivedAt: true } } } as const;
const controlSelect = { id: true, title: true, status: true, workflowProject: { select: { archivedAt: true } } } as const;
type TaskRow = { id: string; title: string; kind: string; formArea?: string | null; status: string; project: { archivedAt: Date | null } | null };
type ControlRow = { id: string; title: string; status: string; workflowProject: { archivedAt: Date | null } | null };
function sourceOf(entry: { task: TaskRow | null; control: ControlRow | null }): TimeSource {
  if (entry.task) return { id: entry.task.id, title: entry.task.title, kind: entry.task.kind, formArea: entry.task.formArea, status: entry.task.status, archived: Boolean(entry.task.project?.archivedAt), control: false };
  if (entry.control) return { id: entry.control.id, title: entry.control.title, kind: "COMMISSIONING_CONTROL", status: entry.control.status, archived: Boolean(entry.control.workflowProject?.archivedAt), control: true };
  throw new ApiError(404, "Uppgiften hittades inte.");
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
    const historyFor = new URL(request.url).searchParams.get("history");
    if (historyFor) {
      const entryId = id.parse(historyFor);
      const events = await prisma.workflowTimeEntryEvent.findMany({ where: { organizationId: ctx.organizationId, entryId, ...(ctx.admin ? {} : { userId: ctx.user.id }) }, orderBy: { createdAt: "desc" }, take: 100 });
      return NextResponse.json({ events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const params = new URL(request.url).searchParams;
    // The top bar's running timer (2026-09-26): only the caller's own running entries, bounded and readable.
    if (params.get("running") === "mine") {
      const running = await prisma.workflowTimeEntry.findMany({
        where: { userId: ctx.user.id, endedAt: null, OR: [{ task: { organizationId: ctx.organizationId } }, { control: { organizationId: ctx.organizationId, deletedAt: null } }] },
        orderBy: { startedAt: "asc" },
        take: 10,
        select: { id: true, startedAt: true, task: { select: { id: true, title: true, kind: true, formArea: true, project: { select: { name: true } } } }, control: { select: { id: true, title: true, workflowProject: { select: { name: true } } } } },
      });
      const canRead = (subject: Parameters<typeof hasWorkflowPermission>[1]) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
      return NextResponse.json({
        now: new Date().toISOString(),
        // Tasks and (2026-09-27) controls run a timer.
        running: running.flatMap(({ task, control, ...entry }) => task && canRead(workflowSubjectForTask(task.kind, task.formArea))
          ? [{ entryId: entry.id, taskId: task.id, taskTitle: task.title, kind: task.kind, projectName: task.project?.name ?? null, startedAt: entry.startedAt.toISOString() }]
          : control && canRead("kfid")
            ? [{ entryId: entry.id, taskId: control.id, taskTitle: control.title, kind: "KFID", projectName: control.workflowProject?.name ?? null, startedAt: entry.startedAt.toISOString() }]
            : []),
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    // Planning's capacity panel (2026-09-26: fetch only what is shown): the caller's own finished time in the
    // current Swedish week and the weekly working time, nothing else.
    if (params.get("capacity") === "week") {
      const week = capacityWeek(new Date());
      const [entries, member] = await Promise.all([
        prisma.workflowTimeEntry.findMany({
          where: { userId: ctx.user.id, startedAt: { gte: week.startsAt, lt: week.endsAt }, OR: [{ task: { organizationId: ctx.organizationId } }, { control: { organizationId: ctx.organizationId, deletedAt: null } }] },
          select: { startedAt: true, durationSec: true },
        }),
        prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: ctx.user.id } }, select: { weeklyWorkMinutes: true } }),
      ]);
      return NextResponse.json({
        currentUserId: ctx.user.id,
        timeEntries: entries.map((entry) => ({ startedAt: entry.startedAt.toISOString(), durationSec: entry.durationSec })),
        schedule: { organizationWeeklyWorkMinutes: ctx.organization.weeklyWorkMinutes, memberWeeklyWorkMinutes: member.weeklyWorkMinutes },
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    // Team entries are bounded by a date range (2026-09-26: bounded server reads). Default: the last 90 Swedish
    // days; the admin widens it by choosing an earlier "Från". Own entries (Min vecka, own list) are not bounded.
    const isoDay = z.union([z.literal(""), z.iso.date()]);
    const teamFrom = isoDay.parse(params.get("teamFrom") ?? "") || swedishDayKey(addSwedishDays(new Date(), -90));
    const teamTo = isoDay.parse(params.get("teamTo") ?? "");
    const teamWindow = { gte: fromSwedishDateInput(teamFrom)!, ...(teamTo ? { lt: addSwedishDays(fromSwedishDateInput(teamTo)!, 1) } : {}) };
    const ownOrTeam = ctx.admin ? { OR: [{ userId: ctx.user.id }, { startedAt: teamWindow }] } : { userId: ctx.user.id };
    const canReadControls = ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "kfid", "read");
    const [tasks, controls, member, events, members, corrections] = await Promise.all([prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        kind: true, formArea: true,
        status: true,
        projectId: true,
        project: { select: { name: true, archivedAt: true } },
        // Own entries drive Min vecka and capacity; admins additionally receive the team's entries separately below.
        timeEntries: { where: ownOrTeam, orderBy: { startedAt: "desc" }, select: entrySelect },
      },
    }),
    // Controls take manual time (decision 13); they are listed like tasks with the kind COMMISSIONING_CONTROL.
    canReadControls ? prisma.control.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      orderBy: { title: "asc" },
      select: { id: true, title: true, status: true, projectId: true, workflowProject: { select: { name: true, archivedAt: true } }, timeEntries: { where: ownOrTeam, orderBy: { startedAt: "desc" }, select: entrySelect } },
    }) : Promise.resolve([]),
    prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: ctx.user.id } }, select: { id: true, weeklyWorkMinutes: true } }), prisma.workScheduleEvent.findMany({ where: { organizationId: ctx.organizationId, OR: [{ scope: "ORGANIZATION" }, { memberId: { not: null }, member: { userId: ctx.user.id } }] }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, scope: true, previousMinutes: true, nextMinutes: true, actorName: true, createdAt: true } }),
    ctx.admin ? prisma.organizationMember.findMany({ where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } }, orderBy: { user: { name: "asc" } }, select: { userId: true, user: { select: { name: true, email: true } } } }) : Promise.resolve([]),
    // Entries changed by someone other than their owner are marked as corrected.
    prisma.workflowTimeEntryEvent.findMany({ where: { organizationId: ctx.organizationId, ...(ctx.admin ? {} : { userId: ctx.user.id }), NOT: { actorUserId: { equals: prisma.workflowTimeEntryEvent.fields.userId } } }, select: { entryId: true }, distinct: ["entryId"] })]);
    const corrected = new Set(corrections.map((event) => event.entryId));
    const readable = [
      ...tasks.filter((task) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, workflowSubjectForTask(task.kind, task.formArea), "read")),
      ...controls.map(({ workflowProject, ...control }) => ({ ...control, kind: "COMMISSIONING_CONTROL", project: workflowProject })),
    ];
    const mark = <T extends { id: string }>(entry: T) => ({ ...entry, corrected: corrected.has(entry.id) });
    return NextResponse.json({
      currentUserId: ctx.user.id,
      tasks: readable.map(({ timeEntries, project, ...task }) => ({ ...task, project: project ? { name: project.name } : null, archived: Boolean(project?.archivedAt), timeEntries: timeEntries.filter((entry) => entry.userId === ctx.user.id).map(mark) })),
      team: ctx.admin ? {
        members: members.map((item) => ({ id: item.userId, name: item.user.name || item.user.email })),
        entries: readable.flatMap((task) => task.timeEntries.filter((entry) => entry.startedAt >= teamWindow.gte && (!teamWindow.lt || entry.startedAt < teamWindow.lt)).map((entry) => ({ ...mark(entry), taskId: task.id }))),
        from: teamFrom,
        to: teamTo,
      } : null,
      schedule: { organizationWeeklyWorkMinutes: ctx.organization.weeklyWorkMinutes, memberWeeklyWorkMinutes: member.weeklyWorkMinutes, canEditOrganization: ctx.admin, events },
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
      z.object({ action: z.literal("save"), entry: entryInput, reason: timeCorrectionReasonSchema }),
      z.object({ action: z.literal("delete"), id, reason: timeCorrectionReasonSchema }),
      z.object({ action: z.literal("schedule_save"), scope: z.enum(["ORGANIZATION", "MEMBER"]), minutes: weeklyWorkMinutesOverrideSchema }),
      z.object({ action: z.literal("control_timer"), id, command: z.enum(["START", "PAUSE"]) }),
    ]).parse(await body(request));
    const actorName = ctx.user.name || ctx.user.email;

    // Start/pause on a control (2026-09-27: every task editor can start time), per person as for tasks.
    if (input.action === "control_timer") {
      requireWorkflowPermission(ctx, "kfid", "edit");
      const control = await prisma.control.findFirst({ where: { id: input.id, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true, title: true, status: true, workflowProject: { select: { archivedAt: true } } } });
      if (!control) throw new ApiError(404, "Kontrollen hittades inte.");
      const start = input.command === "START";
      if (start && control.status === "COMPLETED") throw new ApiError(409, "En färdigställd kontroll kan inte tidrapporteras.");
      if (start && control.workflowProject?.archivedAt) throw new ApiError(409, "Projektet är arkiverat. Återställ projektet innan du rapporterar tid.");
      const now = new Date();
      const owner = { id: control.id, title: control.title || "Kontroll" };
      const stopped = await prisma.$transaction(async (tx) => {
        // Serialize concurrent start/pause on the same control.
        await tx.$queryRaw`SELECT id FROM "Control" WHERE id=${control.id} AND "organizationId"=${ctx.organizationId} FOR UPDATE`;
        const mine = await tx.workflowTimeEntry.findMany({ where: { controlId: control.id, userId: ctx.user.id, endedAt: null } });
        if (!start) return closeTimeEntries(tx, ctx, mine, owner, now);
        if (!mine.length) await tx.workflowTimeEntry.create({ data: { controlId: control.id, userId: ctx.user.id, startedAt: now } });
        return pauseOtherOwnTimers(tx, ctx, { controlId: control.id }, now);
      });
      return NextResponse.json({ ok: true, stopped });
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
          const current = await tx.$queryRaw<{ id: string; weeklyWorkMinutes: number | null }[]>`
            SELECT id, "weeklyWorkMinutes" FROM "OrganizationMember"
            WHERE "organizationId"=${ctx.organizationId} AND "userId"=${ctx.user.id} FOR UPDATE
          `;
          if (!current[0]) throw new ApiError(403, "Medlemskap saknas.");
          if (current[0].weeklyWorkMinutes === input.minutes) return;
          await tx.organizationMember.update({ where: { id: current[0].id }, data: { weeklyWorkMinutes: input.minutes } });
          await tx.workScheduleEvent.create({ data: { organizationId: ctx.organizationId, memberId: current[0].id, scope: "MEMBER", previousMinutes: current[0].weeklyWorkMinutes, nextMinutes: input.minutes, actorName } });
        });
      }
      return NextResponse.json({ ok: true });
    }

    // Members only see their own entries; admins may correct any entry in their own tenant.
    const findEntry = async (entryId: string) => {
      const entry = await prisma.workflowTimeEntry.findFirst({
        where: { id: entryId, OR: [{ task: { organizationId: ctx.organizationId } }, { control: { organizationId: ctx.organizationId } }], ...(ctx.admin ? {} : { userId: ctx.user.id }) },
        select: { ...entrySelect, task: { select: taskSelect }, control: { select: controlSelect } },
      });
      return entry ? { ...entry, source: sourceOf(entry) } : null;
    };

    if (input.action === "delete") {
      const entry = await findEntry(input.id);
      if (!entry) throw new ApiError(404, "Tidposten hittades inte.");
      requireWorkflowPermission(ctx, workflowSubjectForTask(entry.source.kind, entry.source.formArea), "edit");
      const reason = checkCorrection({ actorIsAdmin: ctx.admin, actorOwnsEntry: entry.userId === ctx.user.id, source: taskState(entry.source) }, input.reason);
      await prisma.$transaction([
        prisma.workflowTimeEntry.delete({ where: { id: entry.id } }),
        prisma.workflowTimeEntryEvent.create({ data: { organizationId: ctx.organizationId, entryId: entry.id, userId: entry.userId, action: "DELETED", previous: json(snapshot(entry, entry.source)), reason, actorUserId: ctx.user.id, actorName } }),
      ]);
      return NextResponse.json({ ok: true });
    }

    const data = input.entry;
    const startedAt = new Date(data.startedAt);
    const endedAt = new Date(data.endedAt);
    if (endedAt <= startedAt) throw new ApiError(422, "Sluttiden måste vara efter starttiden.");
    const durationSec = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
    if (durationSec > 24 * 60 * 60) throw new ApiError(422, "En enskild tidpost får vara högst 24 timmar.");
    const [taskRow, controlRow] = await Promise.all([
      prisma.workflowTask.findFirst({ where: { id: data.taskId, organizationId: ctx.organizationId }, select: taskSelect }),
      prisma.control.findFirst({ where: { id: data.taskId, organizationId: ctx.organizationId, deletedAt: null }, select: controlSelect }),
    ]);
    const task = sourceOf({ task: taskRow, control: taskRow ? null : controlRow });
    requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "edit");
    // Changing the task moves the entry, and with it the time, to that task's project.
    const owner = task.control ? { taskId: null, controlId: task.id } : { taskId: task.id, controlId: null };

    if (data.id) {
      const current = await findEntry(data.id);
      if (!current) throw new ApiError(404, "Tidposten hittades inte.");
      requireWorkflowPermission(ctx, workflowSubjectForTask(current.source.kind, current.source.formArea), "edit");
      const reason = checkCorrection({ actorIsAdmin: ctx.admin, actorOwnsEntry: current.userId === ctx.user.id, source: taskState(current.source), target: taskState(task) }, input.reason);
      const next = { startedAt, endedAt, durationSec, note: data.note };
      await prisma.$transaction([
        prisma.workflowTimeEntry.update({ where: { id: current.id }, data: { ...owner, ...next } }),
        prisma.workflowTimeEntryEvent.create({ data: { organizationId: ctx.organizationId, entryId: current.id, userId: current.userId, action: "UPDATED", previous: json(snapshot(current, current.source)), next: json(snapshot(next, task)), reason, actorUserId: ctx.user.id, actorName } }),
      ]);
      return NextResponse.json({ id: current.id });
    }

    const ownerId = data.userId ?? ctx.user.id;
    if (ownerId !== ctx.user.id) {
      requireAdmin(ctx);
      const owner = await prisma.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, userId: ownerId, isActive: true, user: { isActive: true } }, select: { id: true } });
      if (!owner) throw new ApiError(400, "Medarbetaren tillhör inte arbetsytan.");
    }
    const reason = checkCorrection({ actorIsAdmin: ctx.admin, actorOwnsEntry: ownerId === ctx.user.id, target: taskState(task) }, input.reason);
    const created = await prisma.$transaction(async (tx) => {
      const entry = await tx.workflowTimeEntry.create({ data: { ...owner, userId: ownerId, startedAt, endedAt, durationSec, note: data.note }, select: { id: true } });
      await tx.workflowTimeEntryEvent.create({ data: { organizationId: ctx.organizationId, entryId: entry.id, userId: ownerId, action: "CREATED", next: json(snapshot({ startedAt, endedAt, durationSec, note: data.note }, task)), reason, actorUserId: ctx.user.id, actorName } });
      return entry;
    });
    return NextResponse.json(created);
  } catch (error) {
    return failure(error);
  }
}
