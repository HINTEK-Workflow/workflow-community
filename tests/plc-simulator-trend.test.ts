import assert from "node:assert/strict";
import test from "node:test";
import { createPidLoop } from "../lib/machine/simulator/pid-loop";
import { compileProgram, createRunState, runCycle } from "../lib/machine/simulator/st/interpreter";
import { emptyInputs } from "../lib/machine/simulator/st/io";
import { createEngineState } from "../lib/machine/simulator/surface/engine";
import { startLayout } from "../lib/machine/simulator/surface/layout";
import { createTrendBuffer, MAX_TREND_SAMPLES, penCatalogue, penInfo, readPen, sampleTrend, TREND_SAMPLE_REAL_MS, trendClockText, trendLanes } from "../lib/machine/simulator/trend";

// PLC-simulatorn, Trend (2026-11-04): the pens are the PLC's own things, the time is the simulated clock, and the lanes never put two
// scales in one plot.

const SOURCE = "VAR Knapp AT %IX0.0 : BOOL; Niva : INT := 7; Reg : PID; T1 : TON; END_VAR Niva := Niva + 1; Reg(SP := 60.0, PV := 20.0); T1(IN := Knapp, PT := T#1s);";
function running() {
  const result = compileProgram(SOURCE);
  assert.ok(result.ok, result.ok ? "" : result.problem.message);
  if (!result.ok) throw new Error("no");
  const engine = createEngineState(startLayout());
  const base = emptyInputs();
  const di = base.di.map((_, index) => index === 0);
  const program = runCycle(result.compiled, createRunState(result.compiled), { ...base, di }, 100).state;
  return { compiled: result.compiled, source: { engine: { ...engine, program, inputs: { ...engine.inputs, di } }, pid: createPidLoop("oven") } };
}

test("a pen reads a tag, a terminal, a block's output, a process value or the regulator", () => {
  const { source } = running();
  assert.equal(readPen("var:Niva", source), 8);
  assert.equal(readPen("var:Knapp", source), 1, "a bit is 0 or 1");
  assert.equal(readPen("io:DI0", source), 1);
  assert.equal(readPen("io:DO3", source), 0);
  assert.equal(readPen("fb:Reg.SP", source), 60, "the PID block keeps what it was given");
  assert.equal(readPen("fb:Reg.PV", source), 20);
  assert.equal(readPen("fb:T1.Q", source), 0);
  assert.equal(readPen("plant:tank", source), 20);
  assert.equal(readPen("pid:sp", source), 60);
  assert.equal(readPen("var:Finns", source), null, "what the PLC does not have is no value, never a false zero");
  assert.equal(readPen("nonsense", source), null);
});

test("the catalogue offers the program's tags and blocks, unnamed terminals, process values and the regulator", () => {
  const { compiled } = running();
  const groups = Object.fromEntries(penCatalogue(compiled).map((group) => [group.group, group.pens.map((pen) => pen.id)]));
  assert.ok(groups.Taggar.includes("var:Niva") && groups.Taggar.includes("var:Knapp"));
  assert.ok(groups.Block.includes("fb:Reg.OUT") && groups.Block.includes("fb:T1.ET"));
  assert.ok(!groups.Plintar.includes("io:DI0"), "DI0 has a name, Knapp");
  assert.ok(groups.Plintar.includes("io:AI2"));
  assert.ok(groups.Process.includes("plant:oven"));
  assert.deepEqual(groups.Regulator, ["pid:sp", "pid:pv", "pid:out"]);
  assert.ok(penCatalogue(null).every((group) => group.group !== "Taggar"), "before a compile: only what needs no program");
});

test("samples follow the simulated clock: at 600× the same real time spans 600 times as much", () => {
  const { source } = running();
  const run = (speed: number) => {
    const buffer = createTrendBuffer();
    let clockMin = 100;
    for (let tick = 0; tick < 20; tick += 1) {
      clockMin += (TREND_SAMPLE_REAL_MS / 60_000) * speed;
      assert.equal(sampleTrend(buffer, ["var:Niva"], source, clockMin, 1000 + tick * TREND_SAMPLE_REAL_MS), true);
    }
    return buffer.samples.at(-1)!.t - buffer.samples[0].t;
  };
  assert.ok(Math.abs(run(600) / run(1) - 600) < 0.001, "the curve's time axis scales with the speed");
});

test("a sample at most every 200 ms of real time, none without pens, and a bounded buffer", () => {
  const { source } = running();
  const buffer = createTrendBuffer();
  assert.equal(sampleTrend(buffer, [], source, 1, 1000), false, "no pens, no samples");
  assert.equal(sampleTrend(buffer, ["var:Niva"], source, 1, 1000), true);
  assert.equal(sampleTrend(buffer, ["var:Niva"], source, 1, 1000 + TREND_SAMPLE_REAL_MS - 1), false);
  for (let index = 0; index < MAX_TREND_SAMPLES + 50; index += 1) sampleTrend(buffer, ["var:Niva"], source, index, 2000 + index * TREND_SAMPLE_REAL_MS);
  assert.equal(buffer.samples.length, MAX_TREND_SAMPLES);
});

test("lanes: setpoint and process value share one, everything else has its own scale, a bit is 0–1, never two axes in a lane", () => {
  const { compiled } = running();
  const infos = ["pid:sp", "pid:pv", "pid:out", "var:Knapp", "var:Niva", "fb:Reg.SP", "fb:Reg.PV", "fb:Reg.OUT"].map((id) => penInfo(id, compiled));
  const samples = [{ t: 1, values: { "pid:sp": 60, "pid:pv": 20, "pid:out": 50, "var:Knapp": 1, "var:Niva": 8, "fb:Reg.SP": 60, "fb:Reg.PV": 20, "fb:Reg.OUT": 30 } }];
  const lanes = trendLanes(infos, samples);
  const byKey = Object.fromEntries(lanes.map((lane) => [lane.key, lane]));
  assert.deepEqual(byKey.pid.pens.map((pen) => pen.id), ["pid:sp", "pid:pv"]);
  assert.deepEqual(byKey["fb:Reg"].pens.map((pen) => pen.id), ["fb:Reg.SP", "fb:Reg.PV"]);
  assert.ok(byKey["pid:out"], "the output has a lane of its own");
  assert.equal(byKey["var:Knapp"].digital, true);
  assert.deepEqual([byKey["var:Knapp"].min, byKey["var:Knapp"].max], [0, 1]);
  assert.ok(byKey.pid.min < 20 && byKey.pid.max > 60, "the scale holds what is visible");
  assert.equal(penInfo("io:DI0", null).digital, true);
  assert.equal(penInfo("io:AI0", null).digital, false);
  assert.equal(penInfo("plant:oven", null).label, "Ugnstemperatur");
  assert.equal(trendClockText(5 * 3600 + 61), "05:01:01");
});
