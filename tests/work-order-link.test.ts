import assert from "node:assert/strict";
import { test } from "node:test";
import { riskDone } from "./helpers/risk-step";
import { workflowTaskInputSchema } from "../lib/workflow/task-model";
import {
  holderLine, inheritFromWorkOrder, newLinkedTaskHref, SHARED_BASIC_LABELS, sharedBasicsChanged, sharedBasicsDifference, PROJECT_LINK_WORK_ORDER_ONLY, taskIsSigned, tasksFollowingWorkOrder, timeOnWorkOrderLabel, timeOwnerId, taskNeedsWorkOrder, WORK_ORDER_KEPT, WORK_ORDER_MISSING_LABEL, WORK_ORDER_REQUIRED, workOrderChoiceAllowed,
  workOrderLinkError, workOrderLinkShapeError, workOrderLockedLine, workOrderOptionsQuery, workOrderRemovalRefusal, workOrderRemovalSummary, workOrderRequiredError,
} from "../lib/workflow/work-order-link";
import { taskListContext, taskListItem } from "../features/workflow/work-list-items";
import {
  createLocalWorkspace, parseLocalWorkspace, saveLocalWorkflowTaskRecord, saveLocalWorkflowTimeEntry, updateLocalWorkflowTimer, type LocalWorkspaceDocument,
} from "../features/kfid/local-workspace-store";

const order = { id: "wo-1", kind: "WORK_ORDER", title: "Byte av central", status: "IN_PROGRESS", projectId: "p-1", customerId: "c-1", facilityId: "f-1" };
const protocol = { id: "t-1", kind: "FORM", projectId: "p-1", customerId: "c-1", facilityId: null, workOrderId: "wo-1" };
const pick = (task: { assignedToUserId?: string | null; assignedToName?: string; plannedStartDate?: string | null; dueDate?: string }) => [task.assignedToUserId, task.assignedToName, task.plannedStartDate, task.dueDate];

test("a work order never belongs to another work order, and a task never to itself", () => {
  assert.equal(workOrderLinkShapeError({ kind: "FORM", workOrderId: null }), null);
  assert.match(workOrderLinkShapeError({ kind: "WORK_ORDER", workOrderId: "wo-1" }) ?? "", /arbetsorder kan inte höra till/);
  assert.match(workOrderLinkShapeError({ id: "t-1", kind: "FORM", workOrderId: "t-1" }) ?? "", /sig själv/);
  // The input schema says the same, so every save path (Cloud, Local, demo, API) refuses it before anything is read.
  const base = { version: 0, kind: "WORK_ORDER", title: "AO", data: { kind: "WORK_ORDER", details: {} } };
  assert.equal(workflowTaskInputSchema.safeParse({ ...base, workOrderId: "wo-2" }).success, false);
  assert.equal(workflowTaskInputSchema.safeParse(base).data?.workOrderId, null, "older callers parse with no link");
});

test("Arbetsordern styr (2026-10-27): a task is a draft until it is linked; the work never starts without a work order", () => {
  assert.equal(workOrderRequiredError({ kind: "FORM", workOrderId: null }), null, "a draft may be saved without one");
  assert.equal(workOrderRequiredError({ kind: "FORM", workOrderId: null, status: "PLANNED" }), null);
  assert.equal(workOrderRequiredError({ kind: "FORM", workOrderId: null, status: "CANCELLED" }), null, "a draft that will not be done");
  for (const status of ["IN_PROGRESS", "PAUSED", "NEEDS_ACTION", "COMPLETED"]) assert.equal(workOrderRequiredError({ kind: "RISK_ASSESSMENT", workOrderId: null, status }), WORK_ORDER_REQUIRED, status);
  assert.equal(workOrderRequiredError({ kind: "FORM", workOrderId: null, status: "PLANNED", documented: true }), WORK_ORDER_REQUIRED, "filled in or signed means started");
  assert.equal(workOrderRequiredError({ kind: "WORK_ORDER", workOrderId: null, status: "IN_PROGRESS" }), null);
  assert.equal(workOrderLinkError({ ...protocol, workOrderId: null }, null), null, "a new draft passes");
  assert.equal(workOrderLinkError({ ...protocol, workOrderId: null }, null, { previousWorkOrderId: "wo-1" }), WORK_ORDER_KEPT, "a linked task is never let go of its work order");
  assert.equal(workOrderLinkError({ ...protocol, workOrderId: null, status: "IN_PROGRESS" }, null), WORK_ORDER_REQUIRED);
  assert.equal(workOrderLinkError({ kind: "WORK_ORDER", projectId: null, customerId: null }, null), null);
  assert.equal(taskNeedsWorkOrder({ kind: "FORM", workOrderId: null }), true);
  assert.equal(taskNeedsWorkOrder({ kind: "FORM", workOrderId: "wo" }), false);
  assert.equal(taskNeedsWorkOrder({ kind: "WORK_ORDER", workOrderId: null }), false);
  assert.equal(WORK_ORDER_MISSING_LABEL, "Saknar arbetsorder");
});

test("the link rules: the work order's project and customer, not completed when newly added", () => {
  assert.equal(workOrderLinkError(protocol, order), null);
  assert.match(workOrderLinkError(protocol, null) ?? "", /hittades inte/);
  assert.match(workOrderLinkError(protocol, { ...order, kind: "FORM" }) ?? "", /hittades inte/, "the target must be a work order");
  assert.match(workOrderLinkError({ ...protocol, projectId: "p-2" }, order) ?? "", /arbetsorderns projekt/);
  assert.match(workOrderLinkError({ ...protocol, projectId: null }, order) ?? "", /arbetsorderns projekt/);
  assert.match(workOrderLinkError({ ...protocol, customerId: "c-2" }, order) ?? "", /arbetsorderns kund/);
  assert.match(workOrderLinkError(protocol, { ...order, status: "COMPLETED" }) ?? "", /färdigställd/);
  assert.match(workOrderLinkError(protocol, { ...order, status: "CANCELLED" }) ?? "", /utgått/);
  assert.equal(workOrderLinkError(protocol, { ...order, status: "COMPLETED" }, { changed: false }), null, "a task already in it stays there");
  // An order without project or customer gives its tasks none.
  assert.match(workOrderLinkError({ ...protocol, projectId: "p-9", customerId: "c-9" }, { ...order, projectId: null, customerId: null }) ?? "", /arbetsorderns/);
});

test("Arbetsordern som hållare (2026-10-30): a linked task has its work order's Grunduppgifter – never a place or responsible of its own", () => {
  const fresh = { kind: "FORM", projectId: null, customerId: null, facilityId: null, workOrderId: "wo-1" };
  assert.deepEqual(inheritFromWorkOrder(fresh, order, { isNew: true }), { ...fresh, projectId: "p-1", customerId: "c-1", facilityId: "f-1" });
  const existing = inheritFromWorkOrder({ ...fresh, id: "t-9" }, order, { isNew: false });
  assert.equal(existing.projectId, "p-1", "an existing task follows its work order too");
  assert.equal(existing.facilityId, "f-1", "the place is the work order's");
  assert.equal(workOrderLinkError(existing, order), null);
  // Another place of the same customer is not kept: another place is a new work order.
  assert.equal(inheritFromWorkOrder({ ...fresh, customerId: "c-1", facilityId: "f-2" }, order, { isNew: true }).facilityId, "f-1");
  assert.equal(inheritFromWorkOrder({ ...fresh, customerId: "c-9", facilityId: "f-9" }, order, { isNew: false }).facilityId, "f-1");
  // The responsible person and the dates are the work order's when the caller read them; otherwise kept.
  const planned = { ...order, assignedToUserId: "u-1", assignedToName: "Anna", plannedStartDate: "2026-11-02", dueDate: "2026-11-06" };
  const own = { ...fresh, assignedToUserId: "u-2", assignedToName: "Erik", plannedStartDate: "2026-12-01", dueDate: "2026-12-24" };
  assert.deepEqual(pick(inheritFromWorkOrder(own, planned, { isNew: false })), ["u-1", "Anna", "2026-11-02", "2026-11-06"]);
  assert.deepEqual(pick(inheritFromWorkOrder(own, order, { isNew: false })), ["u-2", "Erik", "2026-12-01", "2026-12-24"], "not read: kept");
  // A round's work order keeps each occurrence's own days, but the person and the place are shared.
  assert.deepEqual(pick(inheritFromWorkOrder(own, { ...planned, roundScheduleId: "s-1" }, { isNew: false })), ["u-1", "Anna", "2026-12-01", "2026-12-24"]);
  // A draft is never changed, and keeps its own until it is linked.
  assert.equal(inheritFromWorkOrder({ ...own, workOrderId: null }, planned, { isNew: false }).assignedToUserId, "u-2");
  // An order without a customer gives no customer and no place.
  assert.deepEqual(inheritFromWorkOrder({ ...fresh, customerId: "c-9", facilityId: "f-9" }, { ...order, customerId: null, projectId: null }, { isNew: true }), { ...fresh, projectId: null, customerId: null, facilityId: null });
  // A work order itself is never changed by the rule.
  const workOrder = { kind: "WORK_ORDER", projectId: "p-2", customerId: null, workOrderId: null };
  assert.equal(inheritFromWorkOrder(workOrder, order, { isNew: true }), workOrder);
  // The choice offers open orders only.
  assert.equal(workOrderChoiceAllowed({ kind: "FORM", projectId: null, customerId: null }, order), true);
  assert.equal(workOrderChoiceAllowed({ id: "t-9", kind: "FORM", projectId: "p-7", customerId: null }, order), true, "moving takes the new order's project");
  assert.equal(workOrderChoiceAllowed({ kind: "FORM", projectId: "p-1", customerId: "c-1" }, { ...order, status: "COMPLETED" }), false);
});

test("time routing: time of a task lands on its work order, a work order keeps its own", () => {
  assert.equal(timeOwnerId({ id: "t-1", kind: "FORM", workOrderId: "wo-1" }), "wo-1");
  assert.equal(timeOwnerId({ id: "wo-1", kind: "WORK_ORDER", workOrderId: null }), "wo-1");
  assert.equal(timeOwnerId({ id: "t-3" }), "t-3", "an older Local task before the upgrade falls back to itself");
  assert.equal(timeOnWorkOrderLabel("Byte av central"), "Tiden räknas på arbetsorder Byte av central");
  assert.equal(workOrderLockedLine({ workOrderTitle: "Byte av central", customerName: "Kund AB", projectName: "Laddplatser" }), "Arbetsorder Byte av central · Kund AB · Projekt Laddplatser");
  assert.equal(workOrderLockedLine({ workOrderTitle: " " }), "Arbetsorder (utan rubrik)");
});

test("removing a work order: listed first, refused while a protocol is completed or signed", () => {
  const open = { id: "t-1", kind: "FORM", title: "Protokoll", status: "IN_PROGRESS" };
  assert.equal(workOrderRemovalRefusal([]), null);
  assert.equal(workOrderRemovalRefusal([open]), null);
  assert.match(workOrderRemovalRefusal([open, { ...open, id: "t-2", status: "COMPLETED" }]) ?? "", /kan inte tas bort.*Utgår/);
  assert.match(workOrderRemovalRefusal([{ ...open, signed: true }]) ?? "", /signerat/);
  assert.equal(workOrderRemovalSummary([]), "Arbetsordern har inga uppgifter.");
  assert.equal(workOrderRemovalSummary([open]), "Uppgiften tas bort med arbetsordern: Protokoll.");
  assert.match(workOrderRemovalSummary(Array.from({ length: 12 }, (_, index) => ({ title: `P${index}` }))), /De 12 uppgifterna.*och 2 till/);
  // What counts as signed: a protocol's confirmed signature, a risk assessment's approval.
  assert.equal(taskIsSigned({ kind: "FORM", details: { values: { signatures: { a: { name: "A", confirmed: true, signedAt: null } } } } }), true);
  assert.equal(taskIsSigned({ kind: "FORM", details: { values: { signatures: { a: { name: "A", confirmed: false, signedAt: null } } } } }), false);
  assert.equal(taskIsSigned({ kind: "RISK_ASSESSMENT", details: { approval: { confirmed: true } } }), true);
  assert.equal(taskIsSigned(null), false);
});

test("a project takes a work order and its tasks follow; never a task alone", () => {
  assert.match(PROJECT_LINK_WORK_ORDER_ONLY, /följer sin arbetsorder/);
  const moved = { ...order, projectId: "p-2", customerId: "c-2", facilityId: "f-20" };
  const tasks = [protocol, { ...protocol, id: "t-2", workOrderId: "wo-other" }, { ...protocol, id: "t-3", projectId: "p-2", customerId: "c-2", facilityId: "f-20" }];
  const following = tasksFollowingWorkOrder(moved, tasks.map((task) => ({ ...task, workOrderId: task.id === "t-2" ? "wo-other" : "wo-1" })));
  assert.deepEqual(following.map((task) => [task.id, task.projectId, task.customerId, task.facilityId]), [["t-1", "p-2", "c-2", "f-20"]]);
});

test("Grunduppgifter är gemensamma: a change in the work order reaches its tasks, and a draft shows the difference before linking", () => {
  const planned = { ...order, assignedToUserId: "u-1", assignedToName: "Anna", plannedStartDate: "2026-11-02", dueDate: "2026-11-06" };
  const inside = { ...protocol, facilityId: "f-1", assignedToUserId: "u-1", assignedToName: "Anna", plannedStartDate: "2026-11-02", dueDate: "2026-11-06" };
  assert.deepEqual(tasksFollowingWorkOrder(planned, [inside]), [], "nothing to change");
  const later = tasksFollowingWorkOrder({ ...planned, dueDate: "2026-11-20", assignedToUserId: "u-2", assignedToName: "Erik" }, [inside, { ...inside, id: "wo-x", kind: "WORK_ORDER" }]);
  assert.deepEqual(later.map((task) => [task.id, task.assignedToUserId, task.dueDate]), [["t-1", "u-2", "2026-11-20"]], "never another work order");
  assert.equal(sharedBasicsChanged(planned, { ...planned }), false);
  assert.equal(sharedBasicsChanged(planned, { ...planned, facilityId: "f-2" }), true);
  assert.equal(sharedBasicsChanged(planned, { ...planned, roundScheduleId: "s-1" }), true, "a round decides the dates");
  // The difference before Koppla till arbetsorder.
  const draft = { kind: "FORM", projectId: null, customerId: "c-1", facilityId: "f-2", workOrderId: null, assignedToUserId: "u-1", assignedToName: "Anna", plannedStartDate: "2026-11-02", dueDate: "2026-12-01" };
  assert.deepEqual(sharedBasicsDifference(draft, planned), ["projectId", "facilityId", "dueDate"]);
  assert.deepEqual(sharedBasicsDifference({ ...draft, projectId: "p-1", facilityId: "f-1", dueDate: "2026-11-06" }, planned), []);
  assert.deepEqual(sharedBasicsDifference({ ...draft, projectId: "p-1", facilityId: "f-1", dueDate: "2026-11-06", assignedToUserId: null, assignedToName: "" }, planned), ["assignedToUserId"]);
  assert.equal(SHARED_BASIC_LABELS.facilityId, "Plats");
  assert.equal(holderLine("AO-1042"), "Hör till arbetsorder AO-1042 – ändras på båda ställena.");
});

test("lists say compactly which work order a task belongs to", () => {
  assert.equal(taskListContext({ projectName: "", workOrderId: null }), "");
  assert.equal(taskListContext({ projectName: "", workOrderId: "wo-1", workOrderTitle: "Byte av central" }), "Arbetsorder: Byte av central");
  assert.equal(taskListContext({ projectName: "Laddplatser", workOrderId: "wo-1", workOrderTitle: "Byte av central" }), "Projekt: Laddplatser · Arbetsorder: Byte av central");
  assert.equal(taskListContext({ projectName: "Laddplatser" }), "Projekt: Laddplatser");
  const item = taskListItem({ id: "t-1", kind: "FORM", title: "Protokoll", status: "PLANNED", updatedAt: "2026-10-08T08:00:00.000Z", workOrderId: "wo-1", workOrderTitle: "" }, "2026-10-08");
  assert.equal(item.context, "Arbetsorder: (utan rubrik)", "without read on work orders the title is not shown");
});

test("the choice's query and the new task's link carry project, customer and the current order", () => {
  assert.equal(workOrderOptionsQuery({ projectId: "p-1", customerId: "c-1", workOrderId: "wo-1" }, " led "), "q=led&projectId=p-1&customerId=c-1&include=wo-1");
  assert.equal(workOrderOptionsQuery({ id: "t-1", projectId: null, customerId: null }), "");
  assert.equal(newLinkedTaskHref({ id: "wo-1", projectId: "p-1", customerId: null, facilityId: "f-1" }), "/?view=new_task&workOrderId=wo-1&projectId=p-1&facilityId=f-1");
});

// ---------- Local (.hwf) ----------
const emptyOrder = { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" };
function localJob() {
  let workspace: LocalWorkspaceDocument = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const created = saveLocalWorkflowTaskRecord(workspace, { version: 0, kind: "WORK_ORDER", title: "Byte av central", data: riskDone({ kind: "WORK_ORDER" as const, details: emptyOrder }) });
  workspace = created.workspace;
  const risk = saveLocalWorkflowTaskRecord(workspace, { version: 0, kind: "RISK_ASSESSMENT", title: "Riskbedömning", workOrderId: created.task.id, data: { kind: "RISK_ASSESSMENT", details: { risks: [], generalMeasures: "", approval: { name: "", confirmed: false, approvedAt: null } } } });
  return { workspace: risk.workspace, orderId: created.task.id, riskId: risk.task.id };
}

test("Local: the link is kept in the file and read back; a task is never let go of its work order", () => {
  const { workspace, orderId, riskId } = localJob();
  assert.equal(workspace.workflowTasks.find((task) => task.id === riskId)?.workOrderId, orderId);
  assert.equal(workspace.workflowTasks.find((task) => task.id === orderId)?.workOrderId, undefined, "unused, the field is not written");
  const reopened = parseLocalWorkspace(JSON.parse(JSON.stringify(workspace)), "org-local");
  assert.equal(reopened.workflowTasks.find((task) => task.id === riskId)?.workOrderId, orderId);
  // A file whose link names something that is not a work order is refused, and a current file with a task without one too.
  const broken = JSON.parse(JSON.stringify(workspace));
  broken.workflowTasks.find((task: { id: string }) => task.id === riskId).workOrderId = riskId;
  assert.throws(() => parseLocalWorkspace(broken, "org-local"));
  const loose = JSON.parse(JSON.stringify(workspace));
  delete loose.workflowTasks.find((task: { id: string }) => task.id === riskId).workOrderId;
  assert.doesNotThrow(() => parseLocalWorkspace(loose, "org-local"), "a draft without a work order is kept in the file (2026-10-27)");
  const started = JSON.parse(JSON.stringify(loose));
  Object.assign(started.workflowTasks.find((task: { id: string }) => task.id === riskId), { status: "IN_PROGRESS", startedAt: "2026-10-27T08:00:00.000Z" });
  assert.throws(() => parseLocalWorkspace(started, "org-local"), "a started task without a work order is refused");
  // A work order is never linked; a task is never let go.
  assert.throws(() => saveLocalWorkflowTaskRecord(workspace, { version: 0, kind: "WORK_ORDER", title: "AO 2", workOrderId: orderId, data: { kind: "WORK_ORDER", details: emptyOrder } }));
  const risk = workspace.workflowTasks.find((task) => task.id === riskId)!;
  assert.throws(() => saveLocalWorkflowTaskRecord(workspace, { ...risk, workOrderId: null }), /inte tas ur den/);
});

test("Local: an older file (schema 11) is upgraded – each standalone task gets a work order with its time and bookings", () => {
  const { workspace, orderId, riskId } = localJob();
  const older = JSON.parse(JSON.stringify(workspace));
  older.schemaVersion = 11;
  const standaloneId = crypto.randomUUID();
  const now = "2026-10-20T08:00:00.000Z";
  const entry = { id: crypto.randomUUID(), userId: "me@example.test", startedAt: "2026-10-20T06:00:00.000Z", endedAt: "2026-10-20T07:00:00.000Z", durationSec: 3600, note: "", createdAt: now, updatedAt: now };
  older.workflowTasks.push({ id: standaloneId, version: 1, kind: "RISK_ASSESSMENT", title: "Fristående risk", description: "", status: "COMPLETED", progress: 100, projectId: null, customerId: null, facilityId: null, assignedToUserId: null, assignedToName: "",
    dueDate: "2026-10-21", data: { kind: "RISK_ASSESSMENT", riskStep: true, details: { risks: [], generalMeasures: "", approval: { name: "QA", confirmed: true, approvedAt: now } } }, startedAt: null, completedAt: now, createdAt: now, updatedAt: now, timeEntries: [entry], revisions: [] });
  // Older time on a linked task moves to its work order too.
  older.workflowTasks.find((task: { id: string }) => task.id === riskId).timeEntries = [{ ...entry, id: crypto.randomUUID() }];
  older.plannedActivities.push({ id: crypto.randomUUID(), version: 1, title: "Bokad", description: "", kind: "TASK", status: "PLANNED", frameExceptionReason: "", startsAt: now, endsAt: "2026-10-20T09:00:00.000Z", projectId: null, workflowTaskId: standaloneId,
    assignedToUserId: null, assignedToUserIds: [], assignments: [], assignedToName: "", deletedAt: null, createdAt: now, updatedAt: now, events: [] });
  const upgraded = parseLocalWorkspace(older, "org-local");
  assert.equal(upgraded.schemaVersion, 13);
  const task = upgraded.workflowTasks.find((item) => item.id === standaloneId)!;
  assert.ok(task.workOrderId, "the standalone task is in a work order now");
  const wrapper = upgraded.workflowTasks.find((item) => item.id === task.workOrderId)!;
  assert.equal(wrapper.kind, "WORK_ORDER");
  assert.equal(wrapper.title, "Fristående risk");
  assert.equal(wrapper.status, "COMPLETED");
  assert.equal(wrapper.dueDate, "2026-10-21");
  assert.equal(task.status, "COMPLETED", "the completed task itself is unchanged");
  assert.deepEqual(task.data, older.workflowTasks.find((item: { id: string }) => item.id === standaloneId).data, "its content is untouched");
  assert.equal(task.timeEntries.length, 0);
  assert.deepEqual(wrapper.timeEntries.map((item) => item.id), [entry.id], "its time is on the work order");
  assert.equal(upgraded.workflowTasks.find((item) => item.id === riskId)!.timeEntries.length, 0);
  assert.equal(upgraded.workflowTasks.find((item) => item.id === orderId)!.timeEntries.length, 1, "a linked task's older time is on its order");
  assert.equal(upgraded.plannedActivities.at(-1)!.workflowTaskId, wrapper.id, "the booking follows");
  assert.ok(upgraded.timeEntryEvents.some((event) => event.entryId === entry.id && event.reason.includes("modellbyte")), "the move is in the time history");
  // Read twice (or imported twice) the same file gives the same work order.
  assert.equal(parseLocalWorkspace(older, "org-local").workflowTasks.find((item) => item.id === standaloneId)!.workOrderId, wrapper.id);
});

test("Local: removing a work order takes its open tasks along, and is refused while one is completed or signed", async () => {
  const { removeLocalWorkOrder } = await import("../features/kfid/local-workspace-store");
  const { workspace, orderId, riskId } = localJob();
  const removed = removeLocalWorkOrder(workspace, orderId);
  assert.equal(removed.workspace.workflowTasks.some((task) => task.id === orderId || task.id === riskId), false);
  const signed = { ...workspace, workflowTasks: workspace.workflowTasks.map((task) => task.id === riskId && task.data.kind === "RISK_ASSESSMENT" ? { ...task, data: { ...task.data, details: { ...task.data.details, approval: { name: "QA", confirmed: true, approvedAt: null } } } } : task) };
  assert.throws(() => removeLocalWorkOrder(signed, orderId), /kan inte tas bort/);
  const completed = { ...workspace, workflowTasks: workspace.workflowTasks.map((task) => task.id === riskId ? { ...task, status: "COMPLETED" as const } : task) };
  assert.throws(() => removeLocalWorkOrder(completed, orderId), /Utgår/);
});

test("Local: the timer and written time on a task land on its work order", () => {
  const { workspace, orderId, riskId } = localJob();
  const started = updateLocalWorkflowTimer(workspace, riskId, "START", "me@example.test");
  const order = started.workspace.workflowTasks.find((task) => task.id === orderId)!;
  const risk = started.workspace.workflowTasks.find((task) => task.id === riskId)!;
  assert.equal(order.timeEntries.filter((entry) => !entry.endedAt).length, 1, "the running entry is on the work order");
  assert.equal(order.status, "IN_PROGRESS");
  assert.equal(risk.timeEntries.length, 0);
  const written = saveLocalWorkflowTimeEntry(workspace, { taskId: riskId, startedAt: "2026-10-08T07:00:00.000Z", endedAt: "2026-10-08T08:00:00.000Z", note: "" }, "me@example.test");
  assert.equal(written.workflowTasks.find((task) => task.id === orderId)!.timeEntries.length, 1);
  assert.equal(written.workflowTasks.find((task) => task.id === riskId)!.timeEntries.length, 0);
  // The work order itself takes its own time.
  const own = saveLocalWorkflowTimeEntry(workspace, { taskId: orderId, startedAt: "2026-10-08T07:00:00.000Z", endedAt: "2026-10-08T08:00:00.000Z", note: "" }, "me@example.test");
  assert.equal(own.workflowTasks.find((task) => task.id === orderId)!.timeEntries.length, 1);
});


test("Local: the work order's Grunduppgifter reach its open tasks (Arbetsordern som hållare, 2026-10-30)", () => {
  const { workspace, orderId, riskId } = localJob();
  const order = workspace.workflowTasks.find((task) => task.id === orderId)!;
  const changed = saveLocalWorkflowTaskRecord(workspace, { ...order, assignedToUserId: null, assignedToName: "Anna Nilsson", plannedStartDate: "2026-11-02", dueDate: "2026-11-06" }).workspace;
  const risk = changed.workflowTasks.find((task) => task.id === riskId)!;
  assert.deepEqual([risk.assignedToName, risk.plannedStartDate, risk.dueDate], ["Anna Nilsson", "2026-11-02", "2026-11-06"]);
  assert.equal(risk.version, 2, "the task got a new version");
  // A task saved with other values takes the work order's again.
  const own = saveLocalWorkflowTaskRecord(changed, { ...risk, assignedToName: "Erik Lund", dueDate: "2026-12-24" }).task;
  assert.deepEqual([own.assignedToName, own.dueDate], ["Anna Nilsson", "2026-11-06"], "a task never has its own responsible person or date");
});

test("a protocol row in the work order is named by its form, with the place under it", async () => {
  const { linkedTaskFormName, linkedTaskHeading } = await import("../lib/workflow/work-order-link");
  assert.equal(linkedTaskFormName({ kind: "FORM", details: { templateName: " Kontroll före idrifttagning " } }), "Kontroll före idrifttagning");
  assert.equal(linkedTaskFormName({ kind: "RISK_ASSESSMENT", details: {} }), "");
  assert.equal(linkedTaskFormName(null), "");
  assert.deepEqual(linkedTaskHeading({ title: "Kontorshuset Fasvägen 3, 123 42 Elstad", formName: "Kontroll före idrifttagning" }), { title: "Kontroll före idrifttagning", place: "Kontorshuset Fasvägen 3, 123 42 Elstad" });
  assert.deepEqual(linkedTaskHeading({ title: "Kontroll före idrifttagning", formName: "Kontroll före idrifttagning" }), { title: "Kontroll före idrifttagning", place: "" });
  assert.deepEqual(linkedTaskHeading({ title: "Riskbedömning tak" }), { title: "Riskbedömning tak", place: "" });
});
