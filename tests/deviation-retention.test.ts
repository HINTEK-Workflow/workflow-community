// Lagringstid för avvikelser, tillbud och olycksfall (decision 2026-11-04, lib/self-inspection/retention.ts): the pure rules. The database side
// is in tests/deviation-retention.integration.ts.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { pdfTexts } from "../lib/pdf-templates/catalog";
import {
  DEVIATION_PERSONAL_DATA_REMOVED_TITLE, DEVIATION_RETENTION_MONTHS, DEVIATION_RETENTION_RULE_START, DEVIATION_RETENTION_SYSTEM_USER, DEVIATION_RETENTION_TEXT, deviationPersonalDataWhere,
  deviationRemovalWhere, deviationRetentionCutoffs, deviationRetentionDates, deviationRetentionDetail, deviationRetentionLine, personalDataRemovedPatch,
} from "../lib/self-inspection/retention";

const day = (value: Date | null | undefined) => value?.toISOString().slice(0, 10) ?? null;

test("the times are three, in full years, and the event outlives the person's details", () => {
  assert.deepEqual(DEVIATION_RETENTION_MONTHS, { general: 60, incident: 120, personalData: 36 });
  assert.ok(DEVIATION_RETENTION_MONTHS.personalData < DEVIATION_RETENTION_MONTHS.general && DEVIATION_RETENTION_MONTHS.general < DEVIATION_RETENTION_MONTHS.incident);
});

test("nothing can apply before a time has run from the day the rule came", () => {
  const cutoffs = (value: string) => deviationRetentionCutoffs(new Date(value));
  assert.deepEqual(cutoffs("2026-11-05T12:00:00Z"), { general: null, incident: null, personalData: null });
  assert.deepEqual(cutoffs("2029-11-04T00:00:00Z"), { general: null, incident: null, personalData: null }, "exactly three years is not yet past it");
  assert.equal(day(cutoffs("2029-11-05T00:00:00Z").personalData), "2026-11-05");
  assert.equal(cutoffs("2029-11-05T00:00:00Z").general, null);
  assert.equal(day(cutoffs("2031-11-05T00:00:00Z").general), "2026-11-05");
  assert.equal(cutoffs("2031-11-05T00:00:00Z").incident, null);
  assert.equal(day(cutoffs("2036-11-05T00:00:00Z").incident), "2026-11-05");
  assert.equal(deviationRemovalWhere("org", cutoffs("2029-11-05T00:00:00Z")), null);
  assert.equal(deviationPersonalDataWhere("org", cutoffs("2029-11-04T00:00:00Z")), null);
});

test("the filters are always one company's closed entries without a hold", () => {
  const cutoffs = deviationRetentionCutoffs(new Date("2040-01-15T00:00:00Z"));
  const removal = deviationRemovalWhere("org-a", cutoffs)!;
  assert.equal(removal.organizationId, "org-a");
  assert.equal(removal.status, "DONE");
  assert.equal(removal.retentionHoldAt, null);
  assert.deepEqual(removal.OR.map((step) => [step.type.in, day(step.closedAt.lt)]), [[["SELF_INSPECTION", "RISK_OBSERVATION"], "2035-01-15"], [["NEAR_MISS", "ACCIDENT"], "2030-01-15"]]);
  const personal = deviationPersonalDataWhere("org-a", cutoffs)!;
  assert.equal(personal.organizationId, "org-a");
  assert.equal(personal.status, "DONE");
  assert.equal(personal.retentionHoldAt, null);
  assert.equal(personal.personalDataRemovedAt, null, "done once per entry");
  assert.deepEqual(personal.type.in, ["NEAR_MISS", "ACCIDENT"], "an ordinary deviation keeps its text until it goes");
  assert.equal(day(personal.closedAt.lt), "2037-01-15");
});

test("the patch takes everything that names or describes a person and leaves the investigation's result", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  const patch = personalDataRemovedPatch(now);
  assert.deepEqual(Object.keys(patch).sort(), ["closedById", "closedByName", "description", "doneNote", "followUp", "personalDataRemovedAt", "reportedById", "reportedToAuthorityById", "responsibleUserId", "sourceTitle", "title", "whatHappened"]);
  assert.equal(patch.title, DEVIATION_PERSONAL_DATA_REMOVED_TITLE);
  assert.equal(patch.reportedById, DEVIATION_RETENTION_SYSTEM_USER);
  assert.equal(patch.personalDataRemovedAt, now);
  for (const kept of ["cause", "action", "occurredAt", "serious", "personalInjury", "electrical", "severity", "type", "reportedToAuthorityAt", "closedAt"]) assert.ok(!(kept in patch), `${kept} stays`);
});

test("an entry's dates: from closing, never earlier than the rule, nothing for an open or held entry", () => {
  const dates = (entry: Parameters<typeof deviationRetentionDates>[0]) => { const value = deviationRetentionDates(entry); return value ? [day(value.personalData), day(value.removal)] : null; };
  assert.equal(dates({ status: "OPEN", closedAt: null }), null);
  assert.equal(dates({ status: "IN_PROGRESS", closedAt: "2027-01-01T00:00:00Z" }), null);
  assert.equal(dates({ status: "DONE", closedAt: null }), null, "without a closing day nothing is coming");
  assert.equal(dates({ status: "DONE", closedAt: "2027-01-01T00:00:00Z", retentionHoldAt: "2028-01-01T00:00:00Z" }), null);
  assert.deepEqual(dates({ type: "SELF_INSPECTION", status: "DONE", closedAt: "2027-03-31T00:00:00Z" }), [null, "2032-03-31"]);
  assert.deepEqual(dates({ type: "RISK_OBSERVATION", status: "DONE", closedAt: "2027-03-31T00:00:00Z" }), [null, "2032-03-31"]);
  assert.deepEqual(dates({ type: "ACCIDENT", status: "DONE", closedAt: "2027-03-31T00:00:00Z" }), ["2030-03-31", "2037-03-31"]);
  assert.deepEqual(dates({ type: "NEAR_MISS", status: "DONE", closedAt: "2027-03-31T00:00:00Z", personalDataRemovedAt: "2030-03-31T00:00:00Z" }), [null, "2037-03-31"]);
  assert.deepEqual(dates({ type: "ACCIDENT", status: "DONE", closedAt: "2020-01-01T00:00:00Z" }), ["2029-11-04", "2036-11-04"], "closed before the rule: counted from the rule");
  assert.equal(day(DEVIATION_RETENTION_RULE_START), "2026-11-04");
});

test("the line says what is coming and warns within 90 days", () => {
  const now = new Date("2029-12-01T12:00:00Z");
  assert.equal(deviationRetentionLine({ type: "ACCIDENT", status: "OPEN", closedAt: null }, now), null);
  assert.deepEqual(deviationRetentionLine({ type: "ACCIDENT", status: "DONE", closedAt: "2028-01-01T12:00:00Z" }, now), { text: "Namn, text och bilder tas bort 2031-01-01. Resten tas bort 2038-01-01.", warning: false });
  assert.deepEqual(deviationRetentionLine({ type: "ACCIDENT", status: "DONE", closedAt: "2027-01-10T12:00:00Z" }, now), { text: "Namn, text och bilder tas bort 2030-01-10. Resten tas bort 2037-01-10.", warning: true });
  assert.deepEqual(deviationRetentionLine({ type: "SELF_INSPECTION", status: "DONE", closedAt: "2027-01-10T12:00:00Z" }, now), { text: "Avvikelsen tas bort 2032-01-10.", warning: false });
  assert.deepEqual(deviationRetentionLine({ type: "ACCIDENT", status: "DONE", closedAt: "2027-01-10T12:00:00Z", personalDataRemovedAt: "2030-01-10T12:00:00Z" }, now), { text: "Namn, text och bilder togs bort 2030-01-10. Resten tas bort 2037-01-10.", warning: false });
  assert.deepEqual(deviationRetentionLine({ type: "ACCIDENT", status: "DONE", closedAt: "2027-01-10T12:00:00Z", retentionHoldAt: "2029-01-10T12:00:00Z" }, now), { text: "Sparas tills vidare.", warning: false });
});

test("the night's history line holds counts, nothing else", () => {
  assert.equal(deviationRetentionDetail({ removed: 1, personalData: 2, files: 1 }), "Avvikelser rensades efter lagringstiden: 1 post togs bort, 2 tillbud och olycksfall utan namn och text, 1 fil.");
  assert.equal(deviationRetentionDetail({ removed: 3, personalData: 1, files: 0 }), "Avvikelser rensades efter lagringstiden: 3 poster togs bort, 1 tillbud eller olycksfall utan namn och text, 0 filer.");
});

test("the log, the PDF and the policies say the same times", { skip: !existsSync("docs/legal/final/privacy-2026-11-12.1.md") && "docs/ is not part of the Community edition" }, () => {
  assert.equal(pdfTexts("deviation").text("retention.note"), DEVIATION_RETENTION_TEXT);
  assert.match(DEVIATION_RETENTION_TEXT, /5 år.*10 år.*3 år/);
  const privacy = readFileSync("docs/legal/final/privacy-2026-11-12.1.md", "utf8");
  assert.match(privacy, /\*\*Avvikelser, tillbud och olycksfall:\*\*[^\n]*5 år[^\n]*10 år[^\n]*3 år/);
  const dpa = readFileSync("docs/legal/final/dpa-2026-11-06.1.md", "utf8");
  assert.match(dpa, /Avvikelser, tillbud och olycksfall[^\n]*5 år[^\n]*10 år[^\n]*3 år/);
});

test("the export of a Local file and the demo do not claim the rule: only Cloud's export asks for the line", () => {
  assert.match(readFileSync("lib/self-inspection/deviation-export-server.ts", "utf8"), /retentionNote: true/);
  assert.doesNotMatch(readFileSync("features/self-inspection/deviation-export-menu.tsx", "utf8"), /retentionNote/);
});

test("the nightly job runs it, with the dry run", () => {
  assert.match(readFileSync("scripts/history/run-retention.ts", "utf8"), /purgeExpiredDeviations\(new Date\(\), \{ dryRun \}\)/);
});
