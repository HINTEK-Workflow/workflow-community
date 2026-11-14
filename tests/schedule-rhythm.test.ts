import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmQueue, dayHeading, DEFAULT_RHYTHM, groupByDay, isTaken, moveInOrder, nextFreeSlot, normalizeRhythm, QUEUE_MAX, quickDays, rhythmProblem, rhythmSlots,
  rhythmText, scheduleSentence, scheduleTimeProblem, spreadQueue,
} from "../lib/schedule/rhythm";

// Återkommande och kö (2026-11-12): the rhythm's free times, no double booking, the dialog's words and the queue.
// 2026-11-16 is a Monday; in November Swedish time is UTC+1, so 08:00 is 07:00Z.

const iso = (dates: Date[]) => dates.map((date) => date.toISOString());

test("the default rhythm is Monday, Wednesday and Friday at 08:00 Swedish time", () => {
  assert.deepEqual(DEFAULT_RHYTHM, { weekdays: [0, 2, 4], time: "08:00" });
  assert.equal(rhythmText(DEFAULT_RHYTHM), "mån, ons och fre kl. 08:00");
  const now = new Date("2026-11-17T10:00:00Z"); // Tuesday
  assert.deepEqual(iso(rhythmSlots(DEFAULT_RHYTHM, { count: 3, now })), ["2026-11-18T07:00:00.000Z", "2026-11-20T07:00:00.000Z", "2026-11-23T07:00:00.000Z"]);
});

test("a time less than five minutes ahead is never suggested; today's time counts when it is further ahead", () => {
  assert.equal(nextFreeSlot(DEFAULT_RHYTHM, [], new Date("2026-11-16T06:56:00Z"))?.toISOString(), "2026-11-18T07:00:00.000Z", "07:56: Monday 08:00 is too close");
  assert.equal(nextFreeSlot(DEFAULT_RHYTHM, [], new Date("2026-11-16T06:50:00Z"))?.toISOString(), "2026-11-16T07:00:00.000Z", "07:50: Monday 08:00 is still free");
  assert.equal(nextFreeSlot(DEFAULT_RHYTHM, [], new Date("2026-11-16T08:00:00Z"))?.toISOString(), "2026-11-18T07:00:00.000Z", "a passed time is never suggested");
});

test("no double booking: a time within an hour of another post is skipped, an hour away is free", () => {
  const now = new Date("2026-11-17T10:00:00Z");
  const taken = [new Date("2026-11-18T07:30:00Z")];
  assert.ok(isTaken(new Date("2026-11-18T07:00:00Z"), taken));
  assert.deepEqual(iso(rhythmSlots(DEFAULT_RHYTHM, { count: 2, now, taken })), ["2026-11-20T07:00:00.000Z", "2026-11-23T07:00:00.000Z"]);
  const hourAway = [new Date("2026-11-18T08:00:00Z")];
  assert.ok(!isTaken(new Date("2026-11-18T07:00:00Z"), hourAway), "exactly an hour is not the same slot");
  const slots = rhythmSlots(DEFAULT_RHYTHM, { count: 20, now });
  assert.equal(new Set(iso(slots)).size, 20, "never two posts in the same slot");
  assert.ok(slots.every((slot, index) => index === 0 || slot.getTime() - slots[index - 1].getTime() >= 86_400_000));
});

test("the queue can start on a later day; a first day that has passed starts today", () => {
  const now = new Date("2026-11-17T10:00:00Z");
  assert.equal(rhythmSlots(DEFAULT_RHYTHM, { count: 1, now, fromDay: "2026-11-25" })[0].toISOString(), "2026-11-25T07:00:00.000Z");
  assert.equal(rhythmSlots(DEFAULT_RHYTHM, { count: 1, now, fromDay: "2026-11-01" })[0].toISOString(), "2026-11-18T07:00:00.000Z");
});

test("a rhythm time that does not exist the night summer time starts is left out", () => {
  const rhythm = { weekdays: [6], time: "02:30" }; // Sunday
  const slots = rhythmSlots(rhythm, { count: 3, now: new Date("2026-03-20T12:00:00Z") });
  assert.deepEqual(slots.map((slot) => slot.toISOString().slice(0, 10)), ["2026-03-22", "2026-04-05", "2026-04-12"], "29 March 02:30 does not exist");
});

test("a rhythm needs a weekday and a clock time; weekdays are kept once, in order", () => {
  assert.equal(rhythmProblem({ weekdays: [], time: "08:00" }), "Välj minst en veckodag.");
  assert.equal(rhythmProblem({ weekdays: [7], time: "08:00" }), "Välj minst en veckodag.");
  assert.equal(rhythmProblem({ weekdays: [1], time: "8:00" }), "Välj ett klockslag.");
  assert.equal(rhythmProblem({ weekdays: [1], time: "24:00" }), "Välj ett klockslag.");
  assert.deepEqual(normalizeRhythm({ weekdays: [4, 0, 4, 2], time: "12:00" }), { weekdays: [0, 2, 4], time: "12:00" });
  assert.deepEqual(rhythmSlots({ weekdays: [], time: "08:00" }, { count: 3 }), []);
});

test("the queue spreads the drafts in their order over the next free times", () => {
  const now = new Date("2026-11-17T10:00:00Z");
  const plan = spreadQueue(["c", "a", "b"], DEFAULT_RHYTHM, { now, taken: [new Date("2026-11-20T07:15:00Z")] });
  assert.ok(!("error" in plan));
  assert.deepEqual(plan.map((entry) => [entry.postId, entry.at.toISOString()]), [
    ["c", "2026-11-18T07:00:00.000Z"], ["a", "2026-11-23T07:00:00.000Z"], ["b", "2026-11-25T07:00:00.000Z"],
  ], "Friday is taken by another post");
  assert.deepEqual(spreadQueue([], DEFAULT_RHYTHM, { now }), { error: "Välj minst ett inlägg." });
  assert.deepEqual(spreadQueue(["a", "a"], DEFAULT_RHYTHM, { now }), { error: "Ett inlägg finns två gånger i listan." });
  assert.ok("error" in spreadQueue(Array.from({ length: QUEUE_MAX + 1 }, (_, index) => `p${index}`), DEFAULT_RHYTHM, { now }));
  assert.ok("error" in spreadQueue(["a"], { weekdays: [], time: "08:00" }, { now }));
});

test("the queue's approval holds only for the times the admin saw", () => {
  const now = new Date("2026-11-17T10:00:00Z");
  const shown = [{ postId: "a", at: "2026-11-18T08:00" }, { postId: "b", at: "2026-11-20T08:00" }];
  const plan = confirmQueue(shown, DEFAULT_RHYTHM, { now });
  assert.ok(!("error" in plan));
  assert.deepEqual(plan.map((entry) => entry.at.toISOString()), ["2026-11-18T07:00:00.000Z", "2026-11-20T07:00:00.000Z"]);
  // Another post took Wednesday since the list was shown: nothing is scheduled.
  assert.deepEqual(confirmQueue(shown, DEFAULT_RHYTHM, { now, taken: [new Date("2026-11-18T07:00:00Z")] }), { error: "Tiderna har ändrats sedan listan visades. Titta på tiderna igen." });
  // The order is part of what was approved.
  assert.ok("error" in confirmQueue([{ postId: "b", at: "2026-11-20T08:00" }, { postId: "a", at: "2026-11-18T08:00" }], DEFAULT_RHYTHM, { now }));
});

test("up and down move one step and stop at the ends", () => {
  assert.deepEqual(moveInOrder(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
});

test("the dialog refuses a time that has passed, a time that does not exist and one more than a year ahead", () => {
  const now = new Date("2026-11-17T10:00:00Z"); // 11:00 Swedish
  assert.equal(scheduleTimeProblem("2026-11-17T10:30", now), "Tiden har redan passerat. Välj en senare tid.");
  assert.equal(scheduleTimeProblem("2026-11-17T11:00", now), "Tiden har redan passerat. Välj en senare tid.", "now is not ahead");
  assert.equal(scheduleTimeProblem("2026-11-17T11:05", now), null);
  assert.match(scheduleTimeProblem("2027-03-28T02:30", now) ?? "", /ställs fram/);
  assert.equal(scheduleTimeProblem("2028-01-01T08:00", now), "Välj en tid inom ett år.");
  assert.equal(scheduleTimeProblem("2026-11-17T", now), "Välj dag och klockslag.");
});

test("the choice in words: Idag, Imorgon and the day's name", () => {
  const now = new Date("2026-11-17T10:00:00Z"); // Tuesday
  assert.equal(scheduleSentence(new Date("2026-11-18T07:00:00Z"), now), "Publiceras imorgon, onsdag 18 november kl. 08:00");
  assert.equal(scheduleSentence(new Date("2026-11-20T11:00:00Z"), now), "Publiceras fredag 20 november kl. 12:00");
  assert.equal(scheduleSentence(new Date("2027-01-04T07:00:00Z"), now), "Publiceras måndag 4 januari 2027 kl. 08:00");
  assert.equal(dayHeading(new Date("2026-11-17T23:30:00Z"), now), "Imorgon", "23:30 UTC is already Wednesday in Sweden");
  assert.equal(dayHeading(new Date("2026-11-17T15:00:00Z"), now), "Idag");
  assert.equal(dayHeading(new Date("2026-11-19T07:00:00Z"), now), "Torsdag 19 november");
  const days = quickDays(now, 7);
  assert.equal(days.length, 7);
  assert.deepEqual(days.slice(0, 2), [{ day: "2026-11-17", label: "Idag" }, { day: "2026-11-18", label: "Imorgon" }]);
  assert.equal(days[2].day, "2026-11-19");
  assert.match(days[2].label, /^Tor 19$/);
});

test("the list is grouped by Swedish day, in order", () => {
  const items = [{ at: "2026-11-18T07:00:00Z" }, { at: "2026-11-18T16:00:00Z" }, { at: "2026-11-18T23:30:00Z" }, { at: "2026-11-20T07:00:00Z" }];
  const groups = groupByDay(items, (item) => item.at);
  assert.deepEqual(groups.map((group) => [group.day, group.items.length]), [["2026-11-18", 2], ["2026-11-19", 1], ["2026-11-20", 1]]);
});
