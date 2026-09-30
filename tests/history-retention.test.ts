import assert from "node:assert/strict";
import test from "node:test";
import { emptyCounts, isRetentionChoice, manualCutoffProblem, purgeDetail, retentionCutoff, retentionLabel } from "../lib/workflow/history-retention";

test("history retention: choices, labels and the cutoff stay within the target month", () => {
  assert.ok(isRetentionChoice(null) && isRetentionChoice(12) && isRetentionChoice(120));
  assert.ok(!isRetentionChoice(1) && !isRetentionChoice(0) && !isRetentionChoice("12"));
  assert.equal(retentionLabel(null), "Tills vidare (raderas bara för hand)");
  assert.equal(retentionLabel(6), "6 månader");
  assert.equal(retentionLabel(12), "1 år");
  assert.equal(retentionLabel(84), "7 år");
  assert.equal(retentionCutoff(12, new Date("2026-09-30T10:00:00Z")).toISOString(), "2025-09-30T10:00:00.000Z");
  assert.equal(retentionCutoff(6, new Date("2026-08-31T00:00:00Z")).toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(retentionCutoff(24, new Date("2028-02-29T00:00:00Z")).toISOString(), "2026-02-28T00:00:00.000Z");
});

test("history retention: a manual date must be a real past day, and the log line has counts only", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  assert.equal(manualCutoffProblem("2026-09-01", now), null);
  assert.match(manualCutoffProblem("2026-10-01", now) ?? "", /bakåt/);
  assert.match(manualCutoffProblem("2026-02-30", now) ?? "", /finns inte/);
  assert.match(manualCutoffProblem("", now) ?? "", /Välj/);
  const detail = purgeDetail("manual", new Date("2025-09-30T00:00:00Z"), { ...emptyCounts(), versions: 3, planning: 2 });
  assert.equal(detail, "Historik raderad för hand (äldre än 2025-09-30) – tidigare versioner av uppgifter, protokoll och kontroller: 3, planeringshistorik: 2.");
  assert.match(purgeDetail("retention", new Date("2025-09-30T00:00:00Z"), emptyCounts()), /enligt lagringstiden .* inget att radera/);
});
