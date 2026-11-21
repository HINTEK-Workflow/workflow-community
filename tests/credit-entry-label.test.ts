import assert from "node:assert/strict";
import test from "node:test";
import { creditEntryDescription } from "../lib/ai/surface-labels";

// Data check 2026-10-04: a finished AI run still read "Reserverad maxkostnad" in the credit history.
test("an AI reservation reads as what the credits went to once the run is done", () => {
  const entry = { kind: "AI_RESERVATION", description: "Reserverad maxkostnad för AI-granskning" };
  assert.equal(creditEntryDescription({ ...entry, aiReservations: [{ status: "COMPLETED", surface: "review", agentId: "kfid-control-review" }] }), "Workflow AI – Granska med AI");
  assert.equal(creditEntryDescription({ ...entry, aiReservations: [{ status: "COMPLETED", surface: null, agentId: "workflow-assistant" }] }), "Workflow AI – Chatten (äldre körningar)");
  assert.equal(creditEntryDescription({ ...entry, aiReservations: [{ status: "FAILED", surface: "chat", agentId: "x" }] }), "Workflow AI – Chatten (avbrutet, krediterna återförda)");
  assert.equal(creditEntryDescription({ ...entry, aiReservations: [{ status: "RUNNING", surface: "chat", agentId: "x" }] }), "Workflow AI – Chatten (pågår, reserverat)");
  assert.equal(creditEntryDescription({ kind: "AI_RELEASE", description: "x" }), "Workflow AI – överskottet återfört");
  assert.equal(creditEntryDescription({ kind: "PURCHASE", description: "150 krediter" }), "150 krediter");
});
