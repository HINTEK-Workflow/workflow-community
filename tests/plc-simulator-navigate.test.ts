import assert from "node:assert/strict";
import test from "node:test";
import { stToLadder } from "../lib/machine/simulator/ladder/convert";
import { applyDrop } from "../lib/machine/simulator/ladder/dnd";
import { addRoutine, addRung, fromRoutineView, moveRung, removeRung, renameTag, routineView, updateRung } from "../lib/machine/simulator/ladder/edit";
import { evaluateLadder } from "../lib/machine/simulator/ladder/evaluate";
import { generateSt, ladderToSt } from "../lib/machine/simulator/ladder/generate";
import { CMP_NAMES, INSTRUCTIONS, parseInstructionLine } from "../lib/machine/simulator/ladder/instructions";
import { type LadderProgram, ladderSchema, type LdRung, withSeq } from "../lib/machine/simulator/ladder/model";
import { adoptIds, crossReference, cursorAtLine, editMarks, ladderNotes, linesOfRung, rungAtLine, rungNumber, validCursor } from "../lib/machine/simulator/ladder/navigate";
import { tagRows, typedForce } from "../lib/machine/simulator/ladder/tags";
import { compileProgram, createRunState, runCycle } from "../lib/machine/simulator/st/interpreter";
import { emptyInputs, emptyOutputs } from "../lib/machine/simulator/st/io";

// PLC-simulatorn (2026-11-04): the rung-jump bug and what was built with it. The cause was not a stale index: the selection held rung
// and element ids. (1) freeLdId gave the lowest free number, so after a removal a new rung got the removed rung's id, and whatever still
// pointed at the old rung (a selection, an undo, a mirror) then marked the new one. (2) Every reading of ST back to Ladder numbered the ids
// anew. (3) In the editor a flag meant to swallow the click after a drag stayed up when the drag gave no click, so the next real click
// was eaten: the marking did not move (tests/plc-simulator-desktop.browser.cjs). Here is (1) and (2), and the jump both ways.

const rung = (id: string, tag: string, out: string, comment = ""): LdRung => ({ id, comment, items: [{ id: `${id}e`, kind: "no", var: tag }], outputs: [{ id: `${id}o`, kind: "coil", var: out }] });
const program = (): LadderProgram => ({ name: "P", vars: [], rungs: [rung("r1", "DI0", "DO0", "ett"), rung("r2", "DI1", "DO1", "två"), rung("r3", "DI2", "DO2", "tre")] });

test("a removed rung's id never comes back: what still points at it finds nothing, not another rung", () => {
  const start = withSeq(program());
  const pointing = { routine: null, rungId: "r3" };
  const without = withSeq(removeRung(start, "r3"));
  assert.equal(validCursor(without, pointing), null, "the marked rung is gone: no marking, and no silent fall back to the last rung");
  const added = addRung(without, "r1");
  assert.notEqual(added.rungId, "r3", "the new rung does not take the old id");
  assert.notEqual(added.rungId, "r2");
  assert.equal(validCursor(withSeq(added.program), pointing), null, "the old pointer does not land on the new rung");
  // Also through a drop, the other way a thing gets a new id.
  const dropped = applyDrop(without, { kind: "new", tool: "no" }, { kind: "series", rungId: "r1", path: [], index: 0 }, { input: "DI5", analog: "AI0", output: "DO5", st: "" });
  assert.ok(dropped && dropped.selection?.kind === "node");
  assert.ok(!["r1e", "r2e", "r3e"].includes((dropped.selection as { nodeId: string }).nodeId));
});

test("the jump: add a rung, remove a rung, reorder, Ladder → ST → Ladder lands on the same rung every time", () => {
  let current = withSeq(program());
  const roundTrip = (rungId: string) => {
    const { text, lines } = generateSt(current);
    const place = linesOfRung(lines, rungId)!;
    assert.ok(place, `${rungId} has lines`);
    // The lines say the rung's own comment and tag.
    const said = text.split("\n").slice(place.from - 1, place.to).join("\n");
    const target = current.rungs.find((item) => item.id === rungId)!;
    assert.ok(said.includes(target.outputs[0].var), `${rungId}: ${said}`);
    assert.equal(cursorAtLine(current, lines, place.from)?.rungId, rungId, "from its first line");
    assert.equal(cursorAtLine(current, lines, place.to)?.rungId, rungId, "from its last line");
    assert.equal(rungNumber(current, { routine: null, rungId }), current.rungs.findIndex((item) => item.id === rungId));
  };
  for (const item of current.rungs) roundTrip(item.id);
  // Add between two rungs.
  const added = addRung(current, "r1");
  current = withSeq(updateRung(added.program, added.rungId, (item) => ({ ...item, items: [{ id: "x1", kind: "no", var: "DI5" }], outputs: [{ id: "x2", kind: "coil", var: "DO5" }] })));
  assert.deepEqual(current.rungs.map((item) => item.id), ["r1", added.rungId, "r2", "r3"]);
  for (const item of current.rungs) roundTrip(item.id);
  assert.equal(rungNumber(current, { routine: null, rungId: "r2" }), 2, "renumbered: rung r2 is now number 2");
  // Remove the first.
  current = withSeq(removeRung(current, "r1"));
  for (const item of current.rungs) roundTrip(item.id);
  assert.equal(rungNumber(current, { routine: null, rungId: "r2" }), 1);
  // Reorder, by button and by drop.
  current = moveRung(current, "r3", -1);
  for (const item of current.rungs) roundTrip(item.id);
  const dragged = applyDrop(current, { kind: "rung", rungId: "r2" }, { kind: "rung", index: 0 }, { input: "DI0", analog: "AI0", output: "DO0", st: "" })!;
  current = dragged.program;
  assert.equal(current.rungs[0].id, "r2");
  for (const item of current.rungs) roundTrip(item.id);
  // A line between rungs goes to the next rung; a line in VAR to none.
  const { lines } = generateSt(current);
  assert.equal(rungAtLine(lines, lines[1].from - 1)?.rungId, lines[1].rungId, "the blank line before a rung");
  assert.equal(rungAtLine(lines, 1), null, "PROGRAM's own line");
});

test("reading ST back keeps every rung's id; a changed rung keeps its id too, so the marking stays", () => {
  const start = withSeq(program());
  const text = ladderToSt(start);
  const read = stToLadder(text);
  assert.ok(read.ok);
  if (!read.ok) return;
  const same = adoptIds(start, read.ladder, read.lines);
  assert.deepEqual(same.ladder.rungs.map((item) => item.id), ["r1", "r2", "r3"], "the same rungs");
  assert.deepEqual(same.lines.map((item) => item.rungId), ["r1", "r2", "r3"], "the line map follows");
  // A word changed in rung 2: the rung is still r2.
  const edited = stToLadder(text.replace("DO1 := DI1;", "DO1 := DI1 AND DI5;"));
  assert.ok(edited.ok);
  if (!edited.ok) return;
  const after = adoptIds(start, edited.ladder, edited.lines);
  assert.deepEqual(after.ladder.rungs.map((item) => item.id), ["r1", "r2", "r3"]);
  assert.equal(after.ladder.rungs[1].items.length, 2);
  // A new statement between: a new id, never one in use.
  const longer = stToLadder(text.replace("DO1 := DI1;", "DO1 := DI1;\nDO6 := DI6;"));
  assert.ok(longer.ok);
  if (!longer.ok) return;
  const grown = adoptIds(start, longer.ladder, longer.lines);
  assert.equal(grown.ladder.rungs.length, 4);
  assert.deepEqual([grown.ladder.rungs[0].id, grown.ladder.rungs[1].id, grown.ladder.rungs.at(-1)!.id], ["r1", "r2", "r3"]);
  assert.ok(!["r1", "r2", "r3"].includes(grown.ladder.rungs[2].id));
  assert.equal(new Set(grown.ladder.rungs.map((item) => item.id)).size, 4);
  assert.ok(ladderSchema.safeParse(grown.ladder).success);
  // The comment comes back, and the lines hold.
  assert.equal(after.ladder.rungs[1].comment, "två");
  assert.equal(cursorAtLine(after.ladder, after.lines, after.lines[1].from)?.rungId, "r2");
});

test("two-way: Ladder to ST and back to Ladder means the same, and typed ST finds its rung by line", () => {
  const typed = ["PROGRAM X", "VAR", "  Start AT %IX0.0 : BOOL;", "  Lampa AT %QX0.0 : BOOL;", "END_VAR", "", "// Lampan följer knappen", "Lampa := Start;", "", "Lampa := NOT Start;", "END_PROGRAM"].join("\n");
  const read = stToLadder(typed);
  assert.ok(read.ok);
  if (!read.ok) return;
  assert.equal(read.ladder.rungs.length, 2);
  assert.equal(read.ladder.rungs[0].comment, "Lampan följer knappen");
  assert.deepEqual(read.lines.map((item) => [item.from, item.to]), [[8, 8], [10, 10]], "the lines of the statements as typed");
  assert.equal(cursorAtLine(read.ladder, read.lines, 8)?.rungId, read.ladder.rungs[0].id);
  assert.equal(cursorAtLine(read.ladder, read.lines, 10)?.rungId, read.ladder.rungs[1].id);
  // What cannot be read leaves a reason, never a half-read program.
  assert.equal(stToLadder("Lampa := ;").ok, false);
});

test("edit marks: i a new rung, e a changed one, r one that is gone; Verifiera's accepted program has none", () => {
  const accepted = withSeq(program());
  assert.equal(editMarks(accepted, accepted).changed, false);
  const added = addRung(accepted, "r1");
  const marks = editMarks(accepted, added.program);
  assert.equal(marks.marks.get(added.rungId), "i");
  assert.equal(marks.marks.size, 1);
  const edited = updateRung(accepted, "r2", (item) => ({ ...item, comment: "ändrad" }));
  assert.equal(editMarks(accepted, edited).marks.get("r2"), "e");
  const removed = editMarks(accepted, removeRung(accepted, "r2"));
  assert.equal(removed.removed.length, 1);
  assert.equal(removed.removed[0].comment, "två");
  assert.equal(removed.removed[0].beforeRungId, "r3", "shown where it stood");
  assert.ok(removed.changed);
  // Moved: one side changes, nothing is lost silently.
  assert.ok(editMarks(accepted, moveRung(accepted, "r3", -1)).changed);
  // New ids alone are no change: a program read back from ST with the same content is unchanged.
  const read = stToLadder(ladderToSt(accepted));
  assert.ok(read.ok);
  if (read.ok) assert.equal(editMarks(accepted, read.ladder).changed, false);
});

test("the standard's names: every instruction in one table, the text line writes them, no name of any maker's family", () => {
  for (const name of ["TON", "TOF", "TP", "CTU", "CTD", "GT", "GE", "LT", "LE", "EQ", "NE", "R_TRIG", "F_TRIG", "ADD", "SUB", "MUL", "DIV", "MOVE", "S", "R"]) assert.ok(INSTRUCTIONS.some((item) => item.name === name), name);
  assert.deepEqual(Object.values(CMP_NAMES).sort(), ["EQ", "GE", "GT", "LE", "LT", "NE"]);
  for (const forbidden of ["XIC", "XIO", "OTE", "OTL", "OTU", "ONS", "RTO", "LIM", "EQU", "GRT", "LES", "NEQ", "GEQ", "LEQ"]) assert.ok(!INSTRUCTIONS.some((item) => item.name === forbidden), forbidden);
  const line = parseInstructionLine("NO Start NC Stopp TON T1 2s GT AI0 5000 COIL Motor S Larm");
  assert.ok(line.ok);
  if (!line.ok) return;
  assert.deepEqual(line.parsed.nodes.map((node) => node.kind), ["no", "nc", "ton", "cmp"]);
  assert.deepEqual(line.parsed.outputs, [{ kind: "coil", var: "Motor" }, { kind: "set", var: "Larm" }]);
  assert.equal(parseInstructionLine("XIC Start").ok, false, "only the standard's names");
  assert.match((parseInstructionLine("TON T1") as { reason: string }).reason, /tid/);
  assert.ok(parseInstructionLine("CTU C1 5 Nollst COIL X").ok);
  assert.ok(parseInstructionLine("ADD A 1 B MOVE 5 C RET").ok);
});

test("a timer's boxes, comparisons, calculation, CALL and RET run the same in Ladder as in their ST", () => {
  const ladder: LadderProgram = {
    name: "Allt", vars: [{ name: "Summa", type: "INT", address: null, init: 0 }], rungs: [
      { id: "r1", comment: "", items: [{ id: "e1", kind: "no", var: "DI0" }, { id: "e2", kind: "ton", name: "T1", ptMs: 300 }], outputs: [{ id: "o1", kind: "coil", var: "DO0" }] },
      { id: "r2", comment: "", items: [{ id: "e3", kind: "no", var: "T1.Q" }, { id: "e4", kind: "calc", op: "ADD", a: { kind: "var", name: "Summa" }, b: { kind: "const", value: 1, type: "INT" }, dest: "Summa" }], outputs: [] },
      { id: "r3", comment: "", items: [{ id: "e5", kind: "cmp", op: ">=", left: { kind: "var", name: "Summa" }, right: { kind: "const", value: 2, type: "INT" } }, { id: "e6", kind: "call", routine: "Larm" }], outputs: [] },
      { id: "r4", comment: "", items: [{ id: "e7", kind: "no", var: "DI1" }, { id: "e8", kind: "r_trig", name: "Flank1" }], outputs: [{ id: "o2", kind: "coil", var: "DO1" }] },
    ],
    routines: [{ id: "p1", name: "Larm", rungs: [
      { id: "r5", comment: "", items: [], outputs: [{ id: "o3", kind: "set", var: "DO2" }] },
      { id: "r6", comment: "", items: [{ id: "e9", kind: "ret" }], outputs: [] },
      { id: "r7", comment: "", items: [], outputs: [{ id: "o4", kind: "set", var: "DO3" }] },
    ] }],
  };
  assert.ok(ladderSchema.safeParse(ladder).success);
  const source = ladderToSt(ladder);
  assert.match(source, /ROUTINE Larm/);
  assert.match(source, /IF Summa >= 2 THEN CALL Larm; END_IF;/);
  const result = compileProgram(source);
  assert.ok(result.ok, result.ok ? "" : result.problem.message);
  if (!result.ok) return;
  let state = createRunState(result.compiled);
  const inputs = (di: boolean[]) => { const base = emptyInputs(); return { ...base, di: base.di.map((_, index) => di[index] === true) }; };
  const step = (di: boolean[]) => { const out = runCycle(result.compiled, state, inputs(di), 100); state = out.state; return out; };
  step([true]); step([true]); step([true]);
  const third = step([true]);
  assert.equal(third.outputs.do[0], true, "TON after 300 ms");
  step([true]);
  const later = step([true, true]);
  assert.ok(Number(state.vars.Summa) >= 2, "the sum runs on T1.Q");
  assert.equal(later.outputs.do[1], true, "R_TRIG on the rising flow");
  assert.equal(step([true, true]).outputs.do[1], false, "one cycle only");
  assert.equal(later.outputs.do[2], true, "the routine ran");
  assert.equal(later.outputs.do[3], false, "RET ended it before the last rung");
  // The drawn flow says the same: the routine's rungs carry power only when called.
  const flow = evaluateLadder(ladder, state.vars, state.vars, new Set(["DI0", "DI1"]), state.fbs);
  assert.equal(flow.rungs.get("r5"), true);
  assert.equal(flow.rungs.get("r7"), false, "after RET: dark");
  // Back from text: the same rungs and the routine with them.
  const read = stToLadder(source);
  assert.ok(read.ok, read.ok ? "" : read.reason);
  if (read.ok) {
    assert.equal(read.ladder.routines?.[0].name, "Larm");
    assert.equal(read.ladder.routines?.[0].rungs.length, 3);
    assert.deepEqual(read.ladder.rungs.map((item) => item.items.map((node) => node.kind).join(",")), ["no,ton", "no,calc", "cmp,call", "no,r_trig"]);
    assert.ok(read.lines.some((item) => item.routine === "Larm"));
    assert.equal(cursorAtLine(read.ladder, read.lines, read.lines.at(-1)!.from)?.routine, read.ladder.routines?.[0].id, "a line in a routine opens the routine");
  }
});

test("a routine: a view over its rungs, its own numbering, a call that does not exist or calls itself does not compile", () => {
  const start = withSeq(program());
  const { program: withRoutine, routine } = addRoutine(start);
  assert.equal(routine.rungs.length, 1);
  const view = routineView(withRoutine, routine.id);
  const added = addRung(view, null);
  assert.ok(!allIds(withRoutine).includes(added.rungId), "ids are unique across the whole program");
  const back = fromRoutineView(withRoutine, routine.id, added.program);
  assert.equal(back.routines?.[0].rungs.length, 2);
  assert.equal(back.rungs.length, 3, "Huvudrutin is untouched");
  assert.equal(compileProgram("VAR A : BOOL; END_VAR CALL Finns;").ok, false);
  const recursive = compileProgram("VAR A : BOOL; END_VAR ROUTINE X CALL Y; END_ROUTINE ROUTINE Y CALL X; END_ROUTINE");
  assert.equal(recursive.ok, false);
  assert.match((recursive as { problem: { message: string } }).problem.message, /anropar sig själv/);
  // An older program with a variable called Call or Return reads as before.
  assert.ok(compileProgram("VAR Call : BOOL; Return : BOOL; Routine : INT; END_VAR Call := TRUE; Return := Call; Routine := 1;").ok);
});
const allIds = (item: LadderProgram) => [...item.rungs, ...(item.routines ?? []).flatMap((routine) => routine.rungs)].map((rungItem) => rungItem.id);

test("force: an input is read as forced, an output goes out as forced whatever the program says, and letting go gives the program back", () => {
  const result = compileProgram("VAR Knapp AT %IX0.0 : BOOL; Lampa AT %QX0.0 : BOOL; Lampa2 AT %QX0.1 : BOOL; Niva : INT; END_VAR Lampa := Knapp; Lampa2 := FALSE; Niva := 5;");
  assert.ok(result.ok);
  if (!result.ok) return;
  const inputs = emptyInputs();
  let state = createRunState(result.compiled);
  assert.equal(runCycle(result.compiled, state, inputs, 50).outputs.do[0], false, "not forced: the button is up");
  let out = runCycle(result.compiled, state, inputs, 50, { Knapp: true });
  assert.equal(out.outputs.do[0], true, "forced input: the program sees 1");
  assert.equal(out.state.vars.Knapp, true);
  out = runCycle(result.compiled, state, inputs, 50, { Lampa2: true });
  assert.equal(out.outputs.do[1], true, "forced output: over the program's FALSE");
  out = runCycle(result.compiled, state, inputs, 50, { Niva: 42 });
  assert.equal(out.state.vars.Niva, 42, "a number too, through the whole cycle");
  state = out.state;
  assert.equal(runCycle(result.compiled, state, inputs, 50).state.vars.Niva, 5, "let go: the program's value");
  assert.equal(typedForce("BOOL", "1"), true);
  assert.equal(typedForce("BOOL", "x"), null);
  assert.equal(typedForce("INT", "3,7"), 3);
  assert.equal(typedForce("REAL", "3,7"), 3.7);
});

test("the tag list: every tag with data type, alias and live value; TIMER and COUNTER for the blocks; terminals without a name too", () => {
  const ladder: LadderProgram = {
    name: "T", vars: [{ name: "Start", type: "BOOL", address: "DI0", init: null, comment: "Knappen" }, { name: "Mal", type: "REAL", address: null, init: null }, { name: "Vanta", type: "TIMER", address: null, init: null }],
    rungs: [{ id: "r1", comment: "", items: [{ id: "e1", kind: "no", var: "Start" }, { id: "e2", kind: "ton", name: "T1", ptMs: 100 }, { id: "e3", kind: "ctu", name: "C1", pv: 2, aux: null }], outputs: [{ id: "o1", kind: "coil", var: "DO0" }] }],
  };
  const text = ladderToSt(ladder);
  assert.match(text, /Vanta : TON;/, "a TIMER tag is a timer until a rung says which");
  const compiled = compileProgram(text);
  assert.ok(compiled.ok, compiled.ok ? "" : compiled.problem.message);
  if (!compiled.ok) return;
  const run = createRunState(compiled.compiled);
  const rows = tagRows(ladder, compiled.compiled, run, emptyInputs(), emptyOutputs(), { Start: true });
  const row = (name: string) => rows.find((item) => item.name === name)!;
  assert.equal(row("Start").type, "BOOL");
  assert.equal(row("Start").alias, "DI0");
  assert.equal(row("Start").address, "%IX0.0");
  assert.equal(row("Start").description, "Knappen");
  assert.equal(row("Start").scope, "global");
  assert.equal(row("Start").forceable, true);
  assert.equal(row("Start").forced, true);
  assert.equal(row("Start").value, false);
  assert.equal(row("Mal").scope, "program");
  assert.equal(row("T1").type, "TIMER");
  assert.equal(row("C1").type, "COUNTER");
  assert.equal(row("Vanta").type, "TIMER");
  assert.equal(row("T1").forceable, false, "a block is not forced");
  assert.equal(row("DO0").alias, "DO0");
  assert.ok(row("DI5").unnamed, "a terminal without a name stands in the list");
  assert.equal(row("DI5").value, false);
  assert.equal(rows.filter((item) => item.alias === "DI0").length, 1, "DI0 is Start, not listed twice");
});

test("a tag renamed goes everywhere; the cross reference finds every use; the notes say what the compiler does not", () => {
  const ladder: LadderProgram = {
    name: "X", vars: [{ name: "Start", type: "BOOL", address: "DI0", init: null }], rungs: [
      { id: "r1", comment: "", items: [{ id: "e1", kind: "no", var: "Start" }, { id: "e2", kind: "st", text: "IF Start THEN Ut := 1; END_IF;" }], outputs: [{ id: "o1", kind: "coil", var: "Ut2" }] },
      { id: "r2", comment: "", items: [{ id: "e3", kind: "nc", var: "Start" }], outputs: [{ id: "o2", kind: "coil", var: "Ut2" }] },
      { id: "r3", comment: "", items: [], outputs: [] },
    ],
  };
  const uses = crossReference(ladder, "Start");
  assert.deepEqual(uses.map((use) => [use.rungId, use.where]), [["r1", "Kontakt NO"], ["r1", "ST-block"], ["r2", "Kontakt NC"]]);
  assert.deepEqual(crossReference(ladder, "Ut2").map((use) => use.where), ["Spole", "Spole"]);
  const renamed = renameTag(ladder, "Start", "Go");
  assert.equal(renamed.vars[0].name, "Go");
  assert.deepEqual(crossReference(renamed, "Start"), []);
  assert.equal(crossReference(renamed, "Go").length, 3);
  assert.ok(renamed.rungs[0].items.some((node) => node.kind === "st" && node.text.includes("IF Go THEN")));
  const notes = ladderNotes(ladder).map((note) => note.text);
  assert.ok(notes.some((text) => /spolen Ut2 skrivs på flera ställen/.test(text)));
  assert.ok(notes.some((text) => /Rung 2 är tom/.test(text)));
});
