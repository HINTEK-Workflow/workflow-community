import assert from "node:assert/strict";
import test from "node:test";
import { isOwnEcho, saveIndicator } from "../lib/workflow/autosave";

// Calm autosave (2026-10-05) that never says "Sparat" for a change not yet saved (2026-11-01).
test("'Sparar…' from the first change until the server has answered, then 'Sparat'", () => {
  const base = { state: "idle" as const, dirty: false, autosave: true, savedAt: "14:32" };
  assert.equal(saveIndicator(base).label, "Sparat 14:32");
  assert.deepEqual(saveIndicator({ ...base, dirty: true }), { label: "Sparar…", tone: "muted", state: "saving" }, "a change waiting for its pause is not 'Sparat'");
  assert.equal(saveIndicator({ ...base, state: "saving" }).label, "Sparar…", "the save is under way");
  assert.equal(saveIndicator({ ...base, state: "saving", dirty: true }).label, "Sparar…");
  assert.equal(saveIndicator({ ...base, savedAt: "" }).label, "Sparat");
  assert.deepEqual(saveIndicator({ ...base, state: "error", dirty: true }), { label: "Inte sparat", tone: "error", state: "error" });
  // Without autosave a change is shown, since nothing will save it by itself; a manual save says Sparar… too.
  assert.equal(saveIndicator({ ...base, dirty: true, autosave: false }).label, "Ändrat");
  assert.equal(saveIndicator({ ...base, state: "saving", autosave: false }).label, "Sparar…");
});

test("'Sparat' is never the label while anything is unsaved", () => {
  for (const state of ["idle", "saving", "error"] as const) for (const autosave of [true, false]) {
    assert.ok(!saveIndicator({ state, dirty: true, autosave, savedAt: "14:32" }).label.startsWith("Sparat"), `${state}, autosave ${autosave}`);
  }
});

test("the echo of the person's own save in this tab is not read again; another tab's or a colleague's is", () => {
  const change = { byUserId: "u1", version: 5, reason: "save" };
  assert.equal(isOwnEcho(change, "u1", 5), true);
  assert.equal(isOwnEcho(change, "u1", 6), true);
  assert.equal(isOwnEcho(change, "u1", 4), false);
  assert.equal(isOwnEcho(change, "u2", 5), false);
  assert.equal(isOwnEcho({ ...change, reason: "timer" }, "u1", 5), false);
  assert.equal(isOwnEcho(change, undefined, 5), false);
  assert.equal(isOwnEcho(change, "u1", undefined), false);
});
