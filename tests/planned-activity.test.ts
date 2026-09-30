import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalWorkspace, parseLocalWorkspace, removeLocalPlannedActivity, saveLocalPlannedActivity, saveLocalProjectRecord } from "../features/kfid/local-workspace-store";
import { plannedActivityInputSchema } from "../lib/workflow/planned-activity";

test("planned work remains separate from project budget and actual time", () => {
  const original = createLocalWorkspace({ id: "planning-local", name: "Planering AB" });
  const project = saveLocalProjectRecord(original, {
    name: "Tidsbudget", description: "", startDate: "2026-09-01", dueDate: "2026-12-31", customerId: null, timeBudgetMinutes: 480,
  }, "Lokal ägare");
  assert.equal(project.project.timeBudgetMinutes, 480);
  const activity = saveLocalPlannedActivity(project.workspace, {
    title: "Planerat platsbesök", description: "Planering, inte tidrapport.", kind: "TASK", status: "PLANNED",
    startsAt: "2026-10-01T08:00:00.000Z", endsAt: "2026-10-01T10:00:00.000Z", projectId: project.project.id,
    workflowTaskId: null, controlId: null, assignedToUserId: null,
  }, "Lokal ägare");
  assert.equal(activity.activity.version, 1);
  assert.deepEqual(activity.activity.assignedToUserIds, []);
  assert.equal(activity.activity.events.at(-1)?.kind, "CREATED");
  assert.equal(activity.workspace.workflowTasks.length, 0);
  const removed = removeLocalPlannedActivity(activity.workspace, activity.activity.id, 1, "Lokal ägare");
  assert.ok(removed.activity.deletedAt);
  assert.equal(removed.activity.events.at(-1)?.kind, "DELETED");
});

test("planned activity keeps several responsible users without inventing reported time", () => {
  const workspace = createLocalWorkspace({ id: "planning-local", name: "Planering AB" });
  const project = saveLocalProjectRecord(workspace, { name: "Teamarbete", description: "", startDate: "2026-09-01", dueDate: "2026-12-31", customerId: null });
  const saved = saveLocalPlannedActivity(project.workspace, {
    title: "Gemensam genomgång", startsAt: "2026-10-01T08:00:00.000Z", endsAt: "2026-10-01T10:00:00.000Z",
    projectId: project.project.id, workflowTaskId: null, controlId: null, assignedToUserId: "member-a", assignedToUserIds: ["member-a", "member-b"], assignedToName: "A, B",
  });
  assert.deepEqual(saved.activity.assignedToUserIds, ["member-a", "member-b"]);
  assert.deepEqual(saved.activity.assignments, [
    { userId: "member-a", plannedMinutes: null, startsAt: null, endsAt: null },
    { userId: "member-b", plannedMinutes: null, startsAt: null, endsAt: null },
  ]);
  assert.equal(saved.workspace.workflowTasks.length, 0);
  assert.throws(() => plannedActivityInputSchema.parse({
    title: "Dubblett", startsAt: "2026-10-01T08:00:00.000Z", endsAt: "2026-10-01T09:00:00.000Z", assignedToUserIds: ["member-a", "member-a"],
  }), /bara väljas en gång/);
});

test("individual participant time must be a complete interval within the activity", () => {
  const input = {
    title: "Personlig planering",
    startsAt: "2026-10-01T08:00:00.000Z",
    endsAt: "2026-10-01T12:00:00.000Z",
    assignedToUserIds: ["member-a"],
    assignments: [{
      userId: "member-a",
      plannedMinutes: 90,
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T10:30:00.000Z",
    }],
  };
  const parsed = plannedActivityInputSchema.parse(input);
  assert.equal(parsed.assignments?.[0]?.plannedMinutes, 90);
  assert.throws(() => plannedActivityInputSchema.parse({
    ...input,
    assignments: [{ ...input.assignments[0], plannedMinutes: 60 }],
  }), /motsvara dess tidsintervall/);
  assert.throws(() => plannedActivityInputSchema.parse({
    ...input,
    assignments: [{ ...input.assignments[0], startsAt: "2026-10-01T07:30:00.000Z" }],
  }), /ligga inom aktivitetens tidsintervall/);
  assert.throws(() => plannedActivityInputSchema.parse({
    ...input,
    assignments: [{ ...input.assignments[0], endsAt: null }],
  }), /anges tillsammans/);
});

test("local schema 7 gains empty planning data in memory and invalid task combinations fail", () => {
  const current = createLocalWorkspace({ id: "planning-local", name: "Planering AB" });
  const legacy = { ...current, schemaVersion: 7 } as Record<string, unknown>;
  delete legacy.plannedActivities;
  const migrated = parseLocalWorkspace(legacy, "planning-local");
  assert.equal(migrated.schemaVersion, 11);
  assert.deepEqual(migrated.plannedActivities, []);
  assert.throws(() => plannedActivityInputSchema.parse({
    title: "Ogiltig", startsAt: "2026-10-01T08:00:00.000Z", endsAt: "2026-10-01T09:00:00.000Z",
    workflowTaskId: "task", controlId: "control",
  }), /högst en uppgift/);
});
