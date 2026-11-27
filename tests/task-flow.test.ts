import assert from "node:assert/strict";
import test from "node:test";
import { controlFlow, formFlow, projectFlow, riskFlow, workOrderFlow } from "../lib/workflow/task-flow";
import { adviseFlow, pickAdvice, type AdvisorContext } from "../lib/workflow/flow-advisor";

const order = { saved: true, title: "Byt armatur", status: "PLANNED", assigned: false, dueDate: "", timerRunning: false, totalDurationSec: 0, executionNotes: "", signatureName: "", signatureConfirmed: false };
const states = (flow: ReturnType<typeof workOrderFlow>) => flow.steps.map((step) => `${step.key}:${step.state}`).join(" ");

test("the last step is the action Färdigställ while it is left, and Färdigställd once finished (production 2026-11-21)", () => {
  const signed = { ...order, status: "IN_PROGRESS", executionNotes: "Bytt", signatureName: "Elin", signatureConfirmed: true };
  // "Nu: steg 6 av 6 · Färdigställd" on a work order that was Pågår read as if it were done.
  assert.deepEqual([workOrderFlow(signed).current!.key, workOrderFlow(signed).current!.label], ["complete", "Färdigställ"]);
  assert.equal(workOrderFlow({ ...signed, status: "COMPLETED" }).steps.at(-1)!.label, "Färdigställd");
  const risk = { saved: true, title: "Lyft", risks: [{ hazard: "Fall", protectiveMeasure: "Sele" }], approvalName: "QA", approvalConfirmed: true };
  assert.deepEqual([riskFlow({ ...risk, status: "IN_PROGRESS" }).current!.label, riskFlow({ ...risk, status: "COMPLETED" }).steps.at(-1)!.label], ["Färdigställ", "Färdigställd"]);
  assert.deepEqual([formFlow({ saved: true, title: "Rond", status: "IN_PROGRESS", issues: [], signatureBlocks: [] }).current!.label, formFlow({ saved: true, title: "Rond", status: "COMPLETED", issues: [], signatureBlocks: [] }).steps.at(-1)!.label], ["Färdigställ", "Färdigställd"]);
  assert.deepEqual([controlFlow({ saved: true, completed: false, errors: [] }).current!.label, controlFlow({ saved: true, completed: true, errors: [] }).steps.at(-1)!.label], ["Färdigställ", "Färdigställd"]);
});

test("work order flow: Beställning → Planering (valfri) → Utförande → Signering → Färdigställ", () => {
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
  // The fill step is not "Ifylld" while the moments are unchosen (2026-10-07: an empty control at 42 % said so).
  const fill = (flow: ReturnType<typeof formFlow>) => flow.steps.find((step) => step.key === "fill")!;
  assert.equal(fill(moments).state, "upcoming");
  assert.equal(fill(moments).display, undefined);
  // Nor "Påbörjad 100 %" from prefilled basics before any moment is chosen (QA 2026-10-10).
  const prefilled = formFlow({ saved: true, title: "Elcentral", status: "PLANNED", issues: [{ field: "form-iso", message: "Välj minst ett kontrollmoment." }], requirements: [{ field: "form-proj", met: true }, { field: "form-iso", met: false }], signatureBlocks: [], moments: { label: "Kontrollmoment", met: false, target: "form-iso" } });
  assert.equal(fill(prefilled).display, undefined);
  // Not filled in: "Påbörjad" once one of the step's own requirements is met; the percentage is the job's own (one source,
  // simulation 2026-10-10: "42 % klart" in the header beside "Påbörjad 36 %" on the line), shown only when given.
  const requirements = [{ field: "task-title", met: true }, ...Array.from({ length: 10 }, (_, index) => ({ field: "form-points", met: index === 0 })), { field: "form-sig", met: false }];
  const started = formFlow({ saved: true, title: "Rond", status: "PLANNED", issues: [{ field: "form-points", message: "Bedöm punkt 2." }, { field: "form-sig", message: "Signera." }], requirements, signatureBlocks: ["sig"] });
  assert.equal(fill(started).state, "current");
  assert.equal(fill(started).display, "Påbörjad");
  assert.equal(fill(formFlow({ saved: true, title: "Rond", status: "PLANNED", issues: [{ field: "form-points", message: "Bedöm punkt 2." }], requirements, signatureBlocks: ["sig"], progress: 42 })).display, "Påbörjad 42 %");
  assert.equal(fill(formFlow({ saved: true, title: "Rond", status: "PLANNED", issues: [{ field: "form-points", message: "Bedöm punkt 2." }], requirements, signatureBlocks: ["sig"], progress: 100 })).display, "Påbörjad 99 %", "a step that is not met never says 100 %");
  // The line follows the page's panels (dator fynd 20): Grunduppgifter with its moments, then the risk step, then the work.
  assert.deepEqual(formFlow({ saved: true, title: "Elcentral", status: "PLANNED", issues: [], signatureBlocks: [], moments: { label: "Kontrollmoment", met: true, target: "form-iso" }, riskStep: { met: false, hint: "" } }).steps.map((step) => step.key), ["basics", "moments", "risk", "fill", "complete"]);
  const filledIn = formFlow({ saved: true, title: "Rond", status: "PLANNED", issues: [{ field: "form-sig", message: "Signera." }], requirements: requirements.map((item) => item.field === "form-points" ? { ...item, met: true } : item), signatureBlocks: ["sig"] });
  assert.equal(fill(filledIn).state, "done");
  assert.equal(fill(filledIn).display, "Ifylld");
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

test("form flow: Grunduppgifter points at the field that names the protocol, not the first panel on the page", () => {
  // 2026-10-09: with the risk step's panel first, a step without a target marked Riskbedömning and level 1–2 folded Grunduppgifter.
  const named = formFlow({ saved: false, title: "", status: "PLANNED", issues: [], signatureBlocks: [], titleFieldLabel: "Projekt / anläggning", titleFieldTarget: "form-kfid-f-project" });
  assert.equal(named.current!.key, "basics");
  assert.equal(named.current!.target, "form-kfid-f-project");
  assert.equal(formFlow({ saved: false, title: "", status: "PLANNED", issues: [], signatureBlocks: [] }).current!.target, "task-title");
});
