import assert from "node:assert/strict";
import test from "node:test";
import { addBranch, findNode, insertNode, newNode, removeNode, replaceNode, updateRung } from "../lib/machine/simulator/ladder/edit";
import { generateSt } from "../lib/machine/simulator/ladder/generate";
import type { LadderProgram, LdNode, LdRung } from "../lib/machine/simulator/ladder/model";
import { compileProgram } from "../lib/machine/simulator/st/interpreter";

// Gren, the way the panel's button and Ctrl+B make it (2026-11-05: "kan inte använda gren"). The button crashed the page: a group made
// around an element holds that element with the same id, and the replacement was walked again and wrapped for ever.

const no = (id: string, name: string): LdNode => ({ id, kind: "no", var: name });
const rungOf = (items: LdNode[]): LdRung => ({ id: "r1", comment: "", items, outputs: [{ id: "o1", kind: "coil", var: "DO0" }] });
const programOf = (rung: LdRung): LadderProgram => ({ name: "G", vars: [], rungs: [rung] });
const line = (rung: LdRung) => generateSt(programOf(rung)).text.split("\n").find((row) => row.includes("DO0 :=")) ?? "";
const compiles = (rung: LdRung) => assert.ok(compileProgram(generateSt(programOf(rung)).text).ok, "the generated ST compiles");

test("a branch around an element makes a group holding it, and the element is found again", () => {
  const rung = addBranch(rungOf([no("e1", "DI0")]), "e1", no("e2", "DI1"), "g3");
  const group = rung.items[0];
  assert.ok(group.kind === "parallel" && group.id === "g3" && group.branches.length === 2);
  assert.equal(findNode(rung, "e1")?.kind, "no");
  assert.match(line(rung), /DO0 := DI0 OR DI1;/);
  compiles(rung);
});

test("replacing an element with something holding it stops there", () => {
  const rung = replaceNode(rungOf([no("e1", "DI0")]), "e1", (node) => ({ id: "g", kind: "parallel", branches: [[node], [no("e2", "DI1")]] }));
  assert.equal(JSON.stringify(rung).match(/"id":"g"/g)?.length, 1);
});

test("an element alone in a branch gives the group one more branch; with a neighbour it gets a nested group", () => {
  let rung = addBranch(rungOf([no("e1", "DI0")]), "e1", no("e2", "DI1"), "g3");
  rung = addBranch(rung, "e2", no("e4", "DI2"), "g5");
  let group = rung.items[0];
  assert.ok(group.kind === "parallel" && group.branches.length === 3, "still one group");
  rung = insertNode(rung, "e2", no("e6", "DI3"));
  rung = addBranch(rung, "e2", no("e7", "DI4"), "g8");
  group = rung.items[0];
  assert.ok(group.kind === "parallel" && group.branches[1][0].kind === "parallel" && group.branches[1][0].id === "g8", "nested beside its neighbour");
  assert.match(line(rung), /DO0 := DI0 OR \(DI1 OR DI4\) AND DI3 OR DI2;/);
  compiles(rung);
});

test("a branch around a group adds to it, and removing the elements dissolves it", () => {
  let rung = addBranch(rungOf([no("e1", "DI0")]), "e1", no("e2", "DI1"), "g3");
  rung = addBranch(rung, "g3", no("e4", "DI2"), "g5");
  assert.equal(rung.items[0].kind === "parallel" ? rung.items[0].branches.length : 0, 3);
  rung = removeNode(rung, "e4");
  rung = removeNode(rung, "e2");
  assert.deepEqual(rung.items.map((item) => item.id), ["e1"]);
});

test("a branch runs: either way gives the output", () => {
  const rung = addBranch(rungOf([no("e1", "A")]), "e1", no("e2", "B"), "g3");
  assert.match(line(rung), /DO0 := A OR B;/);
});

test("every block made through the toolbar gets a name of its own, also flanks", () => {
  let program = programOf(rungOf([]));
  const names: string[] = [];
  for (const kind of ["r_trig", "f_trig", "r_trig", "ton", "tof", "tp", "ctu", "ctd"] as const) {
    const node = newNode(program, kind, "DI0");
    names.push("name" in node ? node.name : "");
    program = updateRung(program, "r1", (rung) => insertNode(rung, null, node));
  }
  assert.equal(new Set(names).size, names.length, names.join(", "));
  assert.deepEqual(names.slice(0, 3), ["Flank1", "Flank2", "Flank3"]);
  assert.ok(compileProgram(generateSt(program).text).ok);
});
