import assert from "node:assert/strict";
import test from "node:test";
import { countLateTasks, isLateTask } from "../lib/workflow/late-tasks";
import { summarizeOverviewKpis } from "../lib/workflow/overview-kpis";
import { taskListItem } from "../features/workflow/work-list-items";
import { adviseFlow } from "../lib/workflow/flow-advisor";
import { projectFlow } from "../lib/workflow/task-flow";
import { summarizeProjectStatus } from "../lib/workflow/project-status";

const today = "2026-10-18";
const tasks = [
  { id: "a", status: "IN_PROGRESS", dueDate: "2026-10-10" },
  { id: "b", status: "NEEDS_ACTION", dueDate: "2026-10-17" },
  { id: "c", status: "COMPLETED", dueDate: "2026-10-01" },
  { id: "d", status: "CANCELLED", dueDate: "2026-10-01" },
  { id: "e", status: "PLANNED", dueDate: "2026-10-18" },
  { id: "f", status: "PLANNED" },
];

test("one rule for late jobs: open and past Klart senast", () => {
  assert.deepEqual(tasks.filter((task) => isLateTask(task, today)).map((task) => task.id), ["a", "b"]);
  assert.equal(countLateTasks(tasks, today), 2);
});

test("Hem's key figure and the Jobb list's rows agree on what is late", () => {
  const rows = tasks.map((task) => taskListItem({ ...task, kind: "WORK_ORDER", title: task.id, updatedAt: "2026-10-17T10:00:00Z" } as never, today));
  const listLate = rows.filter((row) => row.date?.tone === "danger").length;
  const kpis = summarizeOverviewKpis({ scope: "team", currentUserId: "u", now: new Date("2026-10-18T10:00:00Z"), members: [], projects: [], timeEntries: [], activities: [],
    tasks: tasks.map((task) => ({ ...task, kind: "WORK_ORDER", isMine: true, completedAt: null })) } as never);
  assert.equal(kpis.overdueTasks, listLate);
});

test("a finished project with a future start date says so instead of 'Avsluta projektet'", () => {
  const status = summarizeProjectStatus({ startDate: "2026-10-30", tasks: [{ id: "t", status: "COMPLETED" }], now: new Date("2026-10-18T10:00:00Z") });
  assert.equal(status.state, "PLANNED");
  assert.equal(status.closeBlocker, "Projektet startar 2026-10-30");
  const flow = projectFlow({ closed: false, archived: false, taskCount: 1, startedCount: 0, completedCount: 1, startsOn: "2026-10-30" });
  assert.ok(flow.steps.some((step) => /Projektet startar 2026-10-30/.test(step.hint ?? "")));
  const tips = adviseFlow({ kind: "PROJECT", flow, saved: true, completed: false, today, project: { taskCount: 1, openCount: 0, closed: false, startsOn: "2026-10-30", editHref: "/?view=project&edit=1" } });
  assert.equal(tips[0]?.title, "Alla jobb är klara");
  assert.match(tips[0]?.text ?? "", /startar 2026-10-30/);
  assert.equal(tips[0]?.action?.label, "Ändra startdatum");
  assert.ok(!tips.some((tip) => tip.id === "project-close"));
});
