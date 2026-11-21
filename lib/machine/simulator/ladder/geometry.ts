import { type LdNode, type LdOutput, type LdRung, stBlockLines } from "./model";

// PLC-simulatorn, Ladder: where everything in a rung is drawn, as pure data, so the editor's drawing and its drag-and-drop
// hit-testing (dnd.ts) read one and the same picture. Coordinates are the rung's own SVG units; the editor scales the SVG.
// A rung is rows of cells between two rails: every element is a cell, a parallel group spans its branches' rows, an ST-block
// is two cells wide and, expanded, as many rows as its lines need. The outputs stand in a column at the right.

export const CELL_W = 96;
export const CELL_H = 52;
/** Room left of the rail for the rung's number and its edit mark. */
export const RAIL_X = 30;
export const OUT_W = 96;
/** From the right rail to the rung's right edge. */
export const RAIL_END = 18;
/** The top of the first row: room for the rung's number and comment above it. */
export const TOP = 18;
export const BLOCK_CELLS = 2;
export const BLOCK_LINE_H = 11;
export const MAX_BLOCK_ROWS = 6;

export type SeriesStep = { group: string; branch: number };
/** The way down to a series: the rung's own series is `[]`, a branch is the group it is in and the branch's number. */
export type SeriesPath = readonly SeriesStep[];
export const samePath = (a: SeriesPath, b: SeriesPath) => a.length === b.length && a.every((step, index) => step.group === b[index].group && step.branch === b[index].branch);
export const pathKey = (path: SeriesPath) => path.map((step) => `${step.group}.${step.branch}`).join("/") || "top";

export type Measure = { w: number; h: number };
export type Cell = { node: LdNode; x: number; y: number; w: number; h: number; path: SeriesPath; index: number; depth: number };
export type SeriesBox = { path: SeriesPath; x: number; y: number; w: number; h: number; ends: number[]; count: number };
/** What colours a wire: the rail (always on), a node's flow in or out, or an output's state. */
export type FlowRef = "rail" | { node: string; side: "in" | "out" } | { output: string };
export type WireSeg = { key: string; x1: number; y1: number; x2: number; y2: number; flow: FlowRef };
export type OutputBox = { output: LdOutput; index: number; x: number; y: number; w: number; h: number };
export type RungGeometry = { width: number; height: number; rows: number; cells: Cell[]; series: SeriesBox[]; wires: WireSeg[]; outputs: OutputBox[]; outX: number; endX: number; rungFlow: FlowRef };
export type GeometryOptions = { minWidth?: number; expanded?: ReadonlySet<string> };

const NONE: ReadonlySet<string> = new Set();

export function measureNode(node: LdNode, expanded: ReadonlySet<string> = NONE): Measure {
  if (node.kind === "parallel") return measureGroup(node.branches, expanded);
  if (node.kind === "st") return { w: BLOCK_CELLS, h: expanded.has(node.id) ? Math.max(1, Math.min(MAX_BLOCK_ROWS, Math.ceil((stBlockLines(node.text).length * BLOCK_LINE_H + 20) / CELL_H))) : 1 };
  // A contact fits a cell; a function block has its pins, and stands two cells high.
  return { w: 1, h: isBox(node) ? 2 : 1 };
}
export const measureSeries = (items: readonly LdNode[], expanded: ReadonlySet<string> = NONE): Measure =>
  items.reduce<Measure>((acc, item) => { const m = measureNode(item, expanded); return { w: acc.w + m.w, h: Math.max(acc.h, m.h) }; }, { w: 0, h: 1 });
export const measureGroup = (branches: readonly (readonly LdNode[])[], expanded: ReadonlySet<string> = NONE): Measure =>
  ({ w: Math.max(1, ...branches.map((branch) => measureSeries(branch, expanded).w)), h: branches.reduce((sum, branch) => sum + measureSeries(branch, expanded).h, 0) });

/** How far from the cell's centre the symbol reaches, so the wire stubs stop short of it. */
export const symbolHalf = (node: LdNode, w: number) => (node.kind === "no" || node.kind === "nc" ? 12 : node.kind === "st" ? w / 2 - 8 : BOX_HALF);
/** A function block is drawn as a box with pins. */
export const BOX_HALF = 34;
export const isBox = (node: LdNode) => node.kind !== "no" && node.kind !== "nc" && node.kind !== "st" && node.kind !== "parallel";

export function layoutRung(rung: LdRung, options: GeometryOptions = {}): RungGeometry {
  const expanded = options.expanded ?? NONE;
  const size = measureSeries(rung.items, expanded);
  const cellsAcross = Math.max(size.w, 3);
  const width = Math.max(RAIL_X + RAIL_END + cellsAcross * CELL_W + OUT_W + 24, Math.floor(options.minWidth ?? 0));
  const rows = Math.max(size.h, rung.outputs.length, 1);
  const height = rows * CELL_H + 28;
  const cells: Cell[] = [], series: SeriesBox[] = [], wires: WireSeg[] = [];

  const walk = (items: readonly LdNode[], x: number, y: number, widthCells: number, path: SeriesPath, depth: number, flowIn: FlowRef): FlowRef => {
    let cursor = x, flow = flowIn;
    const ends = [x];
    items.forEach((item, index) => {
      const m = measureNode(item, expanded);
      const w = m.w * CELL_W, h = m.h * CELL_H;
      cells.push({ node: item, x: cursor, y, w, h, path, index, depth });
      if (item.kind === "parallel") {
        const first = y + CELL_H / 2;
        let row = y, last = first;
        item.branches.forEach((branch, branchIndex) => {
          last = row + CELL_H / 2;
          walk(branch, cursor, row, m.w, [...path, { group: item.id, branch: branchIndex }], depth + 1, { node: item.id, side: "in" });
          row += measureSeries(branch, expanded).h * CELL_H;
        });
        wires.push({ key: `${item.id}-l`, x1: cursor, y1: first, x2: cursor, y2: last, flow: { node: item.id, side: "in" } });
        wires.push({ key: `${item.id}-r`, x1: cursor + w, y1: first, x2: cursor + w, y2: last, flow: { node: item.id, side: "out" } });
      } else {
        const cx = cursor + w / 2, cy = y + CELL_H / 2, half = symbolHalf(item, w);
        wires.push({ key: `${item.id}-in`, x1: cursor, y1: cy, x2: cx - half, y2: cy, flow: { node: item.id, side: "in" } });
        wires.push({ key: `${item.id}-out`, x1: cx + half, y1: cy, x2: cursor + w, y2: cy, flow: { node: item.id, side: "out" } });
      }
      cursor += w;
      ends.push(cursor);
      flow = { node: item.id, side: "out" };
    });
    const right = x + widthCells * CELL_W;
    if (cursor < right) wires.push({ key: `fill-${pathKey(path)}`, x1: cursor, y1: y + CELL_H / 2, x2: right, y2: y + CELL_H / 2, flow });
    series.push({ path, x, y, w: widthCells * CELL_W, h: measureSeries(items, expanded).h * CELL_H, ends, count: items.length });
    return flow;
  };

  const rungFlow = walk(rung.items, RAIL_X, TOP, cellsAcross, [], 0, "rail");
  const endX = RAIL_X + cellsAcross * CELL_W;
  const outX = width - RAIL_END - OUT_W;
  wires.push({ key: "to-out", x1: endX, y1: TOP + CELL_H / 2, x2: outX, y2: TOP + CELL_H / 2, flow: rungFlow });
  if (rung.outputs.length > 1) wires.push({ key: "out-join", x1: outX, y1: TOP + CELL_H / 2, x2: outX, y2: TOP + (rung.outputs.length - 1) * CELL_H + CELL_H / 2, flow: rungFlow });
  const outputs = rung.outputs.map((output, index) => {
    const y = TOP + index * CELL_H, cy = y + CELL_H / 2, cx = outX + OUT_W / 2;
    wires.push({ key: `${output.id}-in`, x1: outX, y1: cy, x2: cx - 13, y2: cy, flow: rungFlow });
    wires.push({ key: `${output.id}-out`, x1: cx + 13, y1: cy, x2: width - RAIL_END, y2: cy, flow: { output: output.id } });
    return { output, index, x: outX, y, w: OUT_W, h: CELL_H };
  });
  return { width, height, rows, cells, series, wires, outputs, outX, endX, rungFlow };
}

/** The series at a path, or null when the path leads nowhere. */
export function seriesAt(items: readonly LdNode[], path: SeriesPath): readonly LdNode[] | null {
  let current: readonly LdNode[] = items;
  for (const step of path) {
    const group = current.find((node) => node.id === step.group);
    if (!group || group.kind !== "parallel" || !group.branches[step.branch]) return null;
    current = group.branches[step.branch];
  }
  return current;
}
