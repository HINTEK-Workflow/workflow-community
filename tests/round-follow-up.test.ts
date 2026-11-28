import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checklistDoneQuestion, INTERVAL_MODE_LABELS, intervalModeOf, nextPlanDay, planFill, planInputSchema, roundPlanStep, scheduleDayAfter, type PlanOrder, type PlanRule,
} from "../lib/maintenance/plan-model";
import { ROUND_FORMS } from "../lib/workflow/builtin-rounds";
import { formLeafBlocks, formRowFixedOnSite, formRowsWithoutOrder, formValuesSchema, type FormDocument, type FormTableBlock } from "../lib/workflow/form-document";
import { noticeKey, noticeKindsOf } from "../lib/workflow/notice-channels";
import { requiresAction, sendsFromTheStart } from "../lib/workflow/notification-list";
import {
  findingState, followUpOrderText, followUpRow, parseRoundFollowUpNoticeKey, roundFindings, roundFollowUpCounts, roundFollowUpInputSchema, roundFollowUpNoticeKey, roundFollowUpNotifications,
  roundFollowUpOf, roundFollowUpRecipients, sortFollowUpRows, withStoredRoundFollowUp, ROUND_FOLLOW_UP_NOTICE_DAYS,
} from "../lib/workflow/round-follow-up";
import { workflowTaskDataSchema } from "../lib/workflow/task-model";

// Driftronden som tillsyn (2026-11-27): the interval (Fast schema or from the latest done), the brister of a round
// (Åtgärdad direkt counts as handled), the work orders from the round (Akut/Planerad), the notices and the checklist question.

const order = (patch: Partial<PlanOrder> & { id: string; due: string }): PlanOrder => ({ status: "PLANNED", activated: false, pinned: false, plannedStartDate: patch.due, completedDay: null, touched: false, ...patch });

// ---------- the interval ----------

test("Fast schema: the plan's own days from the start, the 31st kept as the month's last day and back again", () => {
  const monthly = { unit: "MONTH" as const, every: 1, startDate: "2026-01-31" };
  assert.equal(scheduleDayAfter(monthly, "2026-01-31"), "2026-02-28");
  assert.equal(scheduleDayAfter(monthly, "2026-02-28"), "2026-03-31", "counted from the start, not from the clamped day");
  assert.equal(scheduleDayAfter(monthly, "2026-03-15", true), "2026-03-31");
  assert.equal(scheduleDayAfter(monthly, "2026-03-31", true), "2026-03-31", "on the day itself");
  assert.equal(scheduleDayAfter(monthly, "2025-12-01"), "2026-01-31", "before the start: the start");
  const weekly = { unit: "WEEK" as const, every: 2, startDate: "2026-11-02" };
  assert.equal(scheduleDayAfter(weekly, "2026-11-02"), "2026-11-16");
  assert.equal(scheduleDayAfter(weekly, "2026-11-20"), "2026-11-30");
  assert.equal(scheduleDayAfter({ unit: "DAY", every: 10, startDate: "2026-11-01" }, "2026-11-25", true), "2026-12-01");
});

test("the mode: Räkna från senaste utförda by default (as plans counted before), Fast schema by choice, the words", () => {
  const base = { partId: "p", name: "Byt filter", unit: "MONTH", every: 1, startDate: "2026-11-10" };
  assert.equal(planInputSchema.parse(base).intervalMode, "FROM_DONE");
  assert.equal(planInputSchema.parse({ ...base, intervalMode: "FIXED" }).intervalMode, "FIXED");
  assert.equal(planInputSchema.safeParse({ ...base, intervalMode: "SOMETIMES" }).success, false);
  assert.equal(intervalModeOf(undefined), "FROM_DONE");
  assert.equal(intervalModeOf("FIXED"), "FIXED");
  assert.equal(intervalModeOf("junk"), "FROM_DONE");
  assert.deepEqual(INTERVAL_MODE_LABELS, { FIXED: "Fast schema", FROM_DONE: "Räkna från senaste utförda" });
});

test("done late: Fast schema keeps the next day, Räkna från senaste utförda moves it", () => {
  const today = "2026-12-02";
  const fixed: PlanRule = { unit: "MONTH", every: 1, startDate: "2026-11-10", isActive: true, mode: "FIXED" };
  const fromDone: PlanRule = { ...fixed, mode: "FROM_DONE" };
  const doneLate = [order({ id: "a", due: "2026-11-10", status: "COMPLETED", activated: true, completedDay: "2026-11-20" })];
  assert.equal(nextPlanDay(fixed, doneLate, today), "2026-12-10");
  assert.equal(nextPlanDay(fromDone, doneLate, today), "2026-12-20");
  // Without a mode: the rule as before 2026-11-28 (from the latest done).
  assert.equal(nextPlanDay({ ...fixed, mode: undefined }, doneLate, today), "2026-12-20");
  // Done early keeps the day too.
  assert.equal(nextPlanDay(fixed, [order({ id: "a", due: "2026-11-10", status: "COMPLETED", activated: true, completedDay: "2026-11-03" })], "2026-11-05"), "2026-12-10");
});

test("Fast schema: a missed day is not made afterwards, and the start is the first own day from today", () => {
  const weekly: PlanRule = { unit: "WEEK", every: 1, startDate: "2026-11-02", isActive: true, mode: "FIXED" };
  // Open three weeks past its day: the next is the plan's first own day from today, never one in the past.
  assert.equal(nextPlanDay(weekly, [order({ id: "a", due: "2026-11-02", activated: true })], "2026-11-25"), "2026-11-30");
  assert.equal(nextPlanDay(weekly, [], "2026-11-25"), "2026-11-30", "a start in the past: its first own day from today");
  assert.equal(nextPlanDay(weekly, [], "2026-11-30"), "2026-11-30", "on its day: today");
  assert.equal(nextPlanDay(weekly, [], "2026-10-01"), "2026-11-02", "a start ahead: the start");
});

test("Fast schema: the vilande work orders follow the plan's own days, also after a day a person moved", () => {
  const today = "2026-11-12";
  const rule: PlanRule = { unit: "MONTH", every: 1, startDate: "2026-11-10", isActive: true, mode: "FIXED" };
  const done = order({ id: "a", due: "2026-11-10", status: "COMPLETED", activated: true, completedDay: "2026-11-12" });
  const fill = planFill(rule, [done], today);
  assert.equal(fill.create.length, 12);
  assert.deepEqual(fill.create.slice(0, 3), ["2026-12-10", "2027-01-10", "2027-02-10"]);
  // A person moved December to the 20th: it stays, and January is the plan's own day again (not a month after the 20th).
  const moved = planFill(rule, [done, order({ id: "b", due: "2026-12-10", plannedStartDate: "2026-12-20" }), order({ id: "c", due: "2027-01-10" })], today);
  assert.deepEqual(moved.update.find((row) => row.id === "b"), { id: "b", due: "2026-12-20", pinned: true });
  assert.equal(moved.update.find((row) => row.id === "c"), undefined, "January keeps its own day");
  assert.equal(moved.create[0], "2027-02-10");
  // From the latest done, the same move pushes January to the 20th.
  const fromDone = planFill({ ...rule, mode: "FROM_DONE" }, [done, order({ id: "b", due: "2026-12-10", plannedStartDate: "2026-12-20" }), order({ id: "c", due: "2027-01-10" })], today);
  assert.deepEqual(fromDone.update.find((row) => row.id === "c"), { id: "c", due: "2027-01-20", pinned: false });
});

test("Fast schema in a driftrond: the next item is the plan's own day after the one done", () => {
  const today = "2026-11-12";
  const rule: PlanRule = { unit: "WEEK", every: 1, startDate: "2026-11-02", isActive: true, mode: "FIXED" };
  const step = roundPlanStep({ rule, orders: [order({ id: "i", due: "2026-11-09", status: "COMPLETED", activated: true, completedDay: "2026-11-12" })], open: null, openOrder: false,
    holders: [{ id: "h", from: "2026-11-01", to: "2026-12-31", status: "IN_PROGRESS" }], today });
  assert.deepEqual(step.create, { due: "2026-11-16", workOrderId: "h" });
  const fromDone = roundPlanStep({ rule: { ...rule, mode: "FROM_DONE" }, orders: [order({ id: "i", due: "2026-11-09", status: "COMPLETED", activated: true, completedDay: "2026-11-12" })], open: null, openOrder: false,
    holders: [{ id: "h", from: "2026-11-01", to: "2026-12-31", status: "IN_PROGRESS" }], today });
  assert.deepEqual(fromDone.create, { due: "2026-11-19", workOrderId: "h" });
});

// ---------- the checklist's question ----------

test("Klart with points left asks in the shared dialog: Ja or Gå tillbaka; all ticked asks nothing", () => {
  assert.deepEqual(checklistDoneQuestion([true, false, false]), { title: "2 punkter är inte avbockade", message: "Markera som klart ändå?", confirmLabel: "Ja", cancelLabel: "Gå tillbaka" });
  assert.equal(checklistDoneQuestion([true, false])?.title, "1 punkt är inte avbockad");
  assert.equal(checklistDoneQuestion([true, true]), null);
  assert.equal(checklistDoneQuestion([]), null);
});

// ---------- the brister of a round ----------

const safety = ROUND_FORMS.find((form) => form.id === "hintek-skyddsrond")!.document as FormDocument;
const table = formLeafBlocks(safety).find((block): block is FormTableBlock => block.type === "table" && block.key === "avvikelser")!;
const values = (rows: unknown[]) => formValuesSchema.parse({ tables: { avvikelser: rows } });

test("Åtgärdad direkt: the round's tick counts as handled and needs no work order", () => {
  const fixed = { id: "r1", cells: { punkt: "Nödutgång", beskrivning: "Blockerad av pall", allvarlighet: "Hög", direkt: true, atgard: "Pallen flyttad" } };
  const open = { id: "r2", cells: { punkt: "Brandsläckare", beskrivning: "Saknas", allvarlighet: "Medel", direkt: false } };
  const ordered = { id: "r3", cells: { punkt: "Elcentral", beskrivning: "Öppen lucka", allvarlighet: "Hög" }, workOrderId: "wo1", partId: "part1" };
  assert.equal(formRowFixedOnSite(table, fixed), true);
  assert.equal(formRowFixedOnSite(table, open), false);
  assert.equal(formRowFixedOnSite({ columns: [{ ...table.columns[0]!, key: "egen", label: "Åtgärdad direkt", input: "check" }] }, { cells: { egen: true } }), true, "a company's own form: by the name");
  assert.equal(formRowsWithoutOrder(safety, values([fixed, open, ordered])), 1, "only the open one waits for a work order");
  const findings = roundFindings(safety, values([fixed, open, ordered, { id: "r4", cells: {} }, { id: "r5", example: true, cells: { punkt: "Exempel" } }]));
  assert.deepEqual(findings.map((row) => row.rowId), ["r1", "r2", "r3"], "empty and example rows are not brister");
  assert.deepEqual([findings[0]!.point, findings[0]!.description, findings[0]!.comment, findings[0]!.fixedOnSite], ["Nödutgång", "Blockerad av pall", "Pallen flyttad", true]);
  assert.deepEqual([findings[2]!.workOrderId, findings[2]!.partId], ["wo1", "part1"]);
  assert.deepEqual(roundFollowUpCounts(findings), { total: 3, fixedOnSite: 1, withOrder: 1, open: 1, handled: 2 });
  assert.deepEqual(findingState(findings[0]!), { label: "Åtgärdad direkt", tone: "success" });
  assert.equal(findingState(findings[1]!).label, "Öppen brist");
  assert.equal(findingState(findings[2]!).label, "Arbetsorder skapad");
  // The row's machine is kept by the form's values.
  assert.equal(values([ordered]).tables.avvikelser![0]!.partId, "part1");
});

test("the work order's words come from the brist: its point, description, comment and round", () => {
  assert.deepEqual(followUpOrderText({ point: "Nödutgång", description: "Blockerad", comment: "Flytta pallen" }, "Veckorond"), { title: "Åtgärda: Nödutgång", description: "Blockerad\nKommentar: Flytta pallen\nFrån driftronden Veckorond." });
  assert.equal(followUpOrderText({ point: "", description: "Läcker olja\nmer", comment: "" }, "").title, "Åtgärda: Läcker olja");
});

// ---------- the work order's mark and Från ronden ----------

test("the mark: only the server sets it; a save keeps the stored one and drops a sent one", () => {
  const stored = { kind: "WORK_ORDER", details: { roundFollowUp: { kind: "URGENT", roundOrderId: "round-wo" } } };
  assert.deepEqual(roundFollowUpOf(stored), { kind: "URGENT", roundOrderId: "round-wo" });
  assert.equal(roundFollowUpOf({ details: { roundFollowUp: { kind: "MAYBE", roundOrderId: "x" } } }), null);
  const sent = { kind: "WORK_ORDER", details: { executionNotes: "x", roundFollowUp: { kind: "PLANNED", roundOrderId: "forged" } } };
  assert.deepEqual(withStoredRoundFollowUp(sent, stored), { kind: "WORK_ORDER", details: { executionNotes: "x", roundFollowUp: { kind: "URGENT", roundOrderId: "round-wo" } } });
  assert.deepEqual(withStoredRoundFollowUp(sent, null), { kind: "WORK_ORDER", details: { executionNotes: "x" } }, "a new order gets none from the page");
  const form = { kind: "FORM", details: {} };
  assert.equal(withStoredRoundFollowUp(form, stored), form, "only a work order");
  // The task model keeps the mark through a parse.
  const parsed = workflowTaskDataSchema.parse({ kind: "WORK_ORDER", details: { roundFollowUp: { kind: "PLANNED", roundOrderId: "round-wo" } } });
  assert.deepEqual(roundFollowUpOf(parsed), { kind: "PLANNED", roundOrderId: "round-wo" });
});

test("the request: Akut or Planerad, a machine or none, at most 20 photos", () => {
  assert.deepEqual(roundFollowUpInputSchema.parse({ kind: "URGENT" }), { kind: "URGENT", imageIds: [] });
  assert.equal(roundFollowUpInputSchema.parse({ kind: "PLANNED", partId: null }).partId, null);
  assert.equal(roundFollowUpInputSchema.safeParse({ kind: "SOON" }).success, false);
  assert.equal(roundFollowUpInputSchema.safeParse({ kind: "URGENT", imageIds: Array.from({ length: 21 }, (_, index) => `i${index}`) }).success, false);
});

test("Från ronden: Akut first, open before closed; Klar and Utgått are closed", () => {
  const mark = (kind: string) => ({ kind: "WORK_ORDER", details: { roundFollowUp: { kind, roundOrderId: "r" } } });
  const rows = [
    followUpRow({ id: "1", title: "B", status: "COMPLETED", data: mark("URGENT") }),
    followUpRow({ id: "2", title: "A", status: "PLANNED", data: mark("PLANNED") }),
    followUpRow({ id: "3", title: "C", status: "IN_PROGRESS", data: mark("URGENT") }),
    followUpRow({ id: "4", title: "D", status: "CANCELLED", data: mark("PLANNED") }),
  ];
  assert.equal(followUpRow({ id: "5", title: "x", status: "PLANNED", data: { kind: "WORK_ORDER", details: {} } }), null, "an order not from the round");
  const sorted = sortFollowUpRows(rows.filter((row) => row !== null));
  assert.deepEqual(sorted.map((row) => [row.id, row.label]), [["3", "Öppen"], ["2", "Öppen"], ["1", "Klar"], ["4", "Utgått"]]);
});

// ---------- the notices ----------

test("who is told: arbetsledare and admin, never the one who made it, each once", () => {
  const members = [
    { userId: "admin", admin: true, profile: null }, { userId: "lead", admin: false, profile: "work_lead" }, { userId: "upkeep", admin: false, profile: "maintenance_lead" },
    { userId: "tech", admin: false, profile: "electrician" }, { userId: "me", admin: true, profile: "work_lead" },
  ];
  assert.deepEqual(roundFollowUpRecipients({ actorId: "me", members }), ["admin", "lead", "upkeep"]);
});

test("the notice: Akut stands under Kräver åtgärd and goes by e-mail from the start; a planned one is in the app", () => {
  const now = new Date("2026-11-28T10:00:00Z");
  const urgentOrder = { id: "wo1", title: "Åtgärda: Nödutgång", status: "PLANNED", dueDate: "", plannedStartDate: "2026-11-28", data: { kind: "WORK_ORDER", details: { roundFollowUp: { kind: "URGENT", roundOrderId: "r" } } } };
  const plannedOrder = { ...urgentOrder, id: "wo2", plannedStartDate: "2026-12-05", data: { kind: "WORK_ORDER", details: { roundFollowUp: { kind: "PLANNED", roundOrderId: "r" } } } };
  const items = roundFollowUpNotifications([
    { createdAt: new Date("2026-11-28T09:00:00Z"), byName: "Kim", order: urgentOrder },
    { createdAt: new Date("2026-11-28T08:00:00Z"), byName: "Kim", order: plannedOrder },
    { createdAt: new Date("2026-11-28T08:00:00Z"), byName: "Kim", order: { ...urgentOrder, id: "wo3", status: "COMPLETED" } },
    { createdAt: new Date(now.getTime() - (ROUND_FOLLOW_UP_NOTICE_DAYS + 1) * 86_400_000), byName: "Kim", order: { ...urgentOrder, id: "wo4" } },
    { createdAt: new Date("2026-11-28T08:00:00Z"), byName: "Kim", order: null },
  ], now);
  assert.deepEqual(items.map((item) => item.id), ["ROUND_FOLLOW_UP:URGENT:wo1", "ROUND_FOLLOW_UP:PLANNED:wo2"], "closed, old and unreadable are not shown");
  const [urgent, planned] = items as [typeof items[number], typeof items[number]];
  assert.equal(urgent.kind, "ROUND");
  assert.equal(urgent.needsAction, true);
  assert.match(urgent.detail ?? "", /akut arbetsorder/);
  assert.match(planned.detail ?? "", /till 2026-12-05/);
  assert.equal(urgent.href, "/?view=workflow_task&taskId=wo1&taskType=WORK_ORDER");
  assert.equal(requiresAction(urgent), true);
  assert.equal(sendsFromTheStart(urgent), true, "Akut goes by e-mail from the start");
  assert.equal(requiresAction(planned), false);
  assert.deepEqual(noticeKindsOf(planned), ["ROUNDS"], "a planned one by e-mail for those who chose Driftronder");
  assert.equal(noticeKey(urgent), urgent.id, "told once");
  assert.equal(parseRoundFollowUpNoticeKey(roundFollowUpNoticeKey("wo1"))?.workOrderId, "wo1");
  assert.equal(parseRoundFollowUpNoticeKey("ROUND_FOLLOW_UP:a|b"), null);
  assert.equal(parseRoundFollowUpNoticeKey("OBSTACLE:wo1"), null);
});
