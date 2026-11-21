import assert from "node:assert/strict";
import test from "node:test";
import { awaitsBooking, checkedWorkdays, expiringItems, timeGaps, unownedWork, workToBook, type ToBookOrder } from "../lib/overview/team-followup";
import { teamLoadPeople, teamLoadWindows } from "../lib/overview/team-model";
import { capacityRows, type CapacityActivity } from "../lib/workflow/capacity-summary";
import { capacityLoads, type PlanningRound } from "../lib/workflow/planning-rounds";
import type { Absence } from "../lib/workflow/absence";

test("Tid som inte är rapporterad: past workdays only, away time counted off, the most missing first", () => {
  assert.deepEqual(checkedWorkdays("2026-10-29"), ["2026-10-26", "2026-10-27", "2026-10-28"], "Thursday: Mon–Wed");
  assert.deepEqual(checkedWorkdays("2026-10-26"), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"], "Monday: last week");
  const rows = timeGaps({
    members: [{ id: "a", name: "Anna", dayMinutes: 480 }, { id: "b", name: "Bo", dayMinutes: 480 }, { id: "c", name: "Cia", dayMinutes: 480 }],
    entries: [
      { userId: "a", startedAt: "2026-10-26", durationSec: 8 * 3600 }, { userId: "a", startedAt: "2026-10-27", durationSec: 7.75 * 3600 }, { userId: "a", startedAt: "2026-10-28", durationSec: 8 * 3600 },
      { userId: "b", startedAt: "2026-10-26", durationSec: 1.5 * 3600 },
    ],
    days: ["2026-10-26", "2026-10-27", "2026-10-28"], swedishDay: (value) => String(value).slice(0, 10),
    awayShare: (userId, day) => userId === "c" ? 1 : userId === "b" && day === "2026-10-28" ? 1 : 0,
  });
  assert.deepEqual(rows.map((row) => [row.userId, row.missingMinutes, row.days.map((item) => item.label).join(",")]), [["b", 870, "Mån,Tis"]],
    "Anna lacks 15 min (within the slack), Cia was away, Bo lacks Monday 6,5 h and Tuesday 8 h – Wednesday he was away");
  // PL11: the real hours, as Tid shows them – a long day is not capped at the ordinary day.
  const long = timeGaps({ members: [{ id: "d", name: "Dan", dayMinutes: 480 }], days: ["2026-10-26", "2026-10-27"], swedishDay: (value) => String(value).slice(0, 10),
    entries: [{ userId: "d", startedAt: "2026-10-26", durationSec: 8.7 * 3600 }] });
  assert.equal(long[0].reportedMinutes, 522);
});

test("Arbete utan ägare: no responsible person, or a start within a week without a booking", () => {
  const result = unownedWork({ today: "2026-10-29", workOrders: [
    { id: "1", title: "Utan ansvarig", status: "PLANNED", assignedToUserId: null, plannedStartDate: "", dueDate: "2026-11-05", customerName: "", booked: false },
    { id: "2", title: "Obokad", status: "PLANNED", assignedToUserId: "a", plannedStartDate: "2026-11-02", dueDate: "", customerName: "Brf", booked: false },
    { id: "3", title: "Bokad", status: "PLANNED", assignedToUserId: "a", plannedStartDate: "2026-11-02", dueDate: "", customerName: "", booked: true },
    { id: "4", title: "Långt fram", status: "PLANNED", assignedToUserId: "a", plannedStartDate: "2026-12-01", dueDate: "", customerName: "", booked: false },
    { id: "5", title: "Klar", status: "COMPLETED", assignedToUserId: null, plannedStartDate: "", dueDate: "", customerName: "", booked: false },
  ] });
  assert.deepEqual(result.rows.map((row) => [row.id, row.reason]), [["2", "no-booking"], ["1", "no-owner"]]);
});

test("Behörigheter och instrument: within 30 days and what has run out, first; people who left are not counted", () => {
  const rows = expiringItems({ today: "2026-10-29",
    credentials: [{ id: "c1", personName: "Elon", title: "Elsäkerhet", validUntil: "2026-11-18", left: false }, { id: "c2", personName: "Gunnar", title: "Gammal", validUntil: "2025-12-01", left: true },
      { id: "c3", personName: "Elis", title: "Långt fram", validUntil: "2027-06-01", left: false }],
    licences: [{ personId: "p", personName: "Elis", validUntil: "2026-11-13", left: false }],
    instruments: [{ id: "i1", name: "Isolationsprovare", nextCalibrationAt: "2026-10-20", active: true }, { id: "i2", name: "Avställd", nextCalibrationAt: "2026-10-01", active: false }] });
  assert.deepEqual(rows.map((row) => [row.kind, row.title, row.overdue, row.days]), [["instrument", "Isolationsprovare", true, -9], ["licence", "Körkort", false, 15], ["credential", "Elsäkerhet", false, 20]]);
});

// ---------- Att boka (2026-11-02) ----------
const TODAY = "2026-11-02";
const order = (id: string, fields: Partial<ToBookOrder> = {}): ToBookOrder => ({ id, title: id, status: "PLANNED", booked: false, plannedStartDate: "2026-11-17", dueDate: "2026-11-19", assignedToUserId: "a", assignedToName: "Anna", customerName: "", projectId: null, projectName: "", ...fields });

test("Att boka: a dated work order waiting for its first booking, and nothing else", () => {
  assert.equal(awaitsBooking(order("17-19 nov"), TODAY), true, "the reported case: assigned, 15 days ahead, in neither Kalender nor Kapacitet today");
  assert.equal(awaitsBooking(order("only start", { dueDate: "" }), TODAY), true);
  assert.equal(awaitsBooking(order("only due", { plannedStartDate: "" }), TODAY), true);
  assert.equal(awaitsBooking(order("long ahead", { plannedStartDate: "2027-06-01", dueDate: "" }), TODAY), true, "no upper limit");
  assert.equal(awaitsBooking(order("no owner", { assignedToUserId: null }), TODAY), true);
  assert.equal(awaitsBooking(order("late start", { plannedStartDate: "2026-10-20" }), TODAY), true);
  assert.equal(awaitsBooking(order("due today", { plannedStartDate: "2026-10-20", dueDate: TODAY }), TODAY), true);
  const out: [string, Partial<ToBookOrder>][] = [
    ["no dates", { plannedStartDate: "", dueDate: "" }], ["booked", { booked: true }], ["förfallen", { plannedStartDate: "2026-10-20", dueDate: "2026-11-01" }],
    ["started by time", { startedAt: "2026-11-01T08:00:00.000Z" }], ["started by steps", { progress: 10 }], ["pågår", { status: "IN_PROGRESS" }], ["pausad", { status: "PAUSED" }],
    ["completed", { status: "COMPLETED" }], ["utgått", { status: "CANCELLED" }], ["a round's holder", { roundScheduleId: "s" }], ["vilande", { dormant: true }],
  ];
  for (const [name, fields] of out) assert.equal(awaitsBooking(order(name, fields), TODAY), false, name);
});

test("Att boka: the soonest first by Start, else Klart senast, with the late start marked", () => {
  const { total, rows } = workToBook({ today: TODAY, workOrders: [
    order("c", { plannedStartDate: "2026-11-20", dueDate: "" }), order("a", { plannedStartDate: "2026-10-30" }), order("b", { plannedStartDate: "", dueDate: "2026-11-05" }), order("bort", { booked: true }),
  ] });
  assert.equal(total, 3);
  assert.deepEqual(rows.map((row) => [row.id, row.lateStart]), [["a", true], ["b", false], ["c", false]]);
  assert.match(rows[0].href, /view=workflow_task&taskId=a&taskType=WORK_ORDER/);
});

test("Ej bokad is Att boka within the week, so every such row is also in the list", () => {
  const workOrders = [
    order("in week", { plannedStartDate: "2026-11-05", dueDate: "" }), order("beyond", { plannedStartDate: "2026-11-20", dueDate: "" }), order("started", { plannedStartDate: "2026-11-05", dueDate: "", progress: 5 }),
    order("holder", { plannedStartDate: "2026-11-05", dueDate: "", roundScheduleId: "s" }), order("vilande", { plannedStartDate: "2026-11-05", dueDate: "", dormant: true }), order("pausad", { plannedStartDate: "2026-11-05", dueDate: "", status: "PAUSED" }),
  ];
  const unowned = unownedWork({ today: TODAY, workOrders: workOrders.map((item) => ({ ...item, canBook: item.id === "in week" })) });
  assert.deepEqual(unowned.rows.map((row) => [row.id, row.reason, row.canBook]), [["in week", "no-booking", true]], "the three false alarms are gone");
  const list = new Set(workToBook({ today: TODAY, workOrders }).rows.map((row) => row.id));
  for (const row of unowned.rows) assert.ok(list.has(row.id));
  assert.deepEqual(unownedWork({ today: TODAY, bookable: false, workOrders }).rows, [], "without Planering there is nowhere to book");
  assert.deepEqual(unownedWork({ today: TODAY, bookable: false, workOrders: [order("x", { assignedToUserId: null })] }).rows.map((row) => row.reason), ["no-owner"]);
});

// ---------- Belastning = Kapacitet (2026-11-02) ----------
test("Teamet's Belastning and the tab Kapacitet give the same figures from the same input", () => {
  const now = new Date("2026-11-04T10:00:00+01:00");
  const { windows, workdays } = teamLoadWindows(now);
  const members = [{ id: "anna", name: "Anna", weeklyWorkMinutes: 2_400 }, { id: "bo", name: "Bo", weeklyWorkMinutes: 1_200 }, { id: "tim", name: "Tim", weeklyWorkMinutes: 2_400, noFixedHours: true }];
  const bookings: CapacityActivity[] = [
    { startsAt: "2026-11-02T07:00:00+01:00", endsAt: "2026-11-06T16:00:00+01:00", assignedToUserId: "anna", status: "PLANNED", projectId: null },
    { startsAt: "2026-11-03T07:00:00+01:00", endsAt: "2026-11-03T16:00:00+01:00", assignedToUserId: "bo", status: "PLANNED", projectId: null, workflowTask: { status: "CANCELLED" } },
    { startsAt: "2026-11-05T08:00:00+01:00", endsAt: "2026-11-05T12:00:00+01:00", assignedToUserId: "bo", status: "IN_PROGRESS", projectId: null },
  ];
  const round = { key: "s:2026-11-04", scheduleId: "s", title: "Rond", date: "2026-11-04", time: "07:00", durationMinutes: 60, state: "upcoming", workOrderId: null, projectId: null, assignedToUserId: "anna" } as PlanningRound;
  const absences = [{ id: "1", userId: "anna", type: "VACATION", note: "", from: "2026-11-05", to: "2026-11-06", hours: null, createdBy: "", createdAt: "", handled: [] }, { id: "2", userId: "bo", type: "SICK", note: "", from: "2026-11-02", to: "2026-11-02", hours: null, createdBy: "", createdAt: "", handled: [] }] as Absence[];
  const activities = capacityLoads(bookings, [round]);
  const people = teamLoadPeople({ members, activities, absences, viewer: { id: "x", admin: false, team: false }, windows, workdays });
  const { rows } = capacityRows({ members, activities, absences: absences.map((absence) => ({ userId: absence.userId, label: "x", from: absence.from, to: absence.to, hours: absence.hours })) }, now);
  assert.deepEqual(people.map((person) => person.id), rows.map((row) => row.id), "Ingen fast arbetstid in neither");
  for (const row of rows) {
    const person = people.find((item) => item.id === row.id)!;
    assert.equal(person.weeks[0].plannedMinutes, row.plannedMinutes, `${row.id} planned`);
    assert.equal(person.weeks[0].capacityMinutes, row.availableMinutes, `${row.id} available`);
    assert.equal(person.conflictMinutes ?? 0, row.conflictMinutes, `${row.id} krock`);
  }
  const anna = people.find((person) => person.id === "anna")!;
  assert.deepEqual(anna.weeks[0], { plannedMinutes: 40 * 60 + 60, capacityMinutes: 24 * 60 }, "the round counts on Teamet too");
  assert.equal(anna.conflictMinutes, 16 * 60);
  assert.equal(anna.days![3].absent, "Frånvarande", "only the word this viewer may see");
  assert.equal(anna.days![3].capacityMinutes, 0);
  assert.equal(anna.days![0].capacityMinutes, 8 * 60);
  assert.deepEqual(people.find((person) => person.id === "bo")!.weeks[0], { plannedMinutes: 4 * 60, capacityMinutes: 16 * 60 }, "the cancelled job's booking does not count");
});
