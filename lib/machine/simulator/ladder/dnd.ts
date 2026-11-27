import { findNode, type LdSelection, newNode, removeNode, removeOutput, removeRung, updateRung } from "./edit";
import { CELL_H, OUT_W, pathKey, type RungGeometry, samePath, seriesAt, type SeriesPath, TOP } from "./geometry";
import { type LadderProgram, type LdNode, type LdOutput, type LdOutputKind, type LdRung, MAX_BRANCHES, MAX_OUTPUTS, MAX_SERIES, walkNodes } from "./model";

// PLC-simulatorn, Ladder (2026-11-03: "drag drop som i riktiga PLC system"): what can be dragged, where it may be
// dropped, and what the drop does – pure, so a test can ask which slots a rung offers a dragged thing. The editor draws the
// slots as markers while a drag is on, and applies the drop as one change (one undo step). A slot that is not allowed is
// still found, with its reason, so the editor can show it struck through and say why.

export type ToolKind = "no" | "nc" | "cmp" | "ton" | "tof" | "tp" | "ctu" | "ctd" | "st" | "parallel" | "r_trig" | "f_trig" | "gt" | "ge" | "lt" | "le" | "eq" | "ne" | "add" | "sub" | "mul" | "div" | "move" | "call" | "ret" | LdOutputKind;
export const OUTPUT_TOOLS: readonly LdOutputKind[] = ["coil", "ncoil", "set", "reset"];
export const isOutputTool = (tool: ToolKind): tool is LdOutputKind => (OUTPUT_TOOLS as readonly string[]).includes(tool);

export type Payload =
  | { kind: "new"; tool: ToolKind }
  | { kind: "node"; rungId: string; nodeId: string; copy: boolean }
  | { kind: "output"; rungId: string; outputId: string; copy: boolean }
  | { kind: "rung"; rungId: string };

export type Slot =
  | { kind: "series"; rungId: string; path: SeriesPath; index: number }
  /** Around an element of the rung's own series: the element becomes a group with the dropped thing as a branch; a group gets one more branch. */
  | { kind: "branch"; rungId: string; nodeId: string; where: "above" | "below" }
  | { kind: "output"; rungId: string; index: number }
  | { kind: "rung"; index: number };

/** A slot with its marker: the middle of the marker, its length, whether it stands upright, and whether a drop there is allowed. */
export type SlotMark = { slot: Slot; x: number; y: number; length: number; vertical: boolean; legal: boolean; same: boolean; reason: string | null };
/** One name per slot, for keys: two slots never share it even when their markers would stand on one point. */
export const slotKey = (slot: Slot) => (slot.kind === "series" ? `series:${pathKey(slot.path)}:${slot.index}` : slot.kind === "branch" ? `branch:${slot.nodeId}:${slot.where}` : slot.kind === "output" ? `output:${slot.index}` : `rung:${slot.index}`);

export const REASONS = {
  outputInSeries: "Spolar sitter längst till höger i steget.",
  elementAtOutput: "Kontakter och block sitter före spolarna.",
  parallelNeedsElement: "Parallell släpps ovanför eller under ett element.",
  intoItself: "Elementet kan inte släppas i sig självt.",
  seriesFull: `Högst ${MAX_SERIES} element i en serie.`,
  branchesFull: `Högst ${MAX_BRANCHES} grenar i en grupp.`,
  outputsFull: `Högst ${MAX_OUTPUTS} utgångar i ett steg.`,
};

/** What the dragged thing is, for the rules: an element for the series, a coil for the output column, or Parallell. */
function shape(payload: Payload): "element" | "output" | "parallel" | "rung" {
  if (payload.kind === "rung") return "rung";
  if (payload.kind === "output") return "output";
  if (payload.kind === "node") return "element";
  return isOutputTool(payload.tool) ? "output" : payload.tool === "parallel" ? "parallel" : "element";
}

/** Every slot of a rung for a dragged thing, allowed or not, with its marker. */
export function rungSlots(rung: LdRung, geometry: RungGeometry, payload: Payload): SlotMark[] {
  const what = shape(payload);
  if (what === "rung") return [];
  const marks: SlotMark[] = [];
  const dragged = payload.kind === "node" && payload.rungId === rung.id ? geometry.cells.find((cell) => cell.node.id === payload.nodeId) ?? null : null;
  const insideDragged = (path: SeriesPath) => dragged !== null && path.some((step) => step.group === dragged.node.id);
  const mark = (slot: Slot, x: number, y: number, length: number, vertical: boolean, legal: boolean, same: boolean, reason: string | null) =>
    marks.push({ slot, x, y, length, vertical, legal: legal && !same, same, reason: legal || same ? null : reason });

  for (const box of geometry.series) {
    for (let index = 0; index <= box.count; index += 1) {
      const slot: Slot = { kind: "series", rungId: rung.id, path: box.path, index };
      const inOwnSeries = dragged !== null && samePath(box.path, dragged.path);
      const same = inOwnSeries && !(payload.kind === "node" && payload.copy) && (index === dragged.index || index === dragged.index + 1);
      let legal = what === "element", reason: string | null = what === "output" ? REASONS.outputInSeries : what === "parallel" ? REASONS.parallelNeedsElement : null;
      if (legal && insideDragged(box.path)) { legal = false; reason = REASONS.intoItself; }
      else if (legal && box.count >= MAX_SERIES && !inOwnSeries) { legal = false; reason = REASONS.seriesFull; }
      // In a branch the first and last slot share their point with the series outside the group: they stand just inside the group's bar.
      const inset = box.path.length === 0 ? 0 : index === 0 ? 6 : index === box.count && box.ends[index] === box.x + box.w ? -6 : 0;
      mark(slot, box.ends[index] + inset, box.y + CELL_H / 2, CELL_H - 14, true, legal, same, reason);
    }
  }
  // Above and below every element of the rung's own series: a group gets a branch, an element becomes a group.
  for (const cell of geometry.cells) {
    if (cell.depth !== 0) continue;
    for (const where of ["above", "below"] as const) {
      const slot: Slot = { kind: "branch", rungId: rung.id, nodeId: cell.node.id, where };
      const same = dragged !== null && dragged.node.id === cell.node.id && !(payload.kind === "node" && payload.copy);
      let legal = what === "element" || what === "parallel", reason: string | null = what === "output" ? REASONS.outputInSeries : null;
      if (legal && cell.node.kind === "parallel" && cell.node.branches.length >= MAX_BRANCHES) { legal = false; reason = REASONS.branchesFull; }
      mark(slot, cell.x + cell.w / 2, where === "above" ? cell.y + 3 : cell.y + cell.h - 3, cell.w - 16, false, legal, same, reason);
    }
  }
  const draggedOutput = payload.kind === "output" && payload.rungId === rung.id && !payload.copy ? rung.outputs.findIndex((output) => output.id === payload.outputId) : -1;
  for (let index = 0; index <= rung.outputs.length; index += 1) {
    const slot: Slot = { kind: "output", rungId: rung.id, index };
    const same = draggedOutput >= 0 && (index === draggedOutput || index === draggedOutput + 1);
    let legal = what === "output", reason: string | null = what === "parallel" ? REASONS.parallelNeedsElement : what === "element" ? REASONS.elementAtOutput : null;
    if (legal && rung.outputs.length >= MAX_OUTPUTS && draggedOutput < 0) { legal = false; reason = REASONS.outputsFull; }
    mark(slot, geometry.outX + OUT_W / 2, index === 0 ? TOP + 3 : TOP + index * CELL_H, OUT_W - 16, false, legal, same, reason);
  }
  return marks;
}

/** The slot under a point of the rung (in the rung's own units): a cell's edges give series slots, its top and bottom a branch, the right column an output. */
export function hitSlot(geometry: RungGeometry, marks: readonly SlotMark[], point: { x: number; y: number }): SlotMark | null {
  const find = (test: (slot: Slot) => boolean) => marks.find((mark) => test(mark.slot)) ?? null;
  const { x, y } = point;
  if (y < TOP - 12 || y > TOP + geometry.rows * CELL_H + 12) return null;
  if (x >= geometry.outX - 8) {
    const index = Math.max(0, Math.min(geometry.outputs.length, Math.round((y - TOP) / CELL_H)));
    return find((slot) => slot.kind === "output" && slot.index === index);
  }
  const leaf = geometry.cells.filter((cell) => cell.node.kind !== "parallel" && x >= cell.x && x < cell.x + cell.w && y >= cell.y && y < cell.y + cell.h).sort((a, b) => b.depth - a.depth)[0] ?? null;
  if (leaf) {
    const fy = (y - leaf.y) / leaf.h;
    const top = leaf.depth === 0 ? leaf : geometry.cells.find((cell) => cell.depth === 0 && cell.node.id === leaf.path[0].group) ?? null;
    if (top && fy < 0.25 && leaf.y === top.y) { const mark = find((slot) => slot.kind === "branch" && slot.nodeId === top.node.id && slot.where === "above"); if (mark) return mark; }
    if (top && fy > 0.75 && leaf.y + leaf.h >= top.y + top.h) { const mark = find((slot) => slot.kind === "branch" && slot.nodeId === top.node.id && slot.where === "below"); if (mark) return mark; }
    const index = (x - leaf.x) / leaf.w < 0.5 ? leaf.index : leaf.index + 1;
    return find((slot) => slot.kind === "series" && samePath(slot.path, leaf.path) && slot.index === index);
  }
  // Beside the elements: the deepest series whose row the point is in, at its nearest boundary; the empty wire up to the coils is the end of the rung's own series.
  const top = geometry.series.find((candidate) => candidate.path.length === 0);
  const box = geometry.series.filter((candidate) => y >= candidate.y && y < candidate.y + candidate.h && x >= candidate.x - 8 && x <= candidate.x + candidate.w + 8).sort((a, b) => b.path.length - a.path.length)[0]
    ?? (top && y >= top.y && y < top.y + CELL_H && x >= top.x && x < geometry.outX ? top : undefined);
  if (!box) return null;
  let best = 0;
  for (let index = 1; index < box.ends.length; index += 1) if (Math.abs(box.ends[index] - x) < Math.abs(box.ends[best] - x)) best = index;
  return find((slot) => slot.kind === "series" && samePath(slot.path, box.path) && slot.index === best);
}

// ---------- applying a drop ----------

const CMP_OP = { gt: ">", ge: ">=", lt: "<", le: "<=", eq: "=", ne: "<>" } as const;
const CALC_OP = { add: "ADD", sub: "SUB", mul: "MUL", div: "DIV", move: "MOVE" } as const;
/** A new element for a tool of the toolbar, with sensible first values. */
export function instructionNode(program: LadderProgram, tool: Exclude<ToolKind, LdOutputKind | "st">, defaults: Pick<DropDefaults, "input" | "analog"> & { routine?: string }): LdNode {
  if (tool in CMP_OP) return newNode(program, "cmp", defaults.analog, { op: CMP_OP[tool as keyof typeof CMP_OP] });
  if (tool in CALC_OP) return newNode(program, "calc", defaults.analog, { calc: CALC_OP[tool as keyof typeof CALC_OP] });
  if (tool === "cmp") return newNode(program, "cmp", defaults.analog);
  if (tool === "call") return newNode(program, "call", defaults.input, { routine: defaults.routine });
  return newNode(program, tool === "parallel" ? "no" : (tool as "no" | "nc" | "ton" | "tof" | "tp" | "ctu" | "ctd" | "r_trig" | "f_trig" | "ret"), defaults.input);
}

export type DropDefaults = { input: string; analog: string; output: string; st: string; routine?: string };
export type DropResult = { program: LadderProgram; selection: LdSelection; focus: boolean };

const takenIds = (program: LadderProgram) => {
  const taken = new Set<string>();
  for (const rung of program.rungs) { taken.add(rung.id); for (const node of walkNodes(rung.items)) taken.add(node.id); for (const output of rung.outputs) taken.add(output.id); }
  taken.add(`#${program.seq ?? 0}`);
  return taken;
};
/** A number never used in this program, so nothing still pointing at an old thing lands on the new one. */
const fresh = (prefix: string, taken: Set<string>) => { let top = 0; for (const id of taken) top = Math.max(top, Number(/\d+$/.exec(id)?.[0] ?? 0)); const candidate = `${prefix}${top + 1}`; taken.add(candidate); return candidate; };
const blockNames = (program: LadderProgram) => { const names = new Set<string>(program.vars.map((variable) => variable.name.toUpperCase())); for (const rung of program.rungs) for (const node of walkNodes(rung.items)) if ("name" in node) names.add(node.name.toUpperCase()); return names; };

/** A copy with ids of its own; a timer or counter gets a name of its own too, since two calls of one block are not two blocks. */
function cloneNode(node: LdNode, taken: Set<string>, names: Set<string>): LdNode {
  const id = fresh(node.kind === "parallel" ? "g" : "e", taken);
  if (node.kind === "parallel") return { ...node, id, branches: node.branches.map((branch) => branch.map((inner) => cloneNode(inner, taken, names))) };
  if (node.kind === "ton" || node.kind === "tof" || node.kind === "tp" || node.kind === "ctu" || node.kind === "ctd" || node.kind === "r_trig" || node.kind === "f_trig") {
    const prefix = node.kind === "ctu" || node.kind === "ctd" ? "C" : node.kind === "r_trig" || node.kind === "f_trig" ? "Flank" : "T";
    let name = node.name;
    for (let index = 1; names.has(name.toUpperCase()); index += 1) name = `${prefix}${index}`;
    names.add(name.toUpperCase());
    return { ...node, id, name };
  }
  return { ...node, id };
}

/** The series at `path` replaced by what `change` makes of it. */
const atPath = (items: LdNode[], path: SeriesPath, change: (series: LdNode[]) => LdNode[]): LdNode[] => {
  if (!path.length) return change(items);
  const [step, ...rest] = path;
  return items.map((node) => (node.kind === "parallel" && node.id === step.group ? { ...node, branches: node.branches.map((branch, index) => (index === step.branch ? atPath(branch, rest, change) : branch)) } : node));
};
/** The node taken out wherever it is, the groups left as they are (normalise tidies afterwards). */
const prune = (items: LdNode[], nodeId: string): LdNode[] => items.filter((node) => node.id !== nodeId).map((node) => (node.kind === "parallel" ? { ...node, branches: node.branches.map((branch) => prune(branch, nodeId)) } : node));
/** No empty branch, no group of one branch: what a move leaves behind is tidied. */
export const normalise = (items: LdNode[]): LdNode[] => items.flatMap((node) => {
  if (node.kind !== "parallel") return [node];
  const branches = node.branches.map(normalise).filter((branch) => branch.length > 0);
  if (!branches.length) return [];
  if (branches.length === 1) return branches[0];
  return [{ ...node, branches }];
});
const wrap = (items: LdNode[], targetId: string, node: LdNode, where: "above" | "below", taken: Set<string>): LdNode[] => items.map((item) => {
  if (item.id !== targetId) return item;
  if (item.kind === "parallel") return { ...item, branches: where === "above" ? [[node], ...item.branches] : [...item.branches, [node]] };
  return { id: fresh("g", taken), kind: "parallel", branches: where === "above" ? [[node], [item]] : [[item], [node]] };
});

/** The program after a drop, with what to select; null when the drop changes nothing. */
export function applyDrop(program: LadderProgram, payload: Payload, slot: Slot, defaults: DropDefaults): DropResult | null {
  if (slot.kind === "rung") {
    if (payload.kind !== "rung") return null;
    const from = program.rungs.findIndex((rung) => rung.id === payload.rungId);
    if (from < 0) return null;
    const to = slot.index > from ? slot.index - 1 : slot.index;
    if (to === from) return null;
    const rungs = [...program.rungs];
    const [moved] = rungs.splice(from, 1);
    rungs.splice(to, 0, moved);
    return { program: { ...program, rungs }, selection: { kind: "rung", rungId: payload.rungId }, focus: false };
  }
  if (payload.kind === "rung" || !program.rungs.some((rung) => rung.id === slot.rungId)) return null;
  const taken = takenIds(program);
  let next = program;
  let node: LdNode | null = null, output: LdOutput | null = null;
  if (payload.kind === "new") {
    if (isOutputTool(payload.tool)) output = { id: fresh("o", taken), kind: payload.tool, var: defaults.output };
    else if (payload.tool === "st") node = { id: fresh("e", taken), kind: "st", text: defaults.st };
    else node = instructionNode(program, payload.tool, defaults);
  } else if (payload.kind === "node") {
    const source = program.rungs.find((rung) => rung.id === payload.rungId);
    const original = source ? findNode(source, payload.nodeId) : null;
    if (!source || !original) return null;
    if (payload.copy) node = cloneNode(original, taken, blockNames(program));
    else { node = original; next = updateRung(next, source.id, (rung) => ({ ...rung, items: prune(rung.items, original.id) })); }
  } else {
    const source = program.rungs.find((rung) => rung.id === payload.rungId);
    const original = source?.outputs.find((candidate) => candidate.id === payload.outputId);
    if (!source || !original) return null;
    if (payload.copy) output = { ...original, id: fresh("o", taken) };
    else { output = original; next = updateRung(next, source.id, (rung) => ({ ...rung, outputs: rung.outputs.filter((candidate) => candidate.id !== original.id) })); }
  }

  if (slot.kind === "series") {
    if (!node) return null;
    const placed = node;
    let index = slot.index;
    // Moved within its own series: the slot was counted with the element still in place.
    if (payload.kind === "node" && !payload.copy && payload.rungId === slot.rungId) {
      const source = program.rungs.find((rung) => rung.id === payload.rungId)!;
      const sourceIndex = seriesAt(source.items, slot.path)?.findIndex((candidate) => candidate.id === payload.nodeId) ?? -1;
      if (sourceIndex >= 0 && sourceIndex < index) index -= 1;
    }
    next = updateRung(next, slot.rungId, (rung) => ({ ...rung, items: normalise(atPath(rung.items, slot.path, (series) => [...series.slice(0, index), placed, ...series.slice(index)])) }));
  } else if (slot.kind === "branch") {
    if (!node) return null;
    const placed = node;
    next = updateRung(next, slot.rungId, (rung) => ({ ...rung, items: normalise(wrap(rung.items, slot.nodeId, placed, slot.where, taken)) }));
  } else {
    if (!output) return null;
    const placed = output;
    let index = slot.index;
    if (payload.kind === "output" && !payload.copy && payload.rungId === slot.rungId) {
      const sourceIndex = program.rungs.find((rung) => rung.id === payload.rungId)!.outputs.findIndex((candidate) => candidate.id === payload.outputId);
      if (sourceIndex >= 0 && sourceIndex < index) index -= 1;
    }
    next = updateRung(next, slot.rungId, (rung) => ({ ...rung, outputs: [...rung.outputs.slice(0, index), placed, ...rung.outputs.slice(index)] }));
  }
  // What a move left behind in another rung is tidied too.
  if (payload.kind === "node" && !payload.copy && payload.rungId !== slot.rungId) next = updateRung(next, payload.rungId, (rung) => ({ ...rung, items: normalise(rung.items) }));
  if (node) return { program: next, selection: { kind: "node", rungId: slot.rungId, nodeId: node.id }, focus: node.kind !== "parallel" && node.kind !== "st" };
  return { program: next, selection: { kind: "output", rungId: slot.rungId, outputId: output!.id }, focus: true };
}

/** Dropped on the toolbox or the bin: the dragged thing is removed, as Delete would. */
export function removePayload(program: LadderProgram, payload: Payload): LadderProgram {
  if (payload.kind === "node") return updateRung(program, payload.rungId, (rung) => removeNode(rung, payload.nodeId));
  if (payload.kind === "output") return removeOutput(program, payload.rungId, payload.outputId);
  if (payload.kind === "rung") return removeRung(program, payload.rungId);
  return program;
}

/** The slot between rungs nearest to a point, from the rungs' top and bottom edges on screen. */
export function rungSlotAt(edges: readonly { top: number; bottom: number }[], y: number): number {
  if (!edges.length) return 0;
  let best = 0, distance = Math.abs(edges[0].top - y);
  edges.forEach((edge, index) => { const d = Math.abs(edge.bottom - y); if (d < distance) { distance = d; best = index + 1; } });
  return best;
}
