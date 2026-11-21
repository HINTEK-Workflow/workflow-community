import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { EMPTY_RULE_STATE, evaluateReading, evaluateTime, holds, ruleEvent, ruleInputSchema, ruleSummary, type Rule, type RuleState } from "../lib/machine/signal-rules";
import { freshlyAuthenticated, MACHINE_CONFIRM_WINDOW_SECONDS, REAUTH_WINDOW_SECONDS } from "../lib/auth/session-rules";
import { parseEvent } from "../lib/machine/intake";

// Integrationsmotorn E3 (2026-10-24): rules in data, without a database. Every comparison, hysteresis (no flutter in
// noise), duration, changed, stale, a rule that goes out gives cleared, and the confirmation within 15 minutes.
const t0 = new Date("2026-10-24T10:00:00Z");
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
const rule = (patch: Partial<Rule>): Rule => ({ id: "r1", operator: "gt", value: 80, hysteresis: null, forSeconds: 0, ...patch });
function run(r: Rule, values: [number, number | boolean | string][], start: RuleState = { ...EMPTY_RULE_STATE }) {
  let state = start;
  const out: string[] = [];
  for (const [seconds, value] of values) {
    const result = evaluateReading(r, state, { value, at: at(seconds) });
    state = result.state;
    if (result.transition) out.push(`${result.transition}@${seconds}`);
  }
  return { state, out };
}

test("every comparison", () => {
  assert.equal(holds({ operator: "eq", value: true, hysteresis: null }, true, false), true);
  assert.equal(holds({ operator: "eq", value: "auto", hysteresis: null }, "manuell", false), false);
  assert.equal(holds({ operator: "neq", value: "auto", hysteresis: null }, "manuell", false), true);
  assert.equal(holds({ operator: "gt", value: 80, hysteresis: null }, 80, false), false);
  assert.equal(holds({ operator: "gte", value: 80, hysteresis: null }, 80, false), true);
  assert.equal(holds({ operator: "lt", value: 5, hysteresis: null }, 4.9, false), true);
  assert.equal(holds({ operator: "lte", value: 5, hysteresis: null }, 5.1, false), false);
  assert.equal(holds({ operator: "gt", value: 80, hysteresis: null }, "90", false), false, "a value of the wrong type never holds");
});

test("hysteresis: no flutter in noise around the limit, out only below the band", () => {
  const noisy: [number, number][] = [[0, 79], [10, 81], [20, 79.5], [30, 80.5], [40, 79], [50, 77.9], [60, 81]];
  assert.deepEqual(run(rule({ hysteresis: 2 }), noisy).out, ["raise@10", "clear@50", "raise@60"]);
  assert.deepEqual(run(rule({}), noisy).out, ["raise@10", "clear@20", "raise@30", "clear@40", "raise@60"], "without hysteresis it flutters");
  assert.deepEqual(run(rule({ operator: "lt", value: 2, hysteresis: 0.5 }), [[0, 1], [5, 2.2], [10, 2.6]]).out, ["raise@0", "clear@10"]);
});

test("duration: the condition must hold in a row for forSeconds; a break starts over", () => {
  const slow = rule({ forSeconds: 60 });
  assert.deepEqual(run(slow, [[0, 90], [30, 90], [59, 90], [60, 90], [61, 90]]).out, ["raise@60"]);
  assert.deepEqual(run(slow, [[0, 90], [30, 70], [40, 90], [90, 90], [100, 90]]).out, ["raise@100"]);
  // Time alone: the job (or the next call) strikes when the duration has passed and nothing new came.
  const pending = run(slow, [[0, 90]]).state;
  assert.equal(evaluateTime(slow, pending, { lastSeenAt: at(0) }, at(30)), null);
  const timed = evaluateTime(slow, pending, { lastSeenAt: at(0) }, at(61));
  assert.equal(timed?.transition, "raise");
  assert.equal(evaluateTime(slow, timed!.state, { lastSeenAt: at(0) }, at(120)), null, "once");
});

test("never backwards: an older reading than the last one tried changes nothing", () => {
  const { state } = run(rule({}), [[100, 90]]);
  const older = evaluateReading(rule({}), state, { value: 10, at: at(50) });
  assert.equal(older.transition, null);
  assert.deepEqual(older.state, state);
  assert.equal(evaluateReading(rule({}), state, { value: 10, at: at(100) }).transition, null, "the same time again is a duplicate");
});

test("changed: each change is one event, the first value only sets the start", () => {
  assert.deepEqual(run(rule({ operator: "changed", value: null }), [[0, "auto"], [10, "auto"], [20, "manuell"], [30, "manuell"], [40, "auto"]]).out, ["raise@20", "raise@40"]);
});

test("stale: strikes when the signal has not been heard for the rule's seconds, a new value clears it", () => {
  const quiet = rule({ operator: "stale", value: 900 });
  assert.equal(evaluateTime(quiet, { ...EMPTY_RULE_STATE }, { lastSeenAt: at(0) }, at(899)), null);
  const struck = evaluateTime(quiet, { ...EMPTY_RULE_STATE }, { lastSeenAt: at(0) }, at(900))!;
  assert.equal(struck.transition, "raise");
  assert.equal(evaluateTime(quiet, struck.state, { lastSeenAt: at(0) }, at(2000)), null, "once until heard again");
  assert.equal(evaluateReading(quiet, struck.state, { value: 1, at: at(2100) }).transition, "clear");
});

test("the outcome as a canonical event: an alarm goes out as cleared, a run state as its opposite, a diagnosis only once", () => {
  const base = { id: "r9", outcomeCode: "TEMP_HIGH", outcomeSeverity: "fault", outcomeText: "Hög temperatur" };
  const raised = ruleEvent({ ...base, outcomeType: "alarm", outcomeState: null }, "raise", at(5))!;
  assert.deepEqual([raised.type, raised.state, raised.severity, raised.code], ["alarm", "raised", "fault", "TEMP_HIGH"]);
  assert.equal(raised.eventId, `rule-r9-raise-${at(5).getTime()}`, "the same transition never makes two events");
  assert.equal(ruleEvent({ ...base, outcomeType: "alarm", outcomeState: null }, "clear", at(6))!.state, "cleared");
  assert.equal(ruleEvent({ ...base, outcomeType: "state", outcomeState: "stopped" }, "raise", at(6))!.state, "stopped");
  assert.equal(ruleEvent({ ...base, outcomeType: "state", outcomeState: "stopped" }, "clear", at(7))!.state, "running");
  assert.equal(ruleEvent({ ...base, outcomeType: "diagnosis", outcomeState: null }, "clear", at(7)), null);
  // Every event a rule makes passes the intake's own rules for an event.
  for (const event of [raised, ruleEvent({ ...base, outcomeType: "state", outcomeState: "running" }, "raise", at(8))!, ruleEvent({ ...base, outcomeType: "diagnosis", outcomeState: null }, "raise", at(9))!]) {
    const parsed = parseEvent({ ...event, occurredAt: event.occurredAt.toISOString(), state: event.state ?? undefined, basis: event.basis ?? undefined, values: undefined }, at(10));
    assert.equal(parsed.ok, true, JSON.stringify(event));
  }
});

test("the rule's form: a fixed list, values of the right kind, a state only for run states", () => {
  const ok = { operator: "gt", value: 80, outcomeType: "alarm", outcomeCode: "T1", outcomeSeverity: "fault" };
  assert.equal(ruleInputSchema.safeParse(ok).success, true);
  for (const bad of [
    { ...ok, operator: "between" }, { ...ok, value: "80" }, { ...ok, operator: "changed" }, { ...ok, operator: "eq", hysteresis: 1 },
    { ...ok, operator: "stale", value: 10 }, { ...ok, outcomeType: "state" }, { ...ok, outcomeState: "stopped" }, { ...ok, outcomeCode: "har blanksteg" },
    { ...ok, forSeconds: 90_000 }, { ...ok, outcomeSeverity: "emergency" }, { ...ok, value: null },
  ]) assert.equal(ruleInputSchema.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(ruleSummary(ruleInputSchema.parse({ ...ok, hysteresis: 2, forSeconds: 30 })), "När värdet är större än 80 (hysteres 2, i 30 s): larm T1");
  assert.equal(ruleSummary(ruleInputSchema.parse({ operator: "eq", value: false, outcomeType: "state", outcomeState: "stopped", outcomeCode: "RUN", outcomeSeverity: "info" })), "När värdet är lika med false: driftläge stoppad");
});

test("bekräfta innan ändring: a profile or rule change needs a sign-in or confirmation within 15 minutes, others 10", () => {
  assert.equal(MACHINE_CONFIRM_WINDOW_SECONDS, 15 * 60);
  const now = Date.parse("2026-10-24T12:00:00Z");
  const twelveMinutes = Math.floor((now - 12 * 60_000) / 1000);
  assert.equal(freshlyAuthenticated(twelveMinutes, null, now), false, "the ordinary 10 minutes");
  assert.equal(freshlyAuthenticated(twelveMinutes, null, now, MACHINE_CONFIRM_WINDOW_SECONDS), true);
  assert.equal(freshlyAuthenticated(Math.floor((now - 16 * 60_000) / 1000), null, now, MACHINE_CONFIRM_WINDOW_SECONDS), false);
  assert.equal(freshlyAuthenticated(undefined, new Date(now - 14 * 60_000), now, MACHINE_CONFIRM_WINDOW_SECONDS), true, "a confirmation with password or code counts");
  assert.equal(REAUTH_WINDOW_SECONDS, 600, "the other sensitive changes are unchanged");
  const handler = readFileSync("lib/api-handlers/machine-sources.ts", "utf8");
  const confirmed = /const CONFIRMED_ACTIONS = new Set\(\[([^\]]+)\]\)/.exec(handler)?.[1] ?? "";
  for (const action of ["save_profile", "import_profile", "delete_profile", "set_profile", "create_rule", "update_rule", "delete_rule"]) assert.match(confirmed, new RegExp(`"${action}"`), action);
  assert.doesNotMatch(confirmed, /preview_profile/, "trying a profile on a sample needs no confirmation");
  const post = handler.slice(handler.indexOf("export async function POST"));
  assert.ok(post.indexOf("requireFreshAuth(ctx.user.id, ctx.auth, MACHINE_CONFIRM_WINDOW_SECONDS)") < post.indexOf("isRuleCommand(input)"));
  assert.ok(post.indexOf("requireFreshAuth(ctx.user.id, ctx.auth, MACHINE_CONFIRM_WINDOW_SECONDS)") < post.indexOf("isProfileCommand(input)"));
  if (existsSync("docs/beslut/projekt-jobb-och-planering.md")) assert.match(readFileSync("docs/beslut/projekt-jobb-och-planering.md", "utf8"), /Bekräfta innan ändring \(2026-10-24/);
});

test("the migration is additive, the job is known to run-job.sh, no manufacturer and no code from the rule is run", () => {
  const sql = readFileSync("prisma/migrations/20261024190000_machine_signal_rules/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "MachineSignalRule"/);
  assert.match(sql, /FOREIGN KEY \("signalId", "organizationId"\) REFERENCES "MachineSignal"\("id", "organizationId"\) ON DELETE CASCADE/);
  assert.match(sql, /CHECK \("operator" IN \('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'changed', 'stale'\)\)/);
  assert.doesNotMatch(sql, /^\s*(DELETE|UPDATE|TRUNCATE|DROP)\b/im);
  assert.match(readFileSync("scripts/ops/run-job.sh", "utf8"), /\|machine:rules[|)]/);
  assert.match(readFileSync("package.json", "utf8"), /"machine:rules": "tsx scripts\/ops\/job\.ts machine:rules scripts\/machine\/run-rules\.ts"/);
  for (const path of ["lib/machine/signal-rules.ts", "lib/machine/rule-engine.ts", "lib/machine/rule-admin.ts", "features/integrations/machine-rules.tsx"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /teltonika|rutos|rut200|siemens|schneider/i, path);
    assert.doesNotMatch(source, /\beval\(|new Function/, path);
  }
  assert.match(readFileSync("features/integrations/machine-rules.tsx", "utf8"), /RULE_SAFETY_TEXT/, "the page says Workflow is not an alarm or safety system");
});
