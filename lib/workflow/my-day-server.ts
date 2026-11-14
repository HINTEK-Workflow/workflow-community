import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Context } from "@/lib/kfid/server";
import { loadScheduleViews } from "@/lib/kfid/rounds-server";
import type { ScheduleView } from "./form-schedule";
import { deviationReadWhere, selfInspectionAccess } from "@/lib/self-inspection/model";
import { addSwedishDays, startOfSwedishDay, swedishDayKey } from "@/lib/swedish-time";
import { dormantDay, notDormantSql } from "@/lib/maintenance/plan-server";
import { organizationModuleOn } from "./modules";
import { MACHINE_ALARM_CHANNEL, MACHINE_ALARM_LIMIT, parseAlarmKey } from "@/lib/machine/alarm-notice";
import { canReadRounds, canViewTeam, hasWorkflowPermission, readableTaskScope, type WorkflowPermissionSubject } from "./permissions";
import { readableTaskSql } from "./task-access";
import { workOrderPrioritySql } from "@/lib/maintenance/work-order-sql";
import { timeEntryInOrganization } from "./timer-server";
import { CLOSED_TASK_STATUSES } from "./task-cancel";
import { deviationSummary, myRounds, nextSummary, overdueSummary, type MyDayAnswer, type MyDayDeviation, type MyDayRound, type MyDayTask, type MyDayTile } from "./my-day";

/** At most this many of the person's open jobs are read for Hem (bounded reads, 2026-09-26). */
const TASK_LIMIT = 1000;
const DEVIATION_LIMIT = 500;

/**
 * GET /api/my-day (dashboard etapp 2, 2026-10-28): only what the asked tiles need, for the signed-in person only –
 * their own jobs ("Mina": assigned, created with nobody assigned, or booked, the same SQL as the Jobb list), their own rounds
 * and the deviations they are responsible for. Every read is inside the company and the person's read rights: jobs by
 * readableTaskSql, rounds by canReadRounds and the readable schedules, the deviation log by selfInspectionAccess. A tile the
 * person may not use answers null.
 */
export async function loadMyDay(ctx: Context, tiles: readonly MyDayTile[], now = new Date(), options: {
  /** Rows per tile (default MY_DAY_ROWS); Översikten's Jag shows a few more by the same rules (2026-10-28). */
  rows?: number;
  /** Rows of Gör detta nu when it differs (Översiktens Jag fills the height of Tid, 2026-10-29). */
  nextRows?: number;
  /** The readable rounds when the caller reads them anyway (Översikten's Jag), so one request reads them once. */
  scheduleViews?: Promise<ScheduleView[]>;
} = {}): Promise<MyDayAnswer> {
  const today = startOfSwedishDay(now);
  const todayKey = swedishDayKey(now);
  const asked = new Set(tiles);
  const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  const readsTasks = readableTaskScope(can).any;
  // Företagets moduler (0.39.0): Hem stops counting rounds while Driftronder is off.
  const readsRounds = canReadRounds(ctx.admin, ctx.workflowPermissions) && organizationModuleOn(ctx.organization, "rounds");
  const readsDeviations = selfInspectionAccess({ active: true, admin: ctx.admin }).read;
  const wantsWork = (asked.has("next") || asked.has("overdue")) && (readsTasks || readsRounds);
  const wantsNext = asked.has("next") && (readsTasks || readsRounds);
  const wantsDeviations = readsDeviations && (asked.has("deviations") || wantsNext);

  const [facts, rounds, deviations] = await Promise.all([
    wantsNext && readsTasks ? loadFacts(ctx, today, ctx.admin || can("maintenance")) : Promise.resolve({ running: new Set<string>(), alarms: new Set<string>(), bookedToday: new Set<string>() }),
    wantsWork && readsRounds
      ? (options.scheduleViews ?? loadScheduleViews(ctx, todayKey, { deviations: false, places: false })).then((views) => myRounds(views, { id: ctx.user.id, admin: ctx.admin }, todayKey))
      : Promise.resolve([] as MyDayRound[]),
    wantsDeviations ? loadDeviations(ctx) : Promise.resolve([] as MyDayDeviation[]),
  ]);
  const tasks = wantsWork && readsTasks ? await loadTasks(ctx, can, [...facts.running, ...facts.alarms]) : [];
  return {
    today: todayKey,
    ...(asked.has("next") ? { next: wantsNext ? nextSummary(tasks, rounds, deviations, facts, todayKey, options.nextRows ?? options.rows) : null } : {}),
    ...(asked.has("overdue") ? { overdue: wantsWork ? overdueSummary(tasks, rounds, todayKey, options.rows) : null } : {}),
    ...(asked.has("deviations") ? { deviations: readsDeviations ? deviationSummary(deviations, todayKey, options.rows) : null } : {}),
  };
}

/**
 * "Mina" exactly as app/api/work-items, for the task alias `t`: assigned to me, created by me with nobody assigned, or
 * booked on me. Shared with Översikten's Jag (lib/overview/me-server.ts), so both count the same jobs.
 */
export function mineTaskSql(ctx: { organizationId: string; user: { id: string } }) {
  const bookedTasks = Prisma.sql`select pa."workflowTaskId" from "PlannedActivity" pa
    where pa."organizationId" = ${ctx.organizationId} and pa."workflowTaskId" is not null and pa."deletedAt" is null and pa.status <> 'CANCELED'
      and (pa."assignedToUserId" = ${ctx.user.id} or exists (select 1 from "PlannedActivityAssignment" a join "OrganizationMember" m on m.id = a."memberId" and m."organizationId" = a."organizationId"
        where a."plannedActivityId" = pa.id and a."organizationId" = pa."organizationId" and m."userId" = ${ctx.user.id}))`;
  return Prisma.sql`(t."assignedToUserId" = ${ctx.user.id} or (t."assignedToUserId" is null and t."createdBy" = ${ctx.user.id}) or t.id in (${bookedTasks}))`;
}

/** The person's open readable jobs: their own (isMine), and the ones they time or were alarmed about (`extra`). */
async function loadTasks(ctx: Context, can: (subject: WorkflowPermissionSubject) => boolean, extra: readonly string[]): Promise<MyDayTask[]> {
  const mineTask = mineTaskSql(ctx);
  const others = extra.length ? Prisma.sql`or t.id in (${Prisma.join([...new Set(extra)])})` : Prisma.empty;
  return prisma.$queryRaw<MyDayTask[]>`
    select t.id, t.kind, t.title, t.status, t.progress, t."dueDate", t."plannedStartDate", t."updatedAt",
      coalesce(${mineTask}, false) as "isMine",
      case when t.kind = 'WORK_ORDER' then ${workOrderPrioritySql} end as priority,
      t.data->'obstacle' as obstacle, t.data->'details'->>'waitingOn' as "waitingOn",
      case when c."customerType" = 'PRIVATE' then c.name else coalesce(nullif(c.company, ''), c.name) end as "customerName", f.name as "placeName"
    from "WorkflowTask" t
      left join "Customer" c on c.id = t."customerId" and c."organizationId" = t."organizationId"
      left join "CustomerFacility" f on f.id = t."facilityId" and f."organizationId" = t."organizationId"
    where t."organizationId" = ${ctx.organizationId} and t.status not in (${Prisma.join([...CLOSED_TASK_STATUSES])}) and ${readableTaskSql(can)}
      and ${notDormantSql("t", dormantDay(ctx.organization, swedishDayKey(new Date())))}
      and (${mineTask} ${others})
    order by nullif(t."dueDate", '') asc nulls last, t."updatedAt" desc, t.id
    limit ${TASK_LIMIT}`;
}

/**
 * The jobs whose timer the person runs, the jobs of their machine alarms, and the jobs they are booked on today. An open alarm
 * order nobody is responsible for is always one of the alarms for those an alarm may reach (an administrator, or with read on
 * Underhåll), even with the notice choice Maskinlarm off: the choice steers notices, e-mail and push only (kundresa 2026-11-07, M23).
 */
async function loadFacts(ctx: Context, today: Date, readsMachines: boolean) {
  const tomorrow = addSwedishDays(today, 1);
  const [running, alarms, booked, unclaimed] = await Promise.all([
    prisma.workflowTimeEntry.findMany({ where: { userId: ctx.user.id, endedAt: null, taskId: { not: null }, AND: [timeEntryInOrganization(ctx.organizationId)] }, take: 10, select: { taskId: true } }),
    prisma.noticeDelivery.findMany({ where: { organizationId: ctx.organizationId, userId: ctx.user.id, channel: MACHINE_ALARM_CHANNEL }, orderBy: { createdAt: "desc" }, take: MACHINE_ALARM_LIMIT, select: { key: true } }),
    prisma.plannedActivity.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, workflowTaskId: { not: null }, status: { notIn: ["CANCELED", "COMPLETED"] }, startsAt: { lt: tomorrow }, endsAt: { gt: today },
        OR: [{ assignedToUserId: ctx.user.id }, { assignments: { some: { member: { userId: ctx.user.id } } } }] },
      take: 200, select: { workflowTaskId: true },
    }),
    readsMachines ? unclaimedAlarmOrders(ctx.organizationId) : Promise.resolve([] as string[]),
  ]);
  return {
    running: new Set(running.flatMap((entry) => entry.taskId ? [entry.taskId] : [])),
    alarms: new Set([...alarms.flatMap((row) => parseAlarmKey(row.key)?.taskId ?? []), ...unclaimed]),
    bookedToday: new Set(booked.flatMap((row) => row.workflowTaskId ? [row.workflowTaskId] : [])),
  };
}

/** The open work orders a machine alarm made that nobody is responsible for yet (bounded, the newest first). */
export async function unclaimedAlarmOrders(organizationId: string): Promise<string[]> {
  const rows = await prisma.machineAlarmOrder.findMany({ where: { organizationId, status: "created", taskId: { not: null } }, orderBy: { createdAt: "desc" }, take: MACHINE_ALARM_LIMIT, select: { taskId: true } });
  const ids = [...new Set(rows.flatMap((row) => row.taskId ? [row.taskId] : []))];
  if (!ids.length) return [];
  const open = await prisma.workflowTask.findMany({ where: { organizationId, id: { in: ids }, assignedToUserId: null, status: { notIn: [...CLOSED_TASK_STATUSES] } }, select: { id: true } });
  return open.map((task) => task.id);
}

/** The open entries of the deviation log the person is responsible for (also for an admin: their own, never the team's). */
async function loadDeviations(ctx: Context): Promise<MyDayDeviation[]> {
  return prisma.selfInspectionDeviation.findMany({
    // A near miss or an accident only for those who may read it (lib/self-inspection/incidents.ts, 2026-10-30).
    where: { organizationId: ctx.organizationId, responsibleUserId: ctx.user.id, status: { in: ["OPEN", "IN_PROGRESS"] }, AND: [deviationReadWhere({ id: ctx.user.id, admin: ctx.admin, team: canViewTeam(ctx) })] },
    orderBy: { number: "desc" }, take: DEVIATION_LIMIT,
    select: { id: true, number: true, title: true, status: true, category: true, dueDate: true },
  });
}
