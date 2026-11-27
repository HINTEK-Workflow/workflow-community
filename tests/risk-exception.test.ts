import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { featureSettingsOf } from "../lib/workflow/feature-settings";
import { jobState, type JobStateInput } from "../lib/workflow/job-state";
import {
  emptyRiskCheck, RISK_EXCEPTION_DEFAULT_REASON, RISK_EXCEPTION_OFF, RISK_EXCEPTION_REPORT_TITLE, riskCheckOf, riskCheckSchema, riskExceptionOn, riskExceptionRefusal,
  riskStepRefusal, riskStepReportFacts, riskStepState, stampRiskStep, withRiskCheck, type RiskCheck,
} from "../lib/workflow/risk-step";
import { localRiskStepContext, localRiskStepRefusal } from "../lib/workflow/risk-step-local";
import { drawRiskStep } from "../lib/workflow/risk-step-report";
import { keepWorkAreas } from "../lib/workflow/work-profile";

// Arbetet är redan utfört (2026-11-02): the exception from the risk step. The server's gates against a real database:
// tests/risk-exception.integration.ts; the page: tests/risk-exception.browser.cjs.
const reason = "Tillbudet var redan åtgärdat när arbetsordern skrevs.";
const exception = { reason, by: "", at: null };
const withException: RiskCheck = { ...emptyRiskCheck(), exception };
const order = (riskCheck?: RiskCheck, status = "PLANNED") => ({ id: "ao", kind: "WORK_ORDER", title: "Arbetsorder", status, workOrderId: null, data: { kind: "WORK_ORDER", riskStep: true, ...(riskCheck ? { riskCheck } : {}) } });
const none = { extended: null, workOrder: null };
const actor = { id: "u-1", name: "Mats Montör" };
const now = "2026-11-02T09:00:00.000Z";

test("the exception lifts the block on Starta tid and Färdigställ for the work order, with no answers given", () => {
  const open = riskStepState(order(), none);
  assert.equal(open.done, false);
  assert.ok(riskStepRefusal(open, "start"));
  const state = riskStepState(order(withException), none);
  assert.equal(state.done, true);
  assert.equal(state.via, "exception");
  assert.equal(state.exception, true);
  assert.equal(riskStepRefusal(state, "start"), null);
  assert.equal(riskStepRefusal(state, "complete"), null);
});

test("the exception also holds when an answer shows a risk, and a finished work order still says no assessment was made", () => {
  const risky: RiskCheck = { ...withException, answers: { height: "no" } };
  const state = riskStepState(order(risky), none);
  assert.equal(state.done, true);
  assert.equal(state.extendedRequired, false);
  assert.equal(riskStepState(order(withException, "COMPLETED"), none).via, "exception");
});

test("only this work order: another order is still blocked, and the tasks in it follow it", () => {
  const blocked = { ...order(), id: "ao-2" };
  const lifted = order(withException);
  const tasks = [lifted, blocked];
  assert.equal(localRiskStepRefusal(tasks, lifted, "start"), null);
  assert.ok(localRiskStepRefusal(tasks, blocked, "start"));
  const inLifted = { kind: "FORM", status: "PLANNED", data: { kind: "FORM" }, workOrderId: "ao" };
  const inBlocked = { kind: "FORM", status: "PLANNED", data: { kind: "FORM" }, workOrderId: "ao-2" };
  assert.equal(localRiskStepRefusal(tasks, inLifted, "start"), null);
  assert.ok(localRiskStepRefusal(tasks, inBlocked, "start"));
  const followed = riskStepState(inLifted, localRiskStepContext(tasks, inLifted));
  assert.deepEqual([followed.via, followed.exception], ["work-order", true], "the task says that no assessment was made");
  const ownClaim = { ...inBlocked, data: { kind: "FORM", riskCheck: withException } };
  assert.ok(localRiskStepRefusal(tasks, ownClaim, "start"), "a task cannot lift its work order's step with data of its own");
});

test("the reason must not be empty: the shared schema every save goes through refuses it", () => {
  for (const empty of ["", "   "]) assert.equal(riskCheckSchema.safeParse({ exception: { reason: empty } }).success, false, JSON.stringify(empty));
  assert.equal(riskCheckSchema.safeParse({ exception: { reason: "x".repeat(1001) } }).success, false);
  assert.equal(riskCheckSchema.parse({ exception: { reason: `  ${reason} ` } }).exception?.reason, reason);
  assert.ok(RISK_EXCEPTION_DEFAULT_REASON.trim().length > 20, "a ready text to start from");
  assert.equal(riskCheckSchema.safeParse({ exception: { reason: RISK_EXCEPTION_DEFAULT_REASON } }).success, true);
});

test("who and when are the server's, whatever the client sends; a kept reason keeps them", () => {
  const forged = withRiskCheck({ kind: "WORK_ORDER" }, { ...emptyRiskCheck(), exception: { reason, by: "Någon annan", byId: "falsk", at: "2020-01-01T00:00:00.000Z" } });
  const first = riskCheckOf(stampRiskStep(forged, { created: false, stored: { riskStep: true }, exempt: false, actor, now }))!;
  assert.deepEqual(first.exception, { reason, by: "Mats Montör", byId: "u-1", at: now });
  const stored = withRiskCheck({ riskStep: true }, first);
  const later = { id: "u-2", name: "Erik" };
  const kept = riskCheckOf(stampRiskStep(forged, { created: false, stored, exempt: false, actor: later, now: "2026-11-03T09:00:00.000Z" }))!;
  assert.deepEqual(kept.exception, first.exception, "the same reason: the same person and time");
  const changed = withRiskCheck({ kind: "WORK_ORDER" }, { ...emptyRiskCheck(), exception: { reason: "Ett annat skäl", by: "", at: null } });
  const again = riskCheckOf(stampRiskStep(changed, { created: false, stored, exempt: false, actor: later, now: "2026-11-03T09:00:00.000Z" }))!;
  assert.deepEqual([again.exception?.by, again.exception?.at], ["Erik", "2026-11-03T09:00:00.000Z"], "a changed reason is the new person's");
});

test("a save that leaves the check out keeps the exception; taking it back removes it", () => {
  const stored = withRiskCheck({ riskStep: true }, { ...emptyRiskCheck(), exception: { reason, by: "Mats Montör", at: now } });
  assert.equal(riskCheckOf(stampRiskStep({ kind: "WORK_ORDER" }, { created: false, stored, exempt: false, actor, now }))?.exception?.reason, reason);
  const undone = stampRiskStep(withRiskCheck({ kind: "WORK_ORDER" }, emptyRiskCheck()), { created: false, stored, exempt: false, actor, now });
  assert.equal(riskCheckOf(undone)?.exception, undefined);
  assert.equal(riskStepState({ kind: "WORK_ORDER", status: "PLANNED", data: undone }, none).done, false, "the block is back");
});

test("the company can turn it off: on by default, a new or changed exception is refused, one already made stays", () => {
  assert.equal(riskExceptionOn({}), true);
  assert.equal(riskExceptionOn(null), true);
  assert.equal(riskExceptionOn({ riskExceptionOff: "ja" }), true, "only a real true turns it off");
  assert.equal(riskExceptionOn({ riskExceptionOff: true }), false);
  assert.equal(featureSettingsOf({}).riskException, true);
  assert.equal(featureSettingsOf({ riskException: false }).riskException, false);
  const sent = withRiskCheck({}, withException);
  assert.equal(riskExceptionRefusal(sent, null, true), null);
  assert.equal(riskExceptionRefusal(sent, null, false), RISK_EXCEPTION_OFF);
  assert.equal(riskExceptionRefusal(sent, withRiskCheck({}, { ...withException, exception: { ...exception, reason: "Annat" } }), false), RISK_EXCEPTION_OFF, "changed while off");
  assert.equal(riskExceptionRefusal(sent, sent, false), null, "made before it was turned off");
  assert.equal(riskExceptionRefusal(withRiskCheck({}, emptyRiskCheck()), sent, false), null, "it can always be taken back");
  assert.equal(riskExceptionRefusal({ kind: "WORK_ORDER" }, null, false), null);
});

test("saving a company's details never turns the choice back on", () => {
  assert.deepEqual(keepWorkAreas({ phone: "1" }, { riskExceptionOff: true }), { phone: "1", riskExceptionOff: true });
  assert.deepEqual(keepWorkAreas({ phone: "1" }, { riskExceptionOff: false }), { phone: "1" });
  assert.deepEqual(keepWorkAreas({ phone: "1" }, { riskExceptionOff: true, workAreas: ["office"] }), { phone: "1", workAreas: ["office"], riskExceptionOff: true });
});

test("the report says the assessment was not made, with the reason, who and when", () => {
  const data = withRiskCheck({}, { ...emptyRiskCheck(), exception: { reason, by: "Mats Montör", at: now } });
  assert.deepEqual(riskStepReportFacts(data)?.exception, { reason, by: "Mats Montör", at: now });
  assert.equal(riskStepReportFacts(withRiskCheck({}, emptyRiskCheck()))?.exception, null);
  const drawn: { titles: string[][]; facts: { label: string; value: string }[][] } = { titles: [], facts: [] };
  const kit = { section: (title: string, options?: { note?: string }) => { drawn.titles.push([title, options?.note ?? ""]); }, facts: (facts: { label: string; value: string }[]) => { drawn.facts.push(facts); } };
  drawRiskStep(kit as unknown as Parameters<typeof drawRiskStep>[0], data);
  assert.deepEqual(drawn.titles, [[RISK_EXCEPTION_REPORT_TITLE, reason]]);
  assert.equal(RISK_EXCEPTION_REPORT_TITLE, "Riskbedömning ej gjord: arbetet redan utfört");
  assert.equal(drawn.facts[0][0].value, "Mats Montör");
  assert.ok(drawn.facts[0][1].value, "the time");
});

test("the job's state tells the truth to Workflow AI, API and MCP", () => {
  const task = { id: "t1", kind: "WORK_ORDER", title: "Byte av central", status: "PLANNED", dueDate: "2026-11-12",
    data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" }, riskStep: true, riskCheck: withException } } as unknown as JobStateInput["task"];
  const job = jobState({ task, risk: riskStepState(task, none), mayEdit: true, today: "2026-11-02", now: new Date(now) });
  assert.equal(job.canStartTime, true);
  assert.equal(job.startTimeBlockedBy, undefined);
  assert.match(job.riskStep.text, /^Ej gjord: arbetet redan utfört\. Skäl: Tillbudet/);
  assert.ok(job.riskStep.applies && job.riskStep.level === "Ej gjord");
  assert.ok(!(job.completeBlockedBy ?? []).some((line) => /riskbedömningen/.test(line)), "Färdigställ only waits for the job's own requirements");
});

test("the server's save, Local and the demo ask the company's choice before they stamp", () => {
  const route = readFileSync("lib/workflow/risk-step-server.ts", "utf8");
  assert.match(route, /riskExceptionRefusal\(task\.data, stored\?\.data \?\? null, await readRiskExceptionAllowed\(organizationId, db\)\)/);
  assert.ok(route.indexOf("riskExceptionRefusal(task.data") < route.indexOf("task.data = stampRiskStep("), "before the stamp");
  assert.match(readFileSync("features/demo/demo-backend.ts", "utf8"), /riskExceptionRefusal\(data\.data, stored\?\.data \?\? null, ctx\.db\.settings\.riskException !== false\)/);
  assert.match(readFileSync("features/kfid/local-workspace-store.ts", "utf8"), /riskExceptionRefusal\(parsed\.data, current\?\.data \?\? null, options\.riskExceptionAllowed !== false\)/);
  const workspace = readFileSync("app/api/workspace/route.ts", "utf8");
  assert.match(workspace, /action === "risk_exception"\) \{\s+requireAdmin\(ctx\);/, "only the company's admin changes it");
  assert.match(workspace, /action: "company_risk_exception"/, "audited");
});

test("a confirmed risk step is part of the screen's start: Avbryt neither asks nor takes the confirmation back", async () => {
  const { withCurrentRiskCheck } = await import("../lib/workflow/risk-step");
  const confirmed = riskCheckSchema.parse({ ...emptyRiskCheck(), confirmedBy: "Elon", confirmedAt: "2026-11-20T08:00:00.000Z" });
  const start = { kind: "WORK_ORDER", details: { note: "före" } };
  const now = withRiskCheck({ kind: "WORK_ORDER", details: { note: "före" } }, confirmed);
  assert.deepEqual(withCurrentRiskCheck(start, now), now, "only the risk check differed, so nothing is left to discard");
  const edited = withRiskCheck({ kind: "WORK_ORDER", details: { note: "ändrad" } }, confirmed);
  assert.deepEqual(withCurrentRiskCheck(start, edited), now, "other changes still count, and Kasta keeps the confirmation");
  assert.deepEqual(withCurrentRiskCheck(withRiskCheck(start, confirmed), { kind: "WORK_ORDER" }), start);
  assert.match(readFileSync("features/workflow/workflow-task-editor.tsx", "utf8"), /const start = screenStart\.current \? withSavedRisk\(screenStart\.current\) : null;/);
});
