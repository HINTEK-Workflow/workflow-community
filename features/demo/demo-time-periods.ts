import { canViewTeam } from "@/lib/workflow/permissions";
import { swedishDayKey } from "@/lib/swedish-time";
import { effectiveWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import {
  absenceDaysInMonth, lockedPeriodMessage, lockedTouch, monthGap, nextTimePeriodStatus, periodBounds, periodLabel, periodOf, remindRefusal, shownStatus, TIME_PERIOD_AUDIT_ACTION, TIME_PERIOD_DONE, TIME_PERIOD_REMIND_AUDIT, timePeriodAuditText,
  timePeriodInputSchema, timePeriodRemindAuditText, timePeriodRemindSchema, timePeriodSchema, TimePeriodError, type TimeTouch,
} from "@/lib/workflow/time-periods";
import type { DemoDatabase, DemoTimePeriod, DemoUser } from "./demo-data";

/**
 * Tidsperiod i demon (2026-10-30): GET and POST /api/time-periods answered from memory with the rules of
 * lib/workflow/time-periods.ts, the same as Cloud (lib/workflow/time-periods-server.ts) – Skicka in, Godkänn, Skicka tillbaka,
 * Öppna igen and Påminn; a sent-in or approved month locks the person's time in it. A reload starts over.
 */
export class DemoTimePeriodError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type Ctx = { db: DemoDatabase; user: DemoUser; admin: boolean; now: Date };
type Request = { method: string; url: URL; body: unknown };

const approves = (user: DemoUser) => user.role === "ADMIN" || canViewTeam({ admin: false, workflowPermissions: user.permissions });
const periodsOf = (db: DemoDatabase) => (db.timePeriods ??= []);
const rowOf = (db: DemoDatabase, userId: string, period: string) => periodsOf(db).find((row) => row.userId === userId && row.period === period);

/** The lock for the demo's time writes: throws when a touched month is sent in or approved. */
export function demoAssertTimeOpen(db: DemoDatabase, touches: readonly TimeTouch[], actorUserId: string) {
  const found = lockedTouch(touches, (userId, period) => rowOf(db, userId, period)?.status);
  if (found) throw new DemoTimePeriodError(409, lockedPeriodMessage(found.period, found.status, found.userId === actorUserId));
}

export function demoTimePeriods(ctx: Ctx, request: Request) {
  if (request.method === "GET") {
    const raw = request.url.searchParams.get("period");
    const period = raw ? timePeriodSchema.parse(raw) : periodOf(ctx.now);
    const approver = ctx.admin || approves(ctx.user);
    const { startsAt, endsAt } = periodBounds(period);
    const inMonth = (userId: string) => ctx.db.timeEntries.filter((entry) => entry.userId === userId && Date.parse(entry.startedAt) >= startsAt.getTime() && Date.parse(entry.startedAt) < endsAt.getTime());
    const approverIds = ctx.db.users.filter(approves).map((user) => user.id);
    const personOf = (user: DemoUser) => {
      const row = rowOf(ctx.db, user.id, period);
      const mine = user.id === ctx.user.id;
      return {
        userId: user.id, name: user.name, status: shownStatus(row?.status, row?.submittedAt), note: row?.note ?? "",
        hours: Math.round((inMonth(user.id).filter((entry) => entry.endedAt).reduce((sum, entry) => sum + entry.durationSec, 0) / 3600) * 100) / 100,
        submittedAt: row?.submittedAt ?? null, decidedAt: row?.decidedAt ?? null, decidedBy: row?.decidedById ? ctx.db.users.find((item) => item.id === row.decidedById)?.name ?? "Tidigare medarbetare" : null,
        mine, canDecide: approver && (!mine || !approverIds.some((id) => id !== user.id)),
        absenceDays: absenceDaysInMonth(period, ctx.db.absences.filter((item) => item.userId === user.id)),
        remindedToday: (ctx.db.timeReminders ?? []).some((item) => item.userId === user.id && item.period === period && item.day === swedishDayKey(ctx.now)),
      };
    };
    return {
      period, label: periodLabel(period), current: periodOf(ctx.now),
      me: { ...personOf(ctx.user), running: inMonth(ctx.user.id).some((entry) => !entry.endedAt), selfApproves: approver && !approverIds.some((id) => id !== ctx.user.id),
        gap: monthGap({ period, today: swedishDayKey(ctx.now), weeklyMinutes: ctx.user.noFixedHours ? null : effectiveWeeklyWorkMinutes(ctx.db.organization.weeklyWorkMinutes, ctx.user.weeklyWorkMinutes ?? null),
          entryDays: new Set(inMonth(ctx.user.id).map((entry) => swedishDayKey(new Date(entry.startedAt)))), absences: ctx.db.absences.filter((item) => item.userId === ctx.user.id) }) },
      canApprove: approver,
      people: approver ? [...ctx.db.users].sort((a, b) => a.name.localeCompare(b.name, "sv")).map(personOf) : null,
    };
  }
  if ((request.body as { action?: unknown } | null)?.action === "remind") return demoRemind(ctx, request.body);
  const input = timePeriodInputSchema.parse(request.body);
  const userId = input.userId ?? ctx.user.id;
  const person = ctx.db.users.find((user) => user.id === userId);
  if (!person) throw new DemoTimePeriodError(404, "Medarbetaren finns inte i företaget.");
  const current = rowOf(ctx.db, userId, input.period);
  const { startsAt, endsAt } = periodBounds(input.period);
  const running = ctx.db.timeEntries.some((entry) => entry.userId === userId && !entry.endedAt && Date.parse(entry.startedAt) >= startsAt.getTime() && Date.parse(entry.startedAt) < endsAt.getTime());
  let next: ReturnType<typeof nextTimePeriodStatus>;
  try {
    next = nextTimePeriodStatus({ action: input.action, current: current?.status, period: input.period, now: ctx.now, note: input.note, actorIsOwner: userId === ctx.user.id,
      approver: ctx.admin || approves(ctx.user), otherApprover: ctx.db.users.some((user) => user.id !== userId && approves(user)), runningInPeriod: running });
  } catch (error) {
    throw error instanceof TimePeriodError ? new DemoTimePeriodError(error.status, error.message) : error;
  }
  const at = ctx.now.toISOString();
  const row: DemoTimePeriod = current ?? { userId, period: input.period, status: next.status, note: "", submittedAt: null, decidedAt: null, decidedById: null };
  Object.assign(row, { status: next.status, note: input.note },
    input.action === "submit" ? { submittedAt: at } : input.action === "reopen" ? { submittedAt: null } : {},
    input.action !== "submit" || next.selfApproved ? { decidedAt: at, decidedById: ctx.user.id } : { decidedAt: null, decidedById: null });
  if (!current) periodsOf(ctx.db).push(row);
  ctx.db.adminEvents.push({ id: `demo-admin-${++ctx.db.sequence}`, action: TIME_PERIOD_AUDIT_ACTION[input.action], detail: timePeriodAuditText(input.action, next.status, person.name, input.period), createdAt: at });
  return { ok: true, status: next.status, message: next.selfApproved ? "Månaden är inskickad och godkänd." : TIME_PERIOD_DONE[input.action] };
}

/** Påminn in the demo: the same rules as Cloud; one a day. A reload starts over. */
function demoRemind(ctx: Ctx, raw: unknown) {
  if (!(ctx.admin || approves(ctx.user))) throw new DemoTimePeriodError(403, "Du saknar behörighet att påminna om tid.");
  const input = timePeriodRemindSchema.parse(raw);
  const person = ctx.db.users.find((user) => user.id === input.userId);
  if (!person) throw new DemoTimePeriodError(404, "Medarbetaren finns inte i företaget.");
  const refusal = remindRefusal({ current: rowOf(ctx.db, input.userId, input.period)?.status, period: input.period, now: ctx.now, own: input.userId === ctx.user.id, person: person.name });
  if (refusal) throw new DemoTimePeriodError(refusal.status, refusal.message);
  const day = swedishDayKey(ctx.now);
  const reminders = (ctx.db.timeReminders ??= []);
  if (reminders.some((item) => item.userId === input.userId && item.period === input.period && item.day === day)) return { ok: true, reminded: false, message: `${person.name} är redan påmind i dag.` };
  reminders.push({ userId: input.userId, period: input.period, day });
  ctx.db.adminEvents.push({ id: `demo-admin-${++ctx.db.sequence}`, action: TIME_PERIOD_REMIND_AUDIT, detail: timePeriodRemindAuditText(person.name, input.period), createdAt: ctx.now.toISOString() });
  return { ok: true, reminded: true, message: `${person.name} har fått en påminnelse.` };
}
