import assert from "node:assert/strict";
import { test } from "node:test";
import { roundOrderForDay, scheduleOverview, type FormScheduleRule } from "../lib/workflow/form-schedule";
import {
  lateOccurrencesInPeriod, newRoundHolderHref, nextOccurrenceInPeriod, roundHolderChangeError, roundHolderOf, roundHolderSaveError, roundOrderRef, roundOrderSummary,
  roundPeriodEnd, roundPeriodError, roundPeriodOverlapError, roundProtocolOrder, roundStartAction,
} from "../lib/workflow/round-work-orders";
import { emptyRoundSafety, orderRoundSafetyRefusal, roundSafetyRefusal, roundSafetyReportFacts, roundSafetyRequired, roundSafetyState, roundSafetyWorkGate, stampRoundSafety, workOrderRiskUpdatedAt } from "../lib/workflow/round-safety";
import { duplicateRiskAssessmentError } from "../lib/workflow/work-order-link";
import { formDocumentSchema, formValuesSchema } from "../lib/workflow/form-document";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalFormSchedule, saveLocalWorkflowTaskRecord, updateLocalWorkflowTimer } from "../features/kfid/local-workspace-store";
import { withLocalWorkOrder } from "./helpers/work-order";

/**
 * beslut 2026-10-27: a task is a draft until it is linked to a work order; the full risk assessment is the work
 * order's (one per work order); the work order holds a round for a period and every occurrence is registered in it, with
 * a short safety check against the work order's risk assessment. The shared rules, and Local and the demo following them.
 */
const weekly: FormScheduleRule = { frequency: "WEEKLY", interval: 1, weekdays: [1], startDate: "2026-09-01", endDate: "" };
// A round planned before 2026-10-27 (kväll) with its own customer and place stored: only the suggestion for its work order.
const schedule = { id: "s-1", templateId: "form-1", title: "Veckotillsyn", legacyPlace: { customerId: "c-1", facilityId: "f-1", projectId: null, tempPlace: null }, active: true, templateMissing: false, rule: weekly };

test("round period: one day, a month or a year from the start; valid and at most five years", () => {
  assert.equal(roundPeriodEnd("2026-10-26", "day"), "2026-10-26");
  assert.equal(roundPeriodEnd("2026-10-26", "month"), "2026-11-25");
  assert.equal(roundPeriodEnd("2026-10-26", "year"), "2027-10-25");
  assert.equal(roundPeriodEnd("2027-01-31", "month"), "2027-02-27", "a short month ends the day before");
  assert.equal(roundPeriodError({ from: "2026-10-26", to: "2026-10-26" }), null);
  assert.match(roundPeriodError({ from: "2026-10-26", to: "" }) ?? "", /startdatum och slutdatum/);
  assert.match(roundPeriodError({ from: "2026-10-26", to: "2026-10-25" }) ?? "", /före startdatum/);
  assert.equal(roundPeriodError({ from: "2026-10-26", to: "2031-10-25" }), null);
  assert.match(roundPeriodError({ from: "2026-10-26", to: "2031-10-26" }) ?? "", /högst 5 år/);
});

test("round work orders: a holder for a period or 0.24.0's for a day; the right one for each day, never two", () => {
  const holder = roundOrderRef({ id: "wo-h", status: "IN_PROGRESS", title: "Veckotillsyn 2026", roundScheduleId: "s-1", roundOccurrence: null, plannedStartDate: "2026-10-01", dueDate: "2026-12-31" })!;
  const legacy = roundOrderRef({ id: "wo-19", status: "COMPLETED", roundScheduleId: "s-1", roundOccurrence: "2026-10-19" })!;
  assert.deepEqual(roundHolderOf({ roundScheduleId: "s-1", roundOccurrence: null, plannedStartDate: "2026-10-01", dueDate: "2026-12-31" }), { scheduleId: "s-1", from: "2026-10-01", to: "2026-12-31" });
  assert.equal(roundHolderOf({ roundScheduleId: "s-1", roundOccurrence: "2026-10-19" }), null, "0.24.0's per day is no holder");
  assert.equal(roundOrderRef({ id: "x", status: "PLANNED", roundScheduleId: null }), null);
  assert.equal(roundOrderForDay([holder, legacy], "s-1", "2026-10-19")?.id, "wo-19", "0.24.0's work order keeps its day");
  assert.equal(roundOrderForDay([holder, legacy], "s-1", "2026-10-26")?.id, "wo-h");
  assert.equal(roundOrderForDay([holder], "s-1", "2027-01-04"), null, "outside the period");
  assert.equal(roundOrderForDay([{ ...holder, status: "CANCELLED" }], "s-1", "2026-10-26"), null, "a cancelled one holds nothing");
  assert.equal(roundOrderForDay([holder], "s-2", "2026-10-26"), null, "only its own round");
  // Overlap and changes.
  assert.match(roundPeriodOverlapError({ from: "2026-12-01", to: "2027-03-31" }, [holder]) ?? "", /Perioderna får inte gå omlott/);
  assert.equal(roundPeriodOverlapError({ from: "2027-01-01", to: "2027-03-31" }, [holder]), null);
  assert.equal(roundPeriodOverlapError({ from: "2026-12-01", to: "2027-03-31" }, [{ ...holder, status: "CANCELLED" }]), null);
  assert.equal(roundPeriodOverlapError({ from: "2026-10-19", to: "2026-10-19" }, [legacy]), null, "0.24.0's per day is not a period");
  assert.equal(roundHolderChangeError({ scheduleId: "s-1" }, { scheduleId: "s-2", from: "2026-10-01", to: "2026-12-31" }, []), null, "free while nothing is registered");
  assert.match(roundHolderChangeError({ scheduleId: "s-1" }, { scheduleId: "s-2", from: "2026-10-01", to: "2026-12-31" }, ["2026-10-26"]) ?? "", /kan inte bytas/);
  assert.match(roundHolderChangeError({ scheduleId: "s-1" }, { scheduleId: "s-1", from: "2026-11-01", to: "2026-12-31" }, ["2026-10-26"]) ?? "", /omfatta rondtillfällena/);
  assert.equal(roundHolderSaveError({ roundScheduleId: "s-1", from: "2027-01-01", to: "2027-12-31", status: "PLANNED" }, null, { scheduleExists: true, others: [holder], occurrences: [] }), null);
  assert.match(roundHolderSaveError({ roundScheduleId: "s-1", from: "2026-12-01", to: "2027-12-31", status: "PLANNED" }, null, { scheduleExists: true, others: [holder], occurrences: [] }) ?? "", /omlott/);
  assert.match(roundHolderSaveError({ roundScheduleId: "s-1", from: "2027-01-01", to: "2027-12-31", status: "PLANNED" }, null, { scheduleExists: false, others: [], occurrences: [] }) ?? "", /hittades inte/);
  assert.match(roundHolderSaveError({ roundScheduleId: null, from: "", to: "", status: "PLANNED" }, { roundScheduleId: "s-1", roundOccurrence: "2026-10-19" }, { scheduleExists: true, others: [], occurrences: [] }) ?? "", /kan inte byta rond/);
});

test("starting a round: the occurrence goes into the work order that holds it; without one, it is made first – never by itself", () => {
  const holder = roundOrderRef({ id: "wo-h", status: "IN_PROGRESS", roundScheduleId: "s-1", roundOccurrence: null, plannedStartDate: "2026-10-01", dueDate: "2026-12-31" })!;
  assert.deepEqual(roundProtocolOrder({ scheduleId: "s-1", occurrence: "2026-10-26" }, null, [holder]), { id: "wo-h" });
  assert.deepEqual(roundProtocolOrder({ scheduleId: "s-1", occurrence: "2026-10-26" }, "wo-h", [holder]), { id: "wo-h" });
  assert.match(roundProtocolOrder({ scheduleId: "s-1", occurrence: "2027-01-04" }, "wo-h", [holder]).error ?? "", /omfattar inte 2027-01-04/);
  assert.match(roundProtocolOrder({ scheduleId: "s-1", occurrence: "2027-01-04" }, null, [holder]).error ?? "", /ingen arbetsorder för 2027-01-04/);
  assert.match(roundProtocolOrder({ scheduleId: "s-1", occurrence: "2026-10-26" }, "wo-other", [holder]).error ?? "", /håller inte den här ronden/);
  // Driftronder: today's occurrence with the holder starts it; without a holder it offers to make one for a year.
  const overview = scheduleOverview(weekly, [], "2026-10-26", {}, [holder]);
  assert.equal(overview.today?.workOrderId, "wo-h");
  assert.equal(overview.history.find((item) => item.date === "2026-10-19")?.state, "missed", "a holder closes no day by itself");
  const start = roundStartAction({ ...schedule, overview });
  assert.equal(start?.kind, "start");
  assert.equal(new URL(start!.href, "http://x").searchParams.get("workOrderId"), "wo-h");
  const create = roundStartAction({ ...schedule, overview: scheduleOverview(weekly, [], "2026-10-26") });
  assert.equal(create?.kind, "create");
  assert.equal(create?.label, "Skapa arbetsorder för ronden");
  const href = new URL(create!.href, "http://x");
  assert.deepEqual([href.searchParams.get("taskType"), href.searchParams.get("roundScheduleId"), href.searchParams.get("roundFrom"), href.searchParams.get("roundTo"), href.searchParams.get("customerId"), href.searchParams.get("facilityId")], ["WORK_ORDER", "s-1", "2026-10-26", "2027-10-25", "c-1", "f-1"], "an older round suggests the customer and place it stored");
  const fresh = new URL(newRoundHolderHref({ id: "s-2" }, "2026-10-26"), "http://x");
  assert.equal(fresh.searchParams.has("customerId") || fresh.searchParams.has("facilityId") || fresh.searchParams.has("projectId"), false, "a new round suggests nothing: the work order chooses its customer and place");
  assert.equal(new URL(newRoundHolderHref(schedule, "2026-10-26", "day"), "http://x").searchParams.get("roundTo"), "2026-10-26");
  assert.equal(roundStartAction({ ...schedule, active: false, overview }), null, "a paused round");
});

test("the round on its work order: period, Starta ronden for today or the latest late day, and the late ones", () => {
  const order = { id: "wo-h", status: "IN_PROGRESS", roundScheduleId: "s-1", roundOccurrence: null, plannedStartDate: "2026-10-01", dueDate: "2026-12-31" };
  assert.deepEqual(lateOccurrencesInPeriod(weekly, { from: "2026-10-01", to: "2026-12-31" }, new Set(["2026-10-12"]), "2026-10-26"), ["2026-10-19", "2026-10-05"]);
  assert.equal(nextOccurrenceInPeriod(weekly, { from: "2026-10-01", to: "2026-12-31" }, new Set(["2026-10-26"]), "2026-10-26"), "2026-11-02");
  const today = roundOrderSummary(order, schedule, new Set(), "2026-10-26")!;
  assert.equal(today.occurrence, "2026-10-26");
  assert.deepEqual(today.period, { from: "2026-10-01", to: "2026-12-31" });
  assert.deepEqual(today.late.map((item) => item.date), ["2026-10-19", "2026-10-12", "2026-10-05"]);
  assert.ok(today.late.every((item) => item.href?.includes("workOrderId=wo-h")));
  assert.equal(new URL(today.href!, "http://x").searchParams.get("occurrence"), "2026-10-26");
  assert.equal(roundOrderSummary(order, schedule, new Set(["2026-10-26"]), "2026-10-26")!.occurrence, "2026-10-19", "then the latest late one");
  assert.equal(roundOrderSummary({ ...order, status: "COMPLETED" }, schedule, new Set(), "2026-10-26")!.href, null, "a closed work order starts nothing");
  assert.match(roundOrderSummary(order, null, new Set(), "2026-10-26")!.notice ?? "", /finns inte längre/);
  assert.equal(roundOrderSummary({ ...order, roundScheduleId: null }, schedule, new Set(), "2026-10-26"), null);
  const legacy = roundOrderSummary({ id: "wo-19", status: "PLANNED", roundScheduleId: "s-1", roundOccurrence: "2026-10-19" }, schedule, new Set(), "2026-10-26")!;
  assert.equal(legacy.occurrence, "2026-10-19", "0.24.0's work order starts its own day");
  assert.deepEqual(legacy.late, []);
});

test("safety check: three questions against the work order's risk assessment, stamped by the boundary, holding the work until done", () => {
  const task = (roundSafety?: unknown) => ({ kind: "FORM", status: "PLANNED", data: { kind: "FORM", roundSafetyStep: true, ...(roundSafety ? { roundSafety } : {}) } });
  assert.equal(roundSafetyRequired({ kind: "FORM", data: { kind: "FORM" } }), false, "older protocols are never locked");
  assert.equal(roundSafetyRequired(task()), true);
  const risk = { workOrderId: "wo-h", title: "Veckotillsyn", updatedAt: "2026-10-01T08:00:00.000Z" };
  const open = roundSafetyState(task(), risk);
  assert.equal(open.done, false);
  assert.deepEqual(open.unanswered, ["stillValid", "changed", "newRisks"]);
  assert.match(roundSafetyRefusal(open, "start") ?? "", /säkerhetsavstämningen innan du startar tiden/);
  const safe = { ...emptyRoundSafety(), answers: { stillValid: "yes", changed: "no", newRisks: "no" }, confirmedAt: "2026-10-26T07:00:00.000Z", confirmedBy: "Elon" };
  assert.equal(roundSafetyState(task(safe), risk).done, true);
  assert.equal(roundSafetyState(task({ ...safe, confirmedAt: null }), risk).hint, "Bekräfta säkerhetsavstämningen.");
  const changed = { ...safe, answers: { stillValid: "no", changed: "no", newRisks: "no" } };
  const waiting = roundSafetyState(task(changed), risk);
  assert.equal(waiting.changed, true);
  assert.equal(waiting.done, false);
  assert.match(waiting.hint, /Uppdatera riskbedömningen i arbetsordern ”Veckotillsyn”/);
  assert.equal(roundSafetyState(task(changed), { ...risk, updatedAt: "2026-10-26T07:30:00.000Z" }).done, true, "done once the risk assessment is updated after the check");
  assert.equal(roundSafetyState({ ...task(changed), status: "COMPLETED" }, risk).done, true, "a completed occurrence is never locked again");
  // When the work order's risk assessment was last made good: the simplified step's confirmation, or the extended one completed.
  assert.equal(workOrderRiskUpdatedAt({ data: { riskCheck: { level: "simplified", answers: {}, confirmedBy: "A", confirmedAt: "2026-10-02T08:00:00.000Z" } } }, { status: "COMPLETED", completedAt: "2026-10-05T08:00:00.000Z" }), "2026-10-05T08:00:00.000Z");
  assert.equal(workOrderRiskUpdatedAt({ data: {} }, { status: "IN_PROGRESS", completedAt: null }), null);
  // The boundary: the flag on a new protocol in a round's work order; who, when and against what – never from the client.
  const created = stampRoundSafety({ kind: "FORM" } as Record<string, unknown>, { created: true, stored: null, inRoundOrder: true, actor: { id: "u-1", name: "Elon" }, now: "2026-10-26T07:00:00.000Z", risk: null });
  assert.equal(created.roundSafetyStep, true);
  assert.equal(stampRoundSafety({ kind: "FORM" } as Record<string, unknown>, { created: true, stored: null, inRoundOrder: false, actor: { id: "u-1", name: "Elon" }, now: "x", risk: null }).roundSafetyStep, undefined);
  const sent = { kind: "FORM", roundSafety: { ...safe, confirmedBy: "Någon annan" } } as Record<string, unknown>;
  const stamped = stampRoundSafety(sent, { created: false, stored: { roundSafetyStep: true }, inRoundOrder: true, actor: { id: "u-1", name: "Elon" }, now: "2026-10-26T07:05:00.000Z", risk: { workOrderId: "wo-h", riskConfirmedAt: "2026-10-01T08:00:00.000Z", extendedTaskId: null } });
  assert.deepEqual([(stamped.roundSafety as { confirmedBy: string }).confirmedBy, (stamped.roundSafety as { confirmedAt: string }).confirmedAt, (stamped.roundSafety as { riskRef: { workOrderId: string } }).riskRef.workOrderId], ["Elon", "2026-10-26T07:05:00.000Z", "wo-h"]);
  const kept = stampRoundSafety({ kind: "FORM" } as Record<string, unknown>, { created: false, stored: { roundSafetyStep: true, roundSafety: stamped.roundSafety }, inRoundOrder: true, actor: { id: "u-2", name: "B" }, now: "later", risk: null });
  assert.deepEqual(kept.roundSafety, stamped.roundSafety, "a save without the check keeps the stored one");
  assert.deepEqual(roundSafetyReportFacts(stamped)?.rows.map((row) => row.value), ["Ja", "Nej", "Nej"]);
});

test("one risk assessment per work order", () => {
  assert.equal(duplicateRiskAssessmentError([]), null);
  assert.equal(duplicateRiskAssessmentError([{ title: "Gammal", status: "CANCELLED" }]), null, "a cancelled one does not count");
  assert.match(duplicateRiskAssessmentError([{ title: "Riskbedömning: Byte", status: "PLANNED" }]) ?? "", /redan en riskbedömning \(”Riskbedömning: Byte”\)/);
});

test("Local (schema 13): a draft is saved and kept in the file, linked later; its time waits; the round's work order holds the period", async () => {
  const { initialFormValues } = await import("../lib/workflow/form-document");
  const { isolationMeasurementForm } = await import("../lib/workflow/form-examples");
  let workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  assert.equal(workspace.schemaVersion, 13);
  const risk = { version: 0, kind: "RISK_ASSESSMENT", title: "Utkast", data: { kind: "RISK_ASSESSMENT", details: { risks: [], generalMeasures: "", approval: { name: "", confirmed: false, approvedAt: null } } } };
  const draft = saveLocalWorkflowTaskRecord(workspace, risk);
  assert.equal(draft.task.workOrderId ?? null, null);
  assert.throws(() => updateLocalWorkflowTimer(draft.workspace, draft.task.id, "START", "me"), /Koppla uppgiften till en arbetsorder/);
  assert.throws(() => saveLocalWorkflowTaskRecord(draft.workspace, { ...draft.task, status: "NEEDS_ACTION" }), /Koppla uppgiften till en arbetsorder/, "no other status before it is linked");
  const reread = parseLocalWorkspace(JSON.parse(JSON.stringify(draft.workspace)), "org-local");
  assert.equal(reread.workflowTasks.length, 1, "the draft is kept in the file");
  const made = withLocalWorkOrder(draft.workspace, { title: "AO" });
  const linked = saveLocalWorkflowTaskRecord(made.workspace, { ...made.workspace.workflowTasks.find((task) => task.id === draft.task.id)!, workOrderId: made.workOrderId });
  assert.equal(linked.task.workOrderId, made.workOrderId);
  const timed = updateLocalWorkflowTimer(linked.workspace, draft.task.id, "START", "me");
  const entry = timed.workspace.workflowTasks.find((task) => task.id === made.workOrderId)!.timeEntries[0];
  assert.equal(entry.sourceTaskId, draft.task.id, "the time on the work order remembers the task it was started in");
  assert.throws(() => saveLocalWorkflowTaskRecord(linked.workspace, { ...linked.task, workOrderId: null }), /inte tas ur den/);
  // A second risk assessment in the same work order is refused.
  assert.throws(() => saveLocalWorkflowTaskRecord(linked.workspace, { ...risk, title: "Till", workOrderId: made.workOrderId }), /redan en riskbedömning/);
  // The round's work order for a period: overlap refused, and the occurrence's safety check holds Färdigställ.
  workspace = saveLocalFormSchedule(linked.workspace, { title: "Tillsyn", templateId: "form-1", assignedToUserId: null, assignedToName: "", active: true, rule: weekly, reminders: { bell: true, email: false } }, "Tillsyn").workspace;
  const scheduleId = workspace.formSchedules[0].id;
  const orderData = { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } };
  const holder = saveLocalWorkflowTaskRecord(workspace, { version: 0, kind: "WORK_ORDER", title: "Tillsyn 2026", roundScheduleId: scheduleId, plannedStartDate: "2026-10-01", dueDate: "2026-12-31", data: orderData });
  assert.equal(holder.task.roundScheduleId, scheduleId);
  assert.throws(() => saveLocalWorkflowTaskRecord(holder.workspace, { version: 0, kind: "WORK_ORDER", title: "Krock", roundScheduleId: scheduleId, plannedStartDate: "2026-12-01", dueDate: "2027-03-31", data: orderData }), /omlott/);
  const values = { ...initialFormValues(isolationMeasurementForm), round: { scheduleId, occurrence: "2026-10-26", scans: [] } };
  const protocol = saveLocalWorkflowTaskRecord(holder.workspace, { version: 0, kind: "FORM", title: "Tillsyn 2026-10-26", data: { kind: "FORM", details: { templateId: "form-1", templateVersion: 1, templateName: "Tillsyn", document: isolationMeasurementForm, values } } });
  assert.equal(protocol.task.workOrderId, holder.task.id);
  assert.equal((protocol.task.data as { roundSafetyStep?: boolean }).roundSafetyStep, true, "the occurrence has its safety check");
  assert.throws(() => updateLocalWorkflowTimer(protocol.workspace, protocol.task.id, "START", "me"), /riskbedömningen|säkerhetsavstämningen/i, "the work order's risk step, then the safety check");
  // In the file too: filling in waits for the check, and a new protocol is Planerad whatever it was sent as.
  const details = { templateId: "form-1", templateVersion: 1, templateName: "Tillsyn", document: isolationMeasurementForm };
  assert.throws(() => saveLocalWorkflowTaskRecord(protocol.workspace, { id: protocol.task.id, version: protocol.task.version, kind: "FORM", title: "Tillsyn 2026-10-26", workOrderId: holder.task.id, data: { kind: "FORM", details: { ...details, values: { ...values, deviationComment: "Läcker" } } } }), /innan du fyller i/);
  assert.equal(saveLocalWorkflowTaskRecord(holder.workspace, { version: 0, kind: "FORM", title: "Tillsyn annan dag", status: "IN_PROGRESS", data: { kind: "FORM", details: { ...details, values } } }).task.status, "PLANNED");
  // Schema 12 (0.24.0) reads as it is and is written as 13.
  const v12 = JSON.parse(JSON.stringify(protocol.workspace));
  v12.schemaVersion = 12;
  for (const task of v12.workflowTasks) for (const entry of task.timeEntries) delete entry.sourceTaskId;
  v12.workflowTasks = v12.workflowTasks.filter((task: { workOrderId?: string | null; kind: string }) => task.kind === "WORK_ORDER" || task.workOrderId);
  assert.equal(parseLocalWorkspace(v12, "org-local").schemaVersion, 13);
});

test("demo: a draft is linked later; the standby round is held by one work order for its period with the safety check", async () => {
  const { handleDemoRequest, setDemoUser, demoDatabase } = await import("../features/demo/demo-backend");
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await handleDemoRequest(method, new URL(path, "http://localhost"), body === undefined ? null : JSON.stringify(body));
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  };
  setDemoUser("demo-elna");
  const db = demoDatabase();
  const holder = db.tasks.find((task) => task.id === "demo-task-rond-reservkraft-ar")!;
  assert.equal(holder.roundScheduleId, "demo-schedule-reservkraft");
  assert.equal(holder.roundOccurrence ?? null, null, "a holder, not a work order per day");
  assert.equal(db.tasks.filter((task) => task.kind === "WORK_ORDER" && task.roundScheduleId === "demo-schedule-reservkraft").length, 1);
  const rounds = await call("GET", "/api/form-schedules");
  assert.equal(rounds.status, 200);
  assert.equal(db.tasks.filter((task) => task.kind === "WORK_ORDER" && task.roundScheduleId).length, 1, "reading Driftronder makes no work order");
  const summary = await call("GET", `/api/form-schedules?roundOrder=${encodeURIComponent(holder.id)}`);
  const round = summary.json.round as { round: { title: string }; period: { from: string; to: string } };
  assert.equal(round.round.title, "Veckotillsyn reservkraft");
  assert.deepEqual(round.period, { from: holder.plannedStartDate, to: holder.dueDate });
  const draft = await call("POST", "/api/workflow-tasks", { action: "save", task: { version: 0, kind: "RISK_ASSESSMENT", title: "Utkast i demon", data: { kind: "RISK_ASSESSMENT", details: { risks: [], generalMeasures: "", approval: { name: "", confirmed: false, approvedAt: null } } } } });
  assert.equal(draft.status, 200, JSON.stringify(draft.json));
  const saved = db.tasks.find((task) => task.id === draft.json.id)!;
  const order = await call("POST", "/api/workflow-tasks", { action: "save", task: { version: 0, kind: "WORK_ORDER", title: "AO för utkastet", data: { kind: "WORK_ORDER", details: {}, riskCheck: { level: "simplified", answers: { deenergized: "yes", competence: "yes", height: "yes", others: "yes", special: "yes" }, confirmedBy: "QA", confirmedAt: "2026-10-01T08:00:00.000Z" } } } });
  const link = await call("POST", "/api/workflow-tasks", { action: "save", task: { ...saved, workOrderId: order.json.id } });
  assert.equal(link.status, 200, JSON.stringify(link.json));
  const timer = await call("POST", "/api/workflow-tasks", { action: "timer", id: saved.id, command: "START" });
  assert.equal(timer.status, 200, JSON.stringify(timer.json));
  assert.ok(db.timeEntries.some((entry) => entry.taskId === order.json.id && entry.sourceTaskId === saved.id), "time on the work order remembers the task");
  await call("POST", "/api/workflow-tasks", { action: "timer", id: saved.id, command: "PAUSE", keepShort: true });
});

test("säkerhetsavstämningen comes before the work: filling in and scanning wait, saving the check never does", () => {
  const risk = { workOrderId: "wo-h", title: "Rondorder", updatedAt: null };
  const document = formDocumentSchema.parse({ schema: 2, blocks: [
    { id: "s1", type: "section", title: "Först", blocks: [{ id: "f-a", type: "field", key: "a", label: "a", input: "text" }] },
    { id: "s2", type: "section", title: "Sedan", blocks: [{ id: "f-b", type: "field", key: "b", label: "b", input: "text" }, { id: "sig", type: "signature", key: "sig", label: "Signatur" }] },
  ] });
  const protocol = (values: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ kind: "FORM", data: { kind: "FORM", roundSafetyStep: true, ...extra, details: { document, values: formValuesSchema.parse({ round: { scheduleId: "s", occurrence: "2026-11-02", scans: [] }, ...values }) } } });
  const scan = { placeId: "p", place: "Pump", point: "", at: "2026-11-02T07:00:00.000Z", by: "" };
  const round = { round: { scheduleId: "s", occurrence: "2026-11-02", scans: [scan] } };
  const stored = (values: Record<string, unknown> = {}, status = "PLANNED") => ({ status, data: protocol(values).data });
  const fill = /säkerhetsavstämningen innan du fyller i/;
  // The check itself is saved, and the protocol stays Planerad.
  assert.deepEqual(roundSafetyWorkGate(protocol(), risk, { chosen: "PLANNED", documented: false, stored: stored() }), { status: "PLANNED", refusal: null });
  // The first value, every later value and a signature are the work going on, whichever client sends them.
  assert.match(roundSafetyWorkGate(protocol({ fields: { b: "1" } }), risk, { chosen: "PLANNED", documented: true, stored: stored() }).refusal ?? "", fill);
  assert.match(roundSafetyWorkGate(protocol({ fields: { a: "1", b: "2" } }), risk, { chosen: "PLANNED", documented: true, stored: stored({ fields: { a: "1" } }) }).refusal ?? "", fill, "a saved first section does not open the rest");
  assert.match(roundSafetyWorkGate(protocol({ fields: { a: "1" }, signatures: { sig: { name: "Kim", confirmed: true } } }), risk, { chosen: "PLANNED", documented: true, stored: stored({ fields: { a: "1" } }) }).refusal ?? "", fill);
  // So is a scan, which is not documentation.
  assert.match(roundSafetyWorkGate(protocol(round), risk, { chosen: "PLANNED", documented: false, stored: stored() }).refusal ?? "", /säkerhetsavstämningen/);
  // What the protocol already holds passes with the check, also when the database gave the keys in another order; a signature's time is the server's.
  const held = { fields: { a: "1" }, signatures: { sig: { name: "Kim", confirmed: false, signedAt: null } } };
  const reordered = { ...protocol(held).data, details: { ...protocol(held).data.details, values: JSON.parse(JSON.stringify(protocol(held).data.details.values, (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value)) } };
  assert.deepEqual(roundSafetyWorkGate(protocol(held), risk, { chosen: "PLANNED", documented: true, stored: { status: "PLANNED", data: reordered } }), { status: "PLANNED", refusal: null });
  // The answers, with the risk assessment still to update, are saved over a stored scan and stored values: the check can always be finished.
  const answered = { roundSafety: { ...emptyRoundSafety(), answers: { stillValid: "yes", changed: "yes", newRisks: "no" }, confirmedAt: "2026-11-02T07:01:00.000Z" } };
  assert.deepEqual(roundSafetyWorkGate(protocol({ ...round, ...held }, answered), risk, { chosen: "PLANNED", documented: true, stored: { status: "PLANNED", data: protocol({ ...round, ...held }).data } }), { status: "PLANNED", refusal: null });
  // A new protocol: its first screen is let through as Planerad, whatever status it was sent with, but nothing more.
  assert.deepEqual(roundSafetyWorkGate(protocol({ fields: { a: "1" } }), risk, { chosen: "PLANNED", documented: true, stored: null }), { status: "PLANNED", refusal: null });
  assert.deepEqual(roundSafetyWorkGate(protocol({ fields: { a: "1" } }), risk, { chosen: "IN_PROGRESS", documented: true, stored: null }), { status: "PLANNED", refusal: null });
  assert.match(roundSafetyWorkGate(protocol({ fields: { a: "1", b: "2" } }), risk, { chosen: "IN_PROGRESS", documented: true, stored: null }).refusal ?? "", fill, "not the rest of the protocol");
  assert.match(roundSafetyWorkGate(protocol({ signatures: { sig: { name: "Kim", confirmed: true } } }), risk, { chosen: "PLANNED", documented: true, stored: null }).refusal ?? "", fill);
  assert.match(roundSafetyWorkGate(protocol(round), risk, { chosen: "PLANNED", documented: false, stored: null }).refusal ?? "", /säkerhetsavstämningen/);
  // With the check done everything is as usual.
  const done = { roundSafety: { ...emptyRoundSafety(), answers: { stillValid: "yes", changed: "no", newRisks: "no" }, confirmedAt: "2026-10-26T07:00:00.000Z" } };
  assert.deepEqual(roundSafetyWorkGate(protocol({ ...round, fields: { b: "1" } }, done), risk, { chosen: "PLANNED", documented: true, stored: stored() }), { status: "IN_PROGRESS", refusal: null });
  // Older protocols are never locked, and neither is what cannot be read.
  assert.deepEqual(roundSafetyWorkGate({ kind: "FORM", data: { kind: "FORM" } }, null, { chosen: "PLANNED", documented: true, stored: stored() }), { status: "IN_PROGRESS", refusal: null });
  assert.deepEqual(roundSafetyWorkGate(protocol({ fields: { a: "1" } }), risk, { chosen: "PLANNED", documented: true, stored: { status: "PLANNED", data: { kind: "FORM" } } }), { status: "PLANNED", refusal: null });
});

test("Starta tid on a round's work order waits for its open occurrences' checks", () => {
  const risk = { workOrderId: "wo-h", title: "Rondorder", updatedAt: null };
  const occurrence = (title: string, status: string, done: boolean) => ({ kind: "FORM", title, status, data: { kind: "FORM", roundSafetyStep: true, ...(done ? { roundSafety: { ...emptyRoundSafety(), answers: { stillValid: "yes", changed: "no", newRisks: "no" }, confirmedAt: "2026-10-26T07:00:00.000Z" } } : {}) } });
  assert.equal(orderRoundSafetyRefusal([], risk), null, "no occurrence: the order's own risk step decides");
  assert.equal(orderRoundSafetyRefusal([occurrence("Klar", "PLANNED", true), occurrence("Avslutad", "COMPLETED", false), occurrence("Utgått", "CANCELLED", false)], risk), null);
  assert.match(orderRoundSafetyRefusal([occurrence("Klar", "PLANNED", true), occurrence("Tillsyn idag", "PLANNED", false)], risk) ?? "", /på ”Tillsyn idag” innan du startar tiden/);
});
