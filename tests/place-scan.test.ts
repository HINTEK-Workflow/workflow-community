import assert from "node:assert/strict";
import test from "node:test";
import { formDocumentSchema, initialFormValues } from "../lib/workflow/form-document";
import { formScheduleRuleSchema, scheduleOverview } from "../lib/workflow/form-schedule";
import { SCAN_START_PARAM, roundAtPlaceToday, roundOrderHoldsDay, scanJobs, scanOutcome, scanPoint, scanStartQuestion, scanStarts, type ScanRound } from "../lib/workflow/place-scan";

/** QR-skanning (2026-10-22): the label leads only to a job made beforehand – the scan never creates one. */
const round = (extra: Partial<ScanRound> = {}): ScanRound => ({ id: "r1", title: "Pumprond", templateId: "f1", active: true, started: [], ...extra });

test("a round due without a protocol is no job to open: the scan finds nothing", () => {
  assert.deepEqual(scanOutcome([round()], "pump"), { kind: "none" });
  assert.deepEqual(scanOutcome([], "pump"), { kind: "none" });
});

test("one open protocol opens at once, at the scanned place", () => {
  const outcome = scanOutcome([round({ started: [{ date: "2026-10-22", taskId: "t1" }] })], "pump");
  assert.equal(outcome.kind, "open");
  if (outcome.kind !== "open") return;
  assert.equal(outcome.job.taskId, "t1");
  // The protocol itself, never the form's new-protocol address.
  assert.equal(outcome.job.href, "/?view=workflow_task&taskType=FORM&taskId=t1&scanPlace=pump");
});

test("several open protocols are a choice, the earliest day first; a paused round and doubles are left out", () => {
  const jobs = scanJobs([
    round({ id: "r1", title: "B-rond", started: [{ date: "2026-10-22", taskId: "t2" }, { date: "2026-10-20", taskId: "t1" }] }),
    round({ id: "r2", title: "A-rond", started: [{ date: "2026-10-22", taskId: "t3" }, { date: "2026-10-22", taskId: "t3" }] }),
    round({ id: "r3", title: "Pausad", active: false, started: [{ date: "2026-10-21", taskId: "t4" }] }),
  ], "pump");
  assert.deepEqual(jobs.map((job) => job.taskId), ["t1", "t3", "t2"]);
  assert.equal(scanOutcome([round({ started: [{ date: "2026-10-22", taskId: "t1" }, { date: "2026-10-23", taskId: "t2" }] })], "pump").kind, "choose");
});

test("the overview lists the protocols that exist and are not completed or cancelled", () => {
  const rule = formScheduleRuleSchema.parse({ frequency: "DAILY", interval: 1, startDate: "2026-10-01" });
  const overview = scheduleOverview(rule, [
    { taskId: "done", status: "COMPLETED", occurrence: "2026-10-21" },
    { taskId: "open", status: "IN_PROGRESS", occurrence: "2026-10-22" },
    { taskId: "ahead", status: "PLANNED", occurrence: "2026-10-24" },
    { taskId: "gone", status: "CANCELLED", occurrence: "2026-10-20" },
    { taskId: "old", status: "IN_PROGRESS", occurrence: "2026-08-01" },
  ], "2026-10-22");
  assert.deepEqual(overview.started, [{ date: "2026-10-22", taskId: "open" }, { date: "2026-10-24", taskId: "ahead" }]);
});

test("the scanned point is the one naming the place by its name (2026-10-24: not by a marking)", () => {
  const document = formDocumentSchema.parse({ schema: 2, blocks: [{ id: "s1", type: "section", title: "Rond", blocks: [
    { id: "c1", type: "checklist", key: "punkter", label: "Kontrollpunkter", items: [{ id: "p1", text: "Pump P1 går tyst" }, { id: "p2", text: "Pump P2 utan läckage" }] },
  ] }] });
  const values = initialFormValues(document);
  assert.deepEqual(scanPoint(document, values, { name: "Pump P2" }), { point: "Pump P2 utan läckage", blockId: "c1" });
  assert.deepEqual(scanPoint(document, values, { name: "pump p1" }), { point: "Pump P1 går tyst", blockId: "c1" });
  assert.deepEqual(scanPoint(document, values, { name: "Pump" }), { point: "Pump P1 går tyst", blockId: "c1" }, "the first point that names it");
  assert.equal(scanPoint(document, values, { name: "Fläkt" }), null);
  assert.equal(scanPoint(document, values, { name: "P" }), null, "two letters or more");
  assert.equal(scanPoint(document, values, null), null);
});

// Svar 10 (2026-10-24): a round at the place with nothing started is offered to start; the person presses Starta.
test("a round due today without a protocol asks to start it; one not planned today asks for an extra round", () => {
  const today = "2026-10-24";
  const dueToday = round({ current: { date: today, state: "due", taskId: null }, next: "2026-10-25", assignedToUserId: "u1", assignedToName: "Elin" });
  const outcome = scanOutcome([dueToday], "pump", today);
  assert.equal(outcome.kind, "start");
  if (outcome.kind !== "start") return;
  const [start] = outcome.starts;
  assert.equal(start!.today, true);
  assert.equal(start!.date, today);
  assert.equal(scanStartQuestion(start!), "Pumprond ska göras i dag. Starta ronden?");
  // The same new-protocol address as Starta under Driftronder, with the scanned place and the start marked.
  const href = new URL(start!.href, "http://x");
  assert.equal(href.searchParams.get("scheduleId"), "r1");
  assert.equal(href.searchParams.get("occurrence"), today);
  assert.equal(href.searchParams.get("formId"), "f1");
  assert.equal(href.searchParams.get("assignedTo"), "u1");
  assert.equal(href.searchParams.get("scanPlace"), "pump");
  assert.equal(href.searchParams.get(SCAN_START_PARAM), "1");
  assert.equal(href.searchParams.get("taskId"), null, "nothing exists before Starta");
  for (const key of ["customerId", "facilityId", "projectId", "tempPlace"]) assert.equal(href.searchParams.has(key), false, `${key} comes with the work order (2026-10-27 kväll)`);
  // In the work order that holds the day at the place, when it is known.
  const held = scanStarts([round({ current: { date: today, state: "due", taskId: null, workOrderId: "wo-1" } })], "pump", today);
  assert.equal(new URL(held[0]!.href, "http://x").searchParams.get("workOrderId"), "wo-1");
  const heldToday = scanStarts([round({ current: null, next: today, workOrderId: "wo-2" })], "pump", today);
  assert.equal(new URL(heldToday[0]!.href, "http://x").searchParams.get("workOrderId"), "wo-2");
  // Not planned today: the next occurrence, as Driftronder's Starta nu.
  const extra = scanStarts([round({ current: null, next: "2026-10-27" })], "pump", today);
  assert.deepEqual(extra.map((item) => [item.date, item.today]), [["2026-10-27", false]]);
  assert.equal(scanStartQuestion(extra[0]!), "Starta en extra rond?");
});

test("several rounds to start are a list, today's first; paused and ended rounds are left out", () => {
  const today = "2026-10-24";
  const starts = scanStarts([
    round({ id: "a", title: "A-rond", current: null, next: "2026-10-30" }),
    round({ id: "b", title: "B-rond", current: { date: today, state: "due", taskId: null } }),
    round({ id: "c", title: "Pausad", active: false, current: { date: today, state: "due", taskId: null } }),
    round({ id: "d", title: "Borttagen", templateMissing: true, current: { date: today, state: "due", taskId: null } }),
    round({ id: "e", title: "Avslutad", current: null, next: null }),
  ], "pump", today);
  // A removed or unpublished form is asked about with its warning and no Starta (2026-10-24), after the startable ones of its day.
  assert.deepEqual(starts.map((item) => item.roundId), ["b", "d", "a"]);
  assert.deepEqual(starts.find((item) => item.roundId === "d"), { roundId: "d", title: "Borttagen", date: today, today: true, href: "", formNotice: "Formuläret är borttaget" });
  // An open protocol still opens without a question; no round at all is "none".
  assert.equal(scanOutcome([round({ current: { date: today, state: "started", taskId: "t1" }, started: [{ date: today, taskId: "t1" }] }), round({ id: "x", current: { date: today, state: "due", taskId: null } })], "pump", today).kind, "open");
  assert.deepEqual(scanOutcome([], "pump", today), { kind: "none" });
  assert.deepEqual(scanOutcome([round({ active: false, current: { date: today, state: "due", taskId: null } })], "pump", today), { kind: "none" });
});

test("a round whose form is not published shows the warning instead of Starta (2026-10-24)", () => {
  const today = "2026-10-24";
  const outcome = scanOutcome([round({ templateMissing: true, templateUnpublished: true, current: { date: today, state: "due", taskId: null } })], "pump", today);
  assert.equal(outcome.kind, "start");
  if (outcome.kind !== "start") return;
  assert.equal(outcome.starts[0]!.formNotice, "Formuläret är inte publicerat");
  assert.equal(outcome.starts[0]!.href, "", "no address to start from");
  // A protocol already started still opens.
  assert.equal(scanOutcome([round({ templateMissing: true, templateUnpublished: true, current: { date: today, state: "started", taskId: "t1" }, started: [{ date: today, taskId: "t1" }] })], "pump", today).kind, "open");
});

test("a place's rounds are those whose work order stands there and holds today (2026-10-27 kväll)", () => {
  const order = { status: "IN_PROGRESS", occurrence: null, from: "2026-10-01", to: "2026-12-31", facilityId: "station" };
  assert.equal(roundAtPlaceToday(order, ["station", "pump"], "2026-10-27"), true, "the work order at the place, its period holds the day");
  assert.equal(roundAtPlaceToday(order, ["pump"], "2026-10-27"), false, "a work order at another place");
  assert.equal(roundAtPlaceToday(order, ["station"], "2027-01-04"), false, "outside the period");
  assert.equal(roundAtPlaceToday({ ...order, status: "CANCELLED" }, ["station"], "2026-10-27"), false, "a cancelled work order");
  assert.equal(roundAtPlaceToday({ ...order, facilityId: null }, ["station"], "2026-10-27"), false, "a work order without a place");
  assert.equal(roundAtPlaceToday(null, ["station"], "2026-10-27"), false, "no work order: the round is not at any place");
  assert.equal(roundOrderHoldsDay({ status: "COMPLETED", occurrence: "2026-10-27" }, "2026-10-27"), true, "0.24.0's work order for the day");
  assert.equal(roundOrderHoldsDay({ status: "PLANNED", occurrence: "2026-10-26" }, "2026-10-27"), false);
});
