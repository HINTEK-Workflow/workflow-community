import assert from "node:assert/strict";
import test from "node:test";
import { formPermissionArea, workflowSubjectForTask, type WorkflowPermissionSubject } from "../lib/workflow/permissions";
import { readableTaskSql, readableTaskWhere } from "../lib/workflow/task-access";

// Kontroll före idrifttagning and Riskbedömning built as forms keep their permission areas (Daniel 2026-09-27).
test("a protocol follows its form's permission area; one without an area is Formulär", () => {
  assert.equal(workflowSubjectForTask("FORM", "kfid"), "kfid");
  assert.equal(workflowSubjectForTask("FORM", "risk-assessment"), "risk-assessment");
  assert.equal(workflowSubjectForTask("FORM", null), "forms");
  assert.equal(workflowSubjectForTask("FORM", "projects"), "forms", "an unknown area never widens access");
  assert.equal(workflowSubjectForTask("WORK_ORDER", "kfid"), "work-order");
  assert.equal(formPermissionArea("anything"), "forms");
});

test("list filters read protocols by area, and nothing when nothing is readable", () => {
  const only = (...subjects: WorkflowPermissionSubject[]) => (subject: WorkflowPermissionSubject) => subjects.includes(subject);
  assert.deepEqual(readableTaskWhere(only("kfid")), { OR: [{ kind: "FORM", formArea: { in: ["kfid"] } }] });
  assert.deepEqual(readableTaskWhere(only("forms", "work-order")), { OR: [{ kind: { in: ["WORK_ORDER"] } }, { kind: "FORM", formArea: { in: ["forms"] } }, { kind: "FORM", formArea: null }] });
  assert.deepEqual(readableTaskWhere(only("projects")), { id: { in: [] } });
  const sql = readableTaskSql(only("risk-assessment"));
  assert.match(sql.sql, /"t"\.kind in \(\?\) or \("t"\.kind = 'FORM' and coalesce\("t"\."formArea", 'forms'\) in \(\?\)\)/);
  assert.deepEqual(sql.values, ["RISK_ASSESSMENT", "risk-assessment"]);
  assert.equal(readableTaskSql(only()).sql, "false");
});
