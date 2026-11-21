// Tillfällig plats in lists and copies (2026-10-08): the work lists, Sök and the Uppdraget box show a task's
// temporary place where its place would show, marked "Tillfällig:", and every copy of a task keeps it.
import assert from "node:assert/strict";
import test from "node:test";
import { copyTempPlace, listPlaceLabel, tempPlaceSchema } from "../lib/workflow/temp-place";
import { taskListItem } from "../features/workflow/work-list-items";
import { searchLocalWorkspace, type LocalSearchData } from "../lib/search/local";
import { parseSearchQuery } from "../lib/search/query";
import { searchSpecs } from "../lib/search/sql";
import { defaultWorkflowPermissionProfile } from "../lib/workflow/permissions";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const temp = tempPlaceSchema.parse({ address: "Bodvägen 2", postalCode: "123 45", city: "Elstad" });

test("the list's place: the register place, the temporary one marked, or both compactly", () => {
  assert.equal(listPlaceLabel("Elcentral E12", null), "Elcentral E12");
  assert.equal(listPlaceLabel("", temp), "Tillfällig: Bodvägen 2, 123 45 Elstad", "used when no register place is chosen");
  assert.equal(listPlaceLabel(undefined, temp), "Tillfällig: Bodvägen 2, 123 45 Elstad");
  assert.equal(listPlaceLabel("Elcentral E12", temp), "Elcentral E12 · Tillfällig: Bodvägen 2, 123 45 Elstad", "both: register place first");
  assert.equal(listPlaceLabel(" ", null), "", "nothing at all stays empty");
  assert.equal(listPlaceLabel("", tempPlaceSchema.parse({ latitude: 57.7, longitude: 11.97 })), "Tillfällig: 57.70000, 11.97000", "a pin only shows its coordinates");
});

test("a row or card shows the place text in the place's own column", () => {
  const item = taskListItem({ id: "t1", kind: "WORK_ORDER", title: "Byte", status: "PLANNED", updatedAt: "2026-10-08T10:00:00Z", customerName: "Volvo Cars", placeName: listPlaceLabel("", temp) }, "2026-10-08");
  assert.equal(item.customer, "Volvo Cars");
  assert.equal(item.place, "Tillfällig: Bodvägen 2, 123 45 Elstad");
});

test("a copy keeps the source's temporary place, and a source without one leaves none", () => {
  const target = { kind: "FORM", details: { values: {} } };
  assert.deepEqual(copyTempPlace(target, { kind: "FORM", details: {}, tempPlace: temp }), { ...target, tempPlace: temp });
  assert.deepEqual(copyTempPlace({ ...target, tempPlace: temp }, { kind: "FORM", details: {} }), target, "the source decides");
  assert.deepEqual(copyTempPlace(target, { tempPlace: { address: "  " } }), target, "an empty one is not copied");
  assert.deepEqual(copyTempPlace(target, undefined), target);
});

const data: LocalSearchData = {
  customers: [{ id: "c1", name: "Volvo Cars", company: "Volvo Cars AB", city: "Göteborg" }],
  customerFacilities: [],
  projects: [],
  workflowTasks: [
    { id: "t1", kind: "WORK_ORDER", title: "Byte av brytare", status: "PLANNED", customerId: "c1", data: { kind: "WORK_ORDER", details: {}, tempPlace: temp } },
    { id: "t2", kind: "WORK_ORDER", title: "Annan order", status: "PLANNED", data: { kind: "WORK_ORDER", details: {} } },
  ],
};

test("Sök (Local and the demo) finds a task by its temporary place, also with plats:", () => {
  const hits = searchLocalWorkspace(data, "bodvägen", { now: NOW }).groups.find((group) => group.type === "task")?.hits ?? [];
  assert.deepEqual(hits.map((hit) => hit.id), ["t1"]);
  assert.equal(hits[0].why, "Tillfällig plats");
  const filtered = searchLocalWorkspace(data, "plats:elstad", { now: NOW }).groups.find((group) => group.type === "task")?.hits ?? [];
  assert.deepEqual(filtered.map((hit) => hit.id), ["t1"]);
});

test("Sök (Cloud) reads and searches the temporary place from the task's data", () => {
  const admin = { organizationId: "org-1", userId: "u1", admin: true, workflowPermissions: defaultWorkflowPermissionProfile() };
  const task = searchSpecs(admin, parseSearchQuery("bodvägen")).find((spec) => spec.type === "task")!;
  assert.match(task.select.sql, /'tempPlace'/);
  assert.match(task.light.sql, /'tempPlace'->>'address'/);
  assert.match(task.place!.sql, /'tempPlace'->>'city'/);
  const candidate = task.map({ id: "t1", kind: "WORK_ORDER", title: "Byte", status: "PLANNED", tempPlace: temp });
  assert.equal(candidate.fields.find((field) => field.label === "Tillfällig plats")?.text, "Bodvägen 2, 123 45 Elstad");
  assert.equal(candidate.placeText, "Bodvägen 2, 123 45 Elstad");
});
