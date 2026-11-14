import assert from "node:assert/strict";
import test from "node:test";
import { alarmOrderText, DAILY_ALARM_ORDER_CAP, decideAlarm, triggersOrder } from "../lib/machine/alarm-rules";

// Larm blir arbetsorder (S3): the rules without a database.
const now = new Date("2026-10-20T10:00:00Z");
const base = { mode: "direct" as const, now, cooldownMinutes: 30, lastRowAt: null, rowsToday: 0 };

test("only a new fault or critical alarm can lead to an order", () => {
  assert.equal(triggersOrder({ type: "alarm", severity: "fault", state: "raised" }), true);
  assert.equal(triggersOrder({ type: "alarm", severity: "critical", state: null }), true);
  assert.equal(triggersOrder({ type: "alarm", severity: "warning", state: "raised" }), false);
  assert.equal(triggersOrder({ type: "alarm", severity: "info", state: "raised" }), false);
  assert.equal(triggersOrder({ type: "alarm", severity: "fault", state: "cleared" }), false, "a cleared alarm never makes or closes an order");
  assert.equal(triggersOrder({ type: "state", severity: "critical", state: "stopped" }), false);
  assert.equal(triggersOrder({ type: "diagnosis", severity: "critical", state: null }), false);
});

test("the mode decides what happens, off does nothing", () => {
  assert.deepEqual(decideAlarm(base), { act: "create" });
  assert.deepEqual(decideAlarm({ ...base, mode: "approval" }), { act: "queue" });
  assert.deepEqual(decideAlarm({ ...base, mode: "off" }), { act: "skip", reason: "mode_off" });
});

test("a cooldown after the last row and a daily cap per company hold back a flood", () => {
  assert.deepEqual(decideAlarm({ ...base, lastRowAt: new Date(now.getTime() - 10 * 60_000) }), { act: "skip", reason: "cooldown" });
  assert.deepEqual(decideAlarm({ ...base, lastRowAt: new Date(now.getTime() - 31 * 60_000) }), { act: "create" });
  assert.deepEqual(decideAlarm({ ...base, rowsToday: DAILY_ALARM_ORDER_CAP }), { act: "skip", reason: "daily_cap" });
  assert.deepEqual(decideAlarm({ ...base, rowsToday: DAILY_ALARM_ORDER_CAP - 1 }), { act: "create" });
});

test("the order says it was made automatically and that it is never closed automatically", () => {
  const text = alarmOrderText({ sourceName: "PLC hall 1", code: "E12", severity: "critical", text: "Motor 2 överström", occurredAt: now });
  assert.match(text.description, /Skapad automatiskt av larm från PLC hall 1/);
  assert.match(text.description, /stängs aldrig automatiskt/);
  assert.equal(text.title, "Larm: Motor 2 överström");
  assert.equal(text.priority, "URGENT");
  assert.equal(alarmOrderText({ sourceName: "x", code: "E1", severity: "fault", text: "", occurredAt: now }).title, "Larm: E1");
  assert.equal(alarmOrderText({ sourceName: "x", code: "E1", severity: "fault", text: "a".repeat(500), occurredAt: now }).title.length <= 200, true);
});

test("a simulated alarm's order says so once, at the end, not as a second label after Larm: (2026-11-06)", () => {
  const text = alarmOrderText({ sourceName: "Simulator", code: "AL1", severity: "fault", text: "Simulerat: Fläkt F1, motorskydd", occurredAt: now });
  assert.equal(text.title, "Larm: Fläkt F1, motorskydd (simulerat)");
  assert.match(text.description, /Maskinens text: Simulerat: Fläkt F1, motorskydd/, "the machine's own text stays as it came");
  assert.equal(alarmOrderText({ sourceName: "x", code: "E1", severity: "fault", text: "Simulerat: " + "a".repeat(500), occurredAt: now }).title.length, 200);
  assert.ok(alarmOrderText({ sourceName: "x", code: "E1", severity: "fault", text: "Simulerat: " + "a".repeat(500), occurredAt: now }).title.endsWith("(simulerat)"));
});
