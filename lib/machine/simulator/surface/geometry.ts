import { ioName, PLC_IO } from "@/lib/machine/simulator/st/io";
import { DEVICE_DEFS, type DeviceKindDef, feedsInputs } from "./devices";
import { designedDef, designedTerminalAt, designFor, readoutFor, type DeviceDesign } from "./device-designs";
import { readoutFrame } from "./readouts";
import { type DeviceInst, isTerminalEnd, type Junction, type Layout, PLC_DEVICE_ID, type Point, SURFACE_HEIGHT, type TerminalRef, type Wire, type WireEnd } from "./layout";

// PLC-simulatorn: where everything is drawn, in the surface's own coordinates. Pure, so the drawing and the wire
// routing agree, and a test can ask where a terminal is without a browser. Wires are orthogonal since v3 (2026-11-03): out of a
// terminal a short lead, then horizontal and vertical runs; a wire with its own bends keeps them, one without is routed here.

export const PLC_BOX = { x: 340, y: 235, width: 520, height: 210 };
export const TERMINAL_PITCH = 26;
/** Top row: supply, then the inputs. Bottom row: the outputs. */
export const PLC_TOP_TERMINALS = ["24V", "0V", ...Array.from({ length: PLC_IO.di }, (_, index) => ioName({ kind: "DI", index })), ...Array.from({ length: PLC_IO.ai }, (_, index) => ioName({ kind: "AI", index }))];
export const PLC_BOTTOM_TERMINALS = [...Array.from({ length: PLC_IO.do }, (_, index) => ioName({ kind: "DO", index })), ...Array.from({ length: PLC_IO.ao }, (_, index) => ioName({ kind: "AO", index }))];
/** How far a wire leaves a terminal before it turns. */
export const LEAD = 18;
/** Free points snap to this grid. */
export const GRID = 8;
/** How close the pointer has to be to a terminal, a junction or a wire to take it. */
export const SNAP = 14;

export type Side = "top" | "bottom";
export type TerminalPoint = { x: number; y: number; side: Side };
export type EndPoint = { x: number; y: number; side: Side | null };

const rowX = (count: number, index: number) => PLC_BOX.x + (PLC_BOX.width - (count - 1) * TERMINAL_PITCH) / 2 + index * TERMINAL_PITCH;

export function plcTerminalPoint(terminal: string): TerminalPoint | null {
  const top = PLC_TOP_TERMINALS.indexOf(terminal);
  if (top >= 0) return { x: rowX(PLC_TOP_TERMINALS.length, top), y: PLC_BOX.y, side: "top" };
  const bottom = PLC_BOTTOM_TERMINALS.indexOf(terminal);
  if (bottom >= 0) return { x: rowX(PLC_BOTTOM_TERMINALS.length, bottom), y: PLC_BOX.y + PLC_BOX.height, side: "bottom" };
  return null;
}

/** Where a terminal is: spread evenly along its side, or where the product owner's design (PLC-apparater) placed it. */
export function deviceTerminalPoint(device: DeviceInst, terminal: string, design?: DeviceDesign | null): TerminalPoint | null {
  const def = designedDef(device, design);
  const own = def.terminals.find((candidate) => candidate.id === terminal);
  if (!own) return null;
  const row = def.terminals.filter((candidate) => candidate.side === own.side);
  const index = row.indexOf(own);
  const at = designedTerminalAt(device, terminal, design);
  const x = device.x + (at !== null ? def.width * at : (def.width * (index + 1)) / (row.length + 1));
  return { x, y: own.side === "top" ? device.y : device.y + def.height, side: own.side };
}

export function terminalPoint(ref: TerminalRef, devices: ReadonlyMap<string, DeviceInst>): TerminalPoint | null {
  if (ref.device === PLC_DEVICE_ID) return plcTerminalPoint(ref.terminal);
  const device = devices.get(ref.device);
  return device ? deviceTerminalPoint(device, ref.terminal) : null;
}

export function endPoint(end: WireEnd, devices: ReadonlyMap<string, DeviceInst>, junctions: ReadonlyMap<string, Junction>): EndPoint | null {
  if (isTerminalEnd(end)) return terminalPoint(end, devices);
  const junction = junctions.get(end.junction);
  return junction ? { x: junction.x, y: junction.y, side: null } : null;
}

export const snap = (value: number) => Math.round(value / GRID) * GRID;
export const junctionsById = (layout: Pick<Layout, "junctions">) => new Map(layout.junctions.map((junction) => [junction.id, junction]));

/** Where a wire has left its terminal and may turn: LEAD out along the terminal's side; a junction is its own lead. */
export const leadOf = (end: EndPoint): Point => (end.side === "top" ? { x: end.x, y: end.y - LEAD } : end.side === "bottom" ? { x: end.x, y: end.y + LEAD } : { x: end.x, y: end.y });

/** Consecutive duplicates and points on a straight run are dropped, so every corner in the result is a real bend. */
export function tidyRoute(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const before = out[out.length - 2];
    if (last && before && ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))) out[out.length - 1] = point;
    else out.push(point);
  }
  return out;
}

export type Dir = "h" | "v" | null;
/** Adds `next` to the path, with an elbow when the move is diagonal, horizontal first after a vertical run and the other way round. */
export function stepTo(path: Point[], next: Point, lastDir: Dir): Dir {
  const prev = path[path.length - 1];
  if (prev.x === next.x && prev.y === next.y) return lastDir;
  if (prev.x === next.x) { path.push(next); return "v"; }
  if (prev.y === next.y) { path.push(next); return "h"; }
  const horizontalFirst = lastDir === "v" || (lastDir === null && Math.abs(next.x - prev.x) >= Math.abs(next.y - prev.y));
  path.push(horizontalFirst ? { x: next.x, y: prev.y } : { x: prev.x, y: next.y });
  path.push(next);
  return horizontalFirst ? "v" : "h";
}

/**
 * The polyline of a wire. With its own bends the wire goes through them (elbows added where a bend is off-axis, so a moved
 * device never leaves a slanted line); without, a route is chosen: lead out of each terminal, then a Z, an S or a U between.
 * `channel` staggers parallel auto-routed wires a few pixels so they do not lie on top of each other.
 */
export function wireRoute(wire: Wire, devices: ReadonlyMap<string, DeviceInst>, junctions: ReadonlyMap<string, Junction>, channel = 0): Point[] | null {
  const a = endPoint(wire.from, devices, junctions), b = endPoint(wire.to, devices, junctions);
  if (!a || !b) return null;
  const start: Point = { x: a.x, y: a.y }, end: Point = { x: b.x, y: b.y };
  const la = leadOf(a), lb = leadOf(b);
  const path: Point[] = [start];
  let dir: Dir = null;
  if (a.side) { path.push(la); dir = "v"; }
  if (wire.points?.length) {
    for (const bend of wire.points) dir = stepTo(path, bend, dir);
    if (b.side) { stepTo(path, lb, dir); path.push(end); } else stepTo(path, end, dir);
    return tidyRoute(path);
  }
  const offset = channel * 6;
  const p = path[path.length - 1], q = b.side ? lb : end;
  if (a.side && b.side) {
    if (a.side === b.side) {
      const y = a.side === "top" ? Math.min(p.y, q.y) - offset : Math.max(p.y, q.y) + offset;
      path.push({ x: p.x, y }, { x: q.x, y });
    } else if ((a.side === "top" && p.y >= q.y) || (a.side === "bottom" && p.y <= q.y)) {
      const y = (p.y + q.y) / 2 + (a.side === "top" ? -offset : offset);
      path.push({ x: p.x, y }, { x: q.x, y });
    } else {
      // The leads point away from each other: a vertical between them, moved past the PLC's side when it would cut through the PLC.
      let x = (p.x + q.x) / 2 + offset;
      const crossesPlc = x > PLC_BOX.x - 12 && x < PLC_BOX.x + PLC_BOX.width + 12 && Math.min(p.y, q.y) < PLC_BOX.y + PLC_BOX.height && Math.max(p.y, q.y) > PLC_BOX.y;
      if (crossesPlc) x = q.x >= PLC_BOX.x + PLC_BOX.width / 2 ? PLC_BOX.x + PLC_BOX.width + 20 + offset : PLC_BOX.x - 20 - offset;
      path.push({ x, y: p.y }, { x, y: q.y });
    }
    path.push(q, end);
  } else if (a.side || b.side) {
    // One free end: go across at the free end's level when it lies on the terminal's exit side, else to the lead's level first.
    const free = a.side ? q : p, lead = a.side ? p : q, side = a.side ?? b.side;
    const onExitSide = side === "top" ? free.y <= lead.y : free.y >= lead.y;
    const corner = onExitSide ? { x: lead.x, y: free.y } : { x: free.x, y: lead.y };
    if (a.side) path.push(corner, q); else path.push(corner, q);
    if (b.side) path.push(end);
  } else {
    stepTo(path, end, null);
  }
  return tidyRoute(path);
}

export const pathOfRoute = (route: readonly Point[]) => route.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");

export type Segment = { index: number; a: Point; b: Point; horizontal: boolean };
export const segmentsOf = (route: readonly Point[]): Segment[] => route.slice(1).map((b, index) => ({ index, a: route[index], b, horizontal: route[index].y === b.y }));

/** The closest point on a segment, its distance and where it lies (0–1 along the segment). */
export function nearestOnSegment(segment: Pick<Segment, "a" | "b">, p: Point): { point: Point; distance: number; t: number } {
  const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - segment.a.x) * dx + (p.y - segment.a.y) * dy) / length2));
  const point = { x: segment.a.x + t * dx, y: segment.a.y + t * dy };
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y), t };
}

export function nearestSegment(route: readonly Point[], p: Point): { segment: Segment; point: Point; distance: number } | null {
  let best: { segment: Segment; point: Point; distance: number } | null = null;
  for (const segment of segmentsOf(route)) {
    const near = nearestOnSegment(segment, p);
    if (!best || near.distance < best.distance) best = { segment, point: near.point, distance: near.distance };
  }
  return best;
}

/** The bends of a route as a wire would store them: everything but the two ends and the terminal leads. */
export function bendsOfRoute(route: readonly Point[], fromSide: Side | null, toSide: Side | null): Point[] {
  const inner = route.slice(1, -1);
  const withoutLeads = inner.slice(fromSide ? 1 : 0, toSide ? inner.length - 1 : inner.length);
  return withoutLeads.map((point) => ({ x: point.x, y: point.y }));
}

export type Box = { x: number; y: number; width: number; height: number };
/**
 * Where a device's name stands: on the side without terminals, so no lead has to pass it; with terminals on both sides, below
 * the leads. Coordinates relative to the device: the middle of the text's baseline.
 */
export function labelPlace(def: Pick<DeviceKindDef, "width" | "height" | "terminals">): { x: number; y: number; anchor: "middle" | "end" } {
  const top = def.terminals.some((terminal) => terminal.side === "top"), bottom = def.terminals.some((terminal) => terminal.side === "bottom");
  // Terminals on both sides (2026-11-09: "texten kan inte vara under anslutningen"): the name stands to the left of the plate.
  if (top && bottom) return { x: -6, y: def.height / 2 + 4, anchor: "end" };
  return { x: def.width / 2, y: !bottom ? def.height + 14 : -6, anchor: "middle" };
}
const LABEL_CHAR = 5.6;
/** A name beside the plate is wrapped on two lines when long (2026-11-09: "radbryt texterna"): split at the space nearest the middle. */
export function nameLines(text: string, anchor: "middle" | "end"): string[] {
  if (anchor !== "end" || text.length <= 12 || !text.includes(" ")) return [text];
  const spaces = [...text.matchAll(/ /g)].map((match) => match.index!);
  const at = spaces.reduce((best, index) => (Math.abs(index - text.length / 2) < Math.abs(best - text.length / 2) ? index : best), spaces[0]!);
  return [text.slice(0, at), text.slice(at + 1)];
}
/** The box the name's text covers. Wires are routed round it. */
export function labelBox(device: DeviceInst): Box {
  const def = designedDef(device);
  const place = labelPlace(def);
  const lines = nameLines(device.label, place.anchor);
  const width = Math.max(16, Math.max(...lines.map((line) => line.length)) * LABEL_CHAR + 6);
  const top = place.y - 10 - (lines.length - 1) * 6;
  return { x: device.x + place.x - (place.anchor === "end" ? width : width / 2), y: device.y + top, width, height: 13 * lines.length };
}
/** A device with its name: what Anpassa fits and what must not stand under the floating button. */
/** The value tag beside a placed device, in surface coordinates (readouts.ts), or null when it shows nothing. */
export function readoutBox(device: DeviceInst): Box | null {
  const def = designedDef(device);
  const frame = readoutFrame(readoutFor(device.kind, designFor(device)), def, labelPlace(def).y > def.height);
  return frame ? { x: device.x + frame.x, y: device.y + frame.y, width: frame.width, height: frame.height } : null;
}
export const deviceBox = (device: DeviceInst): Box => {
  const def = designedDef(device);
  const plate: Box = { x: device.x, y: device.y, width: def.width, height: def.height };
  const withLabel = device.label ? unionBox(plate, labelBox(device)) : plate;
  const tag = readoutBox(device);
  return tag ? unionBox(withLabel, tag) : withLabel;
};
export const unionBox = (a: Box, b: Box): Box => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }; };
const overlap = (a: Box, b: Box, gap = 0) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
/** Everything a device may not be laid on: the PLC and the other plates, by id. */
const plcBoxAround = (): Box => ({ x: PLC_BOX.x, y: PLC_BOX.y - 8, width: PLC_BOX.width, height: PLC_BOX.height + 16 });
const LAY_GAP = GRID;

/**
 * The offset nearest to (dx, dy), on the grid, at which the given devices lie on nothing else: a dropped or moved device never
 * lands on another (2026-11-04). Searches rings outward on the grid, nearest first; the same drawing always gives the same answer.
 */
export function freeOffset(moving: readonly DeviceInst[], others: readonly DeviceInst[], dx: number, dy: number): { dx: number; dy: number } {
  const blocked: Box[] = [plcBoxAround(), ...others.map(deviceBox)];
  const clearAt = (ox: number, oy: number) => moving.every((device) => { const box = deviceBox(device); return !blocked.some((other) => overlap({ ...box, x: box.x + ox, y: box.y + oy }, other, LAY_GAP)); });
  if (clearAt(dx, dy)) return { dx, dy };
  for (let ring = 1; ring < 400; ring += 1) {
    let best: { dx: number; dy: number; distance: number } | null = null;
    for (let i = -ring; i <= ring; i += 1) {
      for (const [ox, oy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]] as const) {
        const cx = dx + ox * GRID, cy = dy + oy * GRID;
        const distance = Math.hypot(ox, oy);
        if ((!best || distance < best.distance) && clearAt(cx, cy)) best = { dx: cx, dy: cy, distance };
      }
    }
    if (best) return { dx: best.dx, dy: best.dy };
  }
  return { dx, dy };
}
/** The nearest free place on the grid for one device. */
export function freePlace(device: DeviceInst, others: readonly DeviceInst[]): { x: number; y: number } {
  const { dx, dy } = freeOffset([device], others, 0, 0);
  return { x: device.x + dx, y: device.y + dy };
}

/**
 * Where the floating Ta bort stands: outside the box of what is selected, its name included, and not on anything else if it
 * can be helped. Beside the box first, then above, under, to the left. The button's size is in the surface's units.
 */
export function removeButtonSpot(box: Box, others: readonly Box[], button: { width: number; height: number }, gap: number): { x: number; y: number } {
  const candidates = [
    { x: box.x + box.width + gap, y: box.y }, { x: box.x, y: box.y - button.height - gap },
    { x: box.x, y: box.y + box.height + gap }, { x: box.x - button.width - gap, y: box.y },
  ];
  return candidates.find((spot) => !others.some((other) => overlap({ ...spot, ...button }, other))) ?? candidates[0];
}

/** The box around everything drawn, for Anpassa: the PLC, the devices with their labels, the junctions and the wires' bends. */
export function contentBounds(layout: Pick<Layout, "devices" | "junctions">, routes: readonly (readonly Point[])[]): Box {
  let minX = PLC_BOX.x, minY = PLC_BOX.y - 8, maxX = PLC_BOX.x + PLC_BOX.width, maxY = PLC_BOX.y + PLC_BOX.height + 8;
  const take = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const device of layout.devices) { const box = deviceBox(device); take(box.x, box.y); take(box.x + box.width, box.y + box.height); }
  for (const junction of layout.junctions) take(junction.x, junction.y);
  for (const route of routes) for (const point of route) take(point.x, point.y);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A free spot for a new device: from the top left for things that feed inputs, from the bottom left for things outputs drive. */
export function suggestPlace(kind: DeviceInst["kind"], devices: readonly DeviceInst[]): { x: number; y: number } {
  const def = DEVICE_DEFS[kind];
  const y = feedsInputs(def) ? 60 : SURFACE_HEIGHT - def.height - 40;
  return freePlace({ id: "ny", kind, x: 40, y, label: "", options: {} }, devices);
}
