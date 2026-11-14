import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeLocalRecordState,
  createLocalWorkspace,
  linkLocalTaskToProject,
  parseLocalWorkspace,
  saveLocalCustomerRecord,
  saveLocalProjectRecord,
  saveLocalWorkflowTaskRecord,
  setLocalProjectArchived,
  withKnownPredecessors,
  type LocalWorkspaceDocument,
} from "../features/kfid/local-workspace-store";

const workOrder = (workspace: LocalWorkspaceDocument, values: { title: string; customerId?: string | null; projectId?: string | null }) => saveLocalWorkflowTaskRecord(workspace, {
  version: 0, kind: "WORK_ORDER", title: values.title, description: "", status: "PLANNED", projectId: values.projectId ?? null, customerId: values.customerId ?? null,
  assignedToUserId: null, assignedToName: "", dueDate: "",
  data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } },
});

test("a local workspace is versioned and bound to exactly one organization", () => {
  const workspace = createLocalWorkspace({
    id: "org-local",
    name: "Lokala AB",
  });
  assert.equal(workspace.format, "KFID_LOCAL_WORKSPACE");
  assert.equal(workspace.schemaVersion, 13);
  assert.equal(workspace.organization.id, "org-local");
  assert.equal(workspace.cloudBinding.organizationId, "org-local");
  assert.equal(workspace.localIdentity.name, "Lokala AB");
  assert.deepEqual(workspace.customers, []);
  assert.deepEqual(workspace.projects, []);
  assert.deepEqual(workspace.workflowTasks, []);
  // The older controls are gone (2026-10-06): every control is a protocol among the tasks.
  assert.equal("controls" in workspace, false);
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
    parseLocalWorkspace({ ...workspace, schemaVersion: 14 }, "org-local"),
  );
  assert.throws(() =>
    parseLocalWorkspace({ ...workspace, customers: null }, "org-local"),
  );
  const attachmentId = crypto.randomUUID();
  assert.throws(() =>
    parseLocalWorkspace(
      {
        ...workspace,
        attachments: [
          {
            id: attachmentId,
            taskId: crypto.randomUUID(),
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
  assert.equal(migrated.schemaVersion, 13);
  assert.deepEqual(migrated.projects, []);
  assert.deepEqual(migrated.workflowTasks, []);
  assert.equal(migrated.localIdentity.id, current.workspaceId);
  assert.equal(migrated.cloudBinding.organizationId, "org-local");
  assert.deepEqual(migrated.futureRootField, { retained: true });
  assert.equal(legacy.schemaVersion, 1);
  assert.equal("localIdentity" in legacy, false);
});

test("local projects are optional containers for tasks", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const saved = saveLocalProjectRecord(workspace, {
    name: "Laddstation",
    description: "Två arbetsordrar",
    startDate: "2026-09-01",
    dueDate: "2026-10-01",
    customerId: null,
  });
  const task = workOrder(saved.workspace, { title: "Laddstation", projectId: saved.project.id });
  assert.equal(task.task.projectId, saved.project.id);
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
  const task = workOrder(project.workspace, { title: "Fristående arbetsorder" });
  const linked = linkLocalTaskToProject(task.workspace, task.task.id, "WORK_ORDER", project.project.id);
  assert.equal(linked.workflowTasks[0].projectId, project.project.id);
  assert.equal(linked.workflowTasks[0].version, 2);
  assert.equal(linked.projects[0].events.at(-1)?.kind, "TASK_LINKED");
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

test("local trash supports restore and permanent removal without orphan links", () => {
  const original = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const customer = saveLocalCustomerRecord(original, { name: "Kund Ett" });
  const saved = workOrder(customer.workspace, { title: "Projekt", customerId: customer.customer.id });
  const deleted = changeLocalRecordState(saved.workspace, "customers", "delete", [customer.customer.id]);
  assert.ok(deleted.customers[0].deletedAt);
  const restored = changeLocalRecordState(deleted, "customers", "restore", [customer.customer.id]);
  assert.equal(restored.customers[0].deletedAt, null);
  const purged = changeLocalRecordState(restored, "customers", "purge", [customer.customer.id]);
  assert.equal(purged.customers.length, 0);
  assert.equal(purged.workflowTasks[0].customerId, null);
});

// Börjar efter (plan 1K, 2026-10-11): a job's predecessors live in the .hwf file and survive a save and a re-read; an id
// that is not a job in the file is let go; a file without the field reads as before.
test("Börjar efter: predecessorIds are kept in the file through a save and a re-read, unknown ids are dropped", () => {
  const parse = parseLocalWorkspace;
  let workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const project = saveLocalProjectRecord(workspace, { name: "Projekt", description: "", startDate: "2026-09-01", dueDate: "2026-12-31", customerId: null });
  workspace = project.workspace;
  const first = workOrder(workspace, { title: "Kabeldragning", projectId: project.project.id });
  const second = workOrder(first.workspace, { title: "Inkoppling", projectId: project.project.id });
  // The dependency as a file from Cloud carries it (the editor has no Tidplan in Local, decision 2026-10-09).
  const file = JSON.parse(JSON.stringify(second.workspace)) as LocalWorkspaceDocument;
  const job = file.workflowTasks.find((task) => task.id === second.task.id)!;
  job.predecessorIds = [first.task.id, "00000000-0000-4000-8000-000000000999", second.task.id];
  const read = parse(file, "org-local");
  assert.deepEqual(read.workflowTasks.find((task) => task.id === second.task.id)!.predecessorIds, [first.task.id], "an unknown id and the job itself are dropped");
  // Saving the job again (any field) keeps the dependency; the page never sends it.
  const saved = saveLocalWorkflowTaskRecord(read, { ...read.workflowTasks.find((task) => task.id === second.task.id)!, title: "Inkoppling av central" });
  assert.deepEqual(saved.task.predecessorIds, [first.task.id]);
  assert.deepEqual(parse(JSON.parse(JSON.stringify(saved.workspace)), "org-local").workflowTasks.find((task) => task.id === second.task.id)!.predecessorIds, [first.task.id]);
  // An older file without the field reads as before, and nothing is added to it.
  const older = JSON.parse(JSON.stringify(saved.workspace)) as LocalWorkspaceDocument;
  for (const task of older.workflowTasks) delete task.predecessorIds;
  const olderRead = parse(older, "org-local");
  assert.ok(olderRead.workflowTasks.every((task) => task.predecessorIds === undefined));
  assert.equal(withKnownPredecessors(olderRead), olderRead, "untouched when nothing is to drop");
});

test("a file whose project history holds schedule events (Tidplan) is still read (Fas 2: the Cloud export gave 400)", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const saved = saveLocalProjectRecord(workspace, { name: "Tidplan", description: "", startDate: "2026-09-01", dueDate: "2026-12-31", customerId: null, responsibleUserId: "local@example.test", responsibleName: "Lokal användare", workMoments: [], facilityId: null, timeBudgetMinutes: null } as never);
  const events = ["TASK_SCHEDULED", "SCHEDULE_EXCEPTION"].map((kind, index) => ({ id: `00000000-0000-4000-8000-00000000000${index + 1}`, kind, summary: "Tidplanen ändrades", taskId: null, actorName: "Lokal användare", createdAt: "2026-10-11T08:00:00.000Z" }));
  const document = { ...saved.workspace, projects: saved.workspace.projects.map((project) => ({ ...project, events: [...project.events, ...events] })) };
  const read = parseLocalWorkspace(JSON.parse(JSON.stringify(document)), "org-local");
  assert.deepEqual(read.projects[0].events.slice(-2).map((event) => event.kind), ["TASK_SCHEDULED", "SCHEDULE_EXCEPTION"]);
});
