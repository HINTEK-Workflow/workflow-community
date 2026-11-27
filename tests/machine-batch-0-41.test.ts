// Omgången för maskinerna i 0.41.0 (2026-11-02), utan databas: de bekräftade felen, Av som förval för nya källor, Analysera nu, modulen av på
// Maskiner och urvalet för att ta bort gamla maskinrötter. Mot databasen: tests/machine-batch-0-41.integration.ts och tests/maintenance-remove-unplaced.integration.ts.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { firstDayToCount, machineKeyFigures, type OrderFacts } from "../lib/machine/key-figures";
import { idempotencyCase, IDEMPOTENCY_TEXT, interpretRaw, profileDefinitionSchema, RAW_ID_DEDUPE_DAYS } from "../lib/machine/raw-profile";
import { EMPTY_RULE_STATE, evaluateReading, evaluateTime, type Rule } from "../lib/machine/signal-rules";
import { codeSignalKey, readingsOfEvents } from "../lib/machine/signals";
import { KEPT_ABOVE, parseRemovalArgs, planUnplaced } from "../lib/maintenance/unplaced-plan";
import { addSwedishDays, startOfSwedishDay } from "../lib/swedish-time";
import { moduleOfPage, moduleOffNotice } from "../lib/workflow/modules";

const read = (path: string) => readFileSync(path, "utf8");

test("D1: a code is heard, so a Tystnad rule on a code signal clears and can strike again", () => {
  const event = { occurredAt: new Date("2026-11-02T08:00:00Z"), code: "RUN", severity: "info", state: "running", values: { temp: 21 } };
  assert.deepEqual(readingsOfEvents([event]).map((row) => row.key), [codeSignalKey("RUN"), "temp"]);
  assert.equal(readingsOfEvents([{ ...event, state: null, values: null }])[0].value, "info", "a diagnosis has only its level");
  const rule: Rule = { id: "r", operator: "stale", value: 600, hysteresis: null, forSeconds: 0 };
  const quietAt = new Date("2026-11-02T08:20:00Z");
  const struck = evaluateTime(rule, { ...EMPTY_RULE_STATE }, { lastSeenAt: event.occurredAt }, quietAt);
  assert.equal(struck?.transition, "raise");
  const heard = evaluateReading(rule, struck!.state, { value: "running", at: new Date("2026-11-02T08:21:00Z") });
  assert.equal(heard.transition, "clear");
  assert.equal(evaluateTime(rule, heard.state, { lastSeenAt: new Date("2026-11-02T08:21:00Z") }, new Date("2026-11-02T08:40:00Z"))?.transition, "raise");
  assert.match(read("lib/machine/store.ts"), /readingsOfEvents\(accepted\.map/);
});

const now = new Date("2026-11-02T12:00:00Z");
const minutes = (count: number) => new Date(now.getTime() - 40 * 86_400_000 + count * 60_000);
const order = (extra: Partial<OrderFacts>): OrderFacts => ({ createdAt: minutes(0), decidedAt: minutes(0), acknowledgedAt: minutes(5), completedAt: minutes(60), stoppedAt: null, restoredAt: null, ...extra });
const figures = (orders: OrderFacts[]) => machineKeyFigures({ now, periodDays: 90, firstDataAt: minutes(0), totals: { events: 3, alarms: 3, faults: 3, stops: 0, stoppedMinutes: 0, hasState: false }, orders });

test("D2: closing a row keeps its decision time, and rows closed earlier still count", () => {
  const source = read("lib/machine/alarm-orders.ts");
  assert.match(source, /data: \{ status: "closed" \} \}\)/, "the closing row writes only its status");
  assert.doesNotMatch(source, /status: "closed", decidedAt/);
  const kept = figures([order({}), order({}), order({})]);
  assert.deepEqual([kept.ackMinutes.value, kept.ackMinutes.samples, kept.doneMinutes.value, kept.doneMinutes.samples], [5, 3, 60, 3]);
  // Before this release the close wrote its own time, after the acknowledgement and the completion.
  const old = figures([order({ decidedAt: minutes(500) }), order({ decidedAt: minutes(500) }), order({ decidedAt: minutes(500) })]);
  assert.deepEqual([old.ackMinutes.value, old.ackMinutes.samples, old.doneMinutes.value], [5, 3, 60], "the row's own time counts then");
  const approved = figures([order({ decidedAt: minutes(2) }), order({ decidedAt: minutes(2) }), order({ decidedAt: minutes(2) })]);
  assert.equal(approved.ackMinutes.value, 3, "from the approval, as before");
});

test("D3: the status row counts the order, not the row", () => {
  const source = read("lib/maintenance/machine-server.ts");
  assert.match(source, /workflowTask\.count\(\{ where: \{ organizationId, id: \{ in: rows\.map/);
  assert.match(source, /status: \{ notIn: \["COMPLETED", "CANCELLED"\] \}/);
});

test("D4: the night counts as far back as an event can come late, and not further than it has to", () => {
  const today = startOfSwedishDay(now);
  const earliest = addSwedishDays(today, -89);
  const firstEvent = addSwedishDays(today, -60);
  const yesterday = addSwedishDays(today, -1);
  assert.equal(firstDayToCount({ lastSummarised: yesterday, firstEvent, earliest, today }).getTime(), addSwedishDays(today, -8).getTime(), "a week and the night after");
  const stale = addSwedishDays(today, -20);
  assert.equal(firstDayToCount({ lastSummarised: stale, firstEvent, earliest, today }).getTime(), stale.getTime(), "the job has not run for a while");
  assert.equal(firstDayToCount({ lastSummarised: null, firstEvent, earliest, today }).getTime(), firstEvent.getTime());
  const fresh = addSwedishDays(today, -2);
  assert.equal(firstDayToCount({ lastSummarised: yesterday, firstEvent: fresh, earliest, today }).getTime(), fresh.getTime(), "never before the first event");
  assert.equal(firstDayToCount({ lastSummarised: addSwedishDays(today, -200), firstEvent: earliest, earliest, today }).getTime(), earliest.getTime(), "never further than the events live");
});

test("D5: a profile's id is used: each record carries it, a repeat in the body counts once, and the text says how long", () => {
  const profile = profileDefinitionSchema.parse({ profileVersion: 1, records: "data[*]", id: { path: "seq" }, signals: [{ path: "temp", kind: "number" }], discover: false });
  assert.equal(idempotencyCase(profile), "a");
  const answer = interpretRaw({ data: [{ seq: 7, temp: 21 }, { seq: 7, temp: 99 }, { seq: 8, temp: 22 }] }, profile, now);
  assert.ok(answer.ok);
  assert.deepEqual(answer.recordIds, ["7", "8"]);
  assert.deepEqual(answer.readings.map((row) => [row.recordId, row.value]), [["7", 21], ["8", 22]]);
  assert.ok(IDEMPOTENCY_TEXT.a.includes(`${RAW_ID_DEDUPE_DAYS} dagar`));
  const store = read("lib/machine/raw-store.ts");
  assert.match(store, /ON CONFLICT \("sourceId", "hash"\) DO NOTHING/, "an id is not forgotten after ten minutes");
  assert.match(read("lib/workflow/system-cleanup.ts"), /NOT: \{ hash: \{ startsWith: RAW_ID_HASH_PREFIX \} \}/, "a body's hash is ten minutes, an id a week");
});

test("the night forces the analysis; a page opening does not", () => {
  const store = read("lib/machine/analysis-store.ts");
  assert.match(store, /analyseAllSources[\s\S]*analyseSource\(source, now, true\)/);
  assert.match(read("lib/api-handlers/machine-sources.ts"), /try \{ await analyseSource\(source\); \}/);
});

test("Maskiner at its direct address belongs to Underhåll and says so with the shared notice", () => {
  assert.equal(moduleOfPage("advanced", "machines"), "upkeep");
  assert.equal(moduleOfPage("advanced", "wholesale"), null, "Grossister is no area of Kopplingar since 2026-11-03");
  assert.equal(moduleOfPage("advanced", "api"), null);
  assert.equal(moduleOfPage("advanced", null), null);
  assert.equal(moduleOfPage("maintenance"), "upkeep", "the other pages as before");
  assert.match(moduleOffNotice("upkeep"), /Underhåll är avstängt/);
  assert.match(read("components/app-shell.tsx"), /moduleOfPage\(view, searchParams\.get\("section"\)\)/);
});

test("Analysera nu is a small button on the existing action, for the same admin", () => {
  const page = read("features/integrations/machine-sources.tsx");
  assert.match(page, /data-testid="machine-analyse-now"/);
  assert.match(page, /action: "analyse_now"/);
  assert.match(read("lib/api-handlers/machine-sources.ts"), /z\.object\(\{ action: z\.literal\("analyse_now"\) \}\)/, "no new action");
});

test("a new source starts on Av, and an existing one keeps its choice", () => {
  assert.match(read("prisma/schema.prisma"), /alarmMode\s+String\s+@default\("off"\)/);
  assert.match(read("features/integrations/machine-sources.tsx"), /Källan börjar på Av/);
  // docs/ is not in the Community export.
  if (existsSync("docs/drift/MASKININTAG.md")) assert.match(read("docs/drift/MASKININTAG.md"), /\*\*Av\*\* \(förval för en ny källa/);
});

test("the old roots: only under Utan plats, deepest first; history stays, with what is above it", () => {
  const part = (id: string, parentId: string | null = null, placeId: string | null = null) => ({ id, parentId, placeId, name: id });
  const parts = [part("fabriken"), part("linje", "fabriken"), part("press", "linje"), part("fläkt", "linje"), part("tom"), part("kvar", null, "hall"), part("kvardel", "kvar")];
  const clean = planUnplaced(parts, new Map());
  assert.equal(clean.machines, 2);
  assert.deepEqual(new Set(clean.remove.map((row) => row.id)), new Set(["fabriken", "linje", "press", "fläkt", "tom"]));
  assert.ok(clean.remove.findIndex((row) => row.id === "press") < clean.remove.findIndex((row) => row.id === "linje"));
  assert.ok(clean.remove.findIndex((row) => row.id === "linje") < clean.remove.findIndex((row) => row.id === "fabriken"));
  assert.equal(clean.remove.find((row) => row.id === "press")?.way, "fabriken › linje › press");
  const history = planUnplaced(parts, new Map([["press", "Delen har historik."]]));
  assert.deepEqual(new Set(history.remove.map((row) => row.id)), new Set(["fläkt", "tom"]), "its sibling goes");
  assert.deepEqual(history.keep.map((row) => [row.id, row.reason]), [["press", "Delen har historik."], ["linje", KEPT_ABOVE], ["fabriken", KEPT_ABOVE]]);
  assert.ok(!history.remove.some((row) => ["kvar", "kvardel"].includes(row.id)), "a machine on a place is never in it");
});

test("the script lists by default and asks for both the company and the flag; anything else is refused", () => {
  assert.deepEqual(parseRemovalArgs(["--company", "abc123"]), { ok: true, companyId: "abc123", execute: false });
  assert.deepEqual(parseRemovalArgs(["--company", "abc123", "--delete"]), { ok: true, companyId: "abc123", execute: true });
  assert.equal(parseRemovalArgs([]).ok, false);
  assert.equal(parseRemovalArgs(["--delete"]).ok, false);
  assert.equal(parseRemovalArgs(["--company", "a b"]).ok, false);
  assert.equal(parseRemovalArgs(["--company", "abc", "--force"]).ok, false);
  const lib = read("lib/maintenance/remove-unplaced.ts");
  assert.match(lib, /prisma\.\$transaction/, "one transaction");
  assert.match(lib, /partRemovalRefusal\(tx, organizationId, row\.id\)/, "Ta bort's own rule for each row");
  assert.doesNotMatch(lib, /DROP|TRUNCATE|\$executeRaw/);
  const server = read("lib/maintenance/server.ts");
  assert.match(server, /const refusal = await partRemovalRefusal\(tx, caller\.organizationId, id\);/, "Ta bort goes by the same function");
  // The script itself is Workflow's own and not in the Community export.
  if (existsSync("scripts/ops/remove-unplaced-machines.ts")) assert.match(read("scripts/ops/remove-unplaced-machines.ts"), /parseRemovalArgs\(process\.argv\.slice\(2\)\)/);
});
