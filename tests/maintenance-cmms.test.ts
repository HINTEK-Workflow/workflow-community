import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checklistRows, checklistText, daysLate, followUpText, holderForDay, itemOccurrenceState, itemPlanOrder, planFollowUp, planInputSchema, PLAN_ROUND_LEAD_DAYS, readChecklist, readChecklistTexts,
  roundPlanStep, roundWaitingText, tickChecklist, type PlanOrder, type PlanRule, type RoundHolder,
} from "../lib/maintenance/plan-model";
import { addDays } from "../lib/workflow/schedule";

// Underhåll som ett enklare underhållssystem (2026-11-27): a plan done in the driftrond's work order (one item at a time,
// in the round's work order that holds its day, counted from when it was done), the plan's checklist on the occurrence, and how
// well the plans are kept (only what can be counted).

const today = "2026-11-27";
const monthly: PlanRule = { unit: "MONTH", every: 1, startDate: "2026-12-05", isActive: true };
const year: RoundHolder = { id: "round-2026", from: "2026-01-01", to: "2026-12-31", status: "IN_PROGRESS" };
const next: RoundHolder = { id: "round-2027", from: "2027-01-01", to: "2027-12-31", status: "PLANNED" };
const item = (patch: Partial<Parameters<typeof itemPlanOrder>[0]> & { id: string; planDue: string }) => itemPlanOrder({ status: "OPEN", completedDay: null, ...patch });

test("the plan's input: a checklist without empty rows, at most 30, and an optional round", () => {
  const base = { partId: "p", name: "Byt filter", unit: "MONTH", every: 1, startDate: today };
  const parsed = planInputSchema.parse({ ...base, checklist: ["Stäng av och lås", " ", "Byt filter", "Provkör"] });
  assert.deepEqual(parsed.checklist, ["Stäng av och lås", "Byt filter", "Provkör"]);
  assert.equal(parsed.roundScheduleId, null, "a work order per occurrence by default");
  assert.deepEqual(planInputSchema.parse(base).checklist, []);
  assert.equal(planInputSchema.safeParse({ ...base, checklist: Array.from({ length: 31 }, (_, index) => `Punkt ${index}`) }).success, false);
  assert.equal(planInputSchema.safeParse({ ...base, checklist: ["x".repeat(201)] }).success, false);
  assert.equal(planInputSchema.parse({ ...base, roundScheduleId: "round" }).roundScheduleId, "round");
});

test("the round's work order for a day: an open one whose period holds it, never a closed one", () => {
  assert.equal(holderForDay([year, next], "2026-12-05")?.id, "round-2026");
  assert.equal(holderForDay([year, next], "2027-02-01")?.id, "round-2027");
  assert.equal(holderForDay([{ ...year, status: "COMPLETED" }], "2026-12-05"), null);
  assert.equal(holderForDay([{ ...year, status: "CANCELLED" }], "2026-12-05"), null);
  assert.equal(holderForDay([year], "2028-01-01"), null);
});

test("in the round: the first occurrence goes into the round's work order once its day is near, not months ahead", () => {
  const step = roundPlanStep({ rule: monthly, orders: [], open: null, openOrder: false, holders: [year], today });
  assert.deepEqual(step.create, { due: "2026-12-05", workOrderId: "round-2026" });
  assert.equal(step.waiting, null);
  const far = roundPlanStep({ rule: { ...monthly, startDate: addDays(today, PLAN_ROUND_LEAD_DAYS + 1) }, orders: [], open: null, openOrder: false, holders: [year, next], today });
  assert.equal(far.create, null);
  assert.equal(far.waiting, "later");
  assert.equal(far.next, addDays(today, PLAN_ROUND_LEAD_DAYS + 1));
  assert.match(roundWaitingText(far, "Veckorond"), /30 dagar före/);
});

test("in the round: without a work order for the day nothing is made, and the plan says what is missing", () => {
  const step = roundPlanStep({ rule: monthly, orders: [], open: null, openOrder: false, holders: [], today });
  assert.equal(step.create, null);
  assert.equal(step.waiting, "no_holder");
  assert.match(roundWaitingText(step, "Veckorond"), /ingen arbetsorder för 2026-12-05/);
});

test("in the round: one at a time – an open occurrence (item or work order from before) makes no second one", () => {
  const open = { id: "i1", due: "2026-12-05", workOrderId: "round-2026", holderOpen: true, touched: false };
  const step = roundPlanStep({ rule: monthly, orders: [item({ id: "i1", planDue: "2026-12-05" })], open, openOrder: false, holders: [year], today });
  assert.equal(step.create, null);
  assert.equal(step.move, null);
  assert.equal(step.waiting, "open");
  const fromBefore = roundPlanStep({ rule: monthly, orders: [], open: null, openOrder: true, holders: [year], today });
  assert.equal(fromBefore.create, null, "an open work order of the plan from before the round counts as open");
});

test("in the round: done late counts the next from the day it was done; Utgår from its own day", () => {
  const done = roundPlanStep({ rule: monthly, orders: [item({ id: "i1", planDue: "2026-11-05", status: "DONE", completedDay: "2026-11-20" })], open: null, openOrder: false, holders: [year], today });
  assert.deepEqual(done.create, { due: "2026-12-20", workOrderId: "round-2026" });
  const skipped = roundPlanStep({ rule: monthly, orders: [item({ id: "i1", planDue: "2026-11-05", status: "CANCELLED" })], open: null, openOrder: false, holders: [year], today });
  assert.deepEqual(skipped.create, { due: "2026-12-05", workOrderId: "round-2026" });
});

test("in the round: an open occurrence whose work order was closed follows to the round's work order for today, or its day ahead", () => {
  const late = { id: "i1", due: "2026-11-10", workOrderId: "old", holderOpen: false, touched: true };
  const moved = roundPlanStep({ rule: monthly, orders: [], open: late, openOrder: false, holders: [year], today });
  assert.deepEqual(moved.move, { id: "i1", workOrderId: "round-2026" }, "late: the work order the technician does now");
  const ahead = roundPlanStep({ rule: monthly, orders: [], open: { ...late, due: "2027-01-10" }, openOrder: false, holders: [year, next], today });
  assert.deepEqual(ahead.move, { id: "i1", workOrderId: "round-2027" }, "ahead: the work order of its own day");
  const nowhere = roundPlanStep({ rule: monthly, orders: [], open: late, openOrder: false, holders: [], today });
  assert.equal(nowhere.move, null, "nothing to move to: it stays where it is (nothing is closed by itself)");
});

test("in the round: paused takes away only an untouched occurrence ahead; one that is due, late or touched stays", () => {
  const paused = { ...monthly, isActive: false };
  const ahead = { id: "i1", due: "2026-12-05", workOrderId: "round-2026", holderOpen: true, touched: false };
  assert.deepEqual(roundPlanStep({ rule: paused, orders: [], open: ahead, openOrder: false, holders: [year], today }).remove, ["i1"]);
  assert.deepEqual(roundPlanStep({ rule: paused, orders: [], open: { ...ahead, touched: true }, openOrder: false, holders: [year], today }).remove, []);
  assert.deepEqual(roundPlanStep({ rule: paused, orders: [], open: { ...ahead, due: today }, openOrder: false, holders: [year], today }).remove, []);
  assert.equal(roundPlanStep({ rule: paused, orders: [], open: null, openOrder: false, holders: [year], today }).create, null);
});

test("an occurrence in the round as the page names it", () => {
  assert.equal(itemOccurrenceState({ status: "OPEN", planDue: "2026-12-05" }, today), "coming");
  assert.equal(itemOccurrenceState({ status: "OPEN", planDue: today }, today), "due");
  assert.equal(itemOccurrenceState({ status: "OPEN", planDue: "2026-11-01" }, today), "late");
  assert.equal(itemOccurrenceState({ status: "DONE", planDue: "2026-11-01" }, today), "done");
  assert.equal(itemOccurrenceState({ status: "CANCELLED", planDue: "2026-11-01" }, today), "cancelled");
  const order: PlanOrder = item({ id: "i", planDue: "2026-12-05" });
  assert.equal(order.activated, true, "an item is never vilande");
});

test("the checklist: from the plan, read safely, ticked by position with who and when", () => {
  const rows = checklistRows(["Stäng av", "Byt filter"]);
  assert.deepEqual(rows.map((row) => row.done), [false, false]);
  assert.deepEqual(readChecklist([{ text: "A", done: true, doneAt: "2026-11-27T08:00:00.000Z", doneByName: "Kim" }, { done: true }, "x", null, { text: " " }]),
    [{ text: "A", done: true, doneAt: "2026-11-27T08:00:00.000Z", doneByName: "Kim" }]);
  assert.deepEqual(readChecklist("nope"), []);
  assert.deepEqual(readChecklistTexts(["A", 1, "", "B"]), ["A", "B"]);
  const by = { name: "Kim", at: "2026-11-27T09:00:00.000Z" };
  const ticked = tickChecklist(rows, [true, false], by)!;
  assert.deepEqual(ticked[0], { text: "Stäng av", done: true, doneAt: by.at, doneByName: "Kim" });
  assert.equal(ticked[1]!.done, false);
  const again = tickChecklist(ticked, [true, true], { name: "Alex", at: "2026-11-27T10:00:00.000Z" })!;
  assert.equal(again[0]!.doneByName, "Kim", "a row already ticked keeps who ticked it");
  assert.equal(again[1]!.doneByName, "Alex");
  assert.equal(tickChecklist(rows, [true], by), null, "a stale page (other number of rows) is refused");
  assert.equal(checklistText(again), "2 av 2 punkter");
  assert.equal(checklistText([]), "");
});

test("i tid: only calendar occurrences of the last year up to today; done on its day is in time, after it late", () => {
  const occurrences = [
    { due: "2026-10-01", status: "COMPLETED", completedDay: "2026-10-01", calendar: true },
    { due: "2026-09-01", status: "COMPLETED", completedDay: "2026-08-30", calendar: true },
    { due: "2026-08-01", status: "COMPLETED", completedDay: "2026-08-03", calendar: true },
    { due: "2026-11-20", status: "PLANNED", completedDay: null, calendar: true },
    { due: "2026-07-01", status: "CANCELLED", completedDay: null, calendar: true },
    { due: today, status: "PLANNED", completedDay: null, calendar: true },
    { due: "2026-12-10", status: "PLANNED", completedDay: null, calendar: true, dormant: true },
    { due: "2025-01-01", status: "COMPLETED", completedDay: "2025-01-01", calendar: true },
    { due: "2026-10-15", status: "COMPLETED", completedDay: "2026-10-15", calendar: false },
  ];
  const figures = planFollowUp(occurrences, today);
  assert.deepEqual({ onTime: figures.onTime, doneLate: figures.doneLate, overdue: figures.overdue, cancelled: figures.cancelled, counted: figures.counted, runHours: figures.runHours },
    { onTime: 2, doneLate: 1, overdue: 1, cancelled: 1, counted: 5, runHours: 1 });
  assert.equal(figures.share, 40);
  assert.equal(followUpText(figures), "2 av 5 i tid det senaste året");
});

test("i tid: says when there is nothing to count", () => {
  const none = planFollowUp([], today);
  assert.equal(none.share, null);
  assert.match(followUpText(none), /Inget underlag ännu/);
  const hoursOnly = planFollowUp([{ due: "2026-10-15", status: "COMPLETED", completedDay: "2026-10-15", calendar: false }], today);
  assert.equal(hoursOnly.share, null);
  assert.match(followUpText(hoursOnly), /drifttimmar/);
  assert.equal(daysLate("2026-11-20", today), 7);
  assert.equal(daysLate(today, today), 0);
});
