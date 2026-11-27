import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkShape, EXAMPLE_PROFILE, EXAMPLE_PROFILE_NAME, idempotencyCase, interpretRaw, PROFILE_FILE_FORMAT, profileDefinitionSchema, profileFile, profileFileSchema, RAW_LIMITS, readTime, readValue, valueAt, type ProfileDefinition } from "../lib/machine/raw-profile";
import { signalsOfReadings } from "../lib/machine/signals";

// Integrationsmotorn E4 (2026-10-24, beslut 1, 3 och 9): the format profile and the reading of a device's own JSON,
// without a database. Two different payloads go through the same code (a router's periodic JSON and a flow program's).
const now = new Date("2026-10-24T12:00:00Z");
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const profile = (patch: Partial<ProfileDefinition>): ProfileDefinition => profileDefinitionSchema.parse({ profileVersion: 1, signals: [{ path: "temp", kind: "number" }], ...patch });

test("the example profile is generic and reads a router's periodic JSON", () => {
  assert.doesNotMatch(EXAMPLE_PROFILE_NAME, /teltonika|rut|rutos/i);
  assert.equal(profileDefinitionSchema.safeParse(EXAMPLE_PROFILE).success, true);
  const body = { data: [{ ts: unix("2026-10-24T11:59:00Z"), di1: 1, modbus: { temp: "215" }, uptime: 3600 }, { ts: unix("2026-10-24T11:59:30Z"), di1: 0, modbus: { temp: 217 }, uptime: 3630 }] };
  const read = interpretRaw(body, EXAMPLE_PROFILE, now);
  assert.ok(read.ok);
  assert.equal(read.records, 2);
  const seen = signalsOfReadings(read.readings);
  assert.equal(seen.get("modbus.temp")!.value, 21.7, "scale 0.1, number as text read too, the latest wins");
  assert.equal(seen.get("modbus.temp")!.unit, "°C");
  assert.equal(seen.get("di1")!.value, false, "0/1 is a boolean");
  assert.equal(seen.get("di1")!.name, "Digital ingång 1");
  assert.equal(seen.get("uptime")!.value, 3630, "discovered");
  assert.equal(seen.has("ts"), false, "the time field is not a signal");
  assert.equal(idempotencyCase(EXAMPLE_PROFILE), "b");
});

test("a second payload shape: one object, ISO time with zone, an id, nested values, no list", () => {
  const flow = profile({ time: { path: "meta.time", format: "iso" }, id: { path: "meta.seq" }, signals: [{ path: "line.speed", kind: "number", offset: -1 }, { path: "line.mode", kind: "text" }, { path: "line.run", kind: "boolean" }] });
  const read = interpretRaw({ meta: { time: "2026-10-24T13:59:00+02:00", seq: 42 }, line: { speed: 11, mode: "auto", run: true } }, flow, now);
  assert.ok(read.ok);
  assert.deepEqual(read.readings.map((reading) => [reading.key, reading.value]), [["line.speed", 10], ["line.mode", "auto"], ["line.run", true]]);
  assert.equal(read.readings[0].at.toISOString(), "2026-10-24T11:59:00.000Z");
  assert.deepEqual(read.recordIds, ["42"]);
  assert.equal(idempotencyCase(flow), "a");
  assert.equal(idempotencyCase(profile({ time: { format: "received" } })), "c");
  assert.equal(idempotencyCase(profile({})), "c", "no time in the profile is the received time");
});

test("hostile bodies: depth, size, prototype names and long names refuse the whole body", () => {
  let deep: unknown = 1;
  for (let index = 0; index < 10; index += 1) deep = { a: deep };
  assert.equal(checkShape(deep), "too_deep");
  assert.equal(checkShape({ list: Array.from({ length: RAW_LIMITS.maxNodes + 5 }, () => 1) }), "too_many_nodes");
  for (const name of ["__proto__", "constructor", "prototype"]) assert.equal(checkShape(JSON.parse(`{"x": {"${name}": {"polluted": 1}}}`)), "forbidden_name", name);
  assert.equal(checkShape({ ["k".repeat(65)]: 1 }), "long_key");
  assert.equal(checkShape("text"), "bad_shape");
  assert.equal(checkShape(5), "bad_shape");
  const read = interpretRaw(JSON.parse('{"__proto__": {"temp": 1}, "temp": 2}'), profile({}), now);
  assert.deepEqual(read, { ok: false, error: "forbidden_name" });
  assert.equal(({} as Record<string, unknown>).polluted, undefined, "nothing reached a prototype");
  assert.deepEqual(interpretRaw({ data: Array.from({ length: RAW_LIMITS.maxRecords + 1 }, () => ({})) }, profile({ records: "data[*]" }), now), { ok: false, error: "too_many_records" });
  assert.deepEqual(interpretRaw({ other: [] }, profile({ records: "data[*]" }), now), { ok: false, error: "no_records" });
  assert.deepEqual(interpretRaw({ data: {} }, profile({ records: "data[*]" }), now), { ok: false, error: "no_records" });
});

test("values: numbers as text only for numbers, never NaN or Infinity, short text without control characters", () => {
  assert.equal(readValue("21.5", "number"), 21.5);
  assert.equal(readValue(" -3e2 ", "number"), -300);
  for (const bad of ["NaN", "Infinity", "1,5", "", "12abc", true, null, [1], { v: 1 }]) assert.equal(readValue(bad as never, "number"), null, String(bad));
  assert.equal(readValue(1e308, "number", 10), null, "a scaled overflow is refused");
  assert.equal(readValue("true", "boolean"), null, "only real booleans and 0/1");
  assert.equal(readValue(2, "boolean"), null);
  assert.equal(readValue("rad\nbrytning", "text"), null);
  assert.equal(readValue("x".repeat(61), "text"), null);
  assert.equal(readValue(5, "text"), null);
  assert.equal(valueAt({ a: { b: 1 } }, "a.b"), 1);
  assert.equal(valueAt({ a: {} }, "a.toString"), undefined, "never from the prototype");
});

test("time: the fixed formats, a wrong time or one outside the window refuses the record, the rest is kept", () => {
  assert.equal(readTime("2026-10-24T12:00:00", "iso"), null, "without zone");
  assert.equal(readTime(1761300000, "unix_s")?.toISOString(), "2025-10-24T10:00:00.000Z");
  assert.equal(readTime(1761300000000, "unix_ms")?.toISOString(), "2025-10-24T10:00:00.000Z");
  assert.equal(readTime("abc", "unix_s"), null);
  assert.equal(readTime(-5, "unix_s"), null);
  const timed = profile({ records: "rows[*]", time: { path: "t", format: "unix_s" } });
  const read = interpretRaw({ rows: [{ t: "x", temp: 1 }, { t: unix("2026-10-01T00:00:00Z"), temp: 2 }, { t: unix("2026-10-24T12:10:00Z"), temp: 3 }, { t: unix("2026-10-24T11:00:00Z"), temp: "fel" }, 7, { t: unix("2026-10-24T11:30:00Z"), temp: 4 }] }, timed, now);
  assert.ok(read.ok);
  assert.deepEqual(read.rejectedRecords, [{ index: 0, reason: "bad_time" }, { index: 1, reason: "time_window" }, { index: 2, reason: "time_window" }, { index: 4, reason: "not_an_object" }]);
  assert.deepEqual(read.rejectedReadings, [{ record: 3, path: "temp", reason: "bad_value" }]);
  assert.deepEqual(read.readings.map((reading) => reading.value), [4]);
  assert.ok(read.readings.every((reading) => reading.at.getTime() <= now.getTime()));
});

test("discovery never makes a name per list index, skips long names and stops at 200 readings per call", () => {
  const read = interpretRaw({ temp: 1, list: [1, 2, 3], nested: { a: 1, deeper: { b: true } }, ["n".repeat(41)]: 1, empty: null }, profile({ discover: true }), now);
  assert.ok(read.ok);
  assert.deepEqual(read.readings.map((reading) => reading.key).sort(), ["nested.a", "nested.deeper.b", "temp"]);
  const many = interpretRaw(Object.fromEntries(Array.from({ length: 250 }, (_, index) => [`v${index}`, index])), profileDefinitionSchema.parse({ profileVersion: 1, discover: true }), now);
  assert.ok(many.ok);
  assert.equal(many.readings.length, RAW_LIMITS.maxReadings);
  assert.equal(many.overLimit, 50);
});

test("the profile is a closed structure: no expressions, no unknown fields, no prototype paths, at least one signal", () => {
  const bad = [
    { profileVersion: 2, signals: [{ path: "a", kind: "number" }] },
    { profileVersion: 1, signals: [{ path: "a", kind: "number", expression: "a*2" }] },
    { profileVersion: 1, signals: [{ path: "a[0]", kind: "number" }] },
    { profileVersion: 1, signals: [{ path: "$.a", kind: "number" }] },
    { profileVersion: 1, signals: [{ path: "a.__proto__", kind: "number" }] },
    { profileVersion: 1, signals: [{ path: "a", kind: "code" }] },
    { profileVersion: 1, signals: [{ path: "a", kind: "number", scale: 0 }] },
    { profileVersion: 1, signals: [{ path: "a", kind: "number" }, { path: "a", kind: "text" }] },
    { profileVersion: 1, signals: [] },
    { profileVersion: 1, records: "data[*].x[*]", signals: [{ path: "a", kind: "number" }] },
    { profileVersion: 1, time: { format: "iso" }, signals: [{ path: "a", kind: "number" }] },
    { profileVersion: 1, time: { path: "t", format: "strftime" }, signals: [{ path: "a", kind: "number" }] },
    { profileVersion: 1, signals: [{ path: "a", kind: "number" }], script: "return 1" },
  ];
  for (const definition of bad) assert.equal(profileDefinitionSchema.safeParse(definition).success, false, JSON.stringify(definition));
  assert.equal(profileDefinitionSchema.safeParse({ profileVersion: 1, discover: true }).success, true);
});

test("export and import: a file of its own format; another JSON is never taken for a profile", () => {
  const file = profileFile("Min router", EXAMPLE_PROFILE);
  assert.equal(file.format, PROFILE_FILE_FORMAT);
  const back = profileFileSchema.parse(JSON.parse(JSON.stringify(file)));
  assert.equal(profileDefinitionSchema.safeParse(back.definition).success, true);
  assert.equal(profileFileSchema.safeParse({ name: "x", definition: {} }).success, false);
  assert.equal(profileFileSchema.safeParse({ ...file, extra: 1 }).success, false);
});

test("the raw route: the key in a header only, answer 200, fixed codes; the migration is additive", () => {
  const route = readFileSync("lib/api-handlers/ingest-raw.ts", "utf8");
  assert.match(route, /request\.headers\.get\("x-hintek-key"\)/);
  assert.doesNotMatch(route, /searchParams/, "never in the address");
  assert.match(route, /status: 200/);
  assert.match(route, /RATE_RULES\.ingestCall, principal\.sourceId/);
  assert.match(route, /readLimitedText\(request, MAX_BODY_BYTES\)/);
  const sql = readFileSync("prisma/migrations/20261024180000_machine_raw_intake/migration.sql", "utf8");
  assert.match(sql, /FOREIGN KEY \("profileId", "organizationId"\) REFERENCES "MachineFormatProfile"\("id", "organizationId"\) ON DELETE NO ACTION/);
  assert.match(sql, /octet_length\("body"\) <= 65536/);
  assert.doesNotMatch(sql, /^\s*(DELETE|UPDATE|TRUNCATE|DROP)\b/im);
  for (const path of ["lib/machine/raw-profile.ts", "lib/machine/raw-store.ts", "lib/machine/profile-admin.ts", "lib/api-handlers/ingest-raw.ts", "features/integrations/machine-profiles.tsx"])
    assert.doesNotMatch(readFileSync(path, "utf8"), /teltonika|rutos|rut200|siemens|schneider/i, path);
  assert.doesNotMatch(readFileSync("lib/machine/raw-profile.ts", "utf8"), /\beval\(|new Function|new RegExp\((?!`)/, "no code from the profile is ever run");
});
