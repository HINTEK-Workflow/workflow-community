import assert from "node:assert/strict";
import test from "node:test";
import { withoutStaleWaiting } from "../lib/workflow/maintenance";
import { jobObstacle, obstacleBlocked, obstacleInputSchema, obstacleText, projectObstacles, reportObstacle, resolveObstacle } from "../lib/workflow/obstacles";
import { clearObstacleNotices, markObstacleSeen, obstacleKey, obstacleNotifications, obstacleRecipients, parseObstacleKey, recordObstacle, type ObstacleNoticeDb } from "../lib/workflow/obstacle-notice";
import { noticeKey, noticeKindsOf, noticeStateText } from "../lib/workflow/notice-channels";

const NOW = new Date("2026-10-11T08:00:00Z");
// What a paused work order waits for is the order's own details.waitingOn (2026-10-30; it was in details.maintenance before).
const order = (status = "PLANNED", extra: object = {}) => ({ kind: "WORK_ORDER", status, data: { kind: "WORK_ORDER", details: { executionNotes: "", waitingOn: "", ...extra } } as unknown });
const protocol = (status = "PLANNED") => ({ kind: "FORM", status, data: { kind: "FORM", details: { values: {} } } as unknown });

test("the report needs a reason, and 'Annat' needs a few words", () => {
  assert.equal(obstacleInputSchema.safeParse({ reason: "MATERIAL" }).success, true);
  assert.equal(obstacleInputSchema.safeParse({ reason: "OTHER" }).success, false);
  assert.equal(obstacleInputSchema.safeParse({ reason: "OTHER", text: "ab" }).success, false);
  assert.equal(obstacleInputSchema.safeParse({ reason: "OTHER", text: "Nyckel saknas" }).success, true);
  assert.equal(obstacleInputSchema.safeParse({ reason: "MATERIAL", text: "x".repeat(301) }).success, false);
  assert.equal(obstacleInputSchema.safeParse({ reason: "WEATHER" }).success, false);
});

test("a work order that waits for material is paused with the existing 'Väntar på …'", () => {
  const applied = reportObstacle(order(), { reason: "MATERIAL", text: "Kablarna är beställda" }, NOW, "Anna");
  assert.equal(applied.status, "PAUSED");
  const data = applied.data as { obstacle: { reason: string; previousStatus: string }; details: { waitingOn: string } };
  assert.equal(data.details.waitingOn, "MATERIAL");
  assert.equal(data.obstacle.previousStatus, "PLANNED");
  assert.deepEqual(jobObstacle({ status: applied.status, data: applied.data }), { reason: "MATERIAL", text: "Kablarna är beställda", since: NOW.toISOString() });
  assert.equal(obstacleText({ reason: "MATERIAL", text: "Kablarna är beställda" }), "Väntar på material – Kablarna är beställda");
});

test("any other job, 'Annat' and a running clock give 'Behöver åtgärdas'", () => {
  const task = reportObstacle(protocol(), { reason: "CUSTOMER", text: "" }, NOW, "Anna");
  assert.equal(task.status, "NEEDS_ACTION");
  assert.equal(reportObstacle(order(), { reason: "OTHER", text: "Nyckel saknas" }, NOW, "Anna").status, "NEEDS_ACTION");
  const running = reportObstacle({ ...order("IN_PROGRESS"), hasRunningTime: true }, { reason: "SHUTDOWN", text: "" }, NOW, "Anna");
  assert.equal(running.status, "NEEDS_ACTION");
  assert.equal((running.data as { details: { waitingOn: string } }).details.waitingOn, "");
  assert.equal(jobObstacle({ status: running.status, data: running.data })?.reason, "SHUTDOWN");
});

test("resolving puts the status back; Pågår becomes Pausad; a changed status is kept", () => {
  const planned = reportObstacle(order("PLANNED"), { reason: "MATERIAL", text: "" }, NOW, "A");
  const back = resolveObstacle({ kind: "WORK_ORDER", ...planned });
  assert.equal(back.status, "PLANNED");
  assert.equal((back.data as { obstacle?: unknown }).obstacle, undefined);
  assert.equal((back.data as { details: { waitingOn: string } }).details.waitingOn, "");
  assert.equal(jobObstacle({ status: back.status, data: back.data }), null);
  const working = reportObstacle(protocol("IN_PROGRESS"), { reason: "CUSTOMER", text: "" }, NOW, "A");
  assert.equal(resolveObstacle({ kind: "FORM", ...working }).status, "PAUSED");
  const needing = reportObstacle(protocol("NEEDS_ACTION"), { reason: "CUSTOMER", text: "" }, NOW, "A");
  assert.equal(resolveObstacle({ kind: "FORM", ...needing }).status, "NEEDS_ACTION");
  // Time was started meanwhile: the status stays as it is.
  assert.equal(resolveObstacle({ kind: "FORM", status: "IN_PROGRESS", data: working.data }).status, "IN_PROGRESS");
});

test("a second report keeps the status to go back to", () => {
  const first = reportObstacle(protocol("PLANNED"), { reason: "CUSTOMER", text: "" }, NOW, "A");
  const second = reportObstacle({ kind: "FORM", ...first }, { reason: "MATERIAL", text: "" }, new Date("2026-10-12T08:00:00Z"), "B");
  assert.equal(resolveObstacle({ kind: "FORM", ...second }).status, "PLANNED");
});

test("an older paused order with a 'Väntar på …' counts as an obstacle; finished jobs have none", () => {
  const legacy = order("PAUSED", { waitingOn: "CUSTOMER" });
  assert.deepEqual(jobObstacle({ ...legacy, updatedAt: "2026-10-09T10:00:00Z" }), { reason: "CUSTOMER", text: "", since: "2026-10-09T10:00:00.000Z" });
  assert.equal(jobObstacle(order("PAUSED")), null);
  assert.equal(jobObstacle(order("PLANNED", { waitingOn: "CUSTOMER" })), null);
  const reported = reportObstacle(protocol(), { reason: "CUSTOMER", text: "" }, NOW, "A");
  assert.equal(jobObstacle({ status: "COMPLETED", data: reported.data }), null);
  assert.equal(jobObstacle({ status: "CANCELLED", data: reported.data }), null);
  assert.equal(jobObstacle({ status: "PLANNED", data: reported.data }), null);
  assert.ok(obstacleBlocked({ status: "COMPLETED" }));
  assert.ok(obstacleBlocked({ status: "CANCELLED" }));
  assert.equal(obstacleBlocked({ status: "PAUSED" }), null);
});

test("a save with another status, or starting the time, drops the obstacle", () => {
  const reported = reportObstacle(protocol(), { reason: "CUSTOMER", text: "" }, NOW, "A");
  assert.equal(withoutStaleWaiting("NEEDS_ACTION", reported.data), reported.data);
  assert.equal(withoutStaleWaiting("PAUSED", reported.data), reported.data);
  assert.equal((withoutStaleWaiting("IN_PROGRESS", reported.data) as { obstacle?: unknown }).obstacle, undefined);
  assert.equal((withoutStaleWaiting("PLANNED", reported.data) as { obstacle?: unknown }).obstacle, undefined);
  const material = reportObstacle(order(), { reason: "MATERIAL", text: "" }, NOW, "A");
  const resumed = withoutStaleWaiting("IN_PROGRESS", material.data) as { obstacle?: unknown; details: { waitingOn: string } };
  assert.equal(resumed.obstacle, undefined);
  assert.equal(resumed.details.waitingOn, "");
});

test("a project's obstacles: the longest-standing first", () => {
  const a = { id: "a", ...protocol("NEEDS_ACTION"), data: reportObstacle(protocol(), { reason: "CUSTOMER", text: "" }, new Date("2026-10-10T08:00:00Z"), "A").data };
  const b = { id: "b", ...protocol("NEEDS_ACTION"), data: reportObstacle(protocol(), { reason: "MATERIAL", text: "" }, new Date("2026-10-08T08:00:00Z"), "A").data };
  const c = { id: "c", ...protocol("PLANNED") };
  assert.deepEqual(projectObstacles([a, b, c]).map((item) => item.task.id), ["b", "a"]);
  assert.deepEqual(projectObstacles([]), []);
});

// ---------- the notice ----------

test("who is told: the job's and the project's responsible people, not the reporter, only active members", () => {
  const active = new Set(["anna", "bo", "cia"]);
  assert.deepEqual(obstacleRecipients({ taskResponsibleId: "anna", projectResponsibleId: "bo", reporterId: "cia", activeMemberIds: active }), ["anna", "bo"]);
  assert.deepEqual(obstacleRecipients({ taskResponsibleId: "anna", projectResponsibleId: "anna", reporterId: "cia", activeMemberIds: active }), ["anna"]);
  assert.deepEqual(obstacleRecipients({ taskResponsibleId: "anna", projectResponsibleId: "bo", reporterId: "anna", activeMemberIds: active }), ["bo"]);
  assert.deepEqual(obstacleRecipients({ taskResponsibleId: "gone", projectResponsibleId: null, reporterId: "cia", activeMemberIds: active }), []);
});

test("the notice is a row per recipient that a new report replaces and a resolve removes", async () => {
  const rows: { organizationId: string; userId: string; key: string; channel: string }[] = [];
  const db: ObstacleNoticeDb = {
    noticeDelivery: {
      async deleteMany({ where }) { for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i]; if (r.organizationId === where.organizationId && r.channel === where.channel && r.key.startsWith(where.key.startsWith) && (!where.userId || r.userId === where.userId)) rows.splice(i, 1); } },
      async create({ data }) { rows.push({ ...data }); },
    },
  };
  await recordObstacle(db, { organizationId: "o", taskId: "t1", reporterId: "cia", recipients: ["anna", "bo"] });
  assert.deepEqual(rows.map((row) => [row.userId, row.key, row.channel]), [["anna", obstacleKey("t1", "cia"), "OBSTACLE"], ["bo", obstacleKey("t1", "cia"), "OBSTACLE"]]);
  await recordObstacle(db, { organizationId: "o", taskId: "t1", reporterId: "cia", recipients: ["anna"] });
  assert.equal(rows.length, 1);
  rows.push({ organizationId: "o", userId: "bo", key: obstacleKey("t2", "cia"), channel: "OBSTACLE" });
  await markObstacleSeen(db, { organizationId: "o", userId: "anna", taskId: "t1" });
  assert.deepEqual(rows.map((row) => row.key), [obstacleKey("t2", "cia")]);
  await clearObstacleNotices(db, { organizationId: "o", taskId: "t2" });
  assert.equal(rows.length, 0);
  assert.deepEqual(parseObstacleKey(obstacleKey("t1", "cia")), { taskId: "t1", byUserId: "cia" });
  assert.equal(parseObstacleKey("ASSIGNED:t1|x"), null);
});

test("the bell shows 'Hinder rapporterat' while the job still has the obstacle, and the notice kind is its own", () => {
  const reported = reportObstacle(order(), { reason: "MATERIAL", text: "Kablarna är beställda" }, NOW, "Cia");
  const task = { id: "t1", title: "Dragning", kind: "WORK_ORDER", status: reported.status, dueDate: "2026-10-20", data: reported.data, updatedAt: NOW };
  const items = obstacleNotifications([
    { key: obstacleKey("t1", "cia"), createdAt: NOW, task, byName: "Cia Karlsson" },
    { key: obstacleKey("t9", "cia"), createdAt: NOW, task: null, byName: "Cia" },
    { key: obstacleKey("t1", "cia"), createdAt: NOW, task: { ...task, status: "PLANNED", data: resolveObstacle({ kind: "WORK_ORDER", ...reported }).data }, byName: "Cia" },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "OBSTACLE");
  assert.equal(items[0].detail, "Cia Karlsson har rapporterat hinder på arbetsordern: Väntar på material – Kablarna är beställda.");
  assert.ok(items[0].href.includes("taskId=t1"));
  assert.deepEqual(noticeKindsOf(items[0]), ["OBSTACLES"]);
  assert.equal(noticeKey(items[0]), items[0].id);
  assert.equal(noticeStateText(items[0], "2026-10-11"), "Hinder rapporterat av Cia Karlsson");
});
