import assert from "node:assert/strict";
import test from "node:test";
import type { CloudAgreementState } from "../lib/extensions/types";
import {
  closureDueAt, closureExclusion, closureNoticeText, closureStep, DAY_0, ERASE_LIMIT_PER_RUN, EXPORT_DAYS, postponeProblem, reminderKey,
  type ClosureCompany, type ClosureRow,
} from "../lib/company-closure/rule";

// Radering efter avslut (2026-10-10): the pure rule – who counts down, the dates, the notices, when a company is due.
const DAY = 86_400_000;
const company: ClosureCompany = { id: "c1", name: "Kund AB", slug: "kund-ab", domain: null, storageMode: "HINTEK_CLOUD", hintek: false, superadminMember: false };
const start = new Date("2026-10-10T02:15:00Z");
const ended: CloudAgreementState = { state: "ENDED", endedAt: new Date("2026-10-09T22:00:00Z") };
const at = (days: number) => new Date(start.getTime() + days * DAY);
const counting = (over: Partial<ClosureRow> = {}): ClosureRow => ({
  organizationId: "c1", endedAt: ended.endedAt, exportUntil: at(EXPORT_DAYS), postponedUntil: null, noticesSent: [DAY_0], firstNoticeAt: start, ...over,
});

test("company closure: an ended agreement starts the countdown with 30 days of export from the notice", () => {
  const step = closureStep({ company, agreement: ended, row: null, now: start });
  assert.equal(step.kind, "start");
  assert.ok(step.kind === "start" && step.exportUntil.getTime() === start.getTime() + 30 * DAY);
  assert.equal(EXPORT_DAYS, 30);
  // Seen late (e.g. the first night after deployment): the customer still gets the full 30 days from being told.
  const late = closureStep({ company, agreement: { state: "ENDED", endedAt: new Date("2026-01-01T00:00:00Z") }, row: null, now: start });
  assert.ok(late.kind === "start" && late.exportUntil.getTime() === start.getTime() + 30 * DAY);
});

test("company closure: cancelled → due only after 30 days, with reminders on day 23 and the day before, each once", () => {
  assert.equal(closureStep({ company, agreement: ended, row: counting(), now: at(1) }).kind, "wait");
  assert.equal(closureStep({ company, agreement: ended, row: counting(), now: at(22) }).kind, "wait");
  const week = closureStep({ company, agreement: ended, row: counting(), now: at(23) });
  assert.ok(week.kind === "remind" && week.stage === "REMINDER_7");
  // Sent once: the same reminder is not due again.
  assert.equal(closureStep({ company, agreement: ended, row: counting({ noticesSent: [DAY_0, reminderKey("REMINDER_7", at(30))] }), now: at(24) }).kind, "wait");
  const dayBefore = closureStep({ company, agreement: ended, row: counting({ noticesSent: [DAY_0, reminderKey("REMINDER_7", at(30))] }), now: at(29) });
  assert.ok(dayBefore.kind === "remind" && dayBefore.stage === "REMINDER_1");
  // A missed night never sends two reminders at once: only the most pressing one.
  const missed = closureStep({ company, agreement: ended, row: counting(), now: at(29) });
  assert.ok(missed.kind === "remind" && missed.stage === "REMINDER_1");
  assert.equal(closureStep({ company, agreement: ended, row: counting({ noticesSent: [DAY_0, reminderKey("REMINDER_1", at(30))] }), now: at(29.5) }).kind, "wait");
  assert.equal(closureStep({ company, agreement: ended, row: counting(), now: at(29.99) }).kind !== "due", true);
  assert.equal(closureStep({ company, agreement: ended, row: counting(), now: at(30) }).kind, "due");
  assert.equal(closureStep({ company, agreement: ended, row: counting(), now: at(45) }).kind, "due");
});

test("company closure: never due without the day-0 notice and the full export time after it", () => {
  assert.notEqual(closureStep({ company, agreement: ended, row: counting({ noticesSent: [] }), now: at(40) }).kind, "due");
  assert.notEqual(closureStep({ company, agreement: ended, row: counting({ firstNoticeAt: null }), now: at(40) }).kind, "due");
  // A row whose date was somehow set early still waits 30 days from the notice.
  assert.notEqual(closureStep({ company, agreement: ended, row: counting({ exportUntil: at(5) }), now: at(10) }).kind, "due");
});

test("company closure: a payment problem, no billing or a new agreement never erase, and cancel a running countdown", () => {
  const states: CloudAgreementState[] = [
    { state: "UNSETTLED", reason: "PAYMENT_OVERDUE" }, { state: "UNSETTLED", reason: "OPEN_SUBSCRIPTION" }, { state: "UNSETTLED", reason: "UNPAID_INVOICE" },
    { state: "NOT_BILLING" }, { state: "ACTIVE" },
  ];
  for (const agreement of states) {
    assert.equal(closureStep({ company, agreement, row: null, now: at(60) }).kind, "none", agreement.state);
    const step = closureStep({ company, agreement, row: counting(), now: at(60) });
    assert.equal(step.kind, "cancel", agreement.state);
  }
  assert.match((closureStep({ company, agreement: { state: "ACTIVE" }, row: counting(), now: at(10) }) as { reason: string }).reason, /giltigt Cloud-avtal igen/);
  // Unknown (billing not asked because the company is excluded) is never an ended agreement.
  assert.equal(closureStep({ company, agreement: null, row: null, now: at(60) }).kind, "none");
});

test("company closure: Workflow, the superadmin's company, QA/demo, Local and already erased companies are excluded", () => {
  assert.equal(closureExclusion(company), null);
  assert.ok(closureExclusion({ ...company, hintek: true }));
  assert.ok(closureExclusion({ ...company, superadminMember: true }));
  assert.ok(closureExclusion({ ...company, slug: "qa-role-demo" }));
  assert.ok(closureExclusion({ ...company, slug: "demo" }));
  assert.ok(closureExclusion({ ...company, storageMode: "LOCAL" }));
  assert.ok(closureExclusion({ ...company, slug: "raderat-c1" }));
  for (const excluded of [{ ...company, hintek: true }, { ...company, storageMode: "LOCAL" as const }, { ...company, slug: "raderat-c1" }]) {
    assert.equal(closureStep({ company: excluded, agreement: ended, row: null, now: at(60) }).kind, "none");
    assert.equal(closureStep({ company: excluded, agreement: ended, row: counting(), now: at(60) }).kind, "cancel");
  }
});

test("company closure: postponed → later, with new reminders for the new date", () => {
  const postponed = counting({ postponedUntil: at(60) });
  assert.equal(closureDueAt(postponed).getTime(), at(60).getTime());
  assert.equal(closureStep({ company, agreement: ended, row: postponed, now: at(31) }).kind, "wait");
  assert.equal(closureStep({ company, agreement: ended, row: postponed, now: at(45) }).kind, "wait");
  // Reminders sent for the old date do not count for the new one.
  const sentOld = { ...postponed, noticesSent: [DAY_0, reminderKey("REMINDER_7", at(30)), reminderKey("REMINDER_1", at(30))] };
  const week = closureStep({ company, agreement: ended, row: sentOld, now: at(53) });
  assert.ok(week.kind === "remind" && week.stage === "REMINDER_7" && week.key === reminderKey("REMINDER_7", at(60)));
  assert.equal(closureStep({ company, agreement: ended, row: postponed, now: at(60) }).kind, "due");
  // A postponement earlier than the export date never shortens it.
  assert.equal(closureDueAt(counting({ postponedUntil: at(10) })).getTime(), at(30).getTime());
  // Skjut upp: later than today's date, a reason, at most a year ahead.
  assert.match(postponeProblem({ until: at(60), reason: "", currentDueAt: at(30), now: at(1) }) ?? "", /skäl/);
  assert.match(postponeProblem({ until: at(20), reason: "Kunden ber om tid", currentDueAt: at(30), now: at(1) }) ?? "", /senare/);
  assert.match(postponeProblem({ until: at(400), reason: "Kunden ber om tid", currentDueAt: at(30), now: at(1) }) ?? "", /ett år/);
  assert.equal(postponeProblem({ until: at(60), reason: "Kunden ber om tid", currentDueAt: at(30), now: at(1) }), null);
  assert.ok(ERASE_LIMIT_PER_RUN >= 1 && ERASE_LIMIT_PER_RUN <= 5);
});

test("company closure: the notice uses the product owner's wording with the Swedish date", () => {
  assert.equal(closureNoticeText(new Date("2026-11-09T02:15:00Z")), "Ert Cloud-avtal har upphört. Exportera det ni vill spara före 9 november 2026. Därefter raderas företagets data.");
  assert.match(closureNoticeText(new Date("2026-11-09T02:15:00Z"), new Date("2026-11-12T00:00:00Z")), /exporttiden gick ut 9 november 2026/);
});
