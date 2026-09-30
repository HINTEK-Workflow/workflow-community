import assert from "node:assert/strict";
import test from "node:test";
import { createDemoDatabase } from "../features/demo/demo-data";
import { validateForCompletion } from "../lib/kfid/model";
import { controlProgress, projectCompletion, summarizeFrameAdherence } from "../lib/workflow/project-progress";
import { summarizeProjectStatus } from "../lib/workflow/project-status";
import { taskDueDateError } from "../lib/workflow/project-frame";
import { workflowTaskProgress } from "../lib/workflow/task-model";
import { swedishDayKey } from "../lib/swedish-time";

// Seven consecutive days, so the approved scenario holds on every weekday (the data is relative to today).
const days = Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(2026, 8, 28 + index, 10)));

for (const now of days) {
  test(`approved demo data holds its scenario on ${swedishDayKey(now)}`, () => {
    const db = createDemoDatabase(now);
    assert.equal(db.organization.name, "HINTEK Power Solutions AB");
    assert.deepEqual(db.users.map((user) => user.name), ["Elin Bergström", "Elis Hammarström", "Elon Strömberg", "Elna Bergström"]);
    assert.equal(db.facilities.length, 5);
    const byName = (name: string) => db.projects.find((project) => project.name === name)!;
    const work = (projectId: string) => [
      ...db.tasks.filter((task) => task.projectId === projectId).map((task) => ({ status: task.status as string, progress: workflowTaskProgress(task) })),
      ...db.controls.filter((control) => control.projectId === projectId).map((control) => ({ status: control.status as string, progress: controlProgress(control.status, validateForCompletion(control.data).progress.percent) })),
    ];
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

    // All three task types in the main project; the complete-but-open control shows the 95 % cap.
    const laddplatser = byName("Laddplatser i garaget");
    assert.deepEqual(new Set(db.tasks.filter((task) => task.projectId === laddplatser.id).map((task) => task.kind)), new Set(["WORK_ORDER", "RISK_ASSESSMENT"]));
    const garage = db.controls.find((control) => control.projectId === laddplatser.id)!;
    assert.equal(validateForCompletion(garage.data).complete, true);
    assert.equal(controlProgress(garage.status, validateForCompletion(garage.data).progress.percent), 95);
    assert.equal(db.controls.filter((control) => control.status === "COMPLETED").every((control) => validateForCompletion(control.data).complete), true);
    assert.equal(laddplatser.decisions?.length, 2);
    assert.ok(db.tasks.some((task) => !task.projectId), "at least one standalone task");

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
    assert.ok(db.timeEntries.some((entry) => db.controls.some((control) => control.id === entry.taskId)), "manual time on a control");
    const belysning = byName("Belysningsbyte kontor");
    assert.ok(db.timeEntries.some((entry) => db.tasks.find((task) => task.id === entry.taskId)?.projectId === belysning.id && swedishDayKey(entry.startedAt) > belysning.dueDate), "time after the end date");

    // Invented data only: every e-mail address is reserved (.invalid).
    for (const email of [...db.users.map((user) => user.email), ...db.customers.map((customer) => customer.email), db.settings.contactEmail].filter(Boolean))
      assert.match(email, /\.invalid$/);
  });
}
