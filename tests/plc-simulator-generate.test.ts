import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generateConnection, type GeneratePorts, type GenerateStep, SIMULATOR_SOURCE_NAME, type SourceRow } from "../lib/machine/simulator/generate-connection";
import { EVENTS_PATH, type LogEntry } from "../lib/machine/simulator/device";
import { createEventFactory, eventsBody, SAFE_POLICY } from "../lib/machine/simulator/events";
import { parseBatch } from "../lib/machine/intake";
import { MACHINES_HREF } from "../lib/machine/simulator/limits";
import { FIRST_KEY, makeHarness, NOW } from "./plc-simulator-fixture";

// PLC-simulatorn, Generera koppling automatiskt (2026-11-04): the steps with the calls handed in, and the guards. The real route's checks
// (session, company, the right, Origin, fresh confirmation) are its own and unchanged: tests/plc-simulator-desktop.browser.cjs meets them.

const answer = (patch: Partial<LogEntry> = {}): LogEntry => ({ id: 1, atMs: 0, path: EVENTS_PATH, probe: true, status: 202, code: null, summary: "Mottagna 1, dubbletter 0, nekade 0.", tone: "ok", counts: { accepted: 1, duplicate: 0, rejected: 0 }, results: [], retryAfter: null, requestHeader: "", requestBody: "", responseBody: "", ...patch });
function ports(existing: SourceRow[] = [], patch: Partial<GeneratePorts> = {}) {
  const calls: string[] = [];
  let kept: string | null = null;
  const value: GeneratePorts = {
    list: async () => { calls.push("list"); return existing; },
    create: async (name) => { calls.push(`create:${name}`); return { id: "new1", token: FIRST_KEY }; },
    rotate: async (id) => { calls.push(`rotate:${id}`); return { id, token: FIRST_KEY }; },
    setMode: async (id, mode) => { calls.push(`mode:${id}:${mode}`); },
    useKey: (token) => { kept = token; calls.push("key"); return true; },
    sendTest: async () => { calls.push("test"); return answer(); },
    ...patch,
  };
  return { value, calls, kept: () => kept };
}
const row = (name: string, alarmMode = "direct"): SourceRow => ({ id: `id-${name}`, name, alarmMode, cooldownMinutes: 45, status: "active" });

test("no Simulator source: one is created, the key taken, the mode set to Av, a test sent, in that order", async () => {
  const { value, calls, kept } = ports([row("Linje 1")]);
  const steps: GenerateStep[] = [];
  const result = await generateConnection(value, (step) => steps.push(step));
  assert.ok(result.ok);
  assert.deepEqual(calls, ["list", `create:${SIMULATOR_SOURCE_NAME}`, "key", "mode:new1:off", "test"]);
  assert.deepEqual(steps, ["find", "create", "key", "mode", "test"]);
  assert.equal(kept(), FIRST_KEY);
  if (result.ok) { assert.equal(result.created, true); assert.equal(result.source.alarmMode, "off"); }
});

test("a Simulator source is there: it is reused with a new key, and set back to Av whatever it stood on", async () => {
  const { value, calls } = ports([row("Simulator", "direct"), row("Linje 1")]);
  const result = await generateConnection(value);
  assert.ok(result.ok);
  assert.deepEqual(calls, ["list", "rotate:id-Simulator", "key", "mode:id-Simulator:off", "test"], "Linje 1 is never touched, and nothing is created");
  if (result.ok) { assert.equal(result.created, false); assert.equal(result.source.alarmMode, "off"); assert.equal(result.source.id, "id-Simulator"); }
});

test("the result holds no key, whichever way it ends", async () => {
  const good = await generateConnection(ports().value);
  assert.ok(!JSON.stringify(good).includes(FIRST_KEY));
  const failed = await generateConnection(ports([], { setMode: async () => { throw new Error(`Fel med ${FIRST_KEY}`); } }).value);
  assert.ok(!failed.ok);
  assert.ok(!JSON.stringify(failed).includes(FIRST_KEY), "a key in a server text is masked");
});

test("a step that fails stops the rest, and its text stands word for word", async () => {
  for (const [patch, step, text, callsAfter] of [
    [{ list: async () => { throw new Error("Du har inte behörighet."); } }, "find", "Du har inte behörighet.", 0],
    [{ create: async () => { throw new Error("Företaget har redan 25 källor. Ta bort en först."); } }, "create", "Företaget har redan 25 källor. Ta bort en först.", 0],
    [{ setMode: async () => { throw new Error("Maskinintag kräver serverlagring."); } }, "mode", "Maskinintag kräver serverlagring.", 1],
    [{ useKey: () => false }, "key", "Svaret innehöll ingen källnyckel.", 0],
    [{ sendTest: async () => ({ refused: "Nyckeln nekades." }) }, "test", "Nyckeln nekades.", 1],
  ] as const) {
    const { value, calls } = ports([], patch as Partial<GeneratePorts>);
    const result = await generateConnection(value);
    assert.ok(!result.ok);
    if (!result.ok) { assert.equal(result.step, step); assert.equal(result.error, text); }
    assert.equal(calls.filter((call) => call === "test").length, 0, "no test after a stop");
    assert.ok(calls.filter((call) => call.startsWith("mode")).length <= callsAfter);
  }
  const refused = await generateConnection(ports([], { sendTest: async () => answer({ status: 409, tone: "warning", responseBody: '{"error":"Underhåll är avstängt."}' }) }).value);
  assert.ok(!refused.ok);
  if (!refused.ok) assert.equal(refused.error, '409: {"error":"Underhåll är avstängt."}', "the intake's answer as it came");
});

test("the test event is one a real device could send, marked Simulerat, through the intake with the key alone", async () => {
  const harness = makeHarness();
  const event = createEventFactory("t", SAFE_POLICY).make({ type: "state", code: "PLC-SIM-TEST", severity: "info", state: "running", text: "anslutningstest" }, NOW);
  assert.equal(event.text, "Simulerat: anslutningstest");
  assert.ok(event.eventId.startsWith("plcsim-"));
  assert.ok(parseBatch(JSON.parse(eventsBody([event])), new Date(NOW)).ok);
  const entry = await harness.device.probe({ path: EVENTS_PATH, body: eventsBody([event]) });
  assert.ok("status" in entry && entry.status === 202);
  assert.equal(harness.intake.calls[0].path, "/api/ingest/v1/events");
  assert.equal(harness.intake.calls[0].headers.authorization, `Bearer ${FIRST_KEY}`);
  assert.ok(!JSON.stringify(entry).includes(FIRST_KEY), "the log entry does not hold the key");
});

test("the panel: the key stays in the closure, two kinds of mode apart, the route is the Maskiner page's, the intake is unchanged", () => {
  const panel = readFileSync("features/plc-simulator/desktop/connection-panel.tsx", "utf8");
  const session = readFileSync("features/plc-simulator/desktop/connection-api.ts", "utf8");
  assert.deepEqual([...new Set([...session.matchAll(/"(\/api\/[^"]+)"/g)].map((match) => match[1]))], ["/api/machine-sources"], "no other session route");
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
  assert.match(panel, /useKey: \(token\) => simulator\.pasteKey\(token\)/, "the token goes straight on");
  assert.doesNotMatch(panel, /setResult\([^)]*token/);
  assert.match(panel, /Källans läge \(sparas i Workflow\)/);
  assert.match(panel, /Simulatorns spärrar/);
  assert.equal(MACHINES_HREF, "/?view=advanced&section=machines");
  // The server: every source lookup is by company as well as id, and a key needs the fresh confirmation.
  const route = readFileSync("lib/api-handlers/machine-sources.ts", "utf8");
  assert.match(route, /machineSource\.findFirst\(\{ where: \{ id: input\.id, organizationId: ctx\.organizationId \} \}\)/, "another company's source is not found");
  assert.match(route, /requireAdmin\(ctx\)/);
  assert.match(route, /checkOrigin\(request\)/);
  assert.equal([...route.matchAll(/await requireFreshAuth\(ctx\.user\.id, ctx\.auth\);/g)].length, 2, "create and rotate");
});
