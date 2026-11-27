import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FormSchedule } from "../lib/workflow/form-schedule";
import { PLANNING_ROUND_LIMIT, PLANNING_ROUND_MAX_DAYS, planningRoundMatchesStatus, planningRoundPeriod, planningRounds } from "../lib/workflow/planning-rounds";
import { createDemoDatabase } from "../features/demo/demo-data";

/** Driftronder i Planeringen (2026-10-06): occurrences computed from the schedules for the shown period, never stored. */
const schedule = (id: string, rule: Partial<FormSchedule["rule"]>, extra: Partial<FormSchedule> = {}): FormSchedule => ({
  id, version: 1, title: `Rond ${id}`, templateId: "form-1", templateName: "Tillsyn", assignedToUserId: "u1", assignedToName: "Person", active: true, reminders: { bell: true, email: false },
  rule: { frequency: "DAILY", interval: 1, weekdays: [], startDate: "2026-10-01", endDate: "", ...rule }, ...extra,
});
const protocol = (id: string, scheduleId: string, occurrence: string, status: string) => ({ id, status, data: { details: { values: { round: { scheduleId, occurrence } } } } });

test("rounds in a period carry their state from the protocols and a start link on every day", () => {
  const { rounds, truncated } = planningRounds(
    [schedule("weekly", { frequency: "WEEKLY", weekdays: [1, 4] }), schedule("paused", {}, { active: false })],
    [protocol("t1", "weekly", "2026-10-05", "COMPLETED"), protocol("t2", "weekly", "2026-10-08", "IN_PROGRESS"), protocol("t3", "other", "2026-10-12", "COMPLETED")],
    { from: "2026-10-01", to: "2026-10-15" }, "2026-10-09");
  assert.equal(truncated, false);
  // Mon 5, Thu 1, 8, 15 and Mon 12; the paused round is left out.
  assert.deepEqual(rounds.map((round) => [round.date, round.state]), [["2026-10-01", "missed"], ["2026-10-05", "done"], ["2026-10-08", "started"], ["2026-10-12", "upcoming"], ["2026-10-15", "upcoming"]]);
  assert.equal(rounds[1].taskId, "t1");
  assert.match(rounds[1].href ?? "", /taskId=t1/);
  assert.match(rounds[0].href ?? "", /scheduleId=weekly&occurrence=2026-10-01/);
  // "Planering är bara en planering" (2026-10-07): an occurrence ahead can be started now, linked to its own day.
  assert.match(rounds[3].href, /scheduleId=weekly&occurrence=2026-10-12/);
  assert.ok(rounds.every((round) => typeof round.href === "string" && round.href.startsWith("/?view=workflow_task&taskType=FORM")), "every occurrence can be started or opened");
  assert.ok(rounds.every((round) => round.key === `${round.scheduleId}:${round.date}` && round.ruleText.startsWith("Veckovis")));
  const today = planningRounds([schedule("daily", {})], [], { from: "2026-10-09", to: "2026-10-09" }, "2026-10-09").rounds;
  assert.deepEqual(today.map((round) => round.state), ["due"]);
});

test("the period is bounded and a long period of daily rounds is cut with a notice", () => {
  assert.deepEqual(planningRoundPeriod(null, null, "2026-10-06"), { from: "2026-10-06", to: "2026-11-05" });
  assert.deepEqual(planningRoundPeriod("2026-10-10", "2026-10-01", "2026-10-06"), { from: "2026-10-10", to: "2026-10-10" });
  assert.deepEqual(planningRoundPeriod("bad'", "2027-12-31", "2026-10-06").from, "2026-10-06");
  const long = planningRoundPeriod("2026-01-01", "2030-01-01", "2026-10-06");
  assert.equal((Date.parse(long.to) - Date.parse(long.from)) / 86_400_000 + 1, PLANNING_ROUND_MAX_DAYS);
  const many = Array.from({ length: 5 }, (_, index) => schedule(`d${index}`, { startDate: "2026-01-01" }));
  const result = planningRounds(many, [], long, "2026-10-06");
  assert.equal(result.rounds.length, PLANNING_ROUND_LIMIT);
  assert.equal(result.truncated, true);
  assert.ok(result.rounds.every((round, index) => !index || result.rounds[index - 1].date <= round.date));
});

test("Planning's status filter maps the round states", () => {
  assert.equal(planningRoundMatchesStatus({ state: "done" }, "COMPLETED"), true);
  assert.equal(planningRoundMatchesStatus({ state: "started" }, "IN_PROGRESS"), true);
  assert.equal(planningRoundMatchesStatus({ state: "missed" }, "PLANNED"), true);
  assert.equal(planningRoundMatchesStatus({ state: "upcoming" }, "CANCELED"), false);
  assert.equal(planningRoundMatchesStatus({ state: "upcoming" }, "all"), true);
});

test("the demo has invented rounds that Planning shows, and Cloud reads them by organization and readable form", () => {
  const db = createDemoDatabase(new Date("2026-10-06T10:00:00Z"));
  const { rounds } = planningRounds(db.schedules, db.tasks, { from: "2026-10-01", to: "2026-10-31" }, "2026-10-06");
  assert.ok(rounds.some((round) => round.scheduleId === "demo-schedule-reservkraft"));
  assert.ok(rounds.every((round) => db.forms.some((form) => form.id === db.schedules.find((item) => item.id === round.scheduleId)?.templateId)));
  const server = readFileSync("lib/kfid/rounds-server.ts", "utf8");
  const planning = server.slice(server.indexOf("export async function loadPlanningRounds"));
  assert.match(planning, /loadReadableSchedules\(ctx\)/);
  assert.match(planning, /"organizationId" = \$\{ctx\.organizationId\}/);
  assert.match(server, /where: \{ organizationId: ctx\.organizationId, deletedAt: null \}/);
  // Rounds are never written as planned activities.
  assert.doesNotMatch(readFileSync("lib/workflow/planning-rounds.ts", "utf8"), /plannedActivity|prisma/);
});

test("a round whose form is not published shows the warning and no start link; a protocol still opens (2026-10-24)", () => {
  const { rounds } = planningRounds([schedule("draft", {}, { templateMissing: true, templateUnpublished: true }), schedule("gone", {}, { templateMissing: true })],
    [protocol("t1", "draft", "2026-10-02", "IN_PROGRESS")], { from: "2026-10-02", to: "2026-10-03" }, "2026-10-03");
  const at = (id: string, date: string) => rounds.find((round) => round.scheduleId === id && round.date === date)!;
  assert.equal(at("draft", "2026-10-03").formNotice, "Formuläret är inte publicerat");
  assert.equal(at("draft", "2026-10-03").href, "/?view=rounds", "no start address, Driftronder instead");
  assert.match(at("draft", "2026-10-02").href, /taskId=t1/, "the started protocol still opens");
  assert.equal(at("gone", "2026-10-03").formNotice, "Formuläret är borttaget");
  assert.equal(planningRounds([schedule("ok", {})], [], { from: "2026-10-03", to: "2026-10-03" }, "2026-10-03").rounds[0]!.formNotice, null);
});
