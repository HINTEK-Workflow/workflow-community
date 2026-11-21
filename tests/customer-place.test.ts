// Kund och plats i ett jobb (2026-10-08, "krånga inte till det"): the selection rules shared by Cloud, Local and
// the demo, and the temporary place that belongs to the job only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { activeCustomerPlaces, customerPlaceSource, inheritProjectCustomerPlace, placeAfterCustomerChange, placeChoice, placeChoiceHint } from "../lib/workflow/customer-place";
import { emptyTempPlace, tempPlaceIsEmpty, tempPlaceLabel, tempPlaceOf, tempPlacePosition, tempPlaceSchema, withTempPlace } from "../lib/workflow/temp-place";
import { workflowTaskInputSchema } from "../lib/workflow/task-model";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalCustomerFacility, saveLocalCustomerRecord, saveLocalWorkflowTaskRecord } from "../features/kfid/local-workspace-store";

const places = [
  { id: "a1", customerId: "A", isActive: true },
  { id: "b1", customerId: "B", isActive: true },
  { id: "b2", customerId: "B", isActive: true },
  { id: "c1", customerId: "C", isActive: false },
  { id: "d1", customerId: "D", isActive: true },
  { id: "d2", customerId: "D", isActive: false },
];

test("a customer without places asks for no place", () => {
  assert.equal(placeAfterCustomerChange(places, "E", null), null);
  assert.deepEqual(placeChoice(places, "E"), { kind: "none" });
  assert.equal(placeChoiceHint(places, "E", null), "");
  // Only paused places count as none: a paused place is never chosen by itself.
  assert.equal(placeAfterCustomerChange(places, "C", null), null);
  assert.deepEqual(placeChoice(places, "C"), { kind: "none" });
  assert.equal(placeAfterCustomerChange(places, null, "a1"), null, "no customer, no place");
});

test("a customer with one place gets it at once", () => {
  assert.equal(placeAfterCustomerChange(places, "A", null), "a1");
  assert.deepEqual(placeChoice(places, "A"), { kind: "single", placeId: "a1" });
  // One active place beside a paused one is still one.
  assert.equal(placeAfterCustomerChange(places, "D", null), "d1");
  assert.deepEqual(activeCustomerPlaces(places, "D").map((place) => place.id), ["d1"]);
  // Where the person typed the place by hand the field is left for them (auto off).
  assert.equal(placeAfterCustomerChange(places, "A", null, { auto: false }), null);
});

test("a customer with several places lets the person pick, with no default", () => {
  assert.equal(placeAfterCustomerChange(places, "B", null), null);
  assert.deepEqual(placeChoice(places, "B"), { kind: "pick", count: 2 });
  assert.match(placeChoiceHint(places, "B", null), /2 platser/);
  assert.equal(placeChoiceHint(places, "B", "b2"), "", "no hint once a place is chosen");
});

test("changing customer clears a place of the old customer", () => {
  assert.equal(placeAfterCustomerChange(places, "B", "a1"), null, "A's place does not follow to B (several places)");
  assert.equal(placeAfterCustomerChange(places, "A", "b1"), "a1", "B's place is replaced by A's only place");
  assert.equal(placeAfterCustomerChange(places, "E", "b1"), null, "B's place is cleared for a customer without places");
  assert.equal(placeAfterCustomerChange(places, "B", "b2"), "b2", "a place of the same customer stays");
  assert.equal(placeAfterCustomerChange(places, null, "b2"), null, "no customer clears the place");
});

test("a task in a project inherits the project's customer and place and says so", () => {
  const project = { name: "Ny central", customerId: "B", facilityId: "b1" };
  assert.deepEqual(inheritProjectCustomerPlace({ customerId: null, facilityId: null }, project, places), { customerId: "B", facilityId: "b1" });
  assert.deepEqual(inheritProjectCustomerPlace({ customerId: "B", facilityId: "b2" }, project, places), { customerId: "B", facilityId: "b2" }, "another place of the project's customer may be kept");
  assert.deepEqual(inheritProjectCustomerPlace({ customerId: "A", facilityId: "a1" }, project, places), { customerId: "B", facilityId: "b1" }, "another customer's place never stays");
  assert.deepEqual(inheritProjectCustomerPlace({ customerId: "A", facilityId: "a1" }, { customerId: "A", facilityId: null }, places), { customerId: "A", facilityId: "a1" });
  assert.deepEqual(inheritProjectCustomerPlace({ customerId: null, facilityId: null }, { customerId: "A", facilityId: null }, places), { customerId: "A", facilityId: "a1" }, "the project customer's only place");
  assert.deepEqual(inheritProjectCustomerPlace({ customerId: null, facilityId: null }, { customerId: "B", facilityId: null }, places), { customerId: "B", facilityId: null }, "several places: the person picks");
  assert.deepEqual(inheritProjectCustomerPlace({ customerId: "A", facilityId: "a1" }, { customerId: null }, places), { customerId: "A", facilityId: "a1" }, "a project without customer leaves the task's own");
  assert.deepEqual(inheritProjectCustomerPlace({ customerId: "A", facilityId: "a1" }, undefined, places), { customerId: "A", facilityId: "a1" });
  // The customer lists are read on demand: a place they do not know yet is kept and the server checks it.
  assert.deepEqual(inheritProjectCustomerPlace({ customerId: null, facilityId: "unknown" }, project, []), { customerId: "B", facilityId: "unknown" });
  const source = customerPlaceSource({ customerId: "B", facilityId: "b1" }, project);
  assert.match(source.customer, /Följer projektet Ny central/);
  assert.match(source.place, /Från projektet Ny central/);
  assert.equal(customerPlaceSource({ customerId: "B", facilityId: "b2" }, project).place, "", "a place of the task's own choice is not called the project's");
  assert.deepEqual(customerPlaceSource({ customerId: "A", facilityId: null }, null), { customer: "", place: "" });
});

test("the temporary place: address and pin, stored in the task's data only", () => {
  assert.equal(tempPlaceIsEmpty(emptyTempPlace()), true);
  assert.equal(tempPlaceOf({ kind: "WORK_ORDER", details: {} }), null, "older tasks have none");
  assert.equal(tempPlaceOf({ tempPlace: { address: "  " } }), null, "an empty one is none");
  const place = tempPlaceSchema.parse({ address: " Bodvägen 2 ", postalCode: "123 45", city: "Elstad", latitude: 57.7, longitude: 11.97 });
  assert.equal(tempPlaceLabel(place), "Bodvägen 2, 123 45 Elstad");
  assert.deepEqual(tempPlacePosition(place), { latitude: 57.7, longitude: 11.97 });
  assert.equal(tempPlaceLabel(tempPlaceSchema.parse({ latitude: 57.70001, longitude: 11.97 })), "57.70001, 11.97000", "only a pin shows its coordinates");
  assert.equal(tempPlaceSchema.safeParse({ address: "x", latitude: 57.7 }).success, false, "both coordinates or none");
  // It carries no id or customer: nothing in it can point at the register.
  const parsed = tempPlaceSchema.parse({ address: "x", id: "a1", customerId: "A", facilityId: "a1" }) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), ["address", "city", "latitude", "longitude", "postalCode"]);
  const data = { kind: "WORK_ORDER", details: {} };
  assert.deepEqual(withTempPlace(data, place), { ...data, tempPlace: place });
  assert.deepEqual(withTempPlace({ ...data, tempPlace: place }, null), data, "removing it leaves no trace");
  assert.deepEqual(withTempPlace(data, emptyTempPlace()), data, "an empty one is not stored");
});

const workOrder = (overrides: Record<string, unknown>) => ({
  version: 0, kind: "WORK_ORDER", title: "Arbetsorder", description: "", status: "PLANNED", projectId: null, customerId: null, facilityId: null,
  assignedToUserId: null, assignedToName: "", dueDate: "", data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } },
  ...overrides,
});

test("a temporary place is saved with the task (Cloud schema, Local file) and never touches the customer register", () => {
  const tempPlace = { address: "Tillfällig bod 1", postalCode: "", city: "Elstad", latitude: 57.7, longitude: 11.9 };
  const input = workOrder({ data: { ...workOrder({}).data, tempPlace } });
  assert.deepEqual(workflowTaskInputSchema.parse(input).data.tempPlace, tempPlace, "Cloud keeps it in the task data");
  assert.equal(workflowTaskInputSchema.parse(workOrder({})).data.tempPlace, undefined, "an older task parses without one");

  let workspace = createLocalWorkspace({ id: "temp-place-local", name: "Temp AB" });
  const customer = saveLocalCustomerRecord(workspace, { name: "Kund A" });
  workspace = saveLocalCustomerFacility(customer.workspace, customer.customer.id, { facility: { name: "Anläggning A" } });
  const register = JSON.stringify({ customers: workspace.customers, places: workspace.customerFacilities });
  const facility = workspace.customerFacilities[0];
  const saved = saveLocalWorkflowTaskRecord(workspace, workOrder({ customerId: customer.customer.id, facilityId: facility.id, data: { ...workOrder({}).data, tempPlace } }));
  assert.deepEqual(saved.task.data.tempPlace, tempPlace);
  assert.equal(saved.task.facilityId, facility.id, "the register place stays the task's place");
  assert.equal(JSON.stringify({ customers: saved.workspace.customers, places: saved.workspace.customerFacilities }), register, "the register is unchanged");
  // The .hwf round trip keeps it.
  const reopened = parseLocalWorkspace(JSON.parse(JSON.stringify(saved.workspace)), "temp-place-local");
  assert.deepEqual(reopened.workflowTasks.find((task) => task.id === saved.task.id)?.data.tempPlace, tempPlace);
  // A temporary place alone (no customer) is allowed; it needs no register place.
  const alone = saveLocalWorkflowTaskRecord(saved.workspace, workOrder({ title: "Utan kund", data: { ...workOrder({}).data, tempPlace } }));
  assert.equal(alone.task.customerId, null);
  assert.equal(alone.workspace.customerFacilities.length, 1);
});
