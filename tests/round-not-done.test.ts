import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { roundNotifications, scheduleOverview, scheduleViews, type FormSchedule, type FormScheduleRule } from "../lib/workflow/form-schedule";
import { planningRounds, planningRoundMatchesStatus } from "../lib/workflow/planning-rounds";
import { dueRoundEmails } from "../lib/workflow/round-reminders";
import { roundOrderSummary, roundStartAction } from "../lib/workflow/round-work-orders";
import { markNotDoneSchema, mayRevokeNotDone, notDoneLine, notDoneNotifications, notDoneReasonSchema, notDoneRecipients, notDoneRefusal, parseNotDoneNoticeKey, notDoneNoticeKey, type RoundNotDone } from "../lib/workflow/round-outcome";
import { noticeKey, noticeStateText } from "../lib/workflow/notice-channels";

// Ej utfört (2026-10-28, 0.28.0 etapp 5): an occurrence recorded as not done, with a required reason, who and when.
const today = "2026-10-28"; // a Wednesday
const daily: FormScheduleRule = { frequency: "DAILY", interval: 1, weekdays: [], startDate: "2026-10-01", endDate: "" };
const protocol = (occurrence: string, status: string, id = `t-${occurrence}-${status}`, scheduleId = "s1") => ({ id, status, data: { details: { values: { round: { scheduleId, occurrence } } } } });
const marked = (occurrence: string, extra: Partial<RoundNotDone> = {}): RoundNotDone => ({ id: `o-${occurrence}`, occurrence, reason: "Anläggningen var avställd", userName: "Anna Berg", recordedAt: "2026-10-28T13:02:00.000Z", ...extra });
const schedule: FormSchedule = { id: "s1", version: 1, title: "Daglig tillsyn", templateId: "f", assignedToUserId: "u-worker", assignedToName: "Elin", active: true, rule: daily, reminders: { bell: true, email: true } };

test("regression: a protocol set to Utgår is not shown as started – its day is utgått and still open", () => {
  const overview = scheduleOverview(daily, [{ taskId: "t1", status: "CANCELLED", occurrence: "2026-10-27" }], today);
  const day = overview.history.find((item) => item.date === "2026-10-27")!;
  assert.equal(day.state, "cancelled", "never 'started'");
  assert.equal(day.taskId, undefined, "Starta never continues the cancelled protocol");
  assert.equal(day.cancelledTaskId, "t1");
  assert.equal(day.late, true, "a past day is late");
  assert.equal(overview.started.length, 0);
  // It counts as missed (the day is not handled) and is the one to do now after today.
  const past = scheduleOverview(daily, [{ taskId: "t1", status: "CANCELLED", occurrence: "2026-10-27" }, { taskId: "t2", status: "COMPLETED", occurrence: today }], today);
  assert.equal(past.current?.date, "2026-10-27");
  assert.equal(past.current?.state, "cancelled");
  assert.ok(past.missed >= 1);
  const action = roundStartAction({ ...schedule, overview: { ...past, current: { ...past.current!, workOrderId: "wo" } } });
  assert.equal(action?.kind, "start", "a new protocol is started for the day");
});

test("a completed protocol decides the day over an utgått one, whatever their order", () => {
  for (const rounds of [[{ taskId: "a", status: "CANCELLED", occurrence: "2026-10-27" }, { taskId: "b", status: "COMPLETED", occurrence: "2026-10-27" }], [{ taskId: "b", status: "COMPLETED", occurrence: "2026-10-27" }, { taskId: "a", status: "CANCELLED", occurrence: "2026-10-27" }]]) {
    const day = scheduleOverview(daily, rounds, today).history.find((item) => item.date === "2026-10-27")!;
    assert.equal(day.state, "done");
    assert.equal(day.taskId, "b");
  }
});

test("Ej utfört is its own state: not missed, not current, not reminded, counted on its own", () => {
  const without = scheduleOverview(daily, [], today, { pastDays: 3 });
  assert.equal(without.missed, 3);
  const overview = scheduleOverview(daily, [], today, { pastDays: 3, notDone: [marked("2026-10-27"), marked("2026-10-26"), marked("2026-10-25")] });
  assert.equal(overview.missed, 0);
  assert.equal(overview.notDone, 3);
  assert.deepEqual(overview.history.map((item) => item.state), ["not_done", "not_done", "not_done"]);
  assert.equal(overview.history[0].notDone?.reason, "Anläggningen var avställd");
  assert.equal(overview.current?.date, today, "today is still due");
  // Today recorded as not done too: nothing is due, and the bell has nothing.
  const all = scheduleOverview(daily, [], today, { pastDays: 3, notDone: ["2026-10-25", "2026-10-26", "2026-10-27", today].map((day) => marked(day)) });
  assert.equal(all.today?.state, "not_done");
  assert.equal(all.current, null);
  // A round that started on 2026-10-25, so every one of its days is recorded.
  const views = scheduleViews([{ ...schedule, rule: { ...daily, startDate: "2026-10-25" } }], [], today, [], null, ["2026-10-25", "2026-10-26", "2026-10-27", today].map((day) => ({ ...marked(day), scheduleId: "s1" })));
  assert.equal(roundNotifications(views, { id: "u-worker", admin: false }, today).length, 0);
  // Another round's outcome never touches this one.
  const other = scheduleViews([schedule], [], today, [], null, [{ ...marked(today), scheduleId: "s2" }]);
  assert.equal(other[0].overview.today?.state, "due");
});

test("the five states are told apart: planerat, försenat, utfört, ej utfört and utgått", () => {
  const overview = scheduleOverview(daily, [{ taskId: "d", status: "COMPLETED", occurrence: "2026-10-24" }, { taskId: "c", status: "CANCELLED", occurrence: "2026-10-26" }], today, { pastDays: 4, notDone: [marked("2026-10-25")] });
  assert.deepEqual(overview.history.map((item) => [item.date, item.state]), [["2026-10-27", "missed"], ["2026-10-26", "cancelled"], ["2026-10-25", "not_done"], ["2026-10-24", "done"]]);
  assert.equal(overview.upcoming[0].state, "upcoming");
  assert.equal(overview.missed, 2, "missed and late utgått");
});

test("reminders: the e-mail skips an occurrence recorded as not done; the bell's deadline counts a late utgått day", () => {
  const base = { id: "s1", organizationId: "o1", title: "Daglig tillsyn", active: true, rule: daily, reminders: { bell: true, email: true }, assignedToUserId: "u-worker", place: "" };
  const members = [{ organizationId: "o1", userId: "u-worker", email: "w@example.test", admin: false }];
  assert.equal(dueRoundEmails({ schedules: [base], tasks: [], members, delivered: [], today }).length, 1);
  assert.equal(dueRoundEmails({ schedules: [base], tasks: [], members, delivered: [], today, notDone: [{ scheduleId: "s1", occurrence: today }] }).length, 0);
  assert.equal(dueRoundEmails({ schedules: [base], tasks: [], members, delivered: [], today, notDone: [{ scheduleId: "s2", occurrence: today }] }).length, 1, "another round's");
  const views = scheduleViews([schedule], [protocol(today, "COMPLETED"), protocol("2026-10-27", "CANCELLED")], today);
  const bell = roundNotifications(views, { id: "u-worker", admin: false }, today);
  assert.equal(bell[0].dueDate, "2026-10-27");
  assert.equal(bell[0].deadline, "OVERDUE");
});

test("a changed rule keeps the outcomes: they are keyed by day, and a day that is still a round day keeps its state", () => {
  const outcomes = [marked("2026-10-27"), marked("2026-10-26")];
  // Weekly on Tuesdays now: 2026-10-27 is a Tuesday and keeps its Ej utfört; 2026-10-26 is no longer a round day.
  const weekly: FormScheduleRule = { frequency: "WEEKLY", interval: 1, weekdays: [2], startDate: "2026-10-01", endDate: "" };
  const overview = scheduleOverview(weekly, [], today, { pastDays: 14, notDone: outcomes });
  assert.deepEqual(overview.history.map((item) => [item.date, item.state]), [["2026-10-27", "not_done"], ["2026-10-20", "missed"]]);
  // Back to daily: both come back as they were – nothing was lost.
  const back = scheduleOverview(daily, [], today, { pastDays: 3, notDone: outcomes });
  assert.deepEqual(back.history.slice(0, 2).map((item) => item.state), ["not_done", "not_done"]);
});

test("the round's work order: a day recorded as not done is not late and not started again, and is listed", () => {
  const order = { id: "wo", status: "IN_PROGRESS", roundScheduleId: "s1", roundOccurrence: null, plannedStartDate: "2026-10-20", dueDate: "2026-11-30" };
  const plain = roundOrderSummary(order, schedule, new Set(), today, "06:00")!;
  assert.ok(plain.late.some((item) => item.date === "2026-10-27"));
  const summary = roundOrderSummary(order, schedule, new Set(), today, "06:00", [marked("2026-10-27"), marked("2026-10-01")])!;
  assert.ok(!summary.late.some((item) => item.date === "2026-10-27"));
  assert.deepEqual(summary.notDone.map((item) => item.occurrence), ["2026-10-27"], "only the period's");
  assert.equal(summary.occurrence, today);
});

test("planning: Ej utfört is Inställd, an utgått protocol leaves the day planned and is not continued", () => {
  const { rounds } = planningRounds([schedule], [protocol("2026-10-26", "CANCELLED")], { from: "2026-10-25", to: "2026-10-27" }, today, undefined, [], null, [{ scheduleId: "s1", occurrence: "2026-10-25" }]);
  const state = Object.fromEntries(rounds.map((round) => [round.date, round]));
  assert.equal(state["2026-10-25"].state, "not_done");
  assert.equal(state["2026-10-26"].state, "cancelled");
  assert.equal(state["2026-10-26"].taskId, null);
  assert.equal(state["2026-10-27"].state, "missed");
  assert.ok(planningRoundMatchesStatus(state["2026-10-25"], "CANCELED"));
  assert.ok(planningRoundMatchesStatus(state["2026-10-26"], "PLANNED"));
  assert.ok(!planningRoundMatchesStatus(state["2026-10-26"], "IN_PROGRESS"));
});

test("the reason is required, trimmed and 3–1000 characters", () => {
  assert.equal(notDoneReasonSchema.parse("  Avställd  "), "Avställd");
  assert.ok(!notDoneReasonSchema.safeParse("").success);
  assert.ok(!notDoneReasonSchema.safeParse("  a  ").success);
  assert.ok(notDoneReasonSchema.safeParse("x".repeat(1000)).success);
  assert.ok(!notDoneReasonSchema.safeParse("x".repeat(1001)).success);
  assert.ok(!markNotDoneSchema.safeParse({ action: "mark_not_done", scheduleId: "s1", occurrence: "28/10", reason: "Avställd" }).success, "a day is YYYY-MM-DD");
  assert.ok(markNotDoneSchema.safeParse({ action: "mark_not_done", scheduleId: "s1", occurrence: today, reason: "Avställd" }).success);
});

test("refusals: only a past or today's round day without a protocol going, and not twice", () => {
  const ok = { rule: daily, occurrence: "2026-10-27", today, protocolStatuses: [] as string[], active: false };
  assert.equal(notDoneRefusal(ok), null);
  assert.equal(notDoneRefusal({ ...ok, occurrence: today }), null, "today may be marked");
  assert.equal(notDoneRefusal({ ...ok, protocolStatuses: ["CANCELLED"] }), null, "an utgått protocol does not handle the day");
  assert.equal(notDoneRefusal({ ...ok, occurrence: "2026-10-29" })?.status, 400);
  assert.equal(notDoneRefusal({ ...ok, occurrence: "2026-09-30" })?.status, 400, "before the rule starts");
  assert.equal(notDoneRefusal({ ...ok, protocolStatuses: ["COMPLETED"] })?.status, 409);
  assert.equal(notDoneRefusal({ ...ok, protocolStatuses: ["IN_PROGRESS"] })?.status, 409);
  assert.equal(notDoneRefusal({ ...ok, closedDayOrder: true })?.status, 409);
  assert.equal(notDoneRefusal({ ...ok, active: true })?.status, 409, "a duplicate");
});

test("who is told and who may revoke", () => {
  const members = [{ userId: "u-worker", admin: false }, { userId: "u-admin", admin: true }, { userId: "u-admin2", admin: true }];
  assert.deepEqual(notDoneRecipients({ assignedToUserId: "u-worker", recorderId: "u-admin", members }), ["u-worker"]);
  assert.deepEqual(notDoneRecipients({ assignedToUserId: "u-worker", recorderId: "u-worker", members }), [], "never the one who recorded it");
  assert.deepEqual(notDoneRecipients({ assignedToUserId: null, recorderId: "u-admin", members }), ["u-admin2"]);
  assert.deepEqual(notDoneRecipients({ assignedToUserId: "u-gone", recorderId: "u-admin", members }), [], "only active members");
  assert.ok(mayRevokeNotDone({ userId: "u-a", admin: false }, { userId: "u-a" }, { assignedToUserId: null }));
  assert.ok(mayRevokeNotDone({ userId: "u-r", admin: false }, { userId: "u-a" }, { assignedToUserId: "u-r" }));
  assert.ok(mayRevokeNotDone({ userId: "u-x", admin: true }, { userId: "u-a" }, { assignedToUserId: null }));
  assert.ok(!mayRevokeNotDone({ userId: "u-x", admin: false }, { userId: "u-a" }, { assignedToUserId: "u-r" }));
});

test("the bell's Ej utfört notice: unread, not revoked, recent; sent once by e-mail or push", () => {
  const now = new Date("2026-10-28T14:00:00Z");
  const outcome = { ...marked("2026-10-27"), scheduleId: "s1", revoked: false, title: "Daglig tillsyn" };
  const items = notDoneNotifications([{ createdAt: now, outcome }, { createdAt: now, outcome: { ...outcome, id: "o-x", revoked: true } }, { createdAt: new Date("2026-10-01T00:00:00Z"), outcome: { ...outcome, id: "o-old" } }, { createdAt: now, outcome: null }], now);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "ROUND");
  assert.match(items[0].detail ?? "", /Anna Berg markerade tillfället 2026-10-27 som Ej utfört: Anläggningen var avställd/);
  assert.equal(noticeKey(items[0]), items[0].id, "told once per marking");
  assert.match(noticeStateText(items[0], "2026-10-28"), /^Ej utfört \(2026-10-27\) – markerat av Anna Berg$/);
  assert.deepEqual(parseNotDoneNoticeKey(notDoneNoticeKey("abc")), { outcomeId: "abc" });
  assert.equal(parseNotDoneNoticeKey("OBSTACLE:x|y"), null);
  assert.match(notDoneLine(marked("2026-10-27")), /^Ej utfört · Anläggningen var avställd · Anna Berg /);
});

test("the migration is additive, append-only, tenant-bound and allows one active Ej utfört per round and day", () => {
  const sql = readFileSync("prisma/migrations/20261028130000_round_occurrence_outcome/migration.sql", "utf8").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN)\b|\bDELETE\s+FROM\b|ALTER TABLE "(?!RoundOccurrenceOutcome)/i, "only the new table");
  assert.match(sql, /FOREIGN KEY \("scheduleId", "organizationId"\) REFERENCES "FormSchedule"\("id", "organizationId"\)/);
  assert.match(sql, /CREATE UNIQUE INDEX "RoundOccurrenceOutcome_one_active" ON "RoundOccurrenceOutcome"\("scheduleId", "occurrence"\) WHERE "revokedAt" IS NULL/);
  assert.match(sql, /char_length\("reason"\) BETWEEN 3 AND 1000/);
  assert.match(sql, /BEFORE UPDATE ON "RoundOccurrenceOutcome"/);
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /model RoundOccurrenceOutcome \{[\s\S]*?schedule\s+FormSchedule\s+@relation\(fields: \[scheduleId, organizationId\], references: \[id, organizationId\], onDelete: Cascade\)/);
});
