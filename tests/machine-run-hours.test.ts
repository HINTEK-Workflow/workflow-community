// Drifttimmar från PLC (2026-11-02), utan databas: reglerna för ett värde som stiger, går bakåt eller hoppar, och att simulatorns test
// säger samma sak som reglerna. Mot databasen: tests/machine-batch-0-41.integration.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideRunHours, foldRunHours, RUN_HOURS_MAX, runHoursFeedProblem, runHoursHeldText, type RunHoursState } from "../lib/machine/run-hours";
import { partInputSchema } from "../lib/maintenance/model";

const t0 = new Date("2026-11-02T08:00:00Z");
const after = (ms: number) => new Date(t0.getTime() + ms);
const HOUR = 3_600_000;
const state = (runHours: number | null, runHoursAt: Date | null = t0): RunHoursState => ({ runHours, runHoursAt, held: null, heldAt: null, heldReason: null });

test("a value rises with the clock, and the first value is taken as it is", () => {
  assert.equal(decideRunHours(state(null, null), { value: 5000, at: t0 }), "use");
  assert.equal(decideRunHours(state(100), { value: 110, at: after(10 * HOUR) }), "use");
  assert.equal(decideRunHours(state(100, null), { value: 900, at: t0 }), "use", "an older value without a time can't be weighed against the clock");
});

test("hours are never lowered by the machine", () => {
  assert.equal(decideRunHours(state(100), { value: 99.9, at: after(HOUR) }), "lower");
  assert.equal(decideRunHours(state(100), { value: 0, at: after(HOUR) }), "lower", "a counter that was reset");
});

test("a jump larger than the clock allows is not used; the margin takes a late start", () => {
  assert.equal(decideRunHours(state(100), { value: 1000, at: after(HOUR) }), "jump");
  assert.equal(decideRunHours(state(100), { value: 111.9, at: after(10 * HOUR) }), "use", "ten hours with a tenth and one hour to spare");
  assert.equal(decideRunHours(state(100), { value: 112.1, at: after(10 * HOUR) }), "jump");
});

test("an old value, a bad value, the same value and a small step within the minute change nothing", () => {
  assert.equal(decideRunHours(state(100), { value: 200, at: t0 }), "old", "no newer than the last");
  assert.equal(decideRunHours(state(100), { value: 200, at: after(-HOUR) }), "old", "also older than a person's value");
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, RUN_HOURS_MAX + 1, "100", true]) assert.equal(decideRunHours(state(100), { value, at: after(HOUR) }), "bad", String(value));
  assert.equal(decideRunHours(state(100), { value: 100, at: after(HOUR) }), "same");
  assert.equal(decideRunHours(state(100), { value: 100.2, at: after(30_000) }), "wait");
  assert.equal(decideRunHours(state(100), { value: 100.2, at: after(61_000) }), "use");
  assert.equal(decideRunHours(state(100), { value: 101, at: after(30_000) }), "use", "a whole hour is written at once");
});

test("a held value is kept and shown until a usable value comes, and only a new kind of value is told once", () => {
  const lower = foldRunHours(state(100), [{ value: 50, at: after(HOUR) }]);
  assert.deepEqual([lower.used, lower.write, lower.state.runHours, lower.state.held, lower.state.heldReason], [false, true, 100, 50, "lower"]);
  assert.deepEqual(lower.newlyHeld, { value: 50, reason: "lower" });
  const again = foldRunHours(lower.state, [{ value: 50, at: after(HOUR + 10_000) }]);
  assert.deepEqual([again.write, again.newlyHeld], [false, null], "the same value within the minute writes nothing");
  const later = foldRunHours(lower.state, [{ value: 51, at: after(HOUR + 20_000) }]);
  assert.deepEqual([later.write, later.state.held, later.newlyHeld], [true, 51, null], "the row follows the value, the history has its line");
  const right = foldRunHours(later.state, [{ value: 101, at: after(2 * HOUR) }]);
  assert.deepEqual([right.used, right.state.runHours, right.state.held, right.state.heldReason], [true, 101, null, null]);
  const same = foldRunHours(later.state, [{ value: 100, at: after(2 * HOUR) }]);
  assert.deepEqual([same.used, same.write, same.state.held], [false, true, null], "the machine agrees again");
});

test("several values in a call go in time order", () => {
  const fold = foldRunHours(state(100), [{ value: 103, at: after(3 * HOUR) }, { value: 90, at: after(2 * HOUR) }, { value: 101, at: after(HOUR) }]);
  assert.deepEqual([fold.state.runHours, fold.state.held], [103, null]);
  assert.equal(fold.used, true);
});

test("the words say what happened, and the feed needs a number with a part of its own", () => {
  assert.match(runHoursHeldText({ held: 50, reason: "lower", current: 100 }), /Maskinen skickade 50 h\. Det är lägre, så delens 100 h gäller\./);
  assert.match(runHoursHeldText({ held: 9000, reason: "jump", current: 100 }), /större hopp/);
  assert.equal(runHoursFeedProblem({ feed: false, kind: "text", status: "ignored", partId: null }), "");
  assert.match(runHoursFeedProblem({ feed: true, kind: "code", status: "active", partId: "p" }), /tal/);
  assert.match(runHoursFeedProblem({ feed: true, kind: "number", status: "ignored", partId: "p" }), /ignorerad/);
  assert.match(runHoursFeedProblem({ feed: true, kind: "number", status: "active", partId: null }), /Välj vilken del/);
  assert.equal(runHoursFeedProblem({ feed: true, kind: "number", status: "discovered", partId: "p" }), "");
});

test("a save that leaves the hours out keeps them; a person can still write them", () => {
  assert.equal(partInputSchema.parse({ name: "X" }).runHours, undefined);
  assert.equal(partInputSchema.parse({ name: "X", runHours: null }).runHours, null);
  assert.equal(partInputSchema.parse({ name: "X", runHours: 12.5 }).runHours, 12.5);
  const server = readFileSync("lib/maintenance/server.ts", "utf8");
  assert.match(server, /input\.runHours === undefined \? current\.runHours : input\.runHours/);
  assert.match(server, /runHoursOrigin: runHours === null \? null : "person"/);
  assert.match(server, /maintenance_run_hours_lowered/, "a person's lowering stands in the history");
  const page = readFileSync("features/maintenance/maintenance-page.tsx", "utf8");
  assert.match(page, /\.\.\.\(hoursEdited \? \{ runHours \} : \{\}\)/, "the form writes them only when they were changed");
  assert.doesNotMatch(page, /Senare från maskinkopplingen/);
  assert.match(page, /data-testid="maintenance-hours-held"/);
});

test("the machine's write moves no version, and both intakes feed it", () => {
  const store = readFileSync("lib/machine/run-hours-store.ts", "utf8");
  assert.doesNotMatch(store, /version/.source === "version" ? /version: \{/ : /x/, "a person's open form does not go stale");
  assert.match(store, /where: \{ id: part\.id, organizationId, runHours: part\.runHours, runHoursAt: part\.runHoursAt \}/, "a save in between wins");
  assert.match(store, /partPlansChanged\(organizationId, part\.id\)/, "plans on run hours follow");
  assert.match(readFileSync("lib/machine/store.ts", "utf8"), /feedRunHours\(principal, readings, known, now\)/);
  assert.match(readFileSync("lib/machine/raw-store.ts", "utf8"), /feedRunHours\(principal, readings, known, now\)/);
});

test("the migration only adds, and only moves a default", () => {
  const sql = readFileSync("prisma/migrations/20261102120000_machine_run_hours_and_source_off/migration.sql", "utf8");
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  assert.match(sql, /ALTER COLUMN "alarmMode" SET DEFAULT 'off'/);
  assert.doesNotMatch(sql.replace(`DROP CONSTRAINT "MachineRawDedupe_hash_check"`, ""), /\bUPDATE\b|\bDROP\b|\bDELETE\b/, "no existing source or row changes");
});
