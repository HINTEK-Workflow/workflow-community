import assert from "node:assert/strict";
import test from "node:test";
import { cleanValues, countResults, MAX_EVENTS_PER_CALL, parseBatch, parseEvent, parseOccurredAt, resultFor } from "../lib/machine/intake";

// Maskinintag (S2): the whole batch is checked without a database; the company never comes from here, only from the key.
const now = new Date("2026-10-19T12:00:00Z");
const good = { eventId: "ev-1", occurredAt: "2026-10-19T11:59:00Z", type: "alarm", code: "E12", severity: "fault", state: "raised", text: "Motor 2 överström" };

test("a valid alarm, state and diagnosis are accepted, and I/O values follow along", () => {
  const alarm = parseEvent(good, now);
  assert.equal(alarm.ok, true);
  const state = parseEvent({ ...good, eventId: "ev-2", type: "state", state: "running", code: "RUN" }, now);
  assert.equal(state.ok, true);
  const diagnosis = parseEvent({ ...good, eventId: "ev-3", type: "diagnosis", state: undefined, basis: "Strömmen steg 30 % på en timme", values: { current_a: 12.4, door_open: false, mode: "auto" } }, now);
  assert.equal(diagnosis.ok, true);
  if (diagnosis.ok) assert.deepEqual(diagnosis.event.values, { current_a: 12.4, door_open: false, mode: "auto" });
  if (alarm.ok) assert.equal(alarm.event.values, null);
});

test("unknown fields, missing fields and wrong values are refused with a fixed reason", () => {
  const reason = (raw: unknown) => { const result = parseEvent(raw, now); return result.ok ? "ok" : result.reason; };
  assert.equal(reason({ ...good, extra: 1 }), "unknown_field");
  assert.equal(reason({ ...good, code: undefined }), "missing_field");
  assert.equal(reason({ ...good, type: "reading" }), "bad_type");
  assert.equal(reason({ ...good, severity: "bad" }), "bad_severity");
  assert.equal(reason({ ...good, state: "running" }), "bad_state", "a running state does not belong to an alarm");
  assert.equal(reason({ ...good, type: "state", state: undefined, code: "RUN" }), "bad_state", "a state event needs its state");
  assert.equal(reason({ ...good, text: "x".repeat(201) }), "bad_text");
  assert.equal(reason({ ...good, text: "rad\u0007" }), "bad_text");
  assert.equal(reason({ ...good, basis: "x" }), "bad_basis", "a basis belongs to a diagnosis only");
  assert.equal(reason({ ...good, eventId: "has space" }), "bad_event_id");
  assert.equal(reason("not an object"), "not_an_object");
});

test("time: strict ISO with a zone, a week back and five minutes ahead at most", () => {
  assert.ok(parseOccurredAt("2026-10-19T11:59:00Z"));
  assert.ok(parseOccurredAt("2026-10-19T13:59:00+02:00"));
  assert.equal(parseOccurredAt("2026-10-19T11:59:00"), null, "no zone is ambiguous");
  assert.equal(parseOccurredAt("2026-02-31T11:59:00Z"), null, "a day that does not exist");
  assert.equal(parseOccurredAt("19/10/2026"), null);
  const reason = (occurredAt: string) => { const result = parseEvent({ ...good, occurredAt }, now); return result.ok ? "ok" : result.reason; };
  assert.equal(reason("2026-10-10T12:00:00Z"), "time_window", "older than a week");
  assert.equal(reason("2026-10-19T12:10:00Z"), "time_window", "ten minutes ahead");
  assert.equal(reason("2026-10-19T12:03:00Z"), "ok", "a little clock drift is fine");
});

test("I/O values: at most 20 names, short names and values, finite numbers, booleans or short text", () => {
  assert.equal(cleanValues(undefined), null);
  assert.deepEqual(cleanValues({ a: 1, b: true, c: "ok" }), { a: 1, b: true, c: "ok" });
  assert.equal(cleanValues({}), "bad", "an empty object says nothing");
  assert.equal(cleanValues([1, 2]), "bad");
  assert.equal(cleanValues({ "bad name": 1 }), "bad");
  assert.equal(cleanValues({ a: Number.POSITIVE_INFINITY }), "bad");
  assert.equal(cleanValues({ a: { nested: 1 } }), "bad");
  assert.equal(cleanValues({ a: "x".repeat(61) }), "bad");
  assert.equal(cleanValues(Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`v${index}`, index]))), "bad");
  assert.equal(cleanValues(Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`v${index}`, index]))) === "bad", false);
});

test("a batch: 1-20 events, a broken row only refuses itself, a repeated eventId is a duplicate", () => {
  assert.deepEqual(parseBatch({ schemaVersion: 2, events: [good] }, now), { ok: false, error: "unsupported_version" });
  assert.deepEqual(parseBatch({ schemaVersion: 1, events: [] }, now), { ok: false, error: "bad_batch_size" });
  assert.deepEqual(parseBatch({ schemaVersion: 1, events: Array.from({ length: MAX_EVENTS_PER_CALL + 1 }, (_, index) => ({ ...good, eventId: `e${index}` })) }, now), { ok: false, error: "bad_batch_size" });
  assert.deepEqual(parseBatch({ schemaVersion: 1, events: [good], organizationId: "x" }, now), { ok: false, error: "unknown_field" }, "the company can never be chosen in the body");
  assert.deepEqual(parseBatch([], now), { ok: false, error: "not_an_object" });
  const batch = parseBatch({ schemaVersion: 1, events: [good, { ...good, type: "nope", eventId: "ev-bad" }, good, { ...good, eventId: "ev-4" }] }, now);
  assert.equal(batch.ok, true);
  if (!batch.ok) return;
  assert.deepEqual(batch.items.map((item) => item.kind), ["valid", "rejected", "duplicate", "valid"]);
  const results = batch.items.map((item) => resultFor(item, "stored"));
  assert.deepEqual(countResults(results), { accepted: 2, duplicate: 1, rejected: 1 });
  assert.equal(resultFor(batch.items[0], "exists").status, "duplicate", "already stored is a duplicate");
  assert.equal(JSON.stringify(results).includes("ev-bad") && JSON.stringify(results).includes("bad_type"), true, "the answer names the event and a fixed reason");
});
