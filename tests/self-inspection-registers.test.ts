import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applySelfInspectionAction, type DocumentActor } from "../lib/self-inspection/document";
import {
  documentReminders, dueState, emptySelfInspectionDocument, selfInspectionDocumentSchema, selfInspectionView, SelfInspectionError, type SelfInspectionAction, type SelfInspectionDocument,
} from "../lib/self-inspection/model";
import { assignmentWarnings, workContext } from "../lib/self-inspection/work";
import { createLocalWorkspace, parseLocalWorkspace } from "../features/kfid/local-workspace-store";

// Egenkontroll etapp 2–3 (2026-10-06): the kind of work per assignment, customers' requirements, competence cards,
// instruments and deviations taken from a protocol – the same rules in Cloud, Local and the demo. Roles per assignment
// (a performer and an inspector chosen per project or task) were replaced by roles with levels on 2026-10-07 (tests/roles.test.ts).
const admin: DocumentActor = { id: "u-admin", name: "Ada Admin", admin: true };
const member: DocumentActor = { id: "u-member", name: "Mats Montör", admin: false };
const inspector = { id: "u-insp", name: "Ines Kontroll" };
const people = [{ id: admin.id, name: admin.name }, { id: member.id, name: member.name }, inspector];
let sequence = 0;
const newId = () => `id-${++sequence}`;
const now = new Date("2026-05-01T10:00:00Z");
const act = (doc: SelfInspectionDocument, action: SelfInspectionAction, actor = admin) => applySelfInspectionAction(doc, action, actor, { now, newId, people });
async function rejects(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof SelfInspectionError && error.status === status);
}

async function staffed() {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  const role = (key: string) => doc.program!.roles.find((item) => item.key === key)!.id;
  doc = await act(doc, { action: "save_program", revision: doc.program!.revision, title: "Program", activityTypes: ["LV_HOMES", "LV_OTHER_USE"], worksOnOthersInstallations: true, registrationCheckedAt: null,
    sections: doc.program!.sections.map(({ id, title, body, legalRef }) => ({ id, title, body, legalRef })) });
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: role("installer"), personId: member.id });
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: role("inspector"), personId: inspector.id });
  doc = await act(doc, { action: "save_competence", revision: doc.program!.revision, competence: { personId: inspector.id, workTypes: ["LV_HOMES"], assessment: "Erfaren.", supervised: false } });
  return doc;
}

test("older documents open with empty registers", () => {
  const parsed = selfInspectionDocumentSchema.parse({ program: null, versions: [], confirmations: [], reviews: [], deviations: [] });
  assert.deepEqual([parsed.assignments, parsed.customerRequirements, parsed.credentials, parsed.instruments], [[], [], [], []]);
});

test("the kind of work per project or task: a task inherits its project's choice; no performer or inspector is written any more", async () => {
  let doc = await staffed();
  doc = await act(doc, { action: "set_assignment", target: "project", targetId: "p-1", activityType: "LV_HOMES" }, member);
  const inherited = workContext(doc, { projectId: "p-1", taskId: "t-1" });
  assert.equal(inherited.effective.activityType, "LV_HOMES");
  assert.equal(inherited.task, null);
  assert.deepEqual(inherited.inspectors.map((person) => person.id), [inspector.id], "the people with an inspecting role are still the candidates the warnings match against");
  doc = await act(doc, { action: "set_assignment", target: "task", targetId: "t-1", activityType: "LV_OTHER_USE" });
  const own = workContext(doc, { projectId: "p-1", taskId: "t-1" });
  assert.equal(own.effective.activityType, "LV_OTHER_USE");
  // An older client may still send a performer and an inspector: they are ignored (roles are given in advance, with a level).
  doc = await act(doc, { action: "set_assignment", target: "task", targetId: "t-2", activityType: "LV_HOMES", performerId: member.id, inspectorId: inspector.id } as unknown as SelfInspectionAction);
  const fresh = doc.assignments.find((item) => item.targetId === "t-2")!;
  assert.deepEqual([fresh.performerId, fresh.inspectorId, fresh.activityType], [null, null, "LV_HOMES"]);
  // What an older file holds stays readable and is kept when the kind of work changes; the row goes when nothing is left.
  const old = { id: "a-old", target: "task" as const, targetId: "t-9", performerId: member.id, performerName: member.name, inspectorId: inspector.id, inspectorName: inspector.name, activityType: null, updatedAt: now.toISOString() };
  const legacy = { ...doc, assignments: [...doc.assignments, old] };
  assert.equal(workContext(legacy, { taskId: "t-9" }).effective.inspectorName, inspector.name, "an older choice is still readable");
  const kept = await act(legacy, { action: "set_assignment", target: "task", targetId: "t-9", activityType: "LV_HOMES" });
  assert.deepEqual([kept.assignments.find((item) => item.targetId === "t-9")!.inspectorId, kept.assignments.find((item) => item.targetId === "t-9")!.activityType], [inspector.id, "LV_HOMES"]);
  const cleared = await act(doc, { action: "set_assignment", target: "task", targetId: "t-1" });
  assert.equal(cleared.assignments.filter((item) => item.targetId === "t-1").length, 0, "clearing the choice removes the task's own row");
  // No programme, no assignment.
  await rejects(act(emptySelfInspectionDocument(), { action: "set_assignment", target: "task", targetId: "t-1" }), 404);
});

test("the inspector's warnings: same person, no inspection role, no competence for the work – never a block", async () => {
  const doc = await staffed();
  const context = workContext(doc, { me: { id: admin.id }, admin: true });
  assert.deepEqual(assignmentWarnings(context, { performerName: member.name, inspectorName: inspector.name, activityType: "LV_HOMES" }), []);
  assert.match(assignmentWarnings(context, { performerName: inspector.name, inspectorName: inspector.name, activityType: "LV_HOMES" }).join(" "), /samma person/);
  assert.match(assignmentWarnings(context, { performerName: "", inspectorName: member.name, activityType: null }).join(" "), /ingen roll med kontrolluppgift/);
  assert.match(assignmentWarnings(context, { performerName: "", inspectorName: inspector.name, activityType: "LV_OTHER_USE" }).join(" "), /saknar kompetens för övriga anläggningar/);
  assert.deepEqual(assignmentWarnings({ ...context, hasProgram: false }, { performerName: "a", inspectorName: "a", activityType: null }), []);
  // A member reads only their own assessment (2026-10-09): nothing about another person's competence – no work
  // types, no "missing", no warning built from it – while the roles still say who inspects.
  const forMember = workContext(doc, { me: { id: member.id }, admin: false });
  const other = forMember.inspectors.find((person) => person.id === inspector.id)!;
  assert.deepEqual([other.workTypes, other.assessed, other.expiredCredentials, other.competenceHidden], [[], false, 0, true]);
  assert.equal(forMember.performers.find((person) => person.id === member.id)!.competenceHidden, false, "the person's own");
  assert.deepEqual(assignmentWarnings(forMember, { performerName: "", inspectorName: inspector.name, activityType: "LV_OTHER_USE" }), []);
  assert.deepEqual(workContext(doc, {}).inspectors.map((person) => person.competenceHidden), workContext(doc, {}).inspectors.map(() => true), "no reader, nothing shown");
});

test("customers' special requirements are the customer card's field (2026-10-07): the work context carries the text it is given", async () => {
  const doc = await staffed();
  assert.equal(workContext(doc, { customerRequirements: "  Kontrollpunkterna dokumenteras och lämnas till kunden.\n" }).customerRequirements, "Kontrollpunkterna dokumenteras och lämnas till kunden.");
  assert.equal(workContext(doc, {}).customerRequirements, "");
  // The programme no longer keeps them: the action and the tab are gone.
  await assert.rejects(act(doc, { action: "save_customer_requirements", customerId: "c-1", requirements: "Krav." } as unknown as SelfInspectionAction));
  const view = await selfInspectionView(doc, { me: member, admin: false, company: "Bolaget", people });
  assert.ok(!("customerRequirements" in view) && !("customers" in view));
});

test("deviations from a protocol keep their way back; editing never loses it", async () => {
  let doc = await staffed();
  doc = await act(doc, { action: "save_deviation", deviation: { title: "Isolation under gränsen", source: { taskId: "t-1", title: "Kontroll 1", rowId: "row-7" } } }, member);
  const logged = doc.deviations[0];
  assert.deepEqual(logged.source, { taskId: "t-1", title: "Kontroll 1", rowId: "row-7" });
  assert.deepEqual(workContext(doc, { taskId: "t-1" }).deviations, [{ id: logged.id, number: 1, rowId: "row-7", status: "OPEN" }]);
  doc = await act(doc, { action: "save_deviation", deviation: { id: logged.id, title: "Isolation under gränsen", status: "IN_PROGRESS" } });
  assert.deepEqual(doc.deviations[0].source, logged.source);
});

test("competence cards: admins keep them, a member reads only their own, the bell reminds before they run out", async () => {
  let doc = await staffed();
  await rejects(act(doc, { action: "save_credential", credential: { personId: member.id, title: "Utbildning" } }, member), 403);
  await rejects(act(doc, { action: "save_credential", credential: { personId: "u-unknown", title: "Utbildning" } }), 400);
  doc = await act(doc, { action: "save_credential", credential: { personId: member.id, title: "Elsäkerhetsutbildning", issuedAt: "2023-05-20", validUntil: "2026-05-20" } });
  doc = await act(doc, { action: "save_credential", credential: { personId: inspector.id, title: "Heta arbeten", validUntil: "2026-04-01" } });
  const mine = await selfInspectionView(doc, { me: member, admin: false, company: "Bolaget", people }, "2026-05-01");
  assert.deepEqual(mine.credentials.map((item) => [item.title, item.state]), [["Elsäkerhetsutbildning", "DUE_SOON"]]);
  const all = await selfInspectionView(doc, { me: admin, admin: true, company: "Bolaget", people }, "2026-05-01");
  assert.equal(all.credentials.length, 2);
  const memberBell = documentReminders(doc, { me: member, admin: false }, "2026-05-01").map((item) => item.title);
  assert.ok(memberBell.some((title) => title.includes("Elsäkerhetsutbildning")));
  assert.ok(!memberBell.some((title) => title.includes("Heta arbeten")), "a member is not reminded of others' cards");
  const adminBell = documentReminders(doc, { me: admin, admin: true }, "2026-05-01").map((item) => item.title);
  assert.ok(adminBell.some((title) => title.startsWith("Har gått ut: Heta arbeten")));
  // An expired card is a warning for the inspector.
  assert.match(assignmentWarnings(workContext(doc, { me: { id: admin.id }, admin: true }, "2026-05-01"), { performerName: "", inspectorName: inspector.name, activityType: null }).join(" "), /har gått ut/);
  const id = doc.credentials[0].id;
  doc = await act(doc, { action: "remove_credential", id });
  assert.ok(!doc.credentials.some((item) => item.id === id));
});

test("instruments: admins keep the register, everyone chooses from the active ones, calibration is reminded", async () => {
  let doc = emptySelfInspectionDocument();
  await rejects(act(doc, { action: "save_instrument", instrument: { name: "Testare" } }, member), 403);
  doc = await act(doc, { action: "save_instrument", instrument: { name: "Installationstestare", serialNumber: "S-1", calibratedAt: "2025-05-10", nextCalibrationAt: "2026-05-10" } });
  doc = await act(doc, { action: "save_instrument", instrument: { name: "Gammal testare", serialNumber: "S-0", active: false, nextCalibrationAt: "2020-01-01" } });
  const context = workContext(doc, {}, "2026-05-01");
  assert.deepEqual(context.instruments.map((item) => item.serialNumber), ["S-1"], "only active instruments are offered");
  assert.equal(context.hasProgram, false);
  const adminBell = documentReminders(doc, { me: admin, admin: true }, "2026-05-01");
  assert.deepEqual(adminBell.map((item) => item.title), ["Kalibrering: Installationstestare (S/N S-1)"]);
  assert.deepEqual(documentReminders(doc, { me: member, admin: false }, "2026-05-01"), []);
  const view = await selfInspectionView(doc, { me: member, admin: false, company: "Bolaget", people }, "2026-05-01");
  assert.equal(view.instruments.length, 2, "everyone reads the register");
  assert.equal(dueState("2026-04-30", "2026-05-01"), "OVERDUE");
  assert.equal(dueState(null), "NONE");
});

test("Local keeps the registers in the file", async () => {
  let doc = await staffed();
  doc = await act(doc, { action: "save_instrument", instrument: { name: "Installationstestare", serialNumber: "S-1" } });
  doc = await act(doc, { action: "set_assignment", target: "task", targetId: "t-1", activityType: "LV_HOMES" });
  doc = await act(doc, { action: "set_risk_class", key: "kind:WORK_ORDER", riskClass: 2 });
  const workspace = { ...createLocalWorkspace({ id: "org-1", name: "Bolaget" }), selfInspection: doc };
  const reopened = parseLocalWorkspace(JSON.parse(JSON.stringify(workspace)), "org-1");
  assert.equal(reopened.selfInspection.instruments[0].serialNumber, "S-1");
  assert.equal(reopened.selfInspection.assignments[0].activityType, "LV_HOMES");
  assert.deepEqual(reopened.selfInspection.riskClasses, { "kind:WORK_ORDER": 2 });
  assert.equal(reopened.selfInspection.program!.roles.find((role) => role.key === "inspector")!.level, 3, "roles carry their level in the file");
});

test("the server keeps registers inside the company and checks the work's permission", () => {
  const server = readFileSync("lib/self-inspection/server.ts", "utf8");
  for (const model of ["selfInspectionCredential", "instrument", "selfInspectionAssignment"])
    for (const call of server.matchAll(new RegExp(`\\.${model}\\.(findMany|findFirst|deleteMany|updateMany)\\(\\{ where: \\{([^}]*)`, "g")))
      assert.match(call[2], /organizationId/, `${model}.${call[1]} is scoped to the company`);
  assert.match(server, /requireWorkflowPermission\(ctx, workflowSubjectForTask\(task\.kind, task\.formArea\), action\)/);
  assert.match(server, /requireWorkflowPermission\(ctx, "projects", action\)/);
  const migration = readFileSync("prisma/migrations/20261007153100_self_inspection_registers/migration.sql", "utf8");
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  assert.match(migration, /"organizationId" TEXT NOT NULL/);
});

test("Planering och kravbestämning: a valid Workflow form in our own words, with the inspector from the assignment", async () => {
  const { planningForm } = await import("../lib/workflow/builtin-planning-form");
  const { validateFormDocument, formLeafBlocks } = await import("../lib/workflow/form-document");
  const { formPublishChecks } = await import("../lib/workflow/form-publish");
  assert.deepEqual(validateFormDocument(planningForm.document).issues, []);
  assert.deepEqual(formPublishChecks(planningForm.meta, planningForm.document, null).errors, []);
  const fields = formLeafBlocks(planningForm.document).flatMap((block) => block.type === "field" ? [block] : []);
  assert.equal(fields.find((block) => block.key === "kontrolleras_av")?.prefill, "inspector");
  const text = JSON.stringify(planningForm);
  assert.doesNotMatch(text, /SS-EN|SS 436|IEC|ELSÄK|Elsäkerhetsverket|\bEN \d/, "no standard or authority named in the form");
  const migration = readFileSync("prisma/migrations/20261007153200_builtin_planning_form/migration.sql", "utf8");
  assert.match(migration, /hintek-planering-kravbestamning/);
  assert.match(migration, /"prefill":"inspector"/);
});

test("Kontroll före idrifttagning keeps its fields; they are only filled from the role and the register", async () => {
  const { kfidFormDocument } = await import("../lib/workflow/builtin-kfid-form");
  const { formLeafBlocks } = await import("../lib/workflow/form-document");
  const prefill = Object.fromEntries(formLeafBlocks(kfidFormDocument).flatMap((block) => block.type === "field" ? [[block.key, block.prefill]] : []));
  assert.deepEqual([prefill.ctrl, prefill.instr, prefill.sn, prefill.cal], ["inspector", "instrument", "instrumentSerial", "instrumentCalibration"]);
});

test("Cloud export and re-import carry the programme without overwriting Cloud", () => {
  const exporter = readFileSync("lib/kfid/cloud-export.ts", "utf8");
  assert.match(exporter, /workspace\.selfInspection = await selfInspectionForExport\(/);
  const importer = readFileSync("lib/kfid/cloud-import.ts", "utf8");
  assert.match(importer, /await importSelfInspection\(tx, \{ organizationId: input\.organizationId/);
  const transfer = readFileSync("lib/self-inspection/transfer.ts", "utf8");
  assert.match(transfer, /if \(!program && doc\.program\)/, "a programme comes back only when Cloud has none");
  assert.doesNotMatch(transfer, /\.update(Many)?\(/, "the re-import never changes what Cloud has");
  assert.match(transfer, /content: named\.versions\[index\]\.content/, "an approved version's content keeps its checksum");
});
