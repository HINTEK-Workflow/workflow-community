import assert from "node:assert/strict";
import test from "node:test";
import { analyse, DEFAULT_TUNING, parseTuning, tunedAfterDismiss, type AnalysisEvent } from "../lib/machine/analysis";

// Maskinanalys: the rules without a database or AI.
const now = new Date("2026-10-20T12:00:00Z");
const at = (hoursAgo: number, extra: Partial<AnalysisEvent> = {}): AnalysisEvent => ({ occurredAt: new Date(now.getTime() - hoursAgo * 3_600_000), type: "alarm", code: "E12", severity: "fault", state: "raised", ...extra });

test("a code that comes many times within an hour is flutter, a few times is not", () => {
  const many = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((h) => at(h));
  const found = analyse(many, now);
  assert.equal(found.some((item) => item.kind === "flutter" && item.title === "Larmet E12 fladdrar"), true);
  assert.equal(analyse([0.1, 0.2, 0.3].map((h) => at(h)), now).some((item) => item.kind === "flutter"), false);
  // Spread over the day, not within one hour.
  assert.equal(analyse([1, 4, 7, 10, 13, 16].map((h) => at(h)), now).some((item) => item.kind === "flutter"), false);
});

test("alarms that become denser than the source's own week are suggested, a quiet day is not", () => {
  const week = [30, 54, 78, 102, 126, 150].map((h) => at(h));
  const burst = [1, 3, 5, 7, 9, 11, 13, 15].map((h) => at(h, { code: `E${h}` }));
  assert.equal(analyse([...week, ...burst], now).some((item) => item.kind === "denser"), true);
  assert.equal(analyse([...week, at(2)], now).some((item) => item.kind === "denser"), false);
  // Without three days of history there is nothing to compare with.
  assert.equal(analyse(burst, now).some((item) => item.kind === "denser"), false);
});

test("a machine that used to speak often and has been silent for long is suggested", () => {
  const talking = Array.from({ length: 24 }, (_, index) => at(40 + index * 6, { type: "state", state: "running", code: "RUN", severity: "info" }));
  const silent = analyse(talking, now).find((item) => item.kind === "silent");
  assert.ok(silent);
  assert.match(silent.basis, /Inget har hörts på/);
  // A machine that spoke a moment ago is not silent, and one with too little history is not judged.
  assert.equal(analyse([...talking, at(1, { type: "state", state: "running", code: "RUN", severity: "info" })], now).some((item) => item.kind === "silent"), false);
  assert.equal(analyse(talking.slice(0, 3), now).some((item) => item.kind === "silent"), false);
});

test("a dismissed kind raises its own threshold, at most three times the base", () => {
  let tuning = parseTuning(null);
  assert.deepEqual(tuning, DEFAULT_TUNING);
  tuning = tunedAfterDismiss(tuning, "flutter");
  assert.equal(tuning.flutter, 1.5);
  assert.equal(tuning.denser, 1, "the other kinds are untouched");
  for (let i = 0; i < 10; i += 1) tuning = tunedAfterDismiss(tuning, "flutter");
  assert.equal(tuning.flutter, 3);
  // Six alarms inside an hour are flutter at the base threshold but not once the threshold has been raised to three times.
  const events = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((h) => at(h));
  assert.equal(analyse(events, now).some((item) => item.kind === "flutter"), true);
  assert.equal(analyse(events, now, tuning).some((item) => item.kind === "flutter"), false);
  // Rubbish in the stored value is read as the base.
  assert.deepEqual(parseTuning({ flutter: "x", denser: 99, silent: -4 }), { flutter: 1, denser: 3, silent: 1 });
});

test("the same observation gets the same key, so it is made once", () => {
  const events = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((h) => at(h));
  const first = analyse(events, now)[0];
  const again = analyse(events, new Date(now.getTime() + 600_000))[0];
  assert.equal(first.dedupeKey, again.dedupeKey);
});
