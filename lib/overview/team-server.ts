import { customerTitle } from "@/lib/kfid/customer-name";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, type Context } from "@/lib/kfid/server";
import { loadPlanningRounds, loadScheduleViews } from "@/lib/kfid/rounds-server";
import { listHref } from "@/lib/url-filters";
import { addSwedishDays, fromSwedishDateInput, startOfSwedishDay, swedishDayKey } from "@/lib/swedish-time";
import { checkedWorkdays, expiringItems, timeGaps, unownedWork, type ExpiringRow, type TimeGapRow, type UnownedRow } from "./team-followup";
import { timeEntryInOrganization } from "@/lib/workflow/timer-server";
import { timeTypeRules } from "@/lib/workflow/time-types-server";
import { activitiesInUse, type CapacityActivity } from "@/lib/workflow/capacity-summary";
import { capacityLoads } from "@/lib/workflow/planning-rounds";
import { canBookJob } from "@/lib/workflow/planned-activity-access";
import { isDormant } from "@/lib/maintenance/plan-model";
import { expectedWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { canViewTeam, hasWorkflowPermission, readableTaskScope, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskSql, readableTaskWhere } from "@/lib/workflow/task-access";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { projectAttention } from "@/lib/workflow/project-filters";
import { overviewKpiHref } from "@/lib/workflow/overview-kpis";
import { riskCheckOf } from "@/lib/workflow/risk-step";
import { addDays, isoWeek } from "@/lib/workflow/schedule";
import { quoteLabel, quoteTotals, QUOTE_VAT_PERCENT, type QuoteLineKind } from "@/lib/quotes/model";
import { awaitsAuthorityReport, DEVIATION_KINDS, deviationHref, deviationReadWhere, isDeviationOverdue } from "@/lib/self-inspection/model";
import { absenceLabel, absenceOn, absentShare, firstDayBack, type Absence, type AffectedWork } from "@/lib/workflow/absence";
import { loadTeamAbsence, viewerOf } from "@/lib/absence/server";
import { ageInDays, awaitsWorkOrder, countDeviations, nowPeople, projectRows, riskSection, type TeamProjectRow, roundSafetyChanged, selectRiskBeforeStart, teamLoadPeople, teamLoadWindows, teamTabAccess, type DeviationCounts, type RiskRow, type TeamLoadPerson, type TeamLoadWeek } from "./team-model";
import { dormantDay, notDormantSql } from "@/lib/maintenance/plan-server";
import { organizationModuleOn, type ModuleKey } from "@/lib/workflow/modules";
import { WAITING_REASONS } from "@/lib/workflow/maintenance";
import { jobObstacle, obstacleText } from "@/lib/workflow/obstacles";
import { CLOSED_TASK_STATUSES } from "@/lib/workflow/task-cancel";
import { isLateTask, isLateStart } from "@/lib/workflow/late-tasks";
import { loadFaultReportNotifications } from "@/lib/workflow/task-notifications-server";

/**
 * Översikt – Teamet (2026-10-28, 0.29.0): the team's load, what must be done before work starts, the deviation log,
 * accepted quotes without a work order, the project status, rounds not done and round safety checks whose conditions
 * changed – all real data. Only for admins or team:read (a project's responsibility never opens it); inside, every section
 * still follows its module's read right, and amounts need the price right. Every query is bound to the company and bounded;
 * no section reads per row. Cloud only (the caller checks the storage mode).
 */

export type { TeamLoadPerson, TeamLoadWeek };
/** Just nu (2026-10-29): what each person's time runs on, and their reported time today. */
export type TeamNowPerson = { id: string; name: string; running: { title: string; href: string | null; since: string; project: boolean; kind?: string | null; status?: string | null; progress?: number | null } | null; todayMinutes: number;
  /** The person's ordinary day (a fifth of the weekly time), for today's line. */
  dayMinutes?: number;
  /** Away today (Frånvaro, 2026-10-29): the words this viewer may see and the first workday back. */
  absent?: { label: string; backOn: string } | null };
/** Planned work an absence touches, with who could take it over (lib/workflow/absence.ts). */
export type TeamAffectedRow = AffectedWork & { personName: string; label: string; suggestions: { id: string; name: string; freeMinutes: number }[] };
/** A job marked Behöver åtgärdas, with its progression. */
export type TeamJobRow = { id: string; title: string; kind: string; status: string; progress: number | null; customerName: string; dueDate: string; href: string;
  /** Who is responsible, and the planned start, on Förfallet's and Ej startat's rows. */
  responsibleName?: string | null; plannedStartDate?: string;
  /** What the job waits for, in words (Hinder's rows); empty for a job only marked Behöver åtgärdas. */
  obstacle?: string };
/** A group's jobs: all of them counted (the same as the list `href` opens), the most urgent few as rows. */
export type TeamJobGroup = { total: number; rows: TeamJobRow[]; href: string };
export type TeamRiskRow = RiskRow & { href: string };
export type TeamDeviationRow = { id: string; label: string; title: string; dueDate: string; overdue: boolean; responsibleName: string | null; ageDays: number; href: string;
  /** Öppen or Pågår, for the steps Öppen → Pågår → Åtgärdad (as Jag's Mina avvikelser). */
  status: string;
  /** Anmälningspliktig and not marked reported (användartest 2026-10-31, fel 3): marked on the row and listed in Kräver åtgärd. */
  reportable?: boolean };
export type TeamQuoteRow = { id: string; label: string; title: string; customerName: string; decidedOn: string | null; net: number | null; href: string };
export type TeamPendingTimeRow = { userId: string; name: string; period: string; submittedAt: string | null };
export type TeamSafetyRow = { id: string; title: string; checkedOn: string; href: string; workOrderHref: string | null };

export type TeamTabData = {
  today: string;
  /** Just nu, and the jobs marked Behöver åtgärdas (null without read on any job kind). Optional so an older answer still draws. */
  now?: { people: TeamNowPerson[] };
  /** Hinder (beslut 15, 2026-11-01): a job with an obstacle or marked Behöver åtgärdas; the list's filter Hinder. */
  needsAction?: (Omit<TeamJobGroup, "href"> & { href?: string }) | null;
  /** Förfallen and Försenad start (lib/workflow/late-tasks.ts), each the same count as the list it opens. */
  overdueJobs?: TeamJobGroup | null;
  lateStarts?: TeamJobGroup | null;
  /** Nya felanmälningar (TE12): fault reports nobody has taken, the bell's rule. */
  faultReports?: { rows: { id: string; title: string; detail: string; href: string }[] } | null;
  /** Punkt 1–3 (2026-10-29): unreported time per person, work without owner or booking, competence and instruments running out. */
  timeGaps?: { days: string[]; rows: TimeGapRow[]; href: string } | null;
  unowned?: { total: number; rows: UnownedRow[] } | null;
  /** Trainings and licences only for admins (others' competence cards); instruments for everyone in Teamet. */
  expiring?: { scope: "all" | "instruments"; rows: ExpiringRow[] } | null;
  /** Frånvaro (2026-10-29): who is away today, the work it touches and whether this viewer registers for others. */
  absence?: { canRegister: boolean; today: { userId: string; name: string; label: string; to: string }[]; affected: TeamAffectedRow[] } | null;
  load: { weeks: TeamLoadWeek[]; people: TeamLoadPerson[]; href: string; days?: string[] };
  /** Månadens tid som väntar på godkännande (användartest 2026-10-31, F5): others' months sent in; everyone in Teamet approves. */
  pendingTime?: { total: number; rows: TeamPendingTimeRow[]; href: string } | null;
  /** `coming`: those whose start has not passed, the ones Ej startat counts. */
  riskBeforeStart: { total: number; coming?: number; rows: TeamRiskRow[] } | null;
  deviations: { scope: "company" | "own"; counts: DeviationCounts; rows: TeamDeviationRow[]; links: { open: string; overdue: string } };
  acceptedQuotes: { total: number; rows: TeamQuoteRow[]; prices: boolean; href: string } | null;
  projects: {
    ongoing: number; overdue: number; overBudget: number; readyToClose: number;
    /** Jobs (of the kinds the person may read) marked Behöver åtgärdas. */
    needsActionJobs: number;
    /** The projects that need attention, with their progression (2026-10-29). Optional so an older answer still draws. */
    list?: { total: number; rows: TeamProjectRow[] };
    links: { ongoing: string; overdue: string; overBudget: string; readyToClose: string; needsAction: string };
  } | null;
  /** `late`: round occurrences that are förfallna (the same count as Jag's and the rounds' own). */
  rounds: { notDone: number; late?: number; href: string } | null;
  safety: { changed: number; rows: TeamSafetyRow[] } | null;
};

const ROWS = 6;
const SAFETY_DAYS = 30;
const taskHref = (id: string, kind: string) => `/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=${kind}`;
const customerName = (customer: { name: string; company: string } | null | undefined) => customerTitle(customer);
const decimal = (value: Prisma.Decimal | null) => value === null ? null : Number(value.toString());

export async function loadTeamTab(ctx: Context, now: Date): Promise<TeamTabData> {
  const access = teamTabAccess(ctx);
  if (!access.team) throw new ApiError(403, "Du saknar behörighet att se Teamet.");
  const today = swedishDayKey(now);
  const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  // Företagets moduler (0.39.0): what the company has turned off is not read or counted here.
  const on = (key: ModuleKey) => organizationModuleOn(ctx.organization, key);
  // Frånvaro (2026-10-29): read once; it lowers the load's capacity, marks Just nu and is counted off the time gaps.
  const absenceRead = on("time") ? loadTeamAbsence(ctx, now) : Promise.resolve({ section: null, absences: [] as Absence[] });
  const [absence, timeGapSection, unowned, expiring, nowSection, jobGroups, load, riskBeforeStart, deviations, acceptedQuotes, projects, rounds, safety, pendingTime, faultRows] = await Promise.all([
    absenceRead,
    on("time") ? absenceRead.then((read) => loadTimeGaps(ctx, now, read.absences)) : null,
    access.workOrders ? loadUnowned(ctx, today) : null,
    loadExpiring(ctx, today),
    on("time") ? loadNow(ctx, now, can) : null,
    readableTaskScope(can).any ? loadJobGroups(ctx, today, can, now) : null,
    on("planning") ? absenceRead.then((read) => loadTeamLoad(ctx, now, read.absences, access.rounds)) : { weeks: [], people: [], href: "/?view=capacity" },
    access.workOrders ? loadRiskBeforeStart(ctx, today) : null,
    loadDeviations(ctx, today, access.deviationsCompany),
    access.quotes ? loadAcceptedQuotes(ctx, access.prices) : null,
    access.projects ? loadProjects(ctx, now, can) : null,
    access.rounds ? loadScheduleViews(ctx, today, { deviations: false, places: false }).then((views) => views.filter((view) => view.active)).then((views) => ({ notDone: views.reduce((sum, view) => sum + view.overview.notDone, 0), late: views.reduce((sum, view) => sum + view.overview.missed, 0), href: listHref("rounds", { attention: true }) })) : null,
    on("rounds") ? loadSafety(ctx, now, can) : null,
    on("time") ? loadPendingTime(ctx) : null,
    on("upkeep") && ctx.organization.storageMode === "HINTEK_CLOUD" && can("work-order") ? loadFaultReportNotifications(ctx, now) : null,
  ]);
  const faultReports = faultRows ? { rows: faultRows.map((item) => ({ id: item.id, title: item.title, detail: item.detail ?? "", href: item.href })) } : null;
  return { today, timeGaps: timeGapSection, unowned, expiring, now: nowSection ? withAbsence(nowSection, absence.absences, viewerOf(ctx), today) : undefined, needsAction: jobGroups?.obstacles ?? null, overdueJobs: jobGroups?.overdue ?? null, lateStarts: jobGroups?.lateStart ?? null, faultReports, absence: absence.section, load, riskBeforeStart, deviations, acceptedQuotes, projects, rounds, safety, pendingTime };
}

/** Others' months sent in and waiting (the Teamet right is the approver right, lib/workflow/time-periods-server.ts); the oldest first. */
async function loadPendingTime(ctx: Context): Promise<NonNullable<TeamTabData["pendingTime"]>> {
  const where = { organizationId: ctx.organizationId, status: "SUBMITTED", userId: { not: ctx.user.id }, member: { is: { isActive: true } } };
  const [total, rows] = await Promise.all([
    prisma.timePeriod.count({ where }),
    prisma.timePeriod.findMany({ where, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: ROWS,
      select: { userId: true, period: true, submittedAt: true, member: { select: { user: { select: { name: true, email: true } } } } } }),
  ]);
  return { total, href: "/?view=time", rows: rows.map((row) => ({ userId: row.userId, name: row.member.user.name || row.member.user.email, period: row.period, submittedAt: row.submittedAt?.toISOString() ?? null })) };
}

/** Just nu: the words this viewer may see for who is away today, and the first workday back. */
function withAbsence(section: NonNullable<TeamTabData["now"]>, absences: readonly Absence[], viewer: ReturnType<typeof viewerOf>, today: string): NonNullable<TeamTabData["now"]> {
  return { people: section.people.map((person) => {
    const absence = absenceOn(absences, person.id, today);
    return absence ? { ...person, absent: { label: absenceLabel(viewer, absence), backOn: firstDayBack(absence, absences) } } : person;
  }) };
}

/** 1. Tid som inte är rapporterad: the checked workdays' time per active member against their ordinary day. */
async function loadTimeGaps(ctx: Context, now: Date, absences: readonly Absence[]): Promise<NonNullable<TeamTabData["timeGaps"]>> {
  const days = checkedWorkdays(swedishDayKey(now));
  const startsAt = fromSwedishDateInput(days[0])!;
  const endsAt = addSwedishDays(fromSwedishDateInput(days[days.length - 1])!, 1);
  const [members, entries] = await Promise.all([
    prisma.organizationMember.findMany({ where: { organizationId: ctx.organizationId, isActive: true, user: { is: { isActive: true } } }, take: 200,
      select: { userId: true, weeklyWorkMinutes: true, noFixedHours: true, user: { select: { name: true, email: true } } } }),
    prisma.workflowTimeEntry.findMany({ where: { startedAt: { gte: startsAt, lt: endsAt }, AND: [timeEntryInOrganization(ctx.organizationId)] }, take: 5000, select: { userId: true, startedAt: true, durationSec: true, timeTypeId: true } }),
  ]);
  // Beslut 8 (2026-11-01): only worked time counts against the ordinary day.
  const { countsAsWork } = await timeTypeRules(ctx.organizationId);
  // Ingen fast arbetstid (2026-10-30): hourly staff have no expected time and are never "missing" any.
  const expected = members.filter((member) => !member.noFixedHours);
  const dayMinutesOf = (member: (typeof members)[number]) => Math.round(expectedWeeklyWorkMinutes(ctx.organization.weeklyWorkMinutes ?? 2400, member) / 5);
  return { days, href: "/?view=time&tab=team", rows: timeGaps({ days, entries: entries.filter((entry) => countsAsWork(entry.timeTypeId)), swedishDay: (value) => swedishDayKey(new Date(value)),
    members: expected.map((member) => ({ id: member.userId, name: member.user.name || member.user.email, dayMinutes: dayMinutesOf(member) })),
    awayShare: (userId, day) => { const member = expected.find((item) => item.userId === userId); return member ? absentShare(absences, userId, day, dayMinutesOf(member)) : 0; } }) };
}

/** 2. Arbete utan ägare: open work orders without a responsible person, or awaiting a booking and starting within a week. */
async function loadUnowned(ctx: Context, today: string): Promise<NonNullable<TeamTabData["unowned"]>> {
  const rows = await prisma.workflowTask.findMany({
    where: { organizationId: ctx.organizationId, kind: "WORK_ORDER", status: { notIn: ["COMPLETED", "CANCELLED"] }, OR: [{ assignedToUserId: null }, { plannedStartDate: { gte: today, lte: addDays(today, 7) } }] },
    take: 300, orderBy: [{ plannedStartDate: "asc" }, { id: "asc" }],
    select: { id: true, title: true, status: true, progress: true, startedAt: true, assignedToUserId: true, plannedStartDate: true, dueDate: true, projectId: true, roundScheduleId: true, maintenancePlanId: true, maintenanceDue: true, maintenanceActivatedAt: true,
      project: { select: { archivedAt: true, closedAt: true } }, customer: { select: { name: true, company: true, customerType: true } },
      plannedActivities: { where: { deletedAt: null, status: { not: "CANCELED" } }, select: { id: true }, take: 1 } },
  });
  // A job already on Förfallet or Försenad start is counted there, with "Ingen ansvarig" on its row (beslut 15).
  const dormantToday = dormantDay(ctx.organization, today);
  const result = unownedWork({ today, bookable: organizationModuleOn(ctx.organization, "planning"), workOrders: rows.filter((row) => !isLateTask(row, today) && !isLateStart(row, today)).map((row) => ({ id: row.id, title: row.title, status: row.status, progress: row.progress, startedAt: row.startedAt, roundScheduleId: row.roundScheduleId, dormant: isDormant(row, dormantToday), assignedToUserId: row.assignedToUserId, plannedStartDate: row.plannedStartDate ?? "", dueDate: row.dueDate ?? "",
    customerName: row.customer ? row.customer.customerType === "PRIVATE" ? row.customer.name : customerName(row.customer) : "", booked: row.plannedActivities.length > 0,
    // Boka (2026-11-02): the same rule as the server's when it saves; the row opens the job for anyone else.
    canBook: !row.project?.archivedAt && !row.project?.closedAt && canBookJob(ctx.workflowPermissions, ctx.admin, row.projectId, organizationModuleOn(ctx.organization, "projects")) })) });
  return { total: result.total, rows: result.rows.slice(0, ROWS) };
}

/** 3. Behörigheter och instrument som går ut, within 30 days; others' trainings and licences only for admins. */
async function loadExpiring(ctx: Context, today: string): Promise<NonNullable<TeamTabData["expiring"]>> {
  const last = addDays(today, 30);
  // Företagets moduler (0.39.0): trainings and licences belong to Egenkontroll; the instruments are always on.
  const competence = ctx.admin && organizationModuleOn(ctx.organization, "self_inspection");
  const [credentials, cards, instruments, members] = await Promise.all([
    competence ? prisma.selfInspectionCredential.findMany({ where: { organizationId: ctx.organizationId, leftAt: null, validUntil: { not: null, lte: last } }, take: 200, select: { id: true, userId: true, title: true, validUntil: true } }) : [],
    competence ? prisma.selfInspectionCompetenceCard.findMany({ where: { organizationId: ctx.organizationId, leftAt: null, licenceValidUntil: { not: null, lte: last } }, take: 200, select: { userId: true, licenceValidUntil: true } }) : [],
    prisma.instrument.findMany({ where: { organizationId: ctx.organizationId, isActive: true, nextCalibrationAt: { not: null, lte: last } }, take: 200, select: { id: true, name: true, nextCalibrationAt: true } }),
    ctx.admin ? prisma.organizationMember.findMany({ where: { organizationId: ctx.organizationId }, take: 500, select: { userId: true, user: { select: { name: true, email: true } } } }) : [],
  ]);
  const nameOf = new Map(members.map((member) => [member.userId, member.user.name || member.user.email]));
  return { scope: ctx.admin ? "all" : "instruments", rows: expiringItems({ today,
    credentials: credentials.map((item) => ({ id: item.id, personName: nameOf.get(item.userId) ?? "Tidigare medarbetare", title: item.title, validUntil: item.validUntil, left: false })),
    licences: cards.map((item) => ({ personId: item.userId, personName: nameOf.get(item.userId) ?? "Tidigare medarbetare", validUntil: item.licenceValidUntil, left: false })),
    instruments: instruments.map((item) => ({ id: item.id, name: item.name, nextCalibrationAt: item.nextCalibrationAt, active: true })) }).slice(0, ROWS * 2) };
}

/**
 * Just nu: every active member, what their time runs on (a job's title only when the viewer may read the job, a project's only
 * with Projekt – läsa) and their reported time today (Swedish day, a running entry up to now). Bound to the company.
 */
async function loadNow(ctx: Context, now: Date, can: (subject: WorkflowPermissionSubject) => boolean): Promise<NonNullable<TeamTabData["now"]>> {
  const dayStart = startOfSwedishDay(now);
  const [members, running, today] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, isActive: true, user: { is: { isActive: true } } },
      orderBy: { user: { name: "asc" } }, take: 200, select: { userId: true, weeklyWorkMinutes: true, noFixedHours: true, user: { select: { name: true, email: true } } },
    }),
    prisma.workflowTimeEntry.findMany({
      where: { endedAt: null, AND: [timeEntryInOrganization(ctx.organizationId)] }, take: 200,
      select: { userId: true, startedAt: true, taskId: true, projectId: true, task: { select: { title: true, kind: true, formArea: true, status: true, progress: true } }, sourceTask: { select: { title: true, kind: true, status: true, progress: true } }, project: { select: { name: true } } },
    }),
    prisma.workflowTimeEntry.findMany({
      where: { startedAt: { gte: dayStart }, AND: [timeEntryInOrganization(ctx.organizationId)] }, take: 2000,
      select: { userId: true, startedAt: true, endedAt: true, durationSec: true },
    }),
  ]);
  return { people: nowPeople(members.map((member) => ({ id: member.userId, name: member.user.name || member.user.email, dayMinutes: Math.round(expectedWeeklyWorkMinutes(ctx.organization.weeklyWorkMinutes ?? 2400, member) / 5) })), running.map((entry) => {
    const readable = entry.task ? can(workflowSubjectForTask(entry.task.kind, entry.task.formArea)) : entry.projectId ? can("projects") : false;
    return {
      userId: entry.userId, startedAt: entry.startedAt,
      title: readable ? entry.sourceTask?.title || entry.task?.title || entry.project?.name || "Arbete" : "Arbete",
      href: readable ? entry.taskId && entry.task ? taskHref(entry.taskId, entry.task.kind) : entry.projectId ? `/?view=project&projectId=${encodeURIComponent(entry.projectId)}` : null : null,
      project: !entry.taskId,
      // The task the time was started in, else its work order: its status and progress (only when readable).
      ...(readable && entry.task ? { kind: entry.sourceTask?.kind ?? entry.task.kind, status: entry.sourceTask?.status ?? entry.task.status, progress: entry.sourceTask?.progress ?? entry.task.progress } : {}),
    };
  }), today, now) };
}

/**
 * Hinder, Förfallet and Försenad start in one read (beslut 15, 2026-11-01): the readable jobs with the same rules as the job
 * list's filters blocked, overdue and late_start (app/api/work-items/route.ts, lib/workflow/late-tasks.ts) and the same
 * limits, so a group's figure and the list it opens have as many rows. A job on Hinder that has passed its end date is on both,
 * as it is in both lists. Each group: the most urgent rows, and its total on every row.
 */
async function loadJobGroups(ctx: Context, today: string, can: (subject: WorkflowPermissionSubject) => boolean, now: Date) {
  type Row = { grp: "obstacles" | "overdue" | "lateStart"; total: bigint | number; id: string; title: string; kind: string; status: string; progress: number | null; dueDate: string | null; plannedStartDate: string | null; assignedToName: string | null; obstacle: unknown; waitingOn: string | null; updatedAt: Date; customerName: string | null };
  const closed = Prisma.join([...CLOSED_TASK_STATUSES]);
  const pick = (grp: Row["grp"], when: Prisma.Sql, order: Prisma.Sql) => Prisma.sql`(
    select ${grp}::text as grp, count(*) over () as total, t.id, t.title, t.kind, t.status, t.progress, t."dueDate", t."plannedStartDate", t."assignedToName", t.data->'obstacle' as obstacle, t.data->'details'->>'waitingOn' as "waitingOn", t."updatedAt",
      case when c."customerType" = 'PRIVATE' then c.name else coalesce(nullif(c.company, ''), c.name) end as "customerName"
    from "WorkflowTask" t left join "Customer" c on c.id = t."customerId" and c."organizationId" = t."organizationId"
    where t."organizationId" = ${ctx.organizationId} and ${readableTaskSql(can)} and ${notDormantSql("t", dormantDay(ctx.organization, today))} and t.status not in (${closed}) and ${when}
    order by ${order}, t.id limit ${ROWS})`;
  const rows = await prisma.$queryRaw<Row[]>`
    ${pick("obstacles", Prisma.sql`(t.status = 'NEEDS_ACTION' or (t.status = 'PAUSED' and t.data->'details'->>'waitingOn' in (${Prisma.join([...WAITING_REASONS])})))`, Prisma.sql`t."updatedAt" desc`)}
    union all ${pick("overdue", Prisma.sql`nullif(t."dueDate", '') < ${today}`, Prisma.sql`t."dueDate" asc`)}
    union all ${pick("lateStart", Prisma.sql`t.status not in ('IN_PROGRESS', 'PAUSED', 'NEEDS_ACTION') and coalesce(t.progress, 0) = 0 and t."startedAt" is null and nullif(t."plannedStartDate", '') < ${today} and coalesce(nullif(t."dueDate", '') < ${today}, false) = false`, Prisma.sql`t."plannedStartDate" asc`)}`;
  const group = (grp: Row["grp"], href: string): TeamJobGroup => {
    const own = rows.filter((row) => row.grp === grp);
    return { total: own.length ? Number(own[0].total) : 0, href, rows: own.map((row) => {
      const obstacle = grp === "obstacles" ? jobObstacle({ status: row.status, data: { obstacle: row.obstacle, details: { waitingOn: row.waitingOn } }, updatedAt: row.updatedAt }) : null;
      return { id: row.id, title: row.title, kind: row.kind, status: row.status, progress: row.progress, dueDate: row.dueDate ?? "", plannedStartDate: row.plannedStartDate ?? "", responsibleName: row.assignedToName || null,
        customerName: row.customerName ?? "", href: taskHref(row.id, row.kind), ...(obstacle ? { obstacle: obstacleText(obstacle) } : {}) };
    }) };
  };
  return { obstacles: group("obstacles", listHref("tasks", { type: "all", filter: "blocked", scope: "all" })), overdue: group("overdue", overviewKpiHref("overdueTasks", "team", now)), lateStart: group("lateStart", listHref("tasks", { type: "all", filter: "late_start", scope: "all" })) };
}

/**
 * Belastning: each active member's booked minutes this week and next against the time available (teamLoadPeople, the same count as
 * Planering's Kapacitet), with only the bookings the person may read and the rounds they may read. Planering has no person/week in its
 * address, so the link opens Kalender.
 */
async function loadTeamLoad(ctx: Context, now: Date, absences: readonly Absence[], withRounds: boolean): Promise<TeamTabData["load"]> {
  const { windows, workdays, from, to } = teamLoadWindows(now);
  const [members, activities, rounds] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, isActive: true, user: { is: { isActive: true } } },
      orderBy: { user: { name: "asc" } }, take: 200,
      select: { userId: true, weeklyWorkMinutes: true, noFixedHours: true, user: { select: { name: true, email: true } } },
    }),
    prisma.plannedActivity.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, status: { in: ["PLANNED", "IN_PROGRESS"] }, startsAt: { lt: windows[1].endsAt }, endsAt: { gt: windows[0].startsAt } },
      take: 5000,
      select: {
        startsAt: true, endsAt: true, assignedToUserId: true, status: true, projectId: true, workflowTaskId: true,
        workflowTask: { select: { kind: true, formArea: true, status: true, projectId: true } },
        assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } },
      },
    }),
    withRounds ? loadPlanningRounds(ctx, { from, to }, swedishDayKey(now)).then((read) => read.rounds) : [],
  ]);
  const readable: CapacityActivity[] = activitiesInUse(activities, ctx.organization).filter((activity) => canReadPlannedActivity(ctx.workflowPermissions, ctx.admin, activity)).map((activity) => ({
    startsAt: activity.startsAt.toISOString(), endsAt: activity.endsAt.toISOString(), assignedToUserId: activity.assignedToUserId,
    assignments: activity.assignments.map((assignment) => ({ userId: assignment.member.userId, plannedMinutes: assignment.plannedMinutes, startsAt: assignment.startsAt?.toISOString() ?? null, endsAt: assignment.endsAt?.toISOString() ?? null })),
    status: activity.status as CapacityActivity["status"], projectId: activity.projectId, workflowTaskId: activity.workflowTaskId,
    workflowTask: activity.workflowTask ? { status: activity.workflowTask.status } : null,
  }));
  return {
    weeks: windows.map((window) => {
      const startsOn = swedishDayKey(window.startsAt);
      return { key: window.key, week: isoWeek(startsOn), startsOn, endsOn: addDays(startsOn, 6) };
    }),
    people: teamLoadPeople({ activities: capacityLoads(readable, rounds), absences, viewer: viewerOf(ctx), windows, workdays,
      members: members.map((member) => ({ id: member.userId, name: member.user.name || member.user.email, weeklyWorkMinutes: member.weeklyWorkMinutes ?? ctx.organization.weeklyWorkMinutes, noFixedHours: member.noFixedHours })) }),
    days: workdays.map((day) => swedishDayKey(day.startsAt)),
    // The rows, clashes and working-time history are on Kapacitet (2026-11-02).
    href: "/?view=capacity",
  };
}

/** Kräver åtgärd före start: open, not started work orders starting within a week whose risk step is not done. */
async function loadRiskBeforeStart(ctx: Context, today: string): Promise<TeamTabData["riskBeforeStart"]> {
  // Only the risk step's part of the data is read, never the whole work order (materials, notes).
  const rows = await prisma.$queryRaw<{ id: string; title: string; status: string; plannedStartDate: string; started: boolean; data: unknown; customerName: string | null; customerCompany: string | null }[]>`
    select t.id, t.title, t.status, t."plannedStartDate", (t."startedAt" is not null or t.progress > 0) as started,
      jsonb_build_object('riskStep', t.data -> 'riskStep', 'riskCheck', t.data -> 'riskCheck') as data,
      c.name as "customerName", c.company as "customerCompany"
    from "WorkflowTask" t left join "Customer" c on c.id = t."customerId" and c."organizationId" = t."organizationId"
    where t."organizationId" = ${ctx.organizationId} and t.kind = 'WORK_ORDER' and t.status not in ('COMPLETED', 'CANCELLED')
      and t."startedAt" is null and t."plannedStartDate" between ${addDays(today, -60)} and ${addDays(today, 7)}
      and coalesce(t.data ->> 'riskStep', '') = 'true'
    order by t."plannedStartDate" asc, t.id asc
    limit 300`;
  const extendedIds = [...new Set(rows.flatMap((row) => { const id = riskCheckOf(row.data)?.extendedTaskId; return id ? [id] : []; }))];
  const extended = extendedIds.length ? await prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId, id: { in: extendedIds } }, select: { id: true, title: true, status: true, kind: true } }) : [];
  const byId = new Map(extended.map((task) => [task.id, task]));
  const selected = selectRiskBeforeStart(rows.map((row) => {
    const extendedId = riskCheckOf(row.data)?.extendedTaskId;
    return {
      id: row.id, title: row.title, kind: "WORK_ORDER", status: row.status, data: row.data, plannedStartDate: row.plannedStartDate, started: row.started,
      customerName: customerName(row.customerName === null ? null : { name: row.customerName, company: row.customerCompany ?? "" }),
      extended: extendedId ? byId.get(extendedId) ?? null : null,
    };
  }), today);
  const section = riskSection(selected, ROWS);
  return { ...section, rows: section.rows.map((row) => ({ ...row, href: taskHref(row.id, "WORK_ORDER") })) };
}

/**
 * Avvikelser: the open entries of the company's deviation log. An admin sees the whole log; anyone else exactly what the log
 * shows them today – what they reported or are responsible for (lib/self-inspection/server.ts), never more.
 */
async function loadDeviations(ctx: Context, today: string, company: boolean): Promise<TeamTabData["deviations"]> {
  const log = (filter: string) => `/?view=deviations&filter=${filter}`;
  const empty = { scope: company ? "company" as const : "own" as const, counts: { open: 0, overdue: 0, withoutResponsible: 0, systematic: 0 }, rows: [], links: { open: log("open"), overdue: log("overdue") } };
  // The log is the company's, with or without an egenkontroll programme (Avvikelser, 2026-10-30).
  const items = await prisma.selfInspectionDeviation.findMany({
    // The log's own read rule, also for a near miss or an accident (lib/self-inspection/incidents.ts, 2026-10-30).
    where: { organizationId: ctx.organizationId, status: { not: "DONE" }, ...(company ? {} : { AND: [deviationReadWhere({ id: ctx.user.id, admin: ctx.admin, team: canViewTeam(ctx) })] }) },
    orderBy: { number: "asc" }, take: 2000,
    select: { id: true, number: true, kind: true, title: true, status: true, dueDate: true, responsibleUserId: true, systematic: true, createdAt: true, type: true, serious: true, reportedToAuthorityAt: true },
  });
  // What must be reported to the authority first (fel 3), then overdue (the earliest Klart senast), then the oldest.
  const shown = [...items].sort((a, b) => Number(awaitsAuthorityReport(b)) - Number(awaitsAuthorityReport(a)) || Number(isDeviationOverdue(b, today)) - Number(isDeviationOverdue(a, today)) || (isDeviationOverdue(a, today) ? a.dueDate.localeCompare(b.dueDate) : 0) || a.createdAt.getTime() - b.createdAt.getTime()).slice(0, ROWS);
  const responsibleIds = [...new Set(shown.flatMap((item) => item.responsibleUserId ? [item.responsibleUserId] : []))];
  const people = responsibleIds.length ? await prisma.organizationMember.findMany({ where: { organizationId: ctx.organizationId, userId: { in: responsibleIds } }, select: { userId: true, user: { select: { name: true, email: true } } } }) : [];
  const nameOf = new Map(people.map((person) => [person.userId, person.user.name || person.user.email]));
  return {
    ...empty,
    counts: countDeviations(items, today),
    rows: shown.map((item) => ({
      id: item.id, label: `${DEVIATION_KINDS[item.kind === "IMPROVEMENT" ? "IMPROVEMENT" : "DEVIATION"]} ${item.number}`, title: item.title, dueDate: item.dueDate, status: item.status,
      overdue: isDeviationOverdue(item, today), responsibleName: item.responsibleUserId ? nameOf.get(item.responsibleUserId) ?? "Tidigare medarbetare" : null,
      ageDays: ageInDays(swedishDayKey(item.createdAt), today), href: deviationHref(item.id), reportable: awaitsAuthorityReport(item),
    })),
  };
}

/** Accepterade offerter utan arbetsorder; the sum (exkl. moms) only with the price right. Ekonomi reads the same list. */
export async function loadAcceptedQuotes(ctx: Context, prices: boolean): Promise<TeamTabData["acceptedQuotes"]> {
  const where: Prisma.QuoteWhereInput = { organizationId: ctx.organizationId, status: "ACCEPTED", supersededAt: null, workOrderId: null, changeOfVersion: null };
  const [rows, total] = await Promise.all([
    prisma.quote.findMany({
      where, orderBy: [{ decidedAt: "desc" }, { id: "asc" }], take: ROWS,
      select: {
        id: true, number: true, version: true, title: true, status: true, supersededAt: true, workOrderId: true, changeOfVersion: true, decidedAt: true, vatPercent: true,
        customer: { select: { name: true, company: true } },
        // The lines are read only for someone who may see the sum.
        lines: prices ? { select: { kind: true, quantity: true, unitPrice: true, markupPercent: true } } : false,
      },
    }),
    prisma.quote.count({ where }),
  ]);
  return {
    total, prices, href: listHref("quotes", { filter: "ACCEPTED" }),
    rows: rows.filter(awaitsWorkOrder).map((row) => {
      const lines = (row as { lines?: { kind: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null; markupPercent: Prisma.Decimal | null }[] }).lines;
      // Without the price right the lines were never read, so there is no sum to send.
      const net = prices && lines ? quoteTotals(lines.map((line) => ({ kind: line.kind as QuoteLineKind, quantity: decimal(line.quantity) ?? 0, unitPrice: decimal(line.unitPrice), markupPercent: decimal(line.markupPercent) })), decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT).net : null;
      return { id: row.id, label: quoteLabel(row), title: row.title, customerName: customerName(row.customer), decidedOn: row.decidedAt ? swedishDayKey(row.decidedAt) : null, net, href: `/?view=quote&quoteId=${encodeURIComponent(row.id)}` };
    }),
  };
}

/**
 * Projektläge with the overview's key-figure rules (lib/workflow/overview-kpis.ts): ongoing projects and, of them, the late,
 * over-budget and ready-to-close ones; plus the jobs marked Behöver åtgärdas. Each figure opens the list it counts.
 */
async function loadProjects(ctx: Context, now: Date, can: (subject: WorkflowPermissionSubject) => boolean): Promise<TeamTabData["projects"]> {
  const projects = await prisma.project.findMany({
    where: { organizationId: ctx.organizationId, archivedAt: null, closedAt: null },
    take: 2000,
    select: {
      id: true, name: true, archivedAt: true, closedAt: true, startDate: true, dueDate: true, timeBudgetMinutes: true, customer: { select: { name: true, company: true, customerType: true } },
      // The status uses every linked task and all planning, whatever the viewer may read: one status for everyone.
      workflowTasks: { select: { id: true, status: true } },
      plannedActivities: { where: { deletedAt: null }, select: { status: true, endsAt: true, workflowTaskId: true } },
    },
  });
  const ids = projects.map((project) => project.id);
  const [minutes, needsActionJobs] = await Promise.all([
    ids.length ? prisma.$queryRaw<{ projectId: string; seconds: bigint | number | null }[]>(Prisma.sql`
      select "projectId", sum(seconds) as seconds from (
        select t."projectId", e."durationSec" as seconds
        from "WorkflowTask" t join "WorkflowTimeEntry" e on e."taskId" = t.id
        where t."organizationId" = ${ctx.organizationId} and t."projectId" in (${Prisma.join(ids)})
        union all
        select p.id, e."durationSec"
        from "Project" p join "WorkflowTimeEntry" e on e."projectId" = p.id
        where p."organizationId" = ${ctx.organizationId} and p.id in (${Prisma.join(ids)})
      ) owned group by 1`) : [],
    prisma.workflowTask.count({ where: { organizationId: ctx.organizationId, status: "NEEDS_ACTION", AND: [readableTaskWhere(can)] } }),
  ]);
  const reported = new Map(minutes.map((row) => [row.projectId, Math.round(Number(row.seconds ?? 0) / 60)]));
  const rows = projects.map((project) => ({
    id: project.id, name: project.name, dueDate: project.dueDate ?? "", tasks: project.workflowTasks,
    customerName: project.customer ? project.customer.customerType === "PRIVATE" ? project.customer.name : customerName(project.customer) : "",
    status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: project.workflowTasks, activities: project.plannedActivities, now }),
    timeBudgetMinutes: project.timeBudgetMinutes, reportedMinutes: reported.get(project.id) ?? 0,
  })).filter((project) => project.status.ongoing);
  return {
    ongoing: rows.length,
    overdue: rows.filter((project) => projectAttention(project, "overdue")).length,
    overBudget: rows.filter((project) => projectAttention(project, "overBudget")).length,
    readyToClose: rows.filter((project) => projectAttention(project, "readyToClose")).length,
    needsActionJobs,
    list: projectRows(rows),
    links: {
      ongoing: overviewKpiHref("ongoingProjects", "team", now), overdue: overviewKpiHref("overdue", "team", now), overBudget: overviewKpiHref("overBudget", "team", now),
      readyToClose: overviewKpiHref("readyToClose", "team", now), needsAction: overviewKpiHref("needsActionTasks", "team", now),
    },
  };
}

/**
 * Säkerhet: round safety checks of the last 30 days whose answers say the conditions have changed (the protocols' own
 * data.roundSafety, 2026-10-27 punkt 4), among the protocols the person may read. Null when there is nothing to read
 * from – no fake figures.
 */
async function loadSafety(ctx: Context, now: Date, can: (subject: WorkflowPermissionSubject) => boolean): Promise<TeamTabData["safety"]> {
  if (!readableTaskScope(can).areas.length) return null;
  const since = addSwedishDays(now, -SAFETY_DAYS).toISOString();
  const rows = await prisma.$queryRaw<{ id: string; title: string; workOrderId: string | null; data: unknown; confirmedAt: string }[]>`
    select t.id, t.title, t."workOrderId", jsonb_build_object('roundSafety', t.data -> 'roundSafety') as data, t.data #>> '{roundSafety,confirmedAt}' as "confirmedAt"
    from "WorkflowTask" t
    where t."organizationId" = ${ctx.organizationId} and t.kind = 'FORM' and ${readableTaskSql(can)}
      and coalesce(t.data ->> 'roundSafetyStep', '') = 'true'
      and t.data #>> '{roundSafety,confirmedAt}' >= ${since}
      and (t.data #>> '{roundSafety,answers,stillValid}' = 'no' or t.data #>> '{roundSafety,answers,changed}' = 'yes' or t.data #>> '{roundSafety,answers,newRisks}' = 'yes')
    order by "confirmedAt" desc
    limit 200`;
  const changed = rows.filter((row) => roundSafetyChanged(row.data));
  return {
    changed: changed.length,
    rows: changed.slice(0, ROWS).map((row) => ({
      id: row.id, title: row.title, checkedOn: swedishDayKey(new Date(row.confirmedAt)), href: taskHref(row.id, "FORM"),
      workOrderHref: row.workOrderId && can("work-order") ? taskHref(row.workOrderId, "WORK_ORDER") : null,
    })),
  };
}
