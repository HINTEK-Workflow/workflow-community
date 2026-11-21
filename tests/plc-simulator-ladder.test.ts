import assert from "node:assert/strict";
import test from "node:test";
import { stToLadder } from "../lib/machine/simulator/ladder/convert";
import { evaluateLadder } from "../lib/machine/simulator/ladder/evaluate";
import { GENERATED_MARK, isGeneratedSt, ladderToSt, ptLiteral } from "../lib/machine/simulator/ladder/generate";
import { emptyLadder, freeBlockName, freeLdId, isLdName, ladderSchema, type LadderProgram, type LdNode, type LdRung } from "../lib/machine/simulator/ladder/model";
import { ncInputOf, ncInputs } from "../lib/machine/simulator/ladder/terminals";
import { ST_EXAMPLES } from "../lib/machine/simulator/st/examples";
import { compileProgram, createRunState, runCycle, type Compiled, type RunState } from "../lib/machine/simulator/st/interpreter";
import { emptyInputs, PLC_IO, type PlcInputs } from "../lib/machine/simulator/st/io";
import { seededRandom } from "../lib/machine/simulator/random";
import { SURFACE_EXAMPLES } from "../lib/machine/simulator/surface/examples";

// PLC-simulatorn, Ladder (owner 2026-11-03): the ladder program as data, the ST generated from it, and the flow the editor
// shows. The one thing that matters: Ladder and the ST it generates mean the same, cycle after cycle, timers and counters too.
// Lossless (owner: "växla mellan ladder och ST kod utan att data förloras"): every ST program reads as Ladder, what has no
// ladder shape as ST-blocks, and the text written back means the same – shown by running both with the same inputs.

let counter = 0;
const id = (prefix = "e") => `${prefix}${++counter}`;
const no = (name: string): LdNode => ({ id: id(), kind: "no", var: name });
const par = (...branches: LdNode[][]): LdNode => ({ id: id(), kind: "parallel", branches });
const rung = (items: LdNode[], outputs: { kind: "coil" | "ncoil" | "set" | "reset"; var: string }[], comment = ""): LdRung => ({ id: id("r"), comment, items, outputs: outputs.map((out) => ({ id: id("o"), ...out })) });
const compiled = (source: string): Compiled => { const result = compileProgram(source); assert.ok(result.ok, result.ok ? "" : `${result.problem.line}:${result.problem.col} ${result.problem.message}\n${source}`); return result.compiled; };
const inputsOf = (di: Partial<Record<number, boolean>> = {}, ai: Partial<Record<number, number>> = {}): PlcInputs => {
  const base = emptyInputs({ hour: 7, minute: 30, weekday: 3 });
  const nextDi = [...base.di], nextAi = [...base.ai];
  for (const [index, value] of Object.entries(di)) nextDi[Number(index)] = value === true;
  for (const [index, value] of Object.entries(ai)) nextAi[Number(index)] = value ?? 0;
  return { ...base, di: nextDi, ai: nextAi };
};

/** Runs the generated ST for a sequence of inputs and checks that the evaluator sees the same variables every cycle. */
function runBoth(ladder: LadderProgram, sequence: PlcInputs[], dtMs = 100) {
  const source = ladderToSt(ladder);
  const program = compiled(source);
  const inputNames = new Set([...program.vars.values()].filter((info) => info.io?.kind === "DI" || info.io?.kind === "AI" || ["TID_H", "TID_M", "VECKODAG"].includes(info.name.toUpperCase())).map((info) => info.name));
  let state: RunState = createRunState(program);
  const outputs = [];
  for (const inputs of sequence) {
    const before = state;
    const result = runCycle(program, state, inputs, dtMs);
    assert.equal(result.problem, null, result.problem?.message);
    state = result.state;
    const flow = evaluateLadder(ladder, before.vars, state.vars, inputNames, state.fbs);
    for (const name of program.vars.keys()) assert.equal(flow.vars[name], state.vars[name], `${name} agrees between the evaluator and the interpreter\n${source}`);
    outputs.push(result.outputs);
  }
  return { outputs, source, state };
}

test("self-holding in Ladder generates the electrician's ST and runs like it", () => {
  const ladder: LadderProgram = { name: "StartStopp", vars: [{ name: "Start", type: "BOOL", address: "DI0", init: null }, { name: "Stopp", type: "BOOL", address: "DI1", init: null }, { name: "Motor", type: "BOOL", address: "DO0", init: null }, { name: "Drift", type: "BOOL", address: "DO1", init: null }],
    rungs: [rung([par([no("Start")], [no("Motor")]), no("Stopp")], [{ kind: "coil", var: "Motor" }], "Självhållning"), rung([no("Motor")], [{ kind: "coil", var: "Drift" }])] };
  assert.ok(ladderSchema.safeParse(ladder).success);
  const source = ladderToSt(ladder);
  assert.match(source, /Start AT %IX0\.0 : BOOL;/);
  assert.match(source, /Motor := \(Start OR Motor\) AND Stopp;/);
  assert.match(source, /Drift := Motor;/);
  assert.ok(isGeneratedSt(source) && source.split("\n")[1] === GENERATED_MARK);
  const { outputs } = runBoth(ladder, [inputsOf({ 1: true }), inputsOf({ 0: true, 1: true }), inputsOf({ 1: true }), inputsOf({})]);
  assert.deepEqual(outputs.map((out) => out.do[0]), [false, true, true, false]);
  assert.deepEqual(outputs.map((out) => out.do[1]), [false, true, true, false]);
  // The same thing by hand in ST gives the same outputs.
  const hand = compiled("VAR Start AT %IX0.0 : BOOL; Stopp AT %IX0.1 : BOOL; Motor AT %QX0.0 : BOOL; END_VAR Motor := (Start OR Motor) AND Stopp;");
  let state = createRunState(hand);
  const handOut = [inputsOf({ 1: true }), inputsOf({ 0: true, 1: true }), inputsOf({ 1: true }), inputsOf({})].map((inputs) => { const result = runCycle(hand, state, inputs, 100); state = result.state; return result.outputs.do[0]; });
  assert.deepEqual(handOut, outputs.map((out) => out.do[0]));
});

test("timers, counters, comparisons, set/reset and negated coils generate correct ST and agree with the evaluator over cycles", () => {
  const ladder: LadderProgram = {
    name: "Block", vars: [{ name: "Niva", type: "INT", address: "AI0", init: null }, { name: "Grans", type: "INT", address: null, init: 7000 }],
    rungs: [
      rung([no("DI0"), { id: id(), kind: "ton", name: "T1", ptMs: 300 }], [{ kind: "coil", var: "DO0" }], "Fördröjd start"),
      rung([no("DI1"), { id: id(), kind: "tof", name: "T2", ptMs: 200 }], [{ kind: "coil", var: "DO1" }]),
      rung([no("DI2"), { id: id(), kind: "tp", name: "T3", ptMs: 250 }], [{ kind: "coil", var: "DO2" }]),
      rung([no("DI3"), { id: id(), kind: "ctu", name: "C1", pv: 2, aux: "DI4" }], [{ kind: "coil", var: "DO3" }]),
      rung([{ id: id(), kind: "cmp", op: ">", left: { kind: "var", name: "Niva" }, right: { kind: "var", name: "Grans" } }], [{ kind: "set", var: "Hog" }]),
      rung([{ id: id(), kind: "cmp", op: "<", left: { kind: "var", name: "Niva" }, right: { kind: "const", value: 3000, type: "INT" } }], [{ kind: "reset", var: "Hog" }]),
      rung([no("Hog")], [{ kind: "coil", var: "DO4" }, { kind: "ncoil", var: "DO5" }]),
      rung([par([no("DI5"), { id: id(), kind: "ton", name: "T4", ptMs: 100 }], [no("DI6")])], [{ kind: "coil", var: "DO6" }], "Block i en gren"),
      rung([{ id: id(), kind: "cmp", op: ">=", left: { kind: "member", object: "C1", field: "CV" }, right: { kind: "const", value: 1, type: "INT" } }], [{ kind: "coil", var: "DO7" }]),
    ],
  };
  const source = ladderToSt(ladder);
  assert.match(source, /T1\(IN := DI0, PT := T#300ms\);\nDO0 := T1\.Q;/);
  assert.match(source, /C1\(CU := DI3, R := DI4, PV := 2\);/);
  assert.match(source, /IF Niva > Grans THEN Hog := TRUE; END_IF;/);
  assert.match(source, /DO5 := NOT Hog;/);
  assert.match(source, /T4\(IN := DI5, PT := T#100ms\);\nDO6 := T4\.Q OR DI6;/);
  assert.match(source, /Grans : INT := 7000;/);
  assert.match(source, /T3 : TP;/);
  const steady = inputsOf({ 0: true, 1: true, 2: true, 5: true }, { 0: 8000 });
  const sequence = [steady, steady, steady, steady, inputsOf({ 3: true }, { 0: 8000 }), inputsOf({}, { 0: 8000 }), inputsOf({ 3: true }, { 0: 2000 }), inputsOf({ 4: true }, { 0: 2000 }), inputsOf({ 6: true }, { 0: 5000 })];
  const { outputs } = runBoth(ladder, sequence);
  assert.deepEqual(outputs.map((out) => out.do[0]), [false, false, false, true, false, false, false, false, false], "TON after 300 ms, off when DI0 drops");
  assert.equal(outputs[4].do[1], true, "TOF holds 200 ms after DI1 dropped");
  assert.equal(outputs[6].do[1], false);
  assert.deepEqual(outputs.slice(0, 4).map((out) => out.do[2]), [true, true, true, false], "TP: a 250 ms pulse on the edge, then off though DI2 stays");
  assert.deepEqual(outputs.slice(4, 8).map((out) => out.do[3]), [false, false, true, false], "CTU reaches 2 on the second edge, DI4 resets");
  assert.deepEqual(outputs.map((out) => out.do[4]), [true, true, true, true, true, true, false, false, false], "set above 7000, reset below 3000");
  assert.deepEqual(outputs.map((out) => out.do[5]), [false, false, false, false, false, false, true, true, true]);
  assert.equal(outputs[1].do[6], true, "the branch with the timer passes after 100 ms");
  assert.equal(outputs[8].do[6], true, "the plain branch passes at once");
  assert.equal(outputs[4].do[7], true, "C1.CV >= 1 after the first count");
  // The flow the editor draws: with DI0 on and the timer not yet out, the contact carries power and the timer does not.
  const program = compiled(source);
  const first = runCycle(program, createRunState(program), steady, 100);
  const flow = evaluateLadder(ladder, createRunState(program).vars, first.state.vars, new Set(["DI0", "DI1", "DI2", "DI3", "DI4", "DI5", "DI6", "Niva"]), first.state.fbs);
  const contact = ladder.rungs[0].items[0], timer = ladder.rungs[0].items[1];
  assert.deepEqual(flow.nodes.get(contact.id), { in: true, out: true });
  assert.deepEqual(flow.nodes.get(timer.id), { in: true, out: false });
  assert.equal(flow.rungs.get(ladder.rungs[4].id), true, "8000 > 7000");
});

test("names: reserved words and bad names are refused, ids and block names are free, time literals are written as a person would", () => {
  assert.ok(isLdName("Motor") && isLdName("DI0") && isLdName("_x1"));
  assert.ok(!isLdName("IF") && !isLdName("ton") && !isLdName("1a") && !isLdName("Motor 1") && !isLdName(""));
  const ladder = emptyLadder();
  ladder.rungs.push(rung([no("A")], [{ kind: "coil", var: "B" }]));
  assert.ok(!ladder.rungs.some((item) => item.id === freeLdId("r", ladder)) && freeLdId("r", ladder).startsWith("r"), "a new id");
  assert.equal(freeBlockName("ton", ladder), "T1");
  assert.equal(freeBlockName("ctu", { ...ladder, vars: [{ name: "C1", type: "BOOL", address: null, init: null }] }), "C2");
  assert.equal(ptLiteral(2000), "2s");
  assert.equal(ptLiteral(500), "500ms");
  assert.equal(ptLiteral(90_000), "1m30s");
  assert.equal(ptLiteral(1500), "1.5s");
  assert.ok(!ladderSchema.safeParse({ ...ladder, rungs: [rung([no("IF")], [])] }).success, "a reserved word is no variable");
  // An empty rung with an output is TRUE: the coil is on.
  const always: LadderProgram = { ...emptyLadder(), rungs: [rung([], [{ kind: "coil", var: "DO0" }])] };
  assert.match(ladderToSt(always), /DO0 := TRUE;/);
  assert.equal(runBoth(always, [inputsOf()]).outputs[0].do[0], true);
});

/** Runs two programs with the same pseudo-random inputs for some cycles and compares every output, cycle by cycle. */
function sameBehaviour(sourceA: string, sourceB: string, cycles = 60, seed = 11) {
  const a = compiled(sourceA), b = compiled(sourceB);
  let stateA = createRunState(a), stateB = createRunState(b);
  const random = seededRandom(seed);
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const di = Array.from({ length: PLC_IO.di }, () => random() < 0.4);
    const ai = Array.from({ length: PLC_IO.ai }, () => Math.round(random() * 10_000));
    const inputs: PlcInputs = { di, ai, clock: { hour: Math.floor(cycle / 4) % 24, minute: (cycle * 15) % 60, weekday: 1 + (cycle % 7) } };
    const resultA = runCycle(a, stateA, inputs, 100), resultB = runCycle(b, stateB, inputs, 100);
    assert.equal(resultA.problem, null, resultA.problem?.message);
    assert.equal(resultB.problem, null, resultB.problem?.message);
    assert.deepEqual(resultB.outputs, resultA.outputs, `cycle ${cycle}: the outputs agree\n${sourceB}`);
    stateA = resultA.state; stateB = resultB.state;
  }
}

test("every example program reads as Ladder, writes back as ST that compiles, means the same, and is stable on a second pass", () => {
  const sources = [...ST_EXAMPLES.map((example) => example.source), ...SURFACE_EXAMPLES.map((example) => example.layout.program)];
  for (const source of sources) {
    const converted = stToLadder(source);
    assert.ok(converted.ok, converted.ok ? "" : converted.reason);
    if (!converted.ok) continue;
    assert.ok(ladderSchema.safeParse(converted.ladder).success, "a valid ladder");
    const text = ladderToSt(converted.ladder);
    sameBehaviour(source, text);
    const again = stToLadder(text);
    assert.ok(again.ok && ladderToSt(again.ladder) === text, "the second pass gives the same text: nothing drifts");
    // No line of the original is lost: every statement's text is in the new one.
    for (const line of source.split("\n").map((item) => item.trim()).filter((item) => item && !/^(PROGRAM|VAR|END_VAR|END_PROGRAM)\b/.test(item) && !item.startsWith("(*") && !item.startsWith("//"))) {
      const statement = line.replace(/\s*(\/\/.*|\(\*.*\*\))\s*$/, "").trim();
      assert.ok(text.includes(statement) || /^\w+\(/.test(statement) || /^\w+ AT %|: (BOOL|INT|REAL|TIME|TON|TOF|TP|CTU|CTD|R_TRIG|F_TRIG|PID)/.test(line), `${statement} is kept\n${text}`);
    }
  }
  // Declarations keep their comments, a comment before the body is the header, a comment on a statement's line is the rung's.
  const level = SURFACE_EXAMPLES.find((example) => example.id === "nivareglering")!.layout.program;
  const ladder = stToLadder(level);
  assert.ok(ladder.ok);
  if (ladder.ok) {
    assert.equal(ladder.ladder.vars.find((variable) => variable.name === "NivaRaw")?.comment, "0–10000 för 0–10 V = 0–100 %");
    assert.match(ladderToSt(ladder.ladder), /NivaRaw AT %IW0 : INT;  \/\/ 0–10000 för 0–10 V = 0–100 %/);
    assert.equal(ladder.ladder.vars.find((variable) => variable.name === "LarmTimer"), undefined, "a timer drawn as a block needs no row of its own");
    assert.ok(ladder.ladder.vars.some((variable) => variable.name === "Niva" && variable.type === "REAL"));
    const blocks = ladder.ladder.rungs.flatMap((item) => item.items.filter((node) => node.kind === "st"));
    assert.equal(blocks.length, 1, "the scaling and the two-point control share one block");
    assert.ok(blocks[0].kind === "st" && blocks[0].text.includes("Niva := INT_TO_REAL(NivaRaw) / 100.0;") && blocks[0].text.includes("(* Tvåpunktsreglering: start under 30 %, stopp över 70 %. *)\nIF Niva < 30.0 THEN"));
    assert.equal(ladder.ladder.rungs[3].comment, "Larmet väntar 3 s så att ett kort toppvärde inte larmar.");
  }
  const headed = stToLadder("PROGRAM Topp\n(* Vad programmet gör. *)\n// och en rad till\nVAR A : BOOL; B : BOOL; END_VAR\nB := A;");
  assert.ok(headed.ok && headed.ladder.header === "(* Vad programmet gör. *)\n// och en rad till");
  if (headed.ok) assert.match(ladderToSt(headed.ladder), /PROGRAM Topp\n\(\* Genererad[^\n]*\n\(\* Vad programmet gör\. \*\)\n\/\/ och en rad till\nVAR/);
});

test("a mixed program: rungs where there is a ladder shape, ST-blocks where there is none, the blocks run where they stand", () => {
  const source = [
    "PROGRAM Blandat", "VAR", "  Start AT %IX0.0 : BOOL;", "  Stopp AT %IX0.1 : BOOL;", "  Motor AT %QX0.0 : BOOL;", "  DO1 : BOOL;", "  DO2 : BOOL;", "  Niva AT %IW0 : INT;", "  Steg : INT := 0;", "  Ut AT %QW0 : INT;", "  Puls : R_TRIG;", "  T1 : TON;", "END_VAR",
    "Motor := (Start OR Motor) AND Stopp;", "Steg := (Steg + 1) MOD 4;        // räknar varv", "Puls(CLK := Start);",
    "CASE Steg OF", "  0: Ut := 0;", "  1: Ut := Niva;", "ELSE", "  Ut := 10000 - Niva;", "END_CASE;",
    "T1(IN := Motor, PT := T#2s);", "IF T1.Q THEN DO1 := TRUE; END_IF;", "DO2 := NOT Puls.Q;", "END_PROGRAM",
  ].join("\n");
  const converted = stToLadder(source);
  assert.ok(converted.ok, converted.ok ? "" : converted.reason);
  if (!converted.ok) return;
  const shapes = converted.ladder.rungs.map((item) => item.items.map((node) => node.kind).join(",") + (item.outputs.length ? " → " + item.outputs.map((out) => out.kind).join(",") : ""));
  assert.deepEqual(shapes, ["parallel,no → coil", "st", "no,r_trig", "st", "no,ton → set", "no → ncoil"], "the arithmetic in a block, the edge block drawn, the CASE in a block; then the timer rung; then a contact on the edge block");
  const block = converted.ladder.rungs[1].items[0];
  assert.ok(block.kind === "st" && block.text === "Steg := (Steg + 1) MOD 4;        // räknar varv", "verbatim, comment and all");
  const caseBlock = converted.ladder.rungs[3].items[0];
  assert.ok(caseBlock.kind === "st" && caseBlock.text.startsWith("CASE Steg OF"), "the CASE too");
  assert.deepEqual(converted.ladder.vars.filter((variable) => ["Puls", "T1"].includes(variable.name)).map((variable) => `${variable.name}:${variable.type}`), [], "the edge block and the timer are drawn, and need no row");
  const text = ladderToSt(converted.ladder);
  assert.match(text, /\(\* Rung 1 \*\)\nSteg := \(Steg \+ 1\) MOD 4;        \/\/ räknar varv\n\n\(\* Rung 2 \*\)\nPuls\(CLK := Start\);/);
  assert.match(text, /T1\(IN := Motor, PT := T#2s\);\nIF T1\.Q THEN DO1 := TRUE; END_IF;/);
  assert.match(text, /Puls : R_TRIG;/, "declared by the generator");
  sameBehaviour(source, text);
  // A block inside a rung with contacts runs only when the flow is on.
  const guarded: LadderProgram = { ...emptyLadder(), vars: [{ name: "N", type: "INT", address: null, init: 0 }], rungs: [rung([no("DI0"), { id: "s1", kind: "st", text: "N := N + 1;" }], [{ kind: "coil", var: "DO0" }])] };
  const guardedText = ladderToSt(guarded);
  assert.match(guardedText, /IF DI0 THEN\n  N := N \+ 1;\nEND_IF;\nDO0 := DI0;/);
  const program = compiled(guardedText);
  let state = createRunState(program);
  for (const on of [true, true, false, true]) state = runCycle(program, state, inputsOf({ 0: on }), 100).state;
  assert.equal(state.vars.N, 3, "counted only while DI0 was on");
  const flow = evaluateLadder(guarded, state.vars, state.vars, new Set(["DI0"]), state.fbs);
  assert.deepEqual(flow.nodes.get("s1"), { in: true, out: true }, "the flow passes through the block");
  // Terminal names inside a block are declared by the generator, like a contact's would be.
  const terminals: LadderProgram = { ...emptyLadder(), rungs: [rung([{ id: "s1", kind: "st", text: "AO0 := AI1 * 2;" }], [])] };
  assert.ok(compileProgram(ladderToSt(terminals)).ok, ladderToSt(terminals));
});

test("a contact on a terminal wired to a breaking (NC) button is pointed out", () => {
  const example = SURFACE_EXAMPLES.find((candidate) => candidate.id === "start-stopp-ladder")!;
  const inputs = ncInputs(example.layout);
  assert.deepEqual([...inputs.keys()], ["DI1"], "only the stop button breaks at rest");
  assert.deepEqual(inputs.get("DI1"), { terminal: "DI1", label: "Stopp", button: true });
  const ladder = example.layout.ladder!;
  assert.equal(ncInputOf(ladder, inputs, "Stopp")?.terminal, "DI1", "through the declaration Stopp AT DI1");
  assert.equal(ncInputOf(ladder, inputs, "Start"), null);
  assert.equal(ncInputOf(ladder, inputs, "DI1")?.terminal, "DI1", "or by the terminal's own name");
});

test("ST to Ladder: the start/stop example converts and runs the same; what has no ladder shape becomes an ST-block, only unreadable text is refused", () => {
  const example = SURFACE_EXAMPLES.find((candidate) => candidate.id === "start-stopp")!;
  const converted = stToLadder(example.layout.program);
  assert.ok(converted.ok, converted.ok ? "" : converted.reason);
  const ladder = converted.ok ? converted.ladder : emptyLadder();
  assert.equal(ladder.rungs.length, 2);
  assert.equal(ladder.name, "StartStopp");
  assert.deepEqual(ladder.vars.map((variable) => `${variable.name}@${variable.address}`), ["Start@DI0", "Stopp@DI1", "Motor@DO0", "Drift@DO1"]);
  const sequence = [inputsOf({ 1: true }), inputsOf({ 0: true, 1: true }), inputsOf({ 1: true }), inputsOf({})];
  const { outputs } = runBoth(ladder, sequence);
  const original = compiled(example.layout.program);
  let state = createRunState(original);
  const originalOut = sequence.map((inputs) => { const result = runCycle(original, state, inputs, 100); state = result.state; return result.outputs.do; });
  assert.deepEqual(outputs.map((out) => out.do), originalOut, "the converted ladder behaves as the ST did");
  // A timer call whose Q is read once becomes a timer in the rung; set/reset, NC contacts and comparisons convert.
  const timed = stToLadder("VAR Knapp AT %IX0.0 : BOOL; Ut AT %QX0.0 : BOOL; Hog : BOOL; Niva AT %IW0 : INT; T1 : TON; END_VAR T1(IN := Knapp AND NOT Ut, PT := T#2s); Ut := T1.Q; IF Niva > 5000 THEN Hog := TRUE; END_IF; IF Niva < 1000 THEN Hog := FALSE; END_IF;");
  assert.ok(timed.ok, timed.ok ? "" : timed.reason);
  if (timed.ok) {
    assert.equal(timed.ladder.rungs.length, 3);
    assert.deepEqual(timed.ladder.rungs[0].items.map((item) => item.kind), ["no", "nc", "ton"]);
    assert.deepEqual(timed.ladder.rungs.slice(1).map((item) => item.outputs[0].kind), ["set", "reset"]);
    assert.match(ladderToSt(timed.ladder), /T1\(IN := Knapp AND NOT Ut, PT := T#2s\);\nUt := T1\.Q;/);
  }
  // What has no ladder shape is kept as an ST-block, verbatim, and the written-back text means the same.
  const blocks: [string, string][] = [
    ["VAR A : BOOL; S : INT := 1; END_VAR CASE S OF 1: A := TRUE; END_CASE;", "CASE S OF 1: A := TRUE; END_CASE;"],
    ["VAR A : BOOL; B : BOOL; C : BOOL; D : BOOL; END_VAR A := NOT (B AND C) OR D;", "A := NOT (B AND C) OR D;"],
    ["VAR A : BOOL; B : BOOL; END_VAR A := MIN(1, 2) > 1 AND B;", "A := MIN(1, 2) > 1 AND B;"],
  ];
  for (const [source, statement] of blocks) {
    const result = stToLadder(source);
    assert.ok(result.ok, source);
    if (!result.ok) continue;
    const block = result.ladder.rungs.flatMap((item) => item.items).find((node) => node.kind === "st");
    assert.ok(block && block.kind === "st" && block.text === statement, `${source} → ${JSON.stringify(block)}`);
    sameBehaviour(source, ladderToSt(result.ladder), 20);
  }
  // A block read twice: the first reader takes the block into its rung, the second keeps its text.
  const twice = stToLadder("VAR A : BOOL; B : BOOL; T : TON; END_VAR T(IN := A, PT := T#1s); A := T.Q; B := T.Q;");
  assert.ok(twice.ok);
  if (twice.ok) {
    assert.deepEqual(twice.ladder.rungs.map((item) => item.items.map((node) => node.kind).join(",")), ["no,ton", "no"]);
    assert.match(ladderToSt(twice.ladder), /T\(IN := A, PT := T#1s\);\nA := T\.Q;\n\n\(\* Rung 1 \*\)\nB := T\.Q;/);
  }
  // A block call followed by something else runs where it stands, and the later reader keeps the text.
  const apart = stToLadder("VAR A : BOOL; B : BOOL; N : INT; T : TON; END_VAR T(IN := A, PT := T#1s); N := N + 1; B := T.Q;");
  assert.ok(apart.ok);
  if (apart.ok) { assert.deepEqual(apart.ladder.rungs.map((item) => item.items.map((node) => node.kind).join(",")), ["no,ton", "calc", "no"]); assert.match(ladderToSt(apart.ladder), /T\(IN := A, PT := T#1s\);\n\n\(\* Rung 1 \*\)\nN := N \+ 1;\n\n\(\* Rung 2 \*\)\nB := T\.Q;/); }
  const negated = stToLadder("VAR A : BOOL; B : BOOL; C : BOOL; END_VAR A := NOT (B AND C);");
  assert.ok(negated.ok && negated.ladder.rungs[0].outputs[0].kind === "ncoil", "NOT over a whole series is a negated coil");
  const reset = stToLadder("VAR A : BOOL; END_VAR A := FALSE;");
  assert.ok(reset.ok && reset.ladder.rungs[0].outputs[0].kind === "reset" && reset.ladder.rungs[0].items.length === 0);
  if (reset.ok) assert.match(ladderToSt(reset.ladder), /A := FALSE;/);
  const unreadable = stToLadder("VAR A : BOOL; END_VAR A := ;");
  assert.ok(!unreadable.ok && /går inte att läsa/.test(unreadable.reason), "only text the parser cannot read is refused");
});
