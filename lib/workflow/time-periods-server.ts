import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import type { Context } from "@/lib/kfid/server";
import { canViewTeam, hasWorkflowPermission, normalizeWorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { timeEntryInOrganization } from "@/lib/workflow/timer-server";
import { lockTimePeriod } from "@/lib/workflow/time-period-lock";
import { startOfSwedishDay, swedishDayKey } from "@/lib/swedish-time";
import { effectiveWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import { clearMonthSubmitted, monthRef, parseMonthRef, parseTeamNoticeKey, recordTeamNotice, reminderKeyStart, TEAM_NOTICE_CHANNEL, TEAM_NOTICE_PREFIX, timeNoticeRecipients } from "@/lib/workflow/team-notice";
import {
  absenceDaysInMonth, monthGap, nextTimePeriodStatus, periodBounds, periodLabel, periodOf, remindRefusal, shownStatus, TIME_PERIOD_AUDIT_ACTION, TIME_PERIOD_DONE, TIME_PERIOD_REMIND_AUDIT, timePeriodAuditText, timePeriodInputSchema,
  timePeriodRemindAuditText, timePeriodRemindSchema, TimePeriodError, type MonthGap, type TimePeriodStatus, type TimePeriodView,
} from "@/lib/workflow/time-periods";

/**
 * Tidsperiod med serverlagring (2026-10-30): the rules of lib/workflow/time-periods.ts against the database. The lock on time
 * writes is lib/workflow/time-period-lock.ts; this file reads the months and runs Skicka in, Godkänn, Skicka tillbaka and
 * Öppna igen. Who approves: admins and the Teamet right (canViewTeam) – the people who already see the team's time and
 * register others' absence. Every action is written to the company's administration log (AdministrationEvent).
 */
type Ctx = Pick<Context, "organizationId" | "user" | "admin" | "workflowPermissions">;
const MAX_PEOPLE = 500;

/** The approver rule, one place: admins and the Teamet right. */
export const mayApproveTime = (ctx: Pick<Context, "admin" | "workflowPermissions">) => canViewTeam(ctx);
/** Whether a member approves time (and plans the team): the owner, admins and the Teamet right. */
export const memberApproves = (member: { role: string; workflowPermissions: unknown }) =>
  member.role === "OWNER" || member.role === "ADMIN" || hasWorkflowPermission(normalizeWorkflowPermissionProfile(member.workflowPermissions), "team", "read");

/**
 * The stored status per person for one month of the company (YYYY-MM), for the payroll export. A person without a row is
 * open (not in the map). Only this company's rows.
 */
export async function periodStatuses(ctx: Pick<Context, "organizationId">, period: string): Promise<Map<string, TimePeriodStatus>> {
  const rows = await prisma.timePeriod.findMany({ where: { organizationId: ctx.organizationId, period }, select: { userId: true, status: true } });
  return new Map(rows.map((row) => [row.userId, row.status as TimePeriodStatus]));
}

/** The active members other than `userId` who may approve (bounded). */
async function otherApprovers(organizationId: string, userId: string) {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId, isActive: true, user: { is: { isActive: true } }, userId: { not: userId } },
    select: { userId: true, role: true, workflowPermissions: true }, take: 1000,
  });
  return members.filter(memberApproves).map((member) => member.userId);
}

/** Finished seconds per person in the month (this company's time only). */
async function secondsByPerson(organizationId: string, period: string, userIds?: string[]) {
  const { startsAt, endsAt } = periodBounds(period);
  const rows = await prisma.workflowTimeEntry.groupBy({
    by: ["userId"],
    where: { AND: [timeEntryInOrganization(organizationId)], startedAt: { gte: startsAt, lt: endsAt }, endedAt: { not: null }, ...(userIds ? { userId: { in: userIds } } : {}) },
    _sum: { durationSec: true },
  });
  return new Map(rows.map((row) => [row.userId, row._sum.durationSec ?? 0]));
}

const runningIn = (tx: Pick<typeof prisma, "workflowTimeEntry">, organizationId: string, userId: string, period: string) => {
  const { startsAt, endsAt } = periodBounds(period);
  return tx.workflowTimeEntry.count({ where: { userId, endedAt: null, startedAt: { gte: startsAt, lt: endsAt }, AND: [timeEntryInOrganization(organizationId)] } });
};

export type TimePeriodPerson = {
  userId: string; name: string; status: TimePeriodView; note: string; hours: number; submittedAt: string | null; decidedAt: string | null; decidedBy: string | null;
  mine: boolean; canDecide: boolean;
  /** Workdays away in the month (approved absence), as days. Only how much, never the type or reason. */
  absenceDays: number;
  /** Someone reminded the person about this month today (Påminn is one a day). */
  remindedToday: boolean;
};
export type TimePeriodAnswer = {
  period: string; label: string; current: string;
  me: TimePeriodPerson & { running: boolean; selfApproves: boolean; gap: MonthGap | null };
  canApprove: boolean;
  /** Approvers only: everyone active in the company for the month. */
  people: TimePeriodPerson[] | null;
};

/** The month for Tid: my own status and, for approvers, everyone's. */
export async function loadTimePeriods(ctx: Ctx, period: string, now = new Date()): Promise<TimePeriodAnswer> {
  const approver = mayApproveTime(ctx);
  const [members, rows, running] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, isActive: true, user: { is: { isActive: true } }, ...(approver ? {} : { userId: ctx.user.id }) },
      orderBy: { user: { name: "asc" } }, take: MAX_PEOPLE,
      select: { userId: true, role: true, workflowPermissions: true, weeklyWorkMinutes: true, noFixedHours: true, user: { select: { name: true, email: true } } },
    }),
    prisma.timePeriod.findMany({ where: { organizationId: ctx.organizationId, period, ...(approver ? {} : { userId: ctx.user.id }) }, take: MAX_PEOPLE * 2 }),
    runningIn(prisma, ctx.organizationId, ctx.user.id, period),
  ]);
  const { startsAt, endsAt } = periodBounds(period);
  const lastDay = swedishDayKey(new Date(endsAt.getTime() - 1));
  const [absenceRows, ownEntries, organization, reminders] = await Promise.all([
    prisma.absence.findMany({
      where: { organizationId: ctx.organizationId, toDate: { gte: `${period}-01` }, fromDate: { lte: lastDay }, ...(approver ? {} : { userId: ctx.user.id }) },
      take: 5000, select: { userId: true, fromDate: true, toDate: true, startTime: true, endTime: true, status: true },
    }),
    prisma.workflowTimeEntry.findMany({ where: { userId: ctx.user.id, startedAt: { gte: startsAt, lt: endsAt }, AND: [timeEntryInOrganization(ctx.organizationId)] }, take: 5000, select: { startedAt: true } }),
    prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { weeklyWorkMinutes: true } }),
    approver ? prisma.noticeDelivery.findMany({
      where: { organizationId: ctx.organizationId, channel: TEAM_NOTICE_CHANNEL, key: { startsWith: `${TEAM_NOTICE_PREFIX}TIME_REMINDER|` }, createdAt: { gte: startOfSwedishDay(now) } },
      take: MAX_PEOPLE * 2, select: { key: true },
    }) : [],
  ]);
  const absencesOf = (userId: string) => absenceRows.filter((row) => row.userId === userId).map((row) => ({ from: row.fromDate, to: row.toDate, status: row.status, hours: row.startTime && row.endTime ? { start: row.startTime, end: row.endTime } : null }));
  const remindedPeople = new Set(reminders.flatMap((row) => { const ref = parseTeamNoticeKey(row.key)?.ref; const month = ref ? parseMonthRef(ref) : null; return month?.period === period ? [month.userId] : []; }));
  const seconds = await secondsByPerson(ctx.organizationId, period, approver ? undefined : [ctx.user.id]);
  const deciders = [...new Set(rows.flatMap((row) => (row.decidedById ? [row.decidedById] : [])))];
  const deciderNames = deciders.length ? new Map((await prisma.user.findMany({ where: { id: { in: deciders } }, select: { id: true, name: true, email: true } })).map((user) => [user.id, user.name || user.email])) : new Map<string, string>();
  // Approvers other than each person: a person's month is decided by someone else unless nobody else may.
  const approverIds = approver ? members.filter(memberApproves).map((member) => member.userId) : [];
  const othersApprove = (userId: string) => approverIds.some((id) => id !== userId);
  const personOf = (userId: string, name: string): TimePeriodPerson => {
    const row = rows.find((item) => item.userId === userId);
    const mine = userId === ctx.user.id;
    return {
      userId, name, status: shownStatus(row?.status, row?.submittedAt), note: row?.note ?? "", hours: Math.round(((seconds.get(userId) ?? 0) / 3600) * 100) / 100,
      submittedAt: row?.submittedAt?.toISOString() ?? null, decidedAt: row?.decidedAt?.toISOString() ?? null, decidedBy: row?.decidedById ? deciderNames.get(row.decidedById) ?? "Tidigare medarbetare" : null,
      mine, canDecide: approver && (!mine || !othersApprove(userId)),
      absenceDays: absenceDaysInMonth(period, absencesOf(userId)), remindedToday: remindedPeople.has(userId),
    };
  };
  const self = members.find((member) => member.userId === ctx.user.id);
  const meBase = personOf(ctx.user.id, self ? self.user.name || self.user.email : ctx.user.name || ctx.user.email);
  // Sending in approves at once only when nobody else may approve (a one-person company).
  const selfApproves = approver && !othersApprove(ctx.user.id);
  // Före Skicka in (PL8): what the month ought to hold, against the person's own ordinary week. No fixed hours: nothing to compare.
  const weeklyMinutes = self?.noFixedHours || !organization ? null : effectiveWeeklyWorkMinutes(organization.weeklyWorkMinutes, self?.weeklyWorkMinutes ?? null);
  const gap = monthGap({ period, today: swedishDayKey(now), weeklyMinutes, entryDays: new Set(ownEntries.map((entry) => swedishDayKey(entry.startedAt))), absences: absencesOf(ctx.user.id) });
  return {
    period, label: periodLabel(period), current: periodOf(now),
    me: { ...meBase, running: running > 0, selfApproves, gap },
    canApprove: approver,
    people: approver ? members.map((member) => personOf(member.userId, member.user.name || member.user.email)) : null,
  };
}

/** Skicka in, Godkänn, Skicka tillbaka, Öppna igen – one month of one person, in one transaction with the month's lock. */
export async function timePeriodAction(ctx: Ctx, raw: unknown, now = new Date()) {
  const input = timePeriodInputSchema.parse(raw);
  const userId = input.userId ?? ctx.user.id;
  const member = await prisma.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, userId }, select: { user: { select: { name: true, email: true } } } });
  if (!member) throw new ApiError(404, "Medarbetaren finns inte i företaget.");
  const approver = mayApproveTime(ctx);
  const approvers = await otherApprovers(ctx.organizationId, userId);
  const otherApprover = approvers.length > 0;
  const person = member.user.name || member.user.email;
  const result = await prisma.$transaction(async (tx) => {
    // The same lock as every time write in the month (time-period-lock.ts).
    await lockTimePeriod(tx, ctx.organizationId, userId, input.period);
    const current = await tx.timePeriod.findUnique({ where: { organizationId_userId_period: { organizationId: ctx.organizationId, userId, period: input.period } } });
    const running = input.action === "submit" ? await runningIn(tx, ctx.organizationId, userId, input.period) : 0;
    let next: ReturnType<typeof nextTimePeriodStatus>;
    try {
      next = nextTimePeriodStatus({ action: input.action, current: current?.status, period: input.period, now, note: input.note, actorIsOwner: userId === ctx.user.id, approver, otherApprover, runningInPeriod: running > 0 });
    } catch (error) {
      if (error instanceof TimePeriodError) throw new ApiError(error.status, error.message);
      throw error;
    }
    // Öppna igen leaves the month as not sent in (shownStatus); Skicka tillbaka keeps when it was sent in.
    const submitted = input.action === "submit" ? { submittedAt: now, submittedById: ctx.user.id } : input.action === "reopen" ? { submittedAt: null, submittedById: null } : {};
    const decided = input.action !== "submit" || next.selfApproved ? { decidedAt: now, decidedById: ctx.user.id } : { decidedAt: null, decidedById: null };
    const data = { status: next.status, note: input.note, ...submitted, ...decided };
    await tx.timePeriod.upsert({
      where: { organizationId_userId_period: { organizationId: ctx.organizationId, userId, period: input.period } },
      create: { organizationId: ctx.organizationId, userId, period: input.period, ...data },
      update: data,
    });
    await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: TIME_PERIOD_AUDIT_ACTION[input.action], detail: timePeriodAuditText(input.action, next.status, person, input.period) } });
    // Teamets notiser (användartest 2026-10-31, F5): the approvers on Skicka in; the person on Godkänn, Skicka tillbaka and Öppna
    // igen. A decided month's "sent in" notice goes for every approver.
    if (input.action !== "submit") await clearMonthSubmitted(tx, { organizationId: ctx.organizationId, userId, period: input.period });
    const told = timeNoticeRecipients({ action: input.action, status: next.status, userId, actorId: ctx.user.id, approvers });
    if (told) await recordTeamNotice(tx, { organizationId: ctx.organizationId, type: told.type, ref: monthRef(userId, input.period), actorId: ctx.user.id, userIds: told.userIds, at: now });
    return next;
  });
  return { ok: true, status: result.status, message: result.selfApproved ? "Månaden är inskickad och godkänd." : TIME_PERIOD_DONE[input.action] };
}

/**
 * Påminn (2026-11-01, beslut 13): an approver reminds a person whose month is not sent in – a notice in the person's bell,
 * through the same NoticeDelivery rows as the other team notices, so no new table. One per person and month a day, whoever reminds:
 * the month's own lock makes two at once one. Written to the company's administration log.
 */
export async function remindTimePeriod(ctx: Ctx, raw: unknown, now = new Date()) {
  const input = timePeriodRemindSchema.parse(raw);
  if (!mayApproveTime(ctx)) throw new ApiError(403, "Du saknar behörighet att påminna om tid.");
  const member = await prisma.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, userId: input.userId, isActive: true, user: { is: { isActive: true } } }, select: { user: { select: { name: true, email: true } } } });
  if (!member) throw new ApiError(404, "Medarbetaren finns inte i företaget.");
  const person = member.user.name || member.user.email;
  return prisma.$transaction(async (tx) => {
    await lockTimePeriod(tx, ctx.organizationId, input.userId, input.period);
    const current = await tx.timePeriod.findUnique({ where: { organizationId_userId_period: { organizationId: ctx.organizationId, userId: input.userId, period: input.period } }, select: { status: true } });
    const refusal = remindRefusal({ current: current?.status, period: input.period, now, own: input.userId === ctx.user.id, person });
    if (refusal) throw new ApiError(refusal.status, refusal.message);
    const earlier = await tx.noticeDelivery.findFirst({ where: { organizationId: ctx.organizationId, userId: input.userId, channel: TEAM_NOTICE_CHANNEL, key: { startsWith: reminderKeyStart(input.userId, input.period) }, createdAt: { gte: startOfSwedishDay(now) } }, select: { id: true } });
    if (earlier) return { ok: true, reminded: false, message: `${person} är redan påmind i dag.` };
    await recordTeamNotice(tx, { organizationId: ctx.organizationId, type: "TIME_REMINDER", ref: monthRef(input.userId, input.period), actorId: ctx.user.id, userIds: [input.userId], at: now });
    await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: TIME_PERIOD_REMIND_AUDIT, detail: timePeriodRemindAuditText(person, input.period) } });
    return { ok: true, reminded: true, message: `${person} har fått en påminnelse.` };
  });
}
