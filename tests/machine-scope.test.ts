import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DAILY_CAP_MAX, DAILY_CAP_MIN, parseScopeKey, resolveScope, runStateChange, runStateNote, SCOPE_KEY_PATTERN, STOP_BEFORE_ALARM_MS } from "../lib/machine/alarm-scope";
import { decideAlarm, DAILY_ALARM_ORDER_CAP } from "../lib/machine/alarm-rules";
import { machineEventLine, machineStatus } from "../lib/machine/place-status";

// Integrationsmotorn E1 (2026-10-24): the object decides, not the device. Since Underhåll (2026-10-30) the object is a
// part in the machine tree (part:<id>). The rules without a database.

test("the scope: the signal's part, the source's default part, the signal, the source – in that order", () => {
  assert.deepEqual(resolveScope({ sourceId: "s1", sourcePartId: null }), { scopeKey: "source:s1", partId: null });
  assert.deepEqual(resolveScope({ sourceId: "s1", sourcePartId: "f1" }), { scopeKey: "part:f1", partId: "f1" });
  assert.deepEqual(resolveScope({ sourceId: "s1", sourcePartId: "f1", signal: { id: "g1", partId: "f2" } }), { scopeKey: "part:f2", partId: "f2" });
  assert.deepEqual(resolveScope({ sourceId: "s1", sourcePartId: "f1", signal: { id: "g1", partId: null } }), { scopeKey: "part:f1", partId: "f1" });
  assert.deepEqual(resolveScope({ sourceId: "s1", sourcePartId: null, signal: { id: "g1", partId: null } }), { scopeKey: "signal:g1", partId: null });
  // Two sources on the same part share the scope; one router for several machines does not.
  assert.equal(resolveScope({ sourceId: "a", sourcePartId: "f9" }).scopeKey, resolveScope({ sourceId: "b", sourcePartId: "f9" }).scopeKey);
  assert.notEqual(resolveScope({ sourceId: "a", sourcePartId: null, signal: { id: "g1", partId: "m1" } }).scopeKey, resolveScope({ sourceId: "a", sourcePartId: null, signal: { id: "g2", partId: "m2" } }).scopeKey);
});

test("the scope key has one fixed form, the same as the database's CHECK", () => {
  assert.deepEqual(parseScopeKey("part:cm1abc"), { kind: "part", id: "cm1abc" });
  assert.deepEqual(parseScopeKey("facility:cm1abc"), { kind: "facility", id: "cm1abc" }, "old rows keep their key");
  assert.deepEqual(parseScopeKey("source:0a1b"), { kind: "source", id: "0a1b" });
  for (const bad of ["", "facility:", "place:x", "facility:a b", "source:x;drop", `source:${"x".repeat(101)}`]) assert.equal(parseScopeKey(bad), null, bad);
  const sql = readFileSync("prisma/migrations/20261031090000_maintenance_module/migration.sql", "utf8");
  assert.ok(sql.includes(`"MachineAlarmOrder_scopeKey_check" CHECK ("scopeKey" ~ '${SCOPE_KEY_PATTERN.source}')`), "the CHECK is the code's pattern");
  assert.ok(sql.includes(`"MachineSuggestion_scopeKey_check" CHECK ("scopeKey" ~ '${SCOPE_KEY_PATTERN.source}')`), "the same for the suggestions");
});

test("the migration backfills the scope before it is required and replaces the open-row index by one per scope", () => {
  const sql = readFileSync("prisma/migrations/20261024160000_machine_scope_per_object/migration.sql", "utf8");
  const backfill = sql.indexOf(`UPDATE "MachineAlarmOrder" SET "scopeKey" = 'source:' || "sourceId"`);
  assert.ok(backfill > 0, "existing rows get their source as scope");
  assert.ok(backfill < sql.indexOf(`ALTER COLUMN "scopeKey" SET NOT NULL`), "before NOT NULL");
  assert.match(sql, /DROP INDEX "MachineAlarmOrder_one_open_per_source";/);
  assert.match(sql, /CREATE UNIQUE INDEX "MachineAlarmOrder_one_open_per_scope" ON "MachineAlarmOrder"\("organizationId", "scopeKey"\) WHERE "status" IN \('pending', 'created'\);/);
  for (const table of ["MachineSource", "MachineEvent", "MachineAlarmOrder"]) {
    assert.match(sql, new RegExp(`CREATE TRIGGER "${table}_facility_tenant" BEFORE INSERT OR UPDATE OF "facilityId", "organizationId" ON "${table}"`), `${table} keeps the object in its company`);
    assert.match(sql, new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_facilityId_fkey" FOREIGN KEY \\("facilityId"\\) REFERENCES "CustomerFacility"\\("id"\\) ON DELETE SET NULL`));
  }
  assert.doesNotMatch(sql, /^\s*(DELETE|TRUNCATE|DROP TABLE)\b|DROP COLUMN/im, "additive: nothing removed");
  assert.match(sql, new RegExp(`"machineDailyOrderCap" INTEGER NOT NULL DEFAULT ${DAILY_ALARM_ORDER_CAP}`));
  assert.match(sql, new RegExp(`BETWEEN ${DAILY_CAP_MIN} AND ${DAILY_CAP_MAX}`));
});

test("the daily cap is the company's own when given", () => {
  const facts = { mode: "direct" as const, now: new Date(), cooldownMinutes: 30, lastRowAt: null, rowsToday: 20 };
  assert.deepEqual(decideAlarm(facts), { act: "skip", reason: "daily_cap" }, "20 by default");
  assert.deepEqual(decideAlarm({ ...facts, dailyCap: 50 }), { act: "create" }, "Workflow raised it for the company");
  assert.deepEqual(decideAlarm({ ...facts, rowsToday: 1, dailyCap: 1 }), { act: "skip", reason: "daily_cap" });
});

test("the machine's run state fills Ur drift and Åter i drift once, never over a value already there", () => {
  const alarmAt = new Date("2026-10-24T10:00:00Z");
  const t = (iso: string) => new Date(iso);
  const base = { alarmAt, stoppedAt: null, restoredAt: null };
  assert.deepEqual(runStateChange({ ...base, state: "stopped", occurredAt: t("2026-10-24T10:01:00Z") }), { field: "stoppedAt", value: "2026-10-24T10:01:00.000Z" });
  // A stop sent just before the alarm counts; one long before does not.
  assert.ok(runStateChange({ ...base, state: "stopped", occurredAt: new Date(alarmAt.getTime() - STOP_BEFORE_ALARM_MS) }));
  assert.equal(runStateChange({ ...base, state: "stopped", occurredAt: new Date(alarmAt.getTime() - STOP_BEFORE_ALARM_MS - 1) }), null);
  // Running without a stop is not "back in service" (a machine that reports running all along).
  assert.equal(runStateChange({ ...base, state: "running", occurredAt: t("2026-10-24T10:05:00Z") }), null);
  assert.deepEqual(runStateChange({ ...base, stoppedAt: "2026-10-24T10:01:00.000Z", state: "running", occurredAt: t("2026-10-24T10:30:00Z") }), { field: "restoredAt", value: "2026-10-24T10:30:00.000Z" });
  // Never before the stop, never twice, never over a person's value.
  assert.equal(runStateChange({ ...base, stoppedAt: "2026-10-24T10:20:00.000Z", state: "running", occurredAt: t("2026-10-24T10:10:00Z") }), null);
  assert.equal(runStateChange({ ...base, stoppedAt: "2026-10-24T10:01:00.000Z", restoredAt: "2026-10-24T10:30:00.000Z", state: "running", occurredAt: t("2026-10-24T11:00:00Z") }), null);
  assert.equal(runStateChange({ ...base, stoppedAt: "2026-10-24T09:00:00.000Z", state: "stopped", occurredAt: t("2026-10-24T10:02:00Z") }), null);
  assert.equal(runStateChange({ ...base, restoredAt: "2026-10-24T10:30:00.000Z", state: "stopped", occurredAt: t("2026-10-24T11:00:00Z") }), null, "a completed stop is not opened again");
  assert.equal(runStateChange({ ...base, stoppedAt: "inte en tid", state: "running", occurredAt: t("2026-10-24T11:00:00Z") }), null);
  assert.match(runStateNote("stoppedAt", "PLC hall 1"), /PLC hall 1 rapporterade stopp \(Ur drift\)/);
  assert.match(runStateNote("restoredAt", ""), /källan rapporterade i drift \(Åter i drift\)/);
});

test("the place's machine status: an open alarm first, then the run state; nothing without machines", () => {
  const none = { sources: 0, state: null, stateAt: null, lastHeardAt: null, openOrders: 0, pendingOrders: 0 };
  assert.equal(machineStatus(none), null);
  assert.deepEqual(machineStatus({ ...none, sources: 1 }), { ...none, sources: 1, label: "Har inte hörts av ännu", tone: "neutral" });
  assert.equal(machineStatus({ ...none, sources: 1, lastHeardAt: "2026-10-24T10:00:00Z" })?.label, "Inget driftläge");
  assert.equal(machineStatus({ ...none, sources: 1, state: "running", stateAt: "2026-10-24T10:00:00Z" })?.tone, "success");
  assert.equal(machineStatus({ ...none, sources: 1, state: "stopped", stateAt: "2026-10-24T10:00:00Z" })?.label, "Stoppad");
  const alarm = machineStatus({ ...none, sources: 2, state: "running", stateAt: "2026-10-24T10:00:00Z", openOrders: 1, pendingOrders: 1 });
  assert.equal(alarm?.tone, "danger");
  assert.equal(alarm?.label, "Larm: 2 öppna automatiska arbetsordrar");
  assert.equal(machineStatus({ ...none, openOrders: 1 })?.label, "Larm: 1 öppen automatisk arbetsorder", "a moved source's open order still shows");
  assert.equal(machineEventLine({ type: "alarm", code: "E12", state: "raised", text: " Motor 2 " }), "Larm E12 · Utlöst · Motor 2");
  assert.equal(machineEventLine({ type: "state", code: "RUN", state: "running", text: "" }), "Driftläge RUN · I drift");
});

test("no manufacturer in the engine's code (decision 9)", () => {
  for (const path of ["lib/machine/alarm-scope.ts", "lib/machine/run-state.ts", "lib/machine/place-status.ts", "lib/kfid/place-machine-server.ts", "features/integrations/machine-status.tsx"])
    assert.doesNotMatch(readFileSync(path, "utf8"), /teltonika|rutos|rut200|siemens|schneider/i, path);
});

test("the part's events and status follow the Underhåll right, and set_part checks Origin and the admin", () => {
  const server = readFileSync("lib/kfid/place-machine-server.ts", "utf8");
  assert.match(server, /ctx\.admin \|\| hasWorkflowPermission\(ctx\.workflowPermissions, "work-order", "read"\)/);
  const parts = readFileSync("lib/maintenance/machine-server.ts", "utf8");
  assert.match(parts, /requireMaintenance\(caller, "read"\)/);
  assert.match(parts, /organizationId: caller\.organizationId/);
  const handler = readFileSync("lib/api-handlers/machine-sources.ts", "utf8");
  const post = handler.slice(handler.indexOf("export async function POST"));
  assert.ok(post.indexOf("checkOrigin(request)") < post.indexOf("await admin()") && post.indexOf("await admin()") < post.indexOf(`input.action === "set_part"`));
  assert.match(post, /machinePart\.findFirst\(\{ where: \{ id: input\.partId, organizationId: ctx\.organizationId/);
  const superadmin = readFileSync("app/api/superadmin/customer-companies/route.ts", "utf8");
  assert.match(superadmin, /machineDailyOrderCap: z\.number\(\)\.int\(\)\.min\(DAILY_CAP_MIN/);
});
