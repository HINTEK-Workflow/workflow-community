import assert from "node:assert/strict";
import { test } from "node:test";
import { facilityLabel, facilityLinkError } from "../lib/workflow/customer-facility";
import { projectFieldRows } from "../lib/workflow/project-frame";
import {
  addLocalProjectDecision, changeLocalRecordState, createLocalWorkspace, linkLocalTaskToProject, parseLocalWorkspace, saveLocalControlRecord,
  saveLocalCustomerFacility, saveLocalCustomerRecord, saveLocalProjectRecord, saveLocalWorkflowTaskRecord, setLocalCustomerFacilityActive,
} from "../features/kfid/local-workspace-store";
import { localCustomerCardData } from "../features/kfid/local-customer-card";
import { blankControl } from "../lib/kfid/model";

const workOrder = (overrides: Record<string, unknown>) => ({
  version: 0, kind: "WORK_ORDER", title: "Arbetsorder", description: "", status: "PLANNED", projectId: null, customerId: null, facilityId: null, siteId: null, departmentId: null,
  assignedToUserId: null, assignedToName: "", dueDate: "", data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } },
  ...overrides,
});

test("facility labels and link rules", () => {
  assert.equal(facilityLabel({ name: "Ställverk 1", address: "Strömgatan 1", postalCode: "123 45", city: "Elstad" }), "Ställverk 1, Strömgatan 1, 123 45 Elstad");
  assert.equal(facilityLabel({ name: "Ställverk 1", address: "", postalCode: "", city: "" }), "Ställverk 1");
  const facility = { customerId: "c1", isActive: true };
  assert.equal(facilityLinkError(facility, { customerId: "c1", facilityId: "f1" }), null);
  assert.match(facilityLinkError(facility, { customerId: "c2", facilityId: "f1" })!, /annan kund/);
  assert.match(facilityLinkError(facility, { customerId: null, facilityId: "f1" })!, /annan kund/);
  assert.match(facilityLinkError({ ...facility, isActive: false }, { customerId: "c1", facilityId: "f1" })!, /pausad/);
  assert.equal(facilityLinkError({ ...facility, isActive: false }, { customerId: "c1", facilityId: "f1", previousFacilityId: "f1" }), null, "an existing link to a paused facility stays");
  assert.match(facilityLinkError(undefined, { customerId: "c1", facilityId: "f1" })!, /hittades inte/);
  assert.deepEqual(projectFieldRows({ client: "Beställare", facility: { name: "Ställverk 1", address: "", postalCode: "", city: "Elstad" } })[0], ["Anläggning", "Ställverk 1, Elstad"]);
});

test("Local facilities link projects, tasks and controls of the same customer, and purging the customer clears every link", () => {
  let workspace = createLocalWorkspace({ id: "facility-local", name: "Anläggning AB" });
  const first = saveLocalCustomerRecord(workspace, { name: "Kund A" });
  const second = saveLocalCustomerRecord(first.workspace, { name: "Kund B" });
  workspace = second.workspace;
  const customerA = first.customer.id; const customerB = second.customer.id;
  workspace = saveLocalCustomerFacility(workspace, customerA, { facility: { name: "Ställverk 1", address: "Strömgatan 1", city: "Elstad" } });
  workspace = saveLocalCustomerFacility(workspace, customerB, { facility: { name: "Annan kunds anläggning" } });
  const facilityA = workspace.customerFacilities.find((facility) => facility.customerId === customerA)!;
  const facilityB = workspace.customerFacilities.find((facility) => facility.customerId === customerB)!;
  assert.throws(() => saveLocalCustomerFacility(workspace, customerA, { facility: { name: " " } }), /namn/);

  // A project may only take its own customer's facility.
  assert.throws(() => saveLocalProjectRecord(workspace, { name: "Fel", description: "", startDate: "2026-09-01", dueDate: "2026-12-31", customerId: customerA, facilityId: facilityB.id }), /annan kund/);
  const project = saveLocalProjectRecord(workspace, { name: "Projekt", description: "", startDate: "2026-09-01", dueDate: "2026-12-31", customerId: customerA, facilityId: facilityA.id });
  workspace = project.workspace;
  assert.equal(project.project.facilityId, facilityA.id);

  // Editing a project keeps its decision log (it was rebuilt from the form before).
  workspace = addLocalProjectDecision(workspace, project.project.id, { decidedOn: "2026-09-26", text: "Beslut", decidedBy: "Beställaren" });
  workspace = saveLocalProjectRecord(workspace, { id: project.project.id, name: "Projekt ändrat", description: "", startDate: "2026-09-01", dueDate: "2026-12-31", customerId: customerA, facilityId: facilityA.id }).workspace;
  assert.equal(workspace.projects[0].decisions.length, 1);

  // A task takes a facility of its customer; a paused facility cannot be newly linked.
  assert.throws(() => saveLocalWorkflowTaskRecord(workspace, workOrder({ customerId: customerA, facilityId: facilityB.id })), /annan kund/);
  const task = saveLocalWorkflowTaskRecord(workspace, workOrder({ customerId: customerA, facilityId: facilityA.id }));
  workspace = task.workspace;
  const paused = setLocalCustomerFacilityActive(workspace, facilityA.id, false);
  assert.throws(() => saveLocalWorkflowTaskRecord(paused, workOrder({ title: "Ny", customerId: customerA, facilityId: facilityA.id })), /pausad/);
  assert.doesNotThrow(() => saveLocalWorkflowTaskRecord(paused, { ...task.task, facilityId: facilityA.id }), "an existing link to a paused facility stays");

  // A new control in the project inherits the project's facility.
  const data = blankControl(); data.meta.proj = "Kontroll";
  const control = saveLocalControlRecord(workspace, { version: 0, customerId: customerA, projectId: project.project.id, data, status: "DRAFT" });
  workspace = control.workspace;
  assert.equal(control.control.facilityId, facilityA.id);

  // The link guide: taking another project's customer takes that project's facility.
  const standalone = saveLocalWorkflowTaskRecord(workspace, workOrder({ title: "Fristående", customerId: customerB, facilityId: facilityB.id }));
  workspace = linkLocalTaskToProject(standalone.workspace, standalone.task.id, "WORK_ORDER", project.project.id, { customer: true, responsible: false, dueDate: "" });
  const linked = workspace.workflowTasks.find((item) => item.id === standalone.task.id)!;
  assert.equal(linked.customerId, customerA);
  assert.equal(linked.facilityId, facilityA.id);

  // The customer card lists the facility with its links and every task type.
  const card = localCustomerCardData(workspace, customerA, "all", 1);
  assert.equal(card.facilities[0].links, 4, "project, two work orders and the control");
  assert.equal(card.tasks.counts.all, 3);
  assert.equal(card.projects[0].facilityId, facilityA.id);

  // Purging a customer removes its facilities and clears the customer and facility on every item, work orders included.
  const onB = saveLocalWorkflowTaskRecord(workspace, workOrder({ title: "Hos B", customerId: customerB, facilityId: facilityB.id }));
  workspace = changeLocalRecordState(changeLocalRecordState(onB.workspace, "customers", "delete", [customerB]), "customers", "purge", [customerB]);
  assert.equal(workspace.customerFacilities.some((facility) => facility.customerId === customerB), false);
  const orphan = workspace.workflowTasks.find((item) => item.id === onB.task.id)!;
  assert.equal(orphan.customerId, null);
  assert.equal(orphan.facilityId, null);
  assert.doesNotThrow(() => parseLocalWorkspace(JSON.parse(JSON.stringify(workspace)), "facility-local"), "the file stays valid after the purge");

  // Older files read as workspaces without facilities.
  const older = JSON.parse(JSON.stringify(createLocalWorkspace({ id: "facility-local", name: "Anläggning AB" })));
  delete older.customerFacilities;
  assert.deepEqual(parseLocalWorkspace(older, "facility-local").customerFacilities, []);
});
