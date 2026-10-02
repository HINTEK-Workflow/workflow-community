import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalWorkspace, reopenLocalWorkflowTask, parseLocalWorkspace } from "../features/kfid/local-workspace-store";
import { saveLocalWorkflowTaskRecord, updateLocalWorkflowTimer } from "./helpers/timer-clock";
import { workflowTaskCompletion, workflowTaskInputSchema, workflowTaskProgress } from "../lib/workflow/task-model";

const workOrder = () => workflowTaskInputSchema.parse({
  version: 0, kind: "WORK_ORDER", title: "Byt central", description: "Demontera och ersätt central", status: "PLANNED",
  data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } },
});

test("work order progression follows actual documentation instead of a fixed step count", () => {
  const planned = workOrder();
  assert.equal(workflowTaskProgress(planned), 0);
  const documented = workflowTaskInputSchema.parse({ ...planned, status: "IN_PROGRESS", assignedToName: "Montör", data: { kind: "WORK_ORDER", details: { ...planned.data.details, executionNotes: "Centralen är bytt", materials: [{ id: crypto.randomUUID(), name: "Central", quantity: "1", unit: "st" }] } } });
  assert.ok(workflowTaskProgress(documented) > workflowTaskProgress(planned));
  assert.ok(workflowTaskProgress(documented) < 100);
});

test("risk assessment progression requires documented risks and protective measures", () => {
  const empty = workflowTaskInputSchema.parse({ version: 0, kind: "RISK_ASSESSMENT", title: "Riskbedömning", data: { kind: "RISK_ASSESSMENT", details: { risks: [], generalMeasures: "", approval: { name: "", confirmed: false, approvedAt: null } } } });
  const protectedRisk = workflowTaskInputSchema.parse({ ...empty, data: { kind: "RISK_ASSESSMENT", details: { risks: [{ id: crypto.randomUUID(), hazard: "Spänningssatt del", likelihood: 3, consequence: 5, protectiveMeasure: "Frånskilj och lås", residualLikelihood: 1, residualConsequence: 5 }], generalMeasures: "Kontrollera spänningslöshet", approval: { name: "Ansvarig", confirmed: true, approvedAt: new Date().toISOString() } } } });
  assert.equal(workflowTaskProgress(empty), 0);
  assert.ok(workflowTaskProgress(protectedRisk) >= 90);
});

test("local workflow tasks retain identity and real time entries", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const saved = saveLocalWorkflowTaskRecord(workspace, workOrder());
  assert.equal(saved.task.status, "PLANNED", "an order text alone is not documented work (2026-10-02)");
  assert.equal(saved.task.progress, 0);
  const started = updateLocalWorkflowTimer(saved.workspace, saved.task.id, "START", "local-user");
  assert.equal(started.task!.status, "IN_PROGRESS");
  assert.equal(started.task!.timeEntries.length, 1);
  const paused = updateLocalWorkflowTimer(started.workspace, saved.task.id, "PAUSE", "local-user");
  assert.equal(paused.task!.status, "PAUSED");
  assert.ok(paused.task!.timeEntries[0].endedAt);
});

test("a description and signature cannot replace documented execution", () => {
  const draft = workOrder();
  if (draft.data.kind !== "WORK_ORDER") throw new Error("fixture");
  draft.data.details.signature = { name: "QA", confirmed: true, signedAt: null };
  draft.data.details.executionNotes = "   ";
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  assert.equal(workflowTaskCompletion(draft).ready, false);
  assert.doesNotThrow(() => saveLocalWorkflowTaskRecord(workspace, draft));
  assert.throws(() => saveLocalWorkflowTaskRecord(workspace, { ...draft, status: "COMPLETED" }), /utförda arbetet/);
  draft.data.details.executionNotes = "Centralen är bytt.";
  assert.equal(workflowTaskProgress(draft), 95);
  assert.equal(workflowTaskCompletion(draft).ready, true);
  const optional = { ...draft, description: "", assignedToName: "", projectId: null, customerId: null };
  assert.equal(workflowTaskProgress(optional), workflowTaskProgress(draft));
  draft.data.details.signature.name = "  ";
  assert.throws(() => saveLocalWorkflowTaskRecord(workspace, { ...draft, status: "COMPLETED" }), /namn/);
});

test("every risk must be documented and have its own measure before completion", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const draft = workflowTaskInputSchema.parse({ kind: "RISK_ASSESSMENT", title: "Risker", data: { kind: "RISK_ASSESSMENT", details: { approval: { name: "QA", confirmed: true } } } });
  if (draft.data.kind !== "RISK_ASSESSMENT") throw new Error("fixture");
  assert.throws(() => saveLocalWorkflowTaskRecord(workspace, { ...draft, status: "COMPLETED" }), /minst en/);
  draft.data.details.risks = [{ id: crypto.randomUUID(), hazard: "", protectiveMeasure: "", likelihood: 1, consequence: 1, residualLikelihood: 1, residualConsequence: 1 }];
  assert.doesNotThrow(() => saveLocalWorkflowTaskRecord(workspace, draft));
  assert.throws(() => saveLocalWorkflowTaskRecord(workspace, { ...draft, status: "COMPLETED" }), /beskriv risken/);
  draft.data.details.risks[0].hazard = "Fall";
  draft.data.details.risks[0].protectiveMeasure = "Fallskydd";
  draft.data.details.risks.push({ ...draft.data.details.risks[0], id: crypto.randomUUID(), protectiveMeasure: "  " });
  draft.data.details.generalMeasures = "Gemensamma åtgärder ersätter inte den saknade åtgärden";
  assert.throws(() => saveLocalWorkflowTaskRecord(workspace, { ...draft, status: "COMPLETED" }), /Risk 2: beskriv skyddsåtgärden/);
  draft.data.details.risks[1].protectiveMeasure = "Avspärrning";
  assert.equal(workflowTaskCompletion(draft).ready, true);
  assert.equal(workflowTaskProgress(draft), 95);
  draft.data.details.risks[1].residualLikelihood = 0;
  assert.equal(workflowTaskCompletion(draft).ready, false);
  assert.equal(workflowTaskInputSchema.safeParse(draft).success, false);
});

test("completion stops timers, stamps approval and reopening requires a new confirmation", () => {
  const draft = workOrder();
  if (draft.data.kind !== "WORK_ORDER") throw new Error("fixture");
  draft.data.details.executionNotes = "Monterat";
  draft.data.details.signature = { name: "QA", confirmed: true, signedAt: "2000-01-01T00:00:00.000Z" };
  const saved = saveLocalWorkflowTaskRecord(createLocalWorkspace({ id: "org-local", name: "Lokala AB" }), draft);
  const started = updateLocalWorkflowTimer(saved.workspace, saved.task.id, "START", "qa");
  const completed = saveLocalWorkflowTaskRecord(started.workspace, { ...started.task, status: "COMPLETED" });
  assert.equal(completed.task.progress, 100);
  assert.ok(completed.task.timeEntries[0].endedAt);
  if (completed.task.data.kind !== "WORK_ORDER") throw new Error("fixture");
  assert.notEqual(completed.task.data.details.signature.signedAt, "2000-01-01T00:00:00.000Z");
  assert.throws(() => saveLocalWorkflowTaskRecord(completed.workspace, { ...completed.task, status: "IN_PROGRESS" }), /Återöppna/);
  const reopened = reopenLocalWorkflowTask(completed.workspace, completed.task.id);
  const task = reopened.workflowTasks[0];
  assert.equal(task.id, completed.task.id);
  assert.equal(task.version, completed.task.version + 1);
  if (task.data.kind !== "WORK_ORDER") throw new Error("fixture");
  assert.equal(task.data.details.signature.confirmed, false);
  assert.equal(task.data.details.signature.signedAt, null);
  assert.deepEqual(parseLocalWorkspace(JSON.parse(JSON.stringify(reopened)), "org-local").workflowTasks[0].completionHistory?.[0].data, completed.task.data);
  assert.deepEqual(saveLocalWorkflowTaskRecord(reopened, task).task.completionHistory, task.completionHistory);
  assert.throws(() => saveLocalWorkflowTaskRecord(reopened, { ...task, status: "COMPLETED" }), /Bekräfta signeringen/);
  assert.equal(completed.task.data.details.signature.confirmed, true, "reopening never mutates the previous snapshot");
});

test("historical completed records remain complete until reopened", () => {
  const legacy = { ...workOrder(), status: "COMPLETED" as const };
  assert.equal(workflowTaskCompletion(legacy).ready, false);
  assert.equal(workflowTaskProgress(legacy), 100);
  assert.ok(workflowTaskProgress({ ...legacy, status: "NEEDS_ACTION" }) < 100);
});
