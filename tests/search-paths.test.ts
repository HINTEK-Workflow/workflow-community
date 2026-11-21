import assert from "node:assert/strict";
import test from "node:test";
import { defaultWorkflowPermissionProfile } from "../lib/workflow/permissions";
import { parseSearchQuery } from "../lib/search/query";
import { buildSearchSql, placePathsSql, searchSpecs } from "../lib/search/sql";

// Quality check 2026-10-05, F10: the place tree is computed once per search and handed to every kind's query.
const admin = { organizationId: "org-1", userId: "u1", admin: true, workflowPermissions: defaultWorkflowPermissionProfile() };

test("Cloud SQL: given place ways replace the recursive place tree in every kind's query", () => {
  const parsed = parseSearchQuery("elcentral");
  const places = { ids: ["f1", "f2"], paths: ["Kund › Anläggning", "Kund › Anläggning › Elcentral E12"] };
  for (const spec of searchSpecs(admin, parsed).filter((item) => item.paths)) {
    const sql = buildSearchSql(spec, parsed, "org-1", 40, "match", false, places);
    assert.ok(!sql.text.includes("WITH RECURSIVE"), `${spec.type} does not rebuild the tree`);
    assert.match(sql.text, /unnest\(/, `${spec.type} reads the given ways`);
    assert.ok(sql.values.some((value) => Array.isArray(value) && value.includes("f2")), `${spec.type} gets the place ids as a parameter`);
    assert.ok(sql.values.includes("org-1"), `${spec.type} is still limited to the company`);
  }
  // Without given ways (older callers) the query builds the tree itself, as before.
  const task = searchSpecs(admin, parsed).find((spec) => spec.type === "task")!;
  assert.match(buildSearchSql(task, parsed, "org-1", 40, "match", false).text, /WITH RECURSIVE/);
});

test("Cloud SQL: the place ways are read for one company only", () => {
  const sql = placePathsSql("org-1");
  assert.match(sql.text, /WITH RECURSIVE/);
  assert.ok(sql.values.every((value) => value === "org-1" || typeof value === "number"), "only the company id and the depth are parameters");
  assert.match(sql.text, /SELECT id, path FROM paths$/);
});
