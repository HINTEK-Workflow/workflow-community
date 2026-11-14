import assert from "node:assert/strict";
import test from "node:test";
import { summarizeOverviewKpis, type OverviewKpiTask } from "../lib/workflow/overview-kpis";

// Wednesday 2026-09-23 12:00 Swedish time; the Swedish week is Monday 21 to Monday 28 September.
const now = new Date("2026-09-23T10:00:00.000Z");
const task = (overrides: Partial<OverviewKpiTask>): OverviewKpiTask => ({ kind: "WORK_ORDER", status: "IN_PROGRESS", dueDate: "", completedAt: null, isMine: false, ...overrides });

const input = {
  now,
  currentUserId: "me",
  members: [{ id: "me", weeklyWorkMinutes: 2400 }, { id: "colleague", weeklyWorkMinutes: 1200 }],
  tasks: [
    task({ isMine: true, dueDate: "2026-09-22" }),
    task({ status: "NEEDS_ACTION", dueDate: "2026-09-25" }),
    task({ status: "COMPLETED", completedAt: "2026-09-10T08:00:00.000Z", isMine: true }),
    task({ status: "COMPLETED", completedAt: "2026-07-01T08:00:00.000Z" }),
    task({ kind: "FORM", status: "IN_PROGRESS", isMine: true }),
  ],
  projects: [
    { status: { state: "IN_PROGRESS" as const, ongoing: true, overdue: true }, timeBudgetMinutes: 60, reportedMinutes: 90, isMine: true },
    { status: { state: "READY_TO_CLOSE" as const, ongoing: true, overdue: false }, timeBudgetMinutes: 0, reportedMinutes: 0, isMine: false },
    { status: { state: "CLOSED" as const, ongoing: false, overdue: false }, timeBudgetMinutes: 0, reportedMinutes: 0, isMine: false },
    { status: { state: "ARCHIVED" as const, ongoing: false, overdue: false }, timeBudgetMinutes: 10, reportedMinutes: 99, isMine: true },
  ],
  timeEntries: [
    { userId: "me", startedAt: "2026-09-22T06:00:00.000Z", durationSec: 3600 },
    { userId: "colleague", startedAt: "2026-09-23T06:00:00.000Z", durationSec: 1800 },
    { userId: "me", startedAt: "2026-09-19T06:00:00.000Z", durationSec: 7200 },
  ],
  activities: [
    { startsAt: "2026-09-24T06:00:00.000Z", endsAt: "2026-09-24T08:00:00.000Z", assignedToUserId: null, assignedToUserIds: ["me", "colleague"], status: "PLANNED" as const, projectId: null },
    { startsAt: "2026-09-24T06:00:00.000Z", endsAt: "2026-09-24T09:00:00.000Z", assignedToUserId: "me", status: "COMPLETED" as const, projectId: null },
  ],
};

test("Planned time is compared with the one capacity count: a holiday holds no capacity, the weekly time stays for reported time", () => {
  // Christmas week 2026: 24 and 25 December are off, so the week holds three working days.
  const christmas = summarizeOverviewKpis({ ...input, scope: "mine", now: new Date("2026-12-22T10:00:00.000Z"), members: [{ id: "me", weeklyWorkMinutes: 2400 }], tasks: [], projects: [], timeEntries: [],
    activities: [{ startsAt: "2026-12-21T06:00:00.000Z", endsAt: "2026-12-25T15:00:00.000Z", assignedToUserId: "me", status: "PLANNED" as const, projectId: null }] });
  assert.equal(christmas.weeklyTargetMinutes, 2400);
  assert.equal(christmas.availableMinutes, christmas.plannedMinutes, "booked Monday to Friday is exactly the week's working days: 0 h free, not 16 h");
  assert.ok(christmas.availableMinutes < 2400);
});

test("team key figures count every visible task, project, reported and planned minute this Swedish week", () => {
  const team = summarizeOverviewKpis({ ...input, scope: "team" });
  assert.equal(team.openTasks, 3);
  assert.equal(team.needsActionTasks, 1);
  assert.equal(team.overdueTasks, 1, "a control date is never a due date");
  assert.equal(team.dueSoonTasks, 1);
  assert.equal(team.completedLast30Days, 1);
  assert.equal(team.ongoingProjects, 2, "ongoing = neither closed nor archived, the same as the Pågående tab");
  assert.equal(team.readyToCloseProjects, 1);
  assert.equal(team.overdueProjects, 1);
  assert.equal(team.overBudgetProjects, 1);
  assert.equal(team.reportedMinutes, 90, "last week's time is outside the window");
  assert.equal(team.plannedMinutes, 240, "completed planning is not capacity; each internal participant is booked in full");
  assert.equal(team.weeklyTargetMinutes, 3600);
  assert.equal(team.people, 2);
});

test("personal key figures only use the member's own work and time", () => {
  const mine = summarizeOverviewKpis({ ...input, scope: "mine" });
  assert.equal(mine.openTasks, 2);
  assert.equal(mine.needsActionTasks, 0);
  assert.equal(mine.completedLast30Days, 1);
  assert.equal(mine.ongoingProjects, 1);
  assert.equal(mine.reportedMinutes, 60);
  assert.equal(mine.plannedMinutes, 120);
  assert.equal(mine.weeklyTargetMinutes, 2400);
  assert.equal(mine.people, 1);
});

test("a zero in a key figure's line never warns (MOB-16)", async () => {
  const { overdueDetail, projectDetail } = await import("../lib/workflow/overview-kpis");
  assert.deepEqual(overdueDetail({ overdueTasks: 3, dueSoonTasks: 0 }), { text: "0 förfaller inom 7 dagar", tone: null });
  assert.equal(overdueDetail({ overdueTasks: 0, dueSoonTasks: 2 }).tone, "warning");
  assert.deepEqual(projectDetail({ readyToCloseProjects: 0, overdueProjects: 0, overBudgetProjects: 0 }), { text: "Inget förfallet", tone: null });
  assert.deepEqual(projectDetail({ readyToCloseProjects: 1, overdueProjects: 2, overBudgetProjects: 0 }), { text: "1 klart att avsluta · 2 förfallna", tone: "danger" });
});
