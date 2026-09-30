import assert from "node:assert/strict";
import test from "node:test";
import { followUpNotifications, notificationToday, taskNotifications, type NotificationSource } from "../lib/workflow/task-notifications";

const task = (id: string, dueDate = "", extra: Partial<NotificationSource> = {}): NotificationSource => ({ id, title: id, dueDate, kind: "WORK_ORDER", status: "PLANNED", ...extra });

test("deadline reminders include day seven and today, separate overdue and exclude day eight", () => {
  const items = taskNotifications([task("seven", "2026-10-02"), task("eight", "2026-10-03"), task("today", "2026-09-25"), task("late", "2026-09-24"), task("none"), task("invalid", "2026-02-30")], "2026-09-25");
  assert.deepEqual(items.map(({ id, deadline }) => [id, deadline]), [["WORK_ORDER:late", "OVERDUE"], ["WORK_ORDER:today", "DUE_SOON"], ["WORK_ORDER:seven", "DUE_SOON"]]);
});

test("one reminder preserves both action and deadline; completed, deleted and archived work never appears", () => {
  const items = taskNotifications([task("both", "2026-09-24", { status: "NEEDS_ACTION" }), task("action", "", { status: "NEEDS_ACTION" }), task("done", "2026-09-24", { status: "COMPLETED" }), task("archive", "2026-09-24", { archived: true, status: "NEEDS_ACTION" }), task("deleted", "2026-09-24", { deletedAt: "2026-09-25" })], "2026-09-25");
  assert.equal(items.length, 2);
  assert.equal(items[0].needsAction, true);
  assert.equal(items[0].deadline, "OVERDUE");
  assert.equal(items[1].deadline, null);
  assert.equal(taskNotifications([task("action", "", { status: "IN_PROGRESS" })], "2026-09-25").length, 0);
});

test("controls reuse mandatory completion errors and never treat inspection date as deadline", () => {
  const control = { kind: "COMMISSIONING_CONTROL" as const, status: "DRAFT" };
  const items = taskNotifications([task("required", "2026-09-24", { ...control, completionErrors: 2 }), task("ready", "2026-09-24", control), task("completed", "", { ...control, completionErrors: 2, status: "COMPLETED" })], "2026-09-25");
  assert.equal(items.length, 1);
  assert.equal(items[0].deadline, null);
  assert.equal(items[0].dueDate, "");
  assert.equal(items[0].href, "/?view=new&id=required");
});

test("Swedish calendar days stay stable across midnight, DST, month and year boundaries", () => {
  assert.equal(notificationToday(new Date("2026-09-24T22:30:00Z")), "2026-09-25");
  assert.equal(taskNotifications([task("spring", "2026-03-30")], "2026-03-23").length, 1);
  assert.equal(taskNotifications([task("autumn", "2026-10-26")], "2026-10-19").length, 1);
  assert.equal(taskNotifications([task("year", "2027-01-03")], "2026-12-27").length, 1);
  assert.throws(() => taskNotifications([], "2026-02-30"));
});

test("flödesvåg 2: a finished work order from a deviation reminds the protocol's owner until followed up", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");
  const origin = { id: "p1", title: "Skyddsrond Verkstad", kind: "FORM", updatedAt: "2026-09-29T08:00:00.000Z" };
  const workOrder = { id: "w1", title: "Åtgärd: Elcentral", status: "COMPLETED", completedAt: "2026-09-29T12:00:00.000Z", source: { taskId: "p1" } };
  const [item] = followUpNotifications([{ workOrder, origin }], now);
  assert.equal(item.id, "FOLLOW_UP:w1");
  assert.equal(item.kind, "FOLLOW_UP");
  assert.equal(item.title, "Skyddsrond Verkstad");
  assert.equal(item.href, "/?view=workflow_task&taskId=p1&taskType=FORM");
  assert.equal(item.dueDate, "2026-09-29");
  assert.match(item.detail ?? "", /Arbetsordern "Åtgärd: Elcentral" är slutförd/);
  // Not finished, not the reader's (no origin), another origin, archived, or saved after the work order was finished.
  assert.deepEqual(followUpNotifications([{ workOrder: { ...workOrder, status: "IN_PROGRESS" }, origin }], now), []);
  assert.deepEqual(followUpNotifications([{ workOrder, origin: null }], now), []);
  assert.deepEqual(followUpNotifications([{ workOrder: { ...workOrder, source: { taskId: "other" } }, origin }], now), []);
  assert.deepEqual(followUpNotifications([{ workOrder, origin: { ...origin, archived: true } }], now), []);
  assert.deepEqual(followUpNotifications([{ workOrder, origin: { ...origin, updatedAt: "2026-09-29T13:00:00.000Z" } }], now), []);
  // Shown for seven Swedish calendar days after it was finished.
  assert.equal(followUpNotifications([{ workOrder: { ...workOrder, completedAt: "2026-09-23T08:00:00.000Z" }, origin: { ...origin, updatedAt: "2026-09-20T08:00:00.000Z" } }], now).length, 1);
  assert.deepEqual(followUpNotifications([{ workOrder: { ...workOrder, completedAt: "2026-09-22T08:00:00.000Z" }, origin: { ...origin, updatedAt: "2026-09-20T08:00:00.000Z" } }], now), []);
});
