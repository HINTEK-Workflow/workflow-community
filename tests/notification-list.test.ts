import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { noticeKey, noticeKindsOf, noticePreferenceInput, noticesToSend, noticeStateText } from "../lib/workflow/notice-channels";
import { ABSENCE_CONFLICT_PREFIX, collapseRepeated, keysToMarkRead, notificationCounts, notificationListAnswer, parseNotificationState, parseNotificationTab, requiresAction, sendsFromTheStart, withReadMarks , notificationSection, notificationsBySection, notificationTabCount } from "../lib/workflow/notification-list";
import { applyNoticeChange } from "../lib/workflow/notice-save-queue";
import type { TaskNotification } from "../lib/workflow/task-notifications";

// Notislistan (beslut 4, 2026-11-01): Till mig · Teamet, Oläst/Läst, "Läs alla", "Kräver åtgärd" on top, as e-mail and push from
// the start, and repeated reminders as one row per day.
const base = (id: string, extra: Partial<TaskNotification> = {}): TaskNotification => ({ id, title: id, kind: "WORK_ORDER", href: `/?x=${id}`, dueDate: "", deadline: null, needsAction: false, ...extra });
const obstacle = base("OBSTACLE:t1:1", { kind: "OBSTACLE" });
const fault = base("OPERATOR_FAULT:r1", { kind: "OPERATOR", needsAction: true });
const reportable = base("self-inspection:reportable:d1", { kind: "SELF_INSPECTION", needsAction: true, audience: "team" });
const severe = base("self-inspection:severe:d2", { kind: "SELF_INSPECTION", needsAction: true, audience: "team" });
const absence = base(`${ABSENCE_CONFLICT_PREFIX}a1`, { kind: "TEAM", audience: "team", needsAction: true });
const alarm = base("MACHINE_ALARM:x", { kind: "MACHINE_ALARM" });
const urgent = base("WORK_ORDER:u", { urgent: true });
const mine = base("WORK_ORDER:m", { deadline: "DUE_SOON", dueDate: "2026-11-05" });
const theirs = base("WORK_ORDER:t", { deadline: "OVERDUE", dueDate: "2026-10-05", audience: "team" });
const needs = base("WORK_ORDER:n", { needsAction: true });

test("what requires action: obstacle, reportable, grade high, fault report, absence conflict, urgent and alarm – not a task's status", () => {
  for (const item of [obstacle, fault, reportable, severe, absence, alarm, urgent]) assert.equal(requiresAction(item), true, item.id);
  for (const item of [mine, theirs, needs]) assert.equal(requiresAction(item), false, item.id);
});

test("e-mail and push from the start: the five of the decision; an urgent order has its own kind and a machine alarm its own path", () => {
  for (const item of [obstacle, fault, reportable, severe, absence]) assert.equal(sendsFromTheStart(item), true, item.id);
  assert.equal(sendsFromTheStart(alarm), false);
  assert.equal(sendsFromTheStart(urgent), false);
  // Without a chosen kind only those go; a chosen kind still decides the rest; sent once.
  assert.deepEqual(noticesToSend([obstacle, mine, alarm], [], new Set(), sendsFromTheStart).map((item) => item.id), [obstacle.id]);
  assert.deepEqual(noticesToSend([obstacle, mine, alarm], [], new Set()), [], "turned off: nothing without a kind");
  assert.deepEqual(noticesToSend([obstacle, mine], ["DEADLINES"], new Set(), sendsFromTheStart).map((item) => item.id).sort(), [mine.id, obstacle.id].sort());
  assert.deepEqual(noticesToSend([obstacle], [], new Set([noticeKey(obstacle)]), sendsFromTheStart), []);
});

test("a person can turn it off, and an older client that does not say so changes nothing", () => {
  assert.equal(noticePreferenceInput.parse({ email: false, kinds: [], requiredNotices: false }).requiredNotices, false);
  assert.equal(noticePreferenceInput.parse({ email: false, kinds: [] }).requiredNotices, undefined);
  assert.equal(applyNoticeChange({ email: false, kinds: [], machineAlarmNight: false }, { kind: "required", on: false }).requiredNotices, false);
});

test("tabs and states: each row in one place, the bell counts what is new for the person and what requires action", () => {
  const rows = collapseRepeated([obstacle, reportable, mine, theirs, needs, { ...base("WORK_ORDER:r"), read: true }, { ...base("WORK_ORDER:rt"), read: true, audience: "team" }]);
  const answer = notificationListAnswer(rows, { tab: "mine", state: "unread", limit: 50, canTeam: true });
  assert.deepEqual(answer.required.map((item) => item.id), [obstacle.id, reportable.id], "with Till mig");
  assert.deepEqual(answer.items.map((item) => item.id), [mine.id, needs.id], "not again in the tab");
  assert.deepEqual(notificationListAnswer(rows, { tab: "team", state: "unread", limit: 50, canTeam: true }).items.map((item) => item.id), [theirs.id]);
  assert.deepEqual(notificationListAnswer(rows, { tab: "mine", state: "read", limit: 50, canTeam: true }).items.map((item) => item.id), ["WORK_ORDER:r"]);
  assert.deepEqual(notificationListAnswer(rows, { tab: "team", state: "read", limit: 50, canTeam: true }).items.map((item) => item.id), ["WORK_ORDER:rt"]);
  assert.deepEqual(notificationCounts(rows, true), { mineUnread: 2, mineRead: 1, teamUnread: 1, teamRead: 1, required: 2, teamRequired: 1, bell: 4 }, "the team's reminders stay out of the bell");
});

test("the bell's figure is what Till mig says, and what requires action of the team also stands under Teamet (2026-11-05: 14, 10 and 3)", () => {
  const teamObstacle = { ...obstacle, id: "OBSTACLE:team", audience: "team" as const };
  const rows = collapseRepeated([obstacle, teamObstacle, mine, needs, theirs]);
  const counts = notificationCounts(rows, true);
  assert.equal(notificationTabCount(counts, "mine"), counts.bell, "the bell and Till mig are one number");
  assert.equal(notificationTabCount(counts, "team"), 2, "the team's reminder and its obstacle");
  const mineTab = notificationListAnswer(rows, { tab: "mine", state: "unread", limit: 50, canTeam: true });
  assert.equal(mineTab.required.length + mineTab.items.length, counts.bell, "what the tab shows is what it says");
  const teamTab = notificationListAnswer(rows, { tab: "team", state: "unread", limit: 50, canTeam: true });
  assert.deepEqual(teamTab.required.map((item) => item.id), [teamObstacle.id], "only the team's");
  assert.equal(teamTab.required.length + teamTab.items.length, notificationTabCount(counts, "team"));
});

test("sections: every row in one, what comes from a machine in its own, what is read no longer required", () => {
  assert.equal(notificationSection(alarm), "required", "an unread alarm with its work order requires action (2026-11-06)");
  assert.equal(notificationSection({ ...alarm, read: true }), "machines");
  assert.equal(notificationSection(base("MACHINE_NOTE:s|off|e|", { kind: "MACHINE_NOTE" })), "machines");
  assert.equal(notificationSection(fault), "machines");
  for (const item of [obstacle, reportable, severe, absence, urgent]) assert.equal(notificationSection(item), "required", item.id);
  assert.equal(notificationSection({ ...obstacle, read: true }), "work");
  assert.equal(notificationSection(mine), "work");
  assert.equal(notificationSection(base("self-inspection:kompetens:1", { kind: "SELF_INSPECTION" })), "reminders");
  const groups = notificationsBySection([mine, alarm, fault, obstacle, base("self-inspection:kompetens:1", { kind: "SELF_INSPECTION" })]);
  assert.deepEqual(groups.map((group) => group.label), ["Kräver åtgärd", "Maskiner och larm", "Arbetsordrar och uppgifter", "Påminnelser"]);
  assert.deepEqual(notificationsBySection([mine]).map((group) => group.key), ["work"], "an empty section is not shown");
});

test("team:read: without it no row of the team reaches the answer, the counts or a mark", () => {
  const rows = collapseRepeated([mine, theirs, reportable]);
  const answer = notificationListAnswer(rows, { tab: "team", state: "unread", limit: 50, canTeam: false });
  assert.deepEqual(answer.items, []);
  assert.deepEqual(answer.required, []);
  assert.equal(answer.counts.teamUnread, 0);
  assert.equal(answer.counts.required, 0);
  assert.deepEqual(keysToMarkRead(rows, { tab: "team", canTeam: false }), []);
});

test("the answer is bounded by the page", () => {
  const rows = collapseRepeated(Array.from({ length: 12 }, (_, index) => base(`WORK_ORDER:${index}`)));
  const answer = notificationListAnswer(rows, { tab: "mine", state: "unread", limit: 5, canTeam: false });
  assert.equal(answer.items.length, 5);
  assert.equal(answer.total, 12);
});

test("repeated reminders: late rounds and a person's events about the same thing are one row per day", () => {
  const round = (schedule: string, day: string) => base(`ROUND:${schedule}:${day}`, { kind: "ROUND", title: schedule, deadline: "OVERDUE", dueDate: day, href: `/?r=${schedule}` });
  const team = (at: string, n: number) => base(`TEAM:MOVED:b1:${n}`, { kind: "TEAM", href: "/?view=planning", assignedAt: at, detail: "Bokningen flyttades." });
  const rows = collapseRepeated([round("Skyddsrond", "2026-10-30"), round("Elrond", "2026-10-30"), round("Skyddsrond", "2026-10-31"), team("2026-11-01T08:00:00.000Z", 1), team("2026-11-01T09:00:00.000Z", 2), team("2026-11-02T09:00:00.000Z", 3)]);
  assert.equal(rows.length, 4, "two late days, two days of events");
  assert.equal(rows[0].row.repeats, 2);
  assert.equal(rows[0].row.title, "2 ronder ej klara");
  assert.equal(rows[0].row.href, "/?view=rounds");
  assert.equal(rows[1].row.title, "Skyddsrond", "one alone stays as it is");
  assert.equal(rows[1].row.repeats, undefined);
  assert.equal(rows[2].row.repeats, 2);
  assert.match(rows[2].row.detail ?? "", /2 händelser/);
  assert.equal(rows[3].row.repeats, undefined);
  // What requires action is never gathered away, and the people's rows do not mix with the team's.
  assert.equal(collapseRepeated([obstacle, { ...obstacle, id: "OBSTACLE:t1:2" }]).length, 2);
  assert.equal(collapseRepeated([round("A", "2026-10-30"), { ...round("B", "2026-10-30"), audience: "team" }]).length, 2);
});

test("read: a row marks every notice behind it, unread again when one more comes or it gets more pressing", () => {
  const late = (schedule: string) => base(`ROUND:${schedule}:2026-10-30`, { kind: "ROUND", deadline: "OVERDUE", dueDate: "2026-10-30" });
  const first = collapseRepeated([late("a"), late("b")]);
  const keys = keysToMarkRead(first, { id: first[0].row.id });
  assert.equal(keys.length, 2);
  const marks = new Set(keys);
  const read = collapseRepeated(withReadMarks([late("a"), late("b")], marks));
  assert.equal(read[0].row.read, true);
  const more = collapseRepeated(withReadMarks([late("a"), late("b"), late("c")], marks));
  assert.equal(more[0].row.read, undefined, "a new one makes the row unread");
  assert.deepEqual(keysToMarkRead(more, { id: more[0].row.id }), [noticeKey(late("c"))], "only what is not read yet");
  // A reminder that becomes more pressing is a new notice to read.
  const soon = base("WORK_ORDER:p", { deadline: "DUE_SOON", dueDate: "2026-11-05" });
  const overdue = base("WORK_ORDER:p", { deadline: "OVERDUE", dueDate: "2026-11-05" });
  assert.equal(withReadMarks([overdue], new Set([noticeKey(soon)]))[0].read, undefined);
});

test("Läs alla: the open tab's unread rows, and never what requires action; a row is marked by its own id", () => {
  const rows = collapseRepeated([obstacle, mine, needs, theirs]);
  assert.deepEqual(keysToMarkRead(rows, { tab: "mine", canTeam: true }).sort(), [noticeKey(mine), noticeKey(needs)].sort());
  assert.deepEqual(keysToMarkRead(rows, { tab: "team", canTeam: true }), [noticeKey(theirs)]);
  assert.deepEqual(keysToMarkRead(rows, { id: obstacle.id }), [noticeKey(obstacle)]);
  assert.deepEqual(keysToMarkRead(rows, { id: "WORK_ORDER:someone-elses" }), [], "only what the server just computed for the person");
});

test("the query: an unknown tab is the old answer, an unknown state is unread", () => {
  assert.equal(parseNotificationTab("team"), "team");
  assert.equal(parseNotificationTab("all"), null);
  assert.equal(parseNotificationTab(null), null);
  assert.equal(parseNotificationState("read"), "read");
  assert.equal(parseNotificationState("x"), "unread");
});

test("an absence conflict is one notice per absence, sent once and read once, whichever job comes first", () => {
  const monday = { ...absence, dueDate: "2026-11-02" };
  const tuesday = { ...absence, dueDate: "2026-11-03", title: "Anna: 2 jobb under frånvaron" };
  assert.equal(noticeKey(monday), `${ABSENCE_CONFLICT_PREFIX}a1`);
  assert.equal(noticeKey(tuesday), noticeKey(monday), "the first job left moves day by day");
  assert.deepEqual(noticesToSend([tuesday], [], new Set([noticeKey(monday)]), sendsFromTheStart), [], "not told again");
  assert.equal(withReadMarks([tuesday], new Set([noticeKey(monday)]))[0].read, true, "not unread again");
});

test("a deviation the person reported themselves stands in their list but is not mailed back to them", () => {
  const own = { ...severe, selfReported: true };
  assert.equal(requiresAction(own), true);
  assert.equal(sendsFromTheStart(own), false);
  assert.deepEqual(noticesToSend([own], [], new Set<string>(), sendsFromTheStart), []);
  assert.deepEqual(noticesToSend([own], ["SELF_INSPECTION"], new Set<string>(), sendsFromTheStart), [own], "unless the person chose the kind");
});

test("a comment's notice is its own kind, sent once, and never carries the text in a mail", () => {
  const comment = base("COMMENT:c1", { kind: "COMMENT", assignedBy: "Anna", detail: "Anna: hemligt" });
  assert.deepEqual(noticeKindsOf(comment), ["COMMENTS"]);
  assert.equal(noticeKey(comment), "COMMENT:c1");
  assert.equal(noticeStateText(comment, "2026-11-01"), "Kommentar av Anna");
});

test("the route: Origin on the marks, session and company first, keys from what the server computed, never for another person", () => {
  const route = readFileSync("app/api/task-notifications/route.ts", "utf8");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.ok(post.indexOf("checkOrigin(request)") < post.indexOf("context()"));
  assert.match(post, /requireCloudStorage\(ctx\)/);
  assert.match(post, /userId: ctx\.user\.id/);
  assert.match(post, /organizationId: ctx\.organizationId/);
  assert.match(post, /keysToMarkRead\(rows/);
  assert.doesNotMatch(post, /input\.userId|input\.organizationId/);
  // A member's Teamet rows only with team:read, and an API key sees none.
  assert.match(route, /teamReader: !ctx\.integration && canViewTeam\(ctx\)/);
  // The mail never gets a member's team rows: only the route asks for them.
  assert.doesNotMatch(readFileSync("lib/workflow/notice-delivery.ts", "utf8"), /teamReader|includeRead/);
});
