import assert from "node:assert/strict";
import test from "node:test";
import { summarizeProjectStatistics, type ProjectStatisticsInput } from "../lib/workflow/project-statistics";
import { summarizeProjectStatus } from "../lib/workflow/project-status";

const now = new Date("2026-09-27T10:00:00Z");
const project = (input: Partial<ProjectStatisticsInput> & { id: string; tasks?: string[]; closedAt?: string; archivedAt?: string }): ProjectStatisticsInput => {
  const tasks = (input.tasks ?? []).map((status) => ({ status }));
  return {
    name: input.id, responsibleName: "", startDate: "", dueDate: "", createdDay: "2026-09-01", closedDay: input.closedAt ?? null, archivedDay: input.archivedAt ?? null,
    tasksTotal: tasks.length, tasksDone: tasks.filter((task) => task.status === "COMPLETED").length,
    ...input,
    status: summarizeProjectStatus({ closedAt: input.closedAt, archivedAt: input.archivedAt, startDate: input.startDate, dueDate: input.dueDate, tasks, now }),
  };
};

const projects = [
  project({ id: "late", responsibleName: "Anna", startDate: "2026-08-01", dueDate: "2026-09-10", tasks: ["IN_PROGRESS"] }),
  project({ id: "running", responsibleName: "Anna", startDate: "2026-09-05", dueDate: "2026-12-01", tasks: ["COMPLETED", "IN_PROGRESS"] }),
  project({ id: "on-time", responsibleName: "Bo", startDate: "2026-08-10", dueDate: "2026-09-20", closedAt: "2026-09-15", tasks: ["COMPLETED"] }),
  project({ id: "too-late", responsibleName: "Bo", startDate: "2026-07-01", dueDate: "2026-08-01", closedAt: "2026-09-02", tasks: ["COMPLETED"] }),
  project({ id: "old", startDate: "2025-01-01", dueDate: "2025-02-01", closedAt: "2025-02-01", tasks: ["COMPLETED"] }),
  project({ id: "no-start", createdDay: "2026-09-20" }),
];

test("project statistics count started, closed and closed on time in the period", () => {
  const result = summarizeProjectStatistics({ projects, from: "2026-09-01", to: "2026-09-30", bucket: "month" });
  assert.deepEqual(result.series.map((row) => [row.date, row.started, row.closed]), [["2026-09", 2, 2]]);
  assert.equal(result.kpis.started, 2, "running (start date) and no-start (created day)");
  assert.equal(result.kpis.closed, 2);
  assert.equal(result.kpis.closedOnTime, 1);
  assert.equal(result.kpis.onTimePercent, 50);
  assert.equal(result.kpis.ongoing, 3);
  assert.equal(result.kpis.overdue, 1);
  assert.deepEqual(result.statuses.map((row) => [row.state, row.count, row.overdue]), [["PLANNED", 1, 0], ["IN_PROGRESS", 2, 1], ["READY_TO_CLOSE", 0, 0], ["CLOSED", 3, 0], ["ARCHIVED", 0, 0]]);
});

test("project statistics list overdue first and filter by state", () => {
  const period = summarizeProjectStatistics({ projects, from: "2026-09-01", to: "2026-09-30", bucket: "day" });
  assert.deepEqual(period.list.items.map((item) => item.id), ["late", "running", "no-start", "on-time", "too-late"], "old project closed before the period is left out");
  assert.equal(period.list.items.find((item) => item.id === "too-late")?.onTime, false);
  assert.deepEqual(summarizeProjectStatistics({ projects, from: "2026-09-01", to: "2026-09-30", bucket: "day", filter: "overdue" }).list.items.map((item) => item.id), ["late"]);
  assert.deepEqual(summarizeProjectStatistics({ projects, from: "2026-09-01", to: "2026-09-30", bucket: "day", filter: "closed" }).list.items.map((item) => item.id), ["on-time", "too-late"]);
  const paged = summarizeProjectStatistics({ projects, from: "2026-09-01", to: "2026-09-30", bucket: "day", page: 2, pageSize: 2 });
  assert.equal(paged.list.pages, 3);
  assert.deepEqual(paged.list.items.map((item) => item.id), ["no-start", "on-time"]);
});

test("project statistics group ongoing and closed work per responsible", () => {
  const result = summarizeProjectStatistics({ projects, from: "2026-09-01", to: "2026-09-30", bucket: "month" });
  assert.deepEqual(result.responsible, [
    { name: "Anna", ongoing: 2, overdue: 1, closed: 0, closedOnTime: 0 },
    { name: "Ingen ansvarig", ongoing: 1, overdue: 0, closed: 0, closedOnTime: 0 },
    { name: "Bo", ongoing: 0, overdue: 0, closed: 2, closedOnTime: 1 },
  ]);
  assert.equal(summarizeProjectStatistics({ projects: [], from: "2026-09-01", to: "2026-09-30", bucket: "month" }).kpis.onTimePercent, null);
});
