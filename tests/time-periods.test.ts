import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addPeriods, isLockedStatus, lockedPeriodMessage, lockedTouch, nextTimePeriodStatus, periodBounds, periodLabel, periodOf, timePeriodAuditText,
  timePeriodInputSchema, TimePeriodError, touchedPeriods, viewOf,
} from "../lib/workflow/time-periods";

// Tidsperiod (2026-10-30): the month is sent in, approved or returned; a sent-in or approved month is locked.
const now = new Date("2026-10-30T10:00:00Z");
const base = { period: "2026-10", now, note: "", actorIsOwner: true, approver: false, otherApprover: true, runningInPeriod: false };
const refused = (input: Parameters<typeof nextTimePeriodStatus>[0], pattern: RegExp, status?: number) =>
  assert.throws(() => nextTimePeriodStatus(input), (error: unknown) => error instanceof TimePeriodError && pattern.test(error.message) && (status === undefined || error.status === status));

test("the Swedish month of a moment and its bounds", () => {
  // 23:30 UTC on 31 October is 00:30 on 1 November in Sweden (winter time).
  assert.equal(periodOf(new Date("2026-10-31T23:30:00Z")), "2026-11");
  assert.equal(periodOf(new Date("2026-10-31T22:59:00Z")), "2026-10");
  const { startsAt, endsAt } = periodBounds("2026-10");
  assert.equal(startsAt.toISOString(), "2026-09-30T22:00:00.000Z", "summer time on 1 October");
  assert.equal(endsAt.toISOString(), "2026-10-31T23:00:00.000Z", "winter time on 1 November");
  assert.equal(periodBounds("2026-12").endsAt.toISOString(), "2026-12-31T23:00:00.000Z", "December rolls into January");
  assert.equal(addPeriods("2026-12", 1), "2027-01");
  assert.equal(addPeriods("2026-01", -1), "2025-12");
  assert.equal(periodLabel("2026-10"), "oktober 2026");
});

test("the input: month as YYYY-MM, note at most 500 characters", () => {
  assert.equal(timePeriodInputSchema.parse({ action: "submit", period: "2026-10" }).note, "");
  assert.throws(() => timePeriodInputSchema.parse({ action: "submit", period: "2026-13" }));
  assert.throws(() => timePeriodInputSchema.parse({ action: "submit", period: "2026-1" }));
  assert.throws(() => timePeriodInputSchema.parse({ action: "return", period: "2026-10", note: "x".repeat(501) }));
  assert.throws(() => timePeriodInputSchema.parse({ action: "delete", period: "2026-10" }));
});

test("sending in: own month only, not a future month, not twice, not with a running timer", () => {
  assert.deepEqual(nextTimePeriodStatus({ ...base, action: "submit", current: null }), { status: "SUBMITTED" });
  assert.deepEqual(nextTimePeriodStatus({ ...base, action: "submit", current: "RETURNED" }), { status: "SUBMITTED" }, "a returned month is sent in again");
  assert.deepEqual(nextTimePeriodStatus({ ...base, action: "submit", current: null, period: "2026-09" }), { status: "SUBMITTED" }, "an earlier month");
  refused({ ...base, action: "submit", current: null, period: "2026-11" }, /har inte börjat/, 409);
  refused({ ...base, action: "submit", current: "SUBMITTED" }, /redan inskickad/, 409);
  refused({ ...base, action: "submit", current: "APPROVED" }, /redan godkänd/, 409);
  refused({ ...base, action: "submit", current: null, runningInPeriod: true }, /Stoppa den/, 409);
  refused({ ...base, action: "submit", current: null, actorIsOwner: false, approver: true }, /Bara personen själv/, 403);
});

test("a one-person company: sending in approves at once; with another approver it does not", () => {
  assert.deepEqual(nextTimePeriodStatus({ ...base, action: "submit", current: null, approver: true, otherApprover: false }), { status: "APPROVED", selfApproved: true });
  assert.deepEqual(nextTimePeriodStatus({ ...base, action: "submit", current: null, approver: true, otherApprover: true }), { status: "SUBMITTED" });
  // A member without the right is never approved by sending in, even when nobody else could approve.
  assert.deepEqual(nextTimePeriodStatus({ ...base, action: "submit", current: null, approver: false, otherApprover: false }), { status: "SUBMITTED" });
});

test("approving, returning and reopening: approvers only, never one's own month when someone else may", () => {
  const boss = { ...base, actorIsOwner: false, approver: true };
  assert.deepEqual(nextTimePeriodStatus({ ...boss, action: "approve", current: "SUBMITTED" }), { status: "APPROVED" });
  refused({ ...boss, action: "approve", current: null }, /inte inskickad/, 409);
  refused({ ...boss, action: "approve", current: "RETURNED" }, /inte inskickad/, 409);
  refused({ ...base, actorIsOwner: false, approver: false, action: "approve", current: "SUBMITTED" }, /behörighet/, 403);
  refused({ ...base, approver: true, action: "approve", current: "SUBMITTED" }, /din egen tid/, 403);
  refused({ ...boss, action: "return", current: "SUBMITTED" }, /Skriv varför/, 422);
  assert.deepEqual(nextTimePeriodStatus({ ...boss, action: "return", current: "SUBMITTED", note: "Saknar fredag" }), { status: "RETURNED" });
  refused({ ...boss, action: "return", current: "APPROVED", note: "x" }, /inte inskickad/, 409);
  refused({ ...boss, action: "reopen", current: "APPROVED" }, /Skriv varför/, 422);
  assert.deepEqual(nextTimePeriodStatus({ ...boss, action: "reopen", current: "APPROVED", note: "Fel lönekod" }), { status: "RETURNED" });
  refused({ ...boss, action: "reopen", current: "SUBMITTED", note: "x" }, /inte godkänd/, 409);
  // Alone in the company: the same person may reopen their own approved month.
  assert.deepEqual(nextTimePeriodStatus({ ...base, approver: true, otherApprover: false, action: "reopen", current: "APPROVED", note: "Glömde en dag" }), { status: "RETURNED" });
});

test("the lock: SUBMITTED and APPROVED; each touched person and month once, in a fixed order", () => {
  assert.ok(isLockedStatus("SUBMITTED") && isLockedStatus("APPROVED"));
  assert.ok(!isLockedStatus("RETURNED") && !isLockedStatus(null) && !isLockedStatus(undefined));
  assert.equal(viewOf(undefined), "OPEN"); assert.equal(viewOf("RETURNED"), "RETURNED"); assert.equal(viewOf("x"), "OPEN");
  const touches = [
    { userId: "b", startedAt: "2026-10-05T08:00:00Z" }, { userId: "a", startedAt: "2026-10-06T08:00:00Z" },
    { userId: "a", startedAt: "2026-10-07T08:00:00Z" }, { userId: "a", startedAt: new Date("2026-09-30T08:00:00Z") },
  ];
  assert.deepEqual(touchedPeriods(touches), [{ userId: "a", period: "2026-09" }, { userId: "a", period: "2026-10" }, { userId: "b", period: "2026-10" }]);
  const statuses: Record<string, string> = { "a:2026-09": "RETURNED", "b:2026-10": "APPROVED" };
  assert.deepEqual(lockedTouch(touches, (userId, period) => statuses[`${userId}:${period}`]), { userId: "b", period: "2026-10", status: "APPROVED" });
  assert.equal(lockedTouch(touches.slice(1, 4), (userId, period) => statuses[`${userId}:${period}`]), null, "a returned month is open");
  // A moved entry: the month it leaves and the month it enters are both checked.
  assert.deepEqual(lockedTouch([{ userId: "a", startedAt: "2026-10-02T08:00:00Z" }, { userId: "a", startedAt: "2026-11-02T08:00:00Z" }], (_, period) => (period === "2026-11" ? "SUBMITTED" : undefined))?.period, "2026-11");
});

test("the server lock: one advisory lock per touched month, refusal with the month's status; a re-import may only bring a locked month back unchanged", async () => {
  const { assertReplacedTimeOpen, assertTimeOpen } = await import("../lib/workflow/time-period-lock");
  const locks: string[] = [];
  const tx = {
    $executeRaw: async (_strings: TemplateStringsArray, key: string) => { locks.push(key); return 0; },
    timePeriod: { findMany: async () => [{ userId: "a", period: "2026-10", status: "SUBMITTED" }, { userId: "a", period: "2026-09", status: "RETURNED" }] },
  } as never;
  await assertTimeOpen(tx, "org", [], "a");
  assert.equal(locks.length, 0, "nothing touched, nothing locked");
  await assertTimeOpen(tx, "org", [{ userId: "a", startedAt: "2026-09-10T08:00:00Z" }], "a");
  assert.deepEqual(locks, ["time-period:org:a:2026-09"]);
  await assert.rejects(assertTimeOpen(tx, "org", [{ userId: "a", startedAt: "2026-10-10T08:00:00Z" }], "a"), (error: Error & { status?: number }) => error.status === 409 && /Din tid för oktober 2026 är inskickad/.test(error.message));
  await assert.rejects(assertTimeOpen(tx, "org", [{ userId: "a", startedAt: "2026-10-10T08:00:00Z" }], "boss"), /Skicka tillbaka månaden först/);
  const october = { userId: "a", startedAt: new Date("2026-10-10T08:00:00Z"), endedAt: new Date("2026-10-10T10:00:00Z"), durationSec: 7200, note: "" };
  await assertReplacedTimeOpen(tx, "org", [october], [{ ...october, startedAt: october.startedAt.toISOString(), endedAt: october.endedAt.toISOString() }], "a");
  await assertReplacedTimeOpen(tx, "org", [october], [october, { ...october, startedAt: new Date("2026-09-10T08:00:00Z") }], "a");
  await assert.rejects(assertReplacedTimeOpen(tx, "org", [october], [{ ...october, note: "Ändrad" }], "a"), /inskickad/, "a changed entry");
  await assert.rejects(assertReplacedTimeOpen(tx, "org", [october], [], "a"), /inskickad/, "a removed entry");
  await assert.rejects(assertReplacedTimeOpen(tx, "org", [], [october], "a"), /inskickad/, "an added entry");
});

test("the texts: clear Swedish, own or someone else's time; the audit line carries no note", () => {
  assert.match(lockedPeriodMessage("2026-10", "SUBMITTED", true), /^Din tid för oktober 2026 är inskickad och låst/);
  assert.match(lockedPeriodMessage("2026-10", "APPROVED", false), /godkänd och låst\. Öppna månaden igen/);
  assert.equal(timePeriodAuditText("return", "RETURNED", "Elin", "2026-10"), "Skickade tillbaka tiden för Elin, oktober 2026.");
  assert.match(timePeriodAuditText("submit", "APPROVED", "Elin", "2026-10"), /ingen annan kan godkänna/);
});

test("reopening names the person in Swedish genitive: no extra s after s, x or z", () => {
  assert.equal(timePeriodAuditText("reopen", "RETURNED", "Elin", "2026-10"), "Öppnade Elins tid för oktober 2026 igen.");
  assert.equal(timePeriodAuditText("reopen", "RETURNED", "Elis Hammarström", "2026-10"), "Öppnade Elis Hammarströms tid för oktober 2026 igen.");
  for (const name of ["Klas", "Max", "Inez"]) assert.equal(timePeriodAuditText("reopen", "RETURNED", name, "2026-10"), `Öppnade ${name} tid för oktober 2026 igen.`);
});
