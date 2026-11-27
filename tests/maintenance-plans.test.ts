import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addInterval, addMonths, dormantProblem, firstRunHours, intervalText, isDormant, nextPlanDay, occurrenceState, planFill, planInputSchema, PLAN_MAX_AHEAD, runHoursStep, type PlanOrder, type PlanRule,
} from "../lib/maintenance/plan-model";

// Återkommande underhåll (2026-10-30): one work order per occurrence, vilande ahead (a year or 12), the interval counts
// from when the work was actually done, a postponed occurrence moves the ones after it, drifttimmar without orders ahead.

const today = "2026-11-02";
const monthly: PlanRule = { unit: "MONTH", every: 1, startDate: "2026-11-10", isActive: true };
const halfYear: PlanRule = { unit: "MONTH", every: 6, startDate: "2026-11-10", isActive: true };
const order = (patch: Partial<PlanOrder> & { id: string; due: string }): PlanOrder => ({ status: "PLANNED", activated: false, pinned: false, plannedStartDate: patch.due, completedDay: null, touched: false, ...patch });

test("intervals: days, weeks, months (end of month kept short), and the words", () => {
  assert.equal(addInterval("2026-11-02", "DAY", 10), "2026-11-12");
  assert.equal(addInterval("2026-11-02", "WEEK", 2), "2026-11-16");
  assert.equal(addInterval("2026-08-31", "MONTH", 6), "2027-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29", "a leap year");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(intervalText("MONTH", 1), "Varje månad");
  assert.equal(intervalText("MONTH", 6), "Var 6:e månad");
  assert.equal(intervalText("WEEK", 2), "Var 2:a vecka");
  assert.equal(intervalText("DAY", 11), "Var 11:e dag");
  assert.equal(intervalText("RUN_HOURS", 500), "Var 500:e drifttimme");
});

test("the plan's input: a name, a whole interval within its unit, a real day", () => {
  const base = { partId: "p", name: "Byt lager", unit: "MONTH", every: 6, startDate: "2026-11-10" };
  assert.equal(planInputSchema.parse(base).isActive, true);
  assert.equal(planInputSchema.safeParse({ ...base, name: " " }).success, false);
  assert.equal(planInputSchema.safeParse({ ...base, every: 0 }).success, false);
  assert.equal(planInputSchema.safeParse({ ...base, every: 1.5 }).success, false);
  assert.equal(planInputSchema.safeParse({ ...base, every: 121 }).success, false, "at most ten years in months");
  assert.equal(planInputSchema.safeParse({ ...base, startDate: "2026-02-30" }).success, false);
  assert.equal(planInputSchema.safeParse({ ...base, unit: "YEAR" }).success, false);
});

test("vilande: a plan's planned order before its day, not activated; never a plain work order", () => {
  const plan = { maintenancePlanId: "plan", maintenanceDue: "2026-12-01", maintenanceActivatedAt: null, status: "PLANNED" };
  assert.equal(isDormant(plan, today), true);
  assert.equal(isDormant({ ...plan, maintenanceDue: today }, today), false, "the day has come");
  assert.equal(isDormant({ ...plan, maintenanceActivatedAt: new Date() }, today), false, "activated by a person");
  assert.equal(isDormant({ ...plan, status: "CANCELLED" }, today), false);
  assert.equal(isDormant({ ...plan, maintenancePlanId: null }, today), false, "an ordinary work order is never vilande");
  assert.match(dormantProblem("2026-12-01"), /vilar till 2026-12-01/);
  assert.equal(occurrenceState(plan, today), "dormant");
  assert.equal(occurrenceState({ ...plan, maintenanceDue: today }, today), "due");
  assert.equal(occurrenceState({ ...plan, maintenanceDue: "2026-10-30" }, today), "late");
  assert.equal(occurrenceState({ ...plan, maintenanceDue: "2026-10-30", status: "IN_PROGRESS" }, today), "started");
  assert.equal(occurrenceState({ ...plan, status: "COMPLETED" }, today), "done");
});

test("a new monthly plan makes 12 vilande work orders from its start, within a year", () => {
  const fill = planFill(monthly, [], today);
  assert.equal(fill.create.length, PLAN_MAX_AHEAD);
  assert.equal(fill.create[0], "2026-11-10");
  assert.equal(fill.create[1], "2026-12-10");
  assert.equal(fill.create.at(-1), "2027-10-10");
  assert.deepEqual([fill.update, fill.remove], [[], []]);
  // A year comes first for a half-yearly plan: two occurrences.
  assert.deepEqual(planFill(halfYear, [], today).create, ["2026-11-10", "2027-05-10"]);
  // Weekly: 12 come before a year.
  assert.equal(planFill({ unit: "WEEK", every: 1, startDate: today, isActive: true }, [], today).create.length, 12);
  // A start in the past is never made late: the first occurrence is today.
  assert.equal(planFill({ ...monthly, startDate: "2026-01-05" }, [], today).create[0], today);
});

test("filling again changes nothing when all is in place (the job may run any number of times)", () => {
  const made = planFill(halfYear, [], today).create.map((due, index) => order({ id: `o${index}`, due }));
  assert.deepEqual(planFill(halfYear, made, today), { update: [], create: [], remove: [], next: "2026-11-10" });
});

test("done a day late: the next occurrence moves a day, and the ones after it follow", () => {
  // The November occurrence was due 2026-11-10 and done 2026-11-11; the next ones lie vilande from before.
  const done = order({ id: "nov", due: "2026-11-10", status: "COMPLETED", completedDay: "2026-11-11" });
  const ahead = ["2026-12-10", "2027-01-10", "2027-02-10"].map((due, index) => order({ id: `a${index}`, due }));
  const fill = planFill(monthly, [done, ...ahead], "2026-11-11");
  assert.deepEqual(fill.update.slice(0, 3), [{ id: "a0", due: "2026-12-11", pinned: false }, { id: "a1", due: "2027-01-11", pinned: false }, { id: "a2", due: "2027-02-11", pinned: false }]);
  assert.equal(fill.next, "2026-12-11");
  // Done early counts from then too.
  const early = planFill(monthly, [order({ id: "nov", due: "2026-11-10", status: "COMPLETED", completedDay: "2026-11-05" }), ...ahead], "2026-11-06");
  assert.equal(early.update[0]?.due, "2026-12-05");
});

test("open past its day: the coming ones count from today until it is done; Utgår counts from its own day", () => {
  const late = order({ id: "nov", due: "2026-11-10", status: "IN_PROGRESS" });
  const ahead = [order({ id: "dec", due: "2026-12-10" })];
  assert.equal(planFill(monthly, [late, ...ahead], "2026-11-14").update[0]?.due, "2026-12-14");
  const notStarted = order({ id: "nov", due: "2026-11-10" });
  assert.equal(planFill(monthly, [notStarted, ...ahead], "2026-11-12").update[0]?.due, "2026-12-12", "its day came and went without a start");
  const skipped = order({ id: "nov", due: "2026-11-10", status: "CANCELLED" });
  assert.deepEqual(planFill(monthly, [skipped, ...ahead], "2026-11-12").update, [], "skipped: the sequence stays");
  assert.equal(nextPlanDay(monthly, [skipped], "2026-11-12"), "2026-12-10");
});

test("postponed: a day a person chose stays, and the ones after it follow from it", () => {
  const ahead = ["2026-11-10", "2026-12-10", "2027-01-10"].map((due, index) => order({ id: `a${index}`, due }));
  // The first one's Start was changed on the work order to 2026-11-20 (postponed in the planning).
  ahead[0] = { ...ahead[0]!, plannedStartDate: "2026-11-20" };
  const fill = planFill(monthly, ahead, today);
  assert.deepEqual(fill.update.slice(0, 3), [{ id: "a0", due: "2026-11-20", pinned: true }, { id: "a1", due: "2026-12-20", pinned: false }, { id: "a2", due: "2027-01-20", pinned: false }]);
  // Next time it is pinned and stays.
  const after = ahead.map((item, index) => ({ ...item, due: fill.update[index]!.due, plannedStartDate: fill.update[index]!.due, pinned: fill.update[index]!.pinned }));
  assert.deepEqual(planFill(monthly, after, today).update, []);
});

test("paused: the vilande work orders go, except those something hangs on; outside the year they go too", () => {
  const ahead = [order({ id: "a", due: "2026-12-10" }), order({ id: "b", due: "2027-01-10", touched: true })];
  assert.deepEqual(planFill({ ...monthly, isActive: false }, ahead, today), { update: [], create: [], remove: ["a"], next: null });
  // A plan changed from monthly to half-yearly: the extra ones are removed.
  const monthlyOrders = planFill(monthly, [], today).create.map((due, index) => order({ id: `m${index}`, due }));
  const fill = planFill(halfYear, monthlyOrders, today);
  assert.equal(fill.update.length + fill.create.length, 1, "the second occurrence moves to May");
  assert.equal(fill.remove.length, 10);
});

test("activated early: it is no longer vilande and the plan counts from its day", () => {
  const activated = order({ id: "nov", due: "2026-11-10", activated: true });
  assert.equal(nextPlanDay(monthly, [activated], today), "2026-12-10");
});

test("drifttimmar: one work order at the hours, none ahead; the next counts from when it was done", () => {
  assert.equal(firstRunHours({ every: 500, runHours: 1200, chosen: null }), 1700);
  assert.equal(firstRunHours({ every: 500, runHours: 1200, chosen: 1500 }), 1500);
  assert.deepEqual(runHoursStep({ every: 500, nextAt: 1700, runHours: 1650, hasOpen: false, isActive: true }), { create: false, nextAt: 1700 });
  assert.deepEqual(runHoursStep({ every: 500, nextAt: 1700, runHours: 1710, hasOpen: false, isActive: true }), { create: true, nextAt: null });
  assert.deepEqual(runHoursStep({ every: 500, nextAt: null, runHours: 1760, hasOpen: true, isActive: true }), { create: false, nextAt: null }, "open: wait");
  assert.deepEqual(runHoursStep({ every: 500, nextAt: null, runHours: 1760, hasOpen: false, isActive: true }), { create: false, nextAt: 2260 }, "done at 1760 h");
  assert.deepEqual(runHoursStep({ every: 500, nextAt: 1700, runHours: 9999, hasOpen: false, isActive: false }), { create: false, nextAt: 1700 }, "paused");
  assert.deepEqual(planFill({ unit: "RUN_HOURS", every: 500, startDate: today, isActive: true }, [], today).create, [], "no vilande ahead");
});
