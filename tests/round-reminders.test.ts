import assert from "node:assert/strict";
import test from "node:test";
import { formScheduleInputSchema, parseScheduleReminders, roundNotifications, scheduleViews, type FormSchedule } from "../lib/workflow/form-schedule";
import { dueRoundEmails, type ReminderSchedule } from "../lib/workflow/round-reminders";

// Round reminders (Daniel 2026-09-30): the bell for today's and missed rounds, and one e-mail per round, day and person.
const today = "2026-10-01";
const rule = { frequency: "DAILY" as const, interval: 1, weekdays: [], startDate: "2026-09-01", endDate: "" };
const base: ReminderSchedule = { id: "s1", organizationId: "o1", title: "Daglig tillsyn", active: true, rule, reminders: { bell: true, email: true }, assignedToUserId: "u-worker", place: "Forsen" };
const members = [
  { organizationId: "o1", userId: "u-worker", email: "worker@example.test", admin: false },
  { organizationId: "o1", userId: "u-admin", email: "admin@example.test", admin: true },
  { organizationId: "o2", userId: "u-other", email: "other@example.test", admin: true },
];
const round = (occurrence: string, status: string, scheduleId = "s1") => ({ id: `t-${occurrence}`, status, data: { details: { values: { round: { scheduleId, occurrence } } } } });

test("an e-mail goes to the responsible person, or to the company's admins, once per round and day", () => {
  assert.deepEqual(dueRoundEmails({ schedules: [base], tasks: [], members, delivered: [], today }).map((item) => item.recipient.email), ["worker@example.test"]);
  const unassigned = { ...base, assignedToUserId: null };
  assert.deepEqual(dueRoundEmails({ schedules: [unassigned], tasks: [], members, delivered: [], today }).map((item) => item.recipient.email), ["admin@example.test"], "never another company's admin");
  assert.equal(dueRoundEmails({ schedules: [base], tasks: [], members, delivered: [{ scheduleId: "s1", occurrence: today, userId: "u-worker" }], today }).length, 0, "already sent");
});

test("no e-mail when it is off, the round is paused, not due today, already done, or the responsible person has left", () => {
  const none = (schedules: ReminderSchedule[], tasks = [] as ReturnType<typeof round>[], people = members) => dueRoundEmails({ schedules, tasks, members: people, delivered: [], today }).length;
  assert.equal(none([{ ...base, reminders: { bell: true, email: false } }]), 0);
  assert.equal(none([{ ...base, active: false }]), 0);
  assert.equal(none([{ ...base, rule: { ...rule, frequency: "WEEKLY", weekdays: [1] } }]), 0, "2026-10-01 is a Thursday");
  assert.equal(none([base], [round(today, "COMPLETED")]), 0);
  assert.equal(none([base], [round(today, "IN_PROGRESS")]), 1, "a started round is still reminded");
  assert.equal(none([base], [], members.filter((member) => member.userId !== "u-worker")), 0);
});

test("the bell shows today's round and a missed one to the responsible person and the admins, not to others", () => {
  const schedule: FormSchedule = { id: "s1", version: 1, title: "Daglig tillsyn", templateId: "f", customerId: null, facilityId: null, projectId: null, assignedToUserId: "u-worker", assignedToName: "Elin", active: true, rule, reminders: { bell: true, email: false } };
  const views = scheduleViews([schedule], [], today);
  const worker = roundNotifications(views, { id: "u-worker", admin: false }, today);
  assert.equal(worker.length, 1);
  assert.equal(worker[0].kind, "ROUND");
  assert.equal(worker[0].deadline, "DUE_SOON");
  assert.equal(roundNotifications(views, { id: "u-admin", admin: true }, today).length, 1);
  assert.equal(roundNotifications(views, { id: "u-someone", admin: false }, today).length, 0);
  assert.equal(roundNotifications(scheduleViews([{ ...schedule, reminders: { bell: false, email: false } }], [], today), { id: "u-worker", admin: false }, today).length, 0);
  // Today's is done: the latest missed day within the window is reminded as overdue.
  const missed = roundNotifications(scheduleViews([schedule], [round(today, "COMPLETED")], today), { id: "u-worker", admin: false }, today);
  assert.equal(missed[0].deadline, "OVERDUE");
  assert.equal(missed[0].dueDate, "2026-09-30");
  const allDone = Array.from({ length: 31 }, (_, index) => round(`2026-09-${String(index + 1).padStart(2, "0")}`.replace("2026-09-31", today), "COMPLETED"));
  assert.equal(roundNotifications(scheduleViews([schedule], allDone, today), { id: "u-worker", admin: false }, today).length, 0);
});

test("rounds saved before reminders existed read the defaults: bell on, e-mail off", () => {
  assert.deepEqual(parseScheduleReminders({}), { bell: true, email: false });
  assert.deepEqual(parseScheduleReminders(null), { bell: true, email: false });
  assert.deepEqual(formScheduleInputSchema.parse({ title: "R", templateId: "f", rule }).reminders, { bell: true, email: false });
});
