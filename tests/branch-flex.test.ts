// Fler verksamheter (2026-11-27, "programmet får inte bli större, bara mer flexibelt med mindre justeringar"): the work area
// Kommunal teknisk verksamhet, the electrical forms hidden without an electrical area, the neutral form categories, the deviation log's
// types with and without an egenkontrollprogram, the neutral reminders, the chat's word filter and the generic plant templates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ELECTRICAL_FORM_CATEGORIES, FORM_CATEGORIES, formCategoryLabel, formHiddenForCompany } from "../lib/workflow/form-publish";
import { electricalWorkChosen, WORK_AREA_LABEL } from "../lib/workflow/work-profile";
import {
  defaultDeviationType, deviationReadWhere, deviationTypeChoices, deviationTypeLabel, deviationTypeRefusal, mayReadDeviation, normalizeOwnTypes, ownTypeValue, resolvedDeviationType, storedDeviationType,
} from "../lib/self-inspection/incidents";
import { deviationTypeFilterChoices, deviationTypeMatches, emptySelfInspectionDocument, selfInspectionReminders, selfInspectionView, type SelfInspectionDocument } from "../lib/self-inspection/model";
import { applySelfInspectionAction } from "../lib/self-inspection/document";
import { deviationEntryLabel } from "../lib/self-inspection/deviation-export";
import { programFromTemplate } from "../lib/self-inspection/template";
import { NOTICE_KINDS } from "../lib/workflow/notice-channels";
import { planAnswer } from "../lib/ai/assistant-rules";
import { PLANT_TEMPLATE_KEYS, PLANT_TEMPLATES, plantTemplate, plantTemplateNotes } from "../lib/maintenance/plant-templates";
import { ALWAYS_ON_SELF_INSPECTION_ACTIONS, selfInspectionActionNeedsModule } from "../lib/workflow/modules";

// ---------- 1–2. the work area and the electrical forms ----------

test("Kommunal teknisk verksamhet is a work area of its own, and it is not electrical work", () => {
  assert.equal(WORK_AREA_LABEL.municipal, "Kommunal teknisk verksamhet");
  assert.equal(electricalWorkChosen(["municipal"]), false);
});

const hintekForm = (category: string, extra: Partial<{ own: boolean; baseId: string | null; hintek: boolean }> = {}) => ({ hintek: true, own: false, baseId: null, category, ...extra });

test("Workflow's electrical forms are hidden from the pickers without an electrical area, and shown again with one", () => {
  for (const category of ELECTRICAL_FORM_CATEGORIES) {
    assert.equal(formHiddenForCompany(hintekForm(category), electricalWorkChosen(["municipal"])), true, `${category} hidden for a municipal company`);
    assert.equal(formHiddenForCompany(hintekForm(category), electricalWorkChosen(["municipal", "electric"])), false, `${category} shown again when El is chosen`);
    assert.equal(formHiddenForCompany(hintekForm(category), electricalWorkChosen([])), false, `${category}: a company that never chose keeps everything`);
    assert.equal(formHiddenForCompany(hintekForm(category, { own: true, hintek: false }), false), false, "the company's own form is always shown");
    assert.equal(formHiddenForCompany(hintekForm(category, { baseId: "hintek-termografering", own: true, hintek: false }), false), false, "the company's own version of an original too");
  }
  for (const category of ["ROUNDS", "SAFETY", "UTILITIES", "OTHER", "INSPECTION"]) {
    // INSPECTION is an older category read as Elinstallation.
    assert.equal(formHiddenForCompany(hintekForm(category), false), category === "INSPECTION", category);
  }
});

test("the catalog route hides them on the server; one form by its id is read as before", () => {
  const route = readFileSync("app/api/forms/route.ts", "utf8");
  assert.match(route, /formHiddenForCompany\(card, electrical\)/);
  assert.match(route, /electricalWorkChosen\(normalizeWorkAreas\(/);
  const single = route.slice(route.indexOf("if (requested)"), route.indexOf("// Only each form's published version"));
  assert.doesNotMatch(single, /formHiddenForCompany/, "an existing protocol still opens its form");
});

test("the neutral form categories: names only, every one known to the database's check", () => {
  const values = FORM_CATEGORIES.map(([value]) => value);
  for (const value of ["UTILITIES", "SUPERVISION", "ENVIRONMENT"]) assert.ok(values.includes(value as never), value);
  assert.equal(formCategoryLabel("UTILITIES"), "VA och värme");
  assert.equal(formCategoryLabel("SUPERVISION"), "Tillsyn och besiktning");
  assert.equal(formCategoryLabel("ENVIRONMENT"), "Miljö");
  const migration = readFileSync("prisma/migrations/20261128220000_branch_flex/migration.sql", "utf8");
  for (const value of values) assert.ok(migration.includes(`'${value}'`), `${value} in the category check`);
  for (const old of ["INSPECTION", "SERVICE", "SELF_CHECK"]) assert.ok(migration.includes(`'${old}'`), `the older ${old} stays allowed`);
});

// ---------- 5. the deviation log ----------

test("the deviation types: neutral ones for everyone, Elinstallation only with a programme, the company's own beside them", () => {
  const without = deviationTypeChoices({ hasProgram: false }).map((choice) => choice.label);
  assert.deepEqual(without, ["Driftfel", "Säkerhet och arbetsmiljö", "Kvalitet", "Miljö", "Övrigt", "Riskobservation", "Tillbud", "Olycksfall"]);
  const withProgram = deviationTypeChoices({ hasProgram: true }).map((choice) => choice.label);
  assert.equal(withProgram[0], "Elinstallation", "the electrical type stays with a programme");
  assert.equal(withProgram.length, without.length + 1);
  const own = deviationTypeChoices({ hasProgram: false, ownTypes: ["Läckage", "  Läckage ", "Driftfel", "Lukt"] });
  assert.deepEqual(own.slice(-2), [{ value: "OWN:Läckage", label: "Läckage" }, { value: "OWN:Lukt", label: "Lukt" }], "trimmed, once, never the name of a built-in type");
  // An entry keeps its type in the list, also Elinstallation after the programme is gone.
  assert.ok(deviationTypeChoices({ hasProgram: false, current: "SELF_INSPECTION" }).some((choice) => choice.value === "SELF_INSPECTION"));
  assert.ok(deviationTypeChoices({ hasProgram: false, current: "OWN:Gammal typ" }).some((choice) => choice.label === "Gammal typ"));
});

test("the server's rule for a type: Elinstallation needs a programme, an own type must be the company's, the entry's own type always passes", () => {
  assert.match(deviationTypeRefusal("SELF_INSPECTION", { hasProgram: false, ownTypes: [] })!, /egenkontrollprogrammet/);
  assert.equal(deviationTypeRefusal("SELF_INSPECTION", { hasProgram: true, ownTypes: [] }), null);
  assert.equal(deviationTypeRefusal("OPERATING_FAULT", { hasProgram: false, ownTypes: [] }), null);
  assert.ok(deviationTypeRefusal("OWN:Läckage", { hasProgram: false, ownTypes: [] }));
  assert.equal(deviationTypeRefusal("OWN:Läckage", { hasProgram: false, ownTypes: ["Läckage"] }), null);
  assert.equal(deviationTypeRefusal("SELF_INSPECTION", { hasProgram: false, ownTypes: [], current: "SELF_INSPECTION" }), null, "a change never takes the entry's type away");
  assert.ok(deviationTypeRefusal("OWN", { hasProgram: false, ownTypes: [] }), "OWN alone is no type");
  // No type chosen: Elinstallation as before with a programme, Övrigt without one; a Förbättring is never refused.
  assert.equal(defaultDeviationType(true), "SELF_INSPECTION");
  assert.equal(defaultDeviationType(false), "OTHER");
  assert.deepEqual(resolvedDeviationType({ kind: "DEVIATION", hasProgram: false, ownTypes: [] }), { type: "OTHER", refusal: null });
  assert.deepEqual(resolvedDeviationType({ kind: "DEVIATION", current: "OWN:Lukt", hasProgram: false, ownTypes: [] }), { type: "OWN:Lukt", refusal: null }, "a save without a type keeps the entry's");
  assert.equal(resolvedDeviationType({ kind: "IMPROVEMENT", sent: "SELF_INSPECTION", hasProgram: false, ownTypes: [] }).refusal, null);
});

test("an own type keeps its name on the entry, is read by the log's rule and filtered as Egna typer", () => {
  assert.equal(storedDeviationType("OWN:  Läckage   i rör "), "OWN:Läckage i rör");
  assert.equal(deviationTypeLabel("OWN:Läckage"), "Läckage");
  assert.equal(deviationTypeLabel("OPERATING_FAULT"), "Driftfel");
  assert.equal(deviationTypeLabel(undefined), "Elinstallation", "an older entry without a type reads as before");
  assert.equal(ownTypeValue(" Lukt "), "OWN:Lukt");
  assert.deepEqual(normalizeOwnTypes(["A", "a", "", 3, "Övrigt"]), ["A"]);
  const worker = { id: "worker", admin: false };
  assert.equal(mayReadDeviation(worker, { type: "OWN:Lukt", reportedById: "worker" }), true, "the reporter reads an own type");
  assert.equal(mayReadDeviation({ id: "lead", admin: false, team: true }, { type: "OWN:Lukt", reportedById: "worker" }), false, "an own type keeps the log's rule, not the incidents'");
  assert.deepEqual(deviationReadWhere(worker).OR?.[0].type, { notIn: ["NEAR_MISS", "ACCIDENT"] }, "the database filter reaches the own types too");
  assert.equal(deviationTypeMatches({ kind: "DEVIATION", type: "OWN:Lukt" }, "OWN"), true);
  assert.equal(deviationTypeMatches({ kind: "DEVIATION", type: "OWN:Lukt" }, "OTHER"), false);
  assert.equal(deviationEntryLabel({ kind: "DEVIATION", number: 4, type: "OWN:Lukt" }), "Avvikelse 4");
  assert.equal(deviationEntryLabel({ kind: "DEVIATION", number: 5, type: "OPERATING_FAULT" }), "Avvikelse 5");
});

test("the filter offers Elinstallation only with a programme or when an entry has it", () => {
  const plain = deviationTypeFilterChoices({ hasProgram: false, entries: [] });
  assert.equal(plain.includes("SELF_INSPECTION"), false);
  assert.equal(plain.includes("OWN"), false, "Egna typer only when the company has some");
  assert.ok(plain.includes("OPERATING_FAULT") && plain.includes("IMPROVEMENT") && plain[0] === "any");
  assert.ok(deviationTypeFilterChoices({ hasProgram: true, entries: [] }).includes("SELF_INSPECTION"));
  assert.ok(deviationTypeFilterChoices({ hasProgram: false, entries: [{ kind: "DEVIATION", type: "SELF_INSPECTION" }] }).includes("SELF_INSPECTION"), "an older entry is still found");
  assert.ok(deviationTypeFilterChoices({ hasProgram: false, ownTypes: ["Lukt"], entries: [] }).includes("OWN"));
});

const people = [{ id: "boss", name: "Berit Chef" }, { id: "worker", name: "Mats Montör" }];
const boss = { id: "boss", name: "Berit Chef", admin: true };
const worker = { id: "worker", name: "Mats Montör", admin: false };
const apply = (doc: SelfInspectionDocument, raw: unknown, who: typeof boss) => applySelfInspectionAction(doc, raw as never, who, { people, now: new Date("2026-11-28T10:00:00.000Z") });

test("the log is always there: without a programme the neutral types and the company's own, with one Elinstallation as well", async () => {
  let doc = emptySelfInspectionDocument();
  await assert.rejects(apply(doc, { action: "save_deviation", deviation: { title: "Elfel", type: "SELF_INSPECTION" } }, worker), { status: 400 }, "no Elinstallation without a programme");
  doc = await apply(doc, { action: "save_deviation", deviation: { title: "Pumpen stannade", type: "OPERATING_FAULT" } }, worker);
  doc = await apply(doc, { action: "save_deviation", deviation: { title: "Från en rad" } }, worker);
  assert.deepEqual(doc.deviations.map((item) => item.type), ["OPERATING_FAULT", "OTHER"], "no type chosen is Övrigt without a programme");
  await assert.rejects(apply(doc, { action: "save_deviation", deviation: { title: "Lukt", type: "OWN:Lukt" } }, worker), { status: 400 }, "not before the company has the type");
  await assert.rejects(apply(doc, { action: "save_deviation_types", types: ["Lukt"] }, worker), { status: 403 }, "only an admin keeps the types");
  doc = await apply(doc, { action: "save_deviation_types", types: ["Lukt", "lukt", " Läckage "] }, boss);
  assert.deepEqual(doc.deviationTypes, ["Lukt", "Läckage"]);
  doc = await apply(doc, { action: "save_deviation", deviation: { title: "Lukt vid brunnen", type: "OWN:Lukt" } }, worker);
  assert.equal(doc.deviations[2]!.type, "OWN:Lukt");
  // The type is taken away: the entry keeps it, and an admin's change of the entry keeps it too.
  doc = await apply(doc, { action: "save_deviation_types", types: [] }, boss);
  doc = await apply(doc, { action: "save_deviation", deviation: { id: doc.deviations[2]!.id, title: "Lukt vid brunnen, åtgärdad" } }, boss);
  assert.equal(doc.deviations[2]!.type, "OWN:Lukt");
  const view = await selfInspectionView({ ...doc, deviationTypes: ["Lukt"] }, { me: people[0], admin: true, company: "Kommunen", people });
  assert.deepEqual(view.ownDeviationTypes, ["Lukt"]);
  assert.equal(view.hasProgram, false);
  // With a programme Elinstallation is offered and stored, and a missing type is Elinstallation as before.
  let programmed: SelfInspectionDocument = { ...emptySelfInspectionDocument(), program: programFromTemplate({ id: "p", now: "2026-11-28T10:00:00.000Z", newId: () => crypto.randomUUID() }) };
  programmed = await apply(programmed, { action: "save_deviation", deviation: { title: "Elfel", type: "SELF_INSPECTION" } }, worker);
  programmed = await apply(programmed, { action: "save_deviation", deviation: { title: "Från en rad" } }, worker);
  assert.deepEqual(programmed.deviations.map((item) => item.type), ["SELF_INSPECTION", "SELF_INSPECTION"]);
});

test("the log's actions never need the programme's module, the own types included", () => {
  assert.ok(ALWAYS_ON_SELF_INSPECTION_ACTIONS.includes("save_deviation_types"));
  assert.equal(selfInspectionActionNeedsModule("save_deviation_types"), false);
  const server = readFileSync("lib/self-inspection/server.ts", "utf8");
  assert.match(server, /resolvedDeviationType\(\{ kind: sentValue\.kind, sent: sentValue\.type, current: existingType, hasProgram: Boolean\(logProgramId\)/, "Cloud checks the type on the server");
  assert.match(readFileSync("lib/machine/alarm-deviation-server.ts", "utf8"), /type: "OPERATING_FAULT"/, "a machine's alarm is a Driftfel");
  const migration = readFileSync("prisma/migrations/20261128220000_branch_flex/migration.sql", "utf8");
  for (const type of ["SELF_INSPECTION", "RISK_OBSERVATION", "NEAR_MISS", "ACCIDENT", "OPERATING_FAULT", "SAFETY", "QUALITY", "ENVIRONMENT", "OTHER"]) assert.ok(migration.includes(`'${type}'`), type);
  assert.match(migration, /LIKE 'OWN:%'/);
  assert.match(migration.trim(), /^--[\s\S]*BEGIN;[\s\S]*COMMIT;$/);
});

// ---------- the reminders ----------

test("the reminders have neutral text, and the line about the electrical safety authority comes only with a programme", () => {
  const base = { canEdit: true, me: { id: "boss", name: "Berit" }, current: null, myConfirmation: null, deviations: [], credentials: [{ id: "c", personId: "boss", name: "Berit", title: "Heta arbeten", provider: "", issuedAt: null, validUntil: "2026-12-01", note: "", leftAt: null, files: [], createdAt: "", updatedAt: "", state: "DUE_SOON" as const, savedUntil: null }] };
  const without = selfInspectionReminders({ ...base, review: { lastReviewedAt: null, nextDue: null, status: "NONE" } }, "2026-11-28");
  assert.ok(without.every((item) => !/Elsäkerhetsverket|egenkontroll/i.test(`${item.title} ${item.detail ?? ""}`)), JSON.stringify(without));
  assert.equal(without.find((item) => item.id === "self-inspection:credential:c")?.detail, "Se kompetenskortet.");
  const withProgram = selfInspectionReminders({ ...base, review: { lastReviewedAt: null, nextDue: "2026-12-01", status: "DUE_SOON" } }, "2026-11-28");
  assert.match(withProgram.find((item) => item.id === "self-inspection:review")!.detail!, /Elsäkerhetsverket/, "the yearly review belongs to the programme");
  const channel = NOTICE_KINDS.find((kind) => kind.key === "SELF_INSPECTION")!;
  assert.equal(channel.label, "Avvikelser, kompetens och kalibrering");
});

// ---------- 3. the chat's word filter ----------

test("the chat's word filter lets normal VA, district heating and street questions through", () => {
  for (const question of ["Bräddade det vid regnet i natt?", "Hur går snöröjningen?", "Behöver pumpen i brunnen service före snön?", "Hur var temperaturen ute vid undercentralen?", "Prognos för flödet till reningsverket"])
    assert.notEqual(planAnswer(question).kind, "outside", question);
  for (const question of ["Vad blir det för väder i Holsbybrunn idag?", "vem vann fotbollen igår", "Blir det regn i helgen?"]) assert.equal(planAnswer(question).kind, "outside", question);
});

// ---------- 4. the plant templates ----------

test("the plant templates: the eight plants, each with parts and round points, in our own words and without numbers", () => {
  assert.deepEqual(PLANT_TEMPLATES.map((template) => template.name), ["Pumpstation", "Reningsverk", "Reservoar", "Nätstation", "Kopplingsstation", "Fjärrvärmecentral", "Undercentral", "Kraftstation"]);
  assert.equal(new Set(PLANT_TEMPLATE_KEYS).size, PLANT_TEMPLATES.length);
  for (const template of PLANT_TEMPLATES) {
    assert.ok(template.parts.length >= 3 && template.roundPoints.length >= 3, template.name);
    assert.equal(new Set(template.parts).size, template.parts.length, `${template.name}: each part once`);
    const all = [template.name, template.description, ...template.parts, ...template.roundPoints, plantTemplateNotes(template)].join(" ");
    // No limit values or intervals: no digits at all, no units, no "minst/högst/max/min" with a value.
    assert.doesNotMatch(all, /\d/, `${template.name}: no numbers`);
    assert.doesNotMatch(all, /\b(bar|kPa|°C|grader|kV|kW|MW|mA|ampere|volt|procent|mm|m3|l\/s|varje (dag|vecka|månad)|dagligen|veckovis|månadsvis|årligen)\b/i, `${template.name}: no units or intervals`);
    assert.ok(plantTemplateNotes(template).length <= 2000, `${template.name}: fits the notes`);
    assert.match(plantTemplateNotes(template), /Gränsvärden och intervall anger företaget/);
  }
  assert.equal(plantTemplate("pump_station")?.name, "Pumpstation");
  assert.equal(plantTemplate("x"), null);
  const route = readFileSync("app/api/maintenance/route.ts", "utf8");
  assert.match(route, /case "create_from_template": return json\(await createPartFromTemplate\(caller, input\.template, input\.part\)\)/);
  const server = readFileSync("lib/maintenance/server.ts", "utf8");
  const from = server.slice(server.indexOf("export async function createPartFromTemplate"), server.indexOf("export async function updatePart"));
  assert.match(from, /requireMaintenance\(caller, "edit"\)/, "the same right as Ny maskin");
  assert.match(from, /checkPlacement\(tx, caller, null, input\)/, "the place and the owner are the company's");
  assert.match(from, /PART_LIMIT/, "and the company's limit holds");
});
