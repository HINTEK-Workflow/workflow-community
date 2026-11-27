import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isRiskAssessmentTask, pageRiskStepState, RISK_QUESTIONS, riskCheckOf, riskStepRefusal, riskStepReportFacts, riskStepRequired, riskStepState, stampRiskStep, withRiskCheck,
  type RiskCheck, type RiskStepContext,
} from "../lib/workflow/risk-step";
import { localRiskStepContext, localRiskStepRefusal } from "../lib/workflow/risk-step-local";
import { formFlow, workOrderFlow } from "../lib/workflow/task-flow";
import { adviseFlow } from "../lib/workflow/flow-advisor";
import { workflowTaskDataSchema, workflowTaskInputSchema } from "../lib/workflow/task-model";
import { RISK_FORM_ID } from "../lib/workflow/builtin-originals";
import { riskFormDocument } from "../lib/workflow/builtin-risk-form";

// Riskbedömning som steg (2026-10-08): the rule Cloud's route, Local, the demo and the page share.
const allYes = Object.fromEntries(RISK_QUESTIONS.map((question) => [question.id, "yes"])) as RiskCheck["answers"];
const confirmed: RiskCheck = { level: "simplified", answers: allYes, confirmedBy: "Mats Montör", confirmedAt: "2026-10-08T07:00:00.000Z" };
const workOrderData = (extra: object = {}) => ({ kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" }, riskStep: true, ...extra });
const job = (extra: object = {}, status = "PLANNED") => ({ kind: "WORK_ORDER", status, data: workOrderData(extra) });
const ctx = (extra: Partial<RiskStepContext> = {}): RiskStepContext => ({ extended: null, workOrder: null, ...extra });

test("risk step: tasks created before the step and risk assessments themselves are exempt", () => {
  assert.equal(riskStepRequired({ kind: "WORK_ORDER", data: { kind: "WORK_ORDER" } }), false, "no flag: an older task is never locked");
  assert.equal(riskStepState({ ...job(), data: { ...workOrderData(), riskStep: undefined } }, ctx()).applies, false);
  assert.equal(riskStepRequired(job()), true);
  assert.equal(isRiskAssessmentTask({ kind: "RISK_ASSESSMENT", data: {} }), true);
  assert.equal(isRiskAssessmentTask({ kind: "FORM", formArea: "risk-assessment", data: {} }), true);
  assert.equal(isRiskAssessmentTask({ kind: "FORM", data: { details: { templateId: RISK_FORM_ID } } }), true);
  // A company's (or Local's) copy of the risk form is known by its table of hazards and measures.
  assert.equal(isRiskAssessmentTask({ kind: "FORM", data: { details: { templateId: "own-copy", document: riskFormDocument } } }), true);
  assert.equal(riskStepRequired({ kind: "FORM", data: { riskStep: true, details: { templateId: RISK_FORM_ID } } }), false);
  assert.equal(isRiskAssessmentTask({ kind: "FORM", data: { details: { templateId: "hintek-skyddsrond" } } }), false);
});

test("risk step: the simplified check is done when every answer is Ja and the person has confirmed", () => {
  let state = riskStepState(job(), ctx());
  assert.equal(state.done, false);
  assert.equal(state.unanswered.length, RISK_QUESTIONS.length);
  assert.match(state.hint, /Svara på frågorna/);
  state = riskStepState(job({ riskCheck: { ...confirmed, confirmedAt: null } }), ctx());
  assert.equal(state.done, false);
  assert.match(state.hint, /Bekräfta/);
  state = riskStepState(job({ riskCheck: confirmed }), ctx());
  assert.equal(state.done, true);
  assert.equal(state.via, "simplified");
  assert.equal(riskStepRefusal(state, "start"), null);
});

test("risk step: Nej or Osäker and the person's own choice require the extended assessment", () => {
  for (const value of ["no", "unsure"] as const) {
    const state = riskStepState(job({ riskCheck: { ...confirmed, answers: { ...allYes, height: value } } }), ctx());
    assert.equal(state.done, false, `${value} is a risk`);
    assert.equal(state.extendedReason, "answers");
    assert.deepEqual(state.riskAnswers, ["height"]);
  }
  assert.equal(riskStepState(job({ riskCheck: { ...confirmed, level: "extended" } }), ctx()).extendedReason, "chosen");
  // Extended is done when the linked assessment is completed – and only that one.
  const linked = { ...confirmed, level: "extended" as const, confirmedAt: null, extendedTaskId: "ra-1" };
  assert.equal(riskStepState(job({ riskCheck: linked }), ctx({ extended: { id: "ra-1", title: "Riskbedömning: Byte", status: "IN_PROGRESS" } })).done, false);
  assert.match(riskStepState(job({ riskCheck: linked }), ctx({ extended: { id: "ra-1", title: "Riskbedömning: Byte", status: "IN_PROGRESS" } })).hint, /Riskbedömning: Byte/);
  assert.equal(riskStepState(job({ riskCheck: linked }), ctx({ extended: { id: "ra-2", title: "Annan", status: "COMPLETED" } })).done, false, "another task's completion never counts");
  const done = riskStepState(job({ riskCheck: linked }), ctx({ extended: { id: "ra-1", title: "Riskbedömning: Byte", status: "COMPLETED" } }));
  assert.equal(done.done, true);
  assert.equal(done.via, "extended");
});

test("risk step: a task under a work order inherits its completed step; a completed task is never locked again", () => {
  const underOrder = { ...job(), workOrderId: "wo-1" };
  assert.equal(riskStepState(underOrder, ctx({ workOrder: { id: "wo-1", title: "AO-12", status: "IN_PROGRESS", done: true } })).via, "work-order");
  const open = riskStepState(underOrder, ctx({ workOrder: { id: "wo-1", title: "AO-12", status: "PLANNED", done: false } }));
  assert.equal(open.done, false);
  assert.match(open.hint, /arbetsordern ”AO-12”/);
  assert.equal(riskStepState(job({}, "COMPLETED"), ctx()).done, true);
  assert.equal(riskStepState(job({}, "COMPLETED"), ctx()).via, "completed");
});

test("risk step: the gates say why in plain Swedish", () => {
  const state = riskStepState(job(), ctx());
  assert.match(riskStepRefusal(state, "start")!, /^Gör riskbedömningen innan du startar tiden\./);
  assert.match(riskStepRefusal(state, "complete")!, /^Gör riskbedömningen innan du färdigställer uppgiften\./);
  assert.equal(riskStepRefusal(riskStepState({ kind: "WORK_ORDER", status: "PLANNED", data: { kind: "WORK_ORDER" } }, ctx()), "start"), null);
});

test("risk step: the persistence boundary sets the flag and who confirmed, whatever the client sends", () => {
  const actor = { id: "u-1", name: "Mats Montör" };
  const now = "2026-10-08T09:00:00.000Z";
  // A new task gets the flag; a risk assessment does not.
  assert.equal((stampRiskStep({ kind: "WORK_ORDER" }, { created: true, stored: null, exempt: false, actor, now }) as { riskStep?: boolean }).riskStep, true);
  assert.equal((stampRiskStep({ kind: "FORM" }, { created: true, stored: null, exempt: true, actor, now }) as { riskStep?: boolean }).riskStep, undefined);
  // A saved task keeps what it was created with: the client can neither remove nor add the flag.
  assert.equal((stampRiskStep({ kind: "WORK_ORDER" }, { created: false, stored: { riskStep: true }, exempt: false, actor, now }) as { riskStep?: boolean }).riskStep, true);
  assert.equal((stampRiskStep({ kind: "WORK_ORDER", riskStep: true }, { created: false, stored: {}, exempt: false, actor, now }) as { riskStep?: boolean }).riskStep, undefined);
  // The confirmation is the actor's and the server's time, kept while the answers are unchanged and set anew when they change.
  const sent = withRiskCheck({ kind: "WORK_ORDER" }, { ...confirmed, confirmedBy: "Någon annan", confirmedAt: "2020-01-01T00:00:00.000Z" });
  const first = riskCheckOf(stampRiskStep(sent, { created: false, stored: { riskStep: true }, exempt: false, actor, now }))!;
  assert.equal(first.confirmedBy, "Mats Montör");
  assert.equal(first.confirmedById, "u-1");
  assert.equal(first.confirmedAt, now);
  const stored = withRiskCheck({ riskStep: true }, first);
  const again = riskCheckOf(stampRiskStep(sent, { created: false, stored, exempt: false, actor: { id: "u-2", name: "Erik" }, now: "2026-10-08T10:00:00.000Z" }))!;
  assert.equal(again.confirmedBy, "Mats Montör", "an unchanged confirmation keeps its person and time");
  assert.equal(again.confirmedAt, now);
  const changed = withRiskCheck({ kind: "WORK_ORDER" }, { ...confirmed, answers: { ...allYes, others: "yes" as const, special: "yes" as const }, level: "extended" });
  assert.equal(riskCheckOf(stampRiskStep(changed, { created: false, stored, exempt: false, actor: { id: "u-2", name: "Erik" }, now: "2026-10-08T10:00:00.000Z" }))!.confirmedBy, "Erik");
  const unconfirmed = riskCheckOf(stampRiskStep(withRiskCheck({}, { ...confirmed, confirmedAt: null, confirmedBy: "Mats" }), { created: false, stored, exempt: false, actor, now }))!;
  assert.equal(unconfirmed.confirmedBy, "");
  assert.equal(unconfirmed.confirmedAt, null);
});

test("risk step: stored in the task's own data, backwards compatible", () => {
  const parsed = workflowTaskDataSchema.parse(workOrderData({ riskCheck: { ...confirmed, answers: { ...allYes, bogus: "yes" } } }));
  assert.equal(parsed.riskStep, true);
  assert.deepEqual(parsed.riskCheck?.answers, allYes);
  const old = workflowTaskDataSchema.parse({ kind: "WORK_ORDER", details: workOrderData().details });
  assert.equal(old.riskCheck, undefined);
  assert.equal(old.riskStep, undefined);
  assert.equal(workflowTaskDataSchema.safeParse(workOrderData({ riskCheck: { answers: { height: "kanske" } } })).success, false);
  assert.equal(workflowTaskInputSchema.parse({ kind: "WORK_ORDER", title: "Byte", data: workOrderData({ riskCheck: confirmed }) }).data.riskCheck?.confirmedBy, "Mats Montör");
});

test("risk step: the progress line and the tip point to it when it is next", () => {
  const order = { saved: true, title: "Byt armatur", status: "PLANNED", assigned: false, dueDate: "", timerRunning: false, totalDurationSec: 0, executionNotes: "", signatureName: "", signatureConfirmed: false };
  const flow = workOrderFlow({ ...order, riskStep: { met: false, hint: "Svara på frågorna i riskbedömningen och bekräfta." } });
  assert.deepEqual(flow.steps.map((step) => step.key), ["order", "plan", "risk", "work", "sign", "complete"]);
  assert.equal(flow.current!.key, "risk");
  assert.equal(flow.current!.target, "task-risk-step");
  assert.equal(workOrderFlow({ ...order, riskStep: { met: true, hint: "" } }).current!.key, "work");
  assert.deepEqual(workOrderFlow(order).steps.map((step) => step.key), ["order", "plan", "work", "sign", "complete"], "no step for a task without it");
  assert.deepEqual(formFlow({ saved: true, title: "Rond", status: "PLANNED", issues: [], signatureBlocks: [], riskStep: { met: false, hint: "" } }).steps.map((step) => step.key), ["basics", "risk", "fill", "complete"]);
  const tips = adviseFlow({ kind: "WORK_ORDER", flow, saved: true, completed: false, today: "2026-10-08", timerAvailable: true, timerRunning: false, totalDurationSec: 0 });
  assert.equal(tips[0].id, "risk-step");
  assert.deepEqual(tips[0].action?.do, { kind: "focus", target: "task-risk-step" });
  assert.ok(!tips.some((tip) => tip.id === "start-timer"), "no Starta tid tip before the risk step");
});

test("risk step in Local and the demo: the linked tasks from the file", () => {
  const tasks = [
    { id: "wo-1", kind: "WORK_ORDER", title: "AO-1", status: "IN_PROGRESS", data: workOrderData({ riskCheck: confirmed }) },
    { id: "ra-1", kind: "RISK_ASSESSMENT", title: "Riskbedömning", status: "COMPLETED", data: {} },
  ];
  const task = { id: "t-1", kind: "WORK_ORDER", status: "PLANNED", data: workOrderData() };
  assert.match(localRiskStepRefusal(tasks, task, "start")!, /innan du startar tiden/);
  assert.equal(localRiskStepRefusal(tasks, { ...task, workOrderId: "wo-1" }, "start"), null, "inherits the work order's step");
  assert.equal(localRiskStepContext(tasks, { ...task, workOrderId: "wo-1" }).workOrder?.done, true);
  // The task type's level (Krävd nivå, 2026-10-09) is about who may do the task: a confirmed simplified check is enough.
  assert.equal(localRiskStepRefusal(tasks, { ...task, data: workOrderData({ riskCheck: confirmed }) }, "complete"), null);
  assert.match(localRiskStepRefusal(tasks, { ...task, data: workOrderData({ riskCheck: { ...confirmed, level: "extended" } }) }, "complete")!, /utökade riskbedömningen/);
  assert.equal(localRiskStepRefusal(tasks, { ...task, data: workOrderData({ riskCheck: { ...confirmed, level: "extended", extendedTaskId: "ra-1" } }) }, "complete"), null);
});

test("risk step in the report: the level, the answers, who and when", () => {
  const facts = riskStepReportFacts(workOrderData({ riskCheck: { ...confirmed, answers: { ...allYes, special: "unsure" } } }))!;
  assert.equal(facts.level, "Förenklad");
  assert.equal(facts.confirmedBy, "Mats Montör");
  assert.equal(facts.rows.length, RISK_QUESTIONS.length);
  assert.deepEqual(facts.rows.filter((row) => row.risk).map((row) => row.value), ["Osäker"]);
  assert.equal(riskStepReportFacts(workOrderData()), null);
  assert.match(readFileSync("lib/workflow/task-report.ts", "utf8"), /drawRiskStep\(kit, task\.data\)/);
  assert.match(readFileSync("lib/workflow/form-report.ts", "utf8"), /drawRiskStep\(kit, task\.data, \{ blank \}\)/);
});

test("the browser tests' helper answers the same questions", () => {
  const helper = readFileSync("tests/helpers/risk-step.cjs", "utf8");
  assert.match(helper, new RegExp(`RISK_QUESTION_IDS = \\[${RISK_QUESTIONS.map((question) => `"${question.id}"`).join(", ")}\\]`));
});

test("risk step gates on the server: Starta tid and Färdigställ are refused until the step is done", () => {
  const route = readFileSync("app/api/workflow-tasks/route.ts", "utf8");
  const timer = route.slice(route.indexOf('input.action === "timer"'));
  assert.ok(timer.indexOf('await requireRiskStep(ctx.organizationId, task, "start")') > 0, "the timer's START asks for the step");
  assert.ok(timer.indexOf("requireRiskStep(") < timer.indexOf("prisma.$transaction"), "before anything is written");
  const save = route.indexOf("await applyRiskStepOnSave(ctx.organizationId, ctx.user, task, form)");
  assert.ok(save > route.indexOf("workflowTaskCompletion(task)") && save < route.indexOf("stampWorkflowTaskApproval(task.data"), "after the completion requirements, before anything is stamped or written");
  const server = readFileSync("lib/workflow/risk-step-server.ts", "utf8");
  assert.match(server, /where: \{ id: extendedId, organizationId \}/, "a linked assessment is read within the company");
  assert.match(server, /where: \{ id: parentId, organizationId, kind: "WORK_ORDER" \}/, "the work order too");
  assert.match(server, /throw new ApiError\(409, refusal\)/);
  assert.match(server, /if \(!row \|\| !isRiskAssessmentTask\(row\)\) throw new ApiError\(400/, "only the company's own risk assessment can be linked");
  const local = readFileSync("features/kfid/local-workspace-store.ts", "utf8");
  assert.match(local, /localRiskStepRefusal\(workspace\.workflowTasks, current, "start"/);
  assert.match(local, /localRiskStepRefusal\(workspace\.workflowTasks, \{ \.\.\.parsed, status: current\?\.status \?\? "PLANNED" \}, "complete"/);
  const demo = readFileSync("features/demo/demo-backend.ts", "utf8");
  assert.match(demo, /localRiskStepRefusal\(ctx\.db\.tasks, task, "start"/);
  assert.match(demo, /localRiskStepRefusal\(ctx\.db\.tasks, \{ \.\.\.data, status: stored\?\.status \?\? "PLANNED" \}, "complete"\)/);
  const context = readFileSync("app/api/workflow-tasks/risk-step/route.ts", "utf8");
  assert.match(context, /organizationId: ctx\.organizationId/);
  assert.match(context, /canRead\(task\.kind, task\.formArea\)/);
});

test("a save without the risk check keeps the stored one; an explicit null clears it (2026-10-08)", () => {
  const actor = { id: "u1", name: "Anna" };
  const stored = { kind: "WORK_ORDER", riskStep: true, riskCheck: { level: "simplified", answers: {}, confirmedBy: "Anna", confirmedById: "u1", confirmedAt: "2026-10-08T10:00:00.000Z" } };
  const kept = stampRiskStep({ kind: "WORK_ORDER" } as Record<string, unknown>, { created: false, stored, exempt: false, actor, now: "2026-10-09T00:00:00.000Z" });
  assert.equal(riskCheckOf(kept)?.confirmedAt, "2026-10-08T10:00:00.000Z");
  const cleared = stampRiskStep({ kind: "WORK_ORDER", riskCheck: null } as Record<string, unknown>, { created: false, stored, exempt: false, actor, now: "2026-10-09T00:00:00.000Z" });
  assert.equal(riskCheckOf(cleared), null);
});

// 2026-10-29: a new round protocol opened in its work order (Starta ronden, ?workOrderId=) asked its own risk
// questions and Starta tid did nothing; it follows the work order's step like a saved task in the order.
test("risk step: a new, unsaved task in a work order follows the work order's step", () => {
  const protocol = { id: "", kind: "FORM", status: "PLANNED", data: { kind: "FORM", details: {} }, workOrderId: "wo-1" };
  const order = (done: boolean) => ctx({ workOrder: { id: "wo-1", title: "Rond A", status: "PLANNED", done } });
  const done = pageRiskStepState(protocol, order(true));
  assert.equal(done.applies, true);
  assert.equal(done.done, true);
  assert.equal(done.via, "work-order");
  assert.equal(riskStepRefusal(done, "start"), null, "Starta tid is not refused once the work order's risk step is done");
  const open = pageRiskStepState(protocol, order(false));
  assert.equal(open.done, false);
  assert.deepEqual(open.unanswered, [], "no questions of its own");
  assert.equal(riskStepRefusal(open, "start"), "Gör riskbedömningen innan du startar tiden. Gör riskbedömningen på arbetsordern ”Rond A”.");
  // Without the order's context (the bug) the new task got a step of its own.
  assert.match(riskStepRefusal(pageRiskStepState(protocol, ctx()), "start") ?? "", /Svara på frågorna i riskbedömningen/);
  // A saved task is evaluated as stored (no flag added).
  assert.equal(pageRiskStepState({ ...protocol, id: "t-1" }, ctx()).applies, false);
  // Local: the same context from the file's tasks for the unsaved task.
  const tasks = [{ id: "wo-1", kind: "WORK_ORDER", title: "Rond A", status: "PLANNED", data: workOrderData({ riskCheck: confirmed }) }];
  assert.equal(pageRiskStepState(protocol, localRiskStepContext(tasks, protocol)).via, "work-order");
});
