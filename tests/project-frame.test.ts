import assert from "node:assert/strict";
import test from "node:test";
import { projectFieldRows, projectFrameError, projectFrameIssues, taskDueDateError } from "../lib/workflow/project-frame";

test("new projects need a frame; existing projects may stay without one but never half a frame", () => {
  assert.match(projectFrameError({ startDate: "", dueDate: "" }, true) ?? "", /start- och slutdatum/);
  assert.equal(projectFrameError({ startDate: "", dueDate: "" }, false), null);
  assert.match(projectFrameError({ startDate: "2026-10-01", dueDate: "" }, false) ?? "", /både start- och slutdatum/);
  assert.match(projectFrameError({ startDate: "2026-10-02", dueDate: "2026-10-01" }, true) ?? "", /före eller samma dag/);
  assert.equal(projectFrameError({ startDate: "2026-10-01", dueDate: "2026-10-01" }, true), null);
});

test("a task's Klart senast must lie within the frame, inclusive", () => {
  const frame = { startDate: "2026-10-01", dueDate: "2026-10-31" };
  assert.equal(taskDueDateError("2026-10-01", frame), null);
  assert.equal(taskDueDateError("2026-10-31", frame), null);
  assert.match(taskDueDateError("2026-11-01", frame) ?? "", /inom projektets tidsram/);
  assert.match(taskDueDateError("2026-09-30", frame) ?? "", /inom projektets tidsram/);
  assert.equal(taskDueDateError("", frame), null, "an empty date is allowed");
  assert.equal(taskDueDateError("2027-01-01", { startDate: "", dueDate: "2026-10-31" }), null, "no frame, no rule");
});

test("existing deviations are listed as warnings, completed tasks' dates are left alone", () => {
  const issues = projectFrameIssues({ startDate: "2026-10-01", dueDate: "2026-10-31", customerId: "c1" }, [
    { id: "a", title: "Sen", dueDate: "2026-11-05", customerId: "c1", status: "IN_PROGRESS" },
    { id: "b", title: "Annan kund", dueDate: "2026-10-10", customerId: "c2", status: "PLANNED" },
    { id: "c", title: "Klar", dueDate: "2026-11-05", customerId: "c1", status: "COMPLETED" },
    { id: "d", title: "Kontroll", customerId: "c1" },
  ]);
  assert.deepEqual(issues.map((issue) => `${issue.taskId}:${issue.kind}`), ["a:DUE_OUTSIDE_FRAME", "b:CUSTOMER_DIFFERS"]);
});

test("project fields are printed in a fixed order and empty ones are left out", () => {
  assert.deepEqual(projectFieldRows({ client: "Beställare AB", reference: "", workSite: "Strömgatan 1", description: " Byte av central " }), [
    ["Beställare", "Beställare AB"],
    ["Arbetsplats / anläggning", "Strömgatan 1"],
    ["Arbetsbeskrivning", "Byte av central"],
  ]);
});
