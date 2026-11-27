import assert from "node:assert/strict";
import test from "node:test";
import {
  applySchedulePreset, formScheduleRuleSchema, monthWeekOf, roundHolderNow, roundPosition, roundWhereLabel, scheduleCountEnd, scheduleOccurrences, schedulePresetOf, scheduleRuleSentence,
  scheduleRuleText, scheduleViews, swedishOrdinal, upcomingOccurrences, type FormSchedule, type FormScheduleRule, type RoundOrderRef,
} from "../lib/workflow/form-schedule";
import { roundStartAction } from "../lib/workflow/round-work-orders";

/**
 * "Hur ofta" (2026-10-27): the rule in one plain sentence, the next occurrences, the quick choices, a weekday of the
 * month and "Efter N gånger" – all on the same rule engine that computes the occurrences everywhere. And (2026-10-27 kväll)
 * where a round is done: the work order that holds it.
 */
const rule = (patch: Partial<FormScheduleRule> = {}): FormScheduleRule => ({ frequency: "DAILY", interval: 1, weekdays: [], startDate: "2026-10-14", endDate: "", ...patch });

test("the sentence says what, from when and until when", () => {
  assert.equal(scheduleRuleSentence(rule({ frequency: "WEEKLY", weekdays: [1, 2, 3, 4, 5] })), "Varje vardag från 14 okt 2026, tills vidare");
  assert.equal(scheduleRuleSentence(rule({ frequency: "WEEKLY", interval: 2, weekdays: [4, 1] })), "Varannan vecka på måndag och torsdag från 14 okt 2026, tills vidare");
  assert.equal(scheduleRuleSentence(rule({ frequency: "MONTHLY", endDate: "2027-12-31" })), "Den 14:e varje månad från 14 okt 2026 till 31 dec 2027");
  assert.equal(scheduleRuleSentence(rule()), "Varje dag från 14 okt 2026, tills vidare");
  assert.equal(scheduleRuleSentence(rule({ interval: 3 })), "Var 3:e dag från 14 okt 2026, tills vidare");
  assert.equal(scheduleRuleSentence(rule({ frequency: "WEEKLY" })), "Varje vecka på onsdag från 14 okt 2026, tills vidare", "no weekday chosen: the start date's");
  assert.equal(scheduleRuleSentence(rule({ frequency: "WEEKLY", weekdays: [1, 3, 5] })), "Varje vecka på måndag, onsdag och fredag från 14 okt 2026, tills vidare");
  assert.equal(scheduleRuleSentence(rule({ frequency: "MONTHLY", interval: 12 })), "Varje år den 14 oktober från 14 okt 2026, tills vidare");
  assert.equal(scheduleRuleSentence(rule({ frequency: "MONTHLY", interval: 2, startDate: "2026-10-01" })), "Den 1:a varannan månad från 1 okt 2026, tills vidare");
  assert.equal(scheduleRuleSentence(rule({ frequency: "MONTHLY", monthWeek: 1, monthWeekday: 1, count: 10 })), "Första måndagen varje månad från 14 okt 2026, 10 gånger");
  assert.equal(scheduleRuleSentence(rule({ frequency: "MONTHLY", monthWeek: -1, monthWeekday: 5 })), "Sista fredagen varje månad från 14 okt 2026, tills vidare");
  assert.equal(scheduleRuleSentence(rule({ count: 1 })), "Varje dag från 14 okt 2026, 1 gång");
  assert.deepEqual([1, 2, 3, 11, 12, 21, 22, 23, 31].map(swedishOrdinal), ["1:a", "2:a", "3:e", "11:e", "12:e", "21:a", "22:a", "23:e", "31:a"]);
});

test("the next occurrences: from today on, or from the start date when it lies ahead", () => {
  assert.deepEqual(upcomingOccurrences(rule({ frequency: "WEEKLY", weekdays: [1, 2, 3, 4, 5] }), "2026-10-16", 4), ["2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21"]);
  assert.deepEqual(upcomingOccurrences(rule({ startDate: "2026-11-01", interval: 7 }), "2026-10-16", 3), ["2026-11-01", "2026-11-08", "2026-11-15"]);
  assert.deepEqual(upcomingOccurrences(rule({ endDate: "2026-10-15" }), "2026-10-16"), [], "an ended rule has none");
  assert.deepEqual(upcomingOccurrences(rule({ frequency: "MONTHLY", interval: 12 }), "2026-10-16", 2), ["2027-10-14", "2028-10-14"]);
  assert.equal(upcomingOccurrences(rule(), "2026-10-14").length, 8, "eight by default");
});

test("a weekday of the month: the first to the fourth, or the last", () => {
  assert.deepEqual(scheduleOccurrences(rule({ frequency: "MONTHLY", monthWeek: 1, monthWeekday: 1 }), "2026-10-01", "2027-01-31"), ["2026-11-02", "2026-12-07", "2027-01-04"], "October's first Monday was before the start");
  assert.deepEqual(scheduleOccurrences(rule({ frequency: "MONTHLY", monthWeek: -1, monthWeekday: 5 }), "2026-10-01", "2026-12-31"), ["2026-10-30", "2026-11-27", "2026-12-25"]);
  assert.deepEqual(scheduleOccurrences(rule({ frequency: "MONTHLY", interval: 2, monthWeek: 2, monthWeekday: 2 }), "2026-10-01", "2027-02-28"), ["2026-12-08", "2027-02-09"], "every second month from the start month");
  assert.deepEqual([monthWeekOf("2026-10-14"), monthWeekOf("2026-10-07"), monthWeekOf("2026-10-29")], [2, 1, -1]);
  // Both or neither (a rule from before 2026-10-27 has neither and reads as before).
  assert.equal(formScheduleRuleSchema.safeParse(rule({ frequency: "MONTHLY", monthWeek: 1 })).success, false);
  assert.ok(formScheduleRuleSchema.safeParse(rule({ frequency: "MONTHLY" })).success);
  assert.deepEqual(scheduleOccurrences(rule({ frequency: "MONTHLY" }), "2026-10-01", "2026-12-31"), ["2026-10-14", "2026-11-14", "2026-12-14"], "the day of the month as before");
  assert.equal(scheduleRuleText(rule({ frequency: "MONTHLY", monthWeek: 1, monthWeekday: 1 })), "Månadsvis första mån");
});

test("Efter N gånger ends the rule at its Nth occurrence; a date and a count both apply", () => {
  assert.equal(scheduleCountEnd(rule({ count: 3 })), "2026-10-16");
  assert.equal(scheduleCountEnd(rule()), null);
  assert.deepEqual(scheduleOccurrences(rule({ count: 3 }), "2026-10-01", "2026-12-31"), ["2026-10-14", "2026-10-15", "2026-10-16"]);
  assert.deepEqual(scheduleOccurrences(rule({ count: 3 }), "2026-10-16", "2026-12-31"), ["2026-10-16"], "counted from the start date, not the window");
  assert.deepEqual(scheduleOccurrences(rule({ frequency: "WEEKLY", interval: 2, weekdays: [1, 4], count: 3 }), "2026-10-01", "2027-12-31"), ["2026-10-15", "2026-10-26", "2026-10-29"]);
  assert.deepEqual(scheduleOccurrences(rule({ count: 10, endDate: "2026-10-15" }), "2026-10-01", "2026-12-31"), ["2026-10-14", "2026-10-15"]);
  assert.equal(formScheduleRuleSchema.safeParse(rule({ count: 0 })).success, false);
  assert.equal(scheduleRuleText(rule({ count: 3 })), "Dagligen, 3 gånger");
});

test("the quick choices are rules of the same engine, and a saved rule opens on its choice", () => {
  const start = rule({ frequency: "MONTHLY", interval: 3, startDate: "2026-10-14", endDate: "2027-06-30" });
  assert.deepEqual(applySchedulePreset(start, "day"), { ...start, frequency: "DAILY", interval: 1, weekdays: [], monthWeek: undefined, monthWeekday: undefined });
  assert.deepEqual(applySchedulePreset(start, "weekday").weekdays, [1, 2, 3, 4, 5]);
  assert.deepEqual([applySchedulePreset(start, "week").weekdays, applySchedulePreset(start, "biweekly").interval], [[3], 2], "the start date's weekday");
  assert.deepEqual(applySchedulePreset(rule({ frequency: "WEEKLY", weekdays: [2, 4] }), "biweekly").weekdays, [2, 4], "chosen weekdays are kept");
  assert.equal(applySchedulePreset(start, "year").interval, 12);
  assert.equal(applySchedulePreset(start, "month").endDate, "2027-06-30", "the end stays");
  for (const preset of ["day", "weekday", "week", "biweekly", "month", "year"] as const) assert.equal(schedulePresetOf(applySchedulePreset(start, preset)), preset);
  assert.equal(schedulePresetOf(start), "custom", "every third month");
  assert.equal(schedulePresetOf(rule({ frequency: "MONTHLY", interval: 12, monthWeek: 1, monthWeekday: 1 })), "custom");
});

const schedule = (extra: Partial<FormSchedule> = {}): FormSchedule => ({ id: "s1", version: 1, title: "Rond", templateId: "form-1", assignedToUserId: null, assignedToName: "", active: true,
  rule: rule({ startDate: "2026-10-01" }), reminders: { bell: true, email: false }, ...extra });
const order = (extra: Partial<RoundOrderRef> = {}): RoundOrderRef => ({ scheduleId: "s1", id: "wo-1", status: "IN_PROGRESS", title: "Rond 2026", occurrence: null, from: "2026-10-01", to: "2026-12-31",
  customerId: "c1", facilityId: "f1", customerName: "Kund AB", facilityName: "Station", facilityPosition: { latitude: 57, longitude: 12 }, ...extra });

test("where a round is done: the work order that holds it now – today's, else the current occurrence's, else the next one's", () => {
  const [view] = scheduleViews([schedule()], [], "2026-10-27", [order()]);
  assert.equal(view.holder?.id, "wo-1");
  assert.equal(roundWhereLabel(view.holder), "Station");
  assert.deepEqual(roundPosition(view.holder), { latitude: 57, longitude: 12 });
  const [none] = scheduleViews([schedule({ legacyPlace: { customerId: "c9", facilityId: "f9", projectId: null, tempPlace: null } })], [], "2026-10-27", []);
  assert.equal(none.holder, null);
  assert.equal(roundWhereLabel(none.holder), "Ingen arbetsorder", "an older round's own place is not where it is done");
  assert.equal(roundPosition(none.holder), null);
  // Today's work order first; a coming one when none holds today.
  const later = order({ id: "wo-2", from: "2027-01-01", to: "2027-12-31", facilityName: "Nya stationen" });
  assert.equal(roundHolderNow([order(), later], "s1", { current: null, next: "2027-01-01" }, "2026-10-27")?.id, "wo-1");
  assert.equal(roundHolderNow([later], "s1", { current: null, next: "2027-01-01" }, "2026-10-27")?.id, "wo-2");
  assert.equal(roundHolderNow([order({ status: "CANCELLED" })], "s1", { current: null, next: "2026-10-28" }, "2026-10-27"), null, "a cancelled work order holds nothing");
  // Only a customer, no place: the customer is shown.
  assert.equal(roundWhereLabel(order({ facilityId: null, facilityName: "" })), "Kund AB");
  // Skapa arbetsorder för ronden is offered when nothing holds the day, filled in from the old place only.
  const create = roundStartAction(none);
  assert.equal(create?.kind, "create");
  assert.equal(new URL(create!.href, "http://x").searchParams.get("facilityId"), "f9");
  assert.equal(roundStartAction(view)?.kind, "start");
});
