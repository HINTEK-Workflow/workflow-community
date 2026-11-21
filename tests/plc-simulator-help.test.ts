import assert from "node:assert/strict";
import test from "node:test";
import { ALARM_MODE_LABELS, ALARM_MODES, DAILY_ALARM_ORDER_CAP } from "../lib/machine/alarm-rules";
import { MAX_EVENTS_PER_CALL, parseBatch } from "../lib/machine/intake";
import { DEFAULT_COOLDOWN } from "../lib/machine/simulator/generate-connection";
import { ALARM_DEMO_PART, ALARM_PARTS, API_PARTS, COMMON_FAULTS, GUIDE_EXAMPLE_ID, GUIDE_PROGRAM, GUIDE_STEPS, HELP_KEYS, HELP_TOPICS, INGEST_EXAMPLE_BODY, ingestExample, LADDER_LINES, REFERENCE_PARTS } from "../lib/machine/simulator/help";
import { compileProgram } from "../lib/machine/simulator/st/interpreter";
import { checkDrawing } from "../lib/machine/simulator/surface/check";
import { DEVICE_DEFS } from "../lib/machine/simulator/surface/devices";
import { createEngineState, startRun, stepEngine, touchDevice } from "../lib/machine/simulator/surface/engine";
import { surfaceExampleById } from "../lib/machine/simulator/surface/examples";
import { startLayout } from "../lib/machine/simulator/surface/layout";

// Hjälpen får bara beskriva det som fungerar (2026-11-05): texterna hålls här mot koden.

const allText = () => JSON.stringify([GUIDE_STEPS, ALARM_PARTS, ALARM_DEMO_PART, API_PARTS, REFERENCE_PARTS, COMMON_FAULTS, HELP_KEYS]);
const compiled = (text: string) => { const result = compileProgram(text); assert.ok(result.ok, "the program compiles"); return result.compiled; };

test("the guide's program is the ready example's, and following it lights the lamp while the button is held", () => {
  const example = surfaceExampleById(GUIDE_EXAMPLE_ID);
  assert.ok(example);
  assert.equal(example.layout.program, GUIDE_PROGRAM);
  const layout = example.layout;
  let state = startRun(createEngineState(layout), compiled(layout.program));
  const go = () => { for (let index = 0; index < 4; index += 1) state = stepEngine(state, layout, 100, 1000 + index * 100, () => 0).state; };
  go();
  assert.equal(state.run, true);
  assert.equal(state.devices["lampa-1"].energised, false, "dark before the press");
  state = touchDevice(state, "knapp-1", { pressed: true });
  go();
  assert.equal(state.devices["lampa-1"].energised, true, "lit while held");
  state = touchDevice(state, "knapp-1", { pressed: false });
  go();
  assert.equal(state.devices["lampa-1"].energised, false, "dark again");
  assert.deepEqual(checkDrawing(layout, state.solved, state.outputs).filter((finding) => finding.level === "error"), []);
});

test("the guide names what the drawing really has", () => {
  assert.equal(DEVICE_DEFS.kalla24.name, "24 V DC");
  assert.equal(DEVICE_DEFS.knapp.name, "Tryckknapp");
  assert.equal(DEVICE_DEFS.lampa.name, "Lampa");
  assert.equal(GUIDE_STEPS.length, 8);
  const fresh = startLayout();
  assert.equal(fresh.devices.filter((device) => device.kind === "kalla24").length, 1, "a new drawing has its source, as step 1 says");
  assert.equal(fresh.wires.length, 2, "and it is wired to L+ and M");
  assert.deepEqual(DEVICE_DEFS.lampa.terminals.map((terminal) => terminal.id), ["X1", "X2"]);
  assert.ok(GUIDE_STEPS.every((step) => step.title && step.lines.length));
  assert.deepEqual(HELP_TOPICS.map((topic) => topic.id), ["start", "alarms", "api", "reference"]);
});

test("the alarm text says what the rules say", () => {
  const modes = ALARM_PARTS.find((part) => part.id === "lagen")!.rows!.map(([name]) => name);
  assert.deepEqual(modes, ALARM_MODES.map((mode) => ALARM_MODE_LABELS[mode]));
  const stops = JSON.stringify(ALARM_PARTS.find((part) => part.id === "sparrar"));
  assert.ok(stops.includes(`${DEFAULT_COOLDOWN} minuter`));
  assert.ok(stops.includes(`Högst ${DAILY_ALARM_ORDER_CAP} per företag`));
  assert.match(JSON.stringify(ALARM_PARTS.find((part) => part.id === "ai")), /AI skapar inga larm och inga arbetsordrar/);
  assert.match(JSON.stringify(ALARM_DEMO_PART), /ingen AI anropas/);
});

test("the API example is accepted by the intake itself, and its limits are the intake's", () => {
  const parsed = parseBatch(INGEST_EXAMPLE_BODY, new Date("2026-11-05T08:30:00+01:00"));
  assert.ok(parsed.ok);
  if (parsed.ok) assert.deepEqual(parsed.items.map((item) => item.kind), ["valid"]);
  assert.ok(JSON.stringify(API_PARTS).includes(`1–${MAX_EVENTS_PER_CALL} händelser`));
  const example = ingestExample("https://example.test");
  assert.match(example, /POST https:\/\/example\.test\/api\/ingest\/v1\/events/);
  assert.match(example, /Bearer <källans nyckel>/);
});

test("the Raspberry Pi example shows the chain and promises nothing it cannot keep", () => {
  const part = API_PARTS.find((item) => item.id === "pi")!;
  assert.deepEqual(part.flow, ["Kundens anläggning", "Raspberry Pi", "4G", "Workflow-servern", "Arbetsorder"]);
  const text = JSON.stringify(part);
  assert.match(text, /skild från kundens nät/);
  assert.match(text, /väljer den som installerar/);
  assert.match(text, /inte på en riktig Pi/);
  assert.match(text, /inget löfte om säkerhet/);
});

test("the words the owner has decided: no alarm system, no secret key, no three-phase promise", () => {
  const text = allText();
  assert.doesNotMatch(text, /larmsystem/i);
  assert.doesNotMatch(text, /hwf_mch_/);
  assert.doesNotMatch(text, /XIC|XIO|OTE/);
  assert.match(JSON.stringify(REFERENCE_PARTS.find((part) => part.id === "kontaktor")), /räknar inte trefas/);
  assert.ok(LADDER_LINES.some(([name]) => name === "TON"));
  assert.equal(HELP_KEYS[0][0], "F1");
});
