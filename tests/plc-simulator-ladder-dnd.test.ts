import assert from "node:assert/strict";
import test from "node:test";
import { applyDrop, hitSlot, type Payload, REASONS, removePayload, rungSlotAt, rungSlots, slotKey } from "../lib/machine/simulator/ladder/dnd";
import { CELL_H, CELL_W, layoutRung, OUT_W, RAIL_X, TOP } from "../lib/machine/simulator/ladder/geometry";
import { emptyLadder, type LadderProgram, type LdNode, type LdRung, ladderSchema } from "../lib/machine/simulator/ladder/model";

// PLC-simulatorn, Ladder, drag and drop (2026-11-03: "drag drop som i riktiga PLC system"): which slots a rung offers a
// dragged thing, which of them are allowed and why not, what the pointer's place picks, and what a drop makes of the program.

const no = (id: string, name: string): LdNode => ({ id, kind: "no", var: name });
const rung = (id: string, items: LdNode[], outputs: { id: string; var: string }[]): LdRung => ({ id, comment: "", items, outputs: outputs.map((out) => ({ id: out.id, kind: "coil", var: out.var })) });
/** [A, (B | C), D] → X, Y */
const program = (): LadderProgram => ({
  ...emptyLadder(),
  rungs: [rung("r1", [no("a", "A"), { id: "g", kind: "parallel", branches: [[no("b", "B")], [no("c", "C")]] }, no("d", "D")], [{ id: "x", var: "X" }, { id: "y", var: "Y" }]), rung("r2", [no("e", "E")], [{ id: "z", var: "Z" }])],
});
const defaults = { input: "DI5", analog: "AI0", output: "DO5", st: "// ST" };
const kinds = (items: readonly LdNode[]): unknown[] => items.map((item) => (item.kind === "parallel" ? item.branches.map(kinds) : item.id));

test("a new contact may go into every series and beside every element of the rung's own series, never among the coils", () => {
  const first = program().rungs[0];
  const geometry = layoutRung(first);
  const marks = rungSlots(first, geometry, { kind: "new", tool: "no" });
  const legal = marks.filter((mark) => mark.legal).map((mark) => slotKey(mark.slot)).sort();
  assert.deepEqual(legal, [
    "branch:a:above", "branch:a:below", "branch:d:above", "branch:d:below", "branch:g:above", "branch:g:below",
    "series:g.0:0", "series:g.0:1", "series:g.1:0", "series:g.1:1", "series:top:0", "series:top:1", "series:top:2", "series:top:3",
  ]);
  const outputs = marks.filter((mark) => mark.slot.kind === "output");
  assert.equal(outputs.length, 3, "before, between and after the two coils");
  assert.ok(outputs.every((mark) => !mark.legal && mark.reason === REASONS.elementAtOutput));
  // Every marker sits where the thing would land: series markers upright at the cell boundaries, branch markers flat at the cell's edges;
  // a branch's first and last marker stand just inside the group's bar, apart from the series marker at the same boundary.
  const topStart = marks.find((mark) => slotKey(mark.slot) === "series:top:0")!;
  assert.deepEqual([topStart.x, topStart.y, topStart.vertical], [RAIL_X, TOP + CELL_H / 2, true]);
  const branchStart = marks.find((mark) => slotKey(mark.slot) === "series:g.0:0")!, branchEnd = marks.find((mark) => slotKey(mark.slot) === "series:g.0:1")!;
  assert.deepEqual([branchStart.x, branchEnd.x], [RAIL_X + CELL_W + 6, RAIL_X + 2 * CELL_W - 6]);
  assert.equal(new Set(marks.map((mark) => slotKey(mark.slot))).size, marks.length, "every slot has a name of its own");
  const belowA = marks.find((mark) => slotKey(mark.slot) === "branch:a:below")!;
  assert.deepEqual([belowA.x, belowA.y, belowA.vertical], [RAIL_X + CELL_W / 2, TOP + CELL_H - 3, false]);
});

test("a coil may only go to the output column; Parallell only beside an element; an element cannot be dropped into itself", () => {
  const first = program().rungs[0];
  const geometry = layoutRung(first);
  const coil = rungSlots(first, geometry, { kind: "new", tool: "coil" });
  assert.ok(coil.filter((mark) => mark.slot.kind === "output").every((mark) => mark.legal));
  assert.ok(coil.filter((mark) => mark.slot.kind !== "output").every((mark) => !mark.legal && mark.reason === REASONS.outputInSeries));
  const parallel = rungSlots(first, geometry, { kind: "new", tool: "parallel" });
  assert.ok(parallel.filter((mark) => mark.slot.kind === "branch").every((mark) => mark.legal));
  assert.ok(parallel.filter((mark) => mark.slot.kind === "series").every((mark) => mark.reason === REASONS.parallelNeedsElement));
  const group = rungSlots(first, geometry, { kind: "node", rungId: "r1", nodeId: "g", copy: false });
  const inside = group.filter((mark) => mark.slot.kind === "series" && mark.slot.path.length > 0);
  assert.equal(inside.length, 4);
  assert.ok(inside.every((mark) => !mark.legal && mark.reason === REASONS.intoItself));
  const own = group.filter((mark) => mark.same).map((mark) => slotKey(mark.slot)).sort();
  assert.deepEqual(own, ["branch:g:above", "branch:g:below", "series:top:1", "series:top:2"], "its own place and its own edges change nothing");
  // From another rung nothing is "the same place".
  assert.ok(rungSlots(first, geometry, { kind: "node", rungId: "r2", nodeId: "e", copy: false }).every((mark) => !mark.same));
  // A copy may be dropped next to the original.
  assert.ok(rungSlots(first, geometry, { kind: "node", rungId: "r1", nodeId: "a", copy: true }).filter((mark) => mark.slot.kind === "series" && mark.slot.path.length === 0).every((mark) => mark.legal));
});

test("the pointer picks the slot: cell edges give the series, the top and bottom of a cell a branch, the right column an output, empty space the end", () => {
  const first = program().rungs[0];
  // As wide as the editor draws it on a computer, so there is an empty wire between the last element and the coils.
  const geometry = layoutRung(first, { minWidth: 700 });
  const marks = rungSlots(first, geometry, { kind: "new", tool: "no" });
  const at = (x: number, y: number) => { const mark = hitSlot(geometry, marks, { x, y }); return mark ? slotKey(mark.slot) : null; };
  const cy = TOP + CELL_H / 2;
  assert.equal(at(RAIL_X + 10, cy), "series:top:0", "left part of A: before A");
  assert.equal(at(RAIL_X + CELL_W - 10, cy), "series:top:1", "right part of A: after A");
  assert.equal(at(RAIL_X + CELL_W / 2, TOP + 4), "branch:a:above");
  assert.equal(at(RAIL_X + CELL_W / 2, TOP + CELL_H - 4), "branch:a:below");
  assert.equal(at(RAIL_X + CELL_W + 10, cy), "series:g.0:0", "left part of B, in the group's first branch");
  assert.equal(at(RAIL_X + CELL_W + 10, cy + CELL_H), "series:g.1:0", "C, in the second branch");
  assert.equal(at(RAIL_X + CELL_W + CELL_W / 2, TOP + CELL_H + CELL_H - 4), "branch:g:below", "the bottom of the group's last row: a branch to the group");
  assert.equal(at(RAIL_X + 3 * CELL_W + 40, cy), "series:top:3", "the empty wire after D: the end of the rung");
  assert.equal(at(geometry.outX + OUT_W / 2, TOP + 5), "output:0", "the upper half of the first coil: before it");
  assert.equal(at(geometry.outX + OUT_W / 2, TOP + CELL_H + 5), "output:1", "between the coils");
  assert.equal(at(geometry.outX + OUT_W / 2, TOP + 2 * CELL_H + 4), "output:2", "just under the last coil: after it");
  assert.equal(at(geometry.outX + OUT_W / 2, TOP + 3 * CELL_H), null, "well below the rung: nothing");
  assert.equal(at(RAIL_X + 10, TOP + 5 * CELL_H), null, "far below the rung: nothing");
});

test("a drop changes the program as one step: insert, parallel, move between rungs, copy, coil order, rung order, and the bin", () => {
  const start = program();
  // A new contact after A.
  const inserted = applyDrop(start, { kind: "new", tool: "no" }, { kind: "series", rungId: "r1", path: [], index: 1 }, defaults)!;
  const newId = inserted.program.rungs[0].items[1].id;
  assert.deepEqual(kinds(inserted.program.rungs[0].items), ["a", newId, [["b"], ["c"]], "d"]);
  assert.deepEqual(inserted.selection, { kind: "node", rungId: "r1", nodeId: newId });
  assert.ok(inserted.focus, "a contact opens its field");
  assert.equal((inserted.program.rungs[0].items[1] as { var: string }).var, "DI5");
  // Parallell dropped below D: D becomes a group of two branches with a new contact.
  const branched = applyDrop(start, { kind: "new", tool: "parallel" }, { kind: "branch", rungId: "r1", nodeId: "d", where: "below" }, defaults)!;
  const group = branched.program.rungs[0].items[2];
  assert.ok(group.kind === "parallel" && group.branches.length === 2 && group.branches[0][0].id === "d" && group.branches[1][0].kind === "no");
  // Above the existing group: a new first branch.
  const above = applyDrop(start, { kind: "new", tool: "nc" }, { kind: "branch", rungId: "r1", nodeId: "g", where: "above" }, defaults)!;
  const grown = above.program.rungs[0].items[1];
  assert.ok(grown.kind === "parallel" && grown.branches.length === 3 && grown.branches[0][0].kind === "nc");
  // B moved out of the group to the end of the rung: the group of one branch dissolves into the series.
  const moved = applyDrop(start, { kind: "node", rungId: "r1", nodeId: "b", copy: false }, { kind: "series", rungId: "r1", path: [], index: 3 }, defaults)!;
  assert.deepEqual(kinds(moved.program.rungs[0].items), ["a", "c", "d", "b"]);
  // D moved before A in its own series: the slot was counted with D still in place.
  const earlier = applyDrop(start, { kind: "node", rungId: "r1", nodeId: "d", copy: false }, { kind: "series", rungId: "r1", path: [], index: 0 }, defaults)!;
  assert.deepEqual(kinds(earlier.program.rungs[0].items), ["d", "a", [["b"], ["c"]]]);
  // E moved from rung 2 into rung 1's group as C's neighbour: rung 2 is left empty, the group keeps its two branches.
  const across = applyDrop(start, { kind: "node", rungId: "r2", nodeId: "e", copy: false }, { kind: "series", rungId: "r1", path: [{ group: "g", branch: 1 }], index: 1 }, defaults)!;
  assert.deepEqual(kinds(across.program.rungs[0].items), ["a", [["b"], ["c", "e"]], "d"]);
  assert.deepEqual(across.program.rungs[1].items, []);
  // Ctrl: a copy with an id of its own; the original stays.
  const copied = applyDrop(start, { kind: "node", rungId: "r1", nodeId: "a", copy: true }, { kind: "series", rungId: "r2", path: [], index: 1 }, defaults)!;
  assert.deepEqual(kinds(copied.program.rungs[0].items), ["a", [["b"], ["c"]], "d"]);
  assert.equal(copied.program.rungs[1].items.length, 2);
  assert.notEqual(copied.program.rungs[1].items[1].id, "a");
  assert.equal((copied.program.rungs[1].items[1] as { var: string }).var, "A");
  // The whole group moved to rung 2: the series slot is rung 2's end.
  const groupMoved = applyDrop(start, { kind: "node", rungId: "r1", nodeId: "g", copy: false }, { kind: "series", rungId: "r2", path: [], index: 1 }, defaults)!;
  assert.deepEqual(kinds(groupMoved.program.rungs[0].items), ["a", "d"]);
  assert.deepEqual(kinds(groupMoved.program.rungs[1].items), ["e", [["b"], ["c"]]]);
  // Coils: a new one between X and Y, X moved after Y, Z copied into rung 1.
  const coil = applyDrop(start, { kind: "new", tool: "set" }, { kind: "output", rungId: "r1", index: 1 }, defaults)!;
  assert.deepEqual(coil.program.rungs[0].outputs.map((out) => `${out.kind}:${out.var}`), ["coil:X", "set:DO5", "coil:Y"]);
  assert.ok(coil.focus);
  const swapped = applyDrop(start, { kind: "output", rungId: "r1", outputId: "x", copy: false }, { kind: "output", rungId: "r1", index: 2 }, defaults)!;
  assert.deepEqual(swapped.program.rungs[0].outputs.map((out) => out.id), ["y", "x"]);
  const zCopied = applyDrop(start, { kind: "output", rungId: "r2", outputId: "z", copy: true }, { kind: "output", rungId: "r1", index: 0 }, defaults)!;
  assert.deepEqual(zCopied.program.rungs[0].outputs.map((out) => out.var), ["Z", "X", "Y"]);
  assert.equal(zCopied.program.rungs[1].outputs.length, 1);
  // Rungs: the second dragged above the first; the same place changes nothing.
  const reordered = applyDrop(start, { kind: "rung", rungId: "r2" }, { kind: "rung", index: 0 }, defaults)!;
  assert.deepEqual(reordered.program.rungs.map((item) => item.id), ["r2", "r1"]);
  assert.equal(applyDrop(start, { kind: "rung", rungId: "r2" }, { kind: "rung", index: 2 }, defaults), null);
  assert.equal(applyDrop(start, { kind: "rung", rungId: "r2" }, { kind: "rung", index: 1 }, defaults), null);
  // The bin: as Delete does.
  assert.deepEqual(kinds(removePayload(start, { kind: "node", rungId: "r1", nodeId: "a", copy: false }).rungs[0].items), [[["b"], ["c"]], "d"]);
  assert.deepEqual(removePayload(start, { kind: "output", rungId: "r1", outputId: "x", copy: false }).rungs[0].outputs.map((out) => out.id), ["y"]);
  assert.deepEqual(removePayload(start, { kind: "rung", rungId: "r1" }).rungs.map((item) => item.id), ["r2"]);
  // Everything a drop makes is a valid program.
  for (const result of [inserted, branched, above, moved, earlier, across, copied, groupMoved, coil, swapped, zCopied, reordered]) assert.ok(ladderSchema.safeParse(result.program).success);
  // The slot between rungs from their edges on screen: nearest edge wins.
  const edges = [{ top: 0, bottom: 100 }, { top: 106, bottom: 206 }, { top: 212, bottom: 312 }];
  assert.equal(rungSlotAt(edges, 2), 0);
  assert.equal(rungSlotAt(edges, 104), 1);
  assert.equal(rungSlotAt(edges, 300), 3);
  assert.equal(rungSlotAt([], 50), 0);
});

test("an ST-block is two cells wide and, expanded, as tall as its lines need; a payload of a rung offers no slots in a rung", () => {
  const block: LdNode = { id: "s", kind: "st", text: "A := 1;\nB := 2;\nC := 3;\nD := 4;\nE := 5;\nF := 6;" };
  const withBlock = rung("r1", [no("a", "A"), block], [{ id: "x", var: "X" }]);
  const closed = layoutRung(withBlock);
  const cell = closed.cells.find((candidate) => candidate.node.id === "s")!;
  assert.deepEqual([cell.w, cell.h], [2 * CELL_W, CELL_H]);
  const open = layoutRung(withBlock, { expanded: new Set(["s"]) });
  assert.equal(open.cells.find((candidate) => candidate.node.id === "s")!.h, 2 * CELL_H);
  assert.equal(open.rows, 2);
  const payload: Payload = { kind: "rung", rungId: "r1" };
  assert.deepEqual(rungSlots(withBlock, closed, payload), []);
  assert.ok(rungSlots(withBlock, closed, { kind: "new", tool: "st" }).some((mark) => mark.legal && mark.slot.kind === "series"));
});
