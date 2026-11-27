import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assignChoice, assignHref, assignRefusal, bookPeopleHref, isAlarmWorkOrder, parseBookPeople } from "../lib/workflow/assign-work-order";
import { SYSTEM_CREATOR } from "../lib/machine/alarm-rules";
import { jobPeople } from "../lib/workflow/planning-form";
import { bookJobHref } from "../lib/workflow/bookings";
import { demoFileName } from "../features/demo/demo-pdf";

const read = (file: string) => readFileSync(file, "utf8");

/** Tilldela på larmets arbetsorder (2026-11-07). */
test("only an automatic machine work order (a machine alarm's or a fault report's) is an alarm order", () => {
  assert.equal(isAlarmWorkOrder({ kind: "WORK_ORDER", createdBy: "system:operator-fault" }), true, "kundresan 2026-11-07, H1");
  assert.equal(isAlarmWorkOrder({ kind: "WORK_ORDER", createdBy: SYSTEM_CREATOR }), true);
  assert.equal(isAlarmWorkOrder({ kind: "WORK_ORDER", createdBy: "user-1" }), false);
  assert.equal(isAlarmWorkOrder({ kind: "FORM", createdBy: SYSTEM_CREATOR }), false);
  assert.equal(isAlarmWorkOrder({ kind: "WORK_ORDER" }), false);
});

test("Tilldela is grey with a reason without the edit right or in a closed project, usable otherwise", () => {
  assert.equal(assignRefusal({ canEdit: true, projectFrozen: false }), null);
  assert.match(assignRefusal({ canEdit: false, projectFrozen: false }) ?? "", /får läsa men inte ändra arbetsordern/);
  assert.match(assignRefusal({ canEdit: true, projectFrozen: true }) ?? "", /stängt eller arkiverat/);
  // The right is said first: someone who may only read is told so even in a closed project.
  assert.match(assignRefusal({ canEdit: false, projectFrozen: true }) ?? "", /får läsa/);
});

test("the dialog sends a known responsible person and the others to book, each once", () => {
  const memberIds = ["anna", "bo", "cia"];
  assert.deepEqual(assignChoice({ responsibleId: "anna", more: ["bo", "bo", "anna", "okand"], memberIds, canBookMore: true }), { responsibleId: "anna", more: ["bo"] });
  assert.deepEqual(assignChoice({ responsibleId: "anna", more: ["bo"], memberIds, canBookMore: false }), { responsibleId: "anna", more: [] }, "nobody else without booking");
  assert.deepEqual(assignChoice({ responsibleId: "okand", more: ["bo"], memberIds, canBookMore: true }), { responsibleId: "", more: [] }, "an unknown person is never sent");
  assert.deepEqual(assignChoice({ responsibleId: "", more: ["bo"], memberIds, canBookMore: true }), { responsibleId: "", more: [] });
});

test("more people open the booking form with them ticked; the address is read back safely", () => {
  assert.equal(bookPeopleHref("t1", []), bookJobHref("t1"));
  const href = bookPeopleHref("t1", ["anna", "bo", "anna", "x y", "<script>"]);
  assert.ok(href.startsWith(bookJobHref("t1")));
  const people = new URL(href, "http://localhost").searchParams.get("bookPeople");
  assert.deepEqual(parseBookPeople(people), ["anna", "bo"]);
  assert.deepEqual(parseBookPeople(null), []);
  assert.deepEqual(parseBookPeople("a,,a, b ,ö"), ["a", "b"]);
  assert.equal(parseBookPeople(Array.from({ length: 80 }, (_, index) => `p${index}`).join(",")).length, 50);
  assert.equal(assignHref("/?view=workflow_task&taskId=t1&taskType=WORK_ORDER"), "/?view=workflow_task&taskId=t1&taskType=WORK_ORDER&assign=1");
  assert.equal(assignHref("/jobb"), "/jobb?assign=1");
});

test("the booking form ticks the people picked in Tilldela only for someone who may book others", () => {
  const input = { memberIds: ["anna", "bo", "cia"], selfId: "bo", mayBookOthers: true };
  assert.deepEqual(jobPeople({ assignedToUserId: "anna" }, { ...input, chosen: ["anna", "cia", "gone", "cia"] }), ["anna", "cia"]);
  assert.deepEqual(jobPeople({ assignedToUserId: "anna" }, { ...input, chosen: [] }), ["anna"], "nothing picked: the responsible person, as before");
  assert.deepEqual(jobPeople({ assignedToUserId: "anna" }, { ...input, mayBookOthers: false, chosen: ["anna", "cia"] }), ["bo"], "someone who may not book others books themself");
});

test("Tilldela saves through the work order's own save and is wired where the alarm's order is", () => {
  const editor = read("features/workflow/workflow-task-editor.tsx");
  // No new, unchecked path: the responsible person goes through save() → POST /api/workflow-tasks action save.
  assert.match(editor, /async function assignTo\([\s\S]*?withResponsible\(latestTask\.current, responsibleId\)[\s\S]*?await save\(/);
  assert.match(editor, /<AutomaticOrderNotice[\s\S]*?assign=\{[\s\S]*?<AssignButton disabledReason=\{assignReason\}/);
  assert.match(editor, /assignRefusal\(\{ canEdit: canEditWorkOrders, projectFrozen \}\)/);
  // The save path keeps every check and tells the new responsible person.
  const route = read("app/api/workflow-tasks/route.ts");
  assert.match(route, /export async function POST\(request: Request\) \{\s*try \{\s*checkOrigin\(request\);\s*const ctx = await context\(\);\s*requireCloudStorage\(ctx\);\s*await requireCloudWriteAccess\(ctx\);/);
  assert.match(route, /recordAssignment\(tx, \{ organizationId: ctx\.organizationId, taskId: task\.id!, previousUserId: current\.assignedToUserId, nextUserId: task\.assignedToUserId/);
  // The bell's alarm row: Tilldela beside Jag tar den, grey with the reason without the right.
  const bell = read("features/workflow/task-notifications.tsx");
  assert.match(bell, /<AssignButton href=\{assignHref\(item\.href\)\}/);
  assert.match(bell, /<AssignButton disabledReason=\{assignRefusal\(\{ canEdit: false/);
});

/** Demo-PDF:er (2026-11-07): a control's report downloaded in the demo is named demo-…, never like a real report. */
test("the demo's control report is saved under the name the answer gives, which starts with demo-", () => {
  assert.equal(demoFileName("Fortlöpande kontroll-rapport.pdf"), "demo-Fortlöpande kontroll-rapport.pdf");
  assert.equal(demoFileName("a/b:c-rapport.pdf"), "demo-a-b-c-rapport.pdf");
  assert.match(read("features/demo/demo-backend.ts"), /demoPdfResponse\(bytes, demoFileName\(`\$\{task\.title\}-rapport\.pdf`\)/);
  const editor = read("features/workflow/workflow-task-editor.tsx");
  assert.match(editor, /await saveResponse\(response, `\$\{snapshotTask\.title/);
  assert.doesNotMatch(editor, /saveBlob\(await response\.blob\(\), `\$\{snapshotTask\.title/);
});
