import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applySelfInspectionAction, cardChangeText, type DocumentActor } from "../lib/self-inspection/document";
import {
  cardChanged, cardContent, cardHistory, documentCardContent, documentReminders, dueState, emptySelfInspectionDocument, LOCAL_CARD_VERSIONS, mayReadCard, selfInspectionDocumentSchema,
  selfInspectionView, SelfInspectionError, type SelfInspectionAction, type SelfInspectionDocument,
} from "../lib/self-inspection/model";
import { checkLevel } from "../lib/self-inspection/levels";
import { assignmentWarnings, workContext } from "../lib/self-inspection/work";
import { competenceCsv, competenceRows, COMPETENCE_EXPORT_COLUMNS } from "../lib/self-inspection/competence-export";
import { buildPlan, detectImport, mapFields, TARGET_FIELDS, type ExtractedFile } from "../lib/import/detect";
import { parseCsv } from "../lib/import/csv";

// Kompetenskort v2 (2026-10-08): trainings with provider, the company's competence groups, driving licence and
// languages, a version for every save, reminders before expiry, the person's suggestion, and the generic import and
// export – the same rules in Cloud, Local and the demo (the Cloud side is covered by tests/competence-card.integration.ts).
const admin: DocumentActor = { id: "u-admin", name: "Ada Admin", admin: true };
const member: DocumentActor = { id: "u-member", name: "Mats Montör", admin: false };
const other: DocumentActor = { id: "u-other", name: "Olle Annan", admin: false };
const people = [admin, member, other].map(({ id, name }) => ({ id, name }));
let sequence = 0;
const newId = () => `id-${++sequence}`;
const now = new Date("2026-05-01T10:00:00Z");
const today = "2026-05-01";
const act = (doc: SelfInspectionDocument, action: SelfInspectionAction, actor = admin, at = now) => applySelfInspectionAction(doc, action, actor, { now: at, newId, people });
async function rejects(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof SelfInspectionError && error.status === status);
}
const versionsOf = (doc: SelfInspectionDocument, personId: string) => doc.cardVersions.filter((item) => item.personId === personId).sort((a, b) => a.number - b.number);
const viewFor = (doc: SelfInspectionDocument, actor: DocumentActor) => selfInspectionView(doc, { me: { id: actor.id, name: actor.name }, admin: actor.admin, company: "Bolaget", people }, today);

test("older documents and lines open with the new parts empty", () => {
  const parsed = selfInspectionDocumentSchema.parse({ program: null, versions: [], confirmations: [], reviews: [], deviations: [],
    credentials: [{ id: "c-1", personId: member.id, title: "Utbildning", createdAt: now.toISOString(), updatedAt: now.toISOString() }] });
  assert.deepEqual([parsed.competenceGroups, parsed.competenceCards, parsed.cardVersions], [[], [], []]);
  assert.equal(parsed.credentials[0].provider, "", "a line from before v2 has no provider");
});

test("validity: a training and a driving licence are OK, run out within 30 days, or have run out", async () => {
  assert.deepEqual([dueState(null, today), dueState("2026-08-01", today), dueState("2026-05-31", today), dueState("2026-04-30", today)], ["NONE", "OK", "DUE_SOON", "OVERDUE"]);
  let doc = await act(emptySelfInspectionDocument(), { action: "save_competence_card", card: { personId: member.id, licenceClasses: ["B", "BE"], licenceValidUntil: "2026-05-20", languages: [] } });
  doc = await act(doc, { action: "save_credential", credential: { personId: member.id, title: "Heta arbeten", provider: "Påhittad utbildare", validUntil: "2026-04-01" } });
  const view = await viewFor(doc, member);
  assert.equal(view.competenceCards[0].licenceState, "DUE_SOON");
  assert.equal(view.credentials[0].state, "OVERDUE");
  assert.equal(view.credentials[0].provider, "Påhittad utbildare");
  // The bell: the person's own licence and training; for an admin everyone's; never someone else's for a member.
  const titles = (actor: DocumentActor) => documentReminders(doc, { me: { id: actor.id, name: actor.name }, admin: actor.admin }, today).map((item) => item.title);
  assert.ok(titles(member).includes("Går ut snart: körkort"));
  assert.ok(titles(member).includes("Har gått ut: Heta arbeten"));
  assert.ok(titles(admin).includes("Går ut snart: körkort (Mats Montör)"));
  assert.deepEqual(titles(other).filter((title) => /körkort|Heta/.test(title)), [], "another member is never reminded of someone else's card");
});

test("versions: every save keeps the whole card; an unchanged save keeps none", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "save_credential", credential: { personId: member.id, title: "Elsäkerhet", issuedAt: "2025-01-10", validUntil: "2028-01-10" } });
  assert.deepEqual(versionsOf(doc, member.id).map((item) => [item.number, item.change]), [[1, "Utbildning tillagd: Elsäkerhet"]]);
  const lineId = doc.credentials[0].id;
  doc = await act(doc, { action: "save_credential", credential: { id: lineId, personId: member.id, title: "Elsäkerhet", issuedAt: "2025-01-10", validUntil: "2028-01-10" } });
  assert.equal(versionsOf(doc, member.id).length, 1, "the same line saved again changes nothing");
  doc = await act(doc, { action: "save_competence_group", group: { name: "Servicemontörer" } });
  const groupId = doc.competenceGroups[0].id;
  doc = await act(doc, { action: "save_competence_card", card: { personId: member.id, groupIds: [groupId], licenceClasses: ["B"], licenceValidUntil: "2030-01-01", languages: [{ language: "Svenska", level: "NATIVE" }] } });
  const second = versionsOf(doc, member.id)[1];
  assert.equal(second.change, "Ändrat: kompetensgrupper, körkort, språk");
  assert.deepEqual(second.content.groups, ["Servicemontörer"]);
  assert.deepEqual(second.content.trainings.map((item) => item.title), ["Elsäkerhet"], "a version holds the whole card, also the parts that did not change");
  assert.equal(second.savedByName, admin.name);
  // A version keeps the group's name: a renamed group gives the members a new version, the old one keeps the old name.
  doc = await act(doc, { action: "save_competence_group", group: { id: groupId, name: "Service" } });
  assert.deepEqual(versionsOf(doc, member.id).map((item) => item.content.groups[0]), [undefined, "Servicemontörer", "Service"]);
  doc = await act(doc, { action: "remove_competence_group", id: groupId });
  assert.deepEqual(doc.competenceCards[0].groupIds, []);
  assert.equal(versionsOf(doc, member.id).at(-1)?.change, "Kompetensgruppen Service togs bort");
  doc = await act(doc, { action: "remove_credential", id: lineId });
  const last = versionsOf(doc, member.id).at(-1)!;
  assert.equal(last.change, "Utbildning borttagen: Elsäkerhet");
  assert.deepEqual(last.content.trainings, []);
  assert.equal(doc.competenceCards[0].revision, last.number, "the card knows its latest version");
  // The whole card goes with its history.
  doc = await act(doc, { action: "remove_credential_card", personId: member.id });
  assert.deepEqual([doc.competenceCards.length, doc.cardVersions.length], [0, 0]);
});

test("versions: the comparison ignores order; a Local file keeps the latest versions per person", async () => {
  const a = cardContent({ trainings: [{ title: "B", issuedAt: null, validUntil: null }, { title: "A", issuedAt: null, validUntil: null }], groups: ["Y", "X"], licenceClasses: ["BE", "B"], licenceValidUntil: null, languages: [] });
  const b = cardContent({ trainings: [{ title: "A", issuedAt: null, validUntil: null }, { title: "B", issuedAt: null, validUntil: null }], groups: ["X", "Y"], licenceClasses: ["B", "BE"], licenceValidUntil: null, languages: [] });
  assert.equal(cardChanged(a, b), false);
  assert.equal(cardChanged(null, a), true, "the first save is always a version");
  assert.deepEqual(a.licenceClasses, ["B", "BE"], "licence classes in their usual order");
  assert.equal(cardChangeText(undefined, { groupIds: [], licenceClasses: [], licenceValidUntil: null, languages: [] }), "Kortet sparat");
  let doc = emptySelfInspectionDocument();
  for (let index = 0; index < LOCAL_CARD_VERSIONS + 5; index++)
    doc = await act(doc, { action: "save_competence_card", card: { personId: member.id, licenceClasses: [], licenceValidUntil: null, languages: [{ language: `Språk ${index}`, level: "BASIC" }] } });
  const kept = versionsOf(doc, member.id);
  assert.equal(kept.length, LOCAL_CARD_VERSIONS);
  assert.deepEqual([kept[0].number, kept.at(-1)!.number], [6, LOCAL_CARD_VERSIONS + 5], "the oldest go first and the numbers keep counting");
});

test("rights: admins edit; a member reads their own card, suggests a change and never edits", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "save_competence_group", group: { name: "Kontrollanter", description: "Gör kontroller." } });
  const groupId = doc.competenceGroups[0].id;
  doc = await act(doc, { action: "save_competence_card", card: { personId: member.id, groupIds: [groupId], licenceClasses: ["B"], licenceValidUntil: null, languages: [] } });
  doc = await act(doc, { action: "save_competence_card", card: { personId: other.id, licenceClasses: ["C"], licenceValidUntil: null, languages: [] } });
  await rejects(act(doc, { action: "save_competence_card", card: { personId: member.id, licenceClasses: [], languages: [] } }, member), 403);
  await rejects(act(doc, { action: "save_competence_group", group: { name: "Egen grupp" } }, member), 403);
  await rejects(act(doc, { action: "clear_competence_suggestion", personId: member.id }, member), 403);
  await rejects(act(doc, { action: "save_competence_card", card: { personId: member.id, groupIds: ["no-such-group"] } }), 404);
  await rejects(act(doc, { action: "save_competence_card", card: { personId: "u-unknown" } }), 400);
  await rejects(act(doc, { action: "save_competence_group", group: { name: "kontrollanter" } }), 409);
  // The member's view: the own card and only the own groups; the admin's: everyone.
  const mine = await viewFor(doc, member);
  assert.deepEqual(mine.competenceCards.map((card) => card.personId), [member.id]);
  assert.deepEqual(mine.competenceGroups.map((group) => group.name), ["Kontrollanter"]);
  assert.deepEqual((await viewFor(doc, other)).competenceGroups, [], "a member outside the group does not read the company's list of groups");
  assert.equal((await viewFor(doc, admin)).competenceCards.length, 2);
  // A suggestion is only about one's own card, it is no version, and the admin's bell shows it until it is cleared.
  const before = doc.cardVersions.length;
  doc = await act(doc, { action: "suggest_competence_change", text: "Lägg till kursen i heta arbeten." }, member);
  assert.equal(doc.competenceCards.find((card) => card.personId === member.id)?.suggestion, "Lägg till kursen i heta arbeten.");
  assert.equal(doc.cardVersions.length, before);
  const bell = (actor: DocumentActor) => documentReminders(doc, { me: { id: actor.id, name: actor.name }, admin: actor.admin }, today).filter((item) => item.id.includes("card-suggestion"));
  assert.equal(bell(admin).length, 1);
  assert.equal(bell(admin)[0].needsAction, true);
  assert.deepEqual(bell(member), []);
  doc = await act(doc, { action: "clear_competence_suggestion", personId: member.id });
  assert.equal(bell(admin).length, 0);
  // History: an admin any card, a member only their own, someone else nothing (the same answer as for no card).
  assert.ok(cardHistory(doc, member.id, admin).length > 0);
  assert.ok(cardHistory(doc, member.id, member).length > 0);
  assert.deepEqual(cardHistory(doc, member.id, other), []);
  assert.deepEqual([mayReadCard(admin, member.id, null), mayReadCard(member, member.id, null), mayReadCard(other, member.id, null), mayReadCard(member, member.id, now.toISOString())], [true, true, false, false]);
});

test("retention: a card of a person who left is kept three months as it was, then hidden; no reminders or versions meanwhile", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "save_competence_card", card: { personId: member.id, licenceClasses: ["B"], licenceValidUntil: "2026-05-10", languages: [] } });
  doc = await act(doc, { action: "save_credential", credential: { personId: member.id, title: "Elsäkerhet" } });
  const leftAt = "2026-04-20T08:00:00.000Z";
  doc = { ...doc, competenceCards: doc.competenceCards.map((card) => ({ ...card, leftAt })), credentials: doc.credentials.map((item) => ({ ...item, leftAt })) };
  const adminView = await viewFor(doc, admin);
  assert.equal(adminView.competenceCards[0].savedUntil, "2026-07-20", "the documented three-month rule");
  assert.deepEqual((await viewFor(doc, member)).competenceCards, [], "a person who left reads nothing – the card is the company's to keep");
  assert.deepEqual(documentReminders(doc, { me: { id: admin.id, name: admin.name }, admin: true }, today).filter((item) => /körkort/.test(item.title)), []);
  await rejects(act(doc, { action: "save_competence_card", card: { personId: member.id, licenceClasses: [] } }), 409);
  await rejects(act(doc, { action: "save_credential", credential: { personId: member.id, title: "Ny" } }), 409);
  const versions = doc.cardVersions.length;
  doc = await act(doc, { action: "remove_credential", id: doc.credentials[0].id });
  assert.equal(doc.cardVersions.length, versions, "removing a line of a kept card keeps no new version");
  // After the three months the card is hidden at once, before the nightly job deletes it.
  const later = selfInspectionView(doc, { me: { id: admin.id, name: admin.name }, admin: true, company: "Bolaget", people }, "2026-07-21");
  assert.deepEqual((await later).competenceCards, []);
  assert.deepEqual(cardHistory(doc, member.id, admin, new Map(), "2026-07-21"), []);
});

test("assignment: an admin and the person see the card where work is given out; others do not, and the level gate is unchanged", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  const role = (key: string) => doc.program!.roles.find((item) => item.key === key)!.id;
  doc = await act(doc, { action: "assign_role", revision: doc.program!.revision, roleId: role("installer"), personId: member.id });
  doc = await act(doc, { action: "save_competence", revision: doc.program!.revision, competence: { personId: member.id, workTypes: [], assessment: "Erfaren.", supervised: false } });
  const levelsBefore = workContext(doc, { me: { id: admin.id }, admin: true }).levels;
  doc = await act(doc, { action: "save_competence_group", group: { name: "Laddplatser" } });
  doc = await act(doc, { action: "save_competence_card", card: { personId: member.id, groupIds: [doc.competenceGroups[0].id], licenceClasses: ["B"], licenceValidUntil: "2020-01-01", languages: [{ language: "Engelska", level: "WORK" }] } });
  const forAdmin = workContext(doc, { me: { id: admin.id }, admin: true }, today);
  const card = forAdmin.performers.find((person) => person.id === member.id)!.card!;
  assert.deepEqual(card.groups, ["Laddplatser"]);
  assert.equal(card.licenceExpired, true);
  assert.deepEqual(card.languages, ["Engelska (fungerar i arbetet)"]);
  assert.ok(assignmentWarnings(forAdmin, { performerId: member.id, performerName: member.name, inspectorName: "", activityType: null }).includes(`Körkortet för ${member.name} har gått ut enligt kompetenskortet.`));
  assert.ok(workContext(doc, { me: { id: member.id }, admin: false }, today).performers[0].card, "the person sees their own");
  const forOther = workContext(doc, { me: { id: other.id }, admin: false }, today);
  assert.equal(forOther.performers[0].card, null, "a colleague never reads the card");
  assert.ok(!assignmentWarnings(forOther, { performerId: member.id, performerName: member.name, inspectorName: "", activityType: null }).some((text) => /Körkortet/.test(text)));
  // The levels and the decisions they give are the same as before the card existed.
  assert.deepEqual(forAdmin.levels, levelsBefore);
  const subject = { name: "Kontroll", value: 3 as const, suggested: false };
  assert.deepEqual(checkLevel({ directory: forAdmin.levels, subject, action: "assign", person: { id: member.id } }), checkLevel({ directory: levelsBefore, subject, action: "assign", person: { id: member.id } }));
});

test("export and import: the CSV export is read again by the Import page's target Kompetens", async () => {
  let doc = await act(emptySelfInspectionDocument(), { action: "save_credential", credential: { personId: member.id, title: "Arbete nära spänning", provider: "Påhittad utbildare", issuedAt: "2025-03-15", validUntil: "2028-03-15" } });
  doc = await act(doc, { action: "save_competence_card", card: { personId: other.id, licenceClasses: ["B"], licenceValidUntil: "2030-01-01", languages: [{ language: "Svenska", level: "NATIVE" }] } });
  const view = await viewFor(doc, admin);
  const rows = competenceRows(view.credentials, view.competenceCards);
  assert.deepEqual(rows.map((row) => row.slice(0, 2)), [["Mats Montör", "Arbete nära spänning"], ["Olle Annan", ""]], "a person without trainings still has a row");
  const csv = competenceCsv(view.credentials, view.competenceCards);
  assert.ok(csv.startsWith("﻿\"Person\";\"Utbildning\""));
  const table = parseCsv(csv.replace(/^﻿/, ""));
  const file: ExtractedFile = { name: "kompetenskort.csv", mimeType: "text/csv", size: csv.length, kind: "table", headers: table[0], rows: table.slice(1) };
  assert.deepEqual(file.headers, [...COMPETENCE_EXPORT_COLUMNS]);
  const detection = detectImport(file);
  assert.equal(detection.target, "competence");
  const plan = buildPlan(file, "competence", detection.mapping);
  assert.deepEqual(plan.map((item) => [item.kind, item.refs.person, item.data.title, item.data.provider, item.data.issuedAt, item.data.validUntil, Boolean(item.skip)]), [
    ["competence", "Mats Montör", "Arbete nära spänning", "Påhittad utbildare", "2025-03-15", "2028-03-15", false],
    ["competence", "Olle Annan", "", "", null, null, true],
  ], "a row without a training is left out from the start");
  // A spreadsheet with its own words maps too; a formula-looking cell is exported as text.
  assert.deepEqual(mapFields(TARGET_FIELDS.competence, ["Medarbetare", "Kurs", "Anordnare", "Kursdatum", "Giltig t.o.m."]),
    { person: "Medarbetare", title: "Kurs", provider: "Anordnare", issuedAt: "Kursdatum", validUntil: "Giltig t.o.m.", note: null });
  doc = await act(doc, { action: "save_credential", credential: { personId: member.id, title: "=SUMMA(A1)" } });
  assert.match(competenceCsv((await viewFor(doc, admin)).credentials, []), /"'=SUMMA\(A1\)"/);
  // An ordinary customer list is still a customer list.
  assert.equal(detectImport({ name: "kunder.csv", mimeType: "text/csv", size: 1, kind: "table", headers: ["Namn", "Företag", "E-post", "Telefon", "Postnummer"], rows: [["A", "B", "a@b.invalid", "1", "12345"]] }).target, "customers");
});

test("Local and the demo: the same document card content, and the import keeps competence away from the AI", () => {
  const doc = selfInspectionDocumentSchema.parse({ credentials: [{ id: "c", personId: "p", title: "T", files: [{ id: "f", filename: "intyg.pdf", mimeType: "application/pdf", size: 1, createdAt: "x" }], createdAt: "x", updatedAt: "x" }],
    competenceGroups: [{ id: "g", name: "Grupp", createdAt: "x", updatedAt: "x" }], competenceCards: [{ personId: "p", groupIds: ["g", "gone"], createdAt: "x", updatedAt: "x" }] });
  assert.deepEqual(documentCardContent(doc, "p"), { trainings: [{ title: "T", provider: "", issuedAt: null, validUntil: null, note: "", files: ["intyg.pdf"] }], groups: ["Grupp"], licenceClasses: [], licenceValidUntil: null, languages: [] });
  const ai = readFileSync("lib/import/ai.ts", "utf8");
  assert.match(ai, /target !== "catalogue" && target !== "competence"/);
  assert.match(ai, /result\.target === "competence" \? "unknown"/);
  const handler = readFileSync("lib/api-handlers/import.ts", "utf8");
  assert.match(handler, /detection\.target === "competence"\) ai = \{ used: false/);
  assert.match(handler, /if \(!ctx\?\.admin\) return limited\.map/, "only an admin's plan names the company's members");
  assert.match(handler, /item\.kind === "competence"[\s\S]*requireCloudWriteAccess\(ctx\)[\s\S]*applyCloudSelfInspectionAction\(ctx, action\)/, "rows go through the same change as the tab, in the person's session");
});

test("the programme's text is untouched by the competence card", () => {
  const template = readFileSync("lib/self-inspection/template.ts", "utf8");
  assert.doesNotMatch(template, /körkort|Körkort|kompetensgrupp/i, "the extended card is a register beside the programme, not new programme text");
});
