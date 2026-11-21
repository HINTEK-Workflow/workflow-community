import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * Teamets notiser (användartest 2026-10-31: "människor får inte veta när någon annan ändrar något som rör dem"): when someone
 * else books or unbooks a person, registers or removes their absence, or when a month of time is sent in, sent back or
 * approved, the person it concerns gets a notice in the bell – and the approvers get one for a month that waits.
 *
 * No schema change: the same pattern as "Tilldelad dig" (task-assignment-notice.ts). The notice is a NoticeDelivery row with the
 * channel "TEAM" and the key `TEAM:<type>|<ref>|<by user id>|<time in ms>|<extra>` (ref and extra URI-encoded, so they hold no
 * "|"). The bell reads the rows and checks the thing again (the booking, the absence, the month), so a notice whose cause is
 * gone is not shown. A notice is shown for TEAM_NOTICE_DAYS; a month that waits for approval (or was sent back) stays while it
 * still does. Never a reason for an absence: the key holds only its dates, as the absence history (AbsenceEvent).
 * Cloud only: a Local file has one user. Pure: keys, recipients, texts and the bell's items.
 */
export const TEAM_NOTICE_CHANNEL = "TEAM";
export const TEAM_NOTICE_PREFIX = "TEAM:";
/** A notice is shown this many days (a month waiting for approval longer, see waitsDays). */
export const TEAM_NOTICE_DAYS = 7;
/** A month sent in or sent back is shown while it waits, at most this long. */
const WAITS_DAYS = 45;
/** At most this many unread team notices are read for one person (bounded reads). */
export const TEAM_NOTICE_LIMIT = 100;
/** At most this many approvers are told about one month (bounded writes). */
export const TEAM_NOTICE_MAX_RECIPIENTS = 50;

export const TEAM_NOTICE_TYPES = ["BOOKED", "MOVED", "UNBOOKED", "ABSENCE_SET", "ABSENCE_REPORTED", "ABSENCE_REMOVED", "TIME_SUBMITTED", "TIME_RETURNED", "TIME_APPROVED", "TIME_REMINDER"] as const;
export type TeamNoticeType = (typeof TEAM_NOTICE_TYPES)[number];

export type TeamNoticeKey = { type: TeamNoticeType; ref: string; byUserId: string; at: number; extra: string };

export function teamNoticeKey(input: { type: TeamNoticeType; ref: string; byUserId: string; at: Date | number; extra?: string }) {
  const at = typeof input.at === "number" ? input.at : input.at.getTime();
  return `${TEAM_NOTICE_PREFIX}${input.type}|${encodeURIComponent(input.ref)}|${encodeURIComponent(input.byUserId)}|${at}|${encodeURIComponent(input.extra ?? "")}`;
}

export function parseTeamNoticeKey(key: string): TeamNoticeKey | null {
  if (!key.startsWith(TEAM_NOTICE_PREFIX)) return null;
  const parts = key.slice(TEAM_NOTICE_PREFIX.length).split("|");
  if (parts.length !== 5) return null;
  const [type, ref, byUserId, at, extra] = parts;
  if (!(TEAM_NOTICE_TYPES as readonly string[]).includes(type) || !ref || !byUserId || !/^\d+$/.test(at)) return null;
  try {
    return { type: type as TeamNoticeType, ref: decodeURIComponent(ref), byUserId: decodeURIComponent(byUserId), at: Number(at), extra: decodeURIComponent(extra) };
  } catch { return null; }
}

/** The month's ref: the person and the month (YYYY-MM). */
export const monthRef = (userId: string, period: string) => `${userId}~${period}`;
export function parseMonthRef(ref: string): { userId: string; period: string } | null {
  const [userId, period, ...rest] = ref.split("~");
  return userId && period && /^\d{4}-\d{2}$/.test(period) && !rest.length ? { userId, period } : null;
}
/** An absence's dates in the key (never its reason): "from~to". */
export const absenceExtra = (absence: { from: string; to: string }, affected = 0) => `${absence.from}~${absence.to}~${affected}`;
function parseAbsenceExtra(extra: string) {
  const [from, to, affected] = extra.split("~");
  return /^\d{4}-\d{2}-\d{2}$/.test(from ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(to ?? "") ? { from, to, affected: Number(affected) || 0 } : null;
}

/**
 * Who is told about a changed booking: the people added, the people removed, and – when its time moved – the people who stay
 * on it; never the person who made the change. A booking that is cancelled or finished tells nobody it was "booked".
 */
export function bookingNoticeChanges(input: { before: readonly string[]; after: readonly string[]; actorId: string; active: boolean; timeChanged?: boolean }) {
  const before = new Set(input.before), after = new Set(input.after);
  const added = input.active ? [...after].filter((id) => !before.has(id) && id !== input.actorId) : [];
  const removed = [...before].filter((id) => !after.has(id) && id !== input.actorId);
  const moved = input.active && input.timeChanged ? [...after].filter((id) => before.has(id) && id !== input.actorId) : [];
  return { added, removed, moved };
}

/**
 * Who is told about an absence that was saved or removed: the person, when someone else did it; when the person did it
 * themselves, those who plan (the approvers: admins and the Teamet right, `planners`), never the person. For a removal of
 * an absence someone else registered, that someone is told too.
 */
export function absenceNoticeRecipients(input: { userId: string; actorId: string; createdById?: string | null; planners: readonly string[]; removed?: boolean }): { type: TeamNoticeType; userIds: string[] }[] {
  const out: { type: TeamNoticeType; userIds: string[] }[] = [];
  if (input.actorId !== input.userId) {
    out.push({ type: input.removed ? "ABSENCE_REMOVED" : "ABSENCE_SET", userIds: [input.userId] });
    // A manager removing what another manager registered: that one is told as well.
    if (input.removed && input.createdById && input.createdById !== input.actorId && input.createdById !== input.userId) out.push({ type: "ABSENCE_REMOVED", userIds: [input.createdById] });
    return out;
  }
  if (input.removed) {
    // The person removed their own absence: whoever registered it for them is told (and nobody when they registered it themselves).
    if (input.createdById && input.createdById !== input.userId) out.push({ type: "ABSENCE_REMOVED", userIds: [input.createdById] });
    return out;
  }
  const planners = [...new Set(input.planners)].filter((id) => id !== input.userId).slice(0, TEAM_NOTICE_MAX_RECIPIENTS);
  if (planners.length) out.push({ type: "ABSENCE_REPORTED", userIds: planners });
  return out;
}

/** The person may remove an absence someone else registered for them only after saying yes (användartest 2026-10-31, F7). */
export const absenceRemovalNeedsConfirm = (input: { actorId: string; userId: string; createdById: string; planner: boolean }) =>
  !input.planner && input.actorId === input.userId && input.createdById !== input.userId;
export const ABSENCE_REMOVAL_CONFIRM = "Frånvaron lades in av någon annan. Bekräfta att du vill ta bort den – den som lade in den får en notis.";

/** Who is told about a month: on Skicka in the approvers (never the person); on Godkänn or Skicka tillbaka the person (never the approver themselves). */
export function timeNoticeRecipients(input: { action: "submit" | "approve" | "return" | "reopen"; status: string; userId: string; actorId: string; approvers: readonly string[] }): { type: TeamNoticeType; userIds: string[] } | null {
  if (input.action === "submit") {
    if (input.status !== "SUBMITTED") return null;
    const approvers = [...new Set(input.approvers)].filter((id) => id !== input.userId).slice(0, TEAM_NOTICE_MAX_RECIPIENTS);
    return approvers.length ? { type: "TIME_SUBMITTED", userIds: approvers } : null;
  }
  if (input.userId === input.actorId) return null;
  if (input.action === "approve") return { type: "TIME_APPROVED", userIds: [input.userId] };
  // Skicka tillbaka and Öppna igen both give RETURNED: the person is told why.
  return { type: "TIME_RETURNED", userIds: [input.userId] };
}

/** What the bell knows about a notice's cause, read again by the server (null: gone, or not readable for the person). */
export type TeamNoticeContext = {
  byName: string;
  /** BOOKED / UNBOOKED: the booking as it is now; `booked` = the person is still on it. */
  booking?: { title: string; startsAt: string; endsAt: string; href: string; booked: boolean; active: boolean } | null;
  /** ABSENCE_SET / ABSENCE_REPORTED: whether the absence is still there. */
  absenceExists?: boolean;
  /** TIME_*: the month as it is now. */
  month?: { status: string; note: string; personName: string; label: string } | null;
};
export type TeamNoticeRow = { key: string; createdAt: Date; context: TeamNoticeContext };

const oneLine = (value: string, max: number) => value.replace(/[\r\n*[\]()]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);
const MONTHS = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];
/** "3 nov" from YYYY-MM-DD. */
export const shortDate = (day: string) => { const [, month, date] = day.split("-").map(Number); return `${date} ${MONTHS[(month ?? 1) - 1] ?? ""}`.trim(); };
const range = (from: string, to: string) => (from === to ? shortDate(from) : `${shortDate(from)}–${shortDate(to)}`);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const JAG = "/?tab=me";
const TEAMET = "/?tab=team";
const TIME = "/?view=time";
const TIME_TEAM = "/?view=time&tab=team";

/**
 * The bell's Teamet items for one person, newest first. `swedishDay` gives a moment's Swedish day (YYYY-MM-DD). A notice whose
 * cause is gone (the booking was removed, the person was booked back, the absence removed, the month decided) is not shown.
 */
export function teamNotifications(rows: readonly TeamNoticeRow[], now: Date, swedishDay: (iso: string) => string): TaskNotification[] {
  return rows.flatMap((row): TaskNotification[] => {
    const key = parseTeamNoticeKey(row.key);
    if (!key) return [];
    const ageDays = (now.getTime() - row.createdAt.getTime()) / 86_400_000;
    const waits = key.type === "TIME_SUBMITTED" || key.type === "TIME_RETURNED";
    if (ageDays > (waits ? WAITS_DAYS : TEAM_NOTICE_DAYS)) return [];
    const by = oneLine(row.context.byName, 80) || "En kollega";
    const base = { id: `${TEAM_NOTICE_PREFIX}${key.type}:${key.ref}:${key.at}`, kind: "TEAM" as const, dueDate: "", deadline: null, needsAction: false, assignedBy: by, assignedAt: row.createdAt.toISOString() };
    const ctx = row.context;
    switch (key.type) {
      case "BOOKED":
      case "MOVED":
      case "UNBOOKED": {
        const booking = ctx.booking;
        if (!booking) return [];
        const when = range(swedishDay(booking.startsAt), swedishDay(new Date(Date.parse(booking.endsAt) - 1).toISOString()));
        if (key.type !== "UNBOOKED") {
          if (!booking.booked || !booking.active || Date.parse(booking.endsAt) <= now.getTime()) return [];
          return [{ ...base, title: oneLine(booking.title, 160) || "Bokning", detail: key.type === "MOVED" ? `${by} har flyttat bokningen till ${when}.` : `${by} har bokat dig ${when}.`, href: booking.href }];
        }
        if (booking.booked) return [];
        return [{ ...base, title: oneLine(booking.title, 160) || "Bokning", detail: `${by} har tagit bort dig från bokningen ${when}.`, href: booking.href }];
      }
      case "ABSENCE_SET":
      case "ABSENCE_REPORTED":
      case "ABSENCE_REMOVED": {
        const dates = parseAbsenceExtra(key.extra);
        if (!dates) return [];
        if (key.type !== "ABSENCE_REMOVED" && !ctx.absenceExists) return [];
        const when = range(dates.from, dates.to);
        if (key.type === "ABSENCE_SET") return [{ ...base, title: `Frånvaro ${when}`, detail: `${by} har lagt in frånvaro för dig ${when}.`, href: JAG }];
        if (key.type === "ABSENCE_REMOVED") return [{ ...base, title: `Frånvaro ${when} borttagen`, detail: `${by} har tagit bort frånvaron ${when}.`, href: JAG }];
        const jobs = dates.affected ? ` ${dates.affected} ${dates.affected === 1 ? "planerat jobb påverkas" : "planerade jobb påverkas"}.` : "";
        return [{ ...base, title: `${by} är frånvarande ${when}`, detail: `${by} har anmält frånvaro ${when}.${jobs}`, href: TEAMET, needsAction: dates.affected > 0 }];
      }
      case "TIME_SUBMITTED":
      case "TIME_RETURNED":
      case "TIME_APPROVED":
      case "TIME_REMINDER": {
        const month = ctx.month;
        if (!month) return [];
        if (key.type === "TIME_SUBMITTED") {
          if (month.status !== "SUBMITTED") return [];
          return [{ ...base, title: `${oneLine(month.personName, 80) || by} har skickat in ${month.label}`, detail: "Väntar på godkännande under Tid → Teamet.", href: TIME_TEAM, needsAction: true }];
        }
        if (key.type === "TIME_RETURNED") {
          if (month.status !== "RETURNED") return [];
          return [{ ...base, title: `${capital(month.label)} skickades tillbaka`, detail: `${by}: ${oneLine(month.note, 200) || "Rätta och skicka in igen."}`, href: TIME, needsAction: true }];
        }
        // Påminn (2026-11-01): gone as soon as the month is sent in.
        if (key.type === "TIME_REMINDER") {
          if (month.status === "SUBMITTED" || month.status === "APPROVED") return [];
          return [{ ...base, title: `Skicka in din tid för ${month.label}`, detail: `${by} påminner dig.`, href: TIME, needsAction: true }];
        }
        if (month.status !== "APPROVED") return [];
        return [{ ...base, title: `${capital(month.label)} är godkänd`, detail: `Godkänd av ${by}.`, href: TIME }];
      }
    }
  }).sort((a, b) => (b.assignedAt ?? "").localeCompare(a.assignedAt ?? "") || a.id.localeCompare(b.id));
}

/** The part of the database (or a transaction) the notices need; tests pass their own. */
export type TeamNoticeDb = {
  noticeDelivery: {
    create(args: { data: { organizationId: string; userId: string; key: string; channel: string }; select: { id: true } }): Promise<unknown>;
    deleteMany(args: { where: { organizationId: string; channel: string; key: { startsWith: string }; userId?: string } }): Promise<unknown>;
  };
};

/**
 * Writes one notice per recipient (the caller has checked tenant, rights and that the recipients are members of the company).
 * Never to the actor. A notice is a courtesy: a failure to write it never undoes the change, so callers may catch.
 */
export async function recordTeamNotice(db: TeamNoticeDb, input: { organizationId: string; type: TeamNoticeType; ref: string; actorId: string; userIds: readonly string[]; at?: Date; extra?: string }) {
  const at = input.at ?? new Date();
  const ids = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId).slice(0, TEAM_NOTICE_MAX_RECIPIENTS);
  for (const userId of ids)
    await db.noticeDelivery.create({ data: { organizationId: input.organizationId, userId, key: teamNoticeKey({ type: input.type, ref: input.ref, byUserId: input.actorId, at, extra: input.extra }), channel: TEAM_NOTICE_CHANNEL }, select: { id: true } });
  return ids;
}

/** The key's start for a reminder about one person's month: one a day (time-periods-server.ts, remindTimePeriod). */
export const reminderKeyStart = (userId: string, period: string) => `${TEAM_NOTICE_PREFIX}TIME_REMINDER|${encodeURIComponent(monthRef(userId, period))}|`;

/** The month was decided: nobody has the "sent in" notice of it any more. */
export async function clearMonthSubmitted(db: TeamNoticeDb, input: { organizationId: string; userId: string; period: string }) {
  await db.noticeDelivery.deleteMany({ where: { organizationId: input.organizationId, channel: TEAM_NOTICE_CHANNEL, key: { startsWith: `${TEAM_NOTICE_PREFIX}TIME_SUBMITTED|${encodeURIComponent(monthRef(input.userId, input.period))}|` } } });
}

/** The toast the recipient sees while they are in the app. */
export const teamToastText = (item: Pick<TaskNotification, "title" | "detail">) => item.detail || item.title;
