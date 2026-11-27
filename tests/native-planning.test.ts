import { test } from "node:test";
import assert from "node:assert/strict";
import { planningWeekByPerson, planningWeekOf, shiftPlanningWeek, UNALLOCATED } from "../lib/workflow/native-planning";

test("planningWeekOf gives Monday to Sunday and the ISO week number", () => {
  assert.deepEqual(planningWeekOf("2026-10-07"), { days: ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"], from: "2026-10-05", to: "2026-10-11", week: 41 });
  assert.equal(planningWeekOf("2026-10-05").from, "2026-10-05", "a Monday is its own week's start");
  assert.equal(planningWeekOf("2026-10-11").from, "2026-10-05", "a Sunday belongs to the week before it");
  // Around new year: 2026-12-31 is a Thursday, so its week is week 53 of 2026; 2027-01-04 starts week 1.
  assert.equal(planningWeekOf("2026-12-31").week, 53);
  assert.equal(planningWeekOf("2027-01-03").week, 53);
  assert.equal(planningWeekOf("2027-01-04").week, 1);
  assert.equal(planningWeekOf("2025-12-29").week, 1, "2025-12-29 is in week 1 of 2026");
  assert.throws(() => planningWeekOf("i går"));
});

test("shiftPlanningWeek moves whole weeks", () => {
  assert.equal(shiftPlanningWeek("2026-10-07", 1), "2026-10-14");
  assert.equal(shiftPlanningWeek("2026-10-07", -2), "2026-09-23");
  assert.equal(shiftPlanningWeek("2026-12-30", 1), "2027-01-06");
});

const week = { from: "2026-10-05", to: "2026-10-11" };
const people = [{ id: "u-anna", name: "Anna" }, { id: "u-bo", name: "Bo" }, { id: "u-cia", name: "Cia" }];
const dayOf = (iso: string) => iso.slice(0, 10);
const booking = (id: string, startsAt: string, endsAt: string, assignedToUserIds: string[] = [], extra: { assignedToName?: string; deletedAt?: string | null } = {}) => ({ id, startsAt, endsAt, assignedToUserIds, ...extra });

test("planningWeekByPerson groups the week per person, me first and Oallokerad last", () => {
  const groups = planningWeekByPerson([
    booking("b1", "2026-10-07T07:00:00Z", "2026-10-07T15:00:00Z", ["u-bo"]),
    booking("b2", "2026-10-06T07:00:00Z", "2026-10-06T09:00:00Z", ["u-cia", "u-bo"]),
    booking("b3", "2026-10-08T07:00:00Z", "2026-10-08T09:00:00Z"),
    booking("b4", "2026-10-09T07:00:00Z", "2026-10-09T09:00:00Z", ["u-anna"]),
    booking("out", "2026-10-13T07:00:00Z", "2026-10-13T09:00:00Z", ["u-anna"]),
    booking("gone", "2026-10-07T07:00:00Z", "2026-10-07T09:00:00Z", ["u-anna"], { deletedAt: "2026-10-01T00:00:00Z" }),
  ], [{ key: "r1", date: "2026-10-06", assignedToUserId: "u-bo" }, { key: "r2", date: "2026-10-20", assignedToUserId: "u-bo" }], week, people, "u-cia", dayOf);
  assert.deepEqual(groups.map((group) => [group.key, group.name, group.me]), [["u-cia", "Cia", true], ["u-anna", "Anna", false], ["u-bo", "Bo", false], [UNALLOCATED, "Ingen ansvarig", false]]);
  const bo = groups.find((group) => group.key === "u-bo")!;
  assert.deepEqual(bo.items.map((item) => item.kind === "activity" ? item.activity.id : item.round.key), ["r1", "b2", "b1"], "day order; a round first on its day");
  assert.deepEqual(groups.find((group) => group.key === "u-anna")!.items.map((item) => item.day), ["2026-10-09"], "outside the week and removed bookings are left out");
});

test("a booking over several days is shown on its first day in the week; midnight ends the day before", () => {
  const groups = planningWeekByPerson([
    booking("long", "2026-10-01T07:00:00Z", "2026-10-06T16:00:00Z", ["u-anna"]),
    booking("night", "2026-10-04T08:00:00Z", "2026-10-05T00:00:00Z", ["u-anna"]),
  ], [], week, people, "", dayOf);
  assert.deepEqual(groups[0].items.map((item) => [item.kind === "activity" ? item.activity.id : "", item.day]), [["long", "2026-10-05"]]);
});

test("a name without an account gets a group of its own; an unknown id is named from the booking", () => {
  const groups = planningWeekByPerson([
    booking("ext", "2026-10-07T07:00:00Z", "2026-10-07T09:00:00Z", [], { assignedToName: "Extern elektriker" }),
    booking("old", "2026-10-07T07:00:00Z", "2026-10-07T09:00:00Z", ["u-left"], { assignedToName: "Dan" }),
  ], [{ key: "r", date: "2026-10-07", assignedToName: "Extern elektriker" }], week, people, "", dayOf);
  assert.deepEqual(groups.map((group) => [group.key, group.name, group.items.length]), [["u-left", "Dan", 1], ["name:Extern elektriker", "Extern elektriker", 2]]);
});
