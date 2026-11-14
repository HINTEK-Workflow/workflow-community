import assert from "node:assert/strict";
import test from "node:test";
import { createDemoDatabase, demoOrderSummary } from "../features/demo/demo-data";
import { projectCompletion, summarizeFrameAdherence } from "../lib/workflow/project-progress";
import { summarizeProjectStatus } from "../lib/workflow/project-status";
import { taskDueDateError } from "../lib/workflow/project-frame";
import { workflowTaskProgress } from "../lib/workflow/task-model";
import { swedishDayKey } from "../lib/swedish-time";
import { ampacityFor, companyCalcData } from "../lib/calculators/company-data";
import { scheduleViews } from "../lib/workflow/form-schedule";
import { isUrgentOpen, waitingReasonOf } from "../lib/workflow/maintenance";
import { planningScope } from "../lib/self-inspection/planning-scope";
import { PLANNING_FORM_ID } from "../lib/workflow/builtin-planning-form";

// Seven consecutive days, so the approved scenario holds on every weekday (the data is relative to today).
const days = Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(2026, 8, 28 + index, 10)));

for (const now of days) {
  test(`approved demo data holds its scenario on ${swedishDayKey(now)}`, () => {
    const db = createDemoDatabase(now);
    assert.equal(db.organization.name, "Exempel El & Automation AB");
    assert.deepEqual(db.users.map((user) => user.name), ["Elin Bergström", "Elis Hammarström", "Elon Strömberg", "Elna Lindqvist"]);
    // Five addresses with three objects under them and, since the tree of 2026-10-15, four sub-objects below those.
    assert.equal(db.facilities.length, 12);
    assert.equal(db.facilities.filter((facility) => !facility.parentId).length, 5);
    const byName = (name: string) => db.projects.find((project) => project.name === name)!;
    const work = (projectId: string) => db.tasks.filter((task) => task.projectId === projectId).map((task) => ({ status: task.status as string, progress: workflowTaskProgress(task) }));
    const state = (name: string) => {
      const project = byName(name);
      const status = summarizeProjectStatus({ archivedAt: null, closedAt: null, startDate: project.startDate, dueDate: project.dueDate, now, tasks: work(project.id), activities: db.activities.filter((activity) => activity.projectId === project.id) });
      const adherence = summarizeFrameAdherence({ startDate: project.startDate, dueDate: project.dueDate, completion: projectCompletion(work(project.id)), now });
      return { status: status.state, adherence: adherence.state };
    };
    assert.deepEqual(state("Laddplatser i garaget"), { status: "IN_PROGRESS", adherence: "ON_TRACK" });
    assert.deepEqual(state("Revision ställverk S1"), { status: "IN_PROGRESS", adherence: "BEHIND" });
    assert.equal(state("Belysningsbyte kontor").adherence, "OVERDUE");
    assert.equal(state("Ny elcentral").status, "READY_TO_CLOSE");

    // All three task types in the main project; Kontroll före idrifttagning is a protocol of Workflow's form (2026-10-06),
    // and an open protocol stays below 100 %.
    const laddplatser = byName("Laddplatser i garaget");
    assert.deepEqual(new Set(db.tasks.filter((task) => task.projectId === laddplatser.id).map((task) => task.kind)), new Set(["WORK_ORDER", "RISK_ASSESSMENT", "FORM"]));
    const garage = db.tasks.find((task) => task.projectId === laddplatser.id && task.kind === "FORM")!;
    assert.equal(garage.data.kind === "FORM" && garage.data.details.templateId, "hintek-kontroll-fore-idrifttagning");
    assert.ok(workflowTaskProgress(garage) > 0 && workflowTaskProgress(garage) <= 95);
    assert.equal(laddplatser.decisions?.length, 2);
    assert.ok(db.tasks.some((task) => !task.projectId), "at least one job outside a project");
    // Arbetsordern styr (2026-10-26): every task is in a work order of the demo, with its customer and project.
    for (const task of db.tasks.filter((item) => item.kind !== "WORK_ORDER")) {
      const order = db.tasks.find((item) => item.id === task.workOrderId);
      assert.equal(order?.kind, "WORK_ORDER", `${task.title} is in a work order`);
      assert.equal(task.projectId, order!.projectId, `${task.title} has its work order's project`);
      assert.equal(task.customerId, order!.customerId, `${task.title} has its work order's customer`);
    }

    // Task dates and active planning stay inside their project's frame; reported time is never in the future.
    for (const task of db.tasks.filter((item) => item.projectId && item.dueDate)) {
      const project = db.projects.find((item) => item.id === task.projectId)!;
      assert.equal(taskDueDateError(task.dueDate, { startDate: project.startDate ?? "", dueDate: project.dueDate }), null, task.title);
    }
    for (const activity of db.activities.filter((item) => item.projectId && item.status === "PLANNED")) {
      const project = db.projects.find((item) => item.id === activity.projectId)!;
      assert.ok(swedishDayKey(activity.startsAt) >= project.startDate! && swedishDayKey(activity.endsAt) <= project.dueDate, `${activity.title} inside ${project.name}`);
    }
    assert.ok(db.timeEntries.every((entry) => !entry.endedAt || Date.parse(entry.endedAt) <= now.getTime()));
    // Time is on work orders and on projects themselves, never on a task (2026-10-26).
    assert.ok(db.timeEntries.every((entry) => entry.projectId ? !entry.taskId && db.projects.some((project) => project.id === entry.projectId) : db.tasks.find((task) => task.id === entry.taskId)?.kind === "WORK_ORDER"), "time only on work orders and projects");
    assert.ok(db.timeEntries.some((entry) => entry.projectId === laddplatser.id), "project time without a work order");
    assert.ok(db.timeEntries.some((entry) => db.tasks.some((task) => task.kind === "FORM" && task.workOrderId === entry.taskId)), "time written in a protocol is on its work order");
    const belysning = byName("Belysningsbyte kontor");
    assert.ok(db.timeEntries.some((entry) => db.tasks.find((task) => task.id === entry.taskId)?.projectId === belysning.id && swedishDayKey(entry.startedAt) > belysning.dueDate), "time after the end date");

    // Invented data only: every e-mail address is reserved (.invalid).
    for (const email of [...db.users.map((user) => user.email), ...db.customers.map((customer) => customer.email), db.settings.contactEmail].filter(Boolean))
      assert.match(email, /\.invalid$/);
  });
}

// v0.4.19–0.4.20 in the demo (2026-10-07): values, rounds, maintenance work orders, "Upprepa kontrollen", the planning
// scope and the programme's levels, risk classes and instruments – all invented.
for (const now of days) {
  test(`the demo shows the news of 0.4.19 and 0.4.20 on ${swedishDayKey(now)}`, () => {
    const db = createDemoDatabase(now);
    const today = swedishDayKey(now);
    const task = (id: string) => db.tasks.find((item) => item.id === id)!;

    // The company's own values with a source, and a current table so Kabelarea has an answer for 2,5 mm² copper.
    assert.ok(db.companyValues.every((value) => value.source && /påhittad/i.test(value.reference)));
    assert.equal(ampacityFor(companyCalcData(db.companyValues).ampacity, null, "cu", 2.5)?.amps, 15);

    // Rounds: one done, one missed (overdue) and coming occasions; the repeated control is a round every six months.
    const views = scheduleViews(db.schedules, db.tasks, today);
    const view = (id: string) => views.find((item) => item.id === id)!;
    assert.ok(view("demo-schedule-reservkraft").overview.history.some((item) => item.state === "done"), "a done standby round");
    assert.ok(view("demo-schedule-skyddsrond").overview.history.some((item) => item.state === "missed"), "an overdue round");
    assert.ok(views.every((item) => item.overview.next && item.overview.next >= today), "every round has a coming occasion");
    const repeated = db.schedules.find((item) => item.id === "demo-schedule-fortlopande")!;
    assert.deepEqual([repeated.rule.frequency, repeated.rule.interval, repeated.legacyPlace ?? null, repeated.title], ["MONTHLY", 6, null, task("demo-task-fortlopande-kontor").title], "the round is the time rules; its place comes with its work order");
    assert.equal(task("demo-task-fortlopande-kontor").status, "COMPLETED");

    // Work orders with maintenance items (2026-10-30): urgent and open, paused for material, and one from a remark with a link back.
    const orders = db.tasks.filter((item) => item.data.kind === "WORK_ORDER");
    assert.ok(orders.some((item) => isUrgentOpen(item.status, demoOrderSummary(db, item))));
    assert.ok(orders.some((item) => waitingReasonOf(item.status, item.data.kind === "WORK_ORDER" && item.data.details) === "MATERIAL"));
    assert.ok(orders.every((item) => item.data.kind !== "WORK_ORDER" || !("maintenance" in item.data.details)), "no facts on the orders themselves");
    assert.ok((db.maintenanceItems ?? []).every((item) => orders.some((order) => order.id === item.workOrderId)), "every item is held by a work order");
    const fromRemark = task("demo-task-ao-lucka-e12");
    const source = fromRemark.data.kind === "WORK_ORDER" ? fromRemark.data.details.source : undefined;
    assert.equal(source?.taskId, "demo-task-fortlopande-kontor");
    const remark = task("demo-task-fortlopande-kontor");
    assert.equal(remark.data.kind === "FORM" && remark.data.details.values.tables.anmarkningar.find((row) => row.id === source?.rowId)?.workOrderId, fromRemark.id);

    // Planering och kravbestämning in the switchgear project selects the control's moments.
    const stallverk = db.projects.find((project) => project.name === "Revision ställverk S1")!;
    const protocols = db.tasks.flatMap((item) => item.projectId === stallverk.id && item.data.kind === "FORM" && item.data.details.templateId === PLANNING_FORM_ID
      ? [{ id: item.id, title: item.title, updatedAt: item.updatedAt, document: item.data.details.document, values: item.data.details.values }] : []);
    assert.deepEqual(new Set(planningScope(protocols)?.sections), new Set(["kfid-vis", "kfid-cont", "kfid-iso", "kfid-volt"]));

    // Completed protocols are complete.
    for (const id of ["demo-task-planering-stallverk", "demo-task-fortlopande-kontor", "demo-task-rond-reservkraft"]) assert.equal(workflowTaskProgress(task(id)), 100, id);
  });
}

test("the demo's programme has levels 1–3, a supervised person, company risk classes and an instrument due soon", async () => {
  const { demoSelfInspection, demoSelfInspectionLevels } = await import("../features/demo/demo-self-inspection");
  const db = createDemoDatabase();
  const admin = db.users[0];
  const view = await demoSelfInspection(db, admin, true, "GET", null);
  assert.deepEqual(new Set(view.program!.roles.filter((role) => role.members.length).map((role) => role.level)), new Set([1, 2, 3]));
  const levels = await demoSelfInspectionLevels(db, admin);
  assert.ok(levels.people.some((person) => person.supervised));
  assert.equal(levels.riskClasses["form:hintek-kontroll-fore-idrifttagning"], 3);
  assert.ok(view.instruments.some((item) => item.state === "DUE_SOON"), JSON.stringify(view.instruments.map((item) => item.state)));
  assert.ok(view.credentials.some((item) => item.leftAt), "a card kept after the person left");
  assert.equal(view.program!.changedSinceApproval, false);
});
