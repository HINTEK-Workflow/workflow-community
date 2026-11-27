import { allRungs, freeBlockName, freeLdId, isBlockNode, type LadderProgram, type LdBlockKind, type LdCalcOp, type LdNode, type LdOperand, type LdOutput, type LdOutputKind, type LdRoutine, type LdRung, walkNodes, withSeq } from "./model";

// PLC-simulatorn, Ladder: the editor's operations on a program, pure, so a test can run them without a browser. Elements sit
// in a series; a parallel group holds series of its own. Inserting puts the new element after the selected one in whichever
// series that is; a parallel branch is made around the selected element, or added to the group it is in.

export type LdSelection = { kind: "rung"; rungId: string } | { kind: "node"; rungId: string; nodeId: string } | { kind: "output"; rungId: string; outputId: string } | null;

/** Every series in a rung with the path to it: the rung's own and every branch, depth first. */
function mapSeries(items: LdNode[], visit: (series: LdNode[]) => LdNode[]): LdNode[] {
  const visited = visit(items);
  return visited.map((node) => (node.kind === "parallel" ? { ...node, branches: node.branches.map((branch) => mapSeries(branch, visit)) } : node));
}

type LdCmpOpChoice = "=" | "<>" | "<" | ">" | "<=" | ">=";

export const findNode = (rung: LdRung, nodeId: string): LdNode | null => [...walkNodes(rung.items)].find((node) => node.id === nodeId) ?? null;

/** Inserts after `afterId` in the series that holds it; with no id, at the end of the rung's own series. */
export function insertNode(rung: LdRung, afterId: string | null, node: LdNode): LdRung {
  if (!afterId) return { ...rung, items: [...rung.items, node] };
  let done = false;
  const items = mapSeries(rung.items, (series) => {
    const index = series.findIndex((candidate) => candidate.id === afterId);
    if (index < 0 || done) return series;
    done = true;
    return [...series.slice(0, index + 1), node, ...series.slice(index + 1)];
  });
  return done ? { ...rung, items } : { ...rung, items: [...rung.items, node] };
}

export function removeNode(rung: LdRung, nodeId: string): LdRung {
  const items = mapSeries(rung.items, (series) => series.filter((candidate) => candidate.id !== nodeId));
  // An emptied branch goes (it would be a bypass that is always on); a group left with one branch is just that branch; with none, nothing.
  const flatten = (series: LdNode[]): LdNode[] => series.flatMap((node) => {
    if (node.kind !== "parallel") return [node];
    const branches = node.branches.map(flatten).filter((branch) => branch.length > 0);
    if (branches.length === 0) return [];
    if (branches.length === 1) return branches[0];
    return [{ ...node, branches }];
  });
  return { ...rung, items: flatten(items) };
}

/** What `change` returns is not walked again: a group made around the element holds the element itself, with the same id. */
export function replaceNode(rung: LdRung, nodeId: string, change: (node: LdNode) => LdNode): LdRung {
  const walk = (series: readonly LdNode[]): LdNode[] => series.map((node) => {
    if (node.id === nodeId) return change(node);
    return node.kind === "parallel" ? { ...node, branches: node.branches.map(walk) } : node;
  });
  return { ...rung, items: walk(rung.items) };
}

/**
 * A parallel branch beside the selected element: the element becomes a group of two branches, the new one holding `node`.
 * If the selected element is a group, or stands alone in a branch of one, the group gets the new branch instead. An element with
 * neighbours in its branch gets a group of its own there: a nested branch.
 */
export function addBranch(rung: LdRung, nodeId: string, node: LdNode, groupId: string): LdRung {
  const parentGroup = [...walkNodes(rung.items)].find((candidate): candidate is Extract<LdNode, { kind: "parallel" }> => candidate.kind === "parallel" && candidate.branches.some((branch) => branch.length === 1 && branch[0].id === nodeId));
  const target = findNode(rung, nodeId);
  if (target?.kind === "parallel") return replaceNode(rung, nodeId, (group) => (group.kind === "parallel" ? { ...group, branches: [...group.branches, [node]] } : group));
  if (parentGroup) return replaceNode(rung, parentGroup.id, (group) => (group.kind === "parallel" ? { ...group, branches: [...group.branches, [node]] } : group));
  return replaceNode(rung, nodeId, (selected) => ({ id: groupId, kind: "parallel", branches: [[selected], [node]] }));
}

export function updateRung(program: LadderProgram, rungId: string, change: (rung: LdRung) => LdRung): LadderProgram {
  return { ...program, rungs: program.rungs.map((rung) => (rung.id === rungId ? change(rung) : rung)) };
}

export function addRung(program: LadderProgram, afterId: string | null): { program: LadderProgram; rungId: string } {
  const rungId = freeLdId("r", program);
  const rung: LdRung = { id: rungId, comment: "", items: [], outputs: [] };
  const index = afterId ? program.rungs.findIndex((candidate) => candidate.id === afterId) : -1;
  const rungs = index < 0 ? [...program.rungs, rung] : [...program.rungs.slice(0, index + 1), rung, ...program.rungs.slice(index + 1)];
  return { program: { ...program, rungs }, rungId };
}

/** A new rung before another, for the rung's own menu. */
export function addRungBefore(program: LadderProgram, beforeId: string): { program: LadderProgram; rungId: string } {
  const rungId = freeLdId("r", program);
  const rung: LdRung = { id: rungId, comment: "", items: [], outputs: [] };
  const index = Math.max(0, program.rungs.findIndex((candidate) => candidate.id === beforeId));
  return { program: { ...program, rungs: [...program.rungs.slice(0, index), rung, ...program.rungs.slice(index)] }, rungId };
}

export function removeRung(program: LadderProgram, rungId: string): LadderProgram {
  // Up to date first, so the numbers of what goes stay used.
  const counted = withSeq(program);
  return { ...counted, rungs: counted.rungs.filter((rung) => rung.id !== rungId) };
}

export function moveRung(program: LadderProgram, rungId: string, step: -1 | 1): LadderProgram {
  const index = program.rungs.findIndex((rung) => rung.id === rungId);
  const target = index + step;
  if (index < 0 || target < 0 || target >= program.rungs.length) return program;
  const rungs = [...program.rungs];
  [rungs[index], rungs[target]] = [rungs[target], rungs[index]];
  return { ...program, rungs };
}

export function addOutput(program: LadderProgram, rungId: string, kind: LdOutputKind, variable: string): LadderProgram {
  const output: LdOutput = { id: freeLdId("o", program), kind, var: variable };
  return updateRung(program, rungId, (rung) => ({ ...rung, outputs: [...rung.outputs, output] }));
}

export function removeOutput(program: LadderProgram, rungId: string, outputId: string): LadderProgram {
  return updateRung(program, rungId, (rung) => ({ ...rung, outputs: rung.outputs.filter((output) => output.id !== outputId) }));
}

export function updateOutput(program: LadderProgram, rungId: string, outputId: string, change: (output: LdOutput) => LdOutput): LadderProgram {
  return updateRung(program, rungId, (rung) => ({ ...rung, outputs: rung.outputs.map((output) => (output.id === outputId ? change(output) : output)) }));
}

/** A new element of a kind with sensible first values; names are free in the program. */
export function newNode(program: LadderProgram, kind: "no" | "nc" | "cmp" | "calc" | "call" | "ret" | LdBlockKind, variable: string, options: { op?: LdCmpOpChoice; calc?: LdCalcOp; routine?: string } = {}): LdNode {
  const id = freeLdId("e", program);
  switch (kind) {
    case "r_trig": case "f_trig": return { id, kind, name: freeBlockName(kind, program) };
    case "calc": {
      const a: LdOperand = { kind: "var", name: variable };
      return { id, kind: "calc", op: options.calc ?? "ADD", a, b: options.calc === "MOVE" ? null : { kind: "const", value: 1, type: "INT" }, dest: "Resultat" };
    }
    case "call": return { id, kind: "call", routine: options.routine ?? "Rutin1" };
    case "ret": return { id, kind: "ret" };
    case "no": case "nc": return { id, kind, var: variable };
    case "cmp": return { id, kind: "cmp", op: options.op ?? ">", left: { kind: "var", name: variable }, right: { kind: "const", value: 5000, type: "INT" } };
    case "ton": case "tof": case "tp": return { id, kind, name: freeBlockName(kind, program), ptMs: 2000 };
    case "ctu": case "ctd": return { id, kind, name: freeBlockName(kind, program), pv: 3, aux: null };
  }
}

// ---------- routines: the editor works on one list of rungs at a time ----------

/** The program as the editor sees it with a routine open: its rungs in `rungs`, everything else the same; null is Huvudrutin. */
export function routineView(program: LadderProgram, routineId: string | null): LadderProgram {
  if (!routineId) return program;
  const routine = program.routines?.find((item) => item.id === routineId);
  return routine ? { ...program, seq: Math.max(program.seq ?? 0, highestOf(program)), rungs: routine.rungs } : program;
}
const highestOf = (program: LadderProgram) => { let top = 0; for (const rung of allRungs(program)) for (const id of [rung.id, ...[...walkNodes(rung.items)].map((node) => node.id), ...rung.outputs.map((out) => out.id)]) top = Math.max(top, Number(/\d+$/.exec(id)?.[0] ?? 0)); return top; };
/** A change made in the view put back in the program. */
export function fromRoutineView(program: LadderProgram, routineId: string | null, view: LadderProgram): LadderProgram {
  if (!routineId) return view;
  const seq = Math.max(program.seq ?? 0, view.seq ?? 0, highestOf(program), highestOf(view));
  return { ...view, seq, rungs: program.rungs, routines: (program.routines ?? []).map((item) => (item.id === routineId ? { ...item, rungs: view.rungs } : item)) };
}
export function addRoutine(program: LadderProgram): { program: LadderProgram; routine: LdRoutine } {
  const taken = new Set((program.routines ?? []).map((item) => item.name.toUpperCase()));
  let number = 1;
  while (taken.has(`RUTIN${number}`)) number += 1;
  const routine: LdRoutine = { id: freeLdId("p", program), name: `Rutin${number}`, rungs: [] };
  const withRoutine = { ...program, routines: [...(program.routines ?? []), routine] };
  const rung = addRungTo(withRoutine, routine.id);
  return { program: rung, routine: rung.routines!.at(-1)! };
}
function addRungTo(program: LadderProgram, routineId: string) {
  const { program: next } = addRung(routineView(program, routineId), null);
  return fromRoutineView(program, routineId, next);
}
export function removeRoutine(program: LadderProgram, routineId: string): LadderProgram {
  const counted = withSeq(program);
  const routines = (counted.routines ?? []).filter((item) => item.id !== routineId);
  if (routines.length) return { ...counted, routines };
  const rest = { ...counted };
  delete rest.routines;
  return rest;
}
/** A routine renamed, with every call to it. */
export function renameRoutine(program: LadderProgram, routineId: string, name: string): LadderProgram {
  const old = program.routines?.find((item) => item.id === routineId)?.name;
  if (!old) return program;
  const rename = (rung: LdRung) => ({ ...rung, items: mapSeries(rung.items, (series) => series.map((node) => (node.kind === "call" && node.routine === old ? { ...node, routine: name } : node))) });
  return { ...program, rungs: program.rungs.map(rename), routines: (program.routines ?? []).map((item) => ({ ...item, name: item.id === routineId ? name : item.name, rungs: item.rungs.map(rename) })) };
}

/** A tag renamed everywhere it is used: elements, coils, comparisons, and whole words inside ST-blocks. */
export function renameTag(program: LadderProgram, from: string, to: string): LadderProgram {
  if (from === to) return program;
  const word = new RegExp(`(?<![A-Za-z0-9_])${from}(?![A-Za-z0-9_])`, "g");
  const one = (text: string) => (text === from ? to : text.startsWith(`${from}.`) ? `${to}${text.slice(from.length)}` : text);
  const operand = (item: LdOperand): LdOperand => (item.kind === "var" ? { ...item, name: one(item.name) } : item.kind === "member" && item.object === from ? { ...item, object: to } : item);
  const node = (item: LdNode): LdNode => {
    switch (item.kind) {
      case "no": case "nc": return { ...item, var: one(item.var) };
      case "cmp": return { ...item, left: operand(item.left), right: operand(item.right) };
      case "calc": return { ...item, a: operand(item.a), b: item.b ? operand(item.b) : null, dest: one(item.dest) };
      case "ton": case "tof": case "tp": case "r_trig": case "f_trig": return { ...item, name: one(item.name) };
      case "ctu": case "ctd": return { ...item, name: one(item.name), aux: item.aux ? one(item.aux) : null };
      case "st": return { ...item, text: item.text.replace(word, to) };
      default: return item;
    }
  };
  const rung = (item: LdRung): LdRung => ({ ...item, items: mapSeries(item.items, (series) => series.map(node)), outputs: item.outputs.map((out) => ({ ...out, var: one(out.var) })) });
  return { ...program, vars: program.vars.map((item) => ({ ...item, name: one(item.name) })), rungs: program.rungs.map(rung), ...(program.routines ? { routines: program.routines.map((item) => ({ ...item, rungs: item.rungs.map(rung) })) } : {}) };
}

/** The names already in use, for a suggestion list: variables, terminals named in the rungs, blocks. */
export function namesInUse(program: LadderProgram): string[] {
  const names = new Set<string>(program.vars.map((variable) => variable.name));
  for (const rung of allRungs(program)) {
    for (const node of walkNodes(rung.items)) {
      if (node.kind === "no" || node.kind === "nc") names.add(node.var);
      else if (node.kind === "cmp") { for (const operand of [node.left, node.right]) if (operand.kind === "var") names.add(operand.name); }
      else if (node.kind === "calc") { names.add(node.dest); for (const operand of [node.a, node.b]) if (operand?.kind === "var") names.add(operand.name); }
      else if (isBlockNode(node)) names.add(node.name);
    }
    for (const output of rung.outputs) names.add(output.var);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "sv"));
}
