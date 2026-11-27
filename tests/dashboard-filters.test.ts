import assert from "node:assert/strict";
import test from "node:test";
import { summarizeOverviewKpis, overviewKpiHref, type OverviewKpiTask } from "../lib/workflow/overview-kpis";
import { completedFrom, listWork, recentDoneFrom, workStateMatches, workStateOf } from "../lib/workflow/work-list";
import { WORK_ITEM_FILTERS } from "../lib/workflow/work-items";
import { workOrderMatches } from "../lib/workflow/work-orders";
import { isLateTask } from "../lib/workflow/late-tasks";
import { isMineProject, projectAttention, PROJECT_ATTENTION } from "../lib/workflow/project-filters";
import { allowedFilter, filterDay, listHref } from "../lib/url-filters";
import { deviationHref, deviationMatches, selfInspectionReminders, type SelfInspectionView } from "../lib/self-inspection/model";
import { nativeNoticeHref } from "../lib/workflow/native-mode";

// Dashboard etapp 3 (2026-10-28): "Varje nyckeltal ska öppna rätt lista med rätt filter … Samma beräkningsregel i
// nyckeltal och lista."
const now = new Date("2026-10-28T10:00:00.000Z");
const today = "2026-10-28";
const task = (overrides: Partial<OverviewKpiTask> & { id: string }): OverviewKpiTask & { id: string } => ({ kind: "WORK_ORDER", status: "PLANNED", dueDate: "", completedAt: null, isMine: true, ...overrides });
const tasks = [
  task({ id: "late", dueDate: "2026-10-27" }),
  task({ id: "late-action", status: "NEEDS_ACTION", dueDate: "2026-10-01" }),
  task({ id: "today", status: "IN_PROGRESS", dueDate: today }),
  task({ id: "started", status: "PLANNED", progress: 40 }),
  task({ id: "paused", kind: "FORM", status: "PAUSED" }),
  task({ id: "done-late", status: "COMPLETED", dueDate: "2026-10-01", completedAt: "2026-10-20T08:00:00.000Z" }),
  task({ id: "done-edge", status: "COMPLETED", completedAt: "2026-09-27T22:30:00.000Z" }), // 28 Sept 00:30 Swedish time
  task({ id: "done-old", status: "COMPLETED", completedAt: "2026-09-27T21:30:00.000Z" }), // 27 Sept 23:30 Swedish time
  task({ id: "cancelled", status: "CANCELLED", dueDate: "2026-10-01" }),
  task({ id: "theirs", dueDate: "2026-10-02", isMine: false }),
];
const empty = { currentUserId: "me", now, members: [], projects: [], timeEntries: [], activities: [] };

test("each task key figure equals the job list's count for the filter its tile opens", () => {
  for (const scope of ["team", "mine"] as const) {
    const kpis = summarizeOverviewKpis({ ...empty, scope, tasks });
    const entries = tasks.map((item) => ({ ...item, title: item.id, updatedAt: "2026-10-01", date: item.dueDate, mine: item.isMine, search: [], state: workStateOf(item) }));
    const list = (filter: (typeof WORK_ITEM_FILTERS)[number], from?: string) => listWork(entries.filter((entry) => completedFrom(entry, from)), {
      filters: WORK_ITEM_FILTERS, matches: (entry, value) => workStateMatches(entry, value, today), filter, scope: scope === "team" ? "all" : "mine", sort: "updated", q: "", page: 1, limit: 48 }).total;
    assert.equal(kpis.openTasks, list("open"), `${scope}: Öppna`);
    assert.equal(kpis.inProgressTasks, list("active"), `${scope}: Pågår, a planned job with progress included`);
    assert.equal(kpis.needsActionTasks, list("action"), `${scope}: Behöver åtgärdas`);
    assert.equal(kpis.overdueTasks, list("overdue"), `${scope}: Förfallna`);
    assert.equal(kpis.completedLast30Days, list("done", recentDoneFrom(now)), `${scope}: Klara, 30 dagar`);
  }
  const team = summarizeOverviewKpis({ ...empty, scope: "team", tasks });
  assert.equal(team.overdueTasks, 3, "late, late-action and theirs; neither today's, a completed nor an utgått job");
  assert.equal(team.inProgressTasks, 3, "today, started (progress) and paused – never NEEDS_ACTION");
  assert.equal(team.completedLast30Days, 2, "the 30 days are Swedish days: 28 Sept 00:30 counts, 27 Sept 23:30 does not");
  assert.equal(recentDoneFrom(now), "2026-09-28");
});

test("Förfallna is one rule: the job list, the work order list and isLateTask agree", () => {
  for (const item of tasks) {
    const state = workStateOf(item);
    assert.equal(workStateMatches({ ...item, state }, "overdue", today), isLateTask(item, today), item.id);
  }
  // The work order list's own matcher uses the same rule on today's date.
  assert.equal(workOrderMatches({ status: "PLANNED", progress: 0, dueDate: "2000-01-01" }, "overdue"), true);
  assert.equal(workOrderMatches({ status: "COMPLETED", progress: 100, dueDate: "2000-01-01" }, "overdue"), false);
  assert.equal(workStateMatches({ state: "planned", status: "PLANNED", dueDate: "" }, "overdue", today), false, "no Klart senast is never late");
});

test("every key figure opens the existing list with its filter, Teamet as Alla and Jag as Mina", () => {
  assert.equal(overviewKpiHref("overdueTasks", "mine", now), "/?view=tasks&filter=overdue&scope=mine&type=all");
  assert.equal(overviewKpiHref("overdueTasks", "team", now), "/?view=tasks&filter=overdue&scope=all&type=all");
  assert.equal(overviewKpiHref("needsActionTasks", "team", now), "/?view=tasks&filter=action&scope=all&type=all");
  assert.equal(overviewKpiHref("openTasks", "mine", now), "/?view=tasks&filter=open&scope=mine&type=all");
  assert.equal(overviewKpiHref("completedLast30Days", "mine", now), "/?view=tasks&filter=done&scope=mine&from=2026-09-28&type=all");
  assert.equal(overviewKpiHref("ongoingProjects", "team", now), "/?view=projects&filter=ongoing&scope=all");
  assert.equal(overviewKpiHref("overBudget", "mine", now), "/?view=projects&filter=ongoing&scope=mine&status=overBudget");
});

test("the project figures and the Status filter share projectAttention", () => {
  const projects = [
    { status: { state: "IN_PROGRESS" as const, ongoing: true, overdue: true }, timeBudgetMinutes: 60, reportedMinutes: 90, isMine: true },
    { status: { state: "READY_TO_CLOSE" as const, ongoing: true, overdue: false }, timeBudgetMinutes: 60, reportedMinutes: 60, isMine: true },
    { status: { state: "PLANNED" as const, ongoing: true, overdue: false }, timeBudgetMinutes: 0, reportedMinutes: 500, isMine: false },
    { status: { state: "CLOSED" as const, ongoing: false, overdue: false }, timeBudgetMinutes: 10, reportedMinutes: 99, isMine: true },
  ];
  const kpis = summarizeOverviewKpis({ ...empty, scope: "team", tasks: [], projects });
  const listed = (attention: (typeof PROJECT_ATTENTION)[number]) => projects.filter((project) => projectAttention(project, attention)).length;
  assert.equal(kpis.overdueProjects, listed("overdue"));
  assert.equal(kpis.overBudgetProjects, listed("overBudget"));
  assert.equal(kpis.readyToCloseProjects, listed("readyToClose"));
  assert.deepEqual([kpis.overdueProjects, kpis.overBudgetProjects, kpis.readyToCloseProjects], [1, 1, 1], "a closed project and a project without budget never count");
});

test("Mina projekt: responsible, creator, or a job of mine – assigned, created unassigned or booked", () => {
  assert.equal(isMineProject({ responsibleUserId: "me" }, "me", []), true);
  assert.equal(isMineProject({ createdBy: "me" }, "me", []), true);
  assert.equal(isMineProject({}, "me", [{ assignedToUserId: "me" }]), true);
  assert.equal(isMineProject({}, "me", [{ assignedToUserId: null, createdBy: "me" }]), true);
  assert.equal(isMineProject({}, "me", [{ assignedToUserId: "other", createdBy: "me" }]), false);
  assert.equal(isMineProject({}, "me", [{ assignedToUserId: "other", booked: true }]), true);
  assert.equal(isMineProject({ responsibleUserId: "me" }, "", []), false);
});

test("address filters: only allowed values, real days, and a stable href", () => {
  assert.equal(allowedFilter("overdue", WORK_ITEM_FILTERS), "overdue");
  assert.equal(allowedFilter("drop table", WORK_ITEM_FILTERS), null);
  assert.equal(allowedFilter(null, WORK_ITEM_FILTERS), null);
  assert.equal(filterDay("2026-02-29"), null);
  assert.equal(filterDay("2026-10-28"), "2026-10-28");
  assert.equal(filterDay("28/10"), null);
  assert.equal(listHref("tasks", { filter: "open", scope: "", attention: true, from: null }), "/?view=tasks&filter=open&attention=1");
});

test("a deviation reminder opens the deviation itself, on the computer and the phone", () => {
  const view = {
    canEdit: false, current: null, myConfirmation: null, me: { id: "me" },
    review: { status: "OK", nextDue: null },
    deviations: [{ id: "dev 7", kind: "DEVIATION", number: 7, title: "Jordfel", action: "", status: "OPEN", responsibleId: "me", dueDate: "2026-10-20" }],
  } as unknown as Pick<SelfInspectionView, "canEdit" | "current" | "myConfirmation" | "review" | "deviations" | "me">;
  const [reminder] = selfInspectionReminders(view, today);
  assert.equal(reminder.href, deviationHref("dev 7"));
  assert.equal(reminder.href, "/?view=deviations&deviation=dev%207");
  assert.equal(reminder.deadline, "OVERDUE");
  assert.equal(nativeNoticeHref(reminder.href), reminder.href, "the phone keeps the entry");
});

test("the deviation log's filters", () => {
  const input = { meId: "me", today };
  const open = { status: "OPEN", dueDate: "2026-10-27", responsibleId: "me" };
  const done = { status: "DONE", dueDate: "2026-10-01", responsibleId: "me" };
  const theirs = { status: "IN_PROGRESS", dueDate: "", responsibleId: "other" };
  assert.deepEqual([open, done, theirs].map((item) => deviationMatches(item, "open", input)), [true, false, true]);
  assert.deepEqual([open, done, theirs].map((item) => deviationMatches(item, "overdue", input)), [true, false, false]);
  assert.deepEqual([open, done, theirs].map((item) => deviationMatches(item, "mine", input)), [true, false, false]);
  assert.deepEqual([open, done, theirs].map((item) => deviationMatches(item, "all", input)), [true, true, true]);
});
