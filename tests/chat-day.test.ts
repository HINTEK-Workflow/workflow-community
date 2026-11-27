import assert from "node:assert/strict";
import test from "node:test";
import { chatDayLabel } from "../lib/ai/chat-day";

// Workflow AI's conversation (2026-11-02): the day between the bubbles, in Swedish time.
test("chat day: I dag, I går, then the date, by the Swedish day", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  assert.equal(chatDayLabel("2026-11-02T00:30:00+01:00", now), "I dag");
  assert.equal(chatDayLabel("2026-11-01T23:30:00+01:00", now), "I går");
  assert.equal(chatDayLabel("2026-10-30T10:00:00Z", now), "2026-10-30");
  assert.equal(chatDayLabel("nonsense", now), "");
});
