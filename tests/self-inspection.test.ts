import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applySelfInspectionAction, type DocumentActor } from "../lib/self-inspection/document";
import {
  addMonths, changeFingerprint, CHECK_DISCLAIMER, CHECK_KINDS, contentHash, documentReminders, emptySelfInspectionDocument, peopleOverview, programChecks, programContent, programWarnings, PROGRAM_REQUIREMENTS,
  referencedParagraphs, requirementCoverage, reviewState, selfInspectionAccess, selfInspectionActionSchema, selfInspectionDocumentSchema, selfInspectionView,
  SelfInspectionError, type SelfInspectionAction, type SelfInspectionDocument,
} from "../lib/self-inspection/model";
import { COMPETENCE_HIDDEN_TEXT, limitationsOf, mayDo, orgChart, programOutline } from "../lib/self-inspection/outline";
import { parseProgramText } from "../lib/self-inspection/text";
import { programFromTemplate, TEMPLATE_ROLES, TEMPLATE_SECTIONS } from "../lib/self-inspection/template";
import { createSelfInspectionPdf } from "../lib/self-inspection/report";
import { drawingText, pdfDrawing } from "./helpers/pdf-drawing";
import { createLocalWorkspace, parseLocalWorkspace } from "../features/kfid/local-workspace-store";
import { MENU_HIDEABLE } from "../lib/workflow/menu-items";
import { SEARCH_COMMANDS } from "../lib/search/commands";
import { TOOL_CATALOG } from "../lib/tools/catalog";

// Egenkontrollprogram, etapp 1 (2026-10-06): the shared rules Cloud, Local and the demo use.
const admin: DocumentActor = { id: "u-admin", name: "Ada Admin", admin: true };
const member: DocumentActor = { id: "u-member", name: "Mats Montör", admin: false };
const people = [{ id: admin.id, name: admin.name }, { id: member.id, name: member.name }];
let sequence = 0;
const newId = () => `id-${++sequence}`;
const act = (doc: SelfInspectionDocument, action: SelfInspectionAction, actor = admin, now = new Date("2026-01-10T10:00:00Z")) =>
  applySelfInspectionAction(doc, action, actor, { now, newId, people });
async function rejects(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof SelfInspectionError && error.status === status);
}
async function created() { return act(emptySelfInspectionDocument(), { action: "create_program" }); }
const role = (doc: SelfInspectionDocument, key: string) => doc.program!.roles.find((item) => item.key === key)!;

test("the template is the product owner's programme as version 1: his ten sections in his order, generalised, without personal data", () => {
  // 2026-10-08 (next-wave 6): sections 1–10 as his programme has them; the keys the linked data blocks need are kept.
  assert.deepEqual(TEMPLATE_SECTIONS.map((section) => section.key), ["intro", "business", "competence", "ere", "organization", "planning", "requirements", "inspection", "followup", "appendices"]);
  assert.deepEqual(TEMPLATE_SECTIONS.map((section) => section.title), [
    "Inledning", "Elinstallationsverksamheten", "Kompetenskrav och tillgången till kompetens", "Elinstallatör för regelefterlevnad registrerad hos Elsäkerhetsverket", "Organisationsschema (roller)",
    "Planering av elinstallationsarbete", "Kravbestämning", "Kontroll av elinstallationsarbete", "Uppföljning av egenkontrollprogram", "Bilagor",
  ]);
  const text = (key: string) => TEMPLATE_SECTIONS.find((section) => section.key === key)!.body;
  assert.match(text("intro"), /24 § elsäkerhetslagen/);
  for (const heading of ["## 2.1 Kontaktpersoner", "## 2.2 Verksamhetens adress och organisationsuppgifter", "## 2.3 Verksamhetstyper registrerade hos Elsäkerhetsverket"]) assert.ok(text("business").includes(heading), heading);
  assert.match(text("competence"), /## 3\.1 Upprätthållande och utveckling av kompetens/);
  assert.match(text("competence"), /repeteras vart tredje år/, "repetition every third year, documented on the competence card");
  assert.match(text("competence"), /dokumenteras med datum på medarbetarnas kompetenskort/);
  assert.match(text("organization"), /## 5\.1 Organisation för egenkontrollprogram och elinstallationsarbete[\s\S]*## 5\.2 Personer med ansvar i egenkontrollprogrammet/);
  for (const heading of ["## 6.1 Uppdrag", "## 6.2 Elsäkerhet vid arbete på driftsatta anläggningar", "## 6.3 Metod", "## 6.4 Metod för elinstallationsarbete i nyproduktion", "## 6.5 Montör med kontrolluppgift"]) assert.ok(text("planning").includes(heading), heading);
  assert.deepEqual(text("planning").match(/^\d\. /gm), ["1. ", "2. ", "3. ", "4. ", "5. ", "6. ", "7. ", "8. "], "the eight-step method");
  assert.match(text("planning"), /Innan en person tilldelas arbete kontrolleras/, "a check of authorisation and competence before an assignment (3 kap. 9 §)");
  for (const heading of ["## 7.1 Allmänt", "## 7.2 Nyutförande, ombyggnad och utvidgning", "## 7.3 Underhållsarbeten"]) assert.ok(text("requirements").includes(heading), heading);
  assert.match(text("requirements"), /görs kravbestämningen om/, "requirements are decided again when conditions change");
  for (const heading of ["## 8.1 Kontroll av eget arbete", "## 8.2 Kontroll efter utförande (kontroll före idrifttagning)", "## 8.3 Uppföljning"]) assert.ok(text("inspection").includes(heading), heading);
  assert.match(text("inspection"), /dokumenteras alltid/, "checkpoints are always documented (beslut 6)");
  for (const heading of ["## 9.1 Avvikelserapportering", "## 9.2 Registrering hos Elsäkerhetsverket", "## 9.3 Handlingsplan"]) assert.ok(text("followup").includes(heading), heading);
  assert.match(text("followup"), /omedelbar åtgärd eller rutinöversyn/);
  assert.match(text("followup"), /en gång årligen/);
  assert.match(text("appendices"), /## Allmänt för alla roller/);
  assert.equal(text("appendices").split("\n").filter((line) => line.startsWith("- ")).length, 7, "the seven points shared by every role");
  // The roles of his organisation chart, on the keys the levels and the chart rely on.
  assert.deepEqual(TEMPLATE_ROLES.map((role) => [role.key, role.name]), [
    ["ere", "Elinstallatör för regelefterlevnad"], ["program_admin", "Administratör för egenkontrollprogrammet"], ["manager", "VD"], ["planner", "Projektör"],
    ["installer", "Montör"], ["inspector", "Montör med kontrolluppgift"], ["hired", "Inhyrd personal"], ["trainee", "Under utbildning"],
  ]);
  for (const item of TEMPLATE_ROLES) assert.ok(item.description.trim() && item.duties.trim(), `${item.name} has a description and duties`);
  for (const key of ["planner", "program_admin", "installer"]) assert.ok(/^## /m.test(TEMPLATE_ROLES.find((role) => role.key === key)!.duties), `${key}: duties in headed groups, as his role descriptions`);
  assert.equal(new Set(TEMPLATE_ROLES.map((item) => item.name)).size, TEMPLATE_ROLES.length, "one name per role");
  assert.equal(TEMPLATE_ROLES.filter((item) => item.isEre).length, 1);
  const all = JSON.stringify([TEMPLATE_SECTIONS, TEMPLATE_ROLES]);
  // Standards only by designation (the copyright precaution); no contact details, no publisher's or organisation's document names.
  assert.doesNotMatch(all, /@|\+46|\b0\d{1,3}[- ]\d{5,}|Workflow Power|EBR|Skötsel av elektriska|Elinstallationsreglerna/i, "no contact details or third-party document names");
  assert.match(all, /SS-EN 50110-1/);
  // The product owner's own programme is the source; none of his personal data, his company's facts or his address may be in the template.
  for (const name of ["Dan" + "iel", "Einar" + "sson", "Power Solutions", "Holsby" + "brunn", "Haga" + "gatan", "5595" + "02", "hintek.se"]) assert.ok(!all.includes(name), `no personal data: ${name}`);
  assert.doesNotMatch(all, /\b\d{6}-\d{4}\b|\b\d{8}-\d{4}\b/, "no organisation or authorisation number");
});

test("a company copies the template; only admins change it and a stale revision is refused", async () => {
  const doc = await created();
  assert.equal(doc.program!.sections.length, TEMPLATE_SECTIONS.length);
  assert.equal(doc.program!.roles.length, TEMPLATE_ROLES.length);
  assert.ok(doc.program!.roles.every((item) => item.members.length === 0), "nobody assigned");
  await rejects(act(doc, { action: "create_program" }), 409);
  await rejects(act(doc, { action: "save_role", revision: 1, role: { name: "X", description: "", duties: "", isEre: false, capabilities: [] } }, member), 403);
  await rejects(act(doc, { action: "approve", revision: 1, changeReason: "Första" }, member), 403);
  await rejects(act(doc, { action: "save_role", revision: 7, role: { name: "X", description: "", duties: "", isEre: false, capabilities: [] } }), 409);
  const saved = await act(doc, { action: "save_role", revision: 1, role: { name: "Projektledare", description: "Leder", duties: "", isEre: false, capabilities: ["plan"] } });
  assert.equal(saved.program!.revision, 2);
  await rejects(act(saved, { action: "save_role", revision: 2, role: { name: "projektledare", description: "", duties: "", isEre: false, capabilities: [] } }), 409);
});

test("approving freezes a version with a hash; unchanged drafts are not approved again; old versions stay as they were", async () => {
  let doc = await created();
  doc = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "Första versionen." });
  assert.equal(doc.versions.length, 1);
  const first = doc.versions[0];
  assert.equal(first.number, 1);
  assert.equal(first.hash, await contentHash(programContent(doc.program!)));
  await rejects(act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "Igen" }), 409);
  const sections = doc.program!.sections.map(({ id, title, body, legalRef }) => ({ id, title, body, legalRef }));
  doc = await act(doc, { action: "save_program", revision: doc.program!.revision, title: "Vårt program", activityTypes: ["LV_HOMES"], worksOnOthersInstallations: false, registrationCheckedAt: "2026-01-02",
    sections: [...sections.slice(1), { title: "Eget avsnitt", body: "Text", legalRef: "" }] });
  doc = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "Namn och verksamhet." });
  assert.deepEqual(doc.versions.map((version) => version.number), [1, 2]);
  assert.deepEqual(doc.versions[0], first, "version 1 is untouched");
  assert.equal(doc.versions[1].content.title, "Vårt program");
  assert.equal(doc.versions[1].content.sections.at(-1)!.title, "Eget avsnitt");
  assert.equal(doc.versions[1].content.sections.length, sections.length);
});

test("roles: people are members of the company (Cloud) or named in the file (Local); numbers never enter a version", async () => {
  let doc = await created();
  const ere = role(doc, "ere");
  await rejects(act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: ere.id, personId: "stranger" }), 400);
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: ere.id, personId: admin.id, authorizationLevel: "AL", authorizationNumber: "12345", registered: true });
  assert.deepEqual(role(doc, "ere").members[0], { personId: admin.id, name: admin.name, authorizationLevel: "AL", authorizationNumber: "12345", registered: true });
  // Registered is only for an ERE.
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: role(doc, "installer").id, personId: member.id, registered: true });
  assert.equal(role(doc, "installer").members[0].registered, false);
  const named = await applySelfInspectionAction(doc, { action: "assign_role", revision: doc.program!.revision, roleId: role(doc, "hired").id, name: "Inhyrd Ingrid" }, admin, { newId, people, namedPeople: true });
  assert.equal(role(named, "hired").members[0].name, "Inhyrd Ingrid");
  assert.doesNotMatch(JSON.stringify(programContent(doc.program!)), /12345/, "no authorisation number in a version");
  // Taking the ERE flag away takes away who stands in the registration.
  const plain = await act(doc, { action: "save_role", revision: doc.program!.revision, role: { id: ere.id, name: ere.name, description: ere.description, duties: ere.duties, isEre: false, capabilities: [] } });
  assert.equal(role(plain, "ere").members[0].registered, false);
  doc = await act(doc, { action: "unassign_role", revision: doc.program!.revision, roleId: ere.id, personId: admin.id });
  assert.equal(role(doc, "ere").members.length, 0);
});

test("warnings advise but never block (beslut 2)", async () => {
  const program = programFromTemplate({ id: "p", now: "2026-01-01T00:00:00Z", newId });
  const warnings = programWarnings(program, "2026-06-01");
  assert.ok(warnings.some((item) => /verksamhetstyper/.test(item)));
  assert.ok(warnings.some((item) => /regelefterlevnad är utsedd/.test(item)));
  assert.ok(warnings.some((item) => /platshållare/.test(item)));
  const ere = { ...program.roles.find((item) => item.isEre)!, members: [{ personId: "a", name: "A", authorizationLevel: "B" as const, authorizationNumber: "", registered: true }] };
  const high = { ...program, activityTypes: ["HV_GRID" as const], roles: [ere], registrationCheckedAt: "2026-05-01" };
  assert.ok(programWarnings(high, "2026-06-01").some((item) => /Högspänning: .*auktorisation A/.test(item)));
  const cable = { ...program, activityTypes: ["CABLE_LAYING" as const], roles: program.roles.filter((item) => !item.isEre) };
  assert.ok(!programWarnings(cable, "2026-06-01").some((item) => /regelefterlevnad är utsedd/.test(item)), "cable laying alone needs no ERE");
  // A programme full of warnings is still approved.
  let doc = await created();
  doc = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "Trots varningar." });
  assert.equal(doc.versions.length, 1);
});

test("read confirmations: one per person and version, only for the current version", async () => {
  let doc = await created();
  doc = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "1" });
  await rejects(act(doc, { action: "confirm_read", versionNumber: 2 }, member), 409);
  doc = await act(doc, { action: "confirm_read", versionNumber: 1 }, member);
  assert.equal(await act(doc, { action: "confirm_read", versionNumber: 1 }, member), doc, "confirming twice changes nothing");
  assert.equal(doc.confirmations.length, 1);
  const view = await selfInspectionView(doc, { me: { id: member.id, name: member.name }, admin: false, company: "Bolaget", people }, "2026-02-01");
  assert.ok(view.myConfirmation);
  assert.equal(view.program, null, "a member never sees the draft");
  assert.deepEqual(view.versions, [], "nor the version history");
  assert.equal(view.confirmations, null);
  assert.equal(view.current!.number, 1);
});

test("deviations: anyone reports, admins plan; a member sees what they reported or own", async () => {
  let doc = await created();
  doc = await act(doc, { action: "save_deviation", deviation: { title: "Saknad märkning", description: "I central A", category: "IMMEDIATE", status: "DONE", action: "Fixat", responsibleId: admin.id, dueDate: "2026-01-01" } }, member);
  const report = doc.deviations[0];
  assert.equal(report.number, 1);
  assert.equal(report.category, "IMMEDIATE");
  assert.deepEqual([report.status, report.action, report.responsibleId, report.dueDate], ["OPEN", "", null, ""], "a member's report starts open without a plan");
  await rejects(act(doc, { action: "save_deviation", deviation: { id: report.id, title: "Ändrad" } }, member), 403);
  await rejects(act(doc, { action: "save_deviation", deviation: { kind: "IMPROVEMENT", title: "Förbättring" } }, member), 403);
  doc = await act(doc, { action: "save_deviation", deviation: { id: report.id, title: report.title, category: "IMMEDIATE", status: "IN_PROGRESS", action: "Märk upp", responsibleId: member.id, dueDate: "2026-01-12", systematic: true } });
  doc = await act(doc, { action: "save_deviation", deviation: { kind: "IMPROVEMENT", title: "Checklista för centralbyten", responsibleId: admin.id } });
  assert.deepEqual(doc.deviations.map((item) => item.number), [1, 2]);
  await rejects(act(doc, { action: "save_deviation", deviation: { title: "X", responsibleId: "stranger" } }), 400);
  const memberView = await selfInspectionView(doc, { me: { id: member.id, name: member.name }, admin: false, company: "B", people }, "2026-01-10");
  assert.deepEqual(memberView.deviations.map((item) => item.number), [1]);
  // Done gets a closing time once.
  doc = await act(doc, { action: "save_deviation", deviation: { id: report.id, title: report.title, status: "DONE" } });
  assert.ok(doc.deviations[0].closedAt);
});

test("yearly review: due a year after the latest review or the first version, reminded 30 days ahead", async () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-02-29", 12), "2029-02-28");
  let doc = await created();
  assert.equal(reviewState(doc, "2026-03-01").status, "NONE");
  doc = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "1" }, admin, new Date("2026-01-10T10:00:00Z"));
  assert.deepEqual(reviewState(doc, "2026-06-01"), { lastReviewedAt: null, nextDue: "2027-01-10", status: "OK" });
  assert.equal(reviewState(doc, "2026-12-15").status, "DUE_SOON");
  assert.equal(reviewState(doc, "2027-01-11").status, "OVERDUE");
  await rejects(act(doc, { action: "add_review", review: { reviewedAt: "2026-12-20", registrationChecked: true, deviationsReviewed: true, competenceFollowed: true, outcome: "NO_CHANGES", notes: "" } }, member), 403);
  doc = await act(doc, { action: "add_review", review: { reviewedAt: "2026-12-20", registrationChecked: true, deviationsReviewed: true, competenceFollowed: true, outcome: "NO_CHANGES", notes: "Inga ändringar" } });
  assert.equal(doc.reviews[0].versionNumber, 1);
  assert.deepEqual(reviewState(doc, "2027-01-11"), { lastReviewedAt: "2026-12-20", nextDue: "2027-12-20", status: "OK" });
});

test("the bell: the admin is reminded of the review, everyone of an unread version and their actions due", async () => {
  let doc = await created();
  doc = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "1" }, admin, new Date("2026-01-10T10:00:00Z"));
  doc = await act(doc, { action: "save_deviation", deviation: { title: "Åtgärd", responsibleId: member.id, dueDate: "2026-12-18", status: "OPEN" } });
  const forAdmin = documentReminders(doc, { me: { id: admin.id, name: admin.name }, admin: true }, "2026-12-15");
  assert.ok(forAdmin.some((item) => item.id === "self-inspection:review" && item.deadline === "DUE_SOON" && item.kind === "SELF_INSPECTION"));
  assert.ok(forAdmin.some((item) => item.id === "self-inspection:read:1" && item.needsAction));
  assert.ok(!forAdmin.some((item) => item.id.startsWith("self-inspection:deviation")), "another person's action that is not late is theirs");
  const forMember = documentReminders(doc, { me: { id: member.id, name: member.name }, admin: false }, "2026-12-15");
  assert.ok(!forMember.some((item) => item.id === "self-inspection:review"), "members get no review reminder");
  // TE7 and TE13 (användartest 2026-10-31): an entry someone else made mine is Tilldelad dig, once, with its real type in the title.
  const assigned = forMember.filter((item) => item.id.startsWith("self-inspection:assigned"));
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].label, "Tilldelad dig");
  assert.equal(assigned[0].dueDate, "2026-12-18");
  assert.ok(assigned[0].title.startsWith("Elinstallation "), assigned[0].title);
  assert.ok(!forMember.some((item) => item.id.startsWith("self-inspection:deviation")), "no Snart förfallande beside it");
  // Started: no longer new, so its date reminds as before.
  const started = { ...doc, deviations: doc.deviations.map((item) => ({ ...item, status: "IN_PROGRESS" as const })) };
  const startedBell = documentReminders(started, { me: { id: member.id, name: member.name }, admin: false }, "2026-12-15");
  assert.ok(startedBell.some((item) => item.id.startsWith("self-inspection:deviation") && item.deadline === "DUE_SOON" && item.label === "Avvikelse"));
  assert.ok(!startedBell.some((item) => item.id.startsWith("self-inspection:assigned")));
  // TE7: a new entry of the grade Hög or Akut, nobody responsible, reported by someone else, for those who can take it.
  const severe = (severity: "NORMAL" | "HIGH" | "ACUTE") => ({ ...doc, deviations: doc.deviations.map((item) => ({ ...item, severity, responsibleId: null, reportedById: member.id })) });
  const severeFor = (who: typeof admin, severity: "NORMAL" | "HIGH" | "ACUTE", isAdmin: boolean) => documentReminders(severe(severity), { me: { id: who.id, name: who.name }, admin: isAdmin }, "2026-12-15").filter((item) => item.id.startsWith("self-inspection:severe"));
  assert.equal(severeFor(admin, "HIGH", true).length, 1);
  assert.equal(severeFor(admin, "HIGH", true)[0].needsAction, true);
  assert.equal(severeFor(admin, "ACUTE", true).length, 1);
  assert.equal(severeFor(admin, "NORMAL", true).length, 0, "Normal gives no notice of its own");
  assert.equal(severeFor(member, "HIGH", false).length, 0, "not to the one who reported it, nor to someone without the right");
  // Kräver åtgärd (beslut 4, 2026-11-01): the grade stands until the entry is done, also when someone is responsible for it.
  const bo = { id: "bo-id", name: "Bo" };
  const graded = (changes: Partial<(typeof doc)["deviations"][number]> = {}) => ({ ...doc, deviations: doc.deviations.map((item) => ({ ...item, severity: "HIGH" as const, reportedById: member.id, responsibleId: bo.id, dueDate: "2026-12-18", ...changes })) });
  const rows = (document: ReturnType<typeof graded>, viewer: { id: string; name: string }, rights: { admin: boolean; team?: boolean }) => documentReminders(document, { me: viewer, ...rights }, "2026-12-15").filter((item) => /^self-inspection:(severe|assigned|deviation):/.test(item.id));
  const forResponsible = rows(graded(), bo, { admin: false });
  assert.deepEqual(forResponsible.map((item) => item.id.split(":")[1]), ["severe"], "one row for the responsible person: no Tilldelad dig or date reminder beside it");
  assert.equal(forResponsible[0].label, "Tilldelad dig");
  assert.equal(forResponsible[0].audience, "mine", "theirs, also without the Teamet right");
  assert.equal(forResponsible[0].dueDate, "", "a changed date is not a new notice");
  assert.match(forResponsible[0].detail ?? "", /Klart senast 2026-12-18\.$/);
  const forOverseer = rows(graded(), admin, { admin: true, team: true });
  assert.deepEqual(forOverseer.map((item) => [item.id.split(":")[1], item.audience, item.label]), [["severe", "team", "Avvikelse"]]);
  assert.equal(rows(graded({ status: "IN_PROGRESS" }), bo, { admin: false }).filter((item) => item.id.includes(":severe:")).length, 1, "started is not done");
  assert.equal(rows(graded({ status: "DONE" }), admin, { admin: true, team: true }).length, 0, "done");
  assert.equal(rows(graded({ severity: "NORMAL" }), admin, { admin: true, team: true }).some((item) => item.id.includes(":severe:")), false);
  assert.equal(rows(graded(), member, { admin: false }).length, 0, "the one who reported it, without the right, has done their part");
  assert.equal(rows(graded(), { id: "another", name: "Någon" }, { admin: false, team: true }).length, 0, "the Teamet right does not read someone else's Elinstallation entry");
  assert.equal(rows(graded({ type: "NEAR_MISS" }), { id: "another", name: "Någon" }, { admin: false, team: true }).length, 1, "but it does read a near miss");
  const ownReport = rows(graded({ reportedById: admin.id, responsibleId: null }), admin, { admin: true, team: true });
  assert.deepEqual(ownReport.map((item) => [item.id.split(":")[1], item.selfReported]), [["severe", true]], "an admin who reported it sees it, and is not mailed about it");
  assert.equal(rows(graded({ reportedById: admin.id, responsibleId: null }), admin, { admin: true }).some((item) => item.id.includes(":severe:")), false, "Local has one user, who is not told what they reported");
  const confirmed = await act(doc, { action: "confirm_read", versionNumber: 1 }, member);
  assert.ok(!documentReminders(confirmed, { me: { id: member.id, name: member.name }, admin: false }, "2026-12-15").some((item) => item.id.startsWith("self-inspection:read")));
  assert.ok(documentReminders(doc, { me: { id: admin.id, name: admin.name }, admin: true }, "2027-01-20").some((item) => item.id.startsWith("self-inspection:deviation") && item.deadline === "OVERDUE"), "a late action reaches the admin");
});

test("the permission area: every active member reads, confirms and reports; admins edit and approve", () => {
  assert.deepEqual(selfInspectionAccess({ active: true, admin: false }), { read: true, confirm: true, reportDeviation: true, edit: false, approve: false });
  assert.deepEqual(selfInspectionAccess({ active: true, admin: true }), { read: true, confirm: true, reportDeviation: true, edit: true, approve: true });
  assert.deepEqual(selfInspectionAccess({ active: false, admin: true }), { read: false, confirm: false, reportDeviation: false, edit: false, approve: false });
  assert.equal(selfInspectionActionSchema.safeParse({ action: "delete_version", versionNumber: 1 }).success, false, "there is no way to delete a version");
});

test("Local keeps the programme in the file; older files open with an empty one", () => {
  const fresh = createLocalWorkspace({ id: "org-1", name: "Bolaget" });
  assert.deepEqual(fresh.selfInspection, emptySelfInspectionDocument());
  const older = JSON.parse(JSON.stringify(fresh));
  delete older.selfInspection;
  assert.deepEqual(parseLocalWorkspace(older, "org-1").selfInspection, emptySelfInspectionDocument());
});

test("the menu, Sök and the API know the module", () => {
  assert.ok((MENU_HIDEABLE as readonly string[]).includes("self_inspection"));
  assert.ok(SEARCH_COMMANDS.some((command) => command.href === "/?view=self_inspection"));
  assert.equal(TOOL_CATALOG.get_self_inspection_program.effect, "read");
});

test("the approved version prints with the report kit", async () => {
  let doc = await created();
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: role(doc, "ere").id, personId: admin.id, authorizationLevel: "A", authorizationNumber: "99999", registered: true });
  doc = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "Första versionen." });
  const view = await selfInspectionView(doc, { me: { id: admin.id, name: admin.name }, admin: true, company: "Bolaget AB", people });
  const bytes = await createSelfInspectionPdf({ identity: { company: "Bolaget AB" }, fontBytes: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")), version: view.current! });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  assert.ok(bytes.length > 5_000);
  // No "Företag" box: the name stands in the heading (PDF review 2026-11-03, finding 11).
  const text = drawingText(await pdfDrawing(bytes)).join(" ");
  assert.match(text, /Bolaget AB/);
  assert.match(text, /Fastställd/);
  assert.doesNotMatch(text, /Företag\s+Bolaget AB/, "no box with the label and the name");
});

// ---------- the document view (2026-10-06) ----------

test("the running text reads as headings, paragraphs, lists and tables", () => {
  const blocks = parseProgramText("## Rutin\nFörsta stycket.\n- a\n- b\n\n1. ett\n2. två\n| Roll | Vem |\n|---|---|\n| Montör | A |\n| Planerare |\nSista.");
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "paragraph", "list", "list", "table", "paragraph"]);
  assert.deepEqual(blocks[2], { type: "list", ordered: false, items: ["a", "b"] });
  assert.deepEqual(blocks[3], { type: "list", ordered: true, items: ["ett", "två"] });
  assert.deepEqual(blocks[4], { type: "table", header: ["Roll", "Vem"], rows: [["Montör", "A"], ["Planerare", ""]] }, "the separator is skipped and short rows are padded");
  // Every template text parses into something readable.
  for (const section of TEMPLATE_SECTIONS) assert.ok(parseProgramText(section.body).length > 0, section.key);
});

test("competence per person: admins only, people of the company or named in Local, kept in the draft", async () => {
  let doc = await created();
  const revision = () => doc.program!.revision;
  await rejects(act(doc, { action: "save_competence", revision: revision(), competence: { personId: member.id, assessment: "X" } }, member), 403);
  await rejects(act(doc, { action: "save_competence", revision: revision(), competence: { personId: "stranger", assessment: "X" } }), 400);
  await rejects(act(doc, { action: "save_competence", revision: 99, competence: { personId: member.id } }), 409);
  doc = await act(doc, { action: "save_competence", revision: revision(), competence: { personId: member.id, workTypes: ["LV_HOMES", "LV_HOMES"], scope: "Service i bostäder", assessment: "Grundutbildning", assessedAt: "2026-01-05", limitations: "Inget nära spänning", supervised: true } });
  assert.deepEqual(doc.program!.people[0], { personId: member.id, name: member.name, workTypes: ["LV_HOMES"], scope: "Service i bostäder", assessment: "Grundutbildning", assessedAt: "2026-01-05", limitations: "Inget nära spänning", supervised: true });
  doc = await act(doc, { action: "save_competence", revision: revision(), competence: { personId: member.id, assessment: "Ändrad" } });
  assert.equal(doc.program!.people.length, 1, "saving again changes the same person");
  const named = await applySelfInspectionAction(doc, { action: "save_competence", revision: revision(), competence: { personId: "x", name: "Inhyrd Ingrid", assessment: "Kort från uthyraren" } }, admin, { newId, people, namedPeople: true });
  assert.equal(named.program!.people.at(-1)!.personId, "named:inhyrd ingrid");
  doc = await act(doc, { action: "remove_competence", revision: revision(), personId: member.id });
  assert.equal(doc.program!.people.length, 0);
  await rejects(act(doc, { action: "remove_competence", revision: revision(), personId: member.id }), 404);
  // An older Local file without the field opens with an empty list.
  const older = JSON.parse(JSON.stringify(doc));
  delete older.program.people;
  assert.deepEqual(selfInspectionDocumentSchema.parse(older).program!.people, []);
});

test("Fastställ freezes the text, the roles, the people and their competence; later register changes never alter it", async () => {
  let doc = await created();
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: role(doc, "installer").id, personId: member.id });
  doc = await act(doc, { action: "save_competence", revision: doc.program!.revision, competence: { personId: member.id, workTypes: ["LV_HOMES"], assessment: "Grundutbildning", limitations: "Inget nära spänning" } });
  doc = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "Första." });
  const first = structuredClone(doc.versions[0]);
  assert.equal(first.content.roles.find((item) => item.key === "installer")!.members[0].name, member.name, "the name is frozen");
  assert.equal(first.content.people![0].assessment, "Grundutbildning");
  assert.equal(first.hash, await contentHash(first.content));
  // The registers change afterwards: competence, roles and the person's name.
  doc = await act(doc, { action: "save_competence", revision: doc.program!.revision, competence: { personId: member.id, assessment: "Ny bedömning" } });
  doc = await act(doc, { action: "unassign_role", revision: doc.program!.revision, roleId: role(doc, "installer").id, personId: member.id });
  const renamed = [{ id: admin.id, name: admin.name }, { id: member.id, name: "Mats Nyttnamn" }];
  const view = await selfInspectionView(doc, { me: { id: admin.id, name: admin.name }, admin: true, company: "B", people: renamed }, "2026-02-01");
  assert.deepEqual(doc.versions[0], first, "the stored version is untouched");
  assert.equal(view.current!.content.people![0].assessment, "Grundutbildning");
  assert.equal(view.current!.content.roles.find((item) => item.key === "installer")!.members[0].name, member.name, "the version shows the name it froze");
  assert.equal(view.program!.changedSinceApproval, true);
  // A new version freezes the new state; the first stays as it was.
  doc = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "Ny bedömning." });
  assert.equal(doc.versions[1].content.people![0].assessment, "Ny bedömning");
  assert.deepEqual(doc.versions[0], first);
});

test("a renamed person or a version from before names were frozen is not a change to approve", async () => {
  let doc = await created();
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: role(doc, "ere").id, personId: admin.id, authorizationLevel: "AL" });
  doc = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "1" });
  // A Cloud version approved before 2026-10-06 kept no names and no people.
  const old = { ...doc.versions[0], content: { ...doc.versions[0].content, roles: doc.versions[0].content.roles.map((item) => ({ ...item, members: item.members.map((entry) => ({ ...entry, name: "" })) })) } };
  assert.equal("people" in programContent(doc.program!), false, "no people key without competence data, so older hashes still match");
  doc = { ...doc, versions: [old] };
  const view = await selfInspectionView(doc, { me: { id: admin.id, name: admin.name }, admin: true, company: "B", people: [{ id: admin.id, name: "Ada Omdöpt" }, { id: member.id, name: member.name }] });
  assert.equal(view.program!.changedSinceApproval, false);
  assert.equal(view.current!.content.roles.find((item) => item.isEre)!.members[0].name, "Ada Omdöpt", "an old version without a frozen name reads today's name");
  await rejects(act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "Igen" }), 409);
  assert.equal(await changeFingerprint(old.content), await changeFingerprint(programContent(doc.program!)));
});

test("a member reads only their own competence assessment, admins everyone's; an approved version keeps the names of people who left or were erased", async () => {
  let doc = await created();
  const third = { id: "u-third", name: "Tea Tredje" };
  const all = [...people, third];
  const step = (action: SelfInspectionAction) => applySelfInspectionAction(doc, action, admin, { now: new Date("2026-01-10T10:00:00Z"), newId, people: all });
  doc = await step({ action: "save_competence", revision: doc.program!.revision, competence: { personId: member.id, assessment: "Min bedömning", limitations: "Mina gränser" } });
  doc = await step({ action: "save_competence", revision: doc.program!.revision, competence: { personId: third.id, assessment: "Hennes bedömning", limitations: "Hennes gränser" } });
  doc = await step({ action: "assign_role", revision: doc.program!.revision, roleId: role(doc, "installer").id, personId: third.id });
  doc = await step({ action: "approve", revision: doc.program!.revision, changeReason: "1" });
  const asMember = await selfInspectionView(doc, { me: { id: member.id, name: member.name }, admin: false, company: "B", people: all });
  // 2026-10-09: the member's view holds only their own row – nothing of the others' work, assessment or limitations.
  assert.deepEqual(asMember.current!.content.people!.map((item) => [item.personId, item.assessment, item.limitations]), [[member.id, "Min bedömning", "Mina gränser"]]);
  assert.ok(!JSON.stringify(asMember).includes("Hennes"), "nothing of another person's assessment anywhere in the member's view");
  assert.equal(asMember.current!.content.peopleShownFor, member.id);
  const overview = peopleOverview(asMember.current!.content);
  assert.equal(overview.find((item) => item.personId === member.id)!.competenceHidden, false);
  assert.equal(limitationsOf(overview.find((item) => item.personId === third.id)!), COMPETENCE_HIDDEN_TEXT, "never read as missing");
  assert.equal(asMember.program, null);
  const asAdmin = await selfInspectionView(doc, { me: { id: admin.id, name: admin.name }, admin: true, company: "B", people: all });
  assert.deepEqual(asAdmin.current!.content.people!.map((item) => item.assessment).sort(), ["Hennes bedömning", "Min bedömning"]);
  assert.equal(asAdmin.current!.content.peopleShownFor, undefined);
  // The person is erased (or left and the card is deleted): the version keeps the name it froze, for traceability.
  const erased = await selfInspectionView(doc, { me: { id: admin.id, name: admin.name }, admin: true, company: "B", people: [...people, { id: third.id, name: "Borttagen användare" }] });
  assert.equal(erased.current!.content.people!.find((item) => item.personId === third.id)!.name, third.name);
  const gone = await selfInspectionView({ ...doc, credentials: [] }, { me: { id: admin.id, name: admin.name }, admin: true, company: "B", people });
  assert.equal(gone.current!.content.people!.find((item) => item.personId === third.id)!.name, third.name, "no longer a member: the frozen name");
  assert.equal(gone.current!.approvedByName, admin.name);
});

test("the field check keeps missing base data, template text and reminders apart and never claims a legal approval", async () => {
  const doc = await created();
  const view = await selfInspectionView(doc, { me: { id: admin.id, name: admin.name }, admin: true, company: "B", people }, "2026-06-01");
  const kinds = (kind: string) => view.program!.checks.filter((check) => check.kind === kind).map((check) => check.text).join("\n");
  assert.match(kinds("MISSING"), /verksamhetstyper/);
  assert.match(kinds("MISSING"), /regelefterlevnad är utsedd/);
  assert.match(kinds("MISSING"), /Ingen ansvarig för programmet/);
  assert.match(kinds("MISSING"), /registreringen/);
  assert.match(kinds("TEMPLATE"), /platshållare/);
  assert.match(kinds("TEMPLATE"), /oförändrade från mallen/);
  assert.doesNotMatch(kinds("MISSING"), /platshållare|mallen/, "template text is not base data");
  assert.ok(view.program!.checks.every((check) => !check.anchor || /^si-/.test(check.anchor)), "every check points into the document");
  // A person who does the work without an assessment is missing base data; with one, the line goes.
  let next = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: role(doc, "installer").id, personId: member.id });
  assert.ok(programChecks(next.program!, "2026-06-01").some((check) => check.kind === "MISSING" && /Kompetensbedömning saknas för Mats Montör/.test(check.text)));
  next = await act(next, { action: "save_competence", revision: next.program!.revision, competence: { personId: member.id, assessment: "Utbildad" } });
  assert.ok(!programChecks(next.program!, "2026-06-01").some((check) => /Kompetensbedömning saknas/.test(check.text)));
  assert.match(CHECK_DISCLAIMER, /ingen juridisk granskning/);
  assert.doesNotMatch(Object.values(CHECK_KINDS).map((item) => item.label).join(" "), /godkänd|uppfyller/i);
});

test("the regulation's minimum contents: references are read, and the template points to every paragraph", () => {
  assert.deepEqual(referencedParagraphs("ELSÄK-FS 2017:3 3 kap. 4 §, 5 kap. 2 §"), [4]);
  assert.deepEqual(referencedParagraphs("ELSÄK-FS 2017:3 3 kap. 10–11 §§; ELSÄK-FS 2022:1 2 kap. 2 §"), [10, 11]);
  assert.deepEqual(referencedParagraphs("Elsäkerhetslagen (2016:732) 23 §; ELSÄK-FS 2017:3 3 kap. 6 §"), [6]);
  assert.deepEqual(referencedParagraphs("ELSÄK-FS 2017:3 3 kap. 8 och 9 §§"), [8, 9]);
  assert.deepEqual(referencedParagraphs("ELSÄK-FS 2022:1 3 kap. 6 §"), [], "another regulation's chapter 3 is not the programme's");
  const coverage = requirementCoverage(TEMPLATE_SECTIONS);
  assert.equal(coverage.length, PROGRAM_REQUIREMENTS.length);
  for (const row of coverage) assert.ok(row.sections.length, `${row.ref} has a section in the template`);
  assert.ok(PROGRAM_REQUIREMENTS.every((row) => row.requirement && row.support && (row.requirement as string) !== row.support), "requirement and support are kept apart");
});

test("the outline places the linked data in its section and falls back to the appendices", () => {
  const outline = programOutline(TEMPLATE_SECTIONS);
  const at = (key: string) => outline.find((entry) => entry.sectionIndex === TEMPLATE_SECTIONS.findIndex((section) => section.key === key))!;
  assert.deepEqual(at("business").blocks, ["facts"]);
  assert.deepEqual(at("ere").blocks, ["ere"]);
  assert.deepEqual(at("organization").blocks, ["orgchart"]);
  assert.deepEqual(at("competence").blocks, ["competence"]);
  assert.deepEqual(outline.slice(-2).map((entry) => [entry.number, entry.title, entry.blocks]), [["A", "Roller och ansvar", []], ["B", "Personer och kompetens", []]]);
  const own = programOutline([{ key: "", title: "Vårt eget" }]);
  assert.deepEqual(own.map((entry) => entry.kind), ["facts", "section", "appendix", "appendix"]);
  assert.deepEqual(own.at(-2)!.blocks, ["orgchart"]);
  assert.deepEqual(own.at(-1)!.blocks, ["competence"]);
  // The chart: management, support, planning, the work.
  assert.deepEqual(orgChart(TEMPLATE_ROLES).map((row) => row.roles.map((item) => item.key)), [["manager"], ["ere", "program_admin"], ["planner"], ["installer", "inspector", "hired", "trainee"]]);
});

test("the PDF follows the document: tables, people and competence, never an authorisation number", async () => {
  let doc = await created();
  const firstId = doc.program!.sections[0].id;
  const sections = doc.program!.sections.map(({ id, title, body, legalRef }) => ({ id, title, body: id === firstId ? `${body}\n| Roll | Vem |\n|---|---|\n| Montör | A |` : body, legalRef }));
  doc = await act(doc, { action: "save_program", revision: doc.program!.revision, title: "Program", activityTypes: ["LV_HOMES"], worksOnOthersInstallations: true, registrationCheckedAt: "2026-01-02", sections });
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: role(doc, "ere").id, personId: admin.id, authorizationLevel: "A", authorizationNumber: "77777", registered: true });
  doc = await act(doc, { action: "save_competence", revision: doc.program!.revision, competence: { personId: member.id, workTypes: ["LV_HOMES"], assessment: "Utbildad", limitations: "Ingen högspänning", supervised: true } });
  doc = await act(doc, { action: "approve", revision: doc.program!.revision, changeReason: "Första versionen." });
  assert.doesNotMatch(JSON.stringify(doc.versions[0]), /77777/);
  const view = await selfInspectionView(doc, { me: { id: admin.id, name: admin.name }, admin: true, company: "Bolaget AB", people });
  const bytes = await createSelfInspectionPdf({ identity: { company: "Bolaget AB" }, fontBytes: new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf")), version: view.current! });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  assert.ok(bytes.length > 8_000);
  const person = peopleOverview(view.current!.content).find((item) => item.personId === member.id)!;
  assert.equal(mayDo(person), "Bostäder");
  assert.equal(limitationsOf(person), "Arbetar under handledning. Ingen högspänning");
});

test("the demo's programme has people with competence in its approved version", async () => {
  const { createDemoDatabase } = await import("../features/demo/demo-data");
  const { demoSelfInspection } = await import("../features/demo/demo-self-inspection");
  const db = createDemoDatabase();
  const adminUser = db.users.find((user) => user.role === "ADMIN")!;
  const view = await demoSelfInspection(db, adminUser, true, "GET", null);
  assert.ok((view.current!.content.people ?? []).length >= 4);
  assert.equal(view.program!.changedSinceApproval, false);
});
