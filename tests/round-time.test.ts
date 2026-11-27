import assert from "node:assert/strict";
import test from "node:test";
import {
  formScheduleRuleSchema, occurrenceLate, roundDayLine, roundDurationText, roundNotifications, roundTimeText, scheduleOverview, scheduleRuleSentence, scheduleRuleText, scheduleViews,
  type FormSchedule, type FormScheduleRule,
} from "../lib/workflow/form-schedule";
import { capacityLoads, planningRounds, roundCapacityActivities, type PlanningRound } from "../lib/workflow/planning-rounds";
import { lateOccurrencesInPeriod, roundOrderSummary } from "../lib/workflow/round-work-orders";
import { plannedMinutesForUserInWindow, type CapacityActivity } from "../lib/workflow/capacity-summary";
import { summarizeAvailability } from "../lib/workflow/availability-summary";
import { planningWeekByPerson } from "../lib/workflow/native-planning";
import { monthGrid } from "../lib/workflow/month-grid";
import { swedishClock, swedishDate } from "../lib/swedish-time";

/**
 * Klockslag och beräknad tid (2026-10-28: "när man markerar kalendern vet man inte vilken tid man ska göra det – hur
 * planeras det?"): optional in the round's rule; absent, the round is for the whole day exactly as before. Shown in the
 * sentence, the lists and Planering; "försenad" waits for the klockslag the same way in Driftronder, Planering, the work
 * order and the bell; the beräknad tid loads the responsible person like a booking, never twice.
 */
const rule = (patch: Partial<FormScheduleRule> = {}): FormScheduleRule => ({ frequency: "WEEKLY", interval: 1, weekdays: [1, 2, 3, 4, 5], startDate: "2026-10-14", endDate: "", ...patch });
const schedule = (patch: Partial<FormScheduleRule> = {}, extra: Partial<FormSchedule> = {}): FormSchedule => ({
  id: "s-1", version: 1, title: "Morgonrond", templateId: "form-1", templateName: "Tillsyn", assignedToUserId: "u1", assignedToName: "Anna", active: true,
  reminders: { bell: true, email: false }, rule: rule(patch), ...extra,
});
const TODAY = "2026-10-28"; // a Wednesday

test("the rule keeps a klockslag and a beräknad tid; a rule without them reads exactly as before", () => {
  const parsed = formScheduleRuleSchema.parse({ ...rule(), time: "07:00", durationMinutes: 30 });
  assert.equal(parsed.time, "07:00");
  assert.equal(parsed.durationMinutes, 30);
  const old = formScheduleRuleSchema.parse(rule());
  assert.equal("time" in old, false, "no klockslag is added to an old rule");
  assert.equal("durationMinutes" in old, false);
  for (const time of ["7:00", "24:00", "07:60", "0700"]) assert.equal(formScheduleRuleSchema.safeParse({ ...rule(), time }).success, false, time);
  assert.equal(formScheduleRuleSchema.safeParse({ ...rule(), durationMinutes: 0 }).success, false);
  assert.equal(formScheduleRuleSchema.safeParse({ ...rule(), durationMinutes: 1441 }).success, false);
});

test("the sentence and the short text carry the klockslag and the beräknad tid", () => {
  assert.equal(scheduleRuleSentence(rule({ time: "07:00", durationMinutes: 30 })), "Varje vardag kl. 07:00, ca 30 min, från 14 okt 2026, tills vidare");
  assert.equal(scheduleRuleSentence(rule({ time: "07:00" })), "Varje vardag kl. 07:00, från 14 okt 2026, tills vidare");
  assert.equal(scheduleRuleSentence(rule({ durationMinutes: 90, count: 10 })), "Varje vardag ca 1 h 30 min, från 14 okt 2026, 10 gånger");
  assert.equal(scheduleRuleSentence(rule()), "Varje vardag från 14 okt 2026, tills vidare", "unchanged without them");
  assert.equal(scheduleRuleText(rule({ weekdays: [1], time: "07:00", durationMinutes: 30 })), "Veckovis mån kl. 07:00, ca 30 min");
  assert.equal(scheduleRuleText(rule({ frequency: "MONTHLY", weekdays: [], time: "06:30", count: 3 })), "Månadsvis den 14 kl. 06:30, 3 gånger");
  assert.equal(scheduleRuleText(rule({ weekdays: [1] })), "Veckovis mån");
  assert.deepEqual([15, 30, 60, 120, 90, 135].map(roundDurationText), ["15 min", "30 min", "1 h", "2 h", "1 h 30 min", "2 h 15 min"]);
  assert.equal(roundTimeText({ time: "07:00", durationMinutes: 60 }, " · "), "kl. 07:00 · ca 1 h");
  assert.equal(roundTimeText({}), "");
});

test("the chosen day of the calendar on one line", () => {
  assert.equal(roundDayLine(rule({ time: "07:00", durationMinutes: 30 }), TODAY), "ons 28 okt 2026 · kl. 07:00 · ca 30 min");
  assert.equal(roundDayLine(rule(), TODAY), "ons 28 okt 2026 · hela dagen");
  assert.equal(roundDayLine(rule({ time: "07:00" }), "2026-10-31"), "lör 31 okt 2026 · ingen rond den dagen");
});

test("försenad waits for the klockslag the same day; without one today is never late", () => {
  assert.equal(occurrenceLate({ time: "07:00" }, TODAY, TODAY, "06:59"), false);
  assert.equal(occurrenceLate({ time: "07:00" }, TODAY, TODAY, "07:00"), false, "late only after the klockslag");
  assert.equal(occurrenceLate({ time: "07:00" }, TODAY, TODAY, "07:01"), true);
  assert.equal(occurrenceLate({}, TODAY, TODAY, "23:59"), false, "the whole day: late from tomorrow, as before");
  assert.equal(occurrenceLate({}, "2026-10-27", TODAY, "00:01"), true);
  const timed = rule({ time: "07:00" });
  assert.equal(scheduleOverview(timed, [], TODAY, { now: "06:30" }).today?.state, "due");
  const late = scheduleOverview(timed, [], TODAY, { now: "08:00" });
  assert.equal(late.today?.state, "missed");
  assert.equal(late.current?.date, TODAY);
  assert.equal(scheduleOverview(rule(), [], TODAY, { now: "08:00" }).today?.state, "due");
  assert.equal(scheduleOverview(timed, [{ taskId: "t", status: "COMPLETED", occurrence: TODAY }], TODAY, { now: "08:00" }).today?.state, "done", "a done round is never late");
});

test("the same rule in Driftronder, the bell, Planering and the work order", () => {
  const before = scheduleViews([schedule({ time: "07:00" }, { assignedToUserId: "u1" })], [], TODAY, [], "06:00");
  const after = scheduleViews([schedule({ time: "07:00" }, { assignedToUserId: "u1" })], [], TODAY, [], "07:30");
  // The reminder is there in the morning as before; it says late only after the klockslag.
  assert.equal(roundNotifications(before, { id: "u1", admin: false }, TODAY)[0]?.deadline, "DUE_SOON");
  assert.equal(roundNotifications(after, { id: "u1", admin: false }, TODAY)[0]?.deadline, "OVERDUE");
  const period = { from: "2026-10-26", to: "2026-10-28" };
  const state = (now: string) => planningRounds([schedule({ time: "07:00" })], [], period, TODAY, undefined, [], now).rounds.find((round) => round.date === TODAY)?.state;
  assert.equal(state("06:00"), "due");
  assert.equal(state("07:30"), "missed");
  const timed = rule({ time: "07:00" });
  assert.deepEqual(lateOccurrencesInPeriod(timed, { from: "2026-10-26", to: "2026-12-31" }, new Set(["2026-10-26"]), TODAY, 20, "06:00"), ["2026-10-27"]);
  assert.deepEqual(lateOccurrencesInPeriod(timed, { from: "2026-10-26", to: "2026-12-31" }, new Set(["2026-10-26"]), TODAY, 20, "07:30"), [TODAY, "2026-10-27"]);
  assert.deepEqual(lateOccurrencesInPeriod(rule(), { from: "2026-10-26", to: "2026-12-31" }, new Set(["2026-10-26"]), TODAY, 20, "23:00"), ["2026-10-27"], "without a klockslag as before");
  const order = { id: "wo-1", status: "IN_PROGRESS", roundScheduleId: "s-1", plannedStartDate: "2026-10-26", dueDate: "2026-12-31" };
  const summary = roundOrderSummary(order, schedule({ time: "07:00", durationMinutes: 30 }), new Set(["2026-10-26", "2026-10-27"]), TODAY, "07:30")!;
  assert.equal(summary.round?.time, "07:00");
  assert.match(summary.round?.ruleText ?? "", /kl\. 07:00, ca 30 min/);
  assert.equal(summary.occurrence, TODAY, "today's occurrence is the one to start");
  assert.deepEqual(summary.late.map((item) => item.date), [TODAY], "and it is late after the klockslag");
  // The period is days (Start – Klart senast), so a klockslag never falls outside it; a day outside still has no link here.
  assert.equal(roundOrderSummary({ ...order, dueDate: "2026-10-27" }, schedule({ time: "07:00" }), new Set(), TODAY, "07:30")!.late.some((item) => item.date === TODAY), false);
});

test("Planering: the occurrence carries its klockslag and beräknad tid and is sorted by it", () => {
  const rounds = planningRounds([schedule({ time: "09:00", durationMinutes: 30 }, { id: "s-b", title: "B" }), schedule({ time: "07:00" }, { id: "s-a", title: "Ö" }), schedule({}, { id: "s-c", title: "C" })],
    [], { from: TODAY, to: TODAY }, TODAY, undefined, [], "06:00").rounds;
  assert.deepEqual(rounds.map((round) => [round.title, round.time, round.durationMinutes]), [["C", null, null], ["Ö", "07:00", null], ["B", "09:00", 30]]);
});

const planningRound = (patch: Partial<PlanningRound> = {}): PlanningRound => ({
  key: `s-1:${TODAY}`, scheduleId: "s-1", title: "Morgonrond", templateName: "Tillsyn", ruleText: "", date: TODAY, time: "07:00", durationMinutes: 30, state: "upcoming", taskId: null,
  workOrderId: "wo-1", href: "", formNotice: null, facilityName: "", customerName: "", projectId: null, projectName: "", assignedToUserId: "u1", assignedToName: "Anna", ...patch,
});
const day = { startsAt: swedishDate(2026, 10, 28), endsAt: swedishDate(2026, 10, 29) };
const minutes = (activities: CapacityActivity[], userId = "u1") => plannedMinutesForUserInWindow({ activities, userId, ...day });

test("the beräknad tid loads the responsible person like a booking – once", () => {
  assert.equal(minutes(roundCapacityActivities([planningRound()], [])), 30, "klockslag + beräknad tid");
  assert.equal(minutes(roundCapacityActivities([planningRound({ time: null, durationMinutes: 45 })], [])), 45, "without a klockslag the minutes lie on the day");
  assert.equal(roundCapacityActivities([planningRound({ durationMinutes: null })], []).length, 0, "no beräknad tid, no load");
  assert.equal(roundCapacityActivities([planningRound({ assignedToUserId: null })], []).length, 0, "no responsible person, no load");
  assert.equal(roundCapacityActivities([planningRound({ state: "done" })], []).length, 0, "a done occurrence holds no load");
  // The work order is booked for the same person that day in Planering: the booking counts, the round is not added.
  const booking: CapacityActivity = { startsAt: swedishDate(2026, 10, 28, 7).toISOString(), endsAt: swedishDate(2026, 10, 28, 9).toISOString(), assignedToUserId: "u1", assignedToUserIds: ["u1"], status: "PLANNED", projectId: null, workflowTaskId: "wo-1" };
  const loads = roundCapacityActivities([planningRound()], [booking]);
  assert.equal(loads.length, 0);
  assert.equal(minutes([booking, ...loads]), 120, "the booking's two hours, not two hours and a half");
  // Booked for someone else, another day, cancelled, or another work order: the round still counts.
  assert.equal(roundCapacityActivities([planningRound()], [{ ...booking, assignedToUserId: "u2", assignedToUserIds: ["u2"] }]).length, 1);
  assert.equal(roundCapacityActivities([planningRound()], [{ ...booking, startsAt: swedishDate(2026, 10, 29, 7).toISOString(), endsAt: swedishDate(2026, 10, 29, 9).toISOString() }]).length, 1);
  assert.equal(roundCapacityActivities([planningRound()], [{ ...booking, status: "CANCELED" }]).length, 1);
  assert.equal(roundCapacityActivities([planningRound()], [{ ...booking, workflowTaskId: "wo-2" }]).length, 1);
});

test("a round with a klockslag clashes with an overlapping booking of the same person, as two bookings do", () => {
  const meeting = { id: "a-1", title: "Möte", startsAt: swedishDate(2026, 10, 28, 7, 15).toISOString(), endsAt: swedishDate(2026, 10, 28, 8).toISOString(), status: "PLANNED" as const, assignedToUserId: "u1", assignedToUserIds: ["u1"] };
  const conflicts = summarizeAvailability([meeting, ...roundCapacityActivities([planningRound()], [])]).conflicts;
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]!.kind, "overlap");
  assert.equal(conflicts[0]!.minutes, 15);
  assert.ok(conflicts[0]!.activities.some((item) => item.title === "Driftrond: Morgonrond"));
});

test("the phone's week list puts a round with a klockslag among the day's bookings by time", () => {
  const booking = { id: "a-1", startsAt: swedishDate(2026, 10, 28, 8).toISOString(), endsAt: swedishDate(2026, 10, 28, 9).toISOString(), assignedToUserIds: ["u1"] };
  const groups = planningWeekByPerson([booking], [planningRound({ key: "r-7", time: "07:00" }), planningRound({ key: "r-10", time: "10:00" }), planningRound({ key: "r-all", time: null })], { from: "2026-10-26", to: "2026-11-01" }, [{ id: "u1", name: "Anna" }], "u1");
  assert.deepEqual(groups[0]!.items.map((item) => item.kind === "round" ? item.round.key : item.activity.id), ["r-all", "r-7", "a-1", "r-10"]);
});

test("the round's month calendar keeps six rows whatever the month", () => {
  for (const anchor of ["2026-10-01", "2027-02-01", "2026-11-01", "2026-03-01"]) assert.equal(monthGrid({ anchor, today: TODAY, fixedWeeks: true }).weeks.length, 6, anchor);
  assert.equal(monthGrid({ anchor: "2027-02-01", today: TODAY }).weeks.length, 4, "the other calendars as before");
});

test("the Swedish clock", () => {
  assert.equal(swedishClock(new Date("2026-10-28T06:05:00Z")), "07:05", "CET in late October");
  assert.equal(swedishClock(new Date("2026-07-01T06:05:00Z")), "08:05", "CEST in summer");
});


test("En räkning (2026-11-02): the bookings and the rounds they do not cover, and a booking on a job that has utgått covers nothing", () => {
  const job: CapacityActivity = { startsAt: swedishDate(2026, 10, 28, 7).toISOString(), endsAt: swedishDate(2026, 10, 28, 16).toISOString(), assignedToUserId: "u1", status: "PLANNED", projectId: null, workflowTaskId: "wo-1" };
  assert.equal(capacityLoads([job], [planningRound({ workOrderId: "wo-1" })]).length, 1, "the booked work order holds the round's time");
  assert.equal(capacityLoads([{ ...job, workflowTask: { status: "COMPLETED" } }], [planningRound({ workOrderId: "wo-1" })]).length, 1, "a kept booking on a färdigställd job still does");
  const cancelled = capacityLoads([{ ...job, workflowTask: { status: "CANCELLED" } }], [planningRound({ workOrderId: "wo-1" })]);
  assert.equal(cancelled.length, 2, "a booking that counts for nothing hides nothing");
  assert.equal(minutes(cancelled), 30, "only the round loads the person");
  assert.equal(capacityLoads([], []).length, 0);
});
