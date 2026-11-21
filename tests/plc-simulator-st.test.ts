import assert from "node:assert/strict";
import test from "node:test";
import { ST_EXAMPLES } from "../lib/machine/simulator/st/examples";
import { compileProgram, createRunState, runCycle, type Compiled, type RunState } from "../lib/machine/simulator/st/interpreter";
import { addressIo, emptyInputs, ioAddressText, nameIo, type PlcInputs, rawToVolts, voltsToRaw } from "../lib/machine/simulator/st/io";
import { parseTimeLiteral, tokenize } from "../lib/machine/simulator/st/lexer";
import { SURFACE_EXAMPLES } from "../lib/machine/simulator/surface/examples";

// PLC-simulatorn, Grundläggande (2026-11-02): the ST dialect, own implementation. What compiles, what is refused with a
// Swedish message at the right line, and what a cycle does.

const compiled = (source: string): Compiled => { const result = compileProgram(source); assert.ok(result.ok, result.ok ? "" : `${result.problem.line}:${result.problem.col} ${result.problem.message}`); return result.compiled; };
const refused = (source: string) => { const result = compileProgram(source); assert.ok(!result.ok, "expected a compile error"); return result.problem; };
const inputs = (di: Partial<Record<number, boolean>> = {}, ai: Partial<Record<number, number>> = {}): PlcInputs => {
  const base = emptyInputs({ hour: 7, minute: 30, weekday: 3 });
  const nextDi = [...base.di], nextAi = [...base.ai];
  for (const [index, value] of Object.entries(di)) nextDi[Number(index)] = value === true;
  for (const [index, value] of Object.entries(ai)) nextAi[Number(index)] = value ?? 0;
  return { ...base, di: nextDi, ai: nextAi };
};
function cycles(program: Compiled, state: RunState, count: number, input: PlcInputs, dtMs = 50) {
  let current = state;
  let last = runCycle(program, current, input, dtMs);
  for (let index = 0; index < count; index += 1) { last = runCycle(program, current, input, dtMs); assert.equal(last.problem, null, last.problem?.message); current = last.state; }
  return last;
}

test("time literals and tokens: comments vanish, keywords are case-insensitive, addresses are read", () => {
  assert.equal(parseTimeLiteral("2s"), 2000);
  assert.equal(parseTimeLiteral("500ms"), 500);
  assert.equal(parseTimeLiteral("1m30s"), 90_000);
  assert.equal(parseTimeLiteral("1h"), 3_600_000);
  assert.equal(parseTimeLiteral("1.5s"), 1500);
  assert.equal(parseTimeLiteral("x"), null);
  const tokens = tokenize("(* hej *) if a THEN // rad\n b := %ix1.3; END_IF");
  assert.deepEqual(tokens.map((token) => token.text), ["IF", "a", "THEN", "b", ":=", "%IX1.3", ";", "END_IF", ""]);
  assert.equal(tokens[3].line, 2);
});

test("addresses map to the terminals: %IX1.0 is DI8, %QW1 is AO1, out-of-range is refused", () => {
  assert.equal(ioAddressText({ kind: "DI", index: 8 }), "%IX1.0");
  assert.equal(ioAddressText({ kind: "DO", index: 7 }), "%QX0.7");
  assert.equal(ioAddressText({ kind: "AI", index: 3 }), "%IW3");
  assert.deepEqual(addressIo({ dir: "Q", size: "W", byte: 1, bit: null }), { kind: "AO", index: 1 });
  assert.equal(addressIo({ dir: "I", size: "X", byte: 1, bit: 4 }), null, "DI12 does not exist");
  assert.deepEqual(nameIo("do5"), { kind: "DO", index: 5 });
  assert.equal(nameIo("AO2"), null);
  assert.equal(voltsToRaw(10), 10_000);
  assert.equal(rawToVolts(10_000), 10);
  assert.equal(rawToVolts(5000), 5);
  assert.match(refused("VAR a AT %IX1.4 : BOOL; END_VAR").message, /finns inte/);
  assert.match(refused("VAR a AT %IW0 : BOOL; END_VAR").message, /analog och INT/);
  assert.match(refused("VAR a AT %QX0.0 : BOOL; b AT %QX0.0 : BOOL; END_VAR").message, /används redan av a/);
});

test("self-holding, as the electrician writes it", () => {
  const program = compiled("VAR Start AT %IX0.0 : BOOL; Stopp AT %IX0.1 : BOOL; Motor AT %QX0.0 : BOOL; END_VAR Motor := (Start OR Motor) AND Stopp;");
  let state = createRunState(program);
  // Stopp is a closing contact in its rest state: 1 means not pressed.
  let result = runCycle(program, state, inputs({ 1: true }), 50);
  assert.equal(result.outputs.do[0], false);
  result = runCycle(program, result.state, inputs({ 0: true, 1: true }), 50);
  assert.equal(result.outputs.do[0], true, "Start pressed");
  result = runCycle(program, result.state, inputs({ 1: true }), 50);
  assert.equal(result.outputs.do[0], true, "held");
  result = runCycle(program, result.state, inputs({}), 50);
  assert.equal(result.outputs.do[0], false, "Stopp pressed");
  state = result.state;
  assert.deepEqual(program.usedInputs.map((io) => io.index), [0, 1]);
  assert.equal(state.vars.Motor, false);
});

test("TON, TOF, R_TRIG, CTU, CTD count time and edges in the cycle time", () => {
  const program = compiled(`VAR In AT %IX0.0 : BOOL; Q AT %QX0.0 : BOOL; Off AT %QX0.1 : BOOL; Pulse AT %QX0.2 : BOOL; Five AT %QX0.3 : BOOL; Done AT %QX0.4 : BOOL;
    T1 : TON; T2 : TOF; R : R_TRIG; C : CTU; D : CTD; END_VAR
    T1(IN := In, PT := T#1s); Q := T1.Q; T2(IN := In, PT := T#500ms); Off := T2.Q; R(CLK := In); Pulse := R.Q; C(CU := R.Q, R := FALSE, PV := 2); Five := C.Q; D(CD := R.Q, LD := C.CV = 0, PV := 3); Done := D.Q;`);
  let state = createRunState(program);
  let result = runCycle(program, state, inputs({ 0: true }), 100);
  assert.equal(result.outputs.do[2], true, "rising edge for one cycle");
  assert.equal(result.outputs.do[0], false);
  result = cycles(program, result.state, 9, inputs({ 0: true }), 100);
  assert.equal(result.outputs.do[2], false, "edge gone");
  assert.equal(result.outputs.do[0], false, "900 ms is not yet 1 s");
  result = cycles(program, result.state, 2, inputs({ 0: true }), 100);
  assert.equal(result.outputs.do[0], true, "TON reached");
  assert.equal(result.state.fbs.T1.outputs.ET, 1000);
  result = runCycle(program, result.state, inputs({}), 100);
  assert.equal(result.outputs.do[0], false, "TON drops at once");
  assert.equal(result.outputs.do[1], true, "TOF holds");
  result = cycles(program, result.state, 5, inputs({}), 100);
  assert.equal(result.outputs.do[1], false, "TOF ran out after 500 ms");
  result = runCycle(program, result.state, inputs({ 0: true }), 100);
  assert.equal(result.outputs.do[3], true, "second rising edge: CTU reached 2");
  assert.equal(result.state.fbs.C.outputs.CV, 2);
  state = result.state;
  assert.equal(typeof state.fbs.D.outputs.CV, "number");
});

test("types: INT widens to REAL, REAL to INT needs a function, integer division truncates, CASE takes ranges", () => {
  const program = compiled(`VAR A AT %IW0 : INT; R : REAL; I : INT; Steg : INT := 2; L AT %QX0.0 : BOOL; O AT %QW0 : INT; END_VAR
    R := A / 3; I := A / 3; O := REAL_TO_INT(R * 2.0); CASE Steg OF 1: L := FALSE; 2, 3..5: L := R > 3.0; ELSE L := TRUE; END_CASE;`);
  const result = runCycle(program, createRunState(program), inputs({}, { 0: 10 }), 50);
  assert.equal(result.state.vars.R, 3, "INT / INT is integer division, then widened");
  assert.equal(result.state.vars.I, 3);
  assert.equal(result.outputs.ao[0], 6);
  assert.equal(result.outputs.do[0], false, "3 > 3.0 is false");
  const real = compiled("VAR R : REAL; END_VAR R := 10.0 / 4;");
  assert.equal(runCycle(real, createRunState(real), inputs(), 50).state.vars.R, 2.5);
  assert.match(refused("VAR I : INT; END_VAR I := 1.5;").message, /REAL_TO_INT eller TRUNC/);
  assert.match(refused("VAR B : BOOL; END_VAR B := 1;").message, /BOOL och får ett INT/);
  assert.match(refused("VAR B : BOOL; END_VAR IF 1 THEN B := TRUE; END_IF").message, /IF måste vara BOOL/);
  assert.match(refused("VAR T : TON; END_VAR T(IN := TRUE);").message, /behöver PT/);
  assert.match(refused("VAR T : TON; END_VAR T(IN := TRUE, PT := 2);").message, /PT på TON är TIME/);
  assert.match(refused("VAR T : TON; B : BOOL; END_VAR B := T;").message, /T\.Q/);
  assert.match(refused("VAR In AT %IX0.0 : BOOL; END_VAR In := TRUE;").message, /ingång/);
  assert.match(refused("VAR A : INT; END_VAR A := B;").message, /inte deklarerad/);
  assert.match(refused("VAR A : INT; END_VAR A := 1").message, /semikolon/);
  const problem = refused("VAR A : INT;\nEND_VAR\nA := 1 +;");
  assert.equal(problem.line, 3);
  assert.equal(problem.col, 9, "points at the ; that came too early");
  assert.match(refused("(* aldrig stängd").message, /saknar sitt slut/);
  assert.match(refused("VAR A : TIME; END_VAR A := T#2x;").message, /Tiden går inte att läsa/);
});

test("runtime faults stop the cycle with their line, and the state is left as before", () => {
  const program = compiled("VAR A AT %IW0 : INT; R : REAL; END_VAR\nR := 10.0 / INT_TO_REAL(A);");
  const state = createRunState(program);
  const result = runCycle(program, state, inputs({}, { 0: 0 }), 50);
  assert.equal(result.problem?.message, "Division med noll.");
  assert.equal(result.problem?.line, 2);
  assert.equal(result.state, state);
  assert.equal(runCycle(program, state, inputs({}, { 0: 5 }), 50).state.vars.R, 2);
});

test("the clock variables and plain terminal names need no AT", () => {
  const program = compiled("VAR TID_H : INT; VECKODAG : INT; DO0 : BOOL; AI1 : INT; AO0 : INT; END_VAR DO0 := VECKODAG <= 5 AND TID_H >= 6 AND TID_H < 18; AO0 := AI1;");
  const result = runCycle(program, createRunState(program), inputs({}, { 1: 1234 }), 50);
  assert.equal(result.outputs.do[0], true, "Wednesday 07:30 is within the schedule");
  assert.equal(result.outputs.ao[0], 1234);
  assert.match(refused("VAR TID_H : REAL; END_VAR").message, /klockan/);
  assert.match(refused("VAR TID_H : INT; END_VAR TID_H := 1;").message, /klockan/);
});

test("the PID block drives its output within MIN and MAX, and manual mode is bumpless", () => {
  const program = compiled("VAR PV AT %IW0 : INT; Man AT %IX0.0 : BOOL; Out AT %QW0 : INT; Reg : PID; END_VAR Reg(SP := 50.0, PV := INT_TO_REAL(PV) / 100.0, KP := 2.0, TI := 10.0, MIN := 0.0, MAX := 100.0, MANUAL := Man, MV := 30.0); Out := REAL_TO_INT(Reg.OUT * 100.0);");
  let result = cycles(program, createRunState(program), 20, inputs({}, { 0: 0 }), 100);
  assert.equal(result.outputs.ao[0], 10_000, "far below the setpoint: full output, clamped");
  result = cycles(program, result.state, 5, inputs({ 0: true }, { 0: 5000 }), 100);
  assert.equal(result.outputs.ao[0], 3000, "manual: the hand value");
  result = runCycle(program, result.state, inputs({}, { 0: 5000 }), 100);
  assert.ok(Math.abs((result.outputs.ao[0] ?? 0) - 3000) < 200, `back to auto at the setpoint stays near the hand value, got ${result.outputs.ao[0]}`);
});

test("every example program, pure and on a drawing, compiles and runs a hundred cycles", () => {
  for (const example of ST_EXAMPLES) {
    const program = compiled(example.source);
    cycles(program, createRunState(program), 100, inputs({ 0: true }, { 0: 9000 }));
  }
  for (const example of SURFACE_EXAMPLES) {
    const program = compiled(example.layout.program);
    cycles(program, createRunState(program), 100, inputs({ 0: true, 1: true, 2: true }, { 0: 5000, 1: 5000, 2: 5000 }));
    assert.ok(program.usedOutputs.length > 0, `${example.id} drives an output`);
  }
});

test("TP gives one pulse of PT on a rising edge, whatever IN does afterwards, and needs a new edge for the next", () => {
  const program = compiled("VAR In AT %IX0.0 : BOOL; Q AT %QX0.0 : BOOL; P : TP; END_VAR P(IN := In, PT := T#300ms); Q := P.Q;");
  let result = runCycle(program, createRunState(program), inputs({ 0: true }), 100);
  assert.equal(result.outputs.do[0], true, "on at the edge");
  result = runCycle(program, result.state, inputs({}), 100);
  assert.equal(result.outputs.do[0], true, "stays on though IN dropped");
  result = runCycle(program, result.state, inputs({}), 100);
  assert.equal(result.outputs.do[0], true, "200 ms: still on");
  result = runCycle(program, result.state, inputs({}), 100);
  assert.equal(result.outputs.do[0], false, "300 ms over");
  result = runCycle(program, result.state, inputs({ 0: true }), 100);
  assert.equal(result.outputs.do[0], true, "a new edge, a new pulse");
  result = cycles(program, result.state, 5, inputs({ 0: true }), 100);
  assert.equal(result.outputs.do[0], false, "no retrigger while IN stays on");
  assert.equal(result.state.fbs.P.outputs.ET, 300);
});
