import assert from "node:assert/strict";
import test from "node:test";
import { jobState, withJobState, type JobStateInput } from "../lib/workflow/job-state";
import { RISK_QUESTIONS, riskStepState, type RiskCheck, type RiskStepContext } from "../lib/workflow/risk-step";
import { formatRuleAnswer } from "../lib/ai/assistant-rules";

// Jobbets läge (Workflow AI-planen steg 3, 2026-10-09): get_task's `job`, from the same rules as the job's page and routes.
const allYes = Object.fromEntries(RISK_QUESTIONS.map((question) => [question.id, "yes"])) as RiskCheck["answers"];
const confirmed: RiskCheck = { level: "simplified", answers: allYes, confirmedBy: "Mats Montör", confirmedAt: "2026-10-08T07:00:00.000Z" };
const details = (extra: object = {}) => ({ executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "", ...extra });
type Task = JobStateInput["task"];
const order = (extra: Partial<Task> & { riskCheck?: RiskCheck; details?: object } = {}): Task => {
  const { riskCheck, details: own, ...rest } = extra;
  return { id: "t1", kind: "WORK_ORDER", title: "Byte av central", status: "PLANNED", dueDate: "2026-10-12", data: { kind: "WORK_ORDER", details: details(own), riskStep: true, ...(riskCheck ? { riskCheck } : {}) } as unknown as Task["data"], ...rest } as Task;
};
const none = (): RiskStepContext => ({ extended: null, workOrder: null });
const state = (task: Task, extra: Partial<JobStateInput> = {}, context = none()) => jobState({ task, risk: riskStepState(task, context), mayEdit: true, today: "2026-10-09", now: new Date("2026-10-09T08:00:00Z"), ...extra });

test("job state: an unconfirmed risk step blocks Starta tid and Färdigställ with the page's own reasons, in Färdigställ's order", () => {
  const job = state(order());
  assert.equal(job.status, "Planerad");
  assert.equal(job.riskStep.applies, true);
  assert.equal(job.riskStep.applies && job.riskStep.done, false);
  assert.match(job.riskStep.text, /Svara på frågorna/);
  assert.equal(job.canStartTime, false);
  assert.match(job.startTimeBlockedBy![0], /^Gör riskbedömningen innan du startar tiden\./);
  assert.equal(job.canComplete, false);
  // The requirements first (the work, the signature), the risk step last – as nextStepLine and Färdigställ do.
  assert.deepEqual(job.completeBlockedBy!.slice(0, 3), ["Beskriv det utförda arbetet.", "Ange namn på den som signerar.", "Bekräfta signeringen av arbetsordern."]);
  assert.match(job.completeBlockedBy!.at(-1)!, /^Gör riskbedömningen innan du färdigställer uppgiften\./);
  // The progress line's current step is the risk step.
  assert.equal(job.nextStep?.step, "Riskbedömning");
});

test("job state: a confirmed step lets the time start; a signed order with written work can be completed", () => {
  const ready = state(order({ riskCheck: confirmed, details: { executionNotes: "Bytt central.", signature: { name: "Mats Montör", confirmed: true, signedAt: null } } }));
  assert.equal(ready.canStartTime, true);
  assert.equal(ready.startTimeBlockedBy, undefined);
  assert.equal(ready.canComplete, true);
  assert.match(ready.riskStep.text, /förenklad, bekräftad av Mats Montör/);
  assert.equal(ready.nextStep?.text, "Allt som krävs är klart. Tryck Färdigställ.");
});

test("job state: an answer showing risk requires the extended assessment and names the questions", () => {
  const job = state(order({ riskCheck: { ...confirmed, answers: { ...allYes, height: "no" } } }));
  assert.equal(job.riskStep.applies && job.riskStep.level, "Utökad");
  assert.ok(job.riskStep.applies && job.riskStep.extendedRequired);
  assert.deepEqual(job.riskStep.applies && job.riskStep.answersShowingRisk, ["Inget arbete på höjd eller i trånga utrymmen"]);
  assert.match(job.startTimeBlockedBy!.join(" "), /utökad riskbedömning krävs/);
});

test("job state: the time of a linked task runs on its work order, so Starta tid asks the work order", () => {
  const task = order({ kind: "FORM" } as Partial<Task>);
  const linked = { ...task, data: { ...(task.data as object), riskCheck: confirmed } } as unknown as Task;
  const blocked = state(linked, { timeOwner: { title: "Arbetsorder 12", status: "PLANNED", riskDone: false, refusal: null } });
  assert.match(blocked.startTimeBlockedBy![0], /arbetsordern ”Arbetsorder 12”, och dess riskbedömning är inte klar/);
  assert.equal(blocked.time.runsOn, "arbetsordern ”Arbetsorder 12”");
  const done = state(linked, { timeOwner: { title: "Arbetsorder 12", status: "COMPLETED", riskDone: true } });
  assert.match(done.startTimeBlockedBy![0], /som är färdigställd/);
});

test("job state: the level rule's message, no edit permission and a closed project are blockers", () => {
  const job = state(order({ riskCheck: confirmed }), { level: { work: "Du kan inte arbeta i uppgiften: Arbetsorder kräver nivå 3 och din nivå är 1.", start: "Du kan inte starta uppgiften: nivå.", complete: "Du kan inte slutföra uppgiften: nivå." }, mayEdit: false, projectFrozen: "closed" });
  assert.deepEqual(job.startTimeBlockedBy, ["Du har inte behörighet att ändra den här sortens jobb.", "Du kan inte starta uppgiften: nivå."]);
  assert.equal(job.completeBlockedBy![0], "Projektet är avslutat. Återöppna projektet först.");
  assert.ok(job.completeBlockedBy!.includes("Du kan inte slutföra uppgiften: nivå."));
  assert.notEqual(job.nextStep?.text, job.completeBlockedBy![0], "a frozen project is not a level block (the page shows its own notice)");
  const open = state(order({ riskCheck: confirmed }), { level: { work: "Du kan inte arbeta i uppgiften: Arbetsorder kräver nivå 3 och din nivå är 1.", start: null, complete: null } });
  assert.equal(open.nextStep?.text, "Du kan inte arbeta i uppgiften: Arbetsorder kräver nivå 3 och din nivå är 1.", "a block on the work comes first, as on the page");
});

test("job state: Utgår is named with its reason, and nothing is offered as the next step", () => {
  const job = state(order({ status: "CANCELLED", cancelledAt: "2026-10-09T07:00:00.000Z", cancelReason: "Kunden avbokade." }));
  assert.equal(job.status, "Utgått");
  assert.equal(job.cancelled?.reason, "Kunden avbokade.");
  assert.equal(job.canStartTime, false);
  assert.deepEqual(job.completeBlockedBy, ["Jobbet har utgått. Återuppta det först."]);
  assert.equal(job.nextStep, undefined);
  assert.equal(job.schedule.late, false, "an Utgått job is never late");
});

test("job state: coming bookings, the schedule and late", () => {
  const bookings = [
    { workflowTaskId: "t1", status: "PLANNED", startsAt: "2026-10-14T05:00:00Z", endsAt: "2026-10-14T14:00:00Z", assignedToName: "Anna, Erik" },
    { workflowTaskId: "t1", status: "PLANNED", startsAt: "2026-10-01T05:00:00Z", endsAt: "2026-10-01T14:00:00Z", assignedToName: "Gammal" },
    { workflowTaskId: "t1", status: "CANCELED", startsAt: "2026-10-15T05:00:00Z", endsAt: "2026-10-15T14:00:00Z", assignedToName: "Inställd" },
  ];
  const job = state(order({ dueDate: "2026-10-08", plannedStartDate: "2026-10-06", estimatedMinutes: 240 }), { bookings });
  assert.equal(job.bookings?.line, "Bokad: ons 14/10 07–16 · Anna, Erik");
  assert.equal(job.bookings?.upcoming.length, 1, "past and cancelled bookings are left out");
  assert.deepEqual(job.schedule, { plannedStartDate: "2026-10-06", dueDate: "2026-10-08", startDate: "2026-10-06", estimatedMinutes: 240, late: true, stage: null });
  assert.equal(job.obstacle, null);
  assert.equal(state(order(), { bookings: [] }).bookings?.line, "Ingen bokning");
  assert.equal(state(order(), { bookings: null }).bookings, undefined, "unread bookings are left out, not reported as none");
});

test("job state: a task created before the step has none and is never blocked by it", () => {
  const old = order();
  const task = { ...old, data: { ...(old.data as object), riskStep: undefined } } as unknown as Task;
  const job = state(task);
  assert.equal(job.riskStep.applies, false);
  assert.equal(job.canStartTime, true);
  assert.ok(!job.completeBlockedBy!.some((text) => /riskbedömningen/.test(text)));
});

test("get_task: the job state goes right after the task's own fields, before the long details", () => {
  const job = state(order());
  const view = withJobState({ id: "t1", title: "x", status: "PLANNED", project: null, customer: null, details: { executionNotes: "…" }, url: "/" }, job);
  assert.deepEqual(Object.keys(view), ["id", "title", "status", "job", "project", "customer", "details", "url"]);
  assert.equal(withJobState({ id: "t1" }, null).job, undefined, "a state that could not be read is left out");
});

test("rules answer for get_task: the job's next step and what Färdigställ still needs, free and without AI", () => {
  const job = state(order());
  const answer = formatRuleAnswer("get_task", "", { id: "t1", kind: "WORK_ORDER", title: "Byte av central", status: "PLANNED", job });
  assert.match(answer.answer, /Riskbedömning: Inte klar/);
  assert.match(answer.answer, /Nästa steg \(Riskbedömning\)/);
  assert.match(answer.answer, /Kvar före Färdigställ: Beskriv det utförda arbetet\./);
  assert.match(answer.answer, /Starta tid spärras: Gör riskbedömningen/);
});
