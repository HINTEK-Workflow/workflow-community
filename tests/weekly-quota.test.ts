import assert from "node:assert/strict";
import test from "node:test";
import { QUOTA_FULL_REASON, quotaDecision, quotaView, quotaWeek, weeklyQuotaOre } from "../lib/ai/weekly-quota";
import { DEFAULT_AI_CREDIT_SETTINGS } from "../lib/ai/credit-settings";

// Veckokvot för Workflow AI (2026-11-21). Synthetic amounts.
const settings = { aiSharePercent: 10, weeklyQuotaMinKr: 2, weeklyQuotaMaxKr: 50 };

test("the week turns Monday 00:00 Swedish time, in winter and in summer time", () => {
  // Sunday 23:59 Swedish time (winter, UTC+1) still belongs to the week that began on Monday 17 November.
  const sunday = quotaWeek(new Date("2026-11-22T22:59:00.000Z"));
  assert.equal(sunday.key, "2026-11-16");
  assert.equal(sunday.start.toISOString(), "2026-11-15T23:00:00.000Z");
  assert.equal(sunday.end.toISOString(), "2026-11-22T23:00:00.000Z");
  // One minute later it is Monday 00:00 and a new week.
  const monday = quotaWeek(new Date("2026-11-22T23:00:00.000Z"));
  assert.equal(monday.key, "2026-11-23");
  assert.equal(monday.start.toISOString(), "2026-11-22T23:00:00.000Z");
  // Summer time (UTC+2): Monday 00:00 is 22:00 UTC on Sunday.
  assert.equal(quotaWeek(new Date("2026-06-10T12:00:00.000Z")).start.toISOString(), "2026-06-07T22:00:00.000Z");
  // The week of the clock change (29 March 2026) is still seven days from Monday to Monday.
  const change = quotaWeek(new Date("2026-03-27T12:00:00.000Z"));
  assert.equal(change.start.toISOString(), "2026-03-22T23:00:00.000Z");
  assert.equal(change.end.toISOString(), "2026-03-29T22:00:00.000Z");
});

test("the quota follows what the company pays: share × monthly × 12 / 52, within the lowest and highest", () => {
  assert.equal(DEFAULT_AI_CREDIT_SETTINGS.aiSharePercent, 10);
  // 149 kr a month: 10 % is 14,90 kr a month, 3,43 kr a week ("ganska snål").
  assert.deepEqual(weeklyQuotaOre({ monthlyPriceOre: 14_900, settings }), { quotaOre: 343, source: "price" });
  // 499 kr a month: 11,51 kr a week.
  assert.deepEqual(weeklyQuotaOre({ monthlyPriceOre: 49_900, settings }), { quotaOre: 1_151, source: "price" });
  // Below the lowest: the lowest. Above the highest: the highest.
  assert.deepEqual(weeklyQuotaOre({ monthlyPriceOre: 4_900, settings }), { quotaOre: 200, source: "minimum" });
  assert.equal(weeklyQuotaOre({ monthlyPriceOre: 5_000_000, settings }).quotaOre, 5_000);
  // A company without a price (a trial, no subscription): the lowest.
  assert.deepEqual(weeklyQuotaOre({ monthlyPriceOre: null, settings }), { quotaOre: 200, source: "minimum" });
  assert.deepEqual(weeklyQuotaOre({ monthlyPriceOre: 0, settings }), { quotaOre: 200, source: "minimum" });
  // The company's own quota wins, also 0 (no included AI at all).
  assert.deepEqual(weeklyQuotaOre({ monthlyPriceOre: 49_900, ownKr: 25, settings }), { quotaOre: 2_500, source: "own" });
  assert.equal(weeklyQuotaOre({ monthlyPriceOre: 49_900, ownKr: 0, settings }).quotaOre, 0);
  // A highest below the lowest counts as the lowest.
  assert.equal(weeklyQuotaOre({ monthlyPriceOre: 5_000_000, settings: { ...settings, weeklyQuotaMaxKr: 1 } }).quotaOre, 200);
});

test("80 % warns and 100 % is full; no quota means never full", () => {
  const now = new Date("2026-11-19T10:00:00.000Z");
  const quota = { quotaOre: 1_000, source: "price" as const };
  const at = (spentOre: number) => quotaView({ spentOre, quota, now });
  assert.deepEqual([at(0).warn, at(0).full, at(0).usedPercent], [false, false, 0]);
  assert.deepEqual([at(799).warn, at(799).full, at(799).usedPercent], [false, false, 79]);
  assert.deepEqual([at(800).warn, at(800).full, at(800).usedPercent], [true, false, 80]);
  assert.deepEqual([at(999).warn, at(999).full], [true, false]);
  assert.deepEqual([at(1_000).warn, at(1_000).full, at(1_000).usedPercent], [true, true, 100]);
  assert.equal(at(1_000).opensAt, "2026-11-22T23:00:00.000Z", "it opens again Monday 00:00");
  const none = quotaView({ spentOre: 1_000_000, quota: { quotaOre: 0, source: "minimum" }, now });
  assert.deepEqual([none.warn, none.full, none.usedPercent], [false, false, 0]);
});

test("a full quota pauses the included AI until Monday, unless the admin chose credits and the installation has them", () => {
  const now = new Date("2026-11-19T10:00:00.000Z");
  const quota = { quotaOre: 1_000, source: "price" as const };
  const full = quotaView({ spentOre: 1_200, quota, now });
  const half = quotaView({ spentOre: 500, quota, now });
  assert.deepEqual(quotaDecision({ view: half, continueOnCredits: false, creditSystem: true }), { mode: "included" });
  assert.deepEqual(quotaDecision({ view: full, continueOnCredits: false, creditSystem: true }), { mode: "paused", reason: QUOTA_FULL_REASON });
  assert.deepEqual(quotaDecision({ view: full, continueOnCredits: true, creditSystem: true }), { mode: "credits" });
  assert.deepEqual(quotaDecision({ view: full, continueOnCredits: true, creditSystem: false }), { mode: "paused", reason: QUOTA_FULL_REASON }, "no credits to fall back on");
  assert.match(QUOTA_FULL_REASON, /Veckans kvot är slut\. Workflow AI öppnar igen måndag 00:00\./);
});
