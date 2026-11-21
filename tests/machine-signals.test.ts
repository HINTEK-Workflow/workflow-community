import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { admitNewSignals, cleanSignalText, codeSignalKey, MAX_SIGNALS_PER_COMPANY, MAX_SIGNALS_PER_SOURCE, shouldWriteValue, signalIgnored, signalLabel, signalsOfEvents, signalValueText, steeringSignal, VALUE_WRITE_INTERVAL_MS } from "../lib/machine/signals";
import { analysisGroups } from "../lib/machine/analysis-scope";
import { analyse } from "../lib/machine/analysis";
import { cleanValues, parseEvent } from "../lib/machine/intake";

// Integrationsmotorn E2 (2026-10-24, beslut 4): the signal catalogue and the analysis per scope, without a database.
const t = (iso: string) => new Date(iso);
const ev = (iso: string, extra: Partial<{ type: string; code: string; severity: string; state: string | null; values: Record<string, number | boolean | string> | null }> = {}) =>
  ({ occurredAt: t(iso), type: "state", code: "RUN", severity: "info", state: "running", values: null, ...extra });

test("the catalogue from a call: each code and each value name, the latest time and value, never a prototype name", () => {
  const seen = signalsOfEvents([
    ev("2026-10-24T10:00:00Z", { values: { temp: 21.5, door: true } }),
    ev("2026-10-24T10:01:00Z", { type: "alarm", code: "E12", severity: "fault", state: "raised", values: { temp: 22 } }),
    ev("2026-10-24T09:59:00Z", { values: { temp: 20, mode: "auto" } }),
  ]);
  assert.deepEqual([...seen.keys()].sort(), ["code:E12", "code:RUN", "door", "mode", "temp"]);
  assert.equal(seen.get("temp")!.value, 22, "the newest value wins, also when the events come out of order");
  assert.equal(seen.get("temp")!.seenAt.toISOString(), "2026-10-24T10:01:00.000Z");
  assert.equal(seen.get("temp")!.kind, "number");
  assert.equal(seen.get("door")!.kind, "boolean");
  assert.equal(seen.get("mode")!.kind, "text");
  assert.equal(seen.get("code:E12")!.kind, "code");
  assert.equal(seen.get("code:E12")!.value, "raised");
  assert.equal(seen.get("code:RUN")!.value, "running");
  assert.equal(codeSignalKey("E12"), "code:E12");
  const proto = signalsOfEvents([{ ...ev("2026-10-24T10:00:00Z"), values: JSON.parse('{"__proto__": 1, "constructor": 2, "ok": 3}') }]);
  assert.deepEqual([...proto.keys()].sort(), ["code:RUN", "ok"]);
});

test("the intake refuses prototype names in values (they never reach the catalogue)", () => {
  for (const name of ["__proto__", "constructor", "prototype"]) assert.equal(cleanValues(JSON.parse(`{"${name}": 1}`)), "bad", name);
  const parsed = parseEvent({ eventId: "e1", occurredAt: new Date().toISOString(), type: "state", code: "RUN", severity: "info", state: "running", values: JSON.parse('{"constructor": 1}') }, new Date());
  assert.equal(parsed.ok, false);
  assert.deepEqual(cleanValues({ "a.b-c_1": 1 }), { "a.b-c_1": 1 });
});

test("the caps: 200 per source and 2 000 per company, the smaller room wins, the rest is counted", () => {
  assert.equal(MAX_SIGNALS_PER_SOURCE, 200);
  assert.equal(MAX_SIGNALS_PER_COMPANY, 2000);
  const fresh = Array.from({ length: 40 }, (_, index) => index);
  assert.deepEqual(admitNewSignals(fresh, { source: 0, company: 0 }), { admitted: fresh, ignored: 0 });
  assert.deepEqual(admitNewSignals(fresh, { source: 163, company: 0 }), { admitted: fresh.slice(0, 37), ignored: 3 });
  assert.deepEqual(admitNewSignals(fresh, { source: 10, company: 1990 }), { admitted: fresh.slice(0, 10), ignored: 30 });
  assert.deepEqual(admitNewSignals(fresh, { source: 250, company: 0 }), { admitted: [], ignored: 40 });
});

test("the latest value: never backwards, written on a change (outside the dead band) or once a minute", () => {
  const at = t("2026-10-24T10:00:00Z");
  const later = (ms: number) => new Date(at.getTime() + ms);
  assert.equal(shouldWriteValue({ kind: "number", deadband: null, previous: null, next: { value: 1, at } }), true, "the first value");
  assert.equal(shouldWriteValue({ kind: "number", deadband: null, previous: { value: 1, at: null }, next: { value: 1, at } }), true);
  assert.equal(shouldWriteValue({ kind: "number", deadband: null, previous: { value: 1, at }, next: { value: 2, at: new Date(at.getTime() - 1) } }), false, "an older measurement never moves it back");
  assert.equal(shouldWriteValue({ kind: "number", deadband: null, previous: { value: 1, at }, next: { value: 1, at } }), false, "a duplicate does nothing");
  assert.equal(shouldWriteValue({ kind: "number", deadband: null, previous: { value: 1, at }, next: { value: 1, at: later(10_000) } }), false);
  assert.equal(shouldWriteValue({ kind: "number", deadband: null, previous: { value: 1, at }, next: { value: 1.1, at: later(10_000) } }), true);
  assert.equal(shouldWriteValue({ kind: "number", deadband: 0.5, previous: { value: 21, at }, next: { value: 21.4, at: later(10_000) } }), false, "inside the dead band");
  assert.equal(shouldWriteValue({ kind: "number", deadband: 0.5, previous: { value: 21, at }, next: { value: 21.6, at: later(10_000) } }), true);
  assert.equal(shouldWriteValue({ kind: "number", deadband: 0.5, previous: { value: 21, at }, next: { value: 21.1, at: later(VALUE_WRITE_INTERVAL_MS) } }), true, "once a minute anyway");
  assert.equal(shouldWriteValue({ kind: "boolean", deadband: null, previous: { value: true, at }, next: { value: false, at: later(1) } }), true);
  assert.equal(shouldWriteValue({ kind: "code", deadband: null, previous: { value: "raised", at }, next: { value: "raised", at: later(1) } }), false);
});

test("only an active signal steers; a found one changes nothing; an ignored one stops the order", () => {
  assert.equal(steeringSignal(null), null);
  assert.equal(steeringSignal({ id: "g", status: "discovered", partId: "f" }), null);
  assert.deepEqual(steeringSignal({ id: "g", status: "active", partId: "f" }), { id: "g", partId: "f" });
  assert.equal(steeringSignal({ id: "g", status: "ignored", partId: "f" }), null);
  assert.equal(signalIgnored({ id: "g", status: "ignored", partId: null }), true);
  assert.equal(signalIgnored({ id: "g", status: "active", partId: null }), false);
  assert.equal(signalIgnored(null), false);
});

test("names and values in the list", () => {
  assert.equal(cleanSignalText("  Temperatur hall 1 ", 80), "Temperatur hall 1");
  assert.equal(cleanSignalText("rad\nbrytning", 80), null);
  assert.equal(cleanSignalText("x".repeat(81), 80), null);
  assert.equal(signalLabel({ key: "code:E12", name: "" }), "Kod E12");
  assert.equal(signalLabel({ key: "temp", name: "" }), "temp");
  assert.equal(signalLabel({ key: "temp", name: "Temperatur" }), "Temperatur");
  assert.equal(signalValueText({ kind: "number", unit: "°C", lastValue: 21.5 }), "21,5 °C");
  assert.equal(signalValueText({ kind: "boolean", unit: "", lastValue: false }), "Falskt");
  assert.equal(signalValueText({ kind: "code", unit: "x", lastValue: "raised" }), "raised");
  assert.equal(signalValueText({ kind: "number", unit: "", lastValue: null }), "");
});

test("the analysis per scope: one group per object or active signal, and silence per active signal", () => {
  const base = { type: "alarm", code: "E12", severity: "fault", state: "raised", values: null };
  const events = [
    { ...base, occurredAt: t("2026-10-24T10:00:00Z"), machinePartId: "press", signalId: null },
    { ...base, occurredAt: t("2026-10-24T10:01:00Z"), machinePartId: "press", signalId: null },
    { ...base, code: "E7", occurredAt: t("2026-10-24T10:02:00Z"), machinePartId: null, signalId: "g7" },
    { ...base, type: "state", code: "RUN", state: "running", occurredAt: t("2026-10-24T10:03:00Z"), machinePartId: null, signalId: null, values: { temp: 20 } },
  ];
  // Without active signals: as before – one group per scope with all three rules.
  const plain = analysisGroups("s1", events, []);
  assert.deepEqual(plain.map((group) => group.scopeKey).sort(), ["part:press", "source:s1"]);
  assert.ok(plain.every((group) => group.kinds.includes("silent")));
  // With active signals: the code signal with its own object is its own group, silence only per active signal.
  const active = [{ id: "g7", key: "code:E7", name: "Fläkt 7", machinePartId: "fan7" }, { id: "gt", key: "temp", name: "", machinePartId: null }];
  const groups = analysisGroups("s1", events, active);
  const scoped = groups.filter((group) => !group.silent);
  assert.deepEqual(scoped.map((group) => group.scopeKey).sort(), ["part:fan7", "part:press", "source:s1"]);
  assert.ok(scoped.every((group) => !group.kinds.includes("silent")));
  const silent = groups.filter((group) => group.silent);
  assert.deepEqual(silent.map((group) => [group.scopeKey, group.silent!.label, group.events.length]), [["part:fan7", "Fläkt 7", 1], ["signal:gt", "temp", 1]]);
});

test("silence per signal names the signal and keeps two signals on one object apart", () => {
  const now = t("2026-10-24T12:00:00Z");
  // Ten events over three days, then two days of silence.
  const events = Array.from({ length: 10 }, (_, index) => ({ occurredAt: new Date(t("2026-10-19T12:00:00Z").getTime() + index * 8 * 3_600_000), type: "state", code: "RUN", severity: "info", state: "running" }));
  const [finding] = analyse(events, now, null, { kinds: ["silent"], silent: { id: "g1", label: "Kompressor tryck" } });
  assert.equal(finding.kind, "silent");
  assert.equal(finding.title, "Kompressor tryck har tystnat");
  assert.match(finding.dedupeKey, /^silent:g1:/);
  assert.equal(analyse(events, now, null, { kinds: ["flutter", "denser"] }).length, 0, "silence is not checked where it is not asked for");
  assert.equal(analyse(events, now)[0].title, "Maskinen har tystnat", "without options: as before");
});

test("the migration: the catalogue, the event's signal in the same source, the suggestions per scope, nothing removed", () => {
  const sql = readFileSync("prisma/migrations/20261024170000_machine_signal_catalogue/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "MachineSignal"/);
  assert.match(sql, /CREATE UNIQUE INDEX "MachineSignal_sourceId_key_key" ON "MachineSignal"\("sourceId", "key"\);/);
  assert.match(sql, /FOREIGN KEY \("sourceId", "organizationId"\) REFERENCES "MachineSource"\("id", "organizationId"\) ON DELETE CASCADE/);
  assert.match(sql, /CREATE TRIGGER "MachineSignal_facility_tenant"/);
  assert.match(sql, /CREATE TRIGGER "MachineEvent_signal_tenant"/);
  assert.match(sql, /"organizationId" = NEW\."organizationId" AND "sourceId" = NEW\."sourceId"/, "the event's signal is the same source's");
  assert.match(sql, /"key" NOT IN \('__proto__', 'constructor', 'prototype'\)/);
  const backfill = sql.indexOf(`UPDATE "MachineSuggestion" SET "scopeKey" = 'source:' || "sourceId"`);
  assert.ok(backfill > 0 && backfill < sql.indexOf(`ALTER TABLE "MachineSuggestion" ALTER COLUMN "scopeKey" SET NOT NULL`));
  assert.match(sql, /CREATE UNIQUE INDEX "MachineSuggestion_sourceId_scopeKey_dedupeKey_key"/);
  assert.doesNotMatch(sql, /^\s*(DELETE|TRUNCATE|DROP TABLE)\b|DROP COLUMN/im);
});

test("the signal page and its change follow the admin, Origin and the company; no manufacturer in the code", () => {
  const handler = readFileSync("lib/api-handlers/machine-sources.ts", "utf8");
  const post = handler.slice(handler.indexOf("export async function POST"));
  assert.ok(post.indexOf("checkOrigin(request)") < post.indexOf("await admin()") && post.indexOf("await admin()") < post.indexOf(`input.action === "update_signal"`));
  const admin = readFileSync("lib/machine/signal-admin.ts", "utf8");
  assert.match(admin, /machineSignal\.findFirst\(\{ where: \{ id: input\.signalId, organizationId \}/);
  assert.match(admin, /machinePart\.findFirst\(\{ where: \{ id: input\.partId, organizationId, isActive: true/);
  for (const path of ["lib/machine/signals.ts", "lib/machine/signal-store.ts", "lib/machine/signal-admin.ts", "lib/machine/analysis-scope.ts", "features/integrations/machine-signals.tsx"])
    assert.doesNotMatch(readFileSync(path, "utf8"), /teltonika|rutos|rut200|siemens|schneider/i, path);
});
