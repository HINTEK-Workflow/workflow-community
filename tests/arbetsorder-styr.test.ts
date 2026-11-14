import assert from "node:assert/strict";
import { test } from "node:test";
import { roundHolderDraft, roundOfProtocolValues, roundOfWorkOrder } from "../lib/workflow/round-work-orders";
import { roundHref, scheduleOverview, type FormScheduleRule } from "../lib/workflow/form-schedule";
import { planningRounds } from "../lib/workflow/planning-rounds";
import { projectTimeLabel, projectTimeState, projectTimeTotals, PROJECT_TIME_ENTRY_ONE_OWNER } from "../lib/workflow/time-owner";
import { runningTimerPlace, runningTimerTaskHref } from "../lib/workflow/running-timer";
import { riskStepApplies, riskStepExempt, riskStepState } from "../lib/workflow/risk-step";
import { parseWorkOrderOrigin, workOrderOriginMatches } from "../lib/workflow/work-items";
import { projectEffort } from "../lib/workflow/project-effort";
import { wrapperOrderId } from "../features/kfid/local-work-orders";
import { createLocalWorkspace, saveLocalFormSchedule, saveLocalProjectRecord, saveLocalWorkflowTaskRecord, saveLocalWorkflowTimeEntry, updateLocalProjectTimer, updateLocalWorkflowTimer } from "../features/kfid/local-workspace-store";
import { withLocalWorkOrder } from "./helpers/work-order";

/**
 * Arbetsordern styr (2026-10-26, svar 1a 2b 3b 4b 5a; changed 2026-10-27): time on a work order or a project with
 * one running timer per person, the risk step only on the work order, the round orders in lists. Since 2026-10-27 a round
 * is held by one work order for a period (tests/arbetsorder-rond-utkast.test.ts has the new rules: drafts, the period, the
 * safety check); 0.24.0's work orders per day are still read. Local's file and the demo show they follow the rules.
 */
const weekly: FormScheduleRule = { frequency: "WEEKLY", interval: 1, weekdays: [1], startDate: "2026-09-01", endDate: "" };

test("rounds: the round's work order carries the round, its period as Start and Klart senast, the risk step, and its own customer, place and temporary place", () => {
  // 2026-10-27 kväll: the work order chooses where; a round stored before then suggests what it had (never its project).
  const tempPlace = { address: "Arbetsbod", postalCode: "", city: "", latitude: null, longitude: null };
  const schedule = { id: "s-1", title: "Veckotillsyn", assignedToUserId: "u-1", assignedToName: "Elon", legacyPlace: { customerId: "c-1", facilityId: "f-1", projectId: "p-1", tempPlace } };
  const draft = roundHolderDraft(schedule, { from: "2026-10-26", to: "2027-10-25" });
  assert.equal(draft.kind, "WORK_ORDER");
  assert.equal(draft.title, "Veckotillsyn 2026-10-26–2027-10-25");
  assert.equal(roundHolderDraft(schedule, { from: "2026-10-26", to: "2026-10-26" }).title, "Veckotillsyn 2026-10-26", "one day reads as the day");
  assert.deepEqual([draft.plannedStartDate, draft.dueDate], ["2026-10-26", "2027-10-25"]);
  assert.deepEqual([draft.customerId, draft.facilityId, draft.projectId, draft.assignedToUserId], ["c-1", "f-1", null, "u-1"], "the old customer and place as the suggestion, no project from the round");
  assert.equal(draft.roundScheduleId, "s-1");
  assert.equal(draft.data.riskStep, true, "the full risk assessment is made on the work order");
  assert.equal((draft.data as { tempPlace?: { address: string } }).tempPlace?.address, "Arbetsbod");
  const chosen = roundHolderDraft({ id: "s-2", title: "Ny rond", assignedToUserId: null, assignedToName: "" }, { from: "2026-10-26", to: "2026-10-26" }, { place: { customerId: "c-9", facilityId: "f-9", projectId: "p-9" } });
  assert.deepEqual([chosen.customerId, chosen.facilityId, chosen.projectId], ["c-9", "f-9", "p-9"], "the work order's own choice");
  assert.equal(roundHolderDraft({ id: "s-3", title: "Ny", assignedToUserId: null, assignedToName: "" }, { from: "2026-10-26", to: "2026-10-26" }).customerId, null, "a new round suggests nothing");
  assert.equal(roundHolderDraft(schedule, { from: "2026-10-26", to: "2026-10-26" }, { projectOpen: false, place: { projectId: "p-1" } }).projectId, null, "a closed project is left out");
  assert.deepEqual(roundOfWorkOrder(draft), { scheduleId: "s-1", occurrence: null });
  assert.deepEqual(roundOfWorkOrder({ roundScheduleId: "s-1", roundOccurrence: "2026-10-19" }), { scheduleId: "s-1", occurrence: "2026-10-19" }, "0.24.0's work order per day is still read");
  assert.equal(roundOfWorkOrder({ roundScheduleId: null }), null);
  assert.deepEqual(roundOfProtocolValues({ kind: "FORM", details: { values: { round: { scheduleId: "s-1", occurrence: "2026-10-26" } } } }), { scheduleId: "s-1", occurrence: "2026-10-26" });
  assert.equal(roundOfProtocolValues({ kind: "FORM", details: { values: { round: { scheduleId: "s-1", occurrence: "i morgon" } } } }), null);
  assert.equal(roundOfProtocolValues(null), null);
});

test("rounds: the overview carries each day's work order; a 0.24.0 work order closed without a protocol has handled its day", () => {
  const overview = scheduleOverview(weekly, [], "2026-10-26", {}, [{ occurrence: "2026-10-19", id: "wo-19", status: "CANCELLED" }, { occurrence: "2026-10-26", id: "wo-26", status: "PLANNED" }]);
  assert.equal(overview.history[0].date, "2026-10-19");
  assert.equal(overview.history[0].state, "done", "Utgår on the round's work order handles the day");
  assert.equal(overview.today?.workOrderId, "wo-26");
  assert.equal(overview.today?.state, "due");
  assert.ok(overview.history.every((item) => item.date !== "2026-10-19" || item.state === "done"));
  // Without its work order a past day is missed (late), as before.
  assert.equal(scheduleOverview(weekly, [], "2026-10-26").missed > 0, true);
  // Starting a day opens the protocol in its work order.
  const href = new URL(roundHref({ id: "s-1", templateId: "form-1", title: "Rond" }, { date: "2026-10-26", workOrderId: "wo-26" }), "http://x");
  assert.equal(href.searchParams.get("workOrderId"), "wo-26");
  assert.equal(href.searchParams.get("scheduleId"), "s-1");
  const planned = planningRounds([{ id: "s-1", version: 1, templateId: "form-1", title: "Rond", assignedToUserId: null, assignedToName: "", active: true, rule: weekly, reminders: { bell: true, email: false } }],
    [], { from: "2026-10-19", to: "2026-10-26" }, "2026-10-26", undefined, [{ scheduleId: "s-1", occurrence: "2026-10-26", id: "wo-26", status: "PLANNED" }]);
  assert.equal(planned.rounds.find((round) => round.date === "2026-10-26")?.workOrderId, "wo-26");
});

test("rounds: the work order list's Ursprung – the rounds' orders, the others, or one round's", () => {
  assert.equal(parseWorkOrderOrigin("rounds"), "rounds");
  assert.equal(parseWorkOrderOrigin("x"), "");
  assert.equal(workOrderOriginMatches({ roundScheduleId: "s-1" }, "rounds"), true);
  assert.equal(workOrderOriginMatches({ roundScheduleId: null }, "rounds"), false);
  assert.equal(workOrderOriginMatches({ roundScheduleId: null }, "other"), true);
  assert.equal(workOrderOriginMatches({ roundScheduleId: "s-1" }, ""), true);
  assert.equal(workOrderOriginMatches({ roundScheduleId: "s-2" }, "", "s-1"), false, "one round's orders");
});

test("time: a project as its own time source, summed beside its work orders' time and never twice", () => {
  assert.match(PROJECT_TIME_ENTRY_ONE_OWNER, /arbetsorder eller projekt/);
  assert.deepEqual(projectTimeState({ closedAt: null, archivedAt: null }), { status: "IN_PROGRESS", archived: false });
  assert.deepEqual(projectTimeState({ closedAt: "2026-10-01T00:00:00.000Z", archivedAt: null }), { status: "COMPLETED", archived: false }, "closed: only an admin corrects");
  assert.deepEqual(projectTimeTotals({ workOrderSeconds: 3600, projectSeconds: 1800 }), { workOrders: 3600, project: 1800, total: 5400 });
  assert.equal(projectTimeLabel("Laddplatser"), "Projekttid: Laddplatser");
  const effort = projectEffort([{ id: "wo", status: "IN_PROGRESS", totalDurationSec: 3600 }], new Map(), { projectSeconds: 1800 });
  assert.equal(effort.reportedMinutes, 90, "Rapporterat holds the project's own time");
  assert.equal(effort.projectReportedMinutes, 30);
  // The top bar's timer names where it runs and leads there.
  assert.equal(runningTimerTaskHref({ taskId: "p-1", kind: "PROJECT" }), "/?view=project&projectId=p-1");
  assert.equal(runningTimerTaskHref({ taskId: "wo-1", kind: "WORK_ORDER" }), "/?view=workflow_task&taskId=wo-1&taskType=WORK_ORDER");
  assert.equal(runningTimerPlace({ kind: "PROJECT", projectName: "Laddplatser", taskTitle: "Laddplatser" }), "Projekttid · Laddplatser");
  assert.equal(runningTimerPlace({ kind: "WORK_ORDER", projectName: "Laddplatser", taskTitle: "AO" }), "Arbetsorder · Projekt: Laddplatser");
  assert.equal(runningTimerPlace({ kind: "WORK_ORDER", projectName: null, taskTitle: "AO" }), "Arbetsorder");
});

test("risk step: only on the work order; a task in it follows it and gets no step of its own", () => {
  const order = { id: "wo", title: "Byte av central", status: "IN_PROGRESS" };
  const protocol = { kind: "FORM", status: "IN_PROGRESS", data: { kind: "FORM", details: { templateId: "x" } }, workOrderId: "wo" };
  assert.equal(riskStepExempt({ kind: "FORM", data: {} }), true, "a new task never gets the step");
  assert.equal(riskStepExempt({ kind: "WORK_ORDER", data: {} }), false);
  assert.equal(riskStepApplies(protocol), true, "the gates ask about the work order's step");
  assert.equal(riskStepApplies({ kind: "RISK_ASSESSMENT", data: {}, workOrderId: "wo" }), false, "a risk assessment never has the step");
  const waiting = riskStepState(protocol, { extended: null, workOrder: { ...order, done: false } });
  assert.equal(waiting.done, false);
  assert.match(waiting.hint, /på arbetsordern ”Byte av central”/);
  assert.equal(riskStepState(protocol, { extended: null, workOrder: { ...order, done: true } }).via, "work-order");
  // A task's own (older) answers never stand in for the work order's step.
  const answered = { ...protocol, data: { ...protocol.data, riskStep: true, riskCheck: { level: "simplified", answers: { deenergized: "yes", competence: "yes", height: "yes", others: "yes", special: "yes" }, confirmedBy: "QA", confirmedAt: "2026-10-08T06:00:00.000Z" } } };
  assert.equal(riskStepState(answered, { extended: null, workOrder: { ...order, done: false } }).done, false);
});

test("Local: one running timer per person across work orders and projects; project time is written and kept on the project", async () => {
  const { mock } = await import("node:test");
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-26T06:00:00.000Z") });
  try {
    let workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
    workspace = saveLocalProjectRecord(workspace, { name: "Laddplatser", description: "", startDate: "2026-10-01", dueDate: "2026-12-31", customerId: null }).workspace;
    const projectId = workspace.projects[0].id;
    const made = withLocalWorkOrder(workspace, { title: "AO" });
    workspace = made.workspace;
    const user = "me@example.test";
    workspace = updateLocalWorkflowTimer(workspace, made.workOrderId, "START", user).workspace;
    mock.timers.tick(10 * 60_000);
    const onProject = updateLocalProjectTimer(workspace, projectId, "START", user);
    assert.equal(onProject.stopped.length, 1, "starting project time stops the work order's");
    assert.equal(onProject.stopped[0].taskId, made.workOrderId);
    workspace = onProject.workspace;
    assert.equal(workspace.projects[0].timeEntries.filter((entry) => !entry.endedAt).length, 1);
    mock.timers.tick(10 * 60_000);
    const back = updateLocalWorkflowTimer(workspace, made.workOrderId, "START", user);
    assert.equal(back.workspace.projects[0].timeEntries.every((entry) => entry.endedAt), true, "starting on the work order stops project time");
    assert.equal(back.workspace.timeEntryEvents.some((event) => event.next?.projectId === projectId), true, "the project entry enters the history as project time");
    // Written project time (meetings): on the project, never on a work order.
    const written = saveLocalWorkflowTimeEntry(back.workspace, { projectId, startedAt: "2026-10-25T08:00:00.000Z", endedAt: "2026-10-25T09:00:00.000Z", note: "Byggmöte" }, user);
    assert.equal(written.projects[0].timeEntries.some((entry) => entry.note === "Byggmöte"), true);
    assert.equal(written.workflowTasks.find((task) => task.id === made.workOrderId)!.timeEntries.some((entry) => entry.note === "Byggmöte"), false);
    // Closed projects take no new timer.
    const closed = { ...written, projects: written.projects.map((project) => ({ ...project, closedAt: "2026-10-26T07:00:00.000Z" })) };
    assert.throws(() => updateLocalProjectTimer(closed, projectId, "START", user), /avslutat/);
  } finally { mock.timers.reset(); }
});

test("Local: a work order whose customer changes takes its tasks along; an upgraded file's work order id is stable", () => {
  let workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const now = new Date().toISOString();
  const customer = (name: string) => ({ id: crypto.randomUUID(), name, company: "", email: "", phone: "", mobile: "", address: "", postalCode: "", city: "", notes: "", version: 1, deletedAt: null, createdAt: now, updatedAt: now });
  const a = customer("A"), b = customer("B");
  workspace = { ...workspace, customers: [a, b] };
  const made = withLocalWorkOrder(workspace, { customerId: a.id });
  const task = saveLocalWorkflowTaskRecord(made.workspace, { version: 0, kind: "RISK_ASSESSMENT", title: "Risk", workOrderId: made.workOrderId, data: { kind: "RISK_ASSESSMENT", details: { risks: [], generalMeasures: "", approval: { name: "", confirmed: false, approvedAt: null } } } });
  assert.equal(task.task.customerId, a.id, "the task takes its work order's customer");
  const order = task.workspace.workflowTasks.find((item) => item.id === made.workOrderId)!;
  const moved = saveLocalWorkflowTaskRecord(task.workspace, { ...order, customerId: b.id });
  assert.equal(moved.workspace.workflowTasks.find((item) => item.id === task.task.id)!.customerId, b.id, "and follows when it changes");
  const id = "5f0c7a3e-1b2d-4c5e-8f9a-0b1c2d3e4f50";
  assert.equal(wrapperOrderId(id), wrapperOrderId(id));
  assert.notEqual(wrapperOrderId(id), id);
  assert.match(wrapperOrderId(id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("demo: a task is a draft until it is in a work order, and a work order with a completed protocol is not removed", async () => {
  const { handleDemoRequest, setDemoUser, demoDatabase } = await import("../features/demo/demo-backend");
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await handleDemoRequest(method, new URL(path, "http://localhost"), body === undefined ? null : JSON.stringify(body));
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  };
  setDemoUser("demo-elin");
  const risk = { version: 0, kind: "RISK_ASSESSMENT", title: "Lös risk", data: { kind: "RISK_ASSESSMENT", details: { risks: [], generalMeasures: "", approval: { name: "", confirmed: false, approvedAt: null } } } };
  // Uppgifter får skapas först (2026-10-27): saved as a draft, but the work does not start before it is linked.
  const loose = await call("POST", "/api/workflow-tasks", { action: "save", task: risk });
  assert.equal(loose.status, 200, JSON.stringify(loose.json));
  const started = await call("POST", "/api/workflow-tasks", { action: "timer", id: loose.json.id, command: "START" });
  assert.equal(started.status, 409);
  assert.match(String(started.json.error), /Koppla uppgiften till en arbetsorder/);
  // The demo's completed work order with a completed protocol in it cannot be removed; the preview says why.
  const db = demoDatabase();
  const withDone = db.tasks.find((task) => task.kind === "WORK_ORDER" && db.tasks.some((item) => item.workOrderId === task.id && item.status === "COMPLETED"))!;
  const preview = await call("GET", `/api/workflow-tasks?removalFor=${encodeURIComponent(withDone.id)}`);
  assert.match(String(preview.json.refusal), /kan inte tas bort/);
  assert.equal((await call("DELETE", `/api/workflow-tasks?id=${encodeURIComponent(withDone.id)}`)).status, 409);
  // A new work order with an open task: both go after the confirmation.
  const order = await call("POST", "/api/workflow-tasks", { action: "save", task: { version: 0, kind: "WORK_ORDER", title: "Tillfällig AO", data: { kind: "WORK_ORDER", details: {} } } });
  const inside = await call("POST", "/api/workflow-tasks", { action: "save", task: { ...risk, workOrderId: order.json.id } });
  assert.equal(inside.status, 200, JSON.stringify(inside.json));
  assert.match(String((await call("GET", `/api/workflow-tasks?removalFor=${encodeURIComponent(String(order.json.id))}`)).json.summary), /Lös risk/);
  assert.equal((await call("DELETE", `/api/workflow-tasks?id=${encodeURIComponent(String(order.json.id))}`)).status, 200);
  assert.equal(db.tasks.some((task) => task.id === inside.json.id), false, "the open task went with it");
  // Project time in the demo: written on the project, listed as Projekttid. The demo submits last month (locked); this step
  // writes 2026-10-01, which is "last month" from November on (2026-11-01: red at midnight), so the lock is lifted here.
  db.timePeriods = [];
  const project = db.projects[0];
  const written = await call("POST", "/api/workflow-time", { action: "save", entry: { projectId: project.id, startedAt: "2026-10-01T08:00:00.000Z", endedAt: "2026-10-01T09:00:00.000Z", note: "Möte" }, reason: "" });
  assert.equal(written.status, 200, JSON.stringify(written.json));
  const time = await call("GET", "/api/workflow-time");
  const source = (time.json.tasks as { id: string; kind: string; timeEntries: { note: string }[] }[]).find((item) => item.id === project.id)!;
  assert.equal(source.kind, "PROJECT");
  assert.ok(source.timeEntries.some((entry) => entry.note === "Möte"));
  assert.ok((time.json.tasks as { kind: string }[]).every((item) => item.kind === "WORK_ORDER" || item.kind === "PROJECT"), "the picker offers work orders and projects only");
  const both = await call("POST", "/api/workflow-time", { action: "save", entry: { projectId: project.id, taskId: withDone.id, startedAt: "2026-10-01T10:00:00.000Z", endedAt: "2026-10-01T11:00:00.000Z", note: "" }, reason: "" });
  assert.equal(both.status, 400, "exactly one owner");
});

test("Local: a protocol started from a round lands in the round's work order for the period, never in a new one", async () => {
  const { initialFormValues } = await import("../lib/workflow/form-document");
  const { isolationMeasurementForm } = await import("../lib/workflow/form-examples");
  let workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  workspace = saveLocalFormSchedule(workspace, { title: "Tillsyn", templateId: "form-1", assignedToUserId: null, assignedToName: "", active: true,
    rule: { frequency: "WEEKLY", interval: 1, weekdays: [1], startDate: "2026-09-01", endDate: "" }, reminders: { bell: true, email: false } }, "Tillsyn").workspace;
  const scheduleId = workspace.formSchedules[0].id;
  const values = (occurrence: string) => ({ ...initialFormValues(isolationMeasurementForm), round: { scheduleId, occurrence, scans: [] } });
  const protocol = (occurrence: string) => ({ version: 0, kind: "FORM", title: `Tillsyn ${occurrence}`, data: { kind: "FORM", details: { templateId: "form-1", templateVersion: 1, templateName: "Tillsyn", document: isolationMeasurementForm, values: values(occurrence) } } });
  // Without a work order that holds the round for the day the start is refused; nothing is made by itself.
  assert.throws(() => saveLocalWorkflowTaskRecord(workspace, protocol("2026-10-26")), /ingen arbetsorder för 2026-10-26/);
  assert.equal(workspace.workflowTasks.length, 0);
  const holder = saveLocalWorkflowTaskRecord(workspace, { version: 0, kind: "WORK_ORDER", title: "Tillsyn 2026", roundScheduleId: scheduleId, plannedStartDate: "2026-10-01", dueDate: "2026-12-31",
    data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } } });
  const first = saveLocalWorkflowTaskRecord(holder.workspace, protocol("2026-10-26"));
  assert.equal(first.task.workOrderId, holder.task.id);
  const second = saveLocalWorkflowTaskRecord(first.workspace, protocol("2026-11-02"));
  assert.equal(second.task.workOrderId, holder.task.id, "the next occurrence is registered in the same work order");
  assert.equal(second.workspace.workflowTasks.filter((task) => task.kind === "WORK_ORDER").length, 1);
  assert.throws(() => saveLocalWorkflowTaskRecord(second.workspace, protocol("2027-01-04")), /ingen arbetsorder för 2027-01-04/, "outside the period");
});
