import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applySelfInspectionAction } from "../lib/self-inspection/document";
import { emptySelfInspectionDocument, programChecks, selfInspectionDocumentSchema, type DraftProgram, type SelfInspectionDocument } from "../lib/self-inspection/model";
import { isOldTemplateVersion, OLD_TEMPLATE_ROLES, OLD_TEMPLATE_VERSIONS, oldTemplateSections, type OldTemplateVersion } from "../lib/self-inspection/template-2026-10-07";
import { programFromTemplate, SELF_INSPECTION_TEMPLATE_VERSION, TEMPLATE_ROLES, TEMPLATE_SECTIONS } from "../lib/self-inspection/template";
import { templateUpgradeVerdict, upgradeLegacySelfInspectionTemplate, upgradeProgramToCurrentTemplate } from "../lib/self-inspection/template-upgrade";
import { templateReleaseSql } from "../scripts/self-inspection/template-release-migration";
import { demoSectionBody } from "../features/demo/demo-self-inspection";
import { createLocalWorkspace, parseLocalWorkspace } from "../features/kfid/local-workspace-store";

// HINTEK's template as version 1 of the product owner's programme (2026-10-08, next-wave 6): the earlier edition
// must not survive as a company's current programme, so an untouched copy is moved; an edited or approved one is left.
let sequence = 0;
const newId = () => `id-${++sequence}`;
const NOW = "2026-10-09T08:00:00.000Z";
const MIGRATION = "prisma/migrations/20261120120000_self_inspection_template_2026_11_20/migration.sql";
const PREVIOUS_MIGRATIONS = [
  ["prisma/migrations/20261009100000_self_inspection_template_v1/migration.sql", "2026-10-08.1"],
  ["prisma/migrations/20261011400000_self_inspection_traceability/migration.sql", "2026-10-11.1"],
] as const;
/** The editions that already had the current ten sections (the appendices among them). */
const TEN_SECTION_EDITIONS: readonly OldTemplateVersion[] = ["2026-10-08.1", "2026-10-11.1"];

/** A company's programme as an earlier edition created it, with people in the roles. */
function oldProgram(version: OldTemplateVersion): DraftProgram {
  return {
    id: "program-1", title: "Egenkontrollprogram", templateVersion: version, activityTypes: ["LV_HOMES"], worksOnOthersInstallations: true, registrationCheckedAt: "2026-05-01", customerId: null, revision: 4,
    sections: oldTemplateSections(version).map((section, sortOrder) => ({ id: `old-${section.key}`, ...section, sortOrder })),
    roles: OLD_TEMPLATE_ROLES.map((role, sortOrder) => ({ id: `role-${role.key}`, ...role, capabilities: [...role.capabilities], sortOrder,
      members: role.key === "ere" ? [{ personId: "u-1", name: "Ada", authorizationLevel: "A" as const, authorizationNumber: "", registered: true }] : role.key === "installer" ? [{ personId: "u-2", name: "Mats", authorizationLevel: "" as const, authorizationNumber: "", registered: false }] : [] })),
    people: [{ personId: "u-2", name: "Mats", workTypes: ["LV_HOMES"], scope: "", assessment: "Utbildad", assessedAt: null, limitations: "", supervised: false }],
    createdAt: "2026-10-06T10:00:00.000Z", updatedAt: "2026-10-07T10:00:00.000Z",
  };
}

test("the earlier editions are frozen: six versions, the current one is none of them", () => {
  assert.deepEqual([...OLD_TEMPLATE_VERSIONS], ["2026-10-06.1", "2026-10-06.2", "2026-10-07.1", "2026-10-07.2", "2026-10-08.1", "2026-10-11.1"]);
  assert.ok(!isOldTemplateVersion(SELF_INSPECTION_TEMPLATE_VERSION));
  assert.ok(SELF_INSPECTION_TEMPLATE_VERSION > OLD_TEMPLATE_VERSIONS.at(-1)!, "the new edition sorts after the earlier ones");
  for (const version of OLD_TEMPLATE_VERSIONS.filter((item) => !TEN_SECTION_EDITIONS.includes(item))) {
    const sections = oldTemplateSections(version);
    assert.equal(sections.length, 11, version);
    assert.ok(sections.some((section) => section.key === "authorization") && sections.some((section) => section.key === "deviations"), "the sections the new edition folds into others");
  }
  // 2026-10-08.1 had the current edition's ten sections; 2026-10-11.1 changed the text of five of them (2026-10-09)
  // and 2026-11-20.1 the opening sentence only (2026-11-20), nothing else: titles, references and the roles are as they were.
  const previous = oldTemplateSections("2026-10-08.1");
  const latest = oldTemplateSections("2026-10-11.1");
  for (const edition of [previous, latest]) assert.deepEqual(edition.map((section) => [section.key, section.title, section.legalRef]), TEMPLATE_SECTIONS.map((section) => [section.key, section.title, section.legalRef]));
  assert.deepEqual(TEMPLATE_SECTIONS.filter((section) => previous.find((item) => item.key === section.key)!.body !== section.body).map((section) => section.key), ["intro", "business", "competence", "planning", "followup"]);
  assert.deepEqual(TEMPLATE_SECTIONS.filter((section) => latest.find((item) => item.key === section.key)!.body !== section.body).map((section) => section.key), ["intro"]);
  assert.deepEqual(latest.filter((section) => previous.find((item) => item.key === section.key)!.body !== section.body).map((section) => section.key), ["intro", "business", "competence", "planning", "followup"]);
  assert.equal(latest.find((section) => section.key === "intro")!.body.split("\n\n").slice(1).join("\n\n"), TEMPLATE_SECTIONS.find((section) => section.key === "intro")!.body.split("\n\n").slice(1).join("\n\n"), "the rest of the introduction is as it was");
  assert.match(latest.find((section) => section.key === "intro")!.body, /^Det här egenkontrollprogrammet är upprättat för att uppfylla kraven/, "the frozen 2026-10-11.1 keeps its old opening");
  // The editions differ where the history says they do, and nowhere else.
  const body = (version: OldTemplateVersion, key: string) => oldTemplateSections(version).find((section) => section.key === key)!.body;
  assert.notEqual(body("2026-10-06.1", "intro"), body("2026-10-06.2", "intro"));
  assert.notEqual(body("2026-10-07.1", "organization"), body("2026-10-07.2", "organization"));
  assert.equal(body("2026-10-06.2", "planning"), body("2026-10-07.2", "planning"));
  assert.deepEqual(OLD_TEMPLATE_ROLES.map((role) => role.key), TEMPLATE_ROLES.map((role) => role.key), "the roles keep their keys, so people, levels and the chart keep working");
});

test("an untouched copy of any earlier edition is moved in place: ids, people, competence and levels kept, nothing approved", () => {
  for (const version of OLD_TEMPLATE_VERSIONS) {
    const before = oldProgram(version);
    assert.deepEqual(templateUpgradeVerdict(before, 0), { upgrade: true }, version);
    const after = upgradeProgramToCurrentTemplate(before, { now: NOW, newId });
    assert.equal(after.templateVersion, SELF_INSPECTION_TEMPLATE_VERSION);
    assert.equal(after.revision, before.revision + 1, "one change, one revision");
    assert.equal(after.id, before.id);
    assert.deepEqual(after.sections.map((section) => section.key), TEMPLATE_SECTIONS.map((section) => section.key));
    assert.deepEqual(after.sections.map((section) => [section.title, section.body, section.legalRef]), TEMPLATE_SECTIONS.map((section) => [section.title, section.body, section.legalRef]));
    for (const section of after.sections) if (section.key !== "appendices" || TEN_SECTION_EDITIONS.includes(version)) assert.equal(section.id, `old-${section.key}`, `${section.key} keeps its id`);
    assert.ok(!after.sections.some((section) => section.id.startsWith("old-authorization") || section.id.startsWith("old-deviations")), "the folded sections are gone");
    assert.deepEqual(after.roles.map((role) => [role.id, role.name, role.level, role.members.length]), TEMPLATE_ROLES.map((role) => [`role-${role.key}`, role.name, role.level, role.key === "ere" || role.key === "installer" ? 1 : 0]));
    assert.deepEqual(after.roles.find((role) => role.key === "ere")!.members[0], before.roles.find((role) => role.key === "ere")!.members[0]);
    assert.deepEqual(after.people, before.people);
    assert.equal(after.activityTypes, before.activityTypes);
    assert.equal(after.registrationCheckedAt, before.registrationCheckedAt);
    assert.deepEqual(templateUpgradeVerdict(after, 0), { upgrade: false, reason: "current" }, "running again does nothing");
    assert.equal(upgradeProgramToCurrentTemplate(after, { now: NOW, newId }), after);
  }
});

test("the first Fastställ after the upgrade is version 1, and the upgraded programme reads as the template to the field check", async () => {
  const program = upgradeProgramToCurrentTemplate(oldProgram("2026-10-07.2"), { now: NOW, newId });
  const doc: SelfInspectionDocument = { ...emptySelfInspectionDocument(), program };
  const approved = await applySelfInspectionAction(doc, { action: "approve", revision: program.revision, changeReason: "Version 1 av programmet." }, { id: "u-1", name: "Ada", admin: true }, { newId, people: [{ id: "u-1", name: "Ada" }, { id: "u-2", name: "Mats" }] });
  assert.deepEqual(approved.versions.map((version) => version.number), [1], "Version 1 gäller");
  assert.equal(approved.versions[0].content.templateVersion, SELF_INSPECTION_TEMPLATE_VERSION);
  assert.equal(approved.versions[0].content.sections.length, TEMPLATE_SECTIONS.length);
  const checks = programChecks(program, "2026-10-09", TEMPLATE_SECTIONS);
  assert.ok(checks.some((check) => check.kind === "TEMPLATE" && /platshållare/.test(check.text)), "the placeholders are still to fill in");
  assert.ok(checks.some((check) => check.kind === "TEMPLATE" && /oförändrade från mallen/.test(check.text)));
});

test("an approved, edited, extended or unknown programme is left as it is, templateVersion included", () => {
  const untouched = oldProgram("2026-10-07.2");
  assert.deepEqual(templateUpgradeVerdict(untouched, 1), { upgrade: false, reason: "approved" });
  const edited = { ...untouched, sections: untouched.sections.map((section) => section.key === "planning" ? { ...section, body: `${section.body}\n\nVår egen rutin.` } : section) };
  assert.deepEqual(templateUpgradeVerdict(edited, 0), { upgrade: false, reason: "edited" });
  assert.equal(upgradeProgramToCurrentTemplate(edited, { now: NOW, newId }), edited, "returned as it was");
  const extended = { ...untouched, sections: [...untouched.sections, { id: "own", key: "", title: "Vårt avsnitt", body: "Text", legalRef: "", sortOrder: 11 }] };
  assert.deepEqual(templateUpgradeVerdict(extended, 0), { upgrade: false, reason: "edited" });
  const trimmed = { ...untouched, sections: untouched.sections.filter((section) => section.key !== "deviations") };
  assert.deepEqual(templateUpgradeVerdict(trimmed, 0), { upgrade: false, reason: "edited" });
  const foreign = { ...untouched, templateVersion: "2025-01-01.1" };
  assert.deepEqual(templateUpgradeVerdict(foreign, 0), { upgrade: false, reason: "unknown-edition" });
  // Whitespace at the ends of a body is not an edit; a renamed role keeps its own name while the sections move.
  const spaced = { ...untouched, sections: untouched.sections.map((section) => ({ ...section, body: `${section.body}\n` })), roles: untouched.roles.map((role) => role.key === "planner" ? { ...role, name: "Arbetsledare" } : role) };
  assert.deepEqual(templateUpgradeVerdict(spaced, 0), { upgrade: true });
  const moved = upgradeProgramToCurrentTemplate(spaced, { now: NOW, newId });
  assert.equal(moved.roles.find((role) => role.key === "planner")!.name, "Arbetsledare");
  assert.equal(moved.roles.find((role) => role.key === "manager")!.name, "VD");
});

test("Local moves the file's programme when it is opened; an approved one stays on its edition", () => {
  const workspace = createLocalWorkspace({ id: "org-local", name: "Lokala Bolaget" });
  const stored = { ...workspace, selfInspection: { ...emptySelfInspectionDocument(), program: oldProgram("2026-10-06.1") } };
  const opened = parseLocalWorkspace(JSON.parse(JSON.stringify(stored)), "org-local");
  assert.equal(opened.selfInspection.program!.templateVersion, SELF_INSPECTION_TEMPLATE_VERSION);
  assert.equal(opened.selfInspection.program!.sections.length, TEMPLATE_SECTIONS.length);
  assert.equal(opened.selfInspection.program!.roles.find((role) => role.key === "installer")!.members[0].personId, "u-2");
  const approvedDoc = upgradeLegacySelfInspectionTemplate({ ...emptySelfInspectionDocument(), program: oldProgram("2026-10-07.2"),
    versions: [{ id: "v1", number: 1, content: { title: "P", templateVersion: "2026-10-07.2", activityTypes: [], worksOnOthersInstallations: true, registrationCheckedAt: null, sections: [], roles: [] }, hash: "", changeReason: "", approvedById: "u-1", approvedByName: "", approvedAt: NOW }] }, { now: NOW, newId });
  assert.equal(approvedDoc.program!.templateVersion, "2026-10-07.2");
  assert.ok(selfInspectionDocumentSchema.safeParse(opened.selfInspection).success);
});

test("the release migration is the same rule as SQL, generated from the code, idempotent and additive", () => {
  // The migration of 2026-11-20.1 is the generated release alone (the earlier ones carried a column too).
  const sql = readFileSync(MIGRATION, "utf8");
  assert.equal(sql, templateReleaseSql(), "the migration in the repository is what the generator writes");
  assert.doesNotMatch(sql, /DROP TABLE "Self|DROP COLUMN|TRUNCATE|ALTER TABLE/);
  for (const [file, edition] of PREVIOUS_MIGRATIONS) assert.match(readFileSync(file, "utf8"), new RegExp(`SET "templateVersion" = '${edition.replace(".", "\\.")}'`), "the earlier edition's migration is history, left as it was");
  for (const version of OLD_TEMPLATE_VERSIONS) assert.ok(sql.includes(`'${version}'`), version);
  assert.ok(sql.includes(`'${SELF_INSPECTION_TEMPLATE_VERSION}'`));
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM "SelfInspectionVersion" v WHERE v\."programId" = p\."id"\)/, "nothing approved");
  assert.match(sql, /btrim\(o\."body", E' \\t\\r\\n'\) = btrim\(s\."body", E' \\t\\r\\n'\)/, "every section still the edition's text, whitespace at the ends aside (the same characters as trim())");
  assert.match(sql, /WHEN '2026-10-07\.2' THEN 11/, "the edition's number of sections");
  assert.match(sql, /WHEN '2026-10-08\.1' THEN 10/);
  assert.match(sql, /WHEN '2026-10-11\.1' THEN 10/);
  for (const section of TEMPLATE_SECTIONS) assert.ok(sql.includes(`'${section.body.replace(/'/g, "''")}'`), `${section.key} text`);
  assert.match(sql, /DELETE FROM "SelfInspectionSection" s USING "si_template_upgrade" u WHERE s\."programId" = u\."id" AND s\."key" IN \('authorization', 'deviations'\)/);
  assert.match(sql, /u\."id" \|\| '-appendices'/, "the new section gets a stable id");
  for (const role of TEMPLATE_ROLES) assert.ok(sql.includes(`r."key" = '${role.key}' AND btrim(r."name", E' \\t\\r\\n') = '${OLD_TEMPLATE_ROLES.find((item) => item.key === role.key)!.name}'`), `${role.key}: only where the role still reads as the earlier edition`);
  assert.match(sql, /'self_inspection_template_kept'/, "programmes left alone are listed in the history");
  assert.match(sql, /'self_inspection_template_upgraded'/);
  assert.match(sql, /SET "templateVersion" = '2026-11-20\.1', "revision" = p\."revision" \+ 1/);
  assert.match(sql, /'si-template-upgraded-2026-11-20\.1-' \|\| u\."id"/, "one history row per programme and edition");
  assert.ok(sql.indexOf("'self_inspection_template_kept'") < sql.indexOf('UPDATE "SelfInspectionProgram"'), "the log of what is kept is written before anything changes");
  // One transaction, and the working tables go with the commit: the migration check (scripts/qa/migration-check.cjs) passes it as it is.
  assert.match(sql, /^(?:--[^\n]*\n)*BEGIN;\n/, "BEGIN is the first statement");
  assert.ok(sql.trimEnd().endsWith("COMMIT;"), "COMMIT is the last");
  assert.match(sql, /CREATE TEMP TABLE "si_template_old_edition" \([^)]*\) ON COMMIT DROP;/);
  assert.match(sql, /CREATE TEMP TABLE "si_template_upgrade" ON COMMIT DROP AS/);
  assert.doesNotMatch(sql, /DROP TABLE|migration-check:/);
  // No personal data in a migration either.
  for (const name of ["Dan" + "iel", "Einar" + "sson", "Power Solutions", "hintek.se"]) assert.ok(!sql.includes(name), name);
});

test("edition 2026-10-11.1 says in plain words that names stay in approved versions, and fills the gaps the regulation check found", () => {
  const body = (key: string) => TEMPLATE_SECTIONS.find((section) => section.key === key)!.body;
  assert.match(body("followup"), /## 9\.4 Ändringar, versioner och spårbarhet/);
  assert.match(body("followup"), /ligger kvar i versionen även om en person senare slutar, tas bort ur Workflow eller får sitt kompetenskort raderat/, "names stay for traceability");
  assert.match(body("followup"), /ser sin egen kompetensbedömning/);
  assert.match(body("followup"), /även mellan de årliga översynerna/, "updated when something changes, not only yearly (3 kap. 13 §)");
  assert.match(body("followup"), /om rutinerna fungerar i praktiken och om egenkontrollen räcker/, "how follow-up is done (3 kap. 12 §)");
  assert.match(body("intro"), /skrivet på svenska/, "the language (3 kap. 2 §)");
  assert.match(body("business"), /## 2\.4 Inhyrd personal och underentreprenörer/, "hired staff under this programme, a subcontractor under its own");
  assert.match(body("competence"), /Finns ingen med rätt kompetens/, "what happens when nobody has the competence");
  assert.match(body("planning"), /Ingen utför elinstallationsarbete som hen inte har fått tilldelat/);
  // Workflow's own words: no regulation text is quoted (a few telltale phrases of the regulation are absent).
  for (const phrase of ["ska innehålla de system och de rutiner som krävs", "förändringar som har betydelse för egenkontrollen", "försäkra sig om att registreringen"])
    assert.ok(!TEMPLATE_SECTIONS.some((section) => section.body.includes(phrase)), phrase);
  assert.doesNotMatch(TEMPLATE_SECTIONS.map((section) => section.body).join("\n"), /handbok|Elsäkerhetsverkets mall/i, "no reference to the authority's handbook or template");
});

test("edition 2026-11-20.1 opens in our own words (the precautionary principle, 2026-11-20) and changes nothing else", () => {
  const intro = TEMPLATE_SECTIONS.find((section) => section.key === "intro")!.body;
  assert.match(intro, /^\[Företagets namn\], organisationsnummer \[organisationsnummer\], utövar egenkontroll över sitt elinstallationsarbete enligt det här programmet\. Programmet svarar mot 24 § elsäkerhetslagen och ELSÄK-FS 2017:3\.\n\n/);
  // The authority's template cover's line is gone from every text of the current edition.
  for (const section of TEMPLATE_SECTIONS) assert.doesNotMatch(section.body, /upprättat för att uppfylla kraven/, section.key);
  assert.ok(!TEMPLATE_SECTIONS.some((section) => section.body.includes("Det här egenkontrollprogrammet är upprättat")));
  // The two sentences near regulation text stay as they were (their proposed rewrites would have changed the meaning).
  assert.match(TEMPLATE_SECTIONS.find((section) => section.key === "competence")!.body, /god elsäkerhetsteknisk praxis samt den säkerhetsnivå som är etablerad inom elsäkerhetsområdet/);
  assert.match(TEMPLATE_SECTIONS.find((section) => section.key === "requirements")!.body, /kunna styrka att säkerhetsnivån på det alternativa utförandet minst motsvarar standardens/);
  assert.equal(TEMPLATE_ROLES.length, 8, "the roles are untouched");
});

test("every place that creates a programme uses the new edition; the demo fills the placeholders with invented facts only", () => {
  assert.equal(programFromTemplate({ id: "p", now: NOW, newId }).templateVersion, SELF_INSPECTION_TEMPLATE_VERSION);
  assert.match(readFileSync("lib/self-inspection/server.ts", "utf8"), /templateVersion: SELF_INSPECTION_TEMPLATE_VERSION/);
  assert.match(readFileSync("features/kfid/local-workspace-store.ts", "utf8"), /moveLegacyCustomerRequirements\(upgradeLegacySelfInspection\(workspace\)\)/, "Local upgrades on open");
  assert.doesNotMatch(readFileSync("lib/self-inspection/template.ts", "utf8"), /2026-10-07\.2|2026-10-06\.|upprättat för att uppfylla kraven/, "the earlier editions live only in the frozen files");
  const filled = TEMPLATE_SECTIONS.map((section) => demoSectionBody(section.body)).join("\n");
  assert.doesNotMatch(filled, /\[[^\]\n]+\]/, "no placeholder left");
  assert.match(filled, /999999-9999/);
  assert.match(filled, /exempelel\.invalid/);
  assert.doesNotMatch(filled, /@hintek\.se|070-680|Holsby|Hagagatan/, "none of the real company's contact details");
});
