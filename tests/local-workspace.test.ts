import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeLocalRecordState,
  createLocalWorkspace,
  linkLocalTaskToProject,
  parseLocalWorkspace,
  saveLocalControlRecord,
  saveLocalCustomerRecord,
  saveLocalProjectRecord,
  setLocalProjectArchived,
} from "../features/kfid/local-workspace-store";
import { blankControl } from "../lib/kfid/model";

test("a local workspace is versioned and bound to exactly one organization", () => {
  const workspace = createLocalWorkspace({
    id: "org-local",
    name: "Lokala AB",
  });
  assert.equal(workspace.format, "KFID_LOCAL_WORKSPACE");
  assert.equal(workspace.schemaVersion, 11);
  assert.equal(workspace.organization.id, "org-local");
  assert.equal(workspace.cloudBinding.organizationId, "org-local");
  assert.equal(workspace.localIdentity.name, "Lokala AB");
  assert.deepEqual(workspace.customers, []);
  assert.deepEqual(workspace.projects, []);
  assert.deepEqual(workspace.workflowTasks, []);
  assert.deepEqual(workspace.controls, []);
  assert.equal(
    parseLocalWorkspace(workspace, "org-local").workspaceId,
    workspace.workspaceId,
  );
  assert.throws(
    () => parseLocalWorkspace(workspace, "org-other"),
    /annat Workflow-företag/,
  );
});

test("malformed and future local workspace files are rejected", () => {
  const workspace = createLocalWorkspace({
    id: "org-local",
    name: "Lokala AB",
  });
  assert.throws(() =>
    parseLocalWorkspace({ ...workspace, schemaVersion: 12 }, "org-local"),
  );
  assert.throws(() =>
    parseLocalWorkspace({ ...workspace, controls: null }, "org-local"),
  );
  const attachmentId = crypto.randomUUID();
  assert.throws(() =>
    parseLocalWorkspace(
      {
        ...workspace,
        attachments: [
          {
            id: attachmentId,
            controlId: crypto.randomUUID(),
            filename: "bild.png",
            storageName: `${attachmentId}.png`,
            mimeType: "image/png",
            size: 10,
            section: "vis",
            rowId: null,
            createdAt: new Date().toISOString(),
          },
        ],
      },
      "org-local",
    ),
  );
});

test("schema 1 workspaces migrate in memory to schema 10 without changing the source", () => {
  const current = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const legacy = {
    ...current,
    schemaVersion: 1,
    futureRootField: { retained: true },
  } as Record<string, unknown>;
  delete legacy.localIdentity;
  delete legacy.cloudBinding;

  const migrated = parseLocalWorkspace(legacy, "org-local");
  assert.equal(migrated.schemaVersion, 11);
  assert.deepEqual(migrated.projects, []);
  assert.deepEqual(migrated.workflowTasks, []);
  assert.equal(migrated.localIdentity.id, current.workspaceId);
  assert.equal(migrated.cloudBinding.organizationId, "org-local");
  assert.deepEqual(migrated.futureRootField, { retained: true });
  assert.equal(legacy.schemaVersion, 1);
  assert.equal("localIdentity" in legacy, false);
});

test("local projects are optional containers for controls", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const saved = saveLocalProjectRecord(workspace, {
    name: "Laddstation",
    description: "Två kontroller",
    startDate: "2026-09-01",
    dueDate: "2026-10-01",
    customerId: null,
  });
  const data = blankControl();
  data.meta.proj = "Laddstation";
  const control = saveLocalControlRecord(saved.workspace, {
    version: 0,
    customerId: null,
    projectId: saved.project.id,
    data,
    status: "DRAFT",
  });
  assert.equal(control.control.projectId, saved.project.id);
  assert.equal(workspace.projects.length, 0);
});

test("an existing standalone local task can be linked to a project", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const project = saveLocalProjectRecord(workspace, {
    name: "Laddstation",
    description: "",
    startDate: "2026-09-01",
    dueDate: "2026-12-31",
    customerId: null,
  });
  const data = blankControl();
  data.meta.proj = "Fristående kontroll";
  const control = saveLocalControlRecord(project.workspace, {
    version: 0,
    customerId: null,
    projectId: null,
    data,
    status: "DRAFT",
  });
  const linked = linkLocalTaskToProject(control.workspace, control.control.id, "COMMISSIONING_CONTROL", project.project.id);
  assert.equal(linked.controls[0].projectId, project.project.id);
  assert.equal(linked.controls[0].version, 2);
  assert.equal(linked.controls[0].revisions.length, 2);
});

test("local projects keep responsible, archive state and lifecycle history", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const saved = saveLocalProjectRecord(workspace, { name: "Livscykel", description: "", startDate: "2026-09-01", dueDate: "2026-12-31", customerId: null, responsibleUserId: "local@example.test", responsibleName: "Lokal användare" }, "Lokal användare");
  assert.equal(saved.project.responsibleName, "Lokal användare");
  assert.equal(saved.project.events[0].kind, "CREATED");
  const archived = setLocalProjectArchived(saved.workspace, saved.project.id, true, "Lokal användare");
  assert.ok(archived.projects[0].archivedAt);
  assert.equal(archived.projects[0].events.at(-1)?.kind, "ARCHIVED");
  const restored = setLocalProjectArchived(archived, saved.project.id, false, "Lokal användare");
  assert.equal(restored.projects[0].archivedAt, null);
  assert.equal(restored.projects[0].events.at(-1)?.kind, "RESTORED");
});

test("local customers can be created and updated with version checks", () => {
  const original = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const created = saveLocalCustomerRecord(original, {
    name: "Anna Andersson",
    company: "Elfirman AB",
    email: "anna@example.com",
  });
  assert.equal(original.customers.length, 0);
  assert.equal(created.customer.version, 1);
  assert.equal(created.customer.lat, null);
  const updated = saveLocalCustomerRecord(
    created.workspace,
    { ...created.customer, name: "Anna A" },
    created.customer.id,
    1,
  );
  assert.equal(updated.customer.name, "Anna A");
  assert.equal(updated.customer.version, 2);
  assert.throws(
    () =>
      saveLocalCustomerRecord(
        updated.workspace,
        { ...updated.customer, name: "För gammal" },
        updated.customer.id,
        1,
      ),
    /har ändrats/,
  );
});

test("local controls have sequential numbers, revisions and immutable completion", () => {
  const original = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const customer = saveLocalCustomerRecord(original, { name: "Kund Ett" });
  const data = blankControl();
  data.meta.proj = "Centralbyte";
  data.meta.perf = "Anna";
  const first = saveLocalControlRecord(customer.workspace, {
    version: 0,
    customerId: customer.customer.id,
    data,
    status: "DRAFT",
  });
  assert.equal(first.control.number, 1);
  assert.equal(first.control.version, 1);
  assert.equal(first.control.revisions.length, 1);
  const changed = structuredClone(data);
  changed.meta.proj = "Centralbyte etapp 2";
  const second = saveLocalControlRecord(first.workspace, {
    id: first.control.id,
    version: 1,
    customerId: customer.customer.id,
    data: changed,
    status: "DRAFT",
  });
  assert.equal(second.control.number, 1);
  assert.equal(second.control.version, 2);
  assert.equal(second.control.revisions.length, 2);
  assert.equal(second.control.revisions[0].data.meta.proj, "Centralbyte");
  const copy = saveLocalControlRecord(second.workspace, {
    version: 0,
    customerId: customer.customer.id,
    data: changed,
    status: "DRAFT",
    copy: true,
  });
  assert.equal(copy.control.number, 2);
  assert.notEqual(copy.control.id, second.control.id);
  assert.throws(
    () =>
      saveLocalControlRecord(copy.workspace, {
        version: 0,
        customerId: "00000000-0000-4000-8000-000000000000",
        data,
        status: "DRAFT",
      }),
    /Kunden hittades inte/,
  );
});

test("local trash supports restore and permanent removal without orphan links", () => {
  const original = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const customer = saveLocalCustomerRecord(original, { name: "Kund Ett" });
  const data = blankControl();
  data.meta.proj = "Projekt";
  const saved = saveLocalControlRecord(customer.workspace, {
    version: 0,
    customerId: customer.customer.id,
    data,
    status: "DRAFT",
  });
  const attachmentId = crypto.randomUUID();
  saved.workspace.attachments.push({
    id: attachmentId,
    controlId: saved.control.id,
    filename: "underlag.pdf",
    storageName: `${attachmentId}.pdf`,
    mimeType: "application/pdf",
    size: 100,
    section: "vis",
    rowId: null,
    createdAt: new Date().toISOString(),
  });
  const deleted = changeLocalRecordState(
    saved.workspace,
    "controls",
    "delete",
    [saved.control.id],
  );
  assert.ok(deleted.controls[0].deletedAt);
  const restored = changeLocalRecordState(deleted, "controls", "restore", [saved.control.id]);
  assert.equal(restored.controls[0].deletedAt, null);
  const purgedCustomer = changeLocalRecordState(
    restored,
    "customers",
    "purge",
    [customer.customer.id],
  );
  assert.equal(purgedCustomer.customers.length, 0);
  assert.equal(purgedCustomer.controls[0].customerId, null);
  const purgedControl = changeLocalRecordState(
    purgedCustomer,
    "controls",
    "purge",
    [saved.control.id],
  );
  assert.equal(purgedControl.controls.length, 0);
  assert.equal(purgedControl.attachments.length, 0);
});
