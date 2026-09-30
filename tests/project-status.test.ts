import assert from "node:assert/strict";
import test from "node:test";
import { canManageProjectLifecycle, summarizeProjectStatus } from "../lib/workflow/project-status";

// Wednesday 2026-09-23 12:00 Swedish time.
const now = new Date("2026-09-23T10:00:00.000Z");
const done = { status: "COMPLETED" };
const open = { status: "IN_PROGRESS" };
const planning = (status: string, endsAt = "2026-09-30T10:00:00.000Z", deletedAt: string | null = null) => ({ status, endsAt, deletedAt });

test("a project without tasks or active planning is planned", () => {
  const status = summarizeProjectStatus({ now, tasks: [] });
  assert.equal(status.state, "PLANNED");
  assert.equal(status.label, "Planerat");
  assert.equal(status.ongoing, true);
});

test("open tasks or active planning keep the project in progress", () => {
  assert.equal(summarizeProjectStatus({ now, tasks: [done, open] }).state, "IN_PROGRESS");
  assert.equal(summarizeProjectStatus({ now, tasks: [done], activities: [planning("PLANNED")] }).state, "IN_PROGRESS", "active planning keeps a finished project open (the 'Bygga hus' case)");
  assert.equal(summarizeProjectStatus({ now, tasks: [], activities: [planning("IN_PROGRESS")] }).state, "IN_PROGRESS");
});

test("all tasks completed and no active planning means ready to close", () => {
  const status = summarizeProjectStatus({ now, tasks: [done, done], activities: [planning("COMPLETED"), planning("CANCELED"), planning("PLANNED", "2026-09-22T10:00:00.000Z"), planning("PLANNED", "2026-09-30T10:00:00.000Z", "2026-09-20T10:00:00.000Z")] });
  assert.equal(status.state, "READY_TO_CLOSE", "finished, cancelled, ended and deleted planning does not hold the project open");
  assert.equal(status.label, "Klar att avsluta");
  assert.equal(status.ongoing, true, "ready to close is still in the Pågående tab until someone closes it");
});

test("closed and archived win over the derived state, and archived wins over closed", () => {
  assert.equal(summarizeProjectStatus({ now, closedAt: "2026-09-22T10:00:00.000Z", tasks: [open] }).state, "CLOSED");
  const archived = summarizeProjectStatus({ now, archivedAt: "2026-09-22T10:00:00.000Z", closedAt: "2026-09-21T10:00:00.000Z", tasks: [] });
  assert.equal(archived.state, "ARCHIVED");
  assert.equal(archived.ongoing, false);
});

test("a start date in the future means planned even with tasks", () => {
  assert.equal(summarizeProjectStatus({ now, startDate: "2026-10-01", tasks: [open] }).state, "PLANNED");
  assert.equal(summarizeProjectStatus({ now, startDate: "2026-09-23", tasks: [open] }).state, "IN_PROGRESS");
});

test("overdue only applies to planned or in-progress projects past their Swedish end date", () => {
  assert.equal(summarizeProjectStatus({ now, dueDate: "2026-09-22", tasks: [open] }).overdue, true);
  assert.equal(summarizeProjectStatus({ now, dueDate: "2026-09-23", tasks: [open] }).overdue, false, "the end date itself is not late");
  assert.equal(summarizeProjectStatus({ now, dueDate: "2026-09-22", tasks: [done] }).overdue, false, "ready to close is not late");
  assert.equal(summarizeProjectStatus({ now, dueDate: "2026-09-22", closedAt: now.toISOString(), tasks: [open] }).overdue, false);
});

test("only the company admin or a responsible member who may edit projects manages the lifecycle", () => {
  assert.equal(canManageProjectLifecycle({ admin: true, userId: "a", responsibleUserId: null, canEditProjects: false }), true);
  assert.equal(canManageProjectLifecycle({ admin: false, userId: "m", responsibleUserId: "m", canEditProjects: true }), true);
  assert.equal(canManageProjectLifecycle({ admin: false, userId: "m", responsibleUserId: "m", canEditProjects: false }), false, "being responsible never grants anything on its own");
  assert.equal(canManageProjectLifecycle({ admin: false, userId: "m", responsibleUserId: "other", canEditProjects: true }), false);
  assert.equal(canManageProjectLifecycle({ admin: false, userId: "m", responsibleUserId: null, canEditProjects: true }), false);
});
