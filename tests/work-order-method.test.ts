import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emptyMaintenance, isUrgentOpen, maintenanceFromDeviation, maintenanceHasContent, waitingReasonOf, withoutStaleWaiting, workOrderStatusLabel,
} from "../lib/workflow/maintenance";
import { workOrderDataSchema } from "../lib/workflow/task-model";
import { compareWork, listWork } from "../lib/workflow/work-list";
import { followUpNotifications, taskNotifications } from "../lib/workflow/task-notifications";
import { priorityBadge, taskListItem } from "../features/workflow/work-list-items";
import { copyFormValues, formValuesSchema } from "../lib/workflow/form-document";
import { createLocalWorkspace, saveLocalWorkflowTaskRecord, updateLocalWorkflowTimer } from "../features/kfid/local-workspace-store";
import { riskDone } from "./helpers/risk-step";
import { TOOL_CATALOG } from "../lib/tools/catalog";
import { createWorkflowPdfReport, defaultWorkflowReportOptions } from "../lib/workflow/report";
import { pdfText } from "../lib/import/pdf-text";

// 2026-10-06: the work order follows the maintenance method; since 2026-10-30 the facts are maintenance items and the
// order keeps only what it waits for while paused (details.waitingOn).

const details = (extra?: Record<string, unknown>) => ({ executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "", ...extra });

test("a paused work order says what it waits for; any other status has no waiting reason", () => {
  const waiting = details({ waitingOn: "MATERIAL" });
  assert.equal(waitingReasonOf("PAUSED", waiting), "MATERIAL");
  assert.equal(waitingReasonOf("IN_PROGRESS", waiting), "", "only a paused order waits");
  assert.equal(workOrderStatusLabel("PAUSED", waiting, "Pausad"), "Väntar på material");
  assert.equal(workOrderStatusLabel("PAUSED", { waitingOn: "CUSTOMER" }, "Pausad"), "Väntar på kund", "a list row's summary works the same");
  assert.equal(workOrderStatusLabel("PAUSED", details(), "Pausad"), "Pausad");
  assert.equal(workOrderStatusLabel("PAUSED", undefined, "Pausad"), "Pausad", "older orders without facts");
  assert.equal(maintenanceHasContent(emptyMaintenance()), false);
  assert.equal(workOrderDataSchema.safeParse(details({ waitingOn: "WEATHER" })).success, false, "only the fixed reasons");
  assert.equal(workOrderDataSchema.parse(details()).waitingOn, undefined, "an order without a reason gets none");
  assert.equal(workOrderDataSchema.parse(details({ maintenance: { priority: "HIGH", waitingOn: "SHUTDOWN" } })).waitingOn, "SHUTDOWN", "an older file's reason moves to the order");
});

test("saving with another status or starting time drops the waiting reason", () => {
  const data = { kind: "WORK_ORDER" as const, details: details({ waitingOn: "SHUTDOWN" }) };
  assert.equal(withoutStaleWaiting("PAUSED", data), data, "kept while paused, same object");
  const resumed = withoutStaleWaiting("IN_PROGRESS", data);
  assert.equal((resumed.details as unknown as { waitingOn: string }).waitingOn, "");
  const form = { kind: "FORM", details: { waitingOn: "MATERIAL" } };
  assert.equal(withoutStaleWaiting("IN_PROGRESS", form), form, "only work orders");
});

test("Local: the same rule when saving and when time starts", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const base = { version: 0, kind: "WORK_ORDER", title: "Byt kontaktor", description: "", projectId: null, customerId: null, assignedToUserId: null, assignedToName: "", dueDate: "" };
  const paused = saveLocalWorkflowTaskRecord(workspace, { ...base, status: "PAUSED", data: riskDone({ kind: "WORK_ORDER", details: details({ waitingOn: "MATERIAL" }) }) });
  const stored = paused.task.data.kind === "WORK_ORDER" ? paused.task.data.details : undefined;
  assert.equal(stored?.waitingOn, "MATERIAL");
  const started = updateLocalWorkflowTimer(paused.workspace, paused.task.id, "START", "me@example.test");
  const task = started.workspace.workflowTasks.find((item) => item.id === paused.task.id)!;
  assert.equal(task.status, "IN_PROGRESS");
  assert.equal(task.data.kind === "WORK_ORDER" ? task.data.details.waitingOn : "x", "", "starting time resumes the work");
  const saved = saveLocalWorkflowTaskRecord(paused.workspace, { ...base, id: paused.task.id, version: paused.task.version, status: "NEEDS_ACTION", data: paused.task.data });
  assert.equal(saved.task.data.kind === "WORK_ORDER" ? saved.task.data.details.waitingOn : "x", "");
});

test("Akut: open urgent work orders come first in every sort, done ones do not", () => {
  assert.equal(isUrgentOpen("PLANNED", { priority: "URGENT" }), true);
  assert.equal(isUrgentOpen("COMPLETED", { priority: "URGENT" }), false);
  assert.equal(isUrgentOpen("PLANNED", { priority: "HIGH" }), false);
  assert.equal(isUrgentOpen("PLANNED", undefined), false);
  const entries = [
    { id: "a", title: "A", updatedAt: "2026-10-06T10:00:00Z", date: "2026-10-07", mine: true, search: ["A"] },
    { id: "b", title: "B", updatedAt: "2026-10-01T10:00:00Z", date: "2026-12-01", mine: true, search: ["B"], urgent: true },
    { id: "c", title: "C", updatedAt: "2026-10-05T10:00:00Z", date: "", mine: true, search: ["C"] },
  ];
  for (const sort of ["updated", "due", "title"] as const) assert.equal([...entries].sort(compareWork(sort))[0].id, "b", `urgent first when sorted by ${sort}`);
  assert.deepEqual([...entries].sort(compareWork("updated")).map((entry) => entry.id), ["b", "a", "c"]);
  const page = listWork(entries, { filters: ["all"] as const, matches: () => true, filter: "all", scope: "mine", sort: "title", q: "", page: 1 });
  assert.equal(page.items[0].id, "b");
});

test("the list row shows priority, the waiting reason and the urgent edge", () => {
  const row = (status: string, maintenance?: Record<string, string>) => taskListItem({ id: "w1", kind: "WORK_ORDER", title: "Pump", status, updatedAt: "2026-10-06T10:00:00Z", maintenance }, "2026-10-06");
  const urgent = row("PLANNED", { priority: "URGENT" });
  assert.deepEqual(urgent.priority, { label: "Akut", tone: "danger" });
  assert.equal(urgent.urgent, true);
  assert.equal(row("COMPLETED", { priority: "URGENT" }).urgent, false, "a finished order is not marked");
  assert.equal(row("PAUSED", { waitingOn: "CUSTOMER" }).status.label, "Väntar på kund");
  assert.equal(row("PAUSED").status.label, "Pausad");
  assert.equal(row("PLANNED").priority, null, "no priority, a dash in the column");
  assert.deepEqual(priorityBadge({ priority: "HIGH" }), { label: "Hög", tone: "warning" });
  assert.equal(priorityBadge({ priority: "SOON" }), null);
  const control = taskListItem({ id: "c1", title: "Kontroll", status: "IN_PROGRESS", updatedAt: "2026-10-06T10:00:00Z" }, "2026-10-06");
  assert.equal(control.priority, undefined, "controls have no priority");
});

test("the bell: an urgent work order is a reminder for its responsible person whatever the date, first", () => {
  const items = taskNotifications([
    { id: "late", title: "Försenad", kind: "WORK_ORDER", status: "PLANNED", dueDate: "2026-10-01" },
    { id: "akut", title: "Akut pump", kind: "WORK_ORDER", status: "PLANNED", dueDate: "", urgent: true },
    { id: "akut-risk", title: "Ej arbetsorder", kind: "RISK_ASSESSMENT", status: "PLANNED", urgent: true },
    { id: "akut-klar", title: "Klar", kind: "WORK_ORDER", status: "COMPLETED", urgent: true },
  ], "2026-10-06");
  assert.deepEqual(items.map((item) => item.id), ["WORK_ORDER:akut", "WORK_ORDER:late"]);
  assert.equal(items[0].urgent, true);
  assert.equal(items[0].detail, "Akut arbetsorder.");
});

test("a finished work order leads back to the very row it was made from", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const [item] = followUpNotifications([{
    workOrder: { id: "w1", title: "Åtgärda", status: "COMPLETED", completedAt: "2026-10-06T11:00:00Z", source: { taskId: "p1", rowId: "row-7" } },
    origin: { id: "p1", title: "Isolationsmätning", kind: "FORM", updatedAt: "2026-10-06T10:00:00Z" },
  }], now);
  assert.match(item.href, /taskId=p1&taskType=FORM&row=row-7$/);
});

test("a deviation the form judged itself brings its priority; a severity column still decides", () => {
  const now = new Date("2026-10-06T08:00:00.000Z");
  assert.equal(maintenanceFromDeviation({ fault: "0,3 MΩ", priority: "HIGH", now }).priority, "HIGH");
  assert.equal(maintenanceFromDeviation({ fault: "x", now }).priority, "", "no severity and no priority: no guess");
  assert.equal(maintenanceFromDeviation({ severity: "Observera", severityOptions: ["Observera", "Akut"], seriousOptions: ["Akut"], priority: "HIGH", now }).priority, "NORMAL", "the row's own severity wins");
  assert.equal(maintenanceFromDeviation({ fault: "x", priority: "HIGH", now }).type, "CORRECTIVE");
});

test("work orders from points and fields are kept per protocol and never copied by Spara som", () => {
  assert.equal(formValuesSchema.parse({}).workOrders, undefined, "older protocols parse unchanged");
  const values = formValuesSchema.parse({ workOrders: { "checklist:punkter:p1": "w1", "field:jord": "w2" } });
  assert.deepEqual(values.workOrders, { "checklist:punkter:p1": "w1", "field:jord": "w2" });
  assert.equal(copyFormValues(values).workOrders, undefined);
  assert.equal(formValuesSchema.safeParse({ workOrders: { x: "" } }).success, false);
});

test("tools: create_work_order and update_task take the waiting reason", () => {
  assert.equal(TOOL_CATALOG.update_task.input.safeParse({ taskId: "t1", waitingOn: "MATERIAL" }).success, true);
  assert.equal(TOOL_CATALOG.update_task.input.safeParse({ taskId: "t1", waitingOn: "" }).success, true);
  assert.equal(TOOL_CATALOG.create_work_order.input.safeParse({ title: "Fel", waitingOn: "CUSTOMER" }).success, true);
  assert.equal(TOOL_CATALOG.update_task.input.safeParse({ taskId: "t1", waitingOn: "LUNCH" }).success, false);
});

test("the work order PDF says what a paused order waits for", async () => {
  const font = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
  const text = await pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", fontBytes: font, options: defaultWorkflowReportOptions, tasks: [{
    id: "wo-1", kind: "WORK_ORDER", title: "Byt kontaktor", description: "", status: "PAUSED", progress: 0, assignedToName: "", dueDate: "", totalDurationSec: 0, attachments: [],
    data: { kind: "WORK_ORDER", details: details({ waitingOn: "MATERIAL" }) },
  }] }))) ?? "";
  assert.match(text, /Väntar på material/);
});
