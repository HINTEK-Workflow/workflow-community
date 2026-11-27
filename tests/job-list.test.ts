import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkItemType, WORK_ITEM_KINDS, WORK_ITEM_TYPE_LABEL, WORK_ITEM_TYPES, workItemKindMatches, workItemTypeKind, workItemTypeMatches, workItemTypesOffered, WORK_ITEM_FILTERS } from "../lib/workflow/work-items";
import { listWork, workStateMatches, workStateOf } from "../lib/workflow/work-list";
import { nativeJobRow, projectJobListItem, taskListItem, type TaskListSource } from "../features/workflow/work-list-items";
import { projectPeople } from "../lib/workflow/project-people";
import { buildOverviewWork, localOverviewWork } from "../lib/workflow/overview-work";
import { summarizeProjectStatus } from "../lib/workflow/project-status";

// B3 – en jobblista på nivå 1 (2026-10-21): work orders and tasks in one list with a type filter.

test("B3: the type filter is Alla · Arbetsordrar · Uppgifter and maps to the server's kind", () => {
  assert.deepEqual([...WORK_ITEM_TYPES], ["all", "work_orders", "tasks"]);
  assert.deepEqual(WORK_ITEM_TYPES.map((type) => WORK_ITEM_TYPE_LABEL[type]), ["Alla", "Arbetsordrar", "Uppgifter"]);
  assert.deepEqual([...WORK_ITEM_KINDS], ["WORK_ORDER", "TASK"]);
  assert.equal(workItemTypeKind("all"), undefined, "Alla sends no kind: the server lists every readable kind");
  assert.equal(workItemTypeKind("work_orders"), "WORK_ORDER");
  assert.equal(workItemTypeKind("tasks"), "TASK");
  for (const kind of ["WORK_ORDER", "FORM", "RISK_ASSESSMENT"]) assert.ok(workItemTypeMatches(kind, "all"), kind);
  assert.ok(workItemTypeMatches("WORK_ORDER", "work_orders"));
  assert.ok(!workItemTypeMatches("FORM", "work_orders"));
  assert.ok(!workItemTypeMatches("WORK_ORDER", "tasks"), "Uppgifter is every kind that is not a work order");
  assert.ok(workItemTypeMatches("FORM", "tasks") && workItemTypeMatches("RISK_ASSESSMENT", "tasks"));
  assert.ok(workItemKindMatches("FORM", undefined));
});

test("B3: an address or a stored choice gives a known type, else Alla", () => {
  assert.equal(parseWorkItemType("work_orders"), "work_orders", "the old Mina arbetsordrar address (?type=work_orders)");
  assert.equal(parseWorkItemType("tasks"), "tasks");
  for (const value of [null, undefined, "", "WORK_ORDER", "x", 3, {}]) assert.equal(parseWorkItemType(value), "all", String(value));
});

test("B3: the filter is offered only when it can choose something", () => {
  assert.equal(workItemTypesOffered({ canReadWorkOrders: true, canReadOtherTasks: true }), true);
  assert.equal(workItemTypesOffered({ canReadWorkOrders: true, canReadOtherTasks: false }), false, "only work orders: every row is one already");
  assert.equal(workItemTypesOffered({ canReadWorkOrders: false, canReadOtherTasks: true }), false, "no work orders to choose");
});

const source = (id: string, kind: string, extra: Partial<TaskListSource> = {}): TaskListSource => ({ id, kind, title: `Jobb ${id}`, status: "PLANNED", updatedAt: `2026-10-2${id}T08:00:00.000Z`, progress: 0, isMine: true, ...extra });

test("B3: one list merges work orders and tasks with the same scope, filters, counts and order (Local and the demo)", () => {
  const tasks = [source("1", "WORK_ORDER"), source("2", "FORM"), source("3", "RISK_ASSESSMENT", { status: "COMPLETED", progress: 100 }), source("4", "WORK_ORDER", { isMine: false })];
  const entries = (kind: ReturnType<typeof workItemTypeKind>) => tasks.filter((task) => workItemKindMatches(task.kind, kind)).map((task) => ({
    ...task, date: "", state: workStateOf(task), mine: task.isMine !== false, search: [task.title],
  }));
  const run = (kind: ReturnType<typeof workItemTypeKind>, scope: "mine" | "all" = "mine") =>
    listWork(entries(kind), { filters: WORK_ITEM_FILTERS, matches: workStateMatches, filter: "all", scope, sort: "updated", q: "", page: 1 });
  assert.deepEqual(run(undefined).items.map((item) => item.id), ["3", "2", "1"], "Mina: both kinds in one order, newest change first");
  assert.deepEqual(run(undefined, "all").items.map((item) => item.id), ["4", "3", "2", "1"], "Alla adds what the person may read");
  assert.deepEqual(run("WORK_ORDER", "all").items.map((item) => item.id), ["4", "1"]);
  assert.deepEqual(run("TASK").items.map((item) => item.id), ["3", "2"]);
  assert.equal(run("TASK").counts?.open, 1, "the counts follow the chosen type");
  assert.equal(run(undefined).counts?.all, 3);
});

test("B3: the same row for a job wherever it is listed at level 1", () => {
  const today = "2026-10-23";
  const order = taskListItem(source("1", "WORK_ORDER", { customerName: "Kund AB", placeName: "Elvägen 1", dueDate: "2026-10-20", responsibleName: "Anna Berg", maintenance: { priority: "URGENT" } }), today);
  const row = nativeJobRow(order);
  assert.equal(row.type, "work-order");
  assert.equal(row.subtitle, `Kund AB · Elvägen 1 · Förfallen ${order.date!.value}`, "where it is and the late date");
  assert.deepEqual(row.pill, { label: "Förfallen", tone: "danger" });
  assert.equal(row.subtitleTone, "danger", "an open urgent work order is red");
  assert.equal(nativeJobRow(order, { responsible: true }).subtitle.includes("Anna Berg"), true, "Alla and the project name who has the job");
  const task = nativeJobRow(taskListItem(source("2", "FORM", { projectName: "Skolan" }), today));
  assert.equal(task.type, "control");
  assert.equal(task.subtitle, "Projekt: Skolan · Saknar arbetsorder", "without customer and place the context – a draft says it lacks its work order (2026-10-27)");
  assert.deepEqual(task.pill, { label: "Planerad", tone: "neutral" });
  assert.equal(task.subtitleTone, undefined);
  // The project's job list: the step instead of the project, the same pill.
  const job = projectJobListItem({ id: "9", kind: "RISK_ASSESSMENT", title: "", status: "NEEDS_ACTION", progress: 40, step: { label: "Utförande" }, assignedToName: "Bo Ek" }, today);
  assert.equal(job.title, "Utan rubrik");
  assert.equal(job.href, "/?view=workflow_task&taskId=9&taskType=RISK_ASSESSMENT");
  const jobRow = nativeJobRow(job, { responsible: true });
  assert.equal(jobRow.type, "risk");
  assert.equal(jobRow.subtitle, "Utförande · Bo Ek");
  assert.deepEqual(jobRow.pill, { label: "Behöver åtgärdas", tone: "danger" });
  assert.deepEqual(nativeJobRow(projectJobListItem({ id: "8", kind: "FORM", title: "A", status: "CANCELLED", progress: 0 }, today)).pill, { label: "Utgått", tone: "neutral" });
});

// Namnbrickor på projektkorten (2026-10-22).

test("project people: the responsible person first, then who has a job, each once", () => {
  assert.deepEqual(projectPeople({ responsibleUserId: "u1", responsibleName: "Anna Berg" }, [
    { assignedToUserId: "u2", assignedToName: "Bo Ek" }, { assignedToUserId: "u1", assignedToName: "Anna Berg" }, { assignedToUserId: null, assignedToName: "  " },
    { assignedToUserId: null, assignedToName: "Extern Montör" }, { assignedToUserId: "u2", assignedToName: "Bo Ek" },
  ]), [{ key: "u1", name: "Anna Berg" }, { key: "u2", name: "Bo Ek" }, { key: "Extern Montör", name: "Extern Montör" }]);
  assert.deepEqual(projectPeople({}, []), []);
});

test("Översikt: a project card carries its name badges in Cloud, the demo and Local", () => {
  const status = summarizeProjectStatus({ dueDate: "", tasks: [] });
  const people = [{ key: "u1", name: "Anna Berg" }];
  const [project] = buildOverviewWork({ today: "2026-10-23", tasks: [], projects: [{ id: "p", name: "Skolan", updatedAt: "2026-10-23T08:00:00.000Z", dueDate: "", status, tasks: [], people }] });
  assert.deepEqual(project?.people, people);
  const [bare] = buildOverviewWork({ today: "2026-10-23", tasks: [], projects: [{ id: "p", name: "Skolan", updatedAt: "2026-10-23T08:00:00.000Z", dueDate: "", status, tasks: [] }] });
  assert.equal("people" in (bare ?? {}), false, "no badges asked for, none sent");
  const [nobody] = buildOverviewWork({ today: "2026-10-23", tasks: [], projects: [{ id: "p", name: "Skolan", updatedAt: "2026-10-23T08:00:00.000Z", dueDate: "", status, tasks: [], people: [] }] });
  assert.equal("people" in (nobody ?? {}), false, "a project without people has no badges on the card");
  const local = localOverviewWork({ workflowTasks: [], projects: [{ id: "p", name: "Skolan", updatedAt: "2026-10-23T08:00:00.000Z", dueDate: "", responsibleUserId: "u1", responsibleName: "Anna Berg",
    workflowTasks: [{ id: "t", title: "Kontroll", kind: "FORM", status: "PLANNED", progress: 0, updatedAt: "2026-10-23T08:00:00.000Z", assignedToUserId: "u2", assignedToName: "Bo Ek" }] }] }, "2026-10-23");
  assert.deepEqual(local.find((item) => item.kind === "PROJECT")?.people, [{ key: "u1", name: "Anna Berg" }, { key: "u2", name: "Bo Ek" }]);
  assert.equal(local.find((item) => item.kind === "TASK")?.people, undefined, "only projects have badges");
});
