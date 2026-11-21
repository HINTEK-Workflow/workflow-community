import assert from "node:assert/strict";
import test from "node:test";
import { buildOverviewWork, localOverviewWork } from "../lib/workflow/overview-work";
import { summarizeProjectStatus } from "../lib/workflow/project-status";

// Quality check 2026-10-05, F8: Local's Översikt must give the same progression and status as Cloud for the same data.
const future = "2999-01-01";
const project = { id: "p1", name: "Ställverk", updatedAt: "2026-10-01T10:00:00Z", startDate: future, dueDate: "2999-02-01", archivedAt: null, closedAt: null };
const protocol = { id: "f1", title: "Kontroll före idrifttagning", kind: "FORM", status: "IN_PROGRESS", progress: 95, updatedAt: "2026-10-01T09:00:00Z", projectId: "p1" };
const task = { id: "t1", title: "Arbetsorder", kind: "WORK_ORDER", status: "PLANNED", progress: 0, updatedAt: "2026-10-01T08:00:00Z", projectId: "p1" };

test("Local and Cloud overview: the same progression, and a future start is Planerat", () => {
  const local = localOverviewWork({
    projects: [{ ...project, workflowTasks: [protocol, task] }],
    workflowTasks: [],
  }, "2026-10-06");
  // The Cloud route: the tasks' stored progress and the status with the start date (app/api/overview-work).
  const tasks = [{ status: protocol.status, progress: protocol.progress }, { status: task.status, progress: task.progress }];
  const cloud = buildOverviewWork({
    today: "2026-10-06",
    projects: [{ id: project.id, name: project.name, updatedAt: project.updatedAt, dueDate: project.dueDate, tasks,
      status: summarizeProjectStatus({ archivedAt: null, closedAt: null, startDate: project.startDate, dueDate: project.dueDate, tasks }) }],
    tasks: [{ ...protocol, projectName: project.name }, { ...task, projectName: project.name }],
  });
  assert.deepEqual(local, cloud);
  const projectItem = local.find((item) => item.kind === "PROJECT")!;
  assert.equal(projectItem.status, "Planerat");
  assert.equal(projectItem.progress, Math.round((95 + 0) / 2));
  assert.equal(local.find((item) => item.id === "f1")!.progress, 95);
});
