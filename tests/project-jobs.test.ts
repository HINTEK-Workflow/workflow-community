import assert from "node:assert/strict";
import test from "node:test";
import { groupProjectJobs, jobStepOf, jobStepOfFlow, JOB_STEP_LABELS } from "../lib/workflow/project-jobs";
import { nextStepLine } from "../lib/workflow/next-step";
import { formFlow, workOrderFlow } from "../lib/workflow/task-flow";
import { workflowTaskDataSchema } from "../lib/workflow/task-model";

const task = (id: string, kind: string, status = "PLANNED", workOrderId: string | null = null) => ({ id, kind, status, workOrderId });

test("project jobs: a work order's tasks are nested under it, the rest stand alone, open jobs first", () => {
  const tasks = [
    task("p1", "FORM", "PLANNED", "wo1"),
    task("wo1", "WORK_ORDER"),
    task("r1", "RISK_ASSESSMENT", "COMPLETED", "wo1"),
    task("wo2", "WORK_ORDER", "COMPLETED"),
    task("p2", "FORM"),
    task("p3", "FORM", "COMPLETED"),
    task("wo3", "WORK_ORDER", "IN_PROGRESS"),
    // Its work order is not among the project's readable tasks: it stands alone instead of being hidden.
    task("p4", "FORM", "PLANNED", "elsewhere"),
  ];
  const { workOrders, standalone } = groupProjectJobs(tasks);
  assert.deepEqual(workOrders.map((group) => group.order.id), ["wo1", "wo3", "wo2"]);
  assert.deepEqual(workOrders[0].linked.map((item) => item.id), ["p1", "r1"]);
  assert.deepEqual(workOrders[1].linked, []);
  assert.deepEqual(standalone.map((item) => item.id), ["p2", "p4", "p3"]);
  // Every task appears exactly once.
  assert.equal(workOrders.reduce((sum, group) => sum + 1 + group.linked.length, 0) + standalone.length, tasks.length);
  assert.deepEqual(groupProjectJobs([]), { workOrders: [], standalone: [] });
});

test("a job's step is read from the same progress line as the task page", () => {
  const order = { saved: true, title: "Byt armatur", status: "PLANNED", assigned: false, dueDate: "", timerRunning: false, totalDurationSec: 0, executionNotes: "", signatureName: "", signatureConfirmed: false };
  assert.deepEqual(jobStepOfFlow(workOrderFlow({ ...order, saved: false, title: "" })), { key: "order", label: "Beställning" });
  assert.equal(jobStepOfFlow(workOrderFlow({ ...order, riskStep: { met: false, hint: "Svara" } })).label, "Riskbedömning");
  assert.equal(jobStepOfFlow(workOrderFlow({ ...order, riskStep: { met: true, hint: "" } })).label, "Utförande");
  assert.equal(jobStepOfFlow(workOrderFlow({ ...order, executionNotes: "Bytt" })).label, "Signering");
  assert.equal(jobStepOfFlow(workOrderFlow({ ...order, executionNotes: "Bytt", signatureName: "Elin", signatureConfirmed: true })).key, "complete");
  assert.deepEqual(jobStepOfFlow(workOrderFlow({ ...order, status: "COMPLETED" })), { key: "done", label: "Färdigställd" });
  assert.equal(jobStepOfFlow(formFlow({ saved: true, title: "Rond", status: "PLANNED", issues: [{ field: "form-a", message: "Fyll i." }], signatureBlocks: [] })).label, "Utförande");
  assert.equal(JOB_STEP_LABELS.complete, "Klar att färdigställa");
});

test("jobStepOf reads a stored work order's data and its risk step", () => {
  const data = workflowTaskDataSchema.parse({ kind: "WORK_ORDER", details: { executionNotes: "", signature: { name: "", confirmed: false, signedAt: null } } });
  assert.equal(jobStepOf({ title: "Byt armatur", status: "PLANNED", data }, false).label, "Riskbedömning");
  assert.equal(jobStepOf({ title: "Byt armatur", status: "PLANNED", data }, true).label, "Utförande");
  // No risk step (older job): the line goes straight to the work.
  assert.equal(jobStepOf({ title: "Byt armatur", status: "PLANNED", data }, null).label, "Utförande");
  assert.equal(jobStepOf({ title: "Byt armatur", status: "COMPLETED", data }, false).label, "Färdigställd");
});

test("Varför kan jag inte gå vidare? always names the next thing, in Färdigställ's own order", () => {
  const order = { saved: true, title: "Byt armatur", status: "PLANNED", assigned: false, dueDate: "", timerRunning: false, totalDurationSec: 0, executionNotes: "", signatureName: "", signatureConfirmed: false };
  // The current step on the line, with its hint and where it is done.
  const work = nextStepLine({ flow: workOrderFlow(order), issues: [{ field: "task-execution", message: "Beskriv det utförda arbetet." }] });
  assert.equal(work?.step, "Utförande");
  assert.equal(work?.target, "task-execution");
  assert.equal(work?.kind, "focus");
  // The risk step: the refusal the server gives, and the page leads to the risk step.
  const refusal = "Gör riskbedömningen innan du färdigställer uppgiften. Svara på frågorna i riskbedömningen och bekräfta.";
  const risk = nextStepLine({ flow: workOrderFlow({ ...order, riskStep: { met: false, hint: "Svara på frågorna i riskbedömningen och bekräfta." } }), riskRefusal: refusal });
  assert.deepEqual(risk, { step: "Riskbedömning", key: "risk", text: refusal, target: "task-risk-step", kind: "risk" });
  // Every step met: what Färdigställ would still refuse – first a requirement, then the risk step – else Färdigställ.
  const ready = workOrderFlow({ ...order, executionNotes: "Bytt", signatureName: "Elin", signatureConfirmed: true });
  assert.equal(nextStepLine({ flow: ready, issues: [{ field: "form-x", message: "Fyll i X." }, { field: "form-y", message: "Fyll i Y." }] })?.text, "Fyll i X. (och 1 till)");
  assert.equal(nextStepLine({ flow: ready, riskRefusal: refusal })?.kind, "risk");
  assert.deepEqual(nextStepLine({ flow: ready }), { step: "Färdigställd", key: "complete", text: "Allt som krävs är klart. Tryck Färdigställ.", target: "task-complete", kind: "complete" });
  // A block on the work (level/role) comes first; a completed job has no next step.
  assert.deepEqual(nextStepLine({ flow: workOrderFlow(order), blocked: "Du har inte behörighet att utföra arbetet." }), { step: "Utförande", key: "work", text: "Du har inte behörighet att utföra arbetet.", kind: "blocked" });
  assert.equal(nextStepLine({ flow: workOrderFlow({ ...order, status: "COMPLETED" }) }), null);
  // An unsaved task is sent to save it first.
  assert.equal(nextStepLine({ flow: workOrderFlow({ ...order, saved: false }) })?.step, "Beställning");
});
