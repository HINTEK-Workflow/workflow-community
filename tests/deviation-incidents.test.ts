// Tillbud och olycksfall i avvikelseloggen (2026-10-30): the pure rules of lib/self-inspection/incidents.ts – who
// sees and handles which type, what a near miss or an accident needs before it is marked done, the report to the
// authority – and the same rules applied to a Local/demo document, the work order link and the page Avvikelser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  closedInvestigation, deviationCloseRefusal, deviationReadWhere, incidentFields, mayHandleDeviation, mayReadDeviation, missingInvestigation, reportToAuthorityRefusal,
  ELECTRICAL_ACCIDENT_REPORT_URL, WORK_INJURY_REPORT_URL,
} from "../lib/self-inspection/incidents";
import { emptySelfInspectionDocument, selfInspectionActionSchema, selfInspectionView, type SelfInspectionDocument } from "../lib/self-inspection/model";
import { applySelfInspectionAction } from "../lib/self-inspection/document";
import { closePatch, newEntryPatch } from "../lib/self-inspection/deviation-link";
import { breadcrumbTrail } from "../lib/workflow/navigation";
import { menuItemAllowed, resolveMenu } from "../lib/workflow/menu-items";
import { noWorkflowPermissionProfile } from "../lib/workflow/permissions";

const admin = { id: "boss", admin: true };
const teamReader = { id: "lead", admin: false, team: true };
const worker = { id: "worker", admin: false };
const other = { id: "other", admin: false };
const entry = (type: string, extra: Partial<{ reportedById: string; responsibleId: string | null }> = {}) => ({ type, reportedById: "worker", responsibleId: null, ...extra });

test("Egenkontroll and Riskobservation keep the log's rule: admins, the reporter and the responsible person", () => {
  for (const type of ["SELF_INSPECTION", "RISK_OBSERVATION", undefined]) {
    const item = { ...entry(type ?? ""), type, responsibleId: "other" };
    assert.equal(mayReadDeviation(admin, item), true);
    assert.equal(mayReadDeviation(worker, item), true, "the reporter");
    assert.equal(mayReadDeviation(other, item), true, "the responsible person");
    assert.equal(mayReadDeviation(teamReader, item), false, "Teamet alone does not open the others' egenkontroll entries");
  }
});

test("Tillbud and Olycksfall: only the reporter, admins and the Teamet right – not the responsible person alone", () => {
  for (const type of ["NEAR_MISS", "ACCIDENT"]) {
    const item = entry(type, { responsibleId: "other" });
    assert.equal(mayReadDeviation(admin, item), true);
    assert.equal(mayReadDeviation(worker, item), true, "the reporter");
    assert.equal(mayReadDeviation(teamReader, item), true, "team:read");
    assert.equal(mayReadDeviation(other, item), false, "responsible but without Teamet");
    assert.equal(mayReadDeviation({ id: "x", admin: false }, item), false);
  }
});

test("who handles an entry: admins, the responsible person, and Teamet for an incident – never someone who cannot read it", () => {
  assert.equal(mayHandleDeviation(admin, entry("SELF_INSPECTION")), true);
  assert.equal(mayHandleDeviation(worker, entry("SELF_INSPECTION")), false, "reporting is not handling");
  assert.equal(mayHandleDeviation(other, entry("SELF_INSPECTION", { responsibleId: "other" })), true);
  assert.equal(mayHandleDeviation(teamReader, entry("NEAR_MISS")), true);
  assert.equal(mayHandleDeviation(teamReader, entry("SELF_INSPECTION")), false);
  assert.equal(mayHandleDeviation(other, entry("ACCIDENT", { responsibleId: "other" })), false, "cannot read it, so cannot handle it");
  assert.equal(mayHandleDeviation({ ...other, team: true }, entry("ACCIDENT", { responsibleId: "other" })), true);
});

test("the database filter says the same as the rule", () => {
  assert.deepEqual(deviationReadWhere(admin), {});
  assert.deepEqual(deviationReadWhere(worker), { OR: [
    { type: { in: ["SELF_INSPECTION", "RISK_OBSERVATION"] }, OR: [{ reportedById: "worker" }, { responsibleUserId: "worker" }] },
    { type: { in: ["NEAR_MISS", "ACCIDENT"] }, reportedById: "worker" },
  ] });
  assert.deepEqual(deviationReadWhere(teamReader).OR?.[1], { type: { in: ["NEAR_MISS", "ACCIDENT"] } });
});

test("a near miss or an accident closes only with when, what, why and the action", () => {
  assert.equal(deviationCloseRefusal({ type: "SELF_INSPECTION", action: "" }), null, "the other types need nothing more");
  assert.equal(deviationCloseRefusal({ type: "RISK_OBSERVATION", action: "" }), null);
  assert.deepEqual(missingInvestigation({ type: "NEAR_MISS", action: "" }), ["när det hände", "vad som hände", "varför", "åtgärd"]);
  assert.equal(deviationCloseRefusal({ type: "NEAR_MISS", action: "" }), "Fyll i när det hände, vad som hände, varför och åtgärd innan tillbudet markeras klart.");
  assert.equal(deviationCloseRefusal({ type: "ACCIDENT", occurredAt: "2026-10-30T08:00:00.000Z", whatHappened: "Föll", cause: "  ", action: "Räcke" }), "Fyll i varför innan olycksfallet markeras klart.");
  assert.equal(deviationCloseRefusal({ type: "ACCIDENT", occurredAt: "2026-10-30T08:00:00.000Z", whatHappened: "Föll", cause: "Vått", action: "Räcke" }), null);
});

test("Markera som anmäld: only a serious near miss or accident, once; the links lead to the authorities' own pages", () => {
  assert.ok(reportToAuthorityRefusal({ type: "SELF_INSPECTION", serious: true }));
  assert.ok(reportToAuthorityRefusal({ type: "NEAR_MISS", serious: false }));
  assert.equal(reportToAuthorityRefusal({ type: "NEAR_MISS", serious: true }), null);
  assert.ok(reportToAuthorityRefusal({ type: "ACCIDENT", serious: true, reportedToAuthorityAt: "2026-10-30T08:00:00.000Z" }));
  assert.match(WORK_INJURY_REPORT_URL, /^https:\/\/www\.anmalarbetsskada\.se/);
  assert.match(ELECTRICAL_ACCIDENT_REPORT_URL, /^https:\/\/www\.elsakerhetsverket\.se\//);
});

test("the incident fields are kept only for a near miss or an accident; a missing type is Egenkontroll", () => {
  const sent = { occurredAt: "2026-10-30T08:00:00.000Z", whatHappened: "X", cause: "Y", serious: true, personalInjury: true, electrical: true };
  assert.deepEqual(incidentFields({ type: "RISK_OBSERVATION", ...sent }), { type: "RISK_OBSERVATION", occurredAt: null, whatHappened: "", cause: "", serious: false, personalInjury: false, electrical: false });
  assert.deepEqual(incidentFields({ type: "ACCIDENT", ...sent }), { type: "ACCIDENT", ...sent });
  assert.equal(incidentFields({}).type, "SELF_INSPECTION");
  // A protocol row ("Till avvikelseloggen") sends no type and is Egenkontroll.
  const parsed = selfInspectionActionSchema.parse({ action: "save_deviation", deviation: { title: "Rad 3" } });
  assert.equal(parsed.action === "save_deviation" && parsed.deviation.type, undefined);
});

test("finishing the linked work order leaves a near miss without its investigation open", () => {
  const by = { id: "boss", name: "Berit" };
  assert.equal(closePatch({ type: "NEAR_MISS", status: "IN_PROGRESS", action: "", closedAt: null }, { title: "Åtgärda: stege" }, by, "2026-10-30T09:00:00.000Z"), null);
  const done = closePatch({ type: "NEAR_MISS", status: "IN_PROGRESS", action: "", closedAt: null, occurredAt: "2026-10-30T08:00:00.000Z", whatHappened: "Gled", cause: "Vått" }, { title: "Åtgärda: stege" }, by, "2026-10-30T09:00:00.000Z");
  assert.equal(done?.status, "DONE", "the order's title becomes the action, so the investigation is complete");
  assert.equal(closePatch({ status: "OPEN", action: "", closedAt: null }, { title: "X" }, by, "2026-10-30T09:00:00.000Z")?.status, "DONE", "Egenkontroll as before");
  const linked = newEntryPatch({ type: "ACCIDENT", status: "OPEN", action: "", closedAt: null }, { id: "o1", title: "X", status: "COMPLETED", completedAt: "2026-10-29T09:00:00.000Z" }, by, "2026-10-30T09:00:00.000Z");
  assert.deepEqual(linked, { workOrderId: "o1", status: "IN_PROGRESS" });
});

// ---------- the same rules on a document (Local's file and the demo) ----------

const people = [{ id: "boss", name: "Berit Chef" }, { id: "worker", name: "Mats Montör" }, { id: "lead", name: "Lena Ledare" }, { id: "other", name: "Olle Annan" }];
const actor = (id: string, extra: Partial<{ admin: boolean; team: boolean }> = {}) => ({ id, name: people.find((person) => person.id === id)!.name, admin: false, ...extra });
const now = new Date("2026-10-30T10:00:00.000Z");
const apply = (doc: SelfInspectionDocument, raw: unknown, who: ReturnType<typeof actor>) => applySelfInspectionAction(doc, raw as never, who, { people, now });
const report = (title: string, type: string, extra: Record<string, unknown> = {}) => ({ action: "save_deviation", deviation: { title, type, ...extra } });

test("a document without a programme keeps the log: report, investigate, mark done, reopen and mark reported", async () => {
  let doc = emptySelfInspectionDocument();
  doc = await apply(doc, report("Stege gled", "NEAR_MISS", { serious: true, electrical: true, whatHappened: "Gled", action: "ignored for a member" }), actor("worker"));
  const [entry] = doc.deviations;
  assert.equal(doc.program, null, "no programme needed");
  assert.deepEqual([entry.type, entry.serious, entry.electrical, entry.whatHappened, entry.action, entry.status], ["NEAR_MISS", true, true, "Gled", "", "OPEN"]);
  // The reporter cannot handle it; someone else without Teamet does not even see it.
  await assert.rejects(apply(doc, { action: "mark_deviation_done", id: entry.id }, actor("worker")), { status: 403 });
  await assert.rejects(apply(doc, { action: "mark_deviation_done", id: entry.id }, actor("other")), { status: 404 });
  // Teamet investigates; the close rule is enforced first.
  await assert.rejects(apply(doc, { action: "mark_deviation_done", id: entry.id }, actor("lead", { team: true })), { status: 409 });
  // Markera klar with what is missing filled in there (2026-11-02): only part of it is still refused, and nothing is saved then.
  await assert.rejects(apply(doc, { action: "mark_deviation_done", id: entry.id, investigation: { cause: "Vått golv" } }, actor("lead", { team: true })), { status: 409 });
  const filledInClose = await apply(doc, { action: "mark_deviation_done", id: entry.id, doneNote: "Klart", investigation: { occurredAt: "2026-10-30T07:30:00.000Z", whatHappened: "Gled", cause: "Vått golv", plan: "Halkskydd" } }, actor("lead", { team: true }));
  const filledEntry = filledInClose.deviations.find((item: { id: string }) => item.id === entry.id)!;
  assert.deepEqual([filledEntry.status, filledEntry.occurredAt, filledEntry.whatHappened, filledEntry.cause, filledEntry.action], ["DONE", "2026-10-30T07:30:00.000Z", "Gled", "Vått golv", "Halkskydd"], "saved together with the close");
  doc = await apply(doc, { action: "save_investigation", id: entry.id, occurredAt: "2026-10-30T07:30:00.000Z", whatHappened: "Gled", cause: "Vått golv", plan: "Halkskydd", serious: true, electrical: true }, actor("lead", { team: true }));
  doc = await apply(doc, { action: "mark_reported_to_authority", id: entry.id }, actor("lead", { team: true }));
  await assert.rejects(apply(doc, { action: "mark_reported_to_authority", id: entry.id }, actor("lead", { team: true })), { status: 409 });
  doc = await apply(doc, { action: "mark_deviation_done", id: entry.id, doneNote: "Klart" }, actor("lead", { team: true }));
  let stored = doc.deviations[0];
  assert.deepEqual([stored.status, stored.closedById, stored.doneNote, stored.reportedToAuthorityById, stored.action], ["DONE", "lead", "Klart", "lead", "Halkskydd"]);
  // Öppna igen, and the investigation cannot be emptied while it is done.
  doc = await apply(doc, { action: "reopen_deviation", id: entry.id }, actor("boss", { admin: true }));
  stored = doc.deviations[0];
  assert.deepEqual([stored.status, stored.closedAt, stored.closedById], ["OPEN", null, null]);
});

test("an admin's own save of a near miss as done is refused without the investigation", async () => {
  await assert.rejects(apply(emptySelfInspectionDocument(), report("Olycka", "ACCIDENT", { status: "DONE", action: "X" }), actor("boss", { admin: true })), { status: 409 });
  const doc = await apply(emptySelfInspectionDocument(), report("Brist", "SELF_INSPECTION", { status: "DONE", action: "X" }), actor("boss", { admin: true }));
  assert.equal(doc.deviations[0].status, "DONE", "Egenkontroll closes as before");
});

test("the view shows each reader what the rule allows, with what they may handle", async () => {
  let doc = emptySelfInspectionDocument();
  doc = await apply(doc, report("Brist", "SELF_INSPECTION"), actor("worker"));
  doc = await apply(doc, report("Tillbud", "NEAR_MISS"), actor("worker"));
  doc = await apply(doc, report("Annans olycka", "ACCIDENT"), actor("other"));
  const viewOf = (id: string, extra: { admin?: boolean; team?: boolean } = {}) => selfInspectionView(doc, { me: { id, name: id }, admin: Boolean(extra.admin), team: extra.team, company: "AB", people });
  assert.deepEqual((await viewOf("worker")).deviations.map((item) => item.title).sort(), ["Brist", "Tillbud"]);
  assert.deepEqual((await viewOf("lead", { team: true })).deviations.map((item) => item.title).sort(), ["Annans olycka", "Tillbud"]);
  assert.deepEqual((await viewOf("lead")).deviations, []);
  const boss = await viewOf("boss", { admin: true });
  assert.equal(boss.deviations.length, 3);
  assert.ok(boss.deviations.every((item) => item.canHandle));
  assert.ok((await viewOf("worker")).deviations.every((item) => !item.canHandle), "the reporter reports, the handler handles");
});

// ---------- the page Avvikelser ----------

test("Avvikelser is a menu button of the work for everyone, with its own trail", () => {
  const member = { memberRole: "MEMBER" as const, workflowPermissions: noWorkflowPermissionProfile() };
  assert.equal(menuItemAllowed("deviations", member), true);
  assert.ok(resolveMenu(member, { hidden: [], shortcuts: [] }).flat().some((item) => item.type === "link" && item.key === "deviations"));
  assert.deepEqual(breadcrumbTrail({ view: "deviations" }).map((crumb) => crumb.label), ["Översikt", "Avvikelser"]);
  // The report form is a DialogPage, which adds its own name to the trail – so the trail itself stops at Avvikelser.
  assert.deepEqual(breadcrumbTrail({ view: "deviations", params: { new: "1" } }).map((crumb) => [crumb.label, crumb.href]),
    [["Översikt", "/?view=stats"], ["Avvikelser", null]]);
});

// ---------- privacy first (2026-10-30): Ansvarig and the work order of an incident ----------

test("Ansvarig for a near miss or an accident is an admin or someone with Teamet, never anyone else", async () => {
  const { incidentResponsibleRefusal, INCIDENT_RESPONSIBLE_REFUSAL } = await import("../lib/self-inspection/incidents");
  assert.equal(incidentResponsibleRefusal("SELF_INSPECTION", "worker", { admin: false, team: false }), null, "the other types as before");
  assert.equal(incidentResponsibleRefusal("NEAR_MISS", null, null), null, "no one responsible is fine");
  assert.equal(incidentResponsibleRefusal("NEAR_MISS", "boss", { admin: true }), null);
  assert.equal(incidentResponsibleRefusal("ACCIDENT", "lead", { admin: false, team: true }), null);
  assert.equal(incidentResponsibleRefusal("ACCIDENT", "worker", { admin: false, team: false }), INCIDENT_RESPONSIBLE_REFUSAL);
  assert.equal(incidentResponsibleRefusal("NEAR_MISS", "gone", null), INCIDENT_RESPONSIBLE_REFUSAL);
  // The same rule where the demo keeps the log.
  const rights = (id: string) => id === "lead" ? { admin: false, team: true } : id === "boss" ? { admin: true, team: true } : { admin: false, team: false };
  const save = (responsibleId: string) => applySelfInspectionAction(emptySelfInspectionDocument(), { action: "save_deviation", deviation: { title: "Tillbud", type: "NEAR_MISS", responsibleId } } as never,
    actor("boss", { admin: true }), { people, now, memberRights: rights });
  await assert.rejects(save("worker"), { status: 400, message: INCIDENT_RESPONSIBLE_REFUSAL });
  assert.equal((await save("lead")).deviations[0].responsibleId, "lead");
});

test("Skapa arbetsorder from a near miss or an accident carries a neutral title and the action only", async () => {
  const { workOrderFromDeviation } = await import("../lib/self-inspection/deviation-link");
  const base = { number: 4, kind: "DEVIATION" as const, title: "Mats föll från stegen", description: "Skadade handen", source: null, action: "Halkskydd på stegen" };
  const order = workOrderFromDeviation({ ...base, type: "NEAR_MISS" }, null);
  assert.equal(order.title, "Åtgärd efter tillbud 4");
  assert.equal(order.description, "Halkskydd på stegen\n\nFrån tillbud 4 i avvikelseloggen.");
  assert.ok(!JSON.stringify(order).includes("Mats föll") && !JSON.stringify(order).includes("handen"), "never the title, description or investigation");
  assert.equal(workOrderFromDeviation({ ...base, type: "ACCIDENT", action: "" }, null).title, "Åtgärd efter olycksfall 4");
  assert.equal(workOrderFromDeviation({ ...base, type: "SELF_INSPECTION" }, null).title, "Åtgärda: Mats föll från stegen", "the other types as before");
});

test("severity: Låg · Normal · Hög · Akut, Normal when missing (an older file or row)", async () => {
  const { deviationSeverity, DEVIATION_SEVERITIES, DEVIATION_SEVERITY_STEP, DEFAULT_DEVIATION_SEVERITY } = await import("../lib/self-inspection/incidents");
  assert.deepEqual(Object.values(DEVIATION_SEVERITIES), ["Låg", "Normal", "Hög", "Akut"]);
  assert.equal(DEFAULT_DEVIATION_SEVERITY, "NORMAL");
  assert.equal(deviationSeverity(undefined), "NORMAL");
  assert.equal(deviationSeverity("SERIOUS"), "NORMAL", "an unknown word is Normal");
  assert.equal(deviationSeverity("ACUTE"), "ACUTE");
  assert.deepEqual(DEVIATION_SEVERITY_STEP, { LOW: 1, NORMAL: 2, HIGH: 3, ACUTE: 4 }, "one step each on the yellow → red scale");
});

test("severity on a document: Normal when reported without one, kept when saved without one, an older file opens unchanged", async () => {
  const { selfInspectionDocumentSchema } = await import("../lib/self-inspection/model");
  let doc = await apply(emptySelfInspectionDocument(), report("Saknad märkning", "SELF_INSPECTION"), actor("boss", { admin: true }));
  assert.equal(doc.deviations[0]!.severity, "NORMAL", "Normal from the start");
  doc = await apply(doc, report("Stege gled", "NEAR_MISS", { severity: "HIGH" }), actor("worker"));
  assert.equal(doc.deviations[1]!.severity, "HIGH", "a member chooses it too");
  const first = doc.deviations[0]!;
  doc = await apply(doc, { action: "save_deviation", deviation: { id: first.id, title: first.title, type: "SELF_INSPECTION", severity: "ACUTE" } }, actor("boss", { admin: true }));
  assert.equal(doc.deviations[0]!.severity, "ACUTE");
  doc = await apply(doc, { action: "save_deviation", deviation: { id: first.id, title: "Ny rubrik", type: "SELF_INSPECTION" } }, actor("boss", { admin: true }));
  assert.equal(doc.deviations[0]!.severity, "ACUTE", "an older client that sends none keeps it");
  doc = await apply(doc, { action: "save_deviation", deviation: { kind: "IMPROVEMENT", title: "Bättre rutin", severity: "ACUTE" } }, actor("boss", { admin: true }));
  assert.equal(doc.deviations[2]!.severity, "NORMAL", "a Förbättring has none");
  // An older .hwf file: the entry has no severity and still reads.
  const { severity: _drop, ...older } = doc.deviations[0]!;
  void _drop;
  const parsed = selfInspectionDocumentSchema.parse({ ...doc, deviations: [older] });
  assert.equal(parsed.deviations[0]!.severity, undefined);
  assert.throws(() => selfInspectionDocumentSchema.parse({ ...doc, deviations: [{ ...older, severity: "SERIOUS" }] }), "only the four words");
});

test("Markera klar: what the dialog sends is laid over the entry, and can never empty what is stored", () => {
  const stored = { type: "NEAR_MISS", occurredAt: "2026-10-30T07:30:00.000Z", whatHappened: "Gled", cause: "", action: "" };
  assert.deepEqual(closedInvestigation(stored, { cause: "Vått golv", plan: "Halkskydd" }), { ...stored, cause: "Vått golv", action: "Halkskydd" });
  assert.deepEqual(closedInvestigation(stored, { whatHappened: "  ", occurredAt: null }), stored, "empty keeps what is there");
  assert.equal(deviationCloseRefusal(closedInvestigation(stored, { cause: "Vått golv", plan: "Halkskydd" })), null);
  assert.match(deviationCloseRefusal(closedInvestigation(stored, { cause: "Vått golv" }))!, /åtgärd/);
  assert.equal(closedInvestigation(stored, undefined), stored);
  const other = { type: "SELF_INSPECTION", occurredAt: null, whatHappened: "", cause: "", action: "" };
  assert.equal(closedInvestigation(other, { cause: "Ska inte sparas" }), other, "only a near miss or an accident");
});

test("Markera klar's dialog: the photo buttons wait only for the save, never for the rule, and the missing fields are in it", () => {
  const dialog = readFileSync("features/self-inspection/deviations.tsx", "utf8");
  assert.match(dialog, /<PhotoPicker files=\{files\} onChange=\{setFiles\} disabled=\{busy\} label="Bilder efter" \/>/);
  assert.match(dialog, /data-testid="deviation-close-fields"/);
  assert.match(dialog, /onDone\(note\.trim\(\), files, asks \? investigation : undefined\)/);
});
