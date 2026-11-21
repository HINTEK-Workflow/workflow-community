import assert from "node:assert/strict";
import test from "node:test";
import { formScheduleInputSchema, repeatScheduleDraft, roundHref, roundLegacyPlace, roundWhereLabel, scheduleTempPlace, type FormSchedule, type RoundOrderRef } from "../lib/workflow/form-schedule";
import { planningRounds } from "../lib/workflow/planning-rounds";
import { roundOrderRef, withRoundOrderTempPlace } from "../lib/workflow/round-work-orders";
import { tempPlaceOf } from "../lib/workflow/temp-place";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalFormSchedule, type LocalWorkspaceDocument } from "../features/kfid/local-workspace-store";

/**
 * Tillfällig plats och driftronden (2026-10-08; ändrat 2026-10-27 kväll: "Ronden är framför allt tidsreglerna som ställs
 * in – kund och plats hänger med från arbetsordern"): the temporary place is the work order's that holds the round, and it
 * follows into every protocol started in it. A round stored before then keeps its own, untouched, only as a suggestion.
 */
const temp = { address: "Bodvägen 2", postalCode: "123 45", city: "Elstad", latitude: 57.7, longitude: 11.9 };
const protocol = { title: "Kontroll i bod", assignedToUserId: null, assignedToName: "", data: { details: { templateId: "form-1", templateName: "Fortlöpande kontroll" }, tempPlace: temp } };
const schedule = (extra: Partial<FormSchedule> = {}): FormSchedule => ({ id: "s1", version: 1, title: "Rond", templateId: "form-1",
  assignedToUserId: null, assignedToName: "", active: true, rule: { frequency: "DAILY", interval: 1, weekdays: [], startDate: "2026-10-01", endDate: "" }, reminders: { bell: true, email: false }, ...extra });
const holder = (extra: Partial<RoundOrderRef> = {}): RoundOrderRef => ({ scheduleId: "s1", id: "wo-1", status: "PLANNED", title: "Rond 2026", occurrence: null, from: "2026-10-01", to: "2026-12-31", ...extra });

test("a round has no temporary place of its own: the schema drops one an older client sends, Upprepa kontrollen makes none", () => {
  const base = { title: "Rond", templateId: "form-1", rule: { startDate: "2026-10-01" } };
  const parsed = formScheduleInputSchema.parse({ ...base, tempPlace: temp, customerId: "c1", facilityId: "f1", projectId: "p1" });
  for (const key of ["tempPlace", "customerId", "facilityId", "projectId"]) assert.equal(key in parsed, false, `${key} is not the round's`);
  assert.equal("tempPlace" in repeatScheduleDraft(protocol, "2026-10-08"), false);
  assert.equal(scheduleTempPlace(null), null);
  assert.equal(scheduleTempPlace({ latitude: 91, longitude: 0 }), null, "a malformed stored value reads as none");
  assert.deepEqual(scheduleTempPlace(temp), temp);
  assert.deepEqual(roundLegacyPlace({ customerId: null, facilityId: null, tempPlace: temp }), { customerId: null, facilityId: null, projectId: null, tempPlace: temp }, "an older round's own place is kept as its suggestion");
  assert.equal(roundLegacyPlace({ customerId: null, facilityId: null, projectId: null, tempPlace: null }), null);
});

test("the round link carries no place: the protocol takes the work order's temporary place when it is started in it", () => {
  const href = new URL(roundHref(schedule(), { date: "2026-10-12", workOrderId: "wo-1" }), "http://x");
  for (const key of ["tempPlace", "customerId", "facilityId", "projectId"]) assert.equal(href.searchParams.has(key), false, key);
  assert.equal(href.searchParams.get("workOrderId"), "wo-1");
  const started = { kind: "FORM", details: { values: { round: { scheduleId: "s1", occurrence: "2026-10-12" } } } };
  assert.deepEqual(tempPlaceOf(withRoundOrderTempPlace(started, { kind: "WORK_ORDER", tempPlace: temp })), temp, "the work order's temporary place");
  const own = { ...temp, address: "Egen bod" };
  assert.deepEqual(tempPlaceOf(withRoundOrderTempPlace({ ...started, tempPlace: own }, { tempPlace: temp })), own, "a protocol's own place is kept");
  assert.equal(tempPlaceOf(withRoundOrderTempPlace(started, { kind: "WORK_ORDER" })), null, "a work order without one gives none");
  assert.deepEqual(roundOrderRef({ id: "wo-1", status: "PLANNED", roundScheduleId: "s1", plannedStartDate: "2026-10-01", dueDate: "2026-12-31", data: { tempPlace: temp } })?.tempPlace, temp, "Local and the demo read it from the data");
  assert.deepEqual(roundOrderRef({ id: "wo-1", status: "PLANNED", roundScheduleId: "s1", plannedStartDate: "2026-10-01", dueDate: "2026-12-31", tempPlace: temp })?.tempPlace, temp, "Cloud passes it read");
});

test("Planering shows the work order's place and temporary place for the day; a day without a work order says so", () => {
  const period = { from: "2026-10-08", to: "2026-10-08" };
  const [both] = planningRounds([schedule()], [], period, "2026-10-08", undefined, [holder({ facilityName: "Ställverket", tempPlace: temp })]).rounds;
  assert.equal(both.facilityName, "Ställverket · Tillfällig: Bodvägen 2, 123 45 Elstad");
  const [only] = planningRounds([schedule()], [], period, "2026-10-08", undefined, [holder({ tempPlace: temp })]).rounds;
  assert.equal(only.facilityName, "Tillfällig: Bodvägen 2, 123 45 Elstad");
  assert.equal(new URL(only.href, "http://x").searchParams.has("tempPlace"), false, "the protocol takes it from the work order, not the link");
  const [none] = planningRounds([schedule({ legacyPlace: { customerId: "c1", facilityId: "f1", projectId: null, tempPlace: temp } })], [], period, "2026-10-08").rounds;
  assert.equal(none.facilityName, "Ingen arbetsorder", "an older round's own place is not shown as where it is done");
  assert.equal(roundWhereLabel(null), "Ingen arbetsorder");
});

test("Local keeps what an older round stored in the file untouched, and a new round stores no place", () => {
  const workspace: LocalWorkspaceDocument = createLocalWorkspace({ id: "org-local", name: "Elkraft" });
  const input = { title: "Rond i bod", templateId: "form-1", assignedToUserId: null, assignedToName: "", active: true,
    rule: { frequency: "MONTHLY" as const, interval: 6, weekdays: [], startDate: "2027-04-08", endDate: "" } };
  const { workspace: saved, id } = saveLocalFormSchedule(workspace, { ...input, tempPlace: temp } as typeof input, "Fortlöpande kontroll");
  assert.equal(saved.formSchedules.find((item) => item.id === id)?.tempPlace, null, "a new round has no place of its own");
  // A file from before 2026-10-27 (kväll): the round has its own temporary place; changing the round keeps it as it is.
  const older = JSON.parse(JSON.stringify(saved));
  older.formSchedules[0].tempPlace = temp;
  const reopened = parseLocalWorkspace(older, "org-local");
  const { workspace: changed } = saveLocalFormSchedule(reopened, { ...input, id, version: 1, title: "Ny titel" }, "Fortlöpande kontroll");
  assert.deepEqual(changed.formSchedules[0].tempPlace, temp, "the stored place is never changed");
  assert.equal(changed.formSchedules[0].title, "Ny titel");
  older.formSchedules[0].tempPlace = { latitude: 1 };
  assert.equal(parseLocalWorkspace(older, "org-local").formSchedules[0].tempPlace, null, "a broken value is read as none, the file still opens");
});
