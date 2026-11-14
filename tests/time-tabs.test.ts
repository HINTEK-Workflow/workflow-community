import assert from "node:assert/strict";
import test from "node:test";
import { connectionAreaHref } from "../lib/integrations/connection-areas";
import { absenceDaysInMonth, monthGap, remindRefusal, shownStatus, submitWarning, TIME_PERIOD_LABELS, timePeriodRemindSchema } from "../lib/workflow/time-periods";
import { timeTabDenied, timeTabHref, timeTabOf, timeTabsFor } from "../lib/workflow/time-tabs";

test("Tid's tabs: Medarbetaren has only Min tid, Teamet right and admin all three, Local only Min tid", () => {
  assert.deepEqual(timeTabsFor({ local: false, team: false, admin: false }), ["mine"]);
  assert.deepEqual(timeTabsFor({ local: false, team: true, admin: false }), ["mine", "team", "payroll"]);
  assert.deepEqual(timeTabsFor({ local: false, team: true, admin: true }), ["mine", "team", "payroll"]);
  assert.deepEqual(timeTabsFor({ local: true, team: true, admin: true }), ["mine"]);
});

test("Tid's addresses: each tab its own, an old link is Min tid, and an address without the right too", () => {
  assert.equal(timeTabHref("mine"), "/?view=time", "older links keep opening Min tid");
  assert.equal(timeTabHref("team"), "/?view=time&tab=team");
  assert.equal(timeTabHref("payroll"), "/?view=time&tab=payroll");
  const member = { local: false, team: false, admin: false };
  const lead = { local: false, team: true, admin: false };
  assert.equal(timeTabOf(null, lead), "mine");
  assert.equal(timeTabOf("team", lead), "team");
  assert.equal(timeTabOf("payroll", lead), "payroll");
  assert.equal(timeTabOf("team", member), "mine");
  assert.equal(timeTabOf("payroll", member), "mine");
  assert.equal(timeTabOf("okänd", lead), "mine");
  assert.equal(timeTabDenied("team", member), true, "the shared box, no silent jump");
  assert.equal(timeTabDenied("payroll", member), true);
  assert.equal(timeTabDenied("team", lead), false);
  assert.equal(timeTabDenied("mine", member), false);
  assert.equal(timeTabDenied(null, member), false);
  assert.equal(timeTabDenied("okänd", member), false);
  assert.equal(timeTabDenied("team", { local: true, team: false, admin: false }), false, "Local has no such tabs: Min tid");
  // Lön och export opens under Kopplingar too (2026-11-02), with the same content as this tab.
  assert.equal(connectionAreaHref("payroll"), "/?view=advanced&section=payroll", "Kopplingar's area stays on Kopplingar");
});

test("Status: not sent in, sent back and a month opened again", () => {
  assert.equal(TIME_PERIOD_LABELS.OPEN, "Ej inskickad");
  assert.equal(shownStatus(undefined, null), "OPEN");
  assert.equal(shownStatus("RETURNED", new Date()), "RETURNED", "Skicka tillbaka keeps when it was sent in");
  assert.equal(shownStatus("RETURNED", null), "OPEN", "Öppna igen: not sent in");
  assert.equal(shownStatus("SUBMITTED", new Date()), "SUBMITTED");
  assert.equal(shownStatus("APPROVED", null), "APPROVED", "approved at once in a one-person company stays approved");
});

test("Påminn: a month not sent in, never one's own, nor a month that has not begun", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  const base = { period: "2026-10", now, own: false, person: "Anna" };
  assert.equal(remindRefusal({ ...base, current: null }), null);
  assert.equal(remindRefusal({ ...base, current: "RETURNED" }), null);
  assert.match(remindRefusal({ ...base, current: "SUBMITTED" })?.message ?? "", /Anna har redan skickat in oktober 2026/);
  assert.match(remindRefusal({ ...base, current: "APPROVED" })?.message ?? "", /redan godkänd/);
  assert.match(remindRefusal({ ...base, current: null, own: true })?.message ?? "", /dig själv/);
  assert.match(remindRefusal({ ...base, current: null, period: "2026-12" })?.message ?? "", /inte börjat/);
  assert.equal(timePeriodRemindSchema.safeParse({ action: "remind", period: "2026-10" }).success, false, "a person is required");
  assert.equal(timePeriodRemindSchema.safeParse({ action: "remind", period: "oktober", userId: "a" }).success, false);
});

test("Frånvaro in the table: workdays of approved absence in the month, parts of a day as a share", () => {
  // October 2026: the 1st is a Thursday, the 3rd a Saturday.
  assert.equal(absenceDaysInMonth("2026-10", []), 0);
  assert.equal(absenceDaysInMonth("2026-10", [{ from: "2026-10-01", to: "2026-10-04" }]), 2, "Thursday, Friday; never the weekend");
  assert.equal(absenceDaysInMonth("2026-10", [{ from: "2026-09-28", to: "2026-10-01" }]), 1, "only the part in the month");
  assert.equal(absenceDaysInMonth("2026-10", [{ from: "2026-10-05", to: "2026-10-05", hours: { start: "08:00", end: "12:00" } }]), 0.5);
  assert.equal(absenceDaysInMonth("2026-10", [{ from: "2026-10-05", to: "2026-10-05", status: "APPLIED" }]), 0, "only approved absence counts");
});

test("The warning before Skicka in (PL8): hours against the month's, workdays so far without time", () => {
  const entryDays = new Set(["2026-10-01"]);
  const gap = monthGap({ period: "2026-10", today: "2026-10-31", weeklyMinutes: 2400, entryDays, absences: [] });
  assert.deepEqual(gap, { expectedHours: 176, emptyDays: 21 }, "22 workdays in October 2026");
  assert.equal(submitWarning(8.66, gap), "8,66 h av 176 h, 21 dagar utan tid. Skicka ändå?");
  // Today is what counts: days ahead are not missing yet.
  assert.equal(monthGap({ period: "2026-10", today: "2026-10-02", weeklyMinutes: 2400, entryDays, absences: [] })?.emptyDays, 1);
  assert.equal(submitWarning(8, { expectedHours: 176, emptyDays: 1 }), "8 h av 176 h, 1 dag utan tid. Skicka ändå?");
  // A whole day away is no missing day and lowers what the month ought to hold.
  assert.deepEqual(monthGap({ period: "2026-10", today: "2026-10-02", weeklyMinutes: 2400, entryDays, absences: [{ from: "2026-10-02", to: "2026-10-02" }] }), { expectedHours: 168, emptyDays: 0 });
  assert.equal(submitWarning(8, { expectedHours: 168, emptyDays: 0 }), null, "nothing missing: no question");
  assert.equal(monthGap({ period: "2026-10", today: "2026-10-31", weeklyMinutes: null, entryDays, absences: [] }), null, "no fixed hours: nothing to compare");
  assert.equal(submitWarning(0, null), null);
});
