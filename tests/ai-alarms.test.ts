import assert from "node:assert/strict";
import test from "node:test";
import { aiAlarmStateSchema, azureRefusalWorthAlarm, budgetAlarmText, dueBudgetThresholds, refusalAlarmText, refusalDue, spikeDue, SPIKE_FLOOR_ORE } from "../lib/ai/ai-alarms";
import { mcpAllowedOf } from "../lib/integrations/mcp-access";
import { quotaAlarmAction, quotaAlarmText } from "../lib/ai/weekly-quota";

// Driftlarm för Workflow AI (2026-11-21, F5). Synthetic amounts.

test("the month's budget alarms at 50, 80 and 100 %, each threshold once a month", () => {
  const month = "2026-11";
  const due = (spentOre: number, sent: number[] = [], savedMonth = month) => dueBudgetThresholds({ spentOre, budgetKr: 500, month, state: { budget: { month: savedMonth, sent } } });
  assert.deepEqual(due(24_999), []);
  assert.deepEqual(due(25_000), [50]);
  assert.deepEqual(due(40_000), [50, 80]);
  assert.deepEqual(due(40_000, [50]), [80]);
  assert.deepEqual(due(50_000, [50, 80]), [100]);
  assert.deepEqual(due(90_000, [50, 80, 100]), []);
  // A new month starts over.
  assert.deepEqual(due(30_000, [50, 80, 100], "2026-10"), [50]);
  // No budget: no alarms.
  assert.deepEqual(dueBudgetThresholds({ spentOre: 1_000_000, budgetKr: 0, month, state: {} }), []);
  const text = budgetAlarmText({ threshold: 100, spentOre: 51_234, budgetKr: 500, link: "https://app.example/?view=ai_admin" });
  assert.match(text.subject, /nått månadsbudgeten/);
  assert.match(text.text, /512,34 kr av budgeten 500 kr/);
  assert.match(text.text, /Azure stoppar inte av sig själv/);
});

test("an unusual day is more than three ordinary days of the last week, above a floor, once a day", () => {
  const day = "2026-11-21";
  assert.equal(spikeDue({ todayOre: SPIKE_FLOOR_ORE - 1, lastSevenDaysOre: 0, day, state: {} }), false, "a quiet week's first questions are never an alarm");
  assert.equal(spikeDue({ todayOre: 5_000, lastSevenDaysOre: 7 * 1_000, day, state: {} }), true);
  assert.equal(spikeDue({ todayOre: 2_900, lastSevenDaysOre: 7 * 1_000, day, state: {} }), false);
  assert.equal(spikeDue({ todayOre: 5_000, lastSevenDaysOre: 7 * 1_000, day, state: { spikeDay: day } }), false);
});

test("a refused Azure call (key, quota, deployment) alarms once a day; Azure's own text and the key never reach the mail", () => {
  assert.equal(azureRefusalWorthAlarm({ status: 401 }), true);
  assert.equal(azureRefusalWorthAlarm({ status: 403 }), true);
  assert.equal(azureRefusalWorthAlarm({ status: 404, code: "DeploymentNotFound" }), true);
  assert.equal(azureRefusalWorthAlarm({ status: 429 }), true);
  assert.equal(azureRefusalWorthAlarm({ status: 503 }), false, "Azure's own passing fault");
  assert.equal(azureRefusalWorthAlarm({ name: "APIConnectionTimeoutError" }), false);
  assert.equal(azureRefusalWorthAlarm(null), false);
  assert.equal(refusalDue({}, "2026-11-21"), true);
  assert.equal(refusalDue({ refusalDay: "2026-11-21" }, "2026-11-21"), false);
  assert.equal(refusalDue({ refusalDay: "2026-11-20" }, "2026-11-21"), true);
  const secret = "hemlig" + "k".repeat(30);
  const mail = refusalAlarmText({ error: { status: 429, message: secret }, deployment: "std-mini", link: "https://app.example/x" });
  assert.equal(mail.subject, "Workflow AI svarar inte (Azure)");
  assert.match(mail.text, /^Azure nekar Workflow AI: .*kvoten/);
  assert.equal(mail.text.includes(secret), false);
  // Rubbish stored as the state reads as nothing told.
  assert.deepEqual(aiAlarmStateSchema.parse("rubbish"), {});
});

test("a company's full weekly quota alarms once a week, and the mail names the quota but no question", () => {
  assert.equal(quotaAlarmAction("2026-11-16"), "ai_week_quota:2026-11-16:100");
  const mail = quotaAlarmText({ company: "Exempel El AB", quotaOre: 343, link: "https://app.example/?view=customer_companies" });
  assert.match(mail.text, /Exempel El AB har använt hela veckans kvot för Workflow AI \(3,43 kr\)/);
  assert.match(mail.text, /pausade för företaget till måndag 00:00/);
});

test("Tillåt egna AI-appar (MCP): off in Cloud until the admin turns it on, on in Community unless turned off", () => {
  assert.equal(mcpAllowedOf({}, false), false);
  assert.equal(mcpAllowedOf({ mcpAllowed: true }, false), true);
  assert.equal(mcpAllowedOf({}, true), true);
  assert.equal(mcpAllowedOf({ mcpAllowed: false }, true), false);
});
