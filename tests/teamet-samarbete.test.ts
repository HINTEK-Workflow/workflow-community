import assert from "node:assert/strict";
import test from "node:test";
import { affectedWork, firstDayBack, type Absence } from "../lib/workflow/absence";
import { bookingClashes, bookingDays, bookingWarningText } from "../lib/workflow/booking-warning";
import { groupTimeChoices, RECENT_CHOICES, searchTimeChoices, type TimeChoice } from "../lib/workflow/time-choices";
import { noticeKey, noticeKindsOf } from "../lib/workflow/notice-channels";
import { obstacleNotifications } from "../lib/workflow/obstacle-notice";
import { reportObstacle } from "../lib/workflow/obstacles";
import { teamGroupCounts } from "../lib/overview/team-headline";
import { swedishClock, swedishDayKey } from "../lib/swedish-time";
import {
  absenceExtra, absenceNoticeRecipients, absenceRemovalNeedsConfirm, bookingNoticeChanges, clearMonthSubmitted, monthRef, parseMonthRef, parseTeamNoticeKey,
  recordTeamNotice, TEAM_NOTICE_CHANNEL, teamNoticeKey, teamNotifications, timeNoticeRecipients, type TeamNoticeContext, type TeamNoticeDb,
} from "../lib/workflow/team-notice";

// Användartest 2026-10-31 (teamet): the rules behind the fixes F1–F8.
const absence = (over: Partial<Absence> = {}): Absence => ({ id: "a", userId: "u", type: "SICK", note: "", from: "2026-11-02", to: "2026-11-02", hours: null, createdBy: "u", createdAt: "", handled: [], ...over });
const day = (iso: string) => swedishDayKey(new Date(iso));
const clock = (iso: string) => swedishClock(new Date(iso));

test("F2 Skjut upp: the first day back skips a following absence and the weekend", () => {
  const sick = absence({ id: "s", from: "2026-11-02", to: "2026-11-02" });
  const vab = absence({ id: "v", type: "VAB", from: "2026-11-03", to: "2026-11-03" });
  assert.equal(firstDayBack(sick), "2026-11-03", "without the others: the next workday, as before");
  assert.equal(firstDayBack(sick, [sick, vab]), "2026-11-04", "sick Monday, VAB Tuesday → Wednesday");
  // Away Thursday–Friday and the next Monday: Tuesday.
  const friday = absence({ id: "f", from: "2026-11-05", to: "2026-11-06" });
  const monday = absence({ id: "m", from: "2026-11-09", to: "2026-11-09" });
  assert.equal(firstDayBack(friday, [friday, monday]), "2026-11-10");
  assert.equal(firstDayBack(sick, [sick, absence({ id: "o", userId: "other", from: "2026-11-03", to: "2026-11-03" })]), "2026-11-03", "another person's absence does not count");
  assert.equal(firstDayBack(sick, [sick, absence({ id: "h", from: "2026-11-03", to: "2026-11-03", hours: { start: "08:00", end: "10:00" } })]), "2026-11-03", "some hours away still leaves the day");
  assert.equal(firstDayBack(sick, [sick, absence({ id: "p", from: "2026-11-03", to: "2026-11-03", status: "APPLIED" })]), "2026-11-03", "an applied absence does not count");
  // The affected work carries the same day.
  const rows = affectedWork({ absences: [sick, vab], today: "2026-11-01", swedishDay: day,
    bookings: [{ id: "b1", title: "Armaturbyte", startsAt: "2026-11-02T06:00:00Z", endsAt: "2026-11-02T14:00:00Z", userIds: ["u"], status: "PLANNED", href: "/" }], workOrders: [] });
  assert.deepEqual(rows.map((row) => [row.id, row.backOn]), [["b1", "2026-11-04"]]);
});

test("F1 Byt person: only the people added, removed or moved on a booking are told, never the one who changed it", () => {
  assert.deepEqual(bookingNoticeChanges({ before: ["emp"], after: ["owner"], actorId: "owner", active: true }), { added: [], removed: ["emp"], moved: [] }, "the owner takes it: the employee is told");
  assert.deepEqual(bookingNoticeChanges({ before: ["emp"], after: ["kim"], actorId: "boss", active: true }), { added: ["kim"], removed: ["emp"], moved: [] });
  assert.deepEqual(bookingNoticeChanges({ before: ["emp"], after: ["emp"], actorId: "boss", active: true, timeChanged: true }), { added: [], removed: [], moved: ["emp"] }, "Skjut upp tells the person");
  assert.deepEqual(bookingNoticeChanges({ before: [], after: ["emp"], actorId: "boss", active: false }), { added: [], removed: [], moved: [] }, "a cancelled booking books nobody");
});

test("Teamets notiser: the key holds type, ref, who and when, and nothing with a bar in it breaks it", () => {
  const key = teamNoticeKey({ type: "BOOKED", ref: "act|1", byUserId: "boss", at: 1_700_000_000_000, extra: "x~y" });
  assert.deepEqual(parseTeamNoticeKey(key), { type: "BOOKED", ref: "act|1", byUserId: "boss", at: 1_700_000_000_000, extra: "x~y" });
  assert.equal(parseTeamNoticeKey("ASSIGNED:t|u"), null);
  assert.equal(parseTeamNoticeKey("TEAM:NOPE|a|b|1|"), null);
  assert.deepEqual(parseMonthRef(monthRef("emp", "2026-10")), { userId: "emp", period: "2026-10" });
  assert.equal(parseMonthRef("emp"), null);
});

const at = new Date("2026-11-02T12:00:00Z");
const row = (key: string, context: Partial<TeamNoticeContext>, createdAt = new Date("2026-11-02T10:00:00Z")) => ({ key, createdAt, context: { byName: "QA Företagsägare", ...context } });
const booking = { title: "Armaturbyte 03 nov", startsAt: "2026-11-03T06:00:00Z", endsAt: "2026-11-03T15:00:00Z", href: "/?view=workflow_task&taskId=w1&taskType=WORK_ORDER", booked: true, active: true };

test("Teamets notiser: bookings, absence and the month in the bell, and gone when the cause is gone", () => {
  const booked = teamNotifications([row(teamNoticeKey({ type: "BOOKED", ref: "b1", byUserId: "boss", at }), { booking })], at, day);
  assert.equal(booked.length, 1);
  assert.equal(booked[0].kind, "TEAM");
  assert.match(booked[0].detail ?? "", /QA Företagsägare har bokat dig 3 nov\./);
  assert.equal(teamNotifications([row(teamNoticeKey({ type: "BOOKED", ref: "b1", byUserId: "boss", at }), { booking: { ...booking, booked: false } })], at, day).length, 0, "no longer on it");
  const unbooked = teamNotifications([row(teamNoticeKey({ type: "UNBOOKED", ref: "b1", byUserId: "boss", at }), { booking: { ...booking, booked: false } })], at, day);
  assert.match(unbooked[0].detail ?? "", /har tagit bort dig från bokningen 3 nov/);
  const moved = teamNotifications([row(teamNoticeKey({ type: "MOVED", ref: "b1", byUserId: "boss", at }), { booking })], at, day);
  assert.match(moved[0].detail ?? "", /har flyttat bokningen till 3 nov/);
  // Shown a week; an old one is not.
  assert.equal(teamNotifications([row(teamNoticeKey({ type: "BOOKED", ref: "b1", byUserId: "boss", at }), { booking: { ...booking, endsAt: "2026-12-30T15:00:00Z" } }, new Date("2026-10-20T10:00:00Z"))], at, day).length, 0);

  const set = teamNotifications([row(teamNoticeKey({ type: "ABSENCE_SET", ref: "a1", byUserId: "boss", at, extra: absenceExtra({ from: "2026-11-03", to: "2026-11-03" }) }), { absenceExists: true })], at, day);
  assert.match(set[0].detail ?? "", /har lagt in frånvaro för dig 3 nov/);
  assert.doesNotMatch(JSON.stringify(set), /VAB|Sjuk/, "never the reason");
  assert.equal(teamNotifications([row(teamNoticeKey({ type: "ABSENCE_SET", ref: "a1", byUserId: "boss", at, extra: absenceExtra({ from: "2026-11-03", to: "2026-11-03" }) }), { absenceExists: false })], at, day).length, 0, "removed again");
  const reported = teamNotifications([row(teamNoticeKey({ type: "ABSENCE_REPORTED", ref: "a2", byUserId: "emp", at, extra: absenceExtra({ from: "2026-11-02", to: "2026-11-03" }, 3) }), { byName: "QA Medarbetare", absenceExists: true })], at, day);
  assert.equal(reported[0].title, "QA Medarbetare är frånvarande 2 nov–3 nov");
  assert.match(reported[0].detail ?? "", /3 planerade jobb påverkas/);
  assert.equal(reported[0].needsAction, true);

  const month = { status: "SUBMITTED", note: "", personName: "QA Medarbetare", label: "oktober 2026" };
  const submitted = teamNotifications([row(teamNoticeKey({ type: "TIME_SUBMITTED", ref: monthRef("emp", "2026-10"), byUserId: "emp", at }), { month })], at, day);
  assert.equal(submitted[0].title, "QA Medarbetare har skickat in oktober 2026");
  assert.equal(submitted[0].needsAction, true);
  assert.equal(submitted[0].href, "/?view=time&tab=team", "the approver lands on Tid → Teamet");
  // Påminn (beslut 13, 2026-11-01): to the person, gone once the month is sent in, also for a month without a row.
  const reminder = (status: string) => teamNotifications([row(teamNoticeKey({ type: "TIME_REMINDER", ref: monthRef("emp", "2026-10"), byUserId: "boss", at }), { month: { ...month, status } })], at, day);
  assert.equal(reminder("OPEN")[0].title, "Skicka in din tid för oktober 2026");
  assert.equal(reminder("OPEN")[0].detail, "QA Företagsägare påminner dig.");
  assert.equal(reminder("OPEN")[0].href, "/?view=time");
  assert.equal(reminder("RETURNED").length, 1);
  assert.equal(reminder("SUBMITTED").length, 0, "sent in: gone");
  assert.equal(reminder("APPROVED").length, 0);
  assert.equal(teamNotifications([row(teamNoticeKey({ type: "TIME_SUBMITTED", ref: monthRef("emp", "2026-10"), byUserId: "emp", at }), { month: { ...month, status: "APPROVED" } })], at, day).length, 0, "decided: gone");
  // A month that waits stays longer than a week.
  assert.equal(teamNotifications([row(teamNoticeKey({ type: "TIME_SUBMITTED", ref: monthRef("emp", "2026-10"), byUserId: "emp", at }), { month }, new Date("2026-10-20T10:00:00Z"))], at, day).length, 1);
  const returned = teamNotifications([row(teamNoticeKey({ type: "TIME_RETURNED", ref: monthRef("emp", "2026-10"), byUserId: "boss", at }), { month: { ...month, status: "RETURNED", note: "Fredagen saknas" } })], at, day);
  assert.equal(returned[0].title, "Oktober 2026 skickades tillbaka");
  assert.equal(returned[0].detail, "QA Företagsägare: Fredagen saknas");
  const approved = teamNotifications([row(teamNoticeKey({ type: "TIME_APPROVED", ref: monthRef("emp", "2026-10"), byUserId: "boss", at }), { month: { ...month, status: "APPROVED" } })], at, day);
  assert.equal(approved[0].detail, "Godkänd av QA Företagsägare.");

  // E-mail and push: their own kind, sent once per notice.
  assert.deepEqual(noticeKindsOf(booked[0]), ["TEAM"]);
  assert.equal(noticeKey(booked[0]), booked[0].id);
});

test("F5/F7 who is told: the month and the absence", () => {
  assert.deepEqual(timeNoticeRecipients({ action: "submit", status: "SUBMITTED", userId: "emp", actorId: "emp", approvers: ["boss", "lead", "emp"] }), { type: "TIME_SUBMITTED", userIds: ["boss", "lead"] });
  assert.equal(timeNoticeRecipients({ action: "submit", status: "APPROVED", userId: "solo", actorId: "solo", approvers: [] }), null, "a one-person company approves at once");
  assert.deepEqual(timeNoticeRecipients({ action: "return", status: "RETURNED", userId: "emp", actorId: "boss", approvers: [] }), { type: "TIME_RETURNED", userIds: ["emp"] });
  assert.deepEqual(timeNoticeRecipients({ action: "reopen", status: "RETURNED", userId: "emp", actorId: "boss", approvers: [] }), { type: "TIME_RETURNED", userIds: ["emp"] });
  assert.deepEqual(timeNoticeRecipients({ action: "approve", status: "APPROVED", userId: "emp", actorId: "boss", approvers: [] }), { type: "TIME_APPROVED", userIds: ["emp"] });

  assert.deepEqual(absenceNoticeRecipients({ userId: "emp", actorId: "boss", createdById: "boss", planners: ["boss"] }), [{ type: "ABSENCE_SET", userIds: ["emp"] }], "the manager registers: the person");
  assert.deepEqual(absenceNoticeRecipients({ userId: "emp", actorId: "emp", createdById: "emp", planners: ["boss", "lead", "emp"] }), [{ type: "ABSENCE_REPORTED", userIds: ["boss", "lead"] }], "the person registers: the planners");
  assert.deepEqual(absenceNoticeRecipients({ userId: "emp", actorId: "emp", createdById: "boss", planners: ["boss"], removed: true }), [{ type: "ABSENCE_REMOVED", userIds: ["boss"] }], "the person removes the manager's: the manager");
  assert.deepEqual(absenceNoticeRecipients({ userId: "emp", actorId: "emp", createdById: "emp", planners: ["boss"], removed: true }), [], "one's own registration, removed");
  assert.deepEqual(absenceNoticeRecipients({ userId: "emp", actorId: "lead", createdById: "boss", planners: [], removed: true }), [{ type: "ABSENCE_REMOVED", userIds: ["emp"] }, { type: "ABSENCE_REMOVED", userIds: ["boss"] }]);

  assert.equal(absenceRemovalNeedsConfirm({ actorId: "emp", userId: "emp", createdById: "boss", planner: false }), true, "the manager's absence asks first");
  assert.equal(absenceRemovalNeedsConfirm({ actorId: "emp", userId: "emp", createdById: "emp", planner: false }), false);
  assert.equal(absenceRemovalNeedsConfirm({ actorId: "lead", userId: "emp", createdById: "boss", planner: true }), false, "a planner changes anyone's");
});

test("Teamets notiser: written per recipient, never to the actor, and a decided month's notice is cleared by prefix", async () => {
  const rows: { userId: string; key: string; channel: string }[] = [];
  const db: TeamNoticeDb = { noticeDelivery: {
    create: async ({ data }) => { rows.push(data); return { id: String(rows.length) }; },
    deleteMany: async ({ where }) => { for (let index = rows.length - 1; index >= 0; index -= 1) if (rows[index].channel === where.channel && rows[index].key.startsWith(where.key.startsWith)) rows.splice(index, 1); return {}; },
  } };
  const told = await recordTeamNotice(db, { organizationId: "o", type: "TIME_SUBMITTED", ref: monthRef("emp", "2026-10"), actorId: "emp", userIds: ["boss", "emp", "boss", "lead"] });
  assert.deepEqual(told, ["boss", "lead"]);
  assert.ok(rows.every((item) => item.channel === TEAM_NOTICE_CHANNEL));
  await recordTeamNotice(db, { organizationId: "o", type: "TIME_SUBMITTED", ref: monthRef("emp", "2026-09"), actorId: "emp", userIds: ["boss"] });
  await clearMonthSubmitted(db, { organizationId: "o", userId: "emp", period: "2026-10" });
  assert.equal(rows.length, 1, "only October's go");
  assert.equal(parseTeamNoticeKey(rows[0].key)?.ref, monthRef("emp", "2026-09"));
});

test("F8 booking warning: already booked or away, without titles or reasons", () => {
  const booking = { id: "new", startsAt: "2026-11-02T06:00:00Z", endsAt: "2026-11-02T15:00:00Z", userIds: ["emp", "kim"] };
  const clashes = bookingClashes({ booking, swedishDay: day, swedishClock: clock,
    others: [{ id: "old", startsAt: "2026-11-02T06:00:00Z", endsAt: "2026-11-02T14:00:00Z", userIds: ["emp"] }, { id: "later", startsAt: "2026-11-02T16:00:00Z", endsAt: "2026-11-02T17:00:00Z", userIds: ["kim"] }],
    absences: [absence({ userId: "kim", type: "VAB", from: "2026-11-02", to: "2026-11-02" }), absence({ userId: "emp", from: "2026-11-02", to: "2026-11-02", status: "APPLIED" })] });
  assert.deepEqual(clashes.map((item) => [item.userId, item.kind]), [["emp", "booked"], ["kim", "absent"]], "an applied absence and a booking after it do not clash");
  const text = bookingWarningText(clashes, (id) => ({ emp: "QA Medarbetare", kim: "Kim" })[id] ?? id);
  assert.equal(text, "Krockar: QA Medarbetare är redan bokad 2 nov 07:00–15:00. Kim är frånvarande 2 nov.");
  assert.doesNotMatch(text, /VAB/);
  assert.equal(bookingWarningText([], () => ""), "");
  assert.deepEqual(bookingClashes({ booking, swedishDay: day, swedishClock: clock, others: [{ ...booking, id: "new" }], absences: [] }), [], "not with itself");
  // Some hours away clash only when they overlap the booking.
  assert.equal(bookingClashes({ booking, swedishDay: day, swedishClock: clock, others: [], absences: [absence({ userId: "emp", hours: { start: "16:00", end: "17:00" } })] }).length, 0);
  assert.equal(bookingClashes({ booking, swedishDay: day, swedishClock: clock, others: [], absences: [absence({ userId: "emp", hours: { start: "10:00", end: "12:00" } })] }).length, 1);
  assert.deepEqual(bookingDays({ startsAt: "2026-11-02T06:00:00Z", endsAt: "2026-11-04T15:00:00Z" }, day), ["2026-11-02", "2026-11-03", "2026-11-04"]);
});

test("F4 Välj jobb: mine first, then lately reported, then the rest – never cut off, and searchable", () => {
  const job = (id: string, title: string, over: Partial<TimeChoice> = {}): TimeChoice => ({ id, title, kind: "WORK_ORDER", timeEntries: [], ...over });
  const many = Array.from({ length: 300 }, (_, index) => job(`j${index}`, `A-jobb ${String(index).padStart(3, "0")}`));
  const own = job("own", "UT2-TEAM-Byt armaturer plan -1", { mine: true, project: { name: "UT2-TEAM-Belysningsbyte garage" } });
  const recent = job("rec", "QA calendar time link", { timeEntries: [{ startedAt: "2026-10-30T08:00:00Z" }] });
  const grouped = groupTimeChoices([...many, own, recent, job("p", "Projekt X", { kind: "PROJECT" })]);
  assert.deepEqual(grouped.mine.map((item) => item.id), ["own"]);
  assert.deepEqual(grouped.recent.map((item) => item.id), ["rec"]);
  assert.equal(grouped.rest.length, 301, "nothing is cut off");
  assert.equal(grouped.rest.at(-1)?.id, "p", "projects after work orders");
  assert.ok(RECENT_CHOICES >= 5);
  assert.deepEqual(searchTimeChoices([...many, own], "ut2 armaturer").map((item) => item.id), ["own"]);
  assert.deepEqual(searchTimeChoices([own], "belysningsbyte").map((item) => item.id), ["own"], "the project's name is searched too");
  assert.equal(searchTimeChoices(many, "  ").length, 300);
});

test("F3 Hinder: the notice stays as needing action until the obstacle is resolved", () => {
  const now = new Date("2026-10-31T21:30:00Z");
  const reported = reportObstacle({ kind: "WORK_ORDER", status: "PLANNED", data: { kind: "WORK_ORDER", details: { executionNotes: "", waitingOn: "" } } as never }, { reason: "MATERIAL", text: "" }, now, "QA Medarbetare");
  const items = obstacleNotifications([{ key: "OBSTACLE:w1|emp", createdAt: now, byName: "QA Medarbetare",
    task: { id: "w1", title: "UT2-TEAM-Byt armaturer plan -1", kind: "WORK_ORDER", status: reported.status, dueDate: "2026-11-06", data: reported.data, updatedAt: now } }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].needsAction, true);
});

test("F5 Teamet: months waiting for approval count in Att godkänna", () => {
  const base = { riskBeforeStart: null, needsAction: null, absence: null, unowned: null, rounds: null,
    deviations: { scope: "company" as const, counts: { open: 0, overdue: 0, mine: 0, reportableOnTime: 0 } as never, rows: [], links: { open: "", overdue: "" } } };
  assert.equal(teamGroupCounts(base).approvals, 0);
  assert.equal(teamGroupCounts({ ...base, pendingTime: { total: 2, rows: [], href: "/?view=time" } }).approvals, 2);
});
