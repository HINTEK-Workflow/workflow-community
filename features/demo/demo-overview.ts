import { canBookJob } from "@/lib/workflow/planned-activity-access";
import { isLateStart, isLateTask } from "@/lib/workflow/late-tasks";
import { addSwedishDays, fromSwedishDateInput, startOfSwedishDay, startOfSwedishMonth, swedishDayKey } from "@/lib/swedish-time";
import { listHref } from "@/lib/url-filters";
import { capacityWeek, type CapacityActivity } from "@/lib/workflow/capacity-summary";
import { capacityLoads, type PlanningRound } from "@/lib/workflow/planning-rounds";
import { companyGoalsOf, visibleCompanyGoals } from "@/lib/workflow/company-goals";
import type { ScheduleView } from "@/lib/workflow/form-schedule";
import { deviationSummary, myDayJobHref, myRounds, nextSummary, overdueSummary, type MyDayDeviation, type MyDayTask } from "@/lib/workflow/my-day";
import { overviewKpiHref } from "@/lib/workflow/overview-kpis";
import { canReadRounds, canViewEconomy, readableTaskScope, workflowSubjectForTask, type WorkflowPermissionAction, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { projectAttention, type ProjectAttentionInput } from "@/lib/workflow/project-filters";
import { riskCheckOf } from "@/lib/workflow/risk-step";
import { addDays, isoWeek } from "@/lib/workflow/schedule";
import { CLOSED_TASK_STATUSES } from "@/lib/workflow/task-cancel";
import { workflowTaskProgress } from "@/lib/workflow/task-model";
import { DEVIATION_KINDS, deviationHref, isDeviationOverdue, selfInspectionAccess } from "@/lib/self-inspection/model";
import { quoteLabel, quoteTotals } from "@/lib/quotes/model";
import { invoiceBasisTotals, timeSourceKey } from "@/lib/invoice-basis/model";
import { ME_NEXT_ROWS, ME_ROWS, meChip, MY_DEVIATIONS_HREF, OVERDUE_TASKS_HREF, planMonth, ROUNDS_ATTENTION_HREF, type MeTabData } from "@/lib/overview/me";
import { buildPlan, notDoneSummary, timeLine, todayLines, weekSummary, type TimeEntryLine } from "@/lib/overview/me-plan";
import { ageInDays, awaitsWorkOrder, countDeviations, nowPeople, projectRows, riskSection, roundSafetyChanged, selectRiskBeforeStart, teamLoadPeople, teamLoadWindows, teamTabAccess } from "@/lib/overview/team-model";
import { workStateMatches, workStateOf } from "@/lib/workflow/work-list";
import { jobObstacle, obstacleText } from "@/lib/workflow/obstacles";
import type { TeamTabData } from "@/lib/overview/team-server";
import {
  QUOTE_EXPIRY_WINDOW_DAYS, companyEstimate, daysUntil, economyAccess, hourlyRateOf, invoicedPerMonth, mergeUnbilled, monthKeys, monthLong, quoteWinRate, unbilledMaterialGroups, unbilledRows,
  type EconomyTabData, type MoneyCount, type UnbilledGroup,
} from "@/lib/overview/economy-model";
import { materialsFromData } from "@/lib/invoice-basis/model";
import {
  actionTotal, attentionCustomers, customerTotals, customersAccessRights, customersChip, customersTabAccess, deviationStats, invoiceStats, mergeCustomerFigures, quoteAnswerState, quoteStats,
  sortActionRows, sortUpcomingRows, upcomingDay, workOrderState, workOrderStats, LAPSED_ROWS, lapsedCustomers, type CustomerActionRow,
} from "@/lib/overview/customers-model";
import { CUSTOMERS_LINKS } from "@/lib/overview/customers-model";
import type { CustomersTabData } from "@/lib/overview/customers-server";
import { isLoadedOverviewTab, overviewChip, overviewTabs, type OverviewAnswer } from "@/lib/overview/tabs";
import { demoOrderSummary, type DemoDatabase, type DemoProject, type DemoTask, type DemoUser } from "./demo-data";
import { absenceLabel, absenceOn, absentShare, countsInPlanning, firstDayBack } from "@/lib/workflow/absence";
import { expectedWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import { demoAbsenceView, demoAffected } from "./demo-absence";
import { demoCompetenceSources } from "./demo-self-inspection";
import { checkedWorkdays, expiringItems, timeGaps, unownedWork } from "@/lib/overview/team-followup";
import { demoHourlyRate, demoQuoteRecords } from "./demo-quotes";
import { demoInvoiceBasisRecords } from "./demo-invoice-bases";
import { demoDeviationEntries } from "./demo-self-inspection";
import { customerContact, customerTitle } from "@/lib/kfid/customer-name";

/**
 * Översikten i demon (2026-10-29): GET /api/overview?tab=me|team|economy|customers answered from memory, in the same shape
 * as Cloud's route (app/api/overview) and with the same pure rules (lib/overview/*-model.ts, me-plan.ts, lib/workflow/my-day.ts)
 * and the same permission matrix (lib/overview/tabs.ts). Only the reads are the demo's own: the invented tasks, bookings,
 * rounds, quotes, invoice bases and deviation log. The demo has no AI credits, so Ekonomi shows none.
 */
export class DemoOverviewError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** The reader as the deviation log's rule sees them (a near miss or an accident: reporter, admins, Teamet). */
const deviationReader = (ctx: DemoOverviewContext) => ({ id: ctx.user.id, admin: ctx.admin, team: ctx.admin || ctx.can("team", "read") });
export type DemoOverviewContext = {
  db: DemoDatabase; user: DemoUser; admin: boolean; now: Date;
  can: (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => boolean;
  /** The readable rounds as the round views read them (the demo's own /api/form-schedules). */
  roundViews: () => ScheduleView[];
  /** The readable rounds' occurrences in a period (the demo's own /api/form-schedules?planning=1), for Belastning. */
  planningRounds: (period: { from: string; to: string }) => PlanningRound[];
  /** The jobs booked on the signed-in person. */
  booked: ReadonlySet<string>;
  /** A project's status, budget and reported time for the attention rule. */
  attention: (project: DemoProject) => ProjectAttentionInput;
};

const ROWS = 6;
const CUSTOMER_ROWS = 15;
const CUSTOMER_LIST_ROWS = 8;
const taskHref = (id: string, kind: string) => `/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=${kind}`;
const customerName = (customer: { name: string; company: string } | null | undefined) => customer ? customerTitle(customer) : "";
const canRead = (ctx: DemoOverviewContext) => (subject: WorkflowPermissionSubject) => ctx.admin || ctx.can(subject, "read");
const readableTasks = (ctx: DemoOverviewContext) => ctx.db.tasks.filter((task) => canRead(ctx)(workflowSubjectForTask(task.kind)));
/** "Mina" as Cloud's mineTaskSql: assigned to me, created by me with nobody assigned, or booked on me. */
const isMine = (ctx: DemoOverviewContext, task: DemoTask) =>
  task.assignedToUserId === ctx.user.id || (!task.assignedToUserId && task.createdBy === ctx.user.id) || ctx.booked.has(task.id);
const activityTask = (ctx: DemoOverviewContext, id: string | null) => { const task = id ? ctx.db.tasks.find((item) => item.id === id) : undefined; return task ? { id: task.id, kind: task.kind, title: task.title, status: task.status, projectId: task.projectId } : null; };
const readableActivities = (ctx: DemoOverviewContext) => ctx.db.activities.filter((activity) => !activity.deletedAt
  && canReadPlannedActivity(ctx.user.permissions, ctx.admin, { projectId: activity.projectId, workflowTask: activityTask(ctx, activity.workflowTaskId) }));
const bookedOn = (activity: DemoDatabase["activities"][number], userId: string) => activity.assignments.some((item) => item.userId === userId);
const customerOf = (ctx: DemoOverviewContext, id: string | null | undefined) => id ? ctx.db.customers.find((item) => item.id === id && !item.deletedAt) : undefined;

export async function demoOverview(ctx: DemoOverviewContext, url: URL): Promise<OverviewAnswer> {
  const tab = url.searchParams.get("tab") ?? "me";
  if (!isLoadedOverviewTab(tab)) throw new DemoOverviewError(400, "Okänd flik.");
  const tabs = overviewTabs({ admin: ctx.admin, workflowPermissions: ctx.user.permissions });
  if (!tabs[tab]) throw new DemoOverviewError(403, "Du saknar behörighet till fliken.");
  const data = tab === "me" ? (url.searchParams.get("part") === "plan" ? { plan: mePlan(ctx, url.searchParams.get("month")) } : await meTab(ctx, url.searchParams.get("month")))
    : tab === "team" ? await teamTab(ctx)
    : tab === "economy" ? economyTab(ctx)
    : await customersTab(ctx);
  const chip = overviewChip(data);
  return { tab, tabs, chips: chip === null ? {} : { [tab]: chip }, data };
}

// ---------- Jag ----------

async function meTab(ctx: DemoOverviewContext, month: string | null): Promise<MeTabData> {
  const now = ctx.now;
  const today = swedishDayKey(now);
  const can = canRead(ctx);
  const readsTasks = readableTaskScope(can).any;
  const readsRounds = canReadRounds(ctx.admin, ctx.user.permissions);
  const readsDeviations = selfInspectionAccess({ active: true, admin: ctx.admin }).read;
  const user = { id: ctx.user.id, admin: ctx.admin };
  const views = readsRounds ? ctx.roundViews() : [];
  const rounds = readsRounds ? myRounds(views, user, today) : [];
  // The facts behind Gör detta nu: the jobs I time and the jobs I am booked on today (the demo has no machine alarms).
  const running = new Set(ctx.db.timeEntries.flatMap((entry) => entry.userId === ctx.user.id && !entry.endedAt && entry.taskId ? [entry.taskId] : []));
  const dayStart = startOfSwedishDay(now).getTime();
  const dayEnd = addSwedishDays(startOfSwedishDay(now), 1).getTime();
  const bookedToday = new Set(ctx.db.activities.flatMap((activity) => !activity.deletedAt && activity.workflowTaskId && activity.status !== "CANCELED" && activity.status !== "COMPLETED"
    && Date.parse(activity.startsAt) < dayEnd && Date.parse(activity.endsAt) > dayStart && bookedOn(activity, ctx.user.id) ? [activity.workflowTaskId] : []));
  const facts = { running, alarms: new Set<string>(), bookedToday };
  const tasks: MyDayTask[] = readsTasks ? readableTasks(ctx)
    .filter((task) => !(CLOSED_TASK_STATUSES as readonly string[]).includes(task.status) && (isMine(ctx, task) || running.has(task.id)))
    .map((task) => {
      const summary = task.kind === "WORK_ORDER" ? demoOrderSummary(ctx.db, task) : null;
      return { id: task.id, kind: task.kind, title: task.title, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate || null, plannedStartDate: task.plannedStartDate || null,
        updatedAt: task.updatedAt, isMine: isMine(ctx, task), priority: summary?.priority || null, obstacle: (task.data as { obstacle?: unknown }).obstacle ?? null, waitingOn: summary?.waitingOn || null,
        // A private customer by name, a company by its company name (as Cloud's my-day read).
        customerName: (customerOf(ctx, task.customerId)?.customerType === "PRIVATE" ? customerOf(ctx, task.customerId)?.name : customerName(customerOf(ctx, task.customerId))) || null, placeName: ctx.db.facilities.find((place) => place.id === task.facilityId)?.name ?? null };
    }) : [];
  const deviations: MyDayDeviation[] = readsDeviations ? (await demoDeviationEntries(ctx.db, deviationReader(ctx)))
    .filter((entry) => entry.responsibleId === ctx.user.id && (entry.status === "OPEN" || entry.status === "IN_PROGRESS"))
    .sort((a, b) => b.number - a.number)
    .map((entry) => ({ id: entry.id, number: entry.number, title: entry.title, status: entry.status, category: entry.category, dueDate: entry.dueDate })) : [];
  const work = readsTasks || readsRounds;
  const overdueSummed = work ? overdueSummary(tasks, rounds, today, ME_ROWS) : null;
  const overdue = overdueSummed ? { ...overdueSummed, tasksHref: OVERDUE_TASKS_HREF, roundsHref: ROUNDS_ATTENTION_HREF } : null;
  const devSummed = readsDeviations ? deviationSummary(deviations, today, ME_ROWS) : null;
  const week = capacityWeek(now);
  const entries = ctx.db.timeEntries.filter((entry) => entry.userId === ctx.user.id && Date.parse(entry.startedAt) >= week.startsAt.getTime() && Date.parse(entry.startedAt) < week.endsAt.getTime());
  const last = ctx.db.timeEntries.filter((entry) => entry.userId === ctx.user.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))[0];
  return {
    today,
    chip: meChip(overdue),
    next: work ? nextSummary(tasks, rounds, deviations, facts, today, ME_NEXT_ROWS) : null,
    overdue,
    deviations: devSummed ? { ...devSummed, mineHref: MY_DEVIATIONS_HREF } : null,
    drafts: readsTasks ? drafts(ctx) : null,
    notDone: readsRounds ? notDoneSummary(views, user) : null,
    absence: { userId: ctx.user.id, mine: demoAbsenceView(ctx).filter((item) => item.mine).map(({ id, label, from, to, hours, type, note, byOther }) => ({ id, label, from, to, hours, type, note, byOther })) },
    week: weekSummary(entries, week.startsAt, expectedWeeklyWorkMinutes(ctx.db.organization.weeklyWorkMinutes, ctx.user), now),
    recent: last ? timeLine(lineOf(ctx, last), now) : null,
    todayEntries: todayLines(entries.map((entry) => lineOf(ctx, entry)), today, now),
    plan: mePlan(ctx, month, views),
  };
}

/** A time entry with what it was on, as Cloud's me-server lineOf. */
function lineOf(ctx: DemoOverviewContext, entry: DemoDatabase["timeEntries"][number]): TimeEntryLine {
  const task = entry.taskId ? ctx.db.tasks.find((item) => item.id === entry.taskId) : undefined;
  const source = entry.sourceTaskId ? ctx.db.tasks.find((item) => item.id === entry.sourceTaskId) : undefined;
  const project = entry.projectId ? ctx.db.projects.find((item) => item.id === entry.projectId) : undefined;
  return { id: entry.id, startedAt: entry.startedAt, endedAt: entry.endedAt, durationSec: entry.durationSec, title: source?.title || task?.title || project?.name || "Tid",
    kind: entry.taskId ? task?.kind ?? "WORK_ORDER" : null, ownerId: entry.taskId ?? entry.projectId ?? "" };
}

/** Utkast utan arbetsorder that are mine, as Cloud's loadDrafts. */
function drafts(ctx: DemoOverviewContext): MeTabData["drafts"] {
  const rows = readableTasks(ctx).filter((task) => task.kind !== "WORK_ORDER" && !task.workOrderId && task.status === "PLANNED" && isMine(ctx, task))
    .sort((a, b) => (a.dueDate || "￿").localeCompare(b.dueDate || "￿") || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return { count: rows.length, rows: rows.slice(0, ME_ROWS).map((task) => ({ id: task.id, title: task.title, detail: task.dueDate || "Saknar arbetsorder", href: myDayJobHref(task.id, task.kind) })) };
}

/** Min plan for one month, as Cloud's loadMePlan. */
function mePlan(ctx: DemoOverviewContext, asked: string | null, views?: ScheduleView[]): MeTabData["plan"] {
  const today = swedishDayKey(ctx.now);
  const can = canRead(ctx);
  const month = planMonth(asked, today);
  const rounds = views ?? (canReadRounds(ctx.admin, ctx.user.permissions) ? ctx.roundViews() : []);
  const inMonth = (day: string | null | undefined) => Boolean(day) && day! >= month.from && day! <= month.to;
  const workOrders = can("work-order") ? ctx.db.tasks.filter((task) => task.kind === "WORK_ORDER" && task.status !== "CANCELLED" && isMine(ctx, task)
    && (inMonth(task.plannedStartDate) || (!task.plannedStartDate && inMonth(task.dueDate))))
    .map((task) => ({ id: task.id, title: task.title, status: task.status, dueDate: task.dueDate || null, plannedStartDate: task.plannedStartDate || null })) : [];
  // planMonth always gives real days, so the parse never fails (as Cloud's loadPlanActivities).
  const startsAt = fromSwedishDateInput(month.from)!.getTime();
  const endsAt = addSwedishDays(fromSwedishDateInput(month.to)!, 1).getTime();
  const activities = readableActivities(ctx).filter((activity) => activity.status !== "CANCELED" && bookedOn(activity, ctx.user.id)
    && Date.parse(activity.startsAt) < endsAt && Date.parse(activity.endsAt) > startsAt)
    .map((activity) => ({ id: activity.id, title: activity.title, status: activity.status, startsAt: activity.startsAt, endsAt: activity.endsAt, workflowTask: activityTask(ctx, activity.workflowTaskId), projectId: activity.projectId }));
  const projects = can("projects") ? ctx.db.projects.filter((project) => project.responsibleUserId === ctx.user.id && !project.archivedAt && inMonth(project.dueDate)) : [];
  return { ...month, items: buildPlan({ range: month, today, user: { id: ctx.user.id, admin: ctx.admin }, workOrders, activities, rounds, projects }) };
}

// ---------- Teamet ----------

async function teamTab(ctx: DemoOverviewContext): Promise<TeamTabData> {
  const access = teamTabAccess({ admin: ctx.admin, workflowPermissions: ctx.user.permissions });
  if (!access.team) throw new DemoOverviewError(403, "Du saknar behörighet att se Teamet.");
  const now = ctx.now;
  const today = swedishDayKey(now);
  const can = canRead(ctx);
  return {
    today,
    timeGaps: teamTimeGaps(ctx),
    unowned: access.workOrders ? teamUnowned(ctx, today) : null,
    expiring: await teamExpiring(ctx, today),
    now: teamNow(ctx),
    ...(readableTaskScope(can).any ? teamJobGroups(ctx, today, now) : { needsAction: null, overdueJobs: null, lateStarts: null }),
    absence: teamAbsence(ctx),
    load: teamLoad(ctx, access.rounds),
    riskBeforeStart: access.workOrders ? riskBeforeStart(ctx, today) : null,
    deviations: await teamDeviations(ctx, today, access.deviationsCompany),
    acceptedQuotes: access.quotes ? acceptedQuotes(ctx, access.prices) : null,
    projects: access.projects ? teamProjects(ctx) : null,
    rounds: access.rounds ? { notDone: ctx.roundViews().filter((view) => view.active).reduce((sum, view) => sum + view.overview.notDone, 0), late: ctx.roundViews().filter((view) => view.active).reduce((sum, view) => sum + view.overview.missed, 0), href: listHref("rounds", { attention: true }) } : null,
    safety: readableTaskScope(can).areas.length ? safety(ctx) : null,
  };
}

function teamLoad(ctx: DemoOverviewContext, withRounds: boolean): TeamTabData["load"] {
  const { windows, workdays, from, to } = teamLoadWindows(ctx.now);
  const readable: CapacityActivity[] = readableActivities(ctx)
    .filter((activity) => (activity.status === "PLANNED" || activity.status === "IN_PROGRESS") && Date.parse(activity.startsAt) < windows[1].endsAt.getTime() && Date.parse(activity.endsAt) > windows[0].startsAt.getTime())
    .map((activity) => ({
      startsAt: activity.startsAt, endsAt: activity.endsAt, assignedToUserId: activity.assignments[0]?.userId ?? null, assignments: activity.assignments,
      status: activity.status, projectId: activity.projectId, workflowTaskId: activity.workflowTaskId,
      workflowTask: activity.workflowTaskId ? { status: activityTask(ctx, activity.workflowTaskId)?.status ?? "" } : null,
    }));
  return {
    weeks: windows.map((window) => { const startsOn = swedishDayKey(window.startsAt); return { key: window.key, week: isoWeek(startsOn), startsOn, endsOn: addDays(startsOn, 6) }; }),
    // As Cloud: the one capacity count, rounds with beräknad tid and absence included.
    people: teamLoadPeople({ activities: capacityLoads(readable, withRounds ? ctx.planningRounds({ from, to }) : []), absences: ctx.db.absences, viewer: { id: ctx.user.id, admin: ctx.admin, team: true }, windows, workdays,
      members: [...ctx.db.users].sort((a, b) => a.name.localeCompare(b.name, "sv")).map((user) => ({ id: user.id, name: user.name, weeklyWorkMinutes: user.weeklyWorkMinutes ?? ctx.db.organization.weeklyWorkMinutes, noFixedHours: Boolean(user.noFixedHours) })) }),
    days: workdays.map((day) => swedishDayKey(day.startsAt)),
    href: "/?view=capacity",
  };
}

/** Punkt 1, as Cloud: the checked workdays' reported time per person against the day, away time counted off. */
function teamTimeGaps(ctx: DemoOverviewContext): NonNullable<TeamTabData["timeGaps"]> {
  const days = checkedWorkdays(swedishDayKey(ctx.now));
  return { days, href: "/?view=time", rows: timeGaps({ days, entries: ctx.db.timeEntries.filter((entry) => entry.endedAt), swedishDay: (value) => swedishDayKey(new Date(value)),
    members: ctx.db.users.filter((user) => !user.noFixedHours).map((user) => ({ id: user.id, name: user.name, dayMinutes: Math.round(expectedWeeklyWorkMinutes(ctx.db.organization.weeklyWorkMinutes, user) / 5) })),
    awayShare: (userId, day) => absentShare(ctx.db.absences, userId, day) }) };
}

/** Punkt 2, as Cloud: work orders without a responsible person, or awaiting a booking and starting within a week. */
function teamUnowned(ctx: DemoOverviewContext, today: string): NonNullable<TeamTabData["unowned"]> {
  const booked = new Set(ctx.db.activities.filter((activity) => !activity.deletedAt && activity.status !== "CANCELED" && activity.workflowTaskId).map((activity) => activity.workflowTaskId!));
  // A job already on Förfallet or Försenad start is counted there (beslut 15), as Cloud.
  const result = unownedWork({ today, workOrders: ctx.db.tasks.filter((task) => task.kind === "WORK_ORDER" && !isLateTask(task, today) && !isLateStart(task, today)).map((task) => {
    const project = task.projectId ? ctx.db.projects.find((item) => item.id === task.projectId) : null;
    return { id: task.id, title: task.title, status: task.status, progress: workflowTaskProgress(task), startedAt: task.startedAt, roundScheduleId: task.roundScheduleId ?? null, assignedToUserId: task.assignedToUserId,
      plannedStartDate: task.plannedStartDate ?? "", dueDate: task.dueDate ?? "", customerName: customerName(customerOf(ctx, task.customerId)), booked: booked.has(task.id),
      canBook: !project?.archivedAt && !project?.closedAt && canBookJob(ctx.user.permissions, ctx.admin, task.projectId, true) };
  }) });
  return { total: result.total, rows: result.rows.slice(0, ROWS) };
}

/** Punkt 3, as Cloud: trainings and licences (admins only) and instruments running out within 30 days. */
async function teamExpiring(ctx: DemoOverviewContext, today: string): Promise<NonNullable<TeamTabData["expiring"]>> {
  const sources = await demoCompetenceSources(ctx.db);
  const nameOf = (id: string) => ctx.db.users.find((user) => user.id === id)?.name ?? "Tidigare medarbetare";
  return { scope: ctx.admin ? "all" : "instruments", rows: expiringItems({ today,
    credentials: ctx.admin ? sources.credentials.map((item) => ({ id: item.id, personName: item.name || nameOf(item.personId), title: item.title, validUntil: item.validUntil ?? null, left: Boolean(item.leftAt) })) : [],
    licences: ctx.admin ? sources.cards.map((item) => ({ personId: item.personId, personName: item.name || nameOf(item.personId), validUntil: item.licenceValidUntil ?? null, left: Boolean((item as { leftAt?: string | null }).leftAt) })) : [],
    instruments: sources.instruments.map((item) => ({ id: item.id, name: item.name, nextCalibrationAt: item.nextCalibrationAt, active: item.active })) }).slice(0, ROWS * 2) };
}

/** Frånvaro in Teamet: who is away today, the work it touches with suggestions, and that this viewer registers for others. */
function teamAbsence(ctx: DemoOverviewContext): NonNullable<TeamTabData["absence"]> {
  const today = swedishDayKey(ctx.now);
  const viewer = { id: ctx.user.id, admin: ctx.admin, team: true };
  return {
    canRegister: true,
    // Only approved absence (2026-10-30), as Cloud: an applied one is never shown on Teamet.
    today: ctx.db.absences.filter((absence) => absence.from <= today && absence.to >= today && countsInPlanning(absence)).map((absence) => ({ userId: absence.userId, name: ctx.db.users.find((user) => user.id === absence.userId)?.name ?? "", label: absenceLabel(viewer, absence), to: absence.to })),
    affected: demoAffected(ctx),
  };
}

/** Just nu, as Cloud's loadNow: what each person's time runs on (within the viewer's read rights) and their time today. */
function teamNow(ctx: DemoOverviewContext): NonNullable<TeamTabData["now"]> {
  const can = canRead(ctx);
  const dayStart = startOfSwedishDay(ctx.now).getTime();
  const running = ctx.db.timeEntries.filter((entry) => !entry.endedAt).map((entry) => {
    const task = entry.taskId ? ctx.db.tasks.find((item) => item.id === entry.taskId) : undefined;
    const source = entry.sourceTaskId ? ctx.db.tasks.find((item) => item.id === entry.sourceTaskId) : undefined;
    const project = entry.projectId ? ctx.db.projects.find((item) => item.id === entry.projectId) : undefined;
    const readable = task ? can(workflowSubjectForTask(task.kind)) : project ? can("projects") : false;
    const shown = source ?? task;
    return { userId: entry.userId, startedAt: entry.startedAt, project: !entry.taskId,
      ...(readable && shown ? { kind: shown.kind, status: shown.status, progress: workflowTaskProgress(shown) } : {}),
      title: readable ? source?.title || task?.title || project?.name || "Arbete" : "Arbete",
      href: readable ? task ? taskHref(task.id, task.kind) : project ? `/?view=project&projectId=${encodeURIComponent(project.id)}` : null : null };
  });
  const today = swedishDayKey(ctx.now);
  // Away today (Frånvaro, 2026-10-29): the words and the first workday back.
  return { people: nowPeople([...ctx.db.users].map((user) => ({ id: user.id, name: user.name, dayMinutes: Math.round(expectedWeeklyWorkMinutes(ctx.db.organization.weeklyWorkMinutes, user) / 5) })), running, ctx.db.timeEntries.filter((entry) => Date.parse(entry.startedAt) >= dayStart), ctx.now).map((person) => {
    const absence = absenceOn(ctx.db.absences, person.id, today);
    return absence ? { ...person, absent: { label: absenceLabel({ id: ctx.user.id, admin: ctx.admin, team: true }, absence), backOn: firstDayBack(absence, ctx.db.absences) } } : person;
  }) };
}

/** Behöver åtgärdas, as Cloud's loadNeedsAction. */
/** Hinder, Förfallet and Försenad start with the job list's filters (workStateMatches), as the demo's list counts them. */
function teamJobGroups(ctx: DemoOverviewContext, today: string, now: Date) {
  const tasks = readableTasks(ctx);
  const facts = (task: (typeof tasks)[number]) => ({ state: workStateOf({ status: task.status, progress: workflowTaskProgress(task) }), status: task.status, dueDate: task.dueDate, plannedStartDate: task.plannedStartDate, progress: workflowTaskProgress(task), startedAt: task.startedAt,
    waitingOn: (task.data as { details?: { waitingOn?: string } } | null)?.details?.waitingOn });
  const group = (filter: "blocked" | "overdue" | "late_start", href: string, order: (a: (typeof tasks)[number], b: (typeof tasks)[number]) => number) => {
    const rows = tasks.filter((task) => workStateMatches(facts(task), filter, today)).sort((a, b) => order(a, b) || a.id.localeCompare(b.id));
    return { total: rows.length, href, rows: rows.slice(0, ROWS).map((task) => {
      const customer = customerOf(ctx, task.customerId);
      const obstacle = filter === "blocked" ? jobObstacle(task) : null;
      return { id: task.id, title: task.title, kind: task.kind, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate ?? "", plannedStartDate: task.plannedStartDate ?? "", responsibleName: task.assignedToName || null,
        customerName: customer ? customer.customerType === "PRIVATE" ? customer.name : customerName(customer) : "", href: taskHref(task.id, task.kind), ...(obstacle ? { obstacle: obstacleText(obstacle) } : {}) };
    }) };
  };
  return {
    needsAction: group("blocked", listHref("tasks", { type: "all", filter: "blocked", scope: "all" }), (a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    overdueJobs: group("overdue", overviewKpiHref("overdueTasks", "team", now), (a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
    lateStarts: group("late_start", listHref("tasks", { type: "all", filter: "late_start", scope: "all" }), (a, b) => (a.plannedStartDate ?? "").localeCompare(b.plannedStartDate ?? "")),
  };
}

function riskBeforeStart(ctx: DemoOverviewContext, today: string): TeamTabData["riskBeforeStart"] {
  const candidates = ctx.db.tasks.filter((task) => task.kind === "WORK_ORDER" && task.status !== "COMPLETED" && task.status !== "CANCELLED" && !task.startedAt
    && Boolean(task.plannedStartDate) && task.plannedStartDate! >= addDays(today, -60) && task.plannedStartDate! <= addDays(today, 7)
    && (task.data as { riskStep?: unknown }).riskStep === true);
  const selected = selectRiskBeforeStart(candidates.map((task) => {
    const extendedId = riskCheckOf(task.data)?.extendedTaskId;
    const extended = extendedId ? ctx.db.tasks.find((item) => item.id === extendedId) : undefined;
    return {
      id: task.id, title: task.title, kind: "WORK_ORDER", status: task.status, data: task.data, plannedStartDate: task.plannedStartDate ?? "", started: (workflowTaskProgress(task) ?? 0) > 0,
      customerName: customerName(customerOf(ctx, task.customerId)), extended: extended ? { id: extended.id, title: extended.title, status: extended.status, kind: extended.kind } : null,
    };
  }), today);
  const section = riskSection(selected, ROWS);
  return { ...section, rows: section.rows.map((row) => ({ ...row, href: taskHref(row.id, "WORK_ORDER") })) };
}

async function teamDeviations(ctx: DemoOverviewContext, today: string, company: boolean): Promise<TeamTabData["deviations"]> {
  const log = (filter: string) => `/?view=deviations&filter=${filter}`;
  const items = (await demoDeviationEntries(ctx.db, company ? undefined : deviationReader(ctx))).filter((item) => item.status !== "DONE");
  const facts = items.map((item) => ({ ...item, responsibleUserId: item.responsibleId }));
  const shown = [...items].sort((a, b) => Number(isDeviationOverdue(b, today)) - Number(isDeviationOverdue(a, today)) || (isDeviationOverdue(a, today) ? a.dueDate.localeCompare(b.dueDate) : 0) || a.createdAt.localeCompare(b.createdAt)).slice(0, ROWS);
  return {
    scope: company ? "company" : "own", counts: countDeviations(facts, today), links: { open: log("open"), overdue: log("overdue") },
    rows: shown.map((item) => ({
      id: item.id, label: `${DEVIATION_KINDS[item.kind === "IMPROVEMENT" ? "IMPROVEMENT" : "DEVIATION"]} ${item.number}`, title: item.title, dueDate: item.dueDate, status: item.status,
      overdue: isDeviationOverdue(item, today), responsibleName: item.responsibleId ? ctx.db.users.find((user) => user.id === item.responsibleId)?.name ?? "Tidigare medarbetare" : null,
      ageDays: ageInDays(swedishDayKey(item.createdAt), today), href: deviationHref(item.id),
    })),
  };
}

function acceptedQuotes(ctx: DemoOverviewContext, prices: boolean): TeamTabData["acceptedQuotes"] {
  const waiting = demoQuoteRecords(ctx).filter((quote) => awaitsWorkOrder({ ...quote, supersededAt: quote.superseded ? quote.updatedAt : null }))
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "") || a.id.localeCompare(b.id));
  return {
    total: waiting.length, prices, href: listHref("quotes", { filter: "ACCEPTED" }),
    rows: waiting.slice(0, ROWS).map((quote) => ({
      id: quote.id, label: quoteLabel(quote), title: quote.title, customerName: customerName(customerOf(ctx, quote.customerId)), decidedOn: quote.decidedAt ? swedishDayKey(quote.decidedAt) : null,
      net: prices ? quoteTotals(quote.lines, quote.vatPercent).net : null, href: `/?view=quote&quoteId=${encodeURIComponent(quote.id)}`,
    })),
  };
}

function teamProjects(ctx: DemoOverviewContext): TeamTabData["projects"] {
  const can = canRead(ctx);
  const open = ctx.db.projects.filter((project) => !project.archivedAt && !project.closedAt);
  const rows = open.map(ctx.attention).filter((project) => project.status.ongoing);
  // Projektläge as rows with their progression (2026-10-29), as Cloud.
  const list = projectRows(open.map((project) => ({ ...ctx.attention(project), id: project.id, name: project.name, dueDate: project.dueDate ?? "",
    customerName: customerName(customerOf(ctx, project.customerId)), tasks: ctx.db.tasks.filter((task) => task.projectId === project.id), status: { ...ctx.attention(project).status, state: ctx.attention(project).status.state } })));
  const now = ctx.now;
  return {
    ongoing: rows.length,
    overdue: rows.filter((project) => projectAttention(project, "overdue")).length,
    overBudget: rows.filter((project) => projectAttention(project, "overBudget")).length,
    readyToClose: rows.filter((project) => projectAttention(project, "readyToClose")).length,
    needsActionJobs: ctx.db.tasks.filter((task) => task.status === "NEEDS_ACTION" && can(workflowSubjectForTask(task.kind))).length,
    list,
    links: {
      ongoing: overviewKpiHref("ongoingProjects", "team", now), overdue: overviewKpiHref("overdue", "team", now), overBudget: overviewKpiHref("overBudget", "team", now),
      readyToClose: overviewKpiHref("readyToClose", "team", now), needsAction: overviewKpiHref("needsActionTasks", "team", now),
    },
  };
}

function safety(ctx: DemoOverviewContext): TeamTabData["safety"] {
  const since = addSwedishDays(ctx.now, -30).toISOString();
  const confirmedAt = (task: DemoTask) => (task.data as { roundSafety?: { confirmedAt?: string } }).roundSafety?.confirmedAt ?? "";
  const changed = readableTasks(ctx).filter((task) => task.kind === "FORM" && (task.data as { roundSafetyStep?: unknown }).roundSafetyStep === true && confirmedAt(task) >= since && roundSafetyChanged(task.data))
    .sort((a, b) => confirmedAt(b).localeCompare(confirmedAt(a)));
  return {
    changed: changed.length,
    rows: changed.slice(0, ROWS).map((task) => ({
      id: task.id, title: task.title, checkedOn: swedishDayKey(new Date(confirmedAt(task))), href: taskHref(task.id, "FORM"),
      workOrderHref: task.workOrderId && canRead(ctx)("work-order") ? taskHref(task.workOrderId, "WORK_ORDER") : null,
    })),
  };
}

// ---------- Ekonomi ----------

function moneyCount(count: number, nets: number[], prices: boolean): MoneyCount {
  return prices ? { count, net: Math.round(nets.reduce((sum, net) => sum + net, 0)) } : { count, net: null };
}

function economyTab(ctx: DemoOverviewContext): EconomyTabData {
  const caller = { admin: ctx.admin, workflowPermissions: ctx.user.permissions };
  if (!canViewEconomy(caller)) throw new DemoOverviewError(403, "Du saknar behörighet att se Ekonomi.");
  const access = economyAccess(caller);
  const now = ctx.now;
  const today = swedishDayKey(now);
  const goals = visibleCompanyGoals(companyGoalsOf(ctx.db.settings.goals), { economy: true });
  const { bases, taken } = demoInvoiceBasisRecords(ctx.db);
  const basisNet = (basis: (typeof bases)[number]) => invoiceBasisTotals(basis.lines, basis.vatPercent).net;

  // Ofakturerad tid: finished time no basis has taken, on completed work orders (under their project) and projects' own time.
  // Each group also counts its time a basis has already taken (fakturerat av upparbetat, as Cloud's query).
  const groups = new Map<string, UnbilledGroup & { invoicedSeconds: number }>();
  for (const entry of ctx.db.timeEntries) {
    if (!entry.endedAt || entry.durationSec <= 0) continue;
    const task = entry.taskId ? ctx.db.tasks.find((item) => item.id === entry.taskId) : undefined;
    const owner = task ? (task.kind === "WORK_ORDER" && task.status === "COMPLETED" ? (task.projectId ? { kind: "project" as const, id: task.projectId } : { kind: "task" as const, id: task.id }) : null)
      : entry.projectId ? { kind: "project" as const, id: entry.projectId } : null;
    if (!owner) continue;
    const key = `${owner.kind}:${owner.id}`;
    const group = groups.get(key) ?? { ...owner, seconds: 0, invoicedSeconds: 0, entries: 0, oldest: new Date(8.64e15) };
    if (taken.has(timeSourceKey(entry.id))) group.invoicedSeconds += entry.durationSec;
    else {
      group.seconds += entry.durationSec; group.entries += 1;
      if (Date.parse(entry.endedAt) < group.oldest.getTime()) group.oldest = new Date(entry.endedAt);
    }
    groups.set(key, group);
  }
  // Ofakturerat material (2026-10-29): the completed work orders' material and expense rows no basis has taken, Cloud's rule.
  const materialJobs = ctx.db.tasks.filter((task) => task.kind === "WORK_ORDER" && task.status === "COMPLETED")
    .map((task) => ({ taskId: task.id, projectId: task.projectId ?? null, completedAt: new Date(task.completedAt ?? task.updatedAt), materials: materialsFromData(task.data) }))
    .filter((job) => job.materials.length);
  const all = mergeUnbilled([...groups.values()].filter((group) => group.entries > 0), unbilledMaterialGroups(materialJobs, taken, access.prices));
  const shownGroups = all.slice(0, 50);
  const rate = access.prices ? hourlyRateOf(demoHourlyRate(ctx)) : null;
  const names = {
    tasks: new Map(ctx.db.tasks.map((task) => [task.id, { title: task.title, customer: customerName(customerOf(ctx, task.customerId)) }])),
    projects: new Map(ctx.db.projects.map((project) => [project.id, { title: project.name, customer: customerName(customerOf(ctx, project.customerId)) }])),
  };
  const totalSeconds = all.reduce((sum, group) => sum + group.seconds, 0);
  const unbilled = unbilledRows(shownGroups, names, access, rate, now);

  // Fakturerat: the invoiced bases of the last six months; the drafts not invoiced yet.
  const invoiced = bases.flatMap((basis) => basis.status === "INVOICED" && basis.invoicedAt ? [{ day: swedishDayKey(basis.invoicedAt), net: access.prices ? basisNet(basis) : 0 }] : []);
  const draftBases = bases.filter((basis) => basis.status === "DRAFT");

  // Offerter: the latest versions waiting, those going out soon, accepted this month and the win rate.
  const quotes = demoQuoteRecords(ctx);
  const latestSent = quotes.filter((quote) => !quote.superseded && quote.status === "SENT");
  const awaiting = latestSent.filter((quote) => !quote.validUntil || quote.validUntil >= today);
  const expiring = latestSent.filter((quote) => quote.validUntil >= today && quote.validUntil <= addDays(today, QUOTE_EXPIRY_WINDOW_DAYS))
    .sort((a, b) => a.validUntil.localeCompare(b.validUntil) || a.number - b.number);
  const monthStart = startOfSwedishMonth(now).getTime();
  const accepted = quotes.filter((quote) => quote.status === "ACCEPTED" && quote.decidedAt && Date.parse(quote.decidedAt) >= monthStart);
  const since = startOfSwedishMonth(now, -11);
  const sinceDay = swedishDayKey(since);
  const decidedNumbers = new Set(quotes.filter((quote) => quote.changeOfVersion === null && (
    (["ACCEPTED", "DECLINED", "EXPIRED"].includes(quote.status) && quote.decidedAt && Date.parse(quote.decidedAt) >= since.getTime())
    || (quote.status === "SENT" && quote.validUntil >= sinceDay && quote.validUntil < today))).map((quote) => quote.number));
  const net = (quote: (typeof quotes)[number]) => quoteTotals(quote.lines, quote.vatPercent).net;

  return {
    cloud: true, today, monthName: monthLong(today.slice(0, 7)),
    access: { prices: access.prices, readBases: access.readBases, createBases: access.createBases, readQuotes: access.readQuotes },
    goals: { invoicedPerMonth: goals.invoicedPerMonth, quoteWinRatePercent: goals.quoteWinRatePercent },
    invoiced: { months: invoicedPerMonth(invoiced, monthKeys(today, 6), access.prices), partial: false },
    drafts: moneyCount(draftBases.length, draftBases.map(basisNet), access.prices),
    unbilled: { hourlyRate: rate !== null, totalSeconds, totalEstimate: access.prices ? companyEstimate(totalSeconds, all, rate) : null, totalMaterialRows: all.reduce((sum, group) => sum + (group.materialRows ?? 0), 0), groups: all.length, rows: unbilled.rows, hidden: unbilled.hidden, more: Math.max(0, all.length - shownGroups.length) },
    quotes: {
      awaiting: moneyCount(awaiting.length, awaiting.map(net), access.prices),
      expiring: { count: expiring.length, rows: access.readQuotes ? expiring.slice(0, 8).map((quote) => ({
        id: quote.id, label: quoteLabel(quote), title: quote.title, customer: quote.sentCustomer?.name || customerName(customerOf(ctx, quote.customerId)),
        validUntil: quote.validUntil, days: daysUntil(today, quote.validUntil), net: access.prices ? Math.round(net(quote)) : null,
      })) : [] },
      acceptedThisMonth: moneyCount(accepted.length, accepted.map(net), access.prices),
      winRate: { ...quoteWinRate(quotes.filter((quote) => quote.changeOfVersion === null && decidedNumbers.has(quote.number))
        .map((quote) => ({ number: quote.number, status: quote.status, validUntil: quote.validUntil, superseded: quote.superseded, changeOfVersion: quote.changeOfVersion })), today), months: 12 },
      withoutWorkOrder: (() => { const won = acceptedQuotes(ctx, access.prices); return { count: won?.total ?? 0, rows: access.readQuotes ? won?.rows ?? [] : [] }; })(),
    },
    credits: null,
  };
}

// ---------- Kunder ----------

/** Kunder, as Cloud's loadCustomersTab (lib/overview/customers-server.ts): the same rules, read from the demo's memory. */
async function customersTab(ctx: DemoOverviewContext): Promise<CustomersTabData> {
  const access = customersTabAccess({ admin: ctx.admin, workflowPermissions: ctx.user.permissions });
  if (!access.customers) throw new DemoOverviewError(403, "Du saknar behörighet att se kundregistret.");
  const today = swedishDayKey(ctx.now);
  const can = canRead(ctx);
  const displayName = (customer: { name: string; company: string; customerType?: string | null } | undefined) => customer ? customer.customerType === "PRIVATE" ? customer.name : customerName(customer) : "";
  const orders = access.workOrders ? ctx.db.tasks.filter((task) => task.kind === "WORK_ORDER" && customerOf(ctx, task.customerId)) : [];
  const workStats = workOrderStats(orders.map((task) => ({ customerId: task.customerId!, status: task.status, dueDate: task.dueDate ?? "", plannedStartDate: task.plannedStartDate ?? "",
    roundScheduleId: task.roundScheduleId ?? null, completedOn: task.status === "COMPLETED" && task.completedAt ? swedishDayKey(task.completedAt) : null })), today);
  const sent = access.quotes ? demoQuoteRecords(ctx).filter((quote) => quote.status === "SENT" && !quote.superseded && customerOf(ctx, quote.customerId)) : [];
  const drafts = access.quotes ? demoInvoiceBasisRecords(ctx.db).bases.filter((basis) => basis.status === "DRAFT" && customerOf(ctx, basis.customerId)).filter((basis) => {
    const task = basis.taskId ? ctx.db.tasks.find((item) => item.id === basis.taskId) : undefined;
    return (!task || can(workflowSubjectForTask(task.kind))) && (!basis.projectId || can("projects"));
  }) : [];
  // The deviation log's entries tied to a customer through their work order or protocol, by the log's own read rule.
  const deviations = (await demoDeviationEntries(ctx.db, access.deviationsCompany ? undefined : deviationReader(ctx))).flatMap((entry) => {
    if (entry.status === "DONE") return [];
    const task = ctx.db.tasks.find((item) => item.id === (entry.workOrderId ?? entry.source?.taskId));
    const customer = customerOf(ctx, task?.customerId);
    return customer ? [{ ...entry, customerId: customer.id, customerName: displayName(customer) }] : [];
  });
  const figures = mergeCustomerFigures({
    access, workOrders: workStats,
    quotes: quoteStats(sent.map((quote) => ({ customerId: quote.customerId!, status: quote.status, validUntil: quote.validUntil })), today),
    invoices: invoiceStats(drafts.map((basis) => ({ customerId: basis.customerId!, net: access.prices ? invoiceBasisTotals(basis.lines, basis.vatPercent).net : 0 }))),
    deviations: deviationStats(deviations, today),
  });
  const totals = customerTotals(figures, access);
  const orderRow = (reason: "overdue" | "needsAction") => (task: DemoTask): CustomerActionRow => ({
    key: `${reason}:${task.id}`, reason, id: task.id, title: task.title, href: taskHref(task.id, "WORK_ORDER"), customerName: displayName(customerOf(ctx, task.customerId)), day: task.dueDate ?? "",
    status: task.status, progress: workflowTaskProgress(task), round: Boolean(task.roundScheduleId),
  });
  const expiring = sent.filter((quote) => quoteAnswerState(quote, today) === "expiringSoon");
  const actionRows = sortActionRows([
    ...orders.filter((task) => workOrderState({ status: task.status, dueDate: task.dueDate ?? "" }, today) === "overdue").map(orderRow("overdue")),
    ...orders.filter((task) => workOrderState({ status: task.status, dueDate: task.dueDate ?? "" }, today) === "needsAction").map(orderRow("needsAction")),
    ...deviations.filter((entry) => isDeviationOverdue(entry, today)).map((entry): CustomerActionRow => ({
      key: `deviation:${entry.id}`, reason: "deviation", id: entry.id, title: entry.title, href: deviationHref(entry.id), customerName: entry.customerName, day: entry.dueDate, status: entry.status,
    })),
    ...expiring.map((quote): CustomerActionRow => ({
      key: `quote:${quote.id}`, reason: "quote", id: quote.id, title: `${quoteLabel(quote)} · ${quote.title || "Utan rubrik"}`, href: `/?view=quote&quoteId=${encodeURIComponent(quote.id)}`,
      customerName: displayName(customerOf(ctx, quote.customerId)), day: quote.validUntil, net: access.prices ? Math.round(quoteTotals(quote.lines, quote.vatPercent).net) : null,
    })),
  ]);
  const lapsed = access.workOrders ? lapsedCustomers(workStats, new Set(figures.map((row) => row.customerId)), today) : null;
  const placeOf = (customer: NonNullable<ReturnType<typeof customerOf>>) => [customerContact(customer), customer.city].filter(Boolean).join(" · ");
  const customerHref = (id: string) => `/?view=customers&customerId=${encodeURIComponent(id)}`;
  const upcoming = access.workOrders ? sortUpcomingRows(orders.flatMap((task) => {
    const when = upcomingDay({ status: task.status, dueDate: task.dueDate ?? "", plannedStartDate: task.plannedStartDate ?? "" }, today);
    return when ? [{ id: task.id, title: task.title, href: taskHref(task.id, "WORK_ORDER"), customerName: displayName(customerOf(ctx, task.customerId)), day: when.day, starts: when.starts,
      status: task.status, progress: workflowTaskProgress(task), round: Boolean(task.roundScheduleId) }] : [];
  })) : null;
  return {
    today,
    chip: customersChip(totals),
    rights: customersAccessRights(access),
    totals,
    attentionCustomers: attentionCustomers(figures),
    rows: figures.slice(0, CUSTOMER_ROWS).flatMap((row) => {
      const customer = customerOf(ctx, row.customerId);
      if (!customer) return [];
      return [{ ...row, name: displayName(customer), place: placeOf(customer), href: customerHref(customer.id) }];
    }),
    action: { total: Math.max(Math.min(actionRows.length, CUSTOMER_LIST_ROWS), actionTotal(totals)), rows: actionRows.slice(0, CUSTOMER_LIST_ROWS) },
    upcoming: upcoming ? { total: upcoming.length, rows: upcoming.slice(0, CUSTOMER_LIST_ROWS) } : null,
    lapsed: lapsed ? { total: lapsed.length, rows: lapsed.slice(0, LAPSED_ROWS).flatMap((row) => {
      const customer = customerOf(ctx, row.customerId);
      return customer ? [{ customerId: customer.id, name: displayName(customer), place: placeOf(customer), href: customerHref(customer.id), lastCompletedOn: row.lastCompletedOn }] : [];
    }) } : null,
    links: CUSTOMERS_LINKS,
  };
}
