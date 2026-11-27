import { DEVICE_DEFS } from "./devices";
import { designedDef } from "./device-designs";
import { bendsOfRoute, type Box, endPoint, junctionsById, leadOf, nearestOnSegment, nearestSegment, plcTerminalPoint, PLC_BOTTOM_TERMINALS, PLC_TOP_TERMINALS, deviceTerminalPoint, segmentsOf, SNAP, snap, type Side, wireRoute, freeOffset } from "./geometry";
import {
  defaultLabel, type DeviceInst, freeDeviceId, freeJunctionId, freeWireId, isTerminalEnd, type Junction, type Layout, MAX_BENDS, MAX_DEVICES, MAX_JUNCTIONS, MAX_LABEL, MAX_WIRES, PLC_DEVICE_ID, type Point, sameEnd, type TerminalRef, type Wire, type WireEnd, type WireKind, wiresAtJunction,
} from "./layout";
import { routeAll } from "./route";
import { devicesById } from "./wiring";

// PLC-simulatorn (v3, 2026-11-03: "arbeta mer som i ett modernt elektriskt ritprogram"): the wire tool's
// operations on a drawing, pure. A pointer position becomes a Hit – a terminal, a junction, a point on a wire or empty
// space – and a hit becomes a wire end: a terminal as it is, a junction as it is, a wire split with a new junction (a branch),
// empty space a new free junction (a loose end). Segments move perpendicular to themselves, bends are kept on the wire.

export type Hit = { kind: "terminal"; ref: TerminalRef } | { kind: "junction"; id: string } | { kind: "wire"; wireId: string; point: Point } | { kind: "empty"; point: Point };
export type Routes = ReadonlyMap<string, readonly Point[]>;

const clampPoint = (point: Point): Point => ({ x: snap(point.x), y: snap(point.y) });

/** Every terminal on the drawing with its place, for snapping. */
export function allTerminals(layout: Pick<Layout, "devices">): { ref: TerminalRef; x: number; y: number }[] {
  const out: { ref: TerminalRef; x: number; y: number }[] = [];
  for (const terminal of [...PLC_TOP_TERMINALS, ...PLC_BOTTOM_TERMINALS]) { const point = plcTerminalPoint(terminal)!; out.push({ ref: { device: PLC_DEVICE_ID, terminal }, x: point.x, y: point.y }); }
  for (const device of layout.devices) for (const terminal of designedDef(device).terminals) { const point = deviceTerminalPoint(device, terminal.id)!; out.push({ ref: { device: device.id, terminal: terminal.id }, x: point.x, y: point.y }); }
  return out;
}

/**
 * What a pointer at `p` takes: the nearest terminal within SNAP, else the nearest junction, else the nearest wire segment,
 * else empty space on the grid. `exclude` keeps a wire being edited from catching its own end. `reach` is wider when the view is zoomed out,
 * so a terminal is as easy to take with the pointer at 30 % as at 100 %.
 */
export function hitAt(layout: Layout, p: Point, routes: Routes, exclude: { wireId?: string; junctionId?: string } = {}, reach: number = SNAP): Hit {
  const nearest = (candidates: { distance: number; hit: Hit }[]) => candidates.filter((candidate) => candidate.distance <= reach).sort((a, b) => a.distance - b.distance)[0]?.hit ?? null;
  const terminal = nearest(allTerminals(layout).map((candidate) => ({ distance: Math.hypot(candidate.x - p.x, candidate.y - p.y), hit: { kind: "terminal", ref: candidate.ref } as Hit })));
  if (terminal) return terminal;
  const junction = nearest(layout.junctions.filter((candidate) => candidate.id !== exclude.junctionId).map((candidate) => ({ distance: Math.hypot(candidate.x - p.x, candidate.y - p.y), hit: { kind: "junction", id: candidate.id } as Hit })));
  if (junction) return junction;
  const segments: { distance: number; hit: Hit }[] = [];
  for (const wire of layout.wires) {
    if (wire.id === exclude.wireId) continue;
    const route = routes.get(wire.id);
    const near = route ? nearestSegment(route, p) : null;
    if (near) segments.push({ distance: near.distance, hit: { kind: "wire", wireId: wire.id, point: near.point } });
  }
  return nearest(segments) ?? { kind: "empty", point: clampPoint(p) };
}

/** Every wire's route: around the plates for a wire without bends (route.ts), through its own bends for one with. */
export const routesOf = (layout: Layout): Map<string, Point[]> => routeAll(layout);

export function dropOrphanJunctions(layout: Layout): Layout {
  const used = new Set<string>();
  for (const wire of layout.wires) for (const end of [wire.from, wire.to]) if (!isTerminalEnd(end)) used.add(end.junction);
  return layout.junctions.length === used.size ? layout : { ...layout, junctions: layout.junctions.filter((junction) => used.has(junction.id)) };
}

function addJunction(layout: Layout, point: Point): { layout: Layout; id: string } | null {
  if (layout.junctions.length >= MAX_JUNCTIONS) return null;
  const id = freeJunctionId(layout.junctions.map((junction) => junction.id));
  const junction: Junction = { id, ...clampPoint(point) };
  return { layout: { ...layout, junctions: [...layout.junctions, junction] }, id };
}

/** Splits a wire where `at` falls on it: two wires joined by a new junction, the bends shared out between them. */
export function splitWire(layout: Layout, wireId: string, at: Point, routes: Routes): { layout: Layout; junctionId: string } | null {
  const wire = layout.wires.find((candidate) => candidate.id === wireId);
  const route = routes.get(wireId);
  if (!wire || !route || layout.wires.length >= MAX_WIRES) return null;
  const near = nearestSegment(route, at);
  if (!near) return null;
  const devices = devicesById(layout), junctions = junctionsById(layout);
  const fromSide = endPoint(wire.from, devices, junctions)?.side ?? null, toSide = endPoint(wire.to, devices, junctions)?.side ?? null;
  const point = near.segment.horizontal ? { x: near.point.x, y: near.segment.a.y } : { x: near.segment.a.x, y: near.point.y };
  const added = addJunction(layout, point);
  if (!added) return null;
  const junction = added.layout.junctions.find((candidate) => candidate.id === added.id)!;
  const bends = bendsOfRoute(route, fromSide, toSide);
  const base = fromSide ? 2 : 1;
  const before = bends.filter((_, index) => base + index <= near.segment.index);
  const after = bends.filter((_, index) => base + index >= near.segment.index + 1);
  const second: Wire = { id: freeWireId(added.layout.wires.map((candidate) => candidate.id)), from: { junction: junction.id }, to: wire.to, ...(after.length ? { points: after } : {}), ...(wire.kind ? { kind: wire.kind } : {}) };
  const first: Wire = { ...wire, to: { junction: junction.id }, points: before };
  if (!before.length) delete first.points;
  return { layout: { ...added.layout, wires: added.layout.wires.flatMap((candidate) => (candidate.id === wireId ? [first, second] : [candidate])) }, junctionId: junction.id };
}

/** A hit as a wire end, with whatever junction that needs. */
export function attachEnd(layout: Layout, hit: Hit, routes: Routes): { layout: Layout; end: WireEnd } | null {
  if (hit.kind === "terminal") return { layout, end: hit.ref };
  if (hit.kind === "junction") return layout.junctions.some((junction) => junction.id === hit.id) ? { layout, end: { junction: hit.id } } : null;
  if (hit.kind === "wire") { const split = splitWire(layout, hit.wireId, hit.point, routes); return split ? { layout: split.layout, end: { junction: split.junctionId } } : null; }
  const added = addJunction(layout, hit.point);
  return added ? { layout: added.layout, end: { junction: added.id } } : null;
}

export const wireBetween = (layout: Pick<Layout, "wires">, a: WireEnd, b: WireEnd) => layout.wires.find((wire) => (sameEnd(wire.from, a) && sameEnd(wire.to, b)) || (sameEnd(wire.from, b) && sameEnd(wire.to, a))) ?? null;

/**
 * A new wire from one hit to another; a click in empty space without a drag gives a loose wire to the right. `points` are the
 * corners a polyline was clicked through (the wire tool), kept as the wire's own bends.
 */
export function connectWire(layout: Layout, from: Hit, to: Hit, kind: WireKind = "auto", points: readonly Point[] = []): { layout: Layout; wireId: string } | null {
  if (layout.wires.length >= MAX_WIRES || points.length > MAX_BENDS) return null;
  const routes = routesOf(layout);
  const first = attachEnd(layout, from, routes);
  if (!first) return null;
  let second = attachEnd(first.layout, to, routesOf(first.layout));
  if (!second) return null;
  if (sameEnd(first.end, second.end)) {
    if (from.kind !== "empty" || to.kind !== "empty") return null;
    second = attachEnd(first.layout, { kind: "empty", point: { x: from.point.x + 120, y: from.point.y } }, routes);
    if (!second) return null;
  }
  if (wireBetween(second.layout, first.end, second.end)) return null;
  const id = freeWireId(second.layout.wires.map((wire) => wire.id));
  const bends = tidyPoints(points.map(clampPoint));
  const wire: Wire = { id, from: first.end, to: second.end, ...(bends.length ? { points: bends } : {}), ...(kind !== "auto" ? { kind } : {}) };
  return { layout: { ...second.layout, wires: [...second.layout.wires, wire] }, wireId: id };
}

/** Consecutive duplicates dropped; the points themselves are kept as given, collinear or not (a corner may be laid on a line to be dragged later). */
const tidyPoints = (points: readonly Point[]): Point[] => points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y).map((point) => ({ x: point.x, y: point.y }));

/** The old end of a wire let go and a new one taken; a junction left alone disappears. */
export function moveWireEnd(layout: Layout, wireId: string, which: "from" | "to", hit: Hit): Layout | null {
  const wire = layout.wires.find((candidate) => candidate.id === wireId);
  if (!wire) return null;
  if (hit.kind === "wire" && hit.wireId === wireId) return null;
  const routes = routesOf(layout);
  const attached = attachEnd(layout, hit, routes);
  if (!attached) return null;
  const other = which === "from" ? wire.to : wire.from;
  if (sameEnd(attached.end, other)) return null;
  const moved: Wire = { ...wire, [which]: attached.end };
  const next = { ...attached.layout, wires: attached.layout.wires.map((candidate) => (candidate.id === wireId ? moved : candidate)) };
  const twin = next.wires.find((candidate) => candidate.id !== wireId && ((sameEnd(candidate.from, moved.from) && sameEnd(candidate.to, moved.to)) || (sameEnd(candidate.from, moved.to) && sameEnd(candidate.to, moved.from))));
  if (twin) return null;
  return dropOrphanJunctions(next);
}

export function moveJunction(layout: Layout, id: string, point: Point): Layout {
  const place = clampPoint(point);
  return { ...layout, junctions: layout.junctions.map((junction) => (junction.id === id ? { ...junction, ...place } : junction)) };
}

/** Whether a segment of a wire's route can be dragged: not the lead out of a terminal, which belongs to the terminal. */
export function segmentMovable(route: readonly Point[], index: number, fromSide: Side | null, toSide: Side | null) {
  if (fromSide && index === 0) return false;
  if (toSide && index === route.length - 2) return false;
  return true;
}

/**
 * Moves segment `index` of a wire so that it lies at `value` (a y for a horizontal segment, an x for a vertical one). The bends
 * become the wire's own; a segment next to a terminal's lead gets a new bend so the lead stays; a free end follows its segment.
 */
export function moveSegment(layout: Layout, wireId: string, route: readonly Point[], index: number, value: number): Layout {
  const wire = layout.wires.find((candidate) => candidate.id === wireId);
  if (!wire || index < 0 || index >= route.length - 1) return layout;
  const devices = devicesById(layout), junctions = junctionsById(layout);
  const fromSide = endPoint(wire.from, devices, junctions)?.side ?? null, toSide = endPoint(wire.to, devices, junctions)?.side ?? null;
  if (!segmentMovable(route, index, fromSide, toSide)) return layout;
  const horizontal = route[index].y === route[index + 1].y;
  const snapped = snap(value);
  const bends = bendsOfRoute(route, fromSide, toSide).map((point) => ({ ...point }));
  const base = fromSide ? 2 : 1;
  const last = route.length - 1;
  let next: Layout = layout;
  const prepend: Point[] = [], append: Point[] = [];
  for (const r of [index, index + 1]) {
    const k = r - base;
    if (k >= 0 && k < bends.length) { if (horizontal) bends[k].y = snapped; else bends[k].x = snapped; continue; }
    if (r === 0 && !fromSide && !isTerminalEnd(wire.from)) { next = moveJunction(next, wire.from.junction, horizontal ? { x: route[0].x, y: snapped } : { x: snapped, y: route[0].y }); continue; }
    if (r === last && !toSide && !isTerminalEnd(wire.to)) { next = moveJunction(next, wire.to.junction, horizontal ? { x: route[last].x, y: snapped } : { x: snapped, y: route[last].y }); continue; }
    // The end of a lead: a new bend beside it carries the moved segment.
    const lead = route[r];
    (r < base ? prepend : append).push(horizontal ? { x: lead.x, y: snapped } : { x: snapped, y: lead.y });
  }
  const points = [...prepend, ...bends, ...append];
  const updated: Wire = { ...wire, points };
  if (!points.length) delete updated.points;
  return { ...next, wires: next.wires.map((candidate) => (candidate.id === wireId ? updated : candidate)) };
}

export function removeWires(layout: Layout, ids: readonly string[]): Layout {
  return dropOrphanJunctions({ ...layout, wires: layout.wires.filter((wire) => !ids.includes(wire.id)) });
}

export function removeDevices(layout: Layout, ids: readonly string[]): Layout {
  return dropOrphanJunctions({ ...layout, devices: layout.devices.filter((device) => !ids.includes(device.id)), wires: layout.wires.filter((wire) => ![wire.from, wire.to].some((end) => isTerminalEnd(end) && ids.includes(end.device))) });
}

/** Straightens a wire: its own bends are dropped and it is routed again. */
export function straightenWire(layout: Layout, wireId: string): Layout {
  return { ...layout, wires: layout.wires.map((wire) => { if (wire.id !== wireId) return wire; const rest = { ...wire }; delete rest.points; return rest; }) };
}

export function setWireKind(layout: Layout, wireId: string, kind: WireKind): Layout {
  return { ...layout, wires: layout.wires.map((wire) => { if (wire.id !== wireId) return wire; const rest = { ...wire }; delete rest.kind; return kind === "auto" ? rest : { ...rest, kind }; }) };
}

/** The loose ends of a wire: junctions with no other wire. */
export const looseEnds = (layout: Layout, wire: Wire): ("from" | "to")[] => (["from", "to"] as const).filter((which) => { const end = wire[which]; return !isTerminalEnd(end) && wiresAtJunction(layout, end.junction).length === 1; });

// ---------- corners (ritverktyget, 2026-11-03): handles on every bend of a selected wire ----------

const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/**
 * The corners a hand can take on a wire: its own bends when it has them, else the route's inner points without the two
 * terminal leads (a lead that merged into a longer straight leg is a corner like any other).
 */
export function cornersOf(wire: Wire, route: readonly Point[], fromSide: Side | null, toSide: Side | null): Point[] {
  if (wire.points?.length) return wire.points.map((point) => ({ x: point.x, y: point.y }));
  const inner = route.slice(1, -1);
  if (!inner.length) return [];
  const first = fromSide && samePoint(inner[0], leadOf({ ...route[0], side: fromSide })) ? 1 : 0;
  const lastEnd = route[route.length - 1];
  const last = toSide && samePoint(inner[inner.length - 1], leadOf({ ...lastEnd, side: toSide })) ? inner.length - 1 : inner.length;
  return inner.slice(first, Math.max(first, last)).map((point) => ({ x: point.x, y: point.y }));
}

const sidesOf = (layout: Layout, wire: Wire) => {
  const devices = devicesById(layout), junctions = junctionsById(layout);
  const a = endPoint(wire.from, devices, junctions), b = endPoint(wire.to, devices, junctions);
  return { a, b, fromSide: a?.side ?? null, toSide: b?.side ?? null };
};
const withPoints = (layout: Layout, wire: Wire, points: Point[]): Layout => {
  const updated: Wire = { ...wire, points };
  if (!points.length) delete updated.points;
  return { ...layout, wires: layout.wires.map((candidate) => (candidate.id === wire.id ? updated : candidate)) };
};
/** The running length along a route where a point lies (its nearest place on the route). */
export function routePositionOf(route: readonly Point[], point: Point): number {
  let best = { distance: Infinity, at: 0 }, run = 0;
  for (const segment of segmentsOf(route)) {
    const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
    const near = nearestOnSegment(segment, point);
    if (near.distance < best.distance) best = { distance: near.distance, at: run + near.t * length };
    run += length;
  }
  return best.at;
}

/** A corner laid on a segment of a wire (double-click): it lies on the line until it is dragged. */
export function addCorner(layout: Layout, wireId: string, route: readonly Point[], segmentIndex: number, at: Point): Layout {
  const wire = layout.wires.find((candidate) => candidate.id === wireId);
  const segment = segmentsOf(route)[segmentIndex];
  if (!wire || !segment) return layout;
  const { fromSide, toSide } = sidesOf(layout, wire);
  const points = cornersOf(wire, route, fromSide, toSide);
  if (points.length >= MAX_BENDS) return layout;
  const near = nearestOnSegment(segment, at).point;
  const point = segment.horizontal ? { x: snap(near.x), y: segment.a.y } : { x: segment.a.x, y: snap(near.y) };
  const position = routePositionOf(route, point);
  let index = 0;
  while (index < points.length && routePositionOf(route, points[index]) < position) index += 1;
  points.splice(index, 0, point);
  return withPoints(layout, wire, points);
}

/**
 * A corner dragged to a new place. A real corner takes its two segments with it (a neighbour that shared its x or y
 * follows), so the route stays orthogonal; a corner lying on a straight run moves alone and makes a jog. A terminal lead
 * never moves. Afterwards the wire's bends are exactly the corners of the new shape: a corner dragged onto the line between
 * its neighbours is gone, and every elbow the move made is a handle of its own.
 */
export function moveCorner(layout: Layout, wireId: string, route: readonly Point[], index: number, to: Point): Layout {
  const wire = layout.wires.find((candidate) => candidate.id === wireId);
  if (!wire) return layout;
  const { a, b, fromSide, toSide } = sidesOf(layout, wire);
  if (!a || !b) return layout;
  const points = cornersOf(wire, route, fromSide, toSide);
  if (index < 0 || index >= points.length) return layout;
  const anchors: Point[] = [leadOf(a), ...points, leadOf(b)];
  const k = index + 1;
  const current = anchors[k], previous = anchors[k - 1], next = anchors[k + 1];
  // On the grid, unless it is nearly on a neighbour's line: then on that line, so a corner can be laid on one to remove it.
  const target = clampPoint(to);
  for (const magnet of [anchors[k - 1], anchors[k + 1], anchors[k - 2], anchors[k + 2]]) {
    if (!magnet) continue;
    if (Math.abs(to.x - magnet.x) <= SNAP / 2) target.x = magnet.x;
    if (Math.abs(to.y - magnet.y) <= SNAP / 2) target.y = magnet.y;
  }
  const onStraightRun = (previous.x === current.x && current.x === next.x) || (previous.y === current.y && current.y === next.y);
  if (!onStraightRun) {
    if (k - 1 > 0) { if (previous.y === current.y) previous.y = target.y; else if (previous.x === current.x) previous.x = target.x; }
    if (k + 1 < anchors.length - 1) { if (next.y === current.y) next.y = target.y; else if (next.x === current.x) next.x = target.x; }
  }
  current.x = target.x; current.y = target.y;
  const devices = devicesById(layout), junctions = junctionsById(layout);
  const shape = wireRoute({ ...wire, points: anchors.slice(1, -1) }, devices, junctions);
  if (!shape) return layout;
  const plain: Wire = { ...wire };
  delete plain.points;
  return withPoints(layout, wire, cornersOf(plain, shape, fromSide, toSide));
}

export function removeCorner(layout: Layout, wireId: string, route: readonly Point[], index: number): Layout {
  const wire = layout.wires.find((candidate) => candidate.id === wireId);
  if (!wire) return layout;
  const { fromSide, toSide } = sidesOf(layout, wire);
  const points = cornersOf(wire, route, fromSide, toSide);
  if (index < 0 || index >= points.length) return layout;
  points.splice(index, 1);
  return withPoints(layout, wire, points);
}

// ---------- selections of several things ----------

export type SelectionSet = { devices: readonly string[]; wires: readonly string[] };
export const EMPTY_SELECTION: SelectionSet = { devices: [], wires: [] };

/** The devices whose plates lie wholly inside a box (a marquee). */
export function devicesInBox(layout: Pick<Layout, "devices">, box: Box): string[] {
  return layout.devices.filter((device) => { const def = designedDef(device); return device.x >= box.x && device.y >= box.y && device.x + def.width <= box.x + box.width && device.y + def.height <= box.y + box.height; }).map((device) => device.id);
}
/** The wires whose whole route lies inside a box. */
export function wiresInBox(layout: Pick<Layout, "wires">, routes: Routes, box: Box): string[] {
  return layout.wires.filter((wire) => { const route = routes.get(wire.id); return route !== undefined && route.every((point) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height); }).map((wire) => wire.id);
}

/**
 * What moves with a selection: its devices; every junction whose wires all lead to moving things (so a branch inside the
 * selection keeps its shape); and the bends of the selected wires and of every wire between moving things.
 */
export function movingParts(layout: Layout, selection: SelectionSet): { junctions: Set<string>; wires: Set<string> } {
  const devices = new Set(selection.devices), selected = new Set(selection.wires), junctions = new Set<string>();
  const endMoves = (end: WireEnd) => (isTerminalEnd(end) ? devices.has(end.device) : junctions.has(end.junction));
  for (let changed = true; changed;) {
    changed = false;
    for (const junction of layout.junctions) {
      if (junctions.has(junction.id)) continue;
      const wires = wiresAtJunction(layout, junction.id);
      if (!wires.length) continue;
      const every = wires.every((wire) => { const other = !isTerminalEnd(wire.from) && wire.from.junction === junction.id ? wire.to : wire.from; return selected.has(wire.id) || endMoves(other) || (!isTerminalEnd(other) && other.junction === junction.id); });
      if (every) { junctions.add(junction.id); changed = true; }
    }
  }
  const wires = new Set(selection.wires);
  for (const wire of layout.wires) if (endMoves(wire.from) && endMoves(wire.to)) wires.add(wire.id);
  return { junctions, wires };
}

const placed = (device: DeviceInst, x: number, y: number): DeviceInst => ({ ...device, x: Math.round(x), y: Math.round(y) });

/** The selection moved by a step: devices, the junctions and bends that belong to it. The surface has no edge. */
export function translateSelection(layout: Layout, selection: SelectionSet, dx: number, dy: number): Layout {
  if (!dx && !dy) return layout;
  const parts = movingParts(layout, selection);
  const devices = new Set(selection.devices);
  return {
    ...layout,
    devices: layout.devices.map((device) => (devices.has(device.id) ? placed(device, device.x + dx, device.y + dy) : device)),
    junctions: layout.junctions.map((junction) => (parts.junctions.has(junction.id) ? { ...junction, x: junction.x + dx, y: junction.y + dy } : junction)),
    wires: layout.wires.map((wire) => (parts.wires.has(wire.id) && wire.points?.length ? { ...wire, points: wire.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) } : wire)),
  };
}

export function removeSelection(layout: Layout, selection: SelectionSet): Layout {
  return removeWires(removeDevices(layout, selection.devices), selection.wires);
}

/** The box around a selection's devices and wire routes, or null when it holds nothing drawn. */
export function selectionBounds(layout: Layout, selection: SelectionSet, routes: Routes): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const take = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const device of layout.devices) if (selection.devices.includes(device.id)) { const def = designedDef(device); take(device.x, device.y); take(device.x + def.width, device.y + def.height); }
  for (const id of selection.wires) for (const point of routes.get(id) ?? []) take(point.x, point.y);
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

// ---------- copies: Ctrl+D, Ctrl+C / Ctrl+V ----------

/** What a selection holds for a copy: its devices, the junctions that move with it, and the wires wholly inside it. */
export type Clip = { devices: DeviceInst[]; wires: Wire[]; junctions: Junction[] };

export function clipOf(layout: Layout, selection: SelectionSet): Clip {
  const parts = movingParts(layout, selection);
  const devices = new Set(selection.devices);
  const inside = (end: WireEnd) => (isTerminalEnd(end) ? devices.has(end.device) : parts.junctions.has(end.junction));
  return {
    devices: layout.devices.filter((device) => devices.has(device.id)).map((device) => ({ ...device, options: { ...device.options } })),
    junctions: layout.junctions.filter((junction) => parts.junctions.has(junction.id)).map((junction) => ({ ...junction })),
    // A wire between copied things comes along; a wire the person selected comes along even when its other end is the PLC.
    wires: layout.wires.filter((wire) => [wire.from, wire.to].every((end) => inside(end) || (selection.wires.includes(wire.id) && isTerminalEnd(end) && end.device === PLC_DEVICE_ID))).map((wire) => ({ ...wire, ...(wire.points ? { points: wire.points.map((point) => ({ ...point })) } : {}) })),
  };
}

/** "Start" copied becomes "Start 2", "Start 3" …; a plain default label gets the next number of its kind. */
export function copyLabel(label: string, kind: DeviceInst["kind"], devices: readonly DeviceInst[]): string {
  const taken = new Set(devices.map((device) => device.label));
  const kindLabel = DEVICE_DEFS[kind].label;
  if (!label.trim() || label === kindLabel || (label.startsWith(`${kindLabel} `) && /^.+ \d+$/.test(label))) return defaultLabel(kind, devices);
  const stem = label.replace(/ \d+$/, "");
  for (let index = 2; ; index += 1) { const candidate = `${stem} ${index}`.slice(0, MAX_LABEL); if (!taken.has(candidate)) return candidate; }
}

/**
 * A clip laid into the drawing, moved by an offset, with free ids and labels. Null when the drawing would hold too much.
 * Returns the new devices' and wires' ids, so they can be selected.
 */
export function insertClip(layout: Layout, clip: Clip, offset: Point): { layout: Layout; devices: string[]; wires: string[] } | null {
  if (!clip.devices.length && !clip.wires.length) return null;
  if (layout.devices.length + clip.devices.length > MAX_DEVICES || layout.wires.length + clip.wires.length > MAX_WIRES || layout.junctions.length + clip.junctions.length > MAX_JUNCTIONS) return null;
  const deviceIds = new Map<string, string>(), junctionIds = new Map<string, string>();
  let devices = [...layout.devices];
  // Laid where it is free: a copy never lands on what is already there.
  const free = freeOffset(clip.devices, layout.devices, offset.x, offset.y);
  for (const device of clip.devices) {
    const id = freeDeviceId(device.kind, devices.map((candidate) => candidate.id));
    deviceIds.set(device.id, id);
    devices = [...devices, placed({ ...device, id, label: copyLabel(device.label, device.kind, devices), options: { ...device.options } }, device.x + free.dx, device.y + free.dy)];
  }
  let junctions = [...layout.junctions];
  for (const junction of clip.junctions) {
    const id = freeJunctionId(junctions.map((candidate) => candidate.id));
    junctionIds.set(junction.id, id);
    junctions = [...junctions, { id, ...clampPoint({ x: junction.x + free.dx, y: junction.y + free.dy }) }];
  }
  const mapEnd = (end: WireEnd): WireEnd | null => (isTerminalEnd(end) ? (deviceIds.has(end.device) ? { device: deviceIds.get(end.device)!, terminal: end.terminal } : end.device === PLC_DEVICE_ID ? end : null) : junctionIds.has(end.junction) ? { junction: junctionIds.get(end.junction)! } : null);
  let wires = [...layout.wires];
  const newWires: string[] = [];
  for (const wire of clip.wires) {
    const from = mapEnd(wire.from), to = mapEnd(wire.to);
    if (!from || !to || sameEnd(from, to)) continue;
    const id = freeWireId(wires.map((candidate) => candidate.id));
    const copy: Wire = { id, from, to, ...(wire.points?.length ? { points: wire.points.map((point) => clampPoint({ x: point.x + free.dx, y: point.y + free.dy })) } : {}), ...(wire.kind ? { kind: wire.kind } : {}) };
    wires = [...wires, copy];
    newWires.push(id);
  }
  return { layout: { ...layout, devices, junctions, wires }, devices: [...deviceIds.values()], wires: newWires };
}

/** Ctrl+D: the selection copied a step down and to the right. */
export function duplicateSelection(layout: Layout, selection: SelectionSet, offset: Point = { x: 24, y: 24 }) {
  return insertClip(layout, clipOf(layout, selection), offset);
}
