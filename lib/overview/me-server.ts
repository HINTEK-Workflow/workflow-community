import { prisma } from "@/lib/db";
import { organizationModuleOn } from "@/lib/workflow/modules";
import type { Context } from "@/lib/kfid/server";
import { loadScheduleViews } from "@/lib/kfid/rounds-server";
import { loadMeAbsence } from "@/lib/absence/server";
import { addSwedishDays, fromSwedishDateInput, swedishDayKey } from "@/lib/swedish-time";
import { capacityWeek } from "@/lib/workflow/capacity-summary";
import type { ScheduleView } from "@/lib/workflow/form-schedule";
import { myDayJobHref } from "@/lib/workflow/my-day";
import { loadMyDay, mineTaskSql } from "@/lib/workflow/my-day-server";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { canReadRounds, hasWorkflowPermission, readableTaskScope, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskSql } from "@/lib/workflow/task-access";
import { timeEntryInOrganization } from "@/lib/workflow/timer-server";
import { ME_NEXT_ROWS, ME_ROWS, meChip, MY_DEVIATIONS_HREF, OVERDUE_TASKS_HREF, planMonth, ROUNDS_ATTENTION_HREF, type MeTabData } from "./me";
import { buildPlan, notDoneSummary, timeLine, todayLines, weekSummary, type PlanWorkOrder, type TimeEntryLine } from "./me-plan";
import { timeTypeRules } from "@/lib/workflow/time-types-server";
import { expectedWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";

/** Bounded reads (2026-09-26): Min plan's month never reads more than this per source. */
const PLAN_LIMIT = 400;

/**
 * Översiktens Jag (dashboard etapp 6–7, 2026-10-28) – GET /api/overview?tab=me. Only the signed-in person's own work,
 * inside the company and the person's read rights: Gör detta nu, Förfallet and Mina avvikelser are Hem's loadMyDay (the
 * same rules and SQL as the lists), the rounds are read once for Förfallet, Ej utfört and Min plan, and everything else
 * is a bounded read in parallel. Jag is everyone's tab, so it never throws 403; a part the person may not read is null.
 */
export async function loadMeTab(ctx: Context, now: Date, options: { month?: string | null } = {}): Promise<MeTabData> {
  // Företagets moduler (0.39.0): Jag stops counting what the company has turned off.
  const timeOn = organizationModuleOn(ctx.organization, "time");
  const today = swedishDayKey(now);
  const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  const readsTasks = readableTaskScope(can).any;
  const readsRounds = canReadRounds(ctx.admin, ctx.workflowPermissions) && organizationModuleOn(ctx.organization, "rounds");
  const week = capacityWeek(now);
  const user = { id: ctx.user.id, admin: ctx.admin };
  const views = readRounds(ctx, today);
  const [myDay, rounds, drafts, entries, last, member, plan, absence, { countsAsWork }] = await Promise.all([
    loadMyDay(ctx, ["next", "overdue", "deviations"], now, { rows: ME_ROWS, nextRows: ME_NEXT_ROWS, scheduleViews: views }),
    views,
    readsTasks ? loadDrafts(ctx, can) : Promise.resolve(null),
    !timeOn ? [] : prisma.workflowTimeEntry.findMany({
      where: { userId: ctx.user.id, startedAt: { gte: week.startsAt, lt: week.endsAt }, AND: [timeEntryInOrganization(ctx.organizationId)] },
      select: TIME_LINE_SELECT, take: 1000,
    }),
    // Where I last had time (Översiktens lyft, 2026-10-29): only my own entries, inside the company.
    !timeOn ? null : prisma.workflowTimeEntry.findFirst({
      where: { userId: ctx.user.id, AND: [timeEntryInOrganization(ctx.organizationId)] }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], select: TIME_LINE_SELECT,
    }),
    prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: ctx.user.id } }, select: { weeklyWorkMinutes: true, noFixedHours: true } }),
    loadMePlan(ctx, now, options.month, views),
    // Frånvaro (2026-10-29): my own absence from today on; everyone registers their own.
    timeOn ? loadMeAbsence(ctx, now) : null,
    // Beslut 8 (2026-11-01): only worked time counts against the ordinary week.
    timeTypeRules(ctx.organizationId),
  ]);
  const overdue = myDay.overdue ? { ...myDay.overdue, tasksHref: OVERDUE_TASKS_HREF, roundsHref: ROUNDS_ATTENTION_HREF } : null;
  return {
    today,
    chip: meChip(overdue),
    next: myDay.next ?? null,
    overdue,
    deviations: myDay.deviations ? { ...myDay.deviations, mineHref: MY_DEVIATIONS_HREF } : null,
    drafts,
    notDone: readsRounds ? notDoneSummary(rounds, user) : null,
    absence,
    // Ingen fast arbetstid (2026-10-30): no ordinary time (0).
    week: weekSummary(entries.filter((entry) => countsAsWork(entry.timeTypeId)), week.startsAt, expectedWeeklyWorkMinutes(ctx.organization.weeklyWorkMinutes, { weeklyWorkMinutes: member?.weeklyWorkMinutes, noFixedHours: member?.noFixedHours }), now),
    recent: last ? timeLine(lineOf(last), now) : null,
    todayEntries: todayLines(entries.map(lineOf), today, now),
    plan,
  };
}

const TIME_LINE_SELECT = {
  id: true, startedAt: true, endedAt: true, durationSec: true, taskId: true, projectId: true, timeTypeId: true,
  task: { select: { title: true, kind: true } }, sourceTask: { select: { title: true } }, project: { select: { name: true } },
} as const;
type TimeLineRow = { id: string; startedAt: Date; endedAt: Date | null; durationSec: number; taskId: string | null; projectId: string | null; timeTypeId: string | null;
  task: { title: string; kind: string } | null; sourceTask: { title: string } | null; project: { name: string } | null };
/** The entry with what it was on: the task it was written in (else its work order), or the project's own time. */
const lineOf = (entry: TimeLineRow): TimeEntryLine => ({
  id: entry.id, startedAt: entry.startedAt, endedAt: entry.endedAt, durationSec: entry.durationSec,
  title: entry.sourceTask?.title || entry.task?.title || entry.project?.name || "Tid",
  kind: entry.taskId ? entry.task?.kind ?? "WORK_ORDER" : null, ownerId: entry.taskId ?? entry.projectId ?? "",
});

/** The readable rounds (Cloud's round read without deviations and places), or none without the right to read rounds. */
function readRounds(ctx: Context, today: string): Promise<ScheduleView[]> {
  return canReadRounds(ctx.admin, ctx.workflowPermissions) && organizationModuleOn(ctx.organization, "rounds") ? loadScheduleViews(ctx, today, { deviations: false, places: false }) : Promise.resolve([]);
}

/**
 * Min plan for one month (`?tab=me&part=plan&month=YYYY-MM` when the person steps to another month, so only the plan is
 * read again): my work orders, bookings, rounds and projects' end dates (lib/overview/me-plan.ts buildPlan).
 */
export async function loadMePlan(ctx: Context, now: Date, asked: string | null | undefined, views?: Promise<ScheduleView[]>): Promise<MeTabData["plan"]> {
  const today = swedishDayKey(now);
  const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  const month = planMonth(asked, today);
  const [rounds, workOrders, activities, projects] = await Promise.all([
    views ?? readRounds(ctx, today),
    can("work-order") ? loadPlanWorkOrders(ctx, month) : Promise.resolve([]),
    organizationModuleOn(ctx.organization, "planning") ? loadPlanActivities(ctx, month) : [],
    can("projects") && organizationModuleOn(ctx.organization, "projects")
      ? prisma.project.findMany({
          where: { organizationId: ctx.organizationId, responsibleUserId: ctx.user.id, archivedAt: null, dueDate: { gte: month.from, lte: month.to } },
          select: { id: true, name: true, dueDate: true, closedAt: true, archivedAt: true }, take: PLAN_LIMIT,
        })
      : Promise.resolve([]),
  ]);
  return { ...month, items: buildPlan({ range: month, today, user: { id: ctx.user.id, admin: ctx.admin }, workOrders, activities, rounds, projects }) };
}

/**
 * Utkast utan arbetsorder (2026-10-27): my readable tasks without a work order that are still Planerad – each must be
 * linked (Koppla, on the task page) before the work starts. One count and the first rows in a single query.
 */
async function loadDrafts(ctx: Context, can: (subject: WorkflowPermissionSubject) => boolean): Promise<MeTabData["drafts"]> {
  const rows = await prisma.$queryRaw<{ id: string; kind: string; title: string; dueDate: string | null; total: bigint | number }[]>`
    select t.id, t.kind, t.title, t."dueDate", count(*) over () as total
    from "WorkflowTask" t
    where t."organizationId" = ${ctx.organizationId} and t.kind <> 'WORK_ORDER' and t."workOrderId" is null and t.status = 'PLANNED'
      and ${readableTaskSql(can)} and ${mineTaskSql(ctx)}
    order by nullif(t."dueDate", '') asc nulls last, t."updatedAt" desc, t.id
    limit ${ME_ROWS}`;
  return {
    count: Number(rows[0]?.total ?? 0),
    rows: rows.map((row) => ({ id: row.id, title: row.title, detail: row.dueDate || "Saknar arbetsorder", href: myDayJobHref(row.id, row.kind) })),
  };
}

/** My work orders whose Start or Klart senast falls in the month (Mina, as the Jobb list). */
function loadPlanWorkOrders(ctx: Context, month: { from: string; to: string }) {
  return prisma.$queryRaw<PlanWorkOrder[]>`
    select t.id, t.title, t.status, t."dueDate", t."plannedStartDate"
    from "WorkflowTask" t
    where t."organizationId" = ${ctx.organizationId} and t.kind = 'WORK_ORDER' and t.status <> 'CANCELLED' and ${mineTaskSql(ctx)}
      and ((t."plannedStartDate" between ${month.from} and ${month.to}) or (coalesce(t."plannedStartDate", '') = '' and t."dueDate" between ${month.from} and ${month.to}))
    order by t.id
    limit ${PLAN_LIMIT}`;
}

/** My bookings that touch the month, filtered by the booking read rule (lib/workflow/planned-activity-access.ts). */
async function loadPlanActivities(ctx: Context, month: { from: string; to: string }) {
  // planMonth always gives real days, so the parse never fails.
  const startsAt = fromSwedishDateInput(month.from)!;
  const endsAt = addSwedishDays(fromSwedishDateInput(month.to)!, 1);
  const rows = await prisma.plannedActivity.findMany({
    where: {
      organizationId: ctx.organizationId, deletedAt: null, status: { not: "CANCELED" }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt },
      OR: [{ assignedToUserId: ctx.user.id }, { assignments: { some: { member: { userId: ctx.user.id } } } }],
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: PLAN_LIMIT,
    select: { id: true, title: true, status: true, startsAt: true, endsAt: true, projectId: true, workflowTask: { select: { id: true, kind: true, formArea: true, title: true, status: true, projectId: true } } },
  });
  return rows.filter((row) => canReadPlannedActivity(ctx.workflowPermissions, ctx.admin, row));
}
