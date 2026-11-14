import assert from "node:assert/strict";
import test from "node:test";
import { applySelfInspectionAction, type DocumentActor } from "../lib/self-inspection/document";
import {
  closePatch, createOrderRefusal, deviationClosedText, deviationHref, deviationLinkText, deviationOrderHref, deviationOrderText, deviationWorkOrderActionSchema, documentAfterOrderSave,
  documentOrders, documentWithEntryOrder, documentWithoutOrder, linkPatch, manualStatusPatch, mayReadDeviation, newEntryPatch, orderForRow, sameRow, storedOrderFacts, withDeviationOrders,
  closedByOrderText, deviationItemFacts, deviationOrderAssignee, deviationOrderPriority, withoutSourceNote, workOrderFromDeviation, type DeviationOrderFacts, type DeviationRow,
} from "../lib/self-inspection/deviation-link";
import { flowDoneText, workOrderFlow } from "../lib/workflow/task-flow";
import { deviationSchema, emptySelfInspectionDocument, selfInspectionDocumentSchema, selfInspectionView, type SelfInspectionAction, type SelfInspectionDocument } from "../lib/self-inspection/model";
import { workContext } from "../lib/self-inspection/work";
import { workflowTaskInputSchema } from "../lib/workflow/task-model";
import { createLocalWorkspace } from "../features/kfid/local-workspace-store";
import { localOrderForRow, localWorkOrderFromDeviation, localWorkspaceAfterOrderSave } from "../features/self-inspection/local-deviation-link";

// Avvikelse ↔ arbetsorder ↔ egenkontrollens avvikelselogg (2026-10-10): the shared rules Cloud, Local and the demo use.
const admin: DocumentActor = { id: "u-admin", name: "Ada Admin", admin: true };
const member: DocumentActor = { id: "u-member", name: "Mats Montör", admin: false };
const people = [{ id: admin.id, name: admin.name }, { id: member.id, name: member.name }];
const NOW = "2026-10-10T08:00:00.000Z";
let sequence = 0;
const newId = () => `id-${++sequence}`;
const act = (doc: SelfInspectionDocument, action: SelfInspectionAction, actor = admin, orderOf?: (row: DeviationRow) => DeviationOrderFacts | null) =>
  applySelfInspectionAction(doc, action, actor, { now: new Date(NOW), newId, people, orderForRow: orderOf });
const row = { taskId: "protocol-1", rowId: "row-7" };
const fromRow = (title: string) => ({ action: "save_deviation" as const, deviation: { title, description: "Isolationen under gränsen", source: { taskId: row.taskId, title: "Kontroll Storgatan", rowId: row.rowId } } });
const order = (extra: Record<string, unknown> = {}) => ({ id: "order-1", kind: "WORK_ORDER", title: "Åtgärda: Isolation", status: "PLANNED", completedAt: null, createdAt: NOW,
  data: { kind: "WORK_ORDER", details: { source: { taskId: row.taskId, title: "Kontroll Storgatan", kind: "FORM", rowId: row.rowId } } }, ...extra });

test("the same protocol row links an entry and a work order; a row without id never matches", () => {
  assert.equal(sameRow({ taskId: "protocol-1", rowId: "row-7" }, row), true);
  assert.equal(sameRow({ taskId: "protocol-1", rowId: "row-8" }, row), false);
  assert.equal(sameRow({ taskId: "protocol-2", rowId: "row-7" }, row), false);
  assert.equal(sameRow({ taskId: "protocol-1", rowId: "" }, { taskId: "protocol-1", rowId: "" }), false);
  assert.equal(sameRow(null, row), false);
  // The newest order of the row, never a protocol or another row.
  const tasks = [order(), order({ id: "order-2", createdAt: "2026-10-11T08:00:00.000Z" }), order({ id: "protocol-x", kind: "FORM" }), order({ id: "order-3", data: { kind: "WORK_ORDER", details: { source: { taskId: row.taskId, rowId: "row-8" } } } })];
  assert.equal(orderForRow(tasks, row)?.id, "order-2");
  assert.equal(orderForRow(tasks, { taskId: row.taskId, rowId: "" }), null);
});

test("rule 1: a new order takes an entry without one (Öppen → Pågår); an entry logged later starts linked", () => {
  assert.deepEqual(linkPatch({ status: "OPEN", action: "", closedAt: null }, "order-1"), { workOrderId: "order-1", status: "IN_PROGRESS" });
  assert.deepEqual(linkPatch({ status: "IN_PROGRESS", action: "", closedAt: null }, "order-1"), { workOrderId: "order-1" });
  assert.equal(linkPatch({ status: "OPEN", action: "", closedAt: null, workOrderId: "order-0" }, "order-1"), null, "an entry keeps the order it has");
  const actor = { id: "u-member", name: "Mats Montör" };
  assert.deepEqual(newEntryPatch({ status: "OPEN", action: "", closedAt: null }, { id: "order-1", title: "AO", status: "IN_PROGRESS", completedAt: null }, actor, NOW), { workOrderId: "order-1", status: "IN_PROGRESS" });
  // A finished order: Åtgärdad with the order's date and whoever finished it, else the person logging.
  const finished = { id: "order-1", title: "AO", status: "COMPLETED", completedAt: "2026-10-09T12:00:00.000Z", completedBy: { id: "u-admin", name: "Ada Admin" } };
  assert.deepEqual(newEntryPatch({ status: "OPEN", action: "", closedAt: null }, finished, actor, NOW),
    { workOrderId: "order-1", status: "DONE", closedAt: "2026-10-09T12:00:00.000Z", closedById: "u-admin", closedByName: "Ada Admin", action: "Åtgärdad genom arbetsorder AO" });
  assert.equal(newEntryPatch({ status: "OPEN", action: "", closedAt: null }, { ...finished, completedBy: null }, actor, NOW).closedByName, "Mats Montör");
  // A cancelled order is linked but changes nothing.
  assert.deepEqual(newEntryPatch({ status: "OPEN", action: "", closedAt: null }, { ...finished, status: "CANCELLED" }, actor, NOW), { workOrderId: "order-1" });
});

test("rule 3: finishing the order closes the entry with when and who; an empty Åtgärd names the order; reopening changes nothing", () => {
  const by = { id: "u-admin", name: "Ada Admin" };
  assert.deepEqual(closePatch({ status: "IN_PROGRESS", action: "", closedAt: null }, { title: "Åtgärda: Isolation" }, by, NOW),
    { status: "DONE", closedAt: NOW, closedById: "u-admin", closedByName: "Ada Admin", action: "Åtgärdad genom arbetsorder Isolation" }, "the order's title without its Åtgärda:");
  assert.equal(closePatch({ status: "OPEN", action: "Byt kabeln", closedAt: null }, { title: "AO" }, by, NOW)!.action, undefined, "a written Åtgärd stays");
  assert.equal(closePatch({ status: "DONE", action: "", closedAt: NOW }, { title: "AO" }, by, NOW), null);
  const doc: SelfInspectionDocument = { ...emptySelfInspectionDocument(), deviations: [entry({ id: "d1", workOrderId: "order-1", status: "IN_PROGRESS" }), entry({ id: "d2", workOrderId: "order-1", status: "DONE", closedAt: "2026-10-01T00:00:00.000Z", closedByName: "Någon" }), entry({ id: "d3" })] };
  const done = documentAfterOrderSave(doc, { order: order({ status: "COMPLETED" }), previousStatus: "IN_PROGRESS", by, now: NOW });
  assert.deepEqual(done.deviations.map((item) => [item.id, item.status, item.closedByName ?? ""]), [["d1", "DONE", "Ada Admin"], ["d2", "DONE", "Någon"], ["d3", "OPEN", ""]]);
  assert.equal(done.deviations[0].closedAt, NOW);
  // Saved again while finished (nothing changes) and reopened (the entry stays as it is).
  assert.equal(documentAfterOrderSave(done, { order: order({ status: "COMPLETED" }), previousStatus: "COMPLETED", by, now: NOW }), done);
  assert.equal(documentAfterOrderSave(done, { order: order({ status: "NEEDS_ACTION" }), previousStatus: "COMPLETED", by, now: NOW }), done);
  // Not a work order: nothing.
  assert.equal(documentAfterOrderSave(doc, { order: order({ kind: "FORM", status: "COMPLETED" }), previousStatus: "IN_PROGRESS", by, now: NOW }), doc);
});

test("rule 4: closing by hand records who; staying Åtgärdad keeps the first closing; leaving it clears it", () => {
  const actor = { id: "u-admin", name: "Ada Admin" };
  assert.deepEqual(manualStatusPatch({ status: "IN_PROGRESS", action: "", closedAt: null }, "DONE", actor, NOW), { closedAt: NOW, closedById: "u-admin", closedByName: "Ada Admin" });
  assert.deepEqual(manualStatusPatch({ status: "DONE", action: "", closedAt: "2026-10-01T00:00:00.000Z", closedById: "u-x", closedByName: "Xena" }, "DONE", actor, NOW),
    { closedAt: "2026-10-01T00:00:00.000Z", closedById: "u-x", closedByName: "Xena" });
  assert.deepEqual(manualStatusPatch({ status: "DONE", action: "", closedAt: NOW, closedById: "u-x", closedByName: "Xena" }, "OPEN", actor, NOW), { closedAt: null, closedById: null, closedByName: "" });
});

test("rule 2: the work order for an entry – Åtgärda, priority by the entry's class, its responsible person, the protocol's customer, project and place, the way back to the row", () => {
  const value = { number: 4, kind: "DEVIATION" as const, title: "Isolation under gränsen", description: "Grupp 3 mätte 0,2 MΩ.", category: "IMMEDIATE" as const, source: { taskId: "protocol-1", title: "Kontroll Storgatan", rowId: "row-7" } };
  const draft = workflowTaskInputSchema.parse(workOrderFromDeviation(value, { kind: "FORM", projectId: "project-1", customerId: "customer-1", facilityId: "place-1" }));
  assert.equal(draft.title, "Åtgärda: Isolation under gränsen");
  assert.equal(draft.kind, "WORK_ORDER");
  assert.equal(draft.status, "PLANNED");
  assert.deepEqual([draft.projectId, draft.customerId, draft.facilityId], ["project-1", "customer-1", "place-1"]);
  assert.match(draft.description, /^Grupp 3 mätte 0,2 MΩ\.\n\nFrån avvikelse 4 i avvikelseloggen\.$/);
  assert.equal(draft.data.kind, "WORK_ORDER");
  if (draft.data.kind !== "WORK_ORDER") return;
  assert.deepEqual(draft.data.details.source, { taskId: "protocol-1", title: "Kontroll Storgatan", kind: "FORM", rowId: "row-7" });
  assert.equal("maintenance" in draft.data.details, false, "the facts are a maintenance item's (2026-10-30), made only on a machine part");
  assert.deepEqual([draft.assignedToUserId, draft.assignedToName], [null, ""], "no responsible person given: Ingen ansvarig");
  // The item the server makes when the protocol is on a machine part (lib/maintenance/server.ts deviationItem).
  const facts = deviationItemFacts(value, new Date(NOW));
  assert.deepEqual([facts.type, facts.priority, facts.fault, facts.reportedAt], ["CORRECTIVE", "HIGH", "Grupp 3 mätte 0,2 MΩ.", NOW], "Omedelbar åtgärd is Hög");
  // Without a protocol (a report straight in the log, or the protocol is gone): no customer, project or way back.
  const bare = workflowTaskInputSchema.parse(workOrderFromDeviation({ ...value, description: "" }, null));
  assert.deepEqual([bare.projectId, bare.customerId, bare.facilityId], [null, null, null]);
  assert.equal(bare.data.kind === "WORK_ORDER" && bare.data.details.source, undefined);
  assert.equal(deviationItemFacts({ ...value, description: "" }).fault, "Isolation under gränsen", "without a description the title is the fault");
  assert.equal(workOrderFromDeviation({ ...value, title: "x".repeat(200) }, null).title.length, 200);
  // Rutinöversyn (the default class of an entry from a protocol) is Normal; an entry without a class too.
  assert.equal(deviationItemFacts({ ...value, category: "ROUTINE" }).priority, "NORMAL");
  assert.deepEqual([deviationOrderPriority("IMMEDIATE"), deviationOrderPriority("ROUTINE"), deviationOrderPriority(undefined)], ["HIGH", "NORMAL", "NORMAL"]);
  // The entry's responsible person, once the caller has found that the person may work with work orders, is Ansvarig.
  const assigned = workflowTaskInputSchema.parse(workOrderFromDeviation(value, null, { id: "u-member", name: "Mats Montör" }));
  assert.deepEqual([assigned.assignedToUserId, assigned.assignedToName], ["u-member", "Mats Montör"]);
  // The description sent from a protocol ends with "Från <protokollet>."; the order says where it came from once, by the log.
  const fromProtocol = workOrderFromDeviation({ ...value, description: "Grupp 3 mätte 0,2 MΩ.\n\nFrån Kontroll Storgatan." }, null);
  assert.equal(fromProtocol.description, "Grupp 3 mätte 0,2 MΩ.\n\nFrån avvikelse 4 i avvikelseloggen.");
  // Who may: the right to create work orders, once, and not on an entry already Åtgärdad.
  assert.equal(createOrderRefusal({ status: "OPEN" }, true), null);
  assert.match(createOrderRefusal({ status: "OPEN" }, false)!, /behörighet/);
  assert.match(createOrderRefusal({ status: "OPEN", workOrderId: "order-1" }, true)!, /redan en arbetsorder/);
  assert.match(createOrderRefusal({ status: "DONE" }, true)!, /redan åtgärdad/);
  assert.ok(deviationWorkOrderActionSchema.safeParse({ action: "create_work_order", deviationId: "d1" }).success);
  assert.ok(!deviationWorkOrderActionSchema.safeParse({ action: "save_deviation", deviationId: "d1" }).success);
});

test("words and links: the log shows the order, the order shows the entry, a closed entry says when and by whom", () => {
  assert.equal(deviationOrderText({ id: "o", title: "Åtgärda: Isolation", status: "IN_PROGRESS", readable: true }), "Arbetsorder: Åtgärda: Isolation · Pågår");
  assert.equal(deviationOrderText({ id: "o", title: "", status: "", readable: false }), "Arbetsorder kopplad");
  assert.equal(deviationLinkText({ number: 3, status: "IN_PROGRESS" }), "Avvikelse 3 i avvikelseloggen · Pågår");
  assert.equal(deviationLinkText({ kind: "IMPROVEMENT", number: 5, status: "DONE" }), "Förbättring 5 i avvikelseloggen · Åtgärdad");
  assert.equal(deviationClosedText({ status: "DONE", closedAt: "2026-10-09T23:30:00.000Z", closedByName: "Ada Admin" }), "Åtgärdad 2026-10-10 av Ada Admin", "the Swedish day");
  assert.equal(deviationClosedText({ status: "DONE", closedAt: NOW, closedByName: "" }), "Åtgärdad 2026-10-10");
  assert.equal(deviationClosedText({ status: "IN_PROGRESS", closedAt: null }), "");
  assert.equal(deviationHref("d 1"), "/?view=deviations&deviation=d%201");
  assert.equal(deviationOrderHref("o1"), "/?view=workflow_task&taskId=o1&taskType=WORK_ORDER");
});

test("the log's view: the order's title and status only for those who may read work orders; a deleted order is no link", async () => {
  const doc: SelfInspectionDocument = { ...emptySelfInspectionDocument(), deviations: [entry({ id: "d1", workOrderId: "order-1" }), entry({ id: "d2", number: 2, workOrderId: "gone" }), entry({ id: "d3", number: 3 })] };
  const view = await selfInspectionView(doc, { me: { id: admin.id, name: admin.name }, admin: true, company: "Alfa", people });
  const orders = documentOrders(doc, [order({ status: "IN_PROGRESS" }), order({ id: "protocol-1", kind: "FORM" })]);
  assert.deepEqual([...orders.keys()], ["order-1"]);
  const reader = withDeviationOrders(view, orders, { read: true, create: true });
  assert.equal(reader.canCreateWorkOrder, false, "no programme, no log");
  assert.deepEqual(reader.deviations.find((item) => item.id === "d1")!.workOrder, { id: "order-1", title: "Åtgärda: Isolation", status: "IN_PROGRESS", readable: true });
  assert.equal(reader.deviations.find((item) => item.id === "d2")!.workOrder, null);
  assert.equal(reader.deviations.find((item) => item.id === "d3")!.workOrder, null);
  const blind = withDeviationOrders({ ...view, hasProgram: true }, orders, { read: false, create: false });
  assert.deepEqual(blind.deviations.find((item) => item.id === "d1")!.workOrder, { id: "order-1", title: "", status: "", readable: false });
  assert.equal(blind.canCreateWorkOrder, false);
});

test("the document: an entry logged from a row with an order starts linked; a new order takes the row's entries; deleting the order drops the link", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  // Logged before any order: no link.
  doc = await act(doc, fromRow("Isolation"), member, () => null);
  assert.equal(doc.deviations[0].workOrderId, undefined);
  assert.equal(doc.deviations[0].status, "OPEN");
  // The order is made from the row: the entry gets it and is Pågår.
  doc = documentAfterOrderSave(doc, { order: order(), previousStatus: null, by: member, now: NOW });
  assert.equal(doc.deviations[0].workOrderId, "order-1");
  assert.equal(doc.deviations[0].status, "IN_PROGRESS");
  // A second entry of the same row logged now starts linked; a member's report is otherwise Öppen.
  doc = await act(doc, fromRow("Isolation igen"), member, (asked) => storedOrderFacts(orderForRow([order({ status: "IN_PROGRESS" })], asked)));
  assert.equal(doc.deviations[1].workOrderId, "order-1");
  assert.equal(doc.deviations[1].status, "IN_PROGRESS");
  // … and one logged after the order was finished is Åtgärdad with the order's date and who finished it.
  const finished = order({ status: "COMPLETED", completedAt: "2026-10-09T12:00:00.000Z", updatedBy: admin.id });
  doc = await act(doc, fromRow("Isolation en tredje gång"), member, (asked) => storedOrderFacts(orderForRow([finished], asked), () => ({ id: admin.id, name: admin.name })));
  assert.deepEqual([doc.deviations[2].status, doc.deviations[2].closedAt, doc.deviations[2].closedByName, doc.deviations[2].action], ["DONE", "2026-10-09T12:00:00.000Z", "Ada Admin", "Åtgärdad genom arbetsorder Isolation"]);
  // An admin edits an entry: the link stays; closing by hand records the admin.
  const first = doc.deviations[0];
  doc = await act(doc, { action: "save_deviation", deviation: { id: first.id, title: first.title, status: "DONE", action: "Bytt kabel" } });
  assert.deepEqual([doc.deviations[0].workOrderId, doc.deviations[0].status, doc.deviations[0].closedById, doc.deviations[0].closedByName, doc.deviations[0].closedAt], ["order-1", "DONE", admin.id, admin.name, NOW]);
  // Deleting the order: only the link goes.
  const without = documentWithoutOrder(doc, "order-1");
  assert.deepEqual(without.deviations.map((item) => item.workOrderId), [null, null, null]);
  assert.equal(without.deviations[0].status, "DONE");
  assert.equal(documentWithoutOrder(without, "order-1"), without);
  // Skapa arbetsorder: the entry and any other entry of its row without an order.
  const fresh: SelfInspectionDocument = { ...emptySelfInspectionDocument(), deviations: [entry({ id: "a", source: { taskId: row.taskId, title: "", rowId: row.rowId } }), entry({ id: "b", number: 2, source: { taskId: row.taskId, title: "", rowId: row.rowId } }), entry({ id: "c", number: 3 })] };
  const linked = documentWithEntryOrder(fresh, "a", "order-9", NOW);
  assert.deepEqual(linked.deviations.map((item) => [item.id, item.workOrderId ?? null, item.status]), [["a", "order-9", "IN_PROGRESS"], ["b", "order-9", "IN_PROGRESS"], ["c", null, "OPEN"]]);
});

test("older files open unchanged; the new fields are additive", () => {
  const older = { id: "d1", number: 1, kind: "DEVIATION", title: "T", description: "", category: "ROUTINE", systematic: false, status: "OPEN", action: "", responsibleId: null, dueDate: "", followUp: "",
    reportedById: "u", createdAt: NOW, updatedAt: NOW, closedAt: null };
  const parsed = deviationSchema.parse(older);
  assert.equal("workOrderId" in parsed, false);
  assert.equal("closedById" in parsed, false);
  assert.equal("closedByName" in parsed, false);
  const doc = selfInspectionDocumentSchema.parse({ deviations: [older, { ...older, id: "d2", number: 2, workOrderId: "o1", closedById: "u", closedByName: "Ada" }] });
  assert.deepEqual([doc.deviations[1].workOrderId, doc.deviations[1].closedByName], ["o1", "Ada"]);
});

test("the work order's page lists the entries it fixes, only for those who may read them", () => {
  const doc = { ...emptySelfInspectionDocument(), deviations: [
    entry({ id: "mine", reportedById: member.id, workOrderId: "order-1" }),
    entry({ id: "theirs", number: 2, reportedById: "u-other", workOrderId: "order-1" }),
    entry({ id: "responsible", number: 3, reportedById: "u-other", responsibleId: member.id, workOrderId: "order-1", status: "DONE", closedAt: NOW, closedByName: "Ada Admin" }),
    entry({ id: "elsewhere", number: 4, reportedById: member.id, workOrderId: "order-2" }),
  ] };
  const forMember = workContext(doc, { taskId: "order-1", me: { id: member.id }, admin: false });
  assert.deepEqual(forMember.orderDeviations!.map((item) => item.id), ["mine", "responsible"]);
  assert.deepEqual(forMember.orderDeviations![1], { id: "responsible", number: 3, kind: "DEVIATION", status: "DONE", closedAt: NOW, closedByName: "Ada Admin" });
  assert.deepEqual(workContext(doc, { taskId: "order-1", me: { id: admin.id }, admin: true }).orderDeviations!.map((item) => item.id), ["mine", "theirs", "responsible"]);
  assert.deepEqual(workContext(doc, { taskId: null, me: { id: admin.id }, admin: true }).orderDeviations, []);
  assert.equal(mayReadDeviation({ id: "x", admin: false }, { reportedById: "y", responsibleId: null }), false);
});

test("Local: Skapa arbetsorder saves the order with the file's rules and links it in the same change; a finished order closes the entry", async () => {
  let workspace = createLocalWorkspace({ id: "org-1", name: "Alfa" });
  // The protocol the rows are in (only its id, kind and links are read).
  workspace = { ...workspace, workflowTasks: [{ id: row.taskId, kind: "FORM", title: "Kontroll Storgatan", status: "IN_PROGRESS", projectId: null, customerId: null, facilityId: null } as unknown as (typeof workspace.workflowTasks)[number]] };
  const owner = { id: "owner@example.invalid", name: "Ägaren" };
  const local = (doc: SelfInspectionDocument, action: SelfInspectionAction) => applySelfInspectionAction(doc, action, { ...owner, admin: true }, { now: new Date(NOW), newId, people: [owner], namedPeople: true, orderForRow: localOrderForRow(workspace, owner) });
  let doc = await local(workspace.selfInspection, { action: "create_program" });
  doc = await local(doc, fromRow("Isolation"));
  workspace = { ...workspace, selfInspection: doc };
  const entryId = doc.deviations[0].id;
  workspace = localWorkOrderFromDeviation(workspace, entryId);
  const made = workspace.workflowTasks.find((task) => task.kind === "WORK_ORDER")!;
  assert.equal(made.title, "Åtgärda: Isolation");
  assert.deepEqual(made.data.kind === "WORK_ORDER" && made.data.details.source, { taskId: row.taskId, title: "Kontroll Storgatan", kind: "FORM", rowId: row.rowId });
  assert.deepEqual([workspace.selfInspection.deviations[0].workOrderId, workspace.selfInspection.deviations[0].status], [made.id, "IN_PROGRESS"]);
  assert.throws(() => localWorkOrderFromDeviation(workspace, entryId), /redan en arbetsorder/);
  // A later entry of the same row starts linked (the file's order of the row).
  doc = await local(workspace.selfInspection, fromRow("Isolation igen"));
  assert.equal(doc.deviations[1].workOrderId, made.id);
  workspace = { ...workspace, selfInspection: doc };
  // Finished (the status as the file's save sets it): both entries become Åtgärdad by the owner.
  const finished = { ...workspace, workflowTasks: workspace.workflowTasks.map((task) => task.id === made.id ? { ...task, status: "COMPLETED" as const, completedAt: NOW } : task) };
  const closed = localWorkspaceAfterOrderSave(finished, { taskId: made.id, previousStatus: "IN_PROGRESS", owner });
  assert.deepEqual(closed.selfInspection.deviations.map((item) => [item.status, item.closedByName]), [["DONE", "Ägaren"], ["DONE", "Ägaren"]]);
  assert.equal(localWorkspaceAfterOrderSave(closed, { taskId: "missing", previousStatus: null, owner }), closed);
});

function entry(extra: Partial<SelfInspectionDocument["deviations"][number]>): SelfInspectionDocument["deviations"][number] {
  return { id: "d", number: 1, kind: "DEVIATION", title: "Avvikelse", description: "", category: "ROUTINE", systematic: false, status: "OPEN", action: "", responsibleId: null, responsibleName: "", dueDate: "", followUp: "",
    reportedById: admin.id, reportedByName: "", createdAt: NOW, updatedAt: NOW, closedAt: null, source: null, ...extra };
}

test("who becomes Ansvarig on an order from the log: the entry's responsible person, when the person may work with work orders", () => {
  const person = { id: "u-member", name: "Mats Montör", active: true, admin: false, readOrders: true, editOrders: true };
  assert.deepEqual(deviationOrderAssignee(person), { id: "u-member", name: "Mats Montör" });
  assert.deepEqual(deviationOrderAssignee({ ...person, readOrders: false, editOrders: false, admin: true }), { id: "u-member", name: "Mats Montör" }, "an admin may");
  assert.equal(deviationOrderAssignee({ ...person, editOrders: false }), null, "read only: no");
  assert.equal(deviationOrderAssignee({ ...person, readOrders: false }), null, "edit without read: no");
  assert.equal(deviationOrderAssignee({ ...person, active: false }), null, "a member who has left: no");
  assert.equal(deviationOrderAssignee(null), null);
});

test("Åtgärd when the order closes the entry: the order's title without Åtgärda:, and the protocol named once on the card", () => {
  assert.equal(closedByOrderText("Åtgärda: Isolation, Grupp 1 L-PE"), "Åtgärdad genom arbetsorder Isolation, Grupp 1 L-PE");
  assert.equal(closedByOrderText("Byte av central"), "Åtgärdad genom arbetsorder Byte av central");
  assert.equal(closedByOrderText("Åtgärda: "), "Åtgärdad genom arbetsorder (utan rubrik)");
  const source = { taskId: "p", title: "Villa Ek – ny laddbox i garage", rowId: "r" };
  assert.equal(withoutSourceNote("Isolation, Grupp 1 är inte godkänd.\n\nFrån Villa Ek – ny laddbox i garage.", source), "Isolation, Grupp 1 är inte godkänd.");
  assert.equal(withoutSourceNote("Från Villa Ek – ny laddbox i garage.", source), "");
  assert.equal(withoutSourceNote("Från ett annat protokoll.", source), "Från ett annat protokoll.", "only the protocol's own name");
  assert.equal(withoutSourceNote("Text. Från Villa Ek – ny laddbox i garage.", null), "Text. Från Villa Ek – ny laddbox i garage.", "no source, nothing taken");
});

test("the log keeps the protocol's name once: a closing Från <protokollet>. is not stored with the entry", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  doc = await act(doc, { action: "save_deviation", deviation: { title: "Isolation", description: "Isolation, Grupp 1 är inte godkänd.\n\nFrån Kontroll Storgatan.", source: { taskId: row.taskId, title: "Kontroll Storgatan", rowId: row.rowId } } }, member, () => null);
  assert.equal(doc.deviations[0].description, "Isolation, Grupp 1 är inte godkänd.");
  assert.equal(doc.deviations[0].source?.title, "Kontroll Storgatan");
});

// The row is gone from the protocol (removed, or thrown away with Kasta; 2026-10-12): the reporter withdraws the entry.
test("withdraw_deviation: an untouched entry leaves the log, a handled one is kept and marked; only the reporter or an admin", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  doc = await act(doc, fromRow("Isolation"), member, () => null);
  const untouched = doc.deviations[0];
  const other: DocumentActor = { id: "u-other", name: "Olle", admin: false };
  await assert.rejects(act(doc, { action: "withdraw_deviation", id: untouched.id }, other), /Bara den som förde avvikelsen/);
  await assert.rejects(act(doc, { action: "withdraw_deviation", id: "missing" }, member), /hittades inte/);
  const gone = await act(doc, { action: "withdraw_deviation", id: untouched.id }, member);
  assert.equal(gone.deviations.length, 0, "an open entry without a plan or an order is taken out");
  // Linked to a work order at once (rule 1): the entry is handled, so it stays with a note of the withdrawal.
  let linked = await act(await act(emptySelfInspectionDocument(), { action: "create_program" }), fromRow("Isolation"), member, () => order() as unknown as DeviationOrderFacts);
  assert.equal(linked.deviations[0].status, "IN_PROGRESS");
  linked = await act(linked, { action: "withdraw_deviation", id: linked.deviations[0].id }, admin);
  assert.equal(linked.deviations.length, 1);
  assert.match(linked.deviations[0].followUp, /borttagen ur protokollet/);
  assert.equal(linked.deviations[0].source?.rowId, row.rowId, "the way back is kept for the record");
  const again = await act(linked, { action: "withdraw_deviation", id: linked.deviations[0].id }, member);
  assert.equal(again.deviations[0].followUp, linked.deviations[0].followUp, "the note is written once");
});

test("a finished flow says the same as its dots: an optional step left out is named, not counted as done", () => {
  const base = { saved: true, title: "Åtgärda: Isolation", status: "COMPLETED", assigned: false, dueDate: "", timerRunning: false, totalDurationSec: 0, executionNotes: "Klart", signatureName: "QA", signatureConfirmed: true };
  const skipped = workOrderFlow(base);
  assert.equal(skipped.steps.find((step) => step.key === "plan")?.state, "skipped");
  assert.equal(flowDoneText(skipped), "Klart – alla steg är gjorda utom det valfria steget Planering.");
  assert.equal(flowDoneText(workOrderFlow({ ...base, assigned: true })), "Klart – alla steg är gjorda.");
  assert.equal(flowDoneText({ steps: [{ key: "a", label: "A", state: "skipped", hint: "" }, { key: "b", label: "B", state: "skipped", hint: "" }, { key: "c", label: "C", state: "done", hint: "" }] }),
    "Klart – alla steg är gjorda utom de valfria stegen A och B.");
});
