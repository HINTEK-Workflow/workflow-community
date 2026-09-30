import assert from "node:assert/strict";
import test from "node:test";
import { buildOverviewWork, selectOverviewWork } from "../lib/workflow/overview-work";
import { summarizeProjectStatus } from "../lib/workflow/project-status";

const now = new Date("2026-09-28T10:00:00Z");
const status = (dueDate: string, tasks: { status: string }[]) => summarizeProjectStatus({ archivedAt: null, closedAt: null, startDate: "2026-09-01", dueDate, tasks, now });

test("overview work: one list, urgent first, paged without overlap and counted per filter", () => {
  const items = buildOverviewWork({
    today: "2026-09-28",
    projects: [
      { id: "p1", name: "Försenat", updatedAt: "2026-09-20T10:00:00Z", dueDate: "2026-09-25", status: status("2026-09-25", [{ status: "IN_PROGRESS" }]), tasks: [{ status: "IN_PROGRESS", progress: 40 }] },
      { id: "p2", name: "Pågår", updatedAt: "2026-09-27T10:00:00Z", dueDate: "2026-10-30", status: status("2026-10-30", [{ status: "COMPLETED" }, { status: "PLANNED" }]), tasks: [{ status: "COMPLETED", progress: 0 }, { status: "PLANNED", progress: 0 }] },
    ],
    controls: [{ id: "c1", title: "Kontroll", status: "DRAFT", updatedAt: "2026-09-26T10:00:00Z", percent: 60, errors: 3 }],
    tasks: Array.from({ length: 12 }, (_, index) => ({ id: `t${index}`, title: `Arbetsorder ${index}`, kind: "WORK_ORDER", status: index ? "IN_PROGRESS" : "COMPLETED", progress: 50, dueDate: "2026-10-10", updatedAt: `2026-09-${String(10 + index).padStart(2, "0")}T10:00:00Z` })),
  });
  assert.equal(items.find((item) => item.id === "p2")!.progress, 50, "a completed task counts as 100 %");
  assert.equal(items.find((item) => item.id === "p1")!.status, "Behöver åtgärdas");
  assert.equal(items.find((item) => item.id === "c1")!.status, "Behöver åtgärdas");
  const first = selectOverviewWork(items, { filter: "all", sort: "updated", page: 1 });
  const second = selectOverviewWork(items, { filter: "all", sort: "updated", page: 2 });
  assert.equal(first.items.length, 10);
  assert.equal(second.items.length, 5);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 15);
  assert.deepEqual(first.counts, { all: 15, projects: 2, tasks: 13, action: 2 });
  assert.equal(first.urgent.length, 3);
  assert.deepEqual(first.urgent.slice(0, 2).map((item) => item.id).sort(), ["c1", "p1"], "needs action and overdue come first");
});
