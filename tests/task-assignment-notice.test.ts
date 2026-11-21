import assert from "node:assert/strict";
import test from "node:test";
import { noticeKey, noticeKindsOf, noticesToSend, noticeStateText } from "../lib/workflow/notice-channels";
import { buildPushNotice } from "../lib/workflow/notice-digest";
import {
  ASSIGNED_NOTICE_CHANNEL, assignmentChange, assignmentKey, assignmentNotifications, assignmentToastText, markAssignmentSeen, parseAssignmentKey,
  recordAssignment, type AssignmentNoticeDb, type AssignmentNoticeRow,
} from "../lib/workflow/task-assignment-notice";

// "Tilldelad dig" (Fas 1B, 2026-10-08): a notice when someone else makes a person responsible for a task, unread until
// the task is opened; never for assigning oneself.

type Row = { organizationId: string; userId: string; key: string; channel: string; createdAt: Date };
/** NoticeDelivery in memory, with the same unique (userId, channel, key) as the table. */
function fakeDb() {
  const rows: Row[] = [];
  let clock = Date.parse("2026-10-08T07:00:00.000Z");
  const db: AssignmentNoticeDb = {
    noticeDelivery: {
      async updateMany({ where, data }) {
        for (const row of rows) if (row.organizationId === where.organizationId && row.channel === where.channel && row.key.startsWith(where.key.startsWith) && row.userId === where.userId) row.channel = data.channel;
      },
      async deleteMany({ where }) {
        for (let index = rows.length - 1; index >= 0; index--) {
          const row = rows[index];
          if (row.organizationId === where.organizationId && row.channel === where.channel && row.key.startsWith(where.key.startsWith) && (!where.userId || row.userId === where.userId)) rows.splice(index, 1);
        }
      },
      async create({ data }) {
        if (rows.some((row) => row.userId === data.userId && row.channel === data.channel && row.key === data.key)) throw new Error("P2002");
        rows.push({ ...data, createdAt: new Date(clock += 60_000) });
        return { id: String(rows.length) };
      },
    },
  };
  return { db, rows };
}

const ORG = "org1";
const task = (assignedToUserId: string | null, extra: Partial<NonNullable<AssignmentNoticeRow["task"]>> = {}) => ({ id: "t1", title: "Byt belysning", kind: "WORK_ORDER", status: "PLANNED", dueDate: "2026-10-12", assignedToUserId, ...extra });
const bell = (rows: Row[], userId: string, current: ReturnType<typeof task>, names: Record<string, string> = { boss: "Berit Chef", anna: "Anna Andersson" }) =>
  assignmentNotifications(rows.filter((row) => row.userId === userId && row.channel === ASSIGNED_NOTICE_CHANNEL).map((row) => {
    const key = parseAssignmentKey(row.key)!;
    return { key: row.key, createdAt: row.createdAt, task: key.taskId === current.id ? current : null, byName: names[key.byUserId] ?? "" };
  }), userId);

test("the decision: assign, reassign, unchanged and self-assign", () => {
  assert.deepEqual(assignmentChange({ previousUserId: null, nextUserId: "anna", actorId: "boss" }), { notify: "anna", clear: true });
  assert.deepEqual(assignmentChange({ previousUserId: "anna", nextUserId: "bo", actorId: "boss" }), { notify: "bo", clear: true });
  assert.deepEqual(assignmentChange({ previousUserId: "anna", nextUserId: "anna", actorId: "boss" }), { notify: null, clear: false }, "unchanged: nothing");
  assert.deepEqual(assignmentChange({ previousUserId: null, nextUserId: "boss", actorId: "boss" }), { notify: null, clear: true }, "self-assign: no notice");
  assert.deepEqual(assignmentChange({ previousUserId: "anna", nextUserId: null, actorId: "boss" }), { notify: null, clear: true }, "unassigned: the old notice goes");
  assert.deepEqual(assignmentChange({ previousUserId: "", nextUserId: "", actorId: "boss" }), { notify: null, clear: false });
});

test("assigning someone else gives them an unread notice with who assigned it and the due date", async () => {
  const { db, rows } = fakeDb();
  await recordAssignment(db, { organizationId: ORG, taskId: "t1", previousUserId: null, nextUserId: "anna", actorId: "boss" });
  assert.equal(rows.length, 1);
  assert.deepEqual({ userId: rows[0].userId, key: rows[0].key, channel: rows[0].channel }, { userId: "anna", key: assignmentKey("t1", "boss"), channel: "ASSIGNED" });
  const [item, ...rest] = bell(rows, "anna", task("anna"));
  assert.equal(rest.length, 0);
  assert.equal(item.kind, "ASSIGNED");
  assert.equal(item.assignedBy, "Berit Chef");
  assert.equal(item.dueDate, "2026-10-12");
  assert.equal(item.detail, "Arbetsordern har tilldelats dig av Berit Chef.");
  assert.equal(item.href, "/?view=workflow_task&taskId=t1&taskType=WORK_ORDER");
  assert.equal(assignmentToastText(item), "Berit Chef har tilldelat dig ”Byt belysning”, klart senast 2026-10-12.");
  assert.equal(assignmentToastText({ ...item, dueDate: "" }), "Berit Chef har tilldelat dig ”Byt belysning”.");
  assert.equal(bell(rows, "boss", task("anna")).length, 0, "the one who assigned gets nothing");
});

test("self-assign gives no notice", async () => {
  const { db, rows } = fakeDb();
  await recordAssignment(db, { organizationId: ORG, taskId: "t1", previousUserId: null, nextUserId: "boss", actorId: "boss" });
  assert.equal(rows.length, 0);
  // Taking over a task assigned to oneself removes the notice one had of it.
  await recordAssignment(db, { organizationId: ORG, taskId: "t1", previousUserId: "boss", nextUserId: "anna", actorId: "boss" });
  await recordAssignment(db, { organizationId: ORG, taskId: "t1", previousUserId: "anna", nextUserId: "anna", actorId: "anna" });
  assert.equal(rows.length, 1, "a save that keeps the responsible changes nothing");
  await recordAssignment(db, { organizationId: ORG, taskId: "t1", previousUserId: "anna", nextUserId: "boss", actorId: "boss" });
  assert.equal(rows.length, 0, "the boss took it back: Anna's notice goes, the boss gets none");
});

test("reassigning moves the notice to the new person; a new assignment is a new notice", async () => {
  const { db, rows } = fakeDb();
  await recordAssignment(db, { organizationId: ORG, taskId: "t1", previousUserId: null, nextUserId: "anna", actorId: "boss" });
  const first = bell(rows, "anna", task("anna"))[0];
  await recordAssignment(db, { organizationId: ORG, taskId: "t1", previousUserId: "anna", nextUserId: "bo", actorId: "boss" });
  assert.deepEqual(rows.map((row) => row.userId), ["bo"], "Anna's notice is gone, Bo has one");
  assert.equal(bell(rows, "bo", task("bo"))[0].assignedBy, "Berit Chef");
  // Bo hands it back to Anna: Anna is told again, with Bo's name.
  await recordAssignment(db, { organizationId: ORG, taskId: "t1", previousUserId: "bo", nextUserId: "anna", actorId: "bo" });
  const again = bell(rows, "anna", task("anna"), { bo: "Bo Bas" })[0];
  assert.equal(again.assignedBy, "Bo Bas");
  assert.notEqual(again.id, first.id, "a new assignment is a new notice (sent again by e-mail/push if chosen)");
  // Other companies' rows are never touched.
  rows.push({ organizationId: "org2", userId: "anna", key: assignmentKey("t1", "x"), channel: "ASSIGNED", createdAt: new Date() });
  await recordAssignment(db, { organizationId: ORG, taskId: "t1", previousUserId: "anna", nextUserId: null, actorId: "boss" });
  assert.deepEqual(rows.map((row) => row.organizationId), ["org2"]);
});

test("read state: unread until the person opens the task", async () => {
  const { db, rows } = fakeDb();
  await recordAssignment(db, { organizationId: ORG, taskId: "t1", previousUserId: null, nextUserId: "anna", actorId: "boss" });
  await recordAssignment(db, { organizationId: ORG, taskId: "t2", previousUserId: null, nextUserId: "anna", actorId: "boss" });
  // Someone else opening the task does not read Anna's notice.
  await markAssignmentSeen(db, { organizationId: ORG, userId: "boss", taskId: "t1" });
  assert.equal(rows.length, 2);
  await markAssignmentSeen(db, { organizationId: ORG, userId: "anna", taskId: "t1" });
  assert.deepEqual(rows.filter((row) => row.channel === ASSIGNED_NOTICE_CHANNEL).map((row) => row.key), [assignmentKey("t2", "boss")], "only the opened task's notice is read");
  // Notislistan (beslut 4): it stays under Läst.
  assert.deepEqual(rows.filter((row) => row.channel === "ASSIGNED_READ").map((row) => [row.userId, row.key]), [["anna", assignmentKey("t1", "boss")]]);
  assert.equal(bell(rows, "anna", task("anna")).length, 0);
});

test("the bell shows only current notices: the task is the person's and open", () => {
  const row = (current: AssignmentNoticeRow["task"]): AssignmentNoticeRow => ({ key: assignmentKey("t1", "boss"), createdAt: new Date("2026-10-08T07:00:00Z"), task: current, byName: "Berit [Chef]\n" });
  assert.equal(assignmentNotifications([row(task("bo"))], "anna").length, 0, "someone else is responsible now");
  assert.equal(assignmentNotifications([row(task("anna", { status: "COMPLETED" }))], "anna").length, 0, "finished");
  assert.equal(assignmentNotifications([row(null)], "anna").length, 0, "not readable or gone");
  assert.equal(assignmentNotifications([{ ...row(task("anna")), key: "WORK_ORDER:t1" }], "anna").length, 0, "not an assignment key");
  const [item] = assignmentNotifications([row(task("anna", { kind: "FORM", dueDate: "" }))], "anna");
  assert.equal(item.assignedBy, "Berit Chef", "the name is one line without formatting marks");
  assert.equal(item.dueDate, "");
  assert.equal(item.detail, "Uppgiften har tilldelats dig av Berit Chef.");
  assert.equal(assignmentNotifications([{ ...row(task("anna")), byName: "" }], "anna")[0].assignedBy, "En kollega");
});

test("e-mail and push: a kind of its own, once per assignment, off until chosen", () => {
  const [item] = assignmentNotifications([{ key: assignmentKey("t1", "boss"), createdAt: new Date("2026-10-08T07:00:00Z"), task: task("anna"), byName: "Berit Chef" }], "anna");
  assert.deepEqual(noticeKindsOf(item), ["ASSIGNED"]);
  assert.equal(noticeKey(item), item.id, "a changed due date is not a new notice");
  assert.equal(noticeKey({ ...item, dueDate: "2026-10-20" }), noticeKey(item));
  assert.deepEqual(noticesToSend([item], ["DEADLINES", "ACTION", "URGENT"], new Set()), [], "not sent to someone who did not choose it");
  assert.deepEqual(noticesToSend([item], ["ASSIGNED"], new Set()), [item]);
  assert.deepEqual(noticesToSend([item], ["ASSIGNED"], new Set([noticeKey(item)])), [], "never twice");
  assert.equal(noticeStateText(item, "2026-10-08"), "Tilldelad dig av Berit Chef, klart senast 2026-10-12");
  const pushed = buildPushNotice([{ organizationName: "Elbolaget", item }], "2026-10-08", "Workflow");
  assert.equal(pushed.body, "Byt belysning – Tilldelad dig av Berit Chef, klart senast 2026-10-12");
  assert.equal(pushed.url, "/?view=workflow_task&taskId=t1&taskType=WORK_ORDER");
});
