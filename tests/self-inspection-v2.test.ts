import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { applySelfInspectionAction, type DocumentActor } from "../lib/self-inspection/document";
import {
  CREDENTIAL_RETENTION_MONTHS, credentialExpired, credentialSavedUntil, documentReminders, emptySelfInspectionDocument, selfInspectionActionSchema, selfInspectionDocumentSchema,
  selfInspectionView, SelfInspectionError, type SelfInspectionAction, type SelfInspectionDocument,
} from "../lib/self-inspection/model";
import { assignmentWarnings, workContext } from "../lib/self-inspection/work";
import { applyPlanningMoments, documentHasPlanningMoments, momentsNotChosen, planningNote, planningProtocolSections, planningScope, type PlanningProtocol } from "../lib/self-inspection/planning-scope";
import { PLANNING_FORM_ID, PLANNING_SCOPE_KEY, PLANNING_SCOPE_POINTS, planningForm } from "../lib/workflow/builtin-planning-form";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { formLeafBlocks, formOptionalSections, formSectionActive, initialFormValues, type FormValues } from "../lib/workflow/form-document";
import { customerSchema } from "../lib/kfid/customer-schema";
import { createLocalWorkspace, moveLegacyCustomerRequirements, parseLocalWorkspace, saveLocalCustomerRecord } from "../features/kfid/local-workspace-store";
import { MENU_HIDEABLE, MENU_ITEM_GROUPS, resolveMenu } from "../lib/workflow/menu-items";
import { noWorkflowPermissionProfile } from "../lib/workflow/permissions";
import { preferencesSchema } from "../lib/kfid/preferences";
import { commandCandidates, SEARCH_COMMANDS, type SearchAccess } from "../lib/search/commands";
import { MOVED_TABS } from "../features/self-inspection/moved-tabs";
import { createDemoDatabase } from "../features/demo/demo-data";
import { demoSelfInspectionWork } from "../features/demo/demo-self-inspection";

// Egenkontroll, the 2026-10-07 wave: Instrument as its own menu page, Särskilda krav on the customer card, competence
// cards kept three months after the person left (and deleted on request), files on the cards, and the control's moments
// preselected from the project's planning protocol.
const admin: DocumentActor = { id: "u-admin", name: "Ada Admin", admin: true };
const member: DocumentActor = { id: "u-member", name: "Mats Montör", admin: false };
const other = { id: "u-other", name: "Olle Annan" };
const people = [{ id: admin.id, name: admin.name }, { id: member.id, name: member.name }, other];
let sequence = 0;
const newId = () => `v2-${++sequence}`;
const now = new Date("2026-05-01T10:00:00Z");
const act = (doc: SelfInspectionDocument, action: SelfInspectionAction, actor = admin) => applySelfInspectionAction(doc, action, actor, { now, newId, people });
const text = (path: string) => readFileSync(path, "utf8");
async function rejects(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof SelfInspectionError && error.status === status);
}

// ---------- Instrument: a menu button of its own ----------

// Since 2026-10-09 (the supporting pages under one menu choice) Egenkontroll and Instrument are sub-pages of
// Verktyg (called Register for a while in point 5), Instrument right after Egenkontroll; each can still be hidden or shown as a shortcut.
test("Instrument is a sub-page of its own under Verktyg, after Egenkontroll, that every person can hide", () => {
  const support = MENU_ITEM_GROUPS.find((group) => group.title === "Verktyg")!;
  const keys = support.items.map((item) => item.key as string);
  assert.equal(keys.indexOf("instruments"), keys.indexOf("self_inspection") + 1);
  assert.deepEqual(support.items.filter((item) => item.key === "self_inspection" || item.key === "instruments").map((item) => [item.key, item.label]), [["self_inspection", "Egenkontroll"], ["instruments", "Instrument"]]);
  assert.ok((MENU_HIDEABLE as readonly string[]).includes("instruments"));
  assert.deepEqual(preferencesSchema.parse({ hiddenMenuItems: ["instruments", "credits"] }).hiddenMenuItems, ["instruments"], "a saved choice is kept, an unknown key is dropped");
});

test("the shell, the page route, Cloud, Local and the demo all know the Instrument view", () => {
  const shell = text("components/app-shell.tsx");
  // Since 2026-10-09 the menu is drawn from resolveMenu (lib/workflow/menu-items.ts): Instrument is a sub-page of
  // Register och verktyg, offered to every signed-in member (menuItemAllowed) and only with a user.
  // The pages' icons are one map for the shell and Sök (2026-11-19).
  assert.match(text("lib/workflow/view-icons.ts"), /instruments: Gauge,/);
  assert.match(shell, /label: VIEW_LABEL\[key\], icon: VIEW_ICON\[key\]/);
  assert.match(shell, /resolveMenu\(user \? \{/, "only for a signed-in person, like Egenkontroll");
  assert.ok(resolveMenu({ memberRole: "MEMBER", workflowPermissions: noWorkflowPermissionProfile() }, { hidden: [], shortcuts: [] }).flat().some((entry) => entry.type === "group" && entry.children.includes("instruments")));
  assert.equal(resolveMenu(null, { hidden: [], shortcuts: [] }).length, 0);
  const page = text("app/page.tsx");
  assert.equal([...page.matchAll(/"instruments"/g)].length, 1, "valid view");
  assert.equal([...text("lib/demo.ts").matchAll(/"instruments"/g)].length, 1, "demo view (the demo's list moved to lib/demo.ts, 2026-11-04)");
  assert.match(text("features/kfid/workspace.tsx"), /view === "instruments" && overview\)\s*content = <InstrumentsPage/);
  assert.match(text("features/kfid/workspace.tsx"), /"self_inspection", "instruments"\]\.includes\(view\)/, "Local keeps the page mounted");
  assert.match(text("features/kfid/local-workspace.tsx"), /view === "instruments" && instrumentsBackend/);
  const demo = text("features/demo/demo-backend.ts");
  assert.match(demo, /searchParams\.get\("part"\) === "instruments"/);
});

test("Sök offers the Instrument page to everyone", () => {
  assert.ok(SEARCH_COMMANDS.some((command) => command.id === "instruments" && command.href === "/?view=instruments"));
  const access: SearchAccess = { admin: false, superadmin: false, local: false, canBuildForms: false, can: () => false, features: { credits: false, billing: false, ai: false, integrations: false, landingEditor: false, import: false } };
  assert.ok(commandCandidates(access).some((candidate) => candidate.id === "instruments" && candidate.title === "Instrument"));
});

test("the old Egenkontroll tabs for instruments and customers lead to where they are now", () => {
  assert.deepEqual(MOVED_TABS, { instruments: "/?view=instruments", customers: "/?view=customers" });
  const page = text("features/self-inspection/self-inspection-page.tsx");
  assert.match(page, /MOVED_TABS\[requested\]/);
  assert.doesNotMatch(page, /key: "instruments"|key: "customers"/, "no tab of their own any more");
  // The bell's reminder for a calibration goes to the new page.
  const doc: SelfInspectionDocument = { ...emptySelfInspectionDocument(), instruments: [{ id: "i-1", name: "Testare", serialNumber: "S-1", calibratedAt: null, nextCalibrationAt: "2026-05-10", note: "", active: true, createdAt: "", updatedAt: "" }] };
  const reminder = documentReminders(doc, { me: admin, admin: true }, "2026-05-01").find((item) => item.id === "self-inspection:instrument:i-1");
  assert.equal(reminder?.href, "/?view=instruments");
});

test("the instrument register keeps its permission: everyone reads it, the company's admins keep it", async () => {
  let doc = emptySelfInspectionDocument();
  await rejects(act(doc, { action: "save_instrument", instrument: { name: "Testare" } }, member), 403);
  doc = await act(doc, { action: "save_instrument", instrument: { name: "Installationstestare", serialNumber: "S-1" } });
  const asMember = await selfInspectionView(doc, { me: member, admin: false, company: "Bolaget", people });
  assert.equal(asMember.canEdit, false);
  assert.equal(asMember.instruments.length, 1);
  const server = text("lib/self-inspection/server.ts");
  assert.match(server, /export async function cloudInstrumentsView/);
  assert.match(server, /canEdit: ctx\.admin/);
  assert.match(server, /prisma\.instrument\.findMany\(\{ where: \{ organizationId: ctx\.organizationId \}/);
  const route = text("app/api/self-inspection/route.ts");
  assert.match(route, /get\("part"\) === "instruments"/);
  assert.ok(route.indexOf("selfInspectionAccess({") < route.indexOf('"instruments"'), "the right to read is checked before the lean read");
});

// ---------- Särskilda krav on the customer card ----------

test("the customer's special requirements are an optional field: a client that does not send it never empties it", () => {
  assert.equal("specialRequirements" in customerSchema.parse({ name: "Kund AB" }), false);
  assert.equal(customerSchema.parse({ name: "Kund AB", specialRequirements: "Dokumentation som PDF." }).specialRequirements, "Dokumentation som PDF.");
  assert.equal(customerSchema.parse({ name: "Kund AB", specialRequirements: "" }).specialRequirements, "");
  assert.throws(() => customerSchema.parse({ name: "Kund AB", specialRequirements: "x".repeat(8001) }));
  // Text written before the move (up to 8000 characters) still fits.
  assert.doesNotThrow(() => customerSchema.parse({ name: "Kund AB", specialRequirements: "x".repeat(8000) }));
});

test("Local: requirements an older file kept in the programme move onto the customers when the file is opened, nothing is lost", async () => {
  let workspace = createLocalWorkspace({ id: "org-1", name: "Bolaget" });
  let saved = saveLocalCustomerRecord(workspace, { name: "Kund AB" });
  workspace = saved.workspace;
  const first = saved.customer.id;
  saved = saveLocalCustomerRecord(workspace, { name: "Kund 2", specialRequirements: "Eget krav." });
  workspace = saved.workspace;
  const second = saved.customer.id;
  const legacy = { ...workspace.selfInspection, customerRequirements: [
    { customerId: first, customerName: "Kund AB", requirements: "Arbetet dokumenteras som PDF.", updatedAt: "2026-05-01T10:00:00.000Z" },
    { customerId: second, customerName: "Kund 2", requirements: "Äldre krav.", updatedAt: "2026-05-01T10:00:00.000Z" },
  ] };
  const reopened = parseLocalWorkspace(JSON.parse(JSON.stringify({ ...workspace, selfInspection: legacy })), "org-1");
  const byId = new Map(reopened.customers.map((customer) => [customer.id, customer]));
  assert.equal(byId.get(first)?.specialRequirements, "Arbetet dokumenteras som PDF.");
  assert.equal(byId.get(second)?.specialRequirements, "Eget krav.\n\nÄldre krav.", "a customer's own text stays, the older text follows it");
  assert.deepEqual(reopened.selfInspection.customerRequirements, []);
  // Opening it again changes nothing more (the file is only written when it is saved).
  assert.deepEqual(moveLegacyCustomerRequirements(reopened).customers, reopened.customers);
  // A file without any is returned as it is.
  assert.equal(moveLegacyCustomerRequirements(workspace), workspace);
  // A text already on the customer is not added twice.
  const twice = moveLegacyCustomerRequirements({ ...reopened, selfInspection: legacy });
  assert.equal(twice.customers.find((customer) => customer.id === second)?.specialRequirements, "Eget krav.\n\nÄldre krav.");
});

test("Local: a saved customer keeps the requirements when a form that does not send them saves it", () => {
  let workspace = createLocalWorkspace({ id: "org-1", name: "Bolaget" });
  const created = saveLocalCustomerRecord(workspace, { name: "Kund AB", specialRequirements: "Krav 1." });
  workspace = created.workspace;
  const changed = saveLocalCustomerRecord(workspace, { name: "Kund AB", city: "Elstad" }, created.customer.id, created.customer.version);
  assert.equal(changed.customer.specialRequirements, "Krav 1.");
  const emptied = saveLocalCustomerRecord(changed.workspace, { name: "Kund AB", specialRequirements: "" }, created.customer.id, changed.customer.version);
  assert.equal(emptied.customer.specialRequirements, "", "an empty field written on purpose empties it");
});

test("the customer card, its edit forms, the export and the re-import carry the field", () => {
  assert.match(text("app/api/customer-card/route.ts"), /notes: true, specialRequirements: true/);
  const card = text("features/kfid/customer-card.tsx");
  assert.match(card, /customer\.specialRequirements\?\.trim\(\)/);
  assert.match(card, /data-testid="customer-special-requirements"/);
  // One customer form since 2026-10-08, ids per register; since 2026-10-09 the register edits in its own page
  // (CustomerEditPage) with the same form, and saves through cloudSaveCustomer, which sends customerPayload.
  assert.match(text("features/kfid/workspace.tsx"), /<CustomerEditPage/);
  assert.match(text("features/kfid/customer-edit-page.tsx"), /<CustomerForm /);
  assert.match(text("features/kfid/customer-form-dialog.tsx"), /id=\{`\$\{idPrefix\}-special-requirements`\}/);
  assert.match(text("features/kfid/customer-form-dialog.tsx"), /idPrefix = "customer"/);
  assert.match(text("features/kfid/customer-form-dialog.tsx"), /data: customerPayload\(value, existing\)/, "an edit form that started from a record without the field never sends an empty one");
  // Since 2026-10-10 the Local register draws the same form with its own ids (local-customer-…).
  // Since plan 1Q (2026-10-11) through the shared fold-out edit and the Ny kund popup/page.
  assert.match(text("features/kfid/local-records.tsx"), /<CustomerInlineEdit[^>]*idPrefix="local-customer"/);
  assert.match(text("features/kfid/local-records.tsx"), /<CustomerCreateDialog[^>]*idPrefix="local-customer"/);
  assert.match(text("features/kfid/customer-register-forms.tsx"), /<CustomerForm idPrefix=\{idPrefix\}/);
  assert.match(text("lib/kfid/cloud-export.ts"), /specialRequirements: customer\.specialRequirements/);
  assert.match(text("lib/kfid/cloud-import.ts"), /local\.specialRequirements !== undefined \? \{ specialRequirements: local\.specialRequirements \}/);
  const transfer = text("lib/self-inspection/transfer.ts");
  assert.match(transfer, /customerRequirements: \[\]/, "the programme no longer carries them in the file");
  assert.doesNotMatch(transfer, /selfInspectionCustomerRequirement/);
  assert.doesNotMatch(text("lib/self-inspection/server.ts"), /selfInspectionCustomerRequirement/, "the old table is not read or written any more");
});

test("the work panels read the customer card's field, also where the company has no programme", async () => {
  const doc: SelfInspectionDocument = emptySelfInspectionDocument();
  const context = workContext(doc, { taskId: "t-1", customerRequirements: "Arbete i ställverket bokas." });
  assert.equal(context.hasProgram, false);
  assert.equal(context.customerRequirements, "Arbete i ställverket bokas.");
  // A project's panel shows them; a task page shows them in Uppdraget above its panels, at every display level (2026-10-08).
  assert.match(text("features/self-inspection/work.tsx"), /!context\.hasProgram && requirements/);
  assert.match(text("features/workflow/workflow-task-editor.tsx"), /requirements=\{work\.context\?\.customerRequirements\}/);
  const server = text("lib/self-inspection/server.ts");
  assert.match(server, /prisma\.customer\.findFirst\(\{ where: \{ id: target\.customerId, organizationId: ctx\.organizationId \}, select: \{ specialRequirements: true \}/);
  // The demo company's invented customer has one, and the demo's work context carries it.
  const db = createDemoDatabase(new Date("2026-10-07T10:00:00Z"));
  const fasform = db.customers.find((customer) => customer.id === "demo-customer-fasform")!;
  assert.match(fasform.specialRequirements ?? "", /driftavdelningen/);
  const demoUser = db.users[0];
  const demoContext = await demoSelfInspectionWork(db, demoUser, { taskId: null, projectId: db.projects.find((project) => project.customerId === fasform.id)!.id, customerId: fasform.id });
  assert.equal(demoContext.customerRequirements, fasform.specialRequirements);
  assert.equal((await demoSelfInspectionWork(db, demoUser, { taskId: null, projectId: null, customerId: "demo-customer-relabacken" })).customerRequirements, "");
});

test("the action to write requirements under Egenkontroll is gone", () => {
  assert.equal(selfInspectionActionSchema.safeParse({ action: "save_customer_requirements", customerId: "c-1", requirements: "Krav." }).success, false);
  assert.doesNotMatch(text("features/self-inspection/registers.tsx"), /CustomerRequirementsTab|save_customer_requirements/);
});

// ---------- Kompetenskort: three months after the person left ----------

test("a card is kept three months from the day the person left, counted in Swedish days", () => {
  assert.equal(CREDENTIAL_RETENTION_MONTHS, 3);
  assert.equal(credentialSavedUntil("2026-05-01T10:00:00.000Z"), "2026-08-01");
  // 00:30 Swedish time on the 1st is still 22:30 UTC the day before.
  assert.equal(credentialSavedUntil("2026-04-30T22:30:00.000Z"), "2026-08-01");
  assert.equal(credentialSavedUntil(new Date("2026-11-30T12:00:00Z")), "2027-02-28", "a month's last day is kept when the day does not exist");
  assert.equal(credentialExpired("2026-05-01T10:00:00.000Z", "2026-08-01"), false, "kept until and including the day");
  assert.equal(credentialExpired("2026-05-01T10:00:00.000Z", "2026-08-02"), true);
  assert.equal(credentialExpired("2026-05-01T10:00:00.000Z", "2026-05-02"), false);
});

async function withCards() {
  let doc = emptySelfInspectionDocument();
  doc = await act(doc, { action: "save_credential", credential: { personId: member.id, title: "Elsäkerhetsutbildning", validUntil: "2026-05-10" } });
  doc = await act(doc, { action: "save_credential", credential: { personId: member.id, title: "Heta arbeten" } });
  doc = await act(doc, { action: "save_credential", credential: { personId: other.id, title: "Kranförarbevis", validUntil: "2026-04-01" } });
  return doc;
}
const left = (doc: SelfInspectionDocument, personId: string, leftAt: string): SelfInspectionDocument => ({ ...doc, credentials: doc.credentials.map((item) => item.personId === personId ? { ...item, leftAt } : item) });

test("the card of a person who left says Sparas till, is hidden after the three months and gives no reminder", async () => {
  const doc = left(await withCards(), member.id, "2026-05-01T10:00:00.000Z");
  const view = await selfInspectionView(doc, { me: admin, admin: true, company: "Bolaget", people, activePeople: [people[0], other] }, "2026-06-15");
  const mine = view.credentials.filter((item) => item.personId === member.id);
  assert.deepEqual(mine.map((item) => item.savedUntil), ["2026-08-01", "2026-08-01"]);
  assert.equal(view.credentials.find((item) => item.personId === other.id)?.savedUntil, null, "a person who is still a member has none");
  assert.deepEqual(view.people.map((person) => person.id), [admin.id, other.id], "a person who left cannot be given a new line");
  // After the day it is no longer shown, whether or not the nightly job has run.
  const later = await selfInspectionView(doc, { me: admin, admin: true, company: "Bolaget", people }, "2026-08-02");
  assert.deepEqual(later.credentials.map((item) => item.personId), [other.id]);
  // No reminder for a card that is only kept: the training that ran out and the one that runs out soon say nothing.
  const titles = documentReminders(doc, { me: admin, admin: true }, "2026-05-01").map((item) => item.title);
  assert.ok(!titles.some((title) => title.includes("Elsäkerhetsutbildning")));
  assert.ok(titles.some((title) => title.includes("Kranförarbevis")), "the others' cards still remind");
  // The warning about an expired training counts someone who is still a member, never a person who left.
  let program = await act(await withCards(), { action: "create_program" });
  program = await act(program, { action: "assign_role", revision: program.program!.revision, roleId: program.program!.roles.find((role) => role.key === "installer")!.id, personId: member.id });
  const expiredFor = (document: SelfInspectionDocument) => workContext(document, { me: { id: admin.id }, admin: true }, "2026-05-20").performers.find((person) => person.id === member.id)?.expiredCredentials;
  assert.equal(expiredFor(program), 1, "Elsäkerhetsutbildning ran out on 2026-05-10");
  assert.equal(expiredFor(left(program, member.id, "2026-05-01T10:00:00.000Z")), 0);
});

test("a person reads only their own card", async () => {
  const doc = await withCards();
  const view = await selfInspectionView(doc, { me: member, admin: false, company: "Bolaget", people }, "2026-05-01");
  assert.deepEqual([...new Set(view.credentials.map((item) => item.personId))], [member.id]);
  assert.deepEqual(view.people, []);
  // A person who left reads nothing: the card is the company's to keep.
  const gone = await selfInspectionView(left(doc, member.id, "2026-05-01T10:00:00.000Z"), { me: member, admin: false, company: "Bolaget", people }, "2026-05-02");
  assert.deepEqual(gone.credentials, []);
  assert.match(text("lib/self-inspection/server.ts"), /\{ userId: viewer\.id, leftAt: null \}/, "and the server does not even read it for them");
});

test("an admin removes a whole card at any time, a member cannot, and a card that is only kept cannot be edited", async () => {
  let doc = await withCards();
  await rejects(act(doc, { action: "remove_credential_card", personId: member.id }, member), 403);
  await rejects(act(doc, { action: "remove_credential_card", personId: "u-nobody" }), 404);
  const kept = left(doc, other.id, "2026-05-01T10:00:00.000Z");
  const lineOfOther = kept.credentials.find((item) => item.personId === other.id)!;
  await rejects(act(kept, { action: "save_credential", credential: { id: lineOfOther.id, personId: other.id, title: "Ändrad" } }), 409);
  // ... but it can be removed, line by line or as a card.
  assert.equal((await act(kept, { action: "remove_credential", id: lineOfOther.id })).credentials.length, 2);
  doc = await act(kept, { action: "remove_credential_card", personId: member.id });
  assert.deepEqual(doc.credentials.map((item) => item.personId), [other.id], "only that person's lines go");
  doc = await act(doc, { action: "remove_credential_card", personId: other.id });
  assert.deepEqual(doc.credentials, []);
});

test("older files and documents open with cards that are not left and have no files", () => {
  const parsed = selfInspectionDocumentSchema.parse({ program: null, versions: [], confirmations: [], reviews: [], deviations: [],
    credentials: [{ id: "c-1", personId: "u-1", title: "Kurs", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] });
  assert.equal(parsed.credentials[0].leftAt, null);
  assert.deepEqual(parsed.credentials[0].files, []);
});

test("the nightly job deletes expired cards with their files and logs counts only", () => {
  const job = text("lib/self-inspection/credentials-server.ts");
  assert.match(job, /credentialExpired\(item\.leftAt, today\)/, "the same rule as the page");
  assert.match(job, /leftAt: \{ not: null, lt:/);
  assert.match(job, /leftAt: \{ not: null \} \}\)/, "a person who came back meanwhile keeps the card");
  assert.match(job, /removeStoredFiles\(removed\.files\)/);
  assert.match(job, /actorId: "system:credential-retention"/);
  assert.doesNotMatch(job.slice(job.indexOf("detail:")), /\.name|\.email|title/, "the log line names nobody");
  assert.match(text("scripts/history/run-retention.ts"), /await purgeExpiredCredentials\(new Date\(\), \{ dryRun \}\)/);
  // The operations notes and the cron schedule are private (not in the community edition).
  if (existsSync("docs/drift/OVERVAKNING_BACKUP_JOBB.md")) assert.match(text("docs/drift/OVERVAKNING_BACKUP_JOBB.md"), /kompetenskort/);
  if (existsSync("ops/cron/hintek-workflow")) assert.match(text("ops/cron/hintek-workflow"), /kompetenskort/);
});

test("the migrations only add: no table or column is dropped, the card keeps its data, the triggers set and clear leftAt", () => {
  const retention = text("prisma/migrations/20261008200100_competence_card_retention/migration.sql");
  const requirements = text("prisma/migrations/20261008200000_customer_special_requirements/migration.sql");
  for (const sql of [retention, requirements]) assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  assert.match(retention, /DROP CONSTRAINT IF EXISTS "SelfInspectionCredential_organizationId_userId_fkey"/, "only the key that deleted the card with the membership");
  assert.match(retention, /BEFORE DELETE ON "OrganizationMember"/);
  assert.match(retention, /AFTER INSERT ON "OrganizationMember"/);
  assert.match(retention, /now\(\) AT TIME ZONE 'UTC'/, "UTC like Prisma's DateTime");
  assert.match(retention, /BEFORE INSERT OR UPDATE OF "organizationId", "userId" ON "SelfInspectionCredential"/, "a line is only started for a member of the company");
  assert.match(retention, /"storagePath" TEXT NOT NULL/);
  assert.match(retention, /FOREIGN KEY \("credentialId", "organizationId"\) REFERENCES "SelfInspectionCredential"\("id", "organizationId"\) ON DELETE CASCADE/, "a file can only belong to a line of its own company");
  assert.match(requirements, /ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "specialRequirements" TEXT NOT NULL DEFAULT ''/);
  assert.match(requirements, /c\."specialRequirements" = ''/, "text the customer already has is never overwritten");
  assert.match(requirements, /r\."organizationId" = c\."organizationId"/, "never across companies");
});

// ---------- the files on a card ----------

test("files on a card: private storage, the same limits as other attachments, admins write, the card's person reads", () => {
  const upload = text("app/api/self-inspection/credential-files/route.ts");
  for (const guard of ["checkOrigin(request)", "requireCloudStorage(ctx)", "await requireCloudWriteAccess(ctx)", "requireAdmin(ctx)", "prepareAttachmentFile(file)", "readLimitedFormData(request, 12_000_000)", "storagePath = await store("])
    assert.ok(upload.includes(guard), guard);
  assert.match(upload, /file\.size > 10_000_000/);
  assert.match(upload, /const organizationId = ctx\.organizationId;[\s\S]*where: \{ id: credentialId, organizationId \}, select: \{ id: true, leftAt: true \}/, "the line is looked up inside the company");
  // Kompetenskort v2: under the company's lock the line is read again (still a member's) and the card keeps a version.
  assert.match(upload, /FOR UPDATE[\s\S]*where: \{ id: line\.id, organizationId, leftAt: null \}[\s\S]*recordCardVersion\(tx/);
  assert.match(upload, /if \(line\.leftAt\) throw new ApiError\(409/, "a card that is only kept takes no new files");
  assert.match(upload, /CREDENTIAL_FILE_LIMIT/);
  assert.match(upload, /if \(storagePath\) await remove\(storagePath\)/, "a file that was stored but not saved is removed again");
  const one = text("app/api/self-inspection/credential-files/[id]/route.ts");
  assert.match(one, /where: \{ id, organizationId: ctx\.organizationId \}/);
  assert.match(one, /where: \{ id, organizationId \}[\s\S]*recordCardVersion\(tx/, "a removal is looked up inside the company and kept in the card's history");
  assert.match(one, /!ctx\.admin && \(file\.credential\.userId !== ctx\.user\.id \|\| file\.credential\.leftAt\)/, "the person's own, and only while they are a member");
  assert.match(one, /"X-Content-Type-Options": "nosniff"/);
  assert.match(one, /"Cache-Control": "private, no-store"/);
  assert.match(one.slice(one.indexOf("export async function DELETE")), /checkOrigin\(request\)[\s\S]*requireAdmin\(ctx\)/);
  // Deleting a line, a card, a person or a company takes the stored files with it.
  const server = text("lib/self-inspection/server.ts");
  assert.match(server, /deleteCredentialLines\(tx, \{ id: input\.id, organizationId \}\)/);
  assert.match(server, /deleteCredentialLines\(tx, \{ organizationId, userId: input\.personId \}\)/);
  assert.match(server, /await removeStoredFiles\(removedFiles\)/);
  assert.match(text("lib/auth/erasure.ts"), /SELECT "storagePath" FROM "SelfInspectionCredentialFile" WHERE "organizationId"/);
  assert.match(text("lib/integrity/system-integrity.ts"), /selfInspectionCredentialFile\.findMany/);
});

test("erasure: the card is kept three months whoever erases the person, a company's goes with the company", () => {
  const erasure = text("lib/auth/erasure.ts");
  assert.match(erasure, /options: \{ keepCompetenceCards\?: boolean; removedFiles\?: string\[\] \} = \{\}/);
  assert.match(erasure, /if \(options\.keepCompetenceCards\) \{\s*await tx\.selfInspectionCredential\.updateMany\(\{ where: \{ userId, leftAt: null \}, data: \{ leftAt: new Date\(\) \} \}\);\s*await tx\.selfInspectionCompetenceCard\.updateMany\(\{ where: \{ userId, leftAt: null \}, data: \{ leftAt: new Date\(\) \} \}\);/);
  assert.match(erasure, /options\.removedFiles\?\.push\(\.\.\.\(await deleteCredentialLines\(tx, \{ userId \}\)\)\.files\);\s*await deleteCompetenceCards\(tx, \{ userId \}\);/);
  const route = text("app/api/erasure/route.ts");
  assert.match(route, /erasePersonTx\(tx, command\.userId, \{ keepCompetenceCards: true \}\)/);
  assert.match(route, /erasePersonTx\(tx, ctx\.user\.id, \{ keepCompetenceCards: true \}\)/);
  assert.match(erasure, /erasePersonTx\(tx, userId, \{ removedFiles: files \}\)/);
});

test("the competence tab: Sparas till, the in-app confirmation (never the browser's), files on a line, no edit of a card that is only kept", () => {
  const tab = text("features/self-inspection/registers.tsx");
  assert.match(tab, /data-testid="credential-saved-until"/);
  assert.match(tab, /Sparas till \{siDate\(person\.savedUntil\)\}/);
  assert.match(tab, /action: "remove_credential_card", personId/);
  assert.match(tab, /title: "Ta bort kompetenskortet\?"/);
  assert.match(tab, /const \[confirm, confirmElement\] = useConfirm\(\)/);
  assert.doesNotMatch(tab, /window\.confirm|\bconfirm\(["'`]|alert\(/);
  assert.match(tab, /\{!left && <IconButton label=\{`Ändra/);
  assert.match(tab, /files && view\.canEdit && !left/);
  assert.match(text("features/self-inspection/self-inspection-page.tsx"), /\/api\/self-inspection\/credential-files/);
  // The help texts say what happens.
  assert.match(tab, /Kortet sparas i tre månader när personen lämnar/);
  assert.match(text("features/workflow/erase-account.tsx"), /kompetenskort[\s\S]*sparas i tre månader/);
  assert.match(text("features/kfid/administration-users.tsx"), /Personens kompetenskort sparas i tre månader/);
});

// ---------- Kontroll före idrifttagning: moments from the planning protocol ----------

const KFID_SECTIONS = ["kfid-iso", "kfid-cont", "kfid-volt", "kfid-rcd", "kfid-zs", "kfid-vis"];
function protocol(id: string, ticked: string[], updatedAt: string, options: { notOk?: string[]; title?: string } = {}): PlanningProtocol {
  const values = initialFormValues(planningForm.document);
  values.checklists[PLANNING_SCOPE_KEY] = Object.fromEntries([...ticked.map((item) => [item, { state: "OK" as const, comment: "" }]), ...(options.notOk ?? []).map((item) => [item, { state: "NOT_OK" as const, comment: "" }])]);
  return { id, title: options.title ?? `Planering ${id}`, updatedAt, document: planningForm.document, values };
}

test("each point of the planning's scope selects a moment of Kontroll före idrifttagning that exists", () => {
  const optional = new Set(formOptionalSections(kfidFormDocument).map((section) => section.id));
  assert.deepEqual([...optional].sort(), [...KFID_SECTIONS].sort());
  for (const point of PLANNING_SCOPE_POINTS) assert.ok(optional.has(point.moment), `${point.text} → ${point.moment}`);
  // The planning form is built from the same points, with the ids and texts it has always had.
  const checklist = formLeafBlocks(planningForm.document).find((block) => block.type === "checklist" && block.key === PLANNING_SCOPE_KEY);
  assert.ok(checklist && checklist.type === "checklist");
  assert.deepEqual(checklist.items, PLANNING_SCOPE_POINTS.map(({ id, text: label }) => ({ id, text: label })));
  assert.deepEqual(checklist.items.map((item) => item.id), ["moment-1", "moment-2", "moment-3", "moment-4", "moment-5", "moment-6", "moment-7"]);
  // Nothing from the standards: only our own words (the copyright precaution).
  assert.doesNotMatch(JSON.stringify(PLANNING_SCOPE_POINTS), /SS-EN|SS 436|IEC|ELSÄK|\bEN \d/);
});

test("a planning protocol selects the moments of its ticked points", () => {
  assert.deepEqual(planningProtocolSections(protocol("p1", ["moment-3", "moment-2"], "2026-05-01T10:00:00Z")), ["kfid-cont", "kfid-iso"], "in the order of the points");
  assert.deepEqual(planningProtocolSections(protocol("p1", ["moment-1", "moment-7"], "2026-05-01T10:00:00Z")), ["kfid-vis"], "okulär kontroll and funktionsprov are the same moment");
  assert.deepEqual(planningProtocolSections(protocol("p1", ["moment-1", "moment-2", "moment-3", "moment-4", "moment-5", "moment-6"], "2026-05-01T10:00:00Z")).sort(), [...KFID_SECTIONS].sort());
  assert.deepEqual(planningProtocolSections(protocol("p1", ["moment-3"], "2026-05-01T10:00:00Z", { notOk: ["moment-5"] })), ["kfid-iso"], "a point that was unticked is not in the scope");
  assert.deepEqual(planningProtocolSections(protocol("p1", [], "2026-05-01T10:00:00Z")), []);
  // Anything that is not a planning protocol, or is damaged, selects nothing.
  assert.deepEqual(planningProtocolSections({ document: kfidFormDocument, values: initialFormValues(kfidFormDocument) }), []);
  assert.deepEqual(planningProtocolSections({ document: { blocks: "x" }, values: null }), []);
});

test("a company's own version of the planning form works too: a reworded point by its id, a new one by its text", () => {
  const values = initialFormValues(planningForm.document);
  const reworded = { ...planningForm.document, blocks: planningForm.document.blocks.map((block) => block.type !== "section" ? block : { ...block, blocks: block.blocks.map((leaf) => leaf.type !== "checklist" || leaf.key !== PLANNING_SCOPE_KEY ? leaf
    : { ...leaf, items: [{ id: "moment-3", text: "Isolationsmätning av kablar" }, { id: "own-1", text: "Fasföljd" }, { id: "own-2", text: "Något helt eget" }] }) }) };
  values.checklists[PLANNING_SCOPE_KEY] = { "moment-3": { state: "OK", comment: "" }, "own-1": { state: "OK", comment: "" }, "own-2": { state: "OK", comment: "" } };
  assert.deepEqual(planningProtocolSections({ document: reworded, values }), ["kfid-iso", "kfid-volt"]);
});

test("the suggestion comes from the latest planning protocol of the project that selects something", () => {
  const older = protocol("old", ["moment-3"], "2026-05-01T10:00:00Z", { title: "Första planeringen" });
  const newer = protocol("new", ["moment-2", "moment-5"], "2026-05-03T10:00:00Z", { title: "Ändrad planering" });
  const empty = protocol("empty", [], "2026-05-05T10:00:00Z");
  assert.deepEqual(planningScope([older, newer]), { taskId: "new", title: "Ändrad planering", sections: ["kfid-cont", "kfid-rcd"] });
  assert.equal(planningScope([older, newer, empty])?.taskId, "new", "a protocol without any point is skipped, not a way to clear the suggestion");
  assert.equal(planningScope([empty]), null);
  assert.equal(planningScope([]), null);
});

test("a new control starts with the suggested moments on, once, and never replaces a choice", () => {
  const values = initialFormValues(kfidFormDocument);
  assert.equal(momentsNotChosen(kfidFormDocument, values), true);
  const next = applyPlanningMoments(kfidFormDocument, values, ["kfid-iso", "kfid-cont"]);
  assert.notEqual(next, values);
  assert.deepEqual(formOptionalSections(kfidFormDocument).filter((section) => formSectionActive(section, next)).map((section) => section.id), ["kfid-iso", "kfid-cont"]);
  assert.deepEqual(formOptionalSections(kfidFormDocument).filter((section) => formSectionActive(section, values)).map((section) => section.id), [], "the original answers are not changed");
  // A choice that is made stops the suggestion.
  assert.equal(momentsNotChosen(kfidFormDocument, next), false);
  assert.equal(momentsNotChosen(kfidFormDocument, { sections: { "kfid-vis": true } }), false);
  // Moments the form does not have are ignored; nothing to change returns the same answers.
  assert.equal(applyPlanningMoments(kfidFormDocument, values, ["finns-inte"]), values);
  assert.equal(applyPlanningMoments(kfidFormDocument, next, ["kfid-iso"]), next);
  assert.equal(applyPlanningMoments(planningForm.document, initialFormValues(planningForm.document), ["kfid-iso"]).sections["kfid-iso"], undefined);
  assert.equal(momentsNotChosen(planningForm.document, initialFormValues(planningForm.document)), false, "a form without moments waits for nothing");
});

test("only a form with the control's moments asks for the planning, and the note says where the choice came from", () => {
  assert.equal(documentHasPlanningMoments(kfidFormDocument), true);
  assert.equal(documentHasPlanningMoments(planningForm.document), false);
  const scope = { title: "Planering S1", sections: ["kfid-iso", "kfid-cont"] };
  const preselected = applyPlanningMoments(kfidFormDocument, initialFormValues(kfidFormDocument), scope.sections);
  assert.equal(planningNote(kfidFormDocument, preselected, scope), "Förvalt från planeringen ”Planering S1”: Isolation, Kontinuitet. Ändra efter behov.");
  const changed: FormValues = { ...preselected, sections: { ...preselected.sections, "kfid-rcd": true } };
  assert.equal(planningNote(kfidFormDocument, changed, scope), "Planeringen ”Planering S1” anger: Isolation, Kontinuitet.", "after a change it only says what the planning says");
  assert.equal(planningNote(planningForm.document, initialFormValues(planningForm.document), scope), "");
  assert.equal(planningNote(kfidFormDocument, preselected, { title: "", sections: ["kfid-iso"] }).includes("Planering och kravbestämning"), true);
});

test("the work context carries the suggestion, and the server reads only protocols of the project that the person may read", () => {
  const scope = planningScope([protocol("p1", ["moment-3"], "2026-05-01T10:00:00Z")]);
  assert.equal(workContext(emptySelfInspectionDocument(), { projectId: "p-1", planning: scope }).planning?.sections[0], "kfid-iso");
  assert.equal(workContext(emptySelfInspectionDocument(), { projectId: "p-1" }).planning, null);
  const server = text("lib/self-inspection/server.ts");
  const read = server.slice(server.indexOf("async function projectPlanningProtocols"), server.indexOf("export async function cloudWorkContext"));
  assert.match(read, /!projectId \|\| !\(ctx\.admin \|\| hasWorkflowPermission\(ctx\.workflowPermissions, "forms", "read"\)\)\) return \[\]/, "the planning form is a protocol of Formulär: its read right is needed");
  assert.match(read, /formFamily\(ctx\.organizationId, PLANNING_FORM_ID\)/, "the company's own version counts as the same form");
  assert.match(read, /organizationId: ctx\.organizationId, projectId, kind: "FORM", formTemplateId: \{ in: ids \}/);
  assert.match(server, /input\.planning \? projectPlanningProtocols\(ctx, target\.projectId\) : \[\]/, "only a protocol asks");
  assert.match(text("app/api/self-inspection/work/route.ts"), /planning: params\.get\("planning"\) === "1"/);
  // The editor asks only for a control, applies it to a new one – unsaved or just created here (2026-10-12) – and keeps a control opened later as it is.
  const editor = text("features/workflow/workflow-task-editor.tsx");
  assert.match(editor, /planning: asksPlanning/);
  assert.match(editor, /const freshHere = \(record: WorkflowTaskRecord\) => !record\.id \|\| record\.id === createdHere/);
  assert.match(editor, /if \(!freshHere\(now\) \|\| now\.data\.kind !== "FORM" \|\| now\.status === "COMPLETED" \|\| !momentsNotChosen\(/);
  assert.match(editor, /planningApplied\.current = planningScope\.taskId/);
  assert.match(editor, /\.\.\.\(momentsNote \? \{ momentsNote \} : \{\}\)/);
  assert.match(text("features/workflow/form-renderer.tsx"), /note=\{actions\?\.momentsNote\}/);
});

test("Kontroll före idrifttagning and the planning form are left as they were (no release migration is needed)", () => {
  // The suggestion only fills in the answers of a new protocol; no block, moment, label or limit of either form changed.
  const migration = text("prisma/migrations/20261007153200_builtin_planning_form/migration.sql");
  assert.match(migration, /"id":"moment-3","text":"Isolationsresistans"/);
  for (const point of PLANNING_SCOPE_POINTS) assert.ok(migration.includes(`"id":"${point.id}","text":"${point.text}"`), `${point.id} is in the stored form`);
  assert.match(migration, new RegExp(PLANNING_FORM_ID));
  assert.equal(formOptionalSections(kfidFormDocument).every((section) => section.defaultOn === false), true, "moments are still all off in the form itself");
  assert.doesNotMatch(text("lib/workflow/builtin-kfid-form.ts"), /planning|PLANNING/i, "the original form knows nothing of the planning");
});

test("assignment warnings still work with the new context (a regression guard for the work panel)", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  doc = await act(doc, { action: "save_program", revision: doc.program!.revision, title: "Program", activityTypes: ["LV_HOMES"], worksOnOthersInstallations: true, registrationCheckedAt: null,
    sections: doc.program!.sections.map(({ id, title, body, legalRef }) => ({ id, title, body, legalRef })) });
  const context = workContext(doc, { customerRequirements: "Krav", planning: null });
  assert.deepEqual(assignmentWarnings(context, { performerName: "", inspectorName: "", activityType: null }), []);
});
