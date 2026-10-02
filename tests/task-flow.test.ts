import assert from "node:assert/strict";
import test from "node:test";
import { controlFlow, formFlow, projectFlow, riskFlow, workOrderFlow } from "../lib/workflow/task-flow";
import { adviseFlow, pickAdvice, type AdvisorContext } from "../lib/workflow/flow-advisor";

const order = { saved: true, title: "Byt armatur", status: "PLANNED", assigned: false, dueDate: "", timerRunning: false, totalDurationSec: 0, executionNotes: "", signatureName: "", signatureConfirmed: false };
const states = (flow: ReturnType<typeof workOrderFlow>) => flow.steps.map((step) => `${step.key}:${step.state}`).join(" ");

test("work order flow: Beställning → Planering (valfri) → Utförande → Signering → Slutförd", () => {
  assert.equal(states(workOrderFlow({ ...order, saved: false })), "order:current plan:upcoming work:upcoming sign:upcoming complete:upcoming");
  // Planning is optional: once the order is saved the person is sent to the work, and planning shows as skipped.
  const saved = workOrderFlow(order);
  assert.equal(states(saved), "order:done plan:skipped work:current sign:upcoming complete:upcoming");
  assert.match(saved.current!.hint, /Starta tid/);
  assert.match(workOrderFlow({ ...order, timerRunning: true }).current!.hint, /Tiden går/);
  assert.equal(states(workOrderFlow({ ...order, assigned: true, executionNotes: "Bytt" })), "order:done plan:done work:done sign:current complete:upcoming");
  const ready = workOrderFlow({ ...order, executionNotes: "Bytt", signatureName: "Elin", signatureConfirmed: true });
  assert.equal(ready.current!.key, "complete");
  const done = workOrderFlow({ ...order, status: "COMPLETED", executionNotes: "Bytt", signatureName: "Elin", signatureConfirmed: true });
  assert.equal(done.done, true);
  assert.equal(states(done), "order:done plan:skipped work:done sign:done complete:done");
});

test("risk, protocol, control and project flows follow their own completion rules", () => {
  assert.equal(riskFlow({ saved: true, title: "Lyft", status: "PLANNED", risks: [], approvalName: "", approvalConfirmed: false }).current!.key, "risks");
  assert.equal(riskFlow({ saved: true, title: "Lyft", status: "PLANNED", risks: [{ hazard: "Fall", protectiveMeasure: "Sele" }], approvalName: "", approvalConfirmed: false }).current!.key, "approval");
  const issues = [{ field: "form-a", message: "Fyll i Spänning." }, { field: "form-sig", message: "Signatur: ange namn och bekräfta." }];
  const protocol = formFlow({ saved: true, title: "Rond", status: "PLANNED", issues, signatureBlocks: ["sig"] });
  assert.equal(protocol.current!.key, "fill");
  assert.equal(protocol.current!.hint, "Fyll i Spänning.");
  assert.equal(formFlow({ saved: true, title: "Rond", status: "PLANNED", issues: issues.slice(1), signatureBlocks: ["sig"] }).current!.key, "sign");
  assert.deepEqual(formFlow({ saved: true, title: "Rond", status: "PLANNED", issues: [], signatureBlocks: [] }).steps.map((step) => step.key), ["basics", "fill", "complete"]);
  // A form that asks for its moments (the control as a form) has that choice as its own step.
  const moments = formFlow({ saved: true, title: "Elcentral", status: "PLANNED", issues: [{ field: "form-iso", message: "Välj minst ett kontrollmoment." }], signatureBlocks: [], moments: { label: "Kontrollmoment", met: false, target: "form-iso" } });
  assert.deepEqual(moments.steps.map((step) => step.key), ["basics", "moments", "fill", "complete"]);
  assert.equal(moments.current!.key, "moments");
  assert.equal(formFlow({ saved: true, title: "Elcentral", status: "PLANNED", issues: [{ field: "form-iso", message: "Isolation: fyll i minst en rad." }], signatureBlocks: [], moments: { label: "Kontrollmoment", met: true, target: "form-iso" } }).current!.key, "fill");
  assert.equal(controlFlow({ saved: true, completed: false, errors: [{ path: "iso.rows.0.mohm", message: "Isolation, rad 1: ange MΩ." }] }).current!.key, "measure");
  assert.equal(controlFlow({ saved: true, completed: false, errors: [{ path: "vis.comment", message: "Beskriv avvikelser." }] }).current!.key, "summary");
  assert.equal(controlFlow({ saved: false, completed: false, errors: [] }).current!.key, "basics");
  assert.equal(projectFlow({ closed: false, archived: false, taskCount: 0, startedCount: 0, completedCount: 0 }).current!.key, "tasks");
  assert.equal(projectFlow({ closed: false, archived: false, taskCount: 2, startedCount: 0, completedCount: 2 }).current!.key, "closed");
  assert.equal(projectFlow({ closed: true, archived: false, taskCount: 2, startedCount: 0, completedCount: 2 }).done, true);
});

test("decision support: rules only, one tip at a time, filtered by the person's setting", () => {
  const base: AdvisorContext = { kind: "WORK_ORDER", flow: workOrderFlow(order), saved: true, completed: false, today: "2026-10-01", timerAvailable: true, timerRunning: false, totalDurationSec: 0 };
  const tips = adviseFlow(base);
  assert.deepEqual(tips.map((tip) => tip.id), ["start-timer"]);
  assert.equal(pickAdvice(tips, "normal", [], [])?.id, "start-timer");
  assert.equal(pickAdvice(tips, "rarely", [], []), null, "Sällan shows only the most important");
  assert.equal(pickAdvice(tips, "off", [], []), null);
  assert.equal(pickAdvice(tips, "normal", ["start-timer"], []), null, "a muted rule never shows");
  assert.equal(pickAdvice(tips, "normal", [], ["start-timer"]), null, "a dismissed tip never shows on this page");
  // A timer on another task is the more useful tip; an overdue date outranks everything.
  assert.equal(adviseFlow({ ...base, otherTimer: { title: "Rond B" } })[0].id, "other-timer");
  assert.equal(adviseFlow({ ...base, dueDate: "2026-09-30" })[0].id, "overdue");
  const ready = adviseFlow({ ...base, flow: workOrderFlow({ ...order, executionNotes: "x", signatureName: "E", signatureConfirmed: true }) });
  assert.equal(ready[0].id, "ready-complete");
  assert.equal(ready[0].action?.do.kind, "complete");
  assert.deepEqual(adviseFlow({ ...base, completed: true }), []);
  assert.equal(adviseFlow({ ...base, kind: "RISK_ASSESSMENT", highResidualRisks: 2 })[0].id, "high-residual");
  assert.equal(adviseFlow({ kind: "PROJECT", flow: projectFlow({ closed: false, archived: false, taskCount: 3, startedCount: 0, completedCount: 3 }), saved: true, completed: false, today: "2026-10-01", project: { taskCount: 3, openCount: 0, closed: false } })[0].id, "project-close");
  // One message per thing: the green "Klar att avsluta" box already says it.
  assert.deepEqual(adviseFlow({ kind: "PROJECT", flow: projectFlow({ closed: false, archived: false, taskCount: 3, startedCount: 0, completedCount: 3 }), saved: true, completed: false, today: "2026-10-01", project: { taskCount: 3, openCount: 0, closed: false, readyToCloseShown: true } }), []);
});
