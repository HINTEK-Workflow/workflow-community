import assert from "node:assert/strict";
import test from "node:test";
import { alarmKey, alarmNotifications, alarmRecipients, alarmRef, claimDecision, parseAlarmKey, type AlarmMember } from "../lib/machine/alarm-notice";
import { availableNoticeKinds, noticeKey, noticeKindsOf, noticesToSend, noticeStateText } from "../lib/workflow/notice-channels";
import { buildPushNotice } from "../lib/workflow/notice-digest";
import { alarmNoteKey, alarmNoteNotifications, ALARM_NOTE_REASONS, parseAlarmNoteKey, SIMULATED_LABEL } from "../lib/machine/alarm-notice";

// Notis med kvittens för maskinlarm (S4): vem som notiseras, kvittensvillkoret och klockans rader.

const admin: AlarmMember = { userId: "admin", admin: true, canReadWorkOrders: true, canReadMachines: false };
const worker: AlarmMember = { userId: "worker", admin: false, canReadWorkOrders: true, canReadMachines: false };
const blind: AlarmMember = { userId: "blind", admin: false, canReadWorkOrders: false, canReadMachines: false };
const mechanic: AlarmMember = { userId: "mechanic", admin: false, canReadWorkOrders: true, canReadMachines: true };
const members = [worker, admin, blind, mechanic];

test("admins have the kind on unless they saved choices without it", () => {
  assert.deepEqual(alarmRecipients({ members: [admin], choices: new Map(), pending: false }), ["admin"]);
  assert.deepEqual(alarmRecipients({ members: [admin], choices: new Map([["admin", ["DEADLINES"]]]), pending: false }), []);
  assert.deepEqual(alarmRecipients({ members: [admin], choices: new Map([["admin", ["MACHINE_ALARM"]]]), pending: false }), ["admin"]);
});

test("2026-11-05: an alarm goes to those with the machines' right, on from the start; nobody else, whatever they chose", () => {
  assert.deepEqual(alarmRecipients({ members, choices: new Map(), pending: false }), ["admin", "mechanic"]);
  assert.deepEqual(alarmRecipients({ members, choices: new Map([["worker", ["MACHINE_ALARM"]], ["blind", ["MACHINE_ALARM"]]]), pending: false }), ["admin", "mechanic"]);
  assert.deepEqual(alarmRecipients({ members, choices: new Map([["mechanic", ["DEADLINES"]]]), pending: false }), ["admin"], "they can choose it away");
});

test("a waiting suggestion goes only to admins, who are the ones who can approve it", () => {
  assert.deepEqual(alarmRecipients({ members, choices: new Map([["worker", ["MACHINE_ALARM"]]]), pending: true }), ["admin"]);
});

test("keys: an order and a waiting suggestion, both parsed back; wrong shapes refused", () => {
  const order = alarmKey(alarmRef({ taskId: "t1" }), "s1");
  assert.equal(order, "MACHINE_ALARM:t1|s1");
  assert.deepEqual(parseAlarmKey(order), { ref: "t1", sourceId: "s1", pending: false, taskId: "t1", rowId: null });
  const waiting = alarmKey(alarmRef({ pendingRowId: "r1" }), "s1");
  assert.deepEqual(parseAlarmKey(waiting), { ref: "p-r1", sourceId: "s1", pending: true, taskId: null, rowId: "r1" });
  for (const bad of ["ASSIGNED:t1|u1", "MACHINE_ALARM:", "MACHINE_ALARM:t1", "MACHINE_ALARM:t1|s1|x", "MACHINE_ALARM:p-|s1"]) assert.equal(parseAlarmKey(bad), null, bad);
});

test("claim rule: the first gets it, the same person again is fine, another is told, a finished order is closed", () => {
  const open = { status: "PLANNED", assignedToUserId: null, assignedToName: "" };
  assert.deepEqual(claimDecision(open, "u1"), { result: "claim" });
  assert.deepEqual(claimDecision({ ...open, assignedToUserId: "u1", assignedToName: "Anna" }, "u1"), { result: "mine" });
  assert.deepEqual(claimDecision({ ...open, assignedToUserId: "u1", assignedToName: "Anna" }, "u2"), { result: "taken", by: "Anna" });
  assert.deepEqual(claimDecision({ ...open, assignedToUserId: "u1", assignedToName: " " }, "u2"), { result: "taken", by: "en kollega" });
  assert.deepEqual(claimDecision({ ...open, status: "COMPLETED" }, "u1"), { result: "closed" });
  assert.deepEqual(claimDecision({ ...open, status: "CANCELLED" }, "u1"), { result: "closed" });
});

const created = new Date("2026-10-20T08:00:00.000Z");
const alarm = { sourceName: "Press 4", text: "Motor 2 överström", code: "E12" };

test("the bell: an open order nobody has taken shows Larm från <källa> with Kvittera; taken or finished shows nothing", () => {
  const row = { key: "MACHINE_ALARM:t1|s1", createdAt: created, alarm, pendingOpen: false };
  const open = { id: "t1", status: "PLANNED", dueDate: "", assignedToUserId: null };
  const [item] = alarmNotifications([{ ...row, task: open }], { canAck: true });
  assert.equal(item.title, "Larm från Press 4: Motor 2 överström. Arbetsorder skapad.");
  assert.equal(item.detail, "Ingen är ansvarig än.");
  assert.equal(item.kind, "MACHINE_ALARM");
  assert.deepEqual(item.machineAlarm, { taskId: "t1", canAck: true });
  assert.match(item.href, /taskId=t1/);
  assert.equal(alarmNotifications([{ ...row, task: open }], { canAck: false })[0].machineAlarm?.canAck, false);
  assert.equal(alarmNotifications([{ ...row, task: { ...open, assignedToUserId: "u9" } }], { canAck: true }).length, 0);
  assert.equal(alarmNotifications([{ ...row, task: { ...open, status: "COMPLETED" } }], { canAck: true }).length, 0);
  assert.equal(alarmNotifications([{ ...row, task: null }], { canAck: true }).length, 0);
  assert.equal(alarmNotifications([{ ...row, task: { ...open, id: "other" } }], { canAck: true }).length, 0, "the notice must be about the same order");
});

test("the bell: a waiting suggestion has no Kvittera and leads to where it is approved; a handled one is gone", () => {
  const row = { key: "MACHINE_ALARM:p-r1|s1", createdAt: created, alarm, task: null };
  const [item] = alarmNotifications([{ ...row, pendingOpen: true }], { canAck: true });
  assert.deepEqual(item.machineAlarm, { taskId: null, canAck: false });
  assert.equal(item.href, "/?view=advanced&section=machines", "Kopplingar → Maskiner (2026-10-31)");
  assert.equal(alarmNotifications([{ ...row, pendingOpen: false }], { canAck: true }).length, 0);
});

test("a machine's text is one plain line", () => {
  const [item] = alarmNotifications([{ key: "MACHINE_ALARM:t1|s1", createdAt: created, alarm: { sourceName: "Press\n[4]", text: "**Stopp** (nu)\r\nigen", code: "E1" }, task: { id: "t1", status: "PLANNED", dueDate: "", assignedToUserId: null }, pendingOpen: false }], { canAck: true });
  assert.equal(item.title, "Larm från Press 4 : Stopp nu igen. Arbetsorder skapad.".replace("4 :", "4:"));
});

test("notice kinds: the type exists, is chosen like the others, is sent once per notice and reads well", () => {
  assert.ok(availableNoticeKinds({ superadmin: false }).some((kind) => kind.key === "MACHINE_ALARM"));
  const [item] = alarmNotifications([{ key: "MACHINE_ALARM:t1|s1", createdAt: created, alarm, task: { id: "t1", status: "PLANNED", dueDate: "", assignedToUserId: null }, pendingOpen: false }], { canAck: true });
  assert.deepEqual(noticeKindsOf(item), ["MACHINE_ALARM"]);
  assert.equal(noticeKey(item), item.id, "told once per notice");
  assert.equal(noticesToSend([item], [], new Set()).length, 0, "nothing chosen, nothing sent");
  assert.equal(noticesToSend([item], ["MACHINE_ALARM"], new Set()).length, 1);
  assert.equal(noticesToSend([item], ["MACHINE_ALARM"], new Set([noticeKey(item)])).length, 0);
  assert.equal(noticesToSend([item], ["DEADLINES", "ASSIGNED"], new Set()).length, 0, "not chosen: not sent");
  assert.equal(noticeStateText(item, "2026-10-20"), "Automatisk arbetsorder, ingen ansvarig");
  assert.match(buildPushNotice([{ organizationName: "Elbolaget", item }], "2026-10-20", "Workflow").body, /Larm från Press 4: Motor 2 överström\. Arbetsorder skapad\. – Automatisk arbetsorder/);
});

test("an alarm without an order says why and leads on; a simulated one is marked, and the mark is not in the sentence", () => {
  const key = alarmNoteKey({ sourceId: "s1", reason: "off", eventId: "e1" });
  assert.deepEqual(parseAlarmNoteKey(key), { sourceId: "s1", reason: "off", eventId: "e1", taskId: null });
  assert.equal(parseAlarmNoteKey("MACHINE_NOTE:s1|unknown|e1|"), null);
  const row = { key, createdAt: created, alarm: { sourceName: "Simulator", text: "Simulerat: Högt tryck", code: "E1" } };
  const [item] = alarmNoteNotifications([row], { machinesHref: "/?view=advanced&section=machines" });
  assert.equal(item.kind, "MACHINE_NOTE");
  assert.equal(item.title, "Larm från Simulator: Högt tryck.");
  assert.equal(item.label, SIMULATED_LABEL);
  assert.equal(item.detail, ALARM_NOTE_REASONS.off);
  assert.equal(item.href, "/?view=advanced&section=machines");
  assert.deepEqual(noticeKindsOf(item), [], "only in the bell: never by e-mail or push");
  const open = alarmNoteKey({ sourceId: "s1", reason: "open", eventId: "e2", taskId: "t1" });
  const [real] = alarmNoteNotifications([{ key: open, createdAt: created, alarm: { sourceName: "Press 4", text: "Stopp", code: "E1" }, taskHref: "/?view=workflow_task&taskId=t1" }], { machinesHref: "/m" });
  assert.equal(real.label, undefined);
  assert.equal(real.href, "/?view=workflow_task&taskId=t1", "the order that is already open");
  assert.deepEqual(alarmNoteNotifications([{ ...row, alarm: null }], { machinesHref: "/m" }), [], "nothing without the company's own event");
});

test("a fault report's on-call notice is called Felanmälan, with no space before the colon (kundresa 2026-11-07, L48)", () => {
  const row = { key: "MACHINE_ALARM:t1|s1", createdAt: created, alarm: { sourceName: "Press 4", text: "Felanmälan, Akut: Läckage", code: "ACUTE" }, pendingOpen: false };
  const [item] = alarmNotifications([{ ...row, task: { id: "t1", status: "PLANNED", dueDate: "", assignedToUserId: null } }], { canAck: true });
  assert.equal(item.title, "Felanmälan, Akut: Läckage – Press 4. Arbetsorder skapad.");
  assert.equal(item.label, "Felanmälan");
});
