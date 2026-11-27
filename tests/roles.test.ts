import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applySelfInspectionAction, type DocumentActor } from "../lib/self-inspection/document";
import {
  checkLevel, directoryOfView, effectiveRiskClass, formRiskKey, isRiskClassKey, levelDirectory, levelOf, levelsView, proposedRiskClass, riskClassKey, toLevel, WORK_ORDER_RISK_KEY,
  type LevelDirectory, type RoleForLevels,
} from "../lib/self-inspection/levels";
import {
  changeFingerprint, contentSchema, documentLevels, emptySelfInspectionDocument, peopleOverview, programContent, selfInspectionActionSchema, selfInspectionDocumentSchema, selfInspectionView,
  SelfInspectionError, type SelfInspectionAction, type SelfInspectionDocument,
} from "../lib/self-inspection/model";
import { TEMPLATE_ROLES } from "../lib/self-inspection/template";
import { savedWork } from "../lib/self-inspection/task-work";
import { assignBlock, workBlock, workContext } from "../lib/self-inspection/work";
import { RISK_FORM_ID } from "../lib/workflow/builtin-originals";

// Roller med nivå och riskklasser (2026-10-07): the rule that Cloud's routes, Local, the demo and the screen share.
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

/** Roles: Ada ERE (3), Mats montör (2), Anna under utbildning (1, under handledning), Sam inspector (3); Ola has no role. */
function company(options: { supervised?: string[] } = {}): LevelDirectory {
  const roles: RoleForLevels[] = [
    { name: "Elinstallatör för regelefterlevnad", level: 3, capabilities: ["plan", "inspect"], members: [{ personId: admin.id }] },
    { name: "Montör", level: 2, capabilities: ["perform"], members: [{ personId: member.id }, { personId: "u-sam" }] },
    { name: "Montör med kontrolluppgift", level: 3, capabilities: ["perform", "inspect"], members: [{ personId: "u-sam" }] },
    { name: "Under utbildning", level: 1, capabilities: ["perform"], members: [{ personId: "u-anna" }] },
  ];
  return levelDirectory(roles, options.supervised ?? ["u-anna"], new Map(people.map((person) => [person.id, person.name])));
}
const class2 = { name: "Kontroll före idrifttagning", value: 2 as const, suggested: false };
const class3 = { name: "Isolationsmätning", value: 3 as const, suggested: true };

test("a person's level is the highest among their roles; no role is level 0", () => {
  const directory = company();
  assert.equal(levelOf(directory, member.id).level, 2);
  assert.equal(levelOf(directory, "u-sam").level, 3, "two roles: the highest counts");
  assert.deepEqual(levelOf(directory, "u-sam").roles, ["Montör", "Montör med kontrolluppgift"]);
  assert.equal(levelOf(directory, "u-sam").inspects, true);
  assert.equal(levelOf(directory, member.id).inspects, false);
  assert.equal(levelOf(directory, "u-ola").level, 0, "a person with no role has no level");
  assert.equal(levelOf(directory, "u-anna").supervised, true);
  assert.equal(levelOf(directory, admin.id).name, admin.name);
});

test("nothing is blocked while no role has been given to anyone, nor for a task type without a class", () => {
  const nobody = levelDirectory([{ name: "Montör", level: 2, members: [] }]);
  assert.equal(nobody.enforced, false);
  assert.deepEqual(checkLevel({ directory: nobody, subject: class3, action: "start", person: { id: "u-ola" } }), { allowed: true, via: "free" });
  assert.equal(levelDirectory([]).enforced, false);
  // A level on a competence card alone switches nothing on: the others without a role are never locked out by it.
  const cardOnly = levelDirectory([{ name: "Montör", level: 2, members: [] }], [], new Map(), new Map([["u-anna", 2]]));
  assert.equal(cardOnly.enforced, false);
  assert.deepEqual(checkLevel({ directory: cardOnly, subject: class3, action: "assign", person: { id: "u-ola" } }), { allowed: true, via: "free" });
  // Once one role has a person, the people without a role are limited too.
  const directory = company();
  assert.equal(directory.enforced, true);
  assert.equal(checkLevel({ directory, subject: null, action: "start", person: { id: "u-ola" } }).allowed, true, "no class, no block");
  assert.equal(checkLevel({ directory, subject: class2, action: "start", person: { id: "u-ola" } }).allowed, false);
});

test("a person reaches a class by their level: the actions are all the same rule", () => {
  const directory = company();
  for (const action of ["assign", "start", "fill", "complete", "sign", "reopen"] as const) {
    assert.equal(checkLevel({ directory, subject: class2, action, person: member }).allowed, true, `${action}: level 2 reaches class 2`);
    assert.equal(checkLevel({ directory, subject: class3, action, person: member }).allowed, false, `${action}: level 2 does not reach class 3`);
    assert.equal(checkLevel({ directory, subject: class3, action, person: admin }).allowed, true, `${action}: level 3 reaches class 3`);
    assert.equal(checkLevel({ directory, subject: class2, action, person: { id: "u-ola" } }).allowed, false, `${action}: no role does not reach anything`);
  }
});

test("a refusal says what is missing, in Swedish, to the person or about them", () => {
  const directory = company();
  const own = checkLevel({ directory, subject: class3, action: "complete", person: member, self: true });
  assert.ok(!own.allowed);
  assert.match(own.message, /^Du kan inte slutföra uppgiften: Isolationsmätning kräver nivå 3 \(Workflows förslag\) och din nivå är 2\./);
  assert.match(own.message, /Be en administratör ge dig en roll med nivå 3 eller högre under Egenkontroll\./);
  assert.equal(own.missing, "level");
  const about = checkLevel({ directory, subject: class2, action: "assign", person: { id: "u-ola", name: "Ola Utan" } });
  assert.ok(!about.allowed);
  assert.match(about.message, /^Ola Utan kan inte tilldelas uppgiften: personen har ingen roll i egenkontrollprogrammet och Kontroll före idrifttagning kräver nivå 2\./);
  assert.equal(about.missing, "role");
  const named = checkLevel({ directory, subject: class3, action: "start", person: { id: member.id, name: "Anders" } });
  assert.ok(!named.allowed && /Anders kan inte starta uppgiften.*Anders nivå är 2/.test(named.message), "a possessive for the person's level");
  const signed = checkLevel({ directory, subject: class3, action: "sign", person: { id: member.id, name: "Mats" } });
  assert.ok(!signed.allowed && /Mats kan inte signera uppgiften.*Mats nivå är 2/.test(signed.message));
});

test("supervision: one class above the level, when a supervisor of enough level is the responsible one", () => {
  const directory = company();
  const anna = { id: "u-anna", name: "Anna" };
  const sam = { id: "u-sam", name: "Sam" };
  // Anna is level 1 under supervision: class 2 with Sam (level 3) or Mats (level 2) responsible – yes.
  assert.deepEqual(checkLevel({ directory, subject: class2, action: "fill", person: anna, responsible: sam }), { allowed: true, via: "supervision" });
  assert.deepEqual(checkLevel({ directory, subject: class2, action: "complete", person: anna, responsible: member }), { allowed: true, via: "supervision" });
  // The supervisor must reach the class: Mats (2) cannot supervise class 3 – and Anna is not two classes up from 1 to 3.
  assert.equal(checkLevel({ directory, subject: class3, action: "fill", person: anna, responsible: sam }).allowed, false, "only one class above");
  const twoUp = levelDirectory([{ name: "Montör", level: 2, members: [{ personId: "u-b" }, { personId: "u-c" }] }, { name: "Chef", level: 3, members: [{ personId: "u-s" }] }], ["u-b"]);
  assert.equal(checkLevel({ directory: twoUp, subject: class3, action: "fill", person: { id: "u-b" }, responsible: { id: "u-s" } }).allowed, true, "level 2 under supervision reaches class 3");
  assert.equal(checkLevel({ directory: twoUp, subject: class3, action: "fill", person: { id: "u-b" }, responsible: { id: "u-c" } }).allowed, false, "a level 2 supervisor does not reach class 3");
  // Without a responsible person, with themself as the responsible, or when not under supervision: no exception.
  assert.equal(checkLevel({ directory, subject: class2, action: "fill", person: anna }).allowed, false);
  assert.equal(checkLevel({ directory, subject: class2, action: "fill", person: anna, responsible: anna }).allowed, false);
  assert.equal(checkLevel({ directory: company({ supervised: [] }), subject: class2, action: "fill", person: anna, responsible: sam }).allowed, false, "not under supervision");
  assert.equal(checkLevel({ directory, subject: class2, action: "fill", person: { id: "u-ola" }, responsible: sam }).allowed, false, "no role and not supervised");
  // The refusal tells what the supervised person can do, and when the supervisor is too low.
  const bare = checkLevel({ directory, subject: class2, action: "start", person: anna, self: true });
  assert.ok(!bare.allowed);
  assert.equal(bare.missing, "supervisor");
  assert.match(bare.message, /Du arbetar under handledning och får göra uppgifter som kräver en nivå över din när en handledare med nivå 2 eller högre är ansvarig på uppgiften\./);
  const low = checkLevel({ directory: twoUp, subject: class3, action: "start", person: { id: "u-b", name: "Bo" }, responsible: { id: "u-c", name: "Cia" } });
  assert.ok(!low.allowed);
  assert.match(low.message, /Cia har nivå 2 – handledaren behöver nivå 3 eller högre\./);
});

test("being assigned the responsibility is strictly by level: the supervisor must be able to do it themself", () => {
  const directory = company();
  const anna = { id: "u-anna", name: "Anna" };
  assert.equal(checkLevel({ directory, subject: class2, action: "assign", person: anna }).allowed, false, "a supervised person is not made responsible above their level");
  // Planning someone on the task can use supervision, because the task's responsible person is named there.
  assert.equal(checkLevel({ directory, subject: class2, action: "assign", person: anna, responsible: { id: "u-sam" } }).allowed, true);
  assert.equal(assignBlock({ levels: levelsView(directory, admin.id, {}), riskClass: { key: "k", ...class2 } }, anna)?.startsWith("Anna kan inte tilldelas uppgiften"), true);
  assert.equal(assignBlock({ levels: levelsView(directory, admin.id, {}), riskClass: { key: "k", ...class2 } }, member), null);
});

test("risk classes: the company's own before Workflow's proposal; the old risk assessment follows its form", () => {
  assert.equal(proposedRiskClass({ kind: "WORK_ORDER" }), 1);
  assert.equal(proposedRiskClass({ kind: "FORM", formId: "f-1", category: "ELECTRICAL" }), 2);
  assert.equal(proposedRiskClass({ kind: "FORM", formId: "f-1", category: "POWER" }), 3);
  assert.equal(proposedRiskClass({ kind: "FORM", formId: "f-1", category: "ROUNDS" }), 1);
  assert.equal(proposedRiskClass({ kind: "FORM", formId: "f-1", category: "OTHER" }), 1);
  assert.equal(proposedRiskClass({ kind: "FORM", formId: "f-1", category: null }), 1, "an unknown category is the lowest class");
  assert.equal(proposedRiskClass({ kind: "FORM", formId: RISK_FORM_ID, category: "SAFETY" }), 2, "the risk assessment is above the category's proposal");
  assert.equal(proposedRiskClass({ kind: "RISK_ASSESSMENT" }), 2);
  assert.equal(riskClassKey({ kind: "WORK_ORDER" }), WORK_ORDER_RISK_KEY);
  assert.equal(riskClassKey({ kind: "RISK_ASSESSMENT" }), formRiskKey(RISK_FORM_ID), "the old type shares the form's class");
  assert.equal(riskClassKey({ kind: "FORM", formId: "f-1" }), "form:f-1");
  assert.equal(riskClassKey({ kind: "FORM", formId: null }), null);
  const proposal = effectiveRiskClass({ kind: "FORM", formId: "f-1", category: "ELECTRICAL", name: "Kontroll" }, {});
  assert.deepEqual(proposal, { key: "form:f-1", name: "Kontroll", value: 2, suggested: true });
  const own = effectiveRiskClass({ kind: "FORM", formId: "f-1", category: "ELECTRICAL", name: "Kontroll" }, { "form:f-1": 3 });
  assert.deepEqual(own, { key: "form:f-1", name: "Kontroll", value: 3, suggested: false });
  assert.equal(effectiveRiskClass({ kind: "FORM", formId: "f-1", category: "ELECTRICAL" }, { "form:f-1": 9 })!.suggested, true, "an invalid stored class is ignored");
  assert.equal(effectiveRiskClass({ kind: "WORK_ORDER" }, { [WORK_ORDER_RISK_KEY]: 2 })!.value, 2);
  assert.equal(effectiveRiskClass({ kind: "FORM", formId: null }, {}), null);
  for (const key of ["kind:WORK_ORDER", "form:abc-1", "form:hintek-kontroll-fore-idrifttagning"]) assert.ok(isRiskClassKey(key), key);
  for (const key of ["", "form:", "kind:RISK", "form:a b", "kind:WORK_ORDER ", "other:1"]) assert.ok(!isRiskClassKey(key), key);
  assert.deepEqual([toLevel(2), toLevel(7), toLevel("2"), toLevel(undefined, 3)], [2, 1, 1, 3]);
});

test("what a save does: planning is not work; filling in, signing and completing are", () => {
  const form = (values: Record<string, unknown>, signatures: Record<string, unknown> = {}) => ({ kind: "FORM", details: { templateId: "f", document: { big: true }, values: { fields: values, signatures } } });
  const order = (executionNotes: string, confirmed = false, signedAt: string | null = null) => ({ kind: "WORK_ORDER", details: { executionNotes, signature: { name: "A", confirmed, signedAt } } });
  const stored = { status: "PLANNED", data: form({ a: "1" }) };
  assert.equal(savedWork({ current: stored, status: "PLANNED", data: form({ a: "1" }) }), null, "an unchanged save is not work");
  assert.equal(savedWork({ current: stored, status: "PLANNED", data: form({ a: "2" }) }), "fill");
  assert.equal(savedWork({ current: stored, status: "COMPLETED", data: form({ a: "1" }) }), "complete");
  assert.equal(savedWork({ current: stored, status: "IN_PROGRESS", data: form({ a: "1" }) }), "start");
  assert.equal(savedWork({ current: stored, status: "PAUSED", data: form({ a: "1" }) }), null, "pausing or marking that action is needed is planning");
  assert.equal(savedWork({ current: stored, status: "NEEDS_ACTION", data: form({ a: "1" }) }), null);
  assert.equal(savedWork({ current: stored, status: "PLANNED", data: form({ a: "1" }, { s: { confirmed: true, signedAt: "x" } }) }), "sign");
  // The form's own copy and the timestamps the server stamps are not answers.
  assert.equal(savedWork({ current: { status: "PLANNED", data: form({ a: "1" }, { s: { confirmed: true, signedAt: "2026-10-01T10:00:00Z" } }) }, status: "PLANNED",
    data: { ...form({ a: "1" }, { s: { confirmed: true, signedAt: "2026-10-08T10:00:00Z" } }), details: { ...form({ a: "1" }, { s: { confirmed: true, signedAt: "2026-10-08T10:00:00Z" } }).details, document: { other: 1 } } } }), null);
  // Work orders and risk assessments compare their details.
  assert.equal(savedWork({ current: { status: "PLANNED", data: order("") }, status: "PLANNED", data: order("") }), null);
  assert.equal(savedWork({ current: { status: "PLANNED", data: order("") }, status: "PLANNED", data: order("Bytt säkring.") }), "fill");
  assert.equal(savedWork({ current: { status: "IN_PROGRESS", data: order("Klart.") }, status: "IN_PROGRESS", data: order("Klart.", true, "2026-10-08T10:00:00Z") }), "sign");
  assert.equal(savedWork({ current: { status: "PLANNED", data: { kind: "RISK_ASSESSMENT", details: { approval: { confirmed: false } } } }, status: "PLANNED",
    data: { kind: "RISK_ASSESSMENT", details: { approval: { confirmed: true, approvedAt: "x" } } } }), "sign");
  // A new task: planning is free; content, a signature, a started status or completion is work.
  assert.equal(savedWork({ current: null, status: "PLANNED", data: order(""), documented: false }), null);
  assert.equal(savedWork({ current: null, status: "PLANNED", data: order("Text"), documented: true }), "fill");
  assert.equal(savedWork({ current: null, status: "IN_PROGRESS", data: order(""), documented: false }), "start");
  assert.equal(savedWork({ current: null, status: "COMPLETED", data: order("Text"), documented: true }), "complete");
  assert.equal(savedWork({ current: null, status: "PLANNED", data: order("", true), documented: true }), "sign");
});

test("a company without roles is untouched; the page's check explains a blocked occasion before it is tried", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  doc = await act(doc, { action: "set_risk_class", key: "form:f-1", riskClass: 2 });
  const subject = { kind: "FORM" as const, formId: "f-1", category: "ELECTRICAL", name: "Kontroll" };
  const open = workContext(doc, { taskId: "t-1", me: { id: member.id }, subject });
  assert.equal(open.levels.enforced, false);
  assert.equal(workBlock(open), null, "no role placed: nothing is blocked");
  const roleId = (key: string) => doc.program!.roles.find((role) => role.key === key)!.id;
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: roleId("installer"), personId: member.id });
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: roleId("trainee"), personId: "u-anna" });
  doc = await act(doc, { action: "save_competence", revision: doc.program!.revision, competence: { personId: "u-anna", workTypes: [], assessment: "Elev.", supervised: true } });
  const context = (me: string) => workContext(doc, { taskId: "t-1", me: { id: me }, subject, names: new Map(people.map((person) => [person.id, person.name])) });
  assert.equal(context(member.id).levels.enforced, true);
  assert.deepEqual(context(member.id).riskClass, { key: "form:f-1", name: "Kontroll", value: 2, suggested: false });
  assert.equal(workBlock(context(member.id)), null, "the installer (level 2) reaches class 2");
  assert.match(workBlock(context("u-ola"))!, /^Du kan inte arbeta i uppgiften: du har ingen roll i egenkontrollprogrammet och Kontroll kräver nivå 2\./);
  assert.match(workBlock(context("u-anna"))!, /Du kan inte arbeta i uppgiften: Kontroll kräver nivå 2 och din nivå är 1\./);
  assert.equal(workBlock(context("u-anna"), { responsibleId: member.id, responsibleName: member.name }), null, "under supervision of the installer, who reaches the class");
  assert.equal(workBlock(context("u-anna"), { responsibleId: "u-ola" })?.includes("Ola Utan"), false, "a responsible without a role is no supervisor");
  assert.match(workBlock(context(admin.id), { person: { id: "u-ola", name: "Ola Utan" }, action: "assign" })!, /^Ola Utan kan inte tilldelas uppgiften/);
});

test("roles carry a level: only admins change it, a role keeps it when the field is left out, the programme freezes it", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  const level = (key: string) => doc.program!.roles.find((role) => role.key === key)!.level;
  assert.deepEqual(["ere", "inspector", "planner", "installer", "program_admin", "manager", "hired", "trainee"].map(level), [3, 3, 2, 2, 1, 1, 1, 1], "Workflow's proposal on the template's roles");
  for (const item of TEMPLATE_ROLES) assert.ok([1, 2, 3].includes(item.level), `${item.name} has a level`);
  const installer = doc.program!.roles.find((role) => role.key === "installer")!;
  const edit = (patch: Record<string, unknown>, actor = admin) => act(doc, { action: "save_role", revision: doc.program!.revision, role: { id: installer.id, name: installer.name, description: installer.description, duties: installer.duties, isEre: false, capabilities: installer.capabilities, ...patch } } as SelfInspectionAction, actor);
  await rejects(edit({ level: 3 }, member), 403);
  doc = await edit({ level: 3 });
  assert.equal(level("installer"), 3);
  doc = await edit({ description: "Ny beskrivning." });
  assert.equal(level("installer"), 3, "an edit that leaves the level out keeps it");
  await assert.rejects(edit({ level: 4 }), /Nivån är 1–3/);
  await assert.rejects(edit({ level: 0 }), /Nivån är 1–3/);
  doc = await act(doc, { action: "save_role", revision: doc.program!.revision, role: { name: "Projektledare", description: "", duties: "", isEre: false, capabilities: ["plan"] } });
  assert.equal(doc.program!.roles.find((role) => role.name === "Projektledare")!.level, 1, "a new role starts at level 1");
  doc = await act(doc, { action: "save_role", revision: doc.program!.revision, role: { name: "Arbetsledare", description: "", duties: "", isEre: false, capabilities: ["plan"], level: 2 } });
  assert.equal(doc.program!.roles.find((role) => role.name === "Arbetsledare")!.level, 2);
  // The person's level is the highest among the roles, in the document and in the overview.
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: installer.id, personId: member.id });
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: doc.program!.roles.find((role) => role.key === "trainee")!.id, personId: member.id });
  assert.equal(peopleOverview({ roles: doc.program!.roles, people: [] }).find((person) => person.personId === member.id)!.level, 3);
  assert.equal(levelOf(documentLevels(doc), member.id).level, 3);
  // Fastställ freezes the level; an older version without levels still opens.
  const frozen = programContent(doc.program!);
  assert.equal(frozen.roles.find((role) => role.name === "Montör")!.level, 3);
  const approved = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "Första versionen." });
  const version = approved.versions[0];
  assert.equal(contentSchema.parse(version.content).roles.find((role) => role.name === "Montör")!.level, 3);
  const older = { ...version.content, roles: version.content.roles.map((role) => { const copy: Record<string, unknown> = { ...role }; delete copy.level; return copy; }) };
  assert.equal(contentSchema.parse(older).roles.every((role) => role.level === undefined), true, "a version approved before levels opens without them");
  assert.equal(peopleOverview({ roles: contentSchema.parse(older).roles, people: [] })[0]?.level ?? 0, 0);
  // A new level is a change to approve.
  assert.notEqual(await changeFingerprint(frozen), await changeFingerprint({ ...frozen, roles: frozen.roles.map((role) => role.name === "Montör" ? { ...role, level: 1 } : role) }));
});

test("risk classes are set by admins, one per task type; null goes back to Workflow's proposal", async () => {
  let doc = emptySelfInspectionDocument();
  await rejects(act(doc, { action: "set_risk_class", key: "form:f-1", riskClass: 3 }, member), 403);
  assert.throws(() => selfInspectionActionSchema.parse({ action: "set_risk_class", key: "somewhere", riskClass: 2 }), /Okänd uppgiftstyp/);
  assert.throws(() => selfInspectionActionSchema.parse({ action: "set_risk_class", key: "form:f-1", riskClass: 4 }), /Krävd nivå är 1–3/);
  assert.throws(() => selfInspectionActionSchema.parse({ action: "set_risk_class", key: "form:f-1", riskClass: 0 }), /Krävd nivå är 1–3/);
  doc = await act(doc, { action: "set_risk_class", key: "form:f-1", riskClass: 3 });
  doc = await act(doc, { action: "set_risk_class", key: WORK_ORDER_RISK_KEY, riskClass: 2 });
  assert.deepEqual(doc.riskClasses, { "form:f-1": 3, [WORK_ORDER_RISK_KEY]: 2 });
  doc = await act(doc, { action: "set_risk_class", key: "form:f-1", riskClass: null });
  assert.deepEqual(doc.riskClasses, { [WORK_ORDER_RISK_KEY]: 2 });
  // Everyone reads the classes and the levels; the view carries them.
  const view = await selfInspectionView(doc, { me: member, admin: false, company: "Bolaget", people });
  assert.deepEqual(view.levels.riskClasses, { [WORK_ORDER_RISK_KEY]: 2 });
  assert.equal(view.levels.enforced, false);
  // Older files open without any.
  assert.deepEqual(selfInspectionDocumentSchema.parse({ program: null }).riskClasses, {});
});

test("the page's pre-check and the route are the same rule: levelsView carries what the rule needs", () => {
  const directory = company();
  const view = levelsView(directory, "u-anna", { "kind:WORK_ORDER": 2 });
  assert.equal(view.me.level, 1);
  assert.equal(view.me.supervised, true);
  assert.deepEqual(directoryOfView(view), { enforced: true, people: directory.people });
  assert.equal(levelsView(directory, "nobody", {}).me.level, 0);
});

// ---------- the server: the routes ask the rule, inside the company ----------

test("every route that assigns, starts, fills in, completes or signs asks the level rule", () => {
  const tasks = readFileSync("app/api/workflow-tasks/route.ts", "utf8");
  assert.match(tasks, /await requireSavedTaskLevels\(ctx\.organizationId, ctx\.user, \{ task, formTemplateId: form\.formTemplateId, documented: workflowTaskHasDocumentation\(task\) \}\)/, "save: assign, fill in, sign, complete");
  assert.match(tasks, /if \(input\.command === "START"\) await requireTaskLevel\(ctx\.organizationId, task, ctx\.user, "start"\)/, "start; pausing one's own time stays free");
  assert.match(tasks, /await requireTaskLevel\(ctx\.organizationId, task, ctx\.user, "reopen"\)/);
  const save = tasks.indexOf("requireSavedTaskLevels(ctx.organizationId");
  assert.ok(save > tasks.indexOf("await verifyReferences(") && save < tasks.indexOf("workflowTaskCompletion(task)"), "asked before the completion requirements, so the person learns about the level first");
  assert.match(readFileSync("app/api/workflow-task-files/route.ts", "utf8"), /requireTaskLevel\(ctx\.organizationId, task, ctx\.user, "fill"\)/, "an attachment is filling in");
  assert.match(readFileSync("app/api/workflow-task-files/[id]/route.ts", "utf8"), /requireTaskLevelById\(ctx\.organizationId, file\.taskId, ctx\.user, "fill"\)/);
  assert.match(readFileSync("app/api/projects/route.ts", "utf8"), /requireAssignLevels\(ctx\.organizationId, task, \[\{ id: values\.assignedToUserId/, "the project's responsible taking over a task");
  assert.match(readFileSync("app/api/planned-activities/route.ts", "utf8"), /requireAssignLevels\(ctx\.organizationId, workflowTask, [\s\S]*\{ responsibleId: workflowTask\.assignedToUserId \}/, "a person planned on a task; supervision applies");
  assert.match(readFileSync("app/api/form-schedules/route.ts", "utf8"), /requireAssignLevels\(ctx\.organizationId, \{ kind: "FORM", formTemplateId: schedule\.templateId \}/, "the person a round is given to");
});

test("API v1, MCP and the AI tools run the same routes, so they get the same barrier", () => {
  const registry = readFileSync("lib/tools/registry.ts", "utf8");
  assert.match(registry, /callRoute\(tasksRoute\.POST, "POST", "\/api\/workflow-tasks"/, "tasks are written through the app's own route");
  assert.doesNotMatch(registry, /prisma\.workflowTask\.(create|update)/, "no tool writes a task on its own");
  for (const file of ["lib/api-handlers/v1-tool.ts", "lib/api-handlers/mcp.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /workflowTask\.(create|update)/, file);
});

test("the server reads levels and classes inside the company and never trusts the client's class", () => {
  const server = readFileSync("lib/self-inspection/levels-server.ts", "utf8");
  for (const call of server.matchAll(/\.(selfInspectionRoleMember|selfInspectionCompetence|taskRiskClass|workflowTask)\.(findMany|findFirst|findUnique)\(\{ where: \{([^}]*)/g))
    assert.match(call[3], /organizationId/, `${call[1]}.${call[2]} is scoped to the company`);
  assert.match(server, /formTemplate\.findFirst\(\{ where: \{ id: templateId, \.\.\.visibleFormsWhere\(organizationId\) \}/, "a form is read only when it is Workflow's or the company's own");
  assert.match(server, /if \(!directory\.enforced\) return;/, "a company without roles is untouched");
  assert.match(server, /throw new ApiError\(403, decision\.message\)/);
  const actions = readFileSync("lib/self-inspection/server.ts", "utf8");
  assert.match(actions, /riskClassKeyExists\(organizationId, input\.key, tx\)/, "only a task type the company can see gets a class");
  assert.match(actions, /action: "risk_class_set"/, "a changed class is logged");
  assert.match(actions, /action: "role_level_changed"/, "a changed level is logged");
});

test("the migration is additive, keeps the company's data apart and proposes levels for the template's roles", () => {
  const migration = readFileSync("prisma/migrations/20261008100000_roles_levels_risk_classes/migration.sql", "utf8");
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "level" INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "TaskRiskClass"/);
  assert.match(migration, /"organizationId" TEXT NOT NULL/);
  assert.match(migration, /"TaskRiskClass_organizationId_key_key"/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /CHECK \("level" BETWEEN 1 AND 3\)/);
  assert.match(migration, /CHECK \("riskClass" BETWEEN 1 AND 3\)/);
  for (const [key, level] of [["ere", 3], ["inspector", 3], ["planner", 2], ["installer", 2]] as const) assert.match(migration, new RegExp(`WHEN '${key}' THEN ${level}`));
});

test("Local keeps the levels and classes in the file; older files open without them", () => {
  const parsed = selfInspectionDocumentSchema.parse({ program: { id: "p", title: "P", templateVersion: "1", activityTypes: [], worksOnOthersInstallations: true, registrationCheckedAt: null, revision: 1, sections: [],
    roles: [{ id: "r", key: "installer", name: "Montör", description: "", duties: "", isEre: false, capabilities: ["perform"], sortOrder: 0, members: [] }], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } });
  assert.equal(parsed.program!.roles[0].level, 1, "a role in an older file starts at level 1");
  assert.deepEqual(parsed.riskClasses, {});
  const source = readFileSync("features/kfid/local-workspace-store.ts", "utf8");
  assert.match(source, /selfInspection: selfInspectionDocumentSchema\.default\(emptySelfInspectionDocument\)/);
});
