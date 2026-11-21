import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applySelfInspectionAction, type DocumentActor } from "../lib/self-inspection/document";
import { levelDirectory, levelOf, type LevelDirectory, type RoleForLevels } from "../lib/self-inspection/levels";
import { documentLevels, emptySelfInspectionDocument, SelfInspectionError, type SelfInspectionAction, type SelfInspectionDocument } from "../lib/self-inspection/model";
import { savedTaskRefusal } from "../lib/self-inspection/task-work";
import { localAssignRefusal } from "../lib/self-inspection/work";

// Roller med nivå (2026-10-07), the flows around the rule: roles per person, a save's refusal, Local, the demo and the
// screen. The rule itself is tested in tests/roles.test.ts.
const admin: DocumentActor = { id: "u-admin", name: "Ada Admin", admin: true };
const member: DocumentActor = { id: "u-member", name: "Mats Montör", admin: false };
const people = [{ id: admin.id, name: admin.name }, { id: member.id, name: member.name }, { id: "u-anna", name: "Anna Nybörjare" }, { id: "u-sam", name: "Sam Kontrollant" }, { id: "u-ola", name: "Ola Utan" }];
let sequence = 0;
const newId = () => `id-${++sequence}`;
const now = new Date("2026-10-08T10:00:00Z");
const act = (doc: SelfInspectionDocument, action: SelfInspectionAction, actor = admin) => applySelfInspectionAction(doc, action, actor, { now, newId, people });
async function rejects(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof SelfInspectionError && error.status === status);
}

/** Ada ERE (3), Mats and Sam montörer (2; Sam also inspects, 3), Anna under utbildning (1, under handledning); Ola has no role. */
function company(): LevelDirectory {
  const roles: RoleForLevels[] = [
    { name: "Elinstallatör för regelefterlevnad", level: 3, capabilities: ["plan", "inspect"], members: [{ personId: admin.id }] },
    { name: "Montör", level: 2, capabilities: ["perform"], members: [{ personId: member.id }, { personId: "u-sam" }] },
    { name: "Montör med kontrolluppgift", level: 3, capabilities: ["perform", "inspect"], members: [{ personId: "u-sam" }] },
    { name: "Under utbildning", level: 1, capabilities: ["perform"], members: [{ personId: "u-anna" }] },
  ];
  return levelDirectory(roles, ["u-anna"], new Map(people.map((person) => [person.id, person.name])));
}

test("one person's roles in one step: the person ends up with exactly the ticked roles, in one revision", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  const roleId = (key: string) => doc.program!.roles.find((item) => item.key === key)!.id;
  await rejects(act(doc, { action: "set_person_roles", revision: doc.program!.revision, personId: member.id, roleIds: [roleId("installer")] }, member), 403);
  const before = doc.program!.revision;
  doc = await act(doc, { action: "set_person_roles", revision: before, personId: member.id, roleIds: [roleId("installer"), roleId("planner")] });
  assert.equal(doc.program!.revision, before + 1, "one change, one revision");
  assert.deepEqual(levelOf(documentLevels(doc), member.id).roles.sort(), ["Montör", "Projektör"]);
  assert.equal(levelOf(documentLevels(doc), member.id).level, 2);
  // A role the person keeps keeps its details; a role the person loses is gone; roles of others are untouched.
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: roleId("ere"), personId: member.id, authorizationLevel: "AL", authorizationNumber: "123", registered: true });
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: roleId("installer"), personId: admin.id });
  doc = await act(doc, { action: "set_person_roles", revision: doc.program!.revision, personId: member.id, roleIds: [roleId("ere"), roleId("trainee")] });
  const ere = doc.program!.roles.find((role) => role.key === "ere")!.members.find((entry) => entry.personId === member.id)!;
  assert.deepEqual([ere.authorizationLevel, ere.authorizationNumber, ere.registered], ["AL", "123", true]);
  assert.deepEqual(levelOf(documentLevels(doc), member.id).roles.sort(), ["Elinstallatör för regelefterlevnad", "Under utbildning"]);
  assert.equal(levelOf(documentLevels(doc), member.id).level, 3);
  assert.deepEqual(levelOf(documentLevels(doc), admin.id).roles, ["Montör"], "someone else's roles are untouched");
  doc = await act(doc, { action: "set_person_roles", revision: doc.program!.revision, personId: member.id, roleIds: [] });
  assert.equal(levelOf(documentLevels(doc), member.id).level, 0, "no roles: no level");
  await rejects(act(doc, { action: "set_person_roles", revision: doc.program!.revision, personId: member.id, roleIds: ["no-such-role"] }), 404);
  await rejects(act(doc, { action: "set_person_roles", revision: doc.program!.revision + 5, personId: member.id, roleIds: [] }), 409);
  await rejects(act(doc, { action: "set_person_roles", revision: doc.program!.revision, personId: "u-stranger", roleIds: [] }), 400);
  // Local names a person in the file instead of choosing a member; a second step finds the same person again.
  const local = (action: SelfInspectionAction, current = doc) => applySelfInspectionAction(current, action, admin, { now, newId, people, namedPeople: true });
  let named = await local({ action: "set_person_roles", revision: doc.program!.revision, name: "Nina Namn", roleIds: [roleId("trainee")] });
  const ninaId = named.program!.roles.find((role) => role.key === "trainee")!.members[0].personId;
  assert.equal(ninaId, "named:nina namn");
  named = await local({ action: "set_person_roles", revision: named.program!.revision, personId: ninaId, name: "Nina Namn", roleIds: [roleId("trainee"), roleId("installer")] }, named);
  assert.equal(levelOf(documentLevels(named), ninaId).level, 2);
});

test("a save is refused for the level rule with the explanation, and only when it assigns or works", () => {
  const directory = company();
  const risk = { name: "Kontroll", value: 2 as const, suggested: false };
  const names = new Map(people.map((person) => [person.id, person.name]));
  const plain = (executionNotes = "") => ({ kind: "WORK_ORDER", details: { executionNotes, signature: { name: "", confirmed: false, signedAt: null } } });
  const stored = { status: "PLANNED", data: plain(), assignedToUserId: null as string | null };
  const refuse = (actor: string, task: { assignedToUserId?: string | null; assignedToName?: string; status?: string; data?: unknown }, current: typeof stored | null = stored, documented = false) =>
    savedTaskRefusal({ directory, risk, actor: { id: actor }, task: { assignedToUserId: null, assignedToName: "", status: "PLANNED", data: plain(), ...task }, current, documented, names });
  // Planning is not work: someone without a role may change the title, the date or the project.
  assert.equal(refuse("u-ola", {}), null);
  // Assigning: the new responsible person must reach the class by their own level.
  assert.match(refuse("u-admin", { assignedToUserId: "u-anna" })!, /^Anna Nybörjare kan inte tilldelas uppgiften: Kontroll kräver nivå 2 och Anna Nybörjares nivå är 1\./);
  assert.match(refuse("u-admin", { assignedToUserId: "u-ola" })!, /^Ola Utan kan inte tilldelas uppgiften: personen har ingen roll/);
  assert.equal(refuse("u-admin", { assignedToUserId: member.id }), null);
  assert.match(refuse("u-anna", { assignedToUserId: "u-anna" })!, /^Du kan inte tilldelas uppgiften/, "assigning oneself is told to the person");
  assert.equal(refuse("u-admin", { assignedToUserId: "u-anna" }, { ...stored, assignedToUserId: "u-anna" }), null, "an unchanged responsible person is not asked again");
  // Working: filling in, signing and completing by the person who reaches the class, or not.
  assert.match(refuse("u-ola", { data: plain("Text") }, stored, true)!, /^Du kan inte fylla i uppgiften: du har ingen roll i egenkontrollprogrammet och Kontroll kräver nivå 2\./);
  assert.match(refuse("u-ola", { status: "COMPLETED", data: plain("Klart.") })!, /^Du kan inte slutföra uppgiften/);
  assert.equal(refuse(member.id, { data: plain("Text") }, stored, true), null);
  // Under supervision: the saved responsible person is the supervisor.
  assert.match(refuse("u-anna", { data: plain("Text") }, stored, true)!, /Du arbetar under handledning och får göra uppgifter som kräver en nivå över din/);
  assert.equal(refuse("u-anna", { data: plain("Text"), assignedToUserId: "u-sam" }, stored, true), null, "Sam (level 3) is the supervisor");
  assert.match(refuse("u-anna", { data: plain("Text"), assignedToUserId: "u-anna" }, stored, true)!, /Du kan inte tilldelas uppgiften/, "assigning oneself above one's level is refused first");
  // A company without roles, or a task without a class, is never refused.
  assert.equal(savedTaskRefusal({ directory: levelDirectory([]), risk, actor: { id: "u-ola" }, task: { assignedToUserId: null, assignedToName: "", status: "COMPLETED", data: plain("Text") }, current: stored, documented: true }), null);
  assert.equal(savedTaskRefusal({ directory, risk: null, actor: { id: "u-ola" }, task: { assignedToUserId: null, assignedToName: "", status: "COMPLETED", data: plain("Text") }, current: stored, documented: true }), null);
});

test("Local: a task given to a person named in the programme must reach its class; the owner and unknown names are free", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  const roleId = (key: string) => doc.program!.roles.find((item) => item.key === key)!.id;
  const local = (action: SelfInspectionAction) => applySelfInspectionAction(doc, action, admin, { now, newId, people, namedPeople: true });
  doc = await local({ action: "set_person_roles", revision: doc.program!.revision, name: "Nina Nybörjare", roleIds: [roleId("trainee")] });
  doc = await local({ action: "set_person_roles", revision: doc.program!.revision, name: "Olle Montör", roleIds: [roleId("installer")] });
  const control = { kind: "FORM", data: { kind: "FORM", details: { templateId: "hintek-kontroll-fore-idrifttagning", templateName: "Kontroll före idrifttagning" } } };
  const order = { kind: "WORK_ORDER", data: { kind: "WORK_ORDER", details: {} } };
  const to = (name: string, userId: string | null = null) => ({ assignedToName: name, assignedToUserId: userId });
  assert.match(localAssignRefusal(doc, { ...control, ...to("Nina Nybörjare") }, null)!, /^Nina Nybörjare kan inte tilldelas uppgiften: Kontroll före idrifttagning kräver nivå 2 \(Workflows förslag\) och Nina Nybörjares nivå är 1\./);
  assert.match(localAssignRefusal(doc, { ...control, ...to("  nina nybörjare ") }, null)!, /kan inte tilldelas/, "names are matched without regard to case and spaces");
  assert.equal(localAssignRefusal(doc, { ...control, ...to("Olle Montör") }, null), null, "level 2 reaches class 2");
  assert.equal(localAssignRefusal(doc, { ...order, ...to("Nina Nybörjare") }, null), null, "the work order is class 1");
  assert.equal(localAssignRefusal(doc, { ...control, ...to("Kalle Okänd") }, null), null, "a name the programme does not know is free");
  assert.equal(localAssignRefusal(doc, { ...control, ...to("Nina Nybörjare", "owner@example.invalid") }, null), null, "the owner has an id and counts as level 3");
  assert.equal(localAssignRefusal(doc, { ...control, ...to("Nina Nybörjare") }, to("Nina Nybörjare")), null, "a kept responsible person is not asked again");
  doc = await local({ action: "set_risk_class", key: "form:hintek-kontroll-fore-idrifttagning", riskClass: 1 });
  assert.equal(localAssignRefusal(doc, { ...control, ...to("Nina Nybörjare") }, null), null, "the company's own class goes before the proposal");
  doc = await local({ action: "set_risk_class", key: "kind:WORK_ORDER", riskClass: 3 });
  assert.match(localAssignRefusal(doc, { ...order, ...to("Olle Montör") }, null)!, /Arbetsorder kräver nivå 3 och Olle Montörs nivå är 2\./);
  // The owner of the file counts as level 3 in the programme's directory, named in a role or not.
  assert.equal(levelOf(documentLevels(doc, new Map(), "owner@example.invalid"), "owner@example.invalid").level, 3);
  assert.equal(levelOf(documentLevels(doc), "owner@example.invalid").level, 0);
  // The Local file refuses the save with the same words.
  const store = await import("../features/kfid/local-workspace-store");
  const workspace = { ...store.createLocalWorkspace({ id: "org-1", name: "Bolaget" }), selfInspection: doc };
  const input = { kind: "WORK_ORDER", title: "Byt säkring", description: "", status: "PLANNED", projectId: null, customerId: null, dueDate: "", ...to("Olle Montör"), data: order.data };
  assert.throws(() => store.saveLocalWorkflowTaskRecord(workspace, input), /Olle Montör kan inte tilldelas uppgiften: Arbetsorder kräver nivå 3/);
  assert.doesNotThrow(() => store.saveLocalWorkflowTaskRecord(workspace, { ...input, ...to("Kalle Okänd") }));
});

test("the demo applies the same rule with its invented programme", async () => {
  const { createDemoDatabase } = await import("../features/demo/demo-data");
  const demo = await import("../features/demo/demo-self-inspection");
  const db = createDemoDatabase();
  const user = (id: string) => db.users.find((item) => item.id === id)!;
  await demo.ensureDemoSelfInspection(db);
  await demo.demoSelfInspection(db, user("demo-elna"), true, "POST", { action: "set_risk_class", key: "kind:WORK_ORDER", riskClass: 3 });
  const task = { kind: "WORK_ORDER", data: { kind: "WORK_ORDER", details: { executionNotes: "Bytt.", signature: { name: "", confirmed: false, signedAt: null } } }, status: "IN_PROGRESS", assignedToUserId: null, assignedToName: "" };
  // Elis is a montör (level 2): class 3 is above; Elna is the ERE (level 3).
  assert.match(demo.demoSavedRefusal(db, user("demo-elis"), { task, current: null, documented: true })!, /^Du kan inte fylla i uppgiften: Arbetsorder kräver nivå 3 och din nivå är 2\./);
  assert.equal(demo.demoSavedRefusal(db, user("demo-elna"), { task, current: null, documented: true }), null);
  assert.match(demo.demoActionRefusal(db, user("demo-elis"), task, "start")!, /^Du kan inte starta uppgiften/);
  assert.equal(demo.demoActionRefusal(db, user("demo-elon"), task, "reopen"), null, "Elon is a montör med kontrolluppgift (level 3)");
  assert.match(demo.demoSavedRefusal(db, user("demo-elna"), { task: { ...task, assignedToUserId: "demo-elis", assignedToName: "Elis Hammarström" }, current: null, documented: false })!, /^Elis Hammarström kan inte tilldelas uppgiften/);
  const levels = await demo.demoSelfInspectionLevels(db, user("demo-elis"));
  assert.deepEqual([levels.enforced, levels.me.level, levels.riskClasses["kind:WORK_ORDER"]], [true, 2, 3]);
  const work = await demo.demoSelfInspectionWork(db, user("demo-elis"), { taskId: null, projectId: null, customerId: null, kind: "WORK_ORDER" });
  assert.deepEqual([work.riskClass?.value, work.riskClass?.suggested, work.levels.me.level], [3, false, 2]);
  const backend = readFileSync("features/demo/demo-backend.ts", "utf8");
  for (const refusal of ["demoSavedRefusal(ctx.db, ctx.user", 'demoActionRefusal(ctx.db, ctx.user, task, "start")', 'demoActionRefusal(ctx.db, ctx.user, task, "reopen")', 'case "/api/self-inspection/levels"'])
    assert.ok(backend.includes(refusal), refusal);
});

test("the screen explains a blocked occasion and never leaves a dead button", () => {
  const editor = readFileSync("features/workflow/workflow-task-editor.tsx", "utf8");
  assert.match(editor, /const levelBlock = !preview && task\.status !== "COMPLETED" && work\.context \? workBlock\(work\.context, \{ responsibleId: task\.assignedToUserId/, "computed from the page, with the responsible person on screen");
  // A draft without a work order (2026-10-27) is blocked the same way: startBlock is the level block or the missing link.
  assert.ok(editor.includes("const startBlock = levelBlock ?? linkBlock;"));
  assert.match(editor, /if \(command === "START" && startBlock\) \{ announce\(startBlock, true\); return; \}/, "Starta tid explains instead of doing nothing");
  assert.match(editor, /const complete = async \(\) => \{\s+if \(startBlock\) \{ announce\(startBlock, true\); return; \}/, "Färdigställ explains");
  assert.match(editor, /data-testid="task-level-blocked"/);
  assert.match(editor, /<fieldset disabled=\{Boolean\(startBlock\)\} className="min-w-0" data-testid="task-content">/, "the content is read-only");
  assert.match(editor, /<fieldset disabled=\{busy \|\| task\.status === "COMPLETED" \|\| frozen\} className="min-w-0">/, "the planning fields stay open, so a supervisor can be made responsible");
  assert.match(editor, /data-testid="task-assignee-level"/, "the Ansvarig field says why a person does not reach the class");
  assert.match(editor, /label: `Kräver nivå \$\{riskClass\.value\}\$\{riskClass\.suggested \? " \(förslag\)" : ""\}`/, "the header shows the class, marked when it is Workflow's proposal");
  assert.match(editor, /formId: !task\.id && kind === "FORM" \? form\?\.templateId \?\? null : null/, "a new protocol shows its class from the start");
  const picker = readFileSync("features/workflow/task-type-picker.tsx", "utf8");
  assert.match(picker, /risk: levels \? effectiveRiskClass\(/);
  assert.match(picker, /onRiskClass: admin && levels \?/, "only an admin changes the class from a card");
  assert.match(readFileSync("features/workflow/form-card.tsx", "utf8"), /<RiskClassMark value=\{form\.risk\.value\} suggested=\{form\.risk\.suggested\} onClick=\{form\.onRiskClass\} \/>/);
  const page = readFileSync("features/self-inspection/self-inspection-page.tsx", "utf8");
  assert.match(page, /\{ key: "levels", label: "Krävd nivå", icon: ShieldAlert, admin: true \}/, "the tab is for admins");
  assert.match(page, /\{tab === "levels" && view\.canEdit && <RiskClassesTab view=\{view\} busy=\{busy\} run=\{run\} \/>\}/);
  assert.match(readFileSync("features/workflow/form-builder/index.tsx", "utf8"), /riskClass=\{<RiskClassSetting formId=\{originalId\} category=\{snapshot\.meta\.category\} \/>\}/, "the form builder sets the family's class");
  const panel = readFileSync("features/self-inspection/work.tsx", "utf8");
  assert.doesNotMatch(panel, /performerId: value|inspectorId: value|Kontrollerande/, "no performer or inspector is chosen per project or task any more");
  const levels = readFileSync("app/api/self-inspection/levels/route.ts", "utf8");
  assert.match(levels, /every active member reads it/);
  assert.doesNotMatch(levels, /requireAdmin|ctx\.admin/, "readable by every member");
});
