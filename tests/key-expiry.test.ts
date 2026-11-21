import assert from "node:assert/strict";
import test from "node:test";
import { dueExpiryAlarms, expiryAlarmMark, expiryAlarmText, expiryCounts, expiryDateProblem, expiryDaysLeft, expiryStage, expiryView } from "../lib/secrets/key-expiry";
import { keyExpiryState, parseCentralState } from "../lib/secrets/central-state";

// 2026-11-14 10:00 in Stockholm.
const now = new Date("2026-11-14T09:00:00Z");

test("days left count whole Swedish days to the last valid day", () => {
  assert.equal(expiryDaysLeft("2027-11-14", now), 365);
  assert.equal(expiryDaysLeft("2026-11-14", now), 0, "the last day is today");
  assert.equal(expiryDaysLeft("2026-11-13", now), -1);
  // Just after midnight in Stockholm it is already the next day, although UTC still says the 14th.
  assert.equal(expiryDaysLeft("2026-11-15", new Date("2026-11-14T23:30:00Z")), 0);
});

test("the card says the date, the days left and the tone", () => {
  assert.deepEqual([expiryView("2027-11-14", now).text, expiryView("2027-11-14", now).tone], ["Gäller till 2027-11-14 (365 dagar kvar)", "neutral"]);
  assert.equal(expiryView("2026-12-14", now).tone, "warning", "30 days left warns");
  assert.equal(expiryView("2026-12-15", now).tone, "neutral", "31 days left does not");
  assert.equal(expiryView("2026-11-15", now).text, "Gäller till 2026-11-15 (1 dag kvar)");
  assert.equal(expiryView("2026-11-14", now).text, "Gäller till 2026-11-14 (sista dagen i dag)");
  const gone = expiryView("2026-11-10", now);
  assert.deepEqual([gone.tone, gone.expired, gone.text], ["danger", true, "Gäller till 2026-11-10 (gick ut för 4 dagar sedan)"]);
  assert.deepEqual(expiryCounts(["2026-11-10", "2026-11-20", "2027-11-14", null, undefined], now), { expired: 1, soon: 1 });
});

test("the stages are 30, 14, 7 and 1 day(s) before, then expired", () => {
  assert.equal(expiryStage(31), null);
  assert.equal(expiryStage(30), "30");
  assert.equal(expiryStage(15), "30");
  assert.equal(expiryStage(14), "14");
  assert.equal(expiryStage(8), "14");
  assert.equal(expiryStage(7), "7");
  assert.equal(expiryStage(2), "7");
  assert.equal(expiryStage(1), "1");
  assert.equal(expiryStage(0), "1", "the last day is still the one-day stage");
  assert.equal(expiryStage(-1), "ute");
});

test("each stage is sent once, and an expired key once a week", () => {
  const items = [{ id: "openai", label: "OpenAI – API-nyckel", on: "2026-11-24" }];
  const first = dueExpiryAlarms(items, {}, now);
  assert.equal(first.length, 1);
  assert.equal(first[0].mark, "2026-11-24:14");
  assert.equal(dueExpiryAlarms(items, { openai: first[0].mark }, now).length, 0, "the same stage is not sent again");
  assert.equal(dueExpiryAlarms(items, { openai: first[0].mark }, new Date("2026-11-17T09:00:00Z")).length, 1, "7 days before is a new stage");
  assert.equal(dueExpiryAlarms([{ ...items[0], on: "2026-12-24" }], { openai: first[0].mark }, now).length, 0, "40 days left: nothing");
  assert.equal(dueExpiryAlarms([{ ...items[0], on: "2026-12-10" }], { openai: first[0].mark }, now).length, 1, "a new date starts over");
  // Expired: week 0 from the day after, week 1 a week later.
  const day = (iso: string) => new Date(`${iso}T09:00:00Z`);
  assert.equal(expiryAlarmMark("2026-11-24", day("2026-11-25")), "2026-11-24:ute0");
  assert.equal(expiryAlarmMark("2026-11-24", day("2026-12-01")), "2026-11-24:ute0");
  assert.equal(expiryAlarmMark("2026-11-24", day("2026-12-02")), "2026-11-24:ute1");
  assert.equal(expiryAlarmMark("2027-11-14", now), null);
  const mail = expiryAlarmText(first);
  assert.match(mail.subject, /OpenAI – API-nyckel: nyckeln går snart ut/);
  assert.match(mail.text, /gäller till 2026-11-24 \(10 dagar kvar\)/);
  assert.doesNotMatch(mail.text, /sk-/);
});

test("a date is saved as ÅÅÅÅ-MM-DD; a past date is allowed, empty removes it", () => {
  assert.equal(expiryDateProblem(""), null);
  assert.equal(expiryDateProblem("2027-11-14"), null);
  assert.equal(expiryDateProblem("2020-01-01"), null, "a past date may be saved and shows as expired");
  assert.match(expiryDateProblem("14/11/2027") ?? "", /ÅÅÅÅ-MM-DD/);
  assert.match(expiryDateProblem("2027-02-30") ?? "", /finns inte/);
  assert.match(expiryDateProblem("1999-12-31") ?? "", /2000 och 2100/);
});

test("the dates are a part of their own beside the central keys, kept when the entries change", () => {
  const state = parseCentralState({ entries: {}, keyExpiry: { dates: { openai: { on: "2027-11-14", updatedBy: "Admin" } }, alarmed: { openai: "2027-11-14:30" } }, vault: { x: 1 } });
  assert.deepEqual(keyExpiryState(state).dates.openai, { on: "2027-11-14", updatedBy: "Admin" });
  assert.equal(keyExpiryState(state).alarmed.openai, "2027-11-14:30");
  assert.deepEqual(keyExpiryState(parseCentralState({ entries: {}, keyExpiry: { dates: { openai: { on: "not a date" } } } })), { dates: {}, alarmed: {} }, "a broken part reads as empty");
  assert.deepEqual(keyExpiryState(parseCentralState(null)), { dates: {}, alarmed: {} });
});
