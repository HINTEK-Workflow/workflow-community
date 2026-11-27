import { designedDef } from "./device-designs";
import { type Box, endPoint, type EndPoint, GRID, junctionsById, labelBox, LEAD, readoutBox, PLC_BOX, tidyRoute, wireRoute } from "./geometry";
import { type DeviceInst, endKey, type Layout, type Point, type Wire } from "./layout";
import { devicesById } from "./wiring";

// PLC-simulatorn (ritverktyget, 2026-11-03: "Gör själva ritverktyget bättre"): the wire router. A wire without
// its own bends is routed orthogonally on a coarse grid (GRID = 8 px) around every device plate and the PLC, with a margin, by
// A* with a cost for every bend, a high cost for passing over a plate (so a wire never crosses one when there is any way round)
// and a small cost for running in a cell another wire already uses in the same direction, which spaces parallel wires one
// grid step apart instead of laying them on top of each other. The grid is a Hanan grid: the 8 px lines plus the two lead
// points' own x and y, so a wire leaves its terminal straight and never jogs to reach the grid. Deterministic: the same
// drawing gives the same routes. A wire with its own bends (`points`) keeps its shape and is only stretched at a moved end
// (`wireRoute` in geometry.ts). Routes are cached per wire: when a device moves, only the wires whose ends or whose
// surroundings changed are routed again, so a drawing with 60 devices and 150 wires stays smooth under the pointer.

/** How far a route keeps from a device's plate when it can. Less than LEAD, so the lead point is always outside the margin. */
export const ROUTE_MARGIN = 14;
/** Beside the PLC a wire may pass closer than beside a device. */
const PLC_MARGIN_X = 10;
const DIRS = 3;
/** The surface has no edge (2026-11-04), so the routable area is the box around what is drawn, with air. */
const AREA_PAD = 240;
/** Above this many cells the drawing is spread too far for the maps: a wire then goes the plain way, without a search. */
const MAX_AREA_CELLS = 1_500_000;
/** The most grid points one search may hold. */
const MAX_SEARCH_CELLS = 400_000;
/**
 * Costs, in pixels of wire: a bend; a cell over a plate (never, when there is any way round); a cell in the band between a
 * plate's terminals and their leads (only when two plates stand that close); a cell in a plate's side margin (only through a
 * narrow gap); a cell another wire runs through the same way; a cell it crosses.
 */
const TURN = 24, OVER_PLATE = 800, LEAD_BAND = 120, NEAR_PLATE = 40, SHARED = 20, CROSSED = 3;
const NONE = 0, HORIZONTAL = 1, VERTICAL = 2;
const NEAR = 1, BAND = 2, PLATE = 3;
const CELL_COST = [0, NEAR_PLATE, LEAD_BAND, OVER_PLATE];

export type Obstacle = Box & { id: string };
/** The three zones round a plate: the plate itself, the band up to its leads, and the margin beside it. */
export type Zone = { id: string; plate: Box; band: Box; near: Box };
/** The grid the maps are drawn over: its corner and size, in cells. */
export type Area = { x0: number; y0: number; cols: number; rows: number };

/** The area for these zones and points, or null when it would be too large to hold. */
export function areaOf(zones: readonly Zone[], points: readonly Point[] = []): Area | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const take = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const zone of zones) { take(zone.near.x, zone.near.y); take(zone.near.x + zone.near.width, zone.near.y + zone.near.height); }
  for (const point of points) take(point.x, point.y);
  const x0 = Math.floor((minX - AREA_PAD) / GRID) * GRID, y0 = Math.floor((minY - AREA_PAD) / GRID) * GRID;
  const cols = Math.ceil((maxX + AREA_PAD - x0) / GRID) + 1, rows = Math.ceil((maxY + AREA_PAD - y0) / GRID) + 1;
  return cols * rows > MAX_AREA_CELLS ? null : { x0, y0, cols, rows };
}

/** The plates as drawn, without margin: the PLC's housing and every device's plate. */
export function platesOf(devices: Iterable<DeviceInst>): Obstacle[] {
  const out: Obstacle[] = [{ id: "plc", x: PLC_BOX.x, y: PLC_BOX.y - 8, width: PLC_BOX.width, height: PLC_BOX.height + 16 }];
  for (const device of devices) { const def = designedDef(device); out.push({ id: device.id, x: device.x, y: device.y, width: def.width, height: def.height }); }
  return out;
}

const grow = (box: Box, dx: number, dy: number): Box => ({ x: box.x - dx, y: box.y - dy, width: box.width + 2 * dx, height: box.height + 2 * dy });

/** The zones of every plate: terminals sit on the top and bottom edges, so the band above and below reaches almost to the leads. */
export function zonesOf(devices: Iterable<DeviceInst>): Zone[] {
  const out: Zone[] = [];
  const plc: Box = { x: PLC_BOX.x, y: PLC_BOX.y, width: PLC_BOX.width, height: PLC_BOX.height };
  out.push({ id: "plc", plate: grow(plc, 2, 2), band: grow(plc, 2, LEAD - 2), near: grow(plc, PLC_MARGIN_X, LEAD - 2) });
  for (const device of devices) {
    const def = designedDef(device);
    const plate: Box = { x: device.x, y: device.y, width: def.width, height: def.height };
    out.push({ id: device.id, plate: grow(plate, 2, 2), band: grow(plate, 2, LEAD - 2), near: grow(plate, ROUTE_MARGIN, LEAD - 2) });
    // The name under or over the plate is routed around as a plate is, so no wire runs across its text.
    if (device.label) { const label = labelBox(device); out.push({ id: `${device.id}:label`, plate: label, band: label, near: label }); }
    // The value tag too (2026-11-07): no wire runs across its digits.
    const tag = readoutBox(device);
    if (tag) out.push({ id: `${device.id}:readout`, plate: tag, band: tag, near: tag });
  }
  return out;
}

/** The outermost zone of every plate, with its id: what a cached route's surroundings are compared by. */
export const obstaclesOf = (devices: Iterable<DeviceInst>): Obstacle[] => zonesOf(devices).map((zone) => ({ id: zone.id, ...zone.near }));

export const boxesOverlap = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
export const pointInBox = (p: Point, box: Box) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
const baseCol = (area: Area, x: number) => Math.min(area.cols - 1, Math.max(0, Math.round((x - area.x0) / GRID)));
const baseRow = (area: Area, y: number) => Math.min(area.rows - 1, Math.max(0, Math.round((y - area.y0) / GRID)));

/** A map over the base grid: how dear every cell is to run a wire through, by the zone it lies in (the dearest wins). */
export function blockedMap(zones: readonly Zone[], area: Area): Uint8Array {
  const blocked = new Uint8Array(area.cols * area.rows);
  const paint = (box: Box, level: number) => {
    const c0 = Math.max(0, Math.ceil((box.x - area.x0) / GRID)), c1 = Math.min(area.cols - 1, Math.floor((box.x + box.width - area.x0) / GRID));
    const r0 = Math.max(0, Math.ceil((box.y - area.y0) / GRID)), r1 = Math.min(area.rows - 1, Math.floor((box.y + box.height - area.y0) / GRID));
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) if (blocked[r * area.cols + c] < level) blocked[r * area.cols + c] = level;
  };
  for (const zone of zones) paint(zone.near, NEAR);
  for (const zone of zones) paint(zone.band, BAND);
  for (const zone of zones) paint(zone.plate, PLATE);
  return blocked;
}

/**
 * Which base cells other wires run through, horizontally and vertically, and whose wires they are (by their two ends), so a
 * new wire keeps a lane of its own but may share the approach to a terminal with the other wires that go to it.
 */
export class Occupancy {
  /** Per cell and direction: 0 free, 1 one wire (its two ends in the owner arrays), 2 wires with different ends. */
  readonly horizontal: Uint8Array;
  readonly vertical: Uint8Array;
  private readonly ownerH: Int32Array;
  private readonly ownerV: Int32Array;
  private readonly ids = new Map<string, number>();
  constructor(readonly area: Area) {
    const cells = area.cols * area.rows;
    this.horizontal = new Uint8Array(cells); this.vertical = new Uint8Array(cells);
    this.ownerH = new Int32Array(cells * 2); this.ownerV = new Int32Array(cells * 2);
  }
  /** A small integer for an end key, the same for the same key. */
  idOf(key: string) { let id = this.ids.get(key); if (id === undefined) { id = this.ids.size + 1; this.ids.set(key, id); } return id; }
  add(route: readonly Point[], ends: readonly [string, string] = ["", ""]) {
    const a0 = this.idOf(ends[0]), b0 = this.idOf(ends[1]);
    const mark = (state: Uint8Array, owner: Int32Array, cell: number) => {
      if (state[cell] === 0) { state[cell] = 1; owner[cell * 2] = a0; owner[cell * 2 + 1] = b0; }
      else if (state[cell] === 1 && !(owner[cell * 2] === a0 || owner[cell * 2] === b0 || owner[cell * 2 + 1] === a0 || owner[cell * 2 + 1] === b0)) state[cell] = 2;
    };
    for (let index = 1; index < route.length; index += 1) {
      const a = route[index - 1], b = route[index];
      const { area, area: { cols } } = this;
      if (a.y === b.y) { const r = baseRow(area, a.y); for (let c = baseCol(area, Math.min(a.x, b.x)); c <= baseCol(area, Math.max(a.x, b.x)); c += 1) mark(this.horizontal, this.ownerH, r * cols + c); }
      else if (a.x === b.x) { const c = baseCol(area, a.x); for (let r = baseRow(area, Math.min(a.y, b.y)); r <= baseRow(area, Math.max(a.y, b.y)); r += 1) mark(this.vertical, this.ownerV, r * cols + c); }
    }
  }
  /** Whether a cell holds a wire that shares neither end with the one asking (given as end ids from `idOf`). */
  foreign(horizontal: boolean, cell: number, a: number, b: number) {
    const state = horizontal ? this.horizontal[cell] : this.vertical[cell];
    if (state === 0) return false;
    if (state === 2) return true;
    const owner = horizontal ? this.ownerH : this.ownerV;
    const x = owner[cell * 2], y = owner[cell * 2 + 1];
    return x !== a && x !== b && y !== a && y !== b;
  }
}

const leadOf = (end: EndPoint): Point => (end.side === "top" ? { x: end.x, y: end.y - LEAD } : end.side === "bottom" ? { x: end.x, y: end.y + LEAD } : { x: end.x, y: end.y });

/** A small binary heap of state ids ordered by f, then by insertion, so ties always break the same way. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  private seq: number[] = [];
  private counter = 0;
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    this.ids.push(id); this.keys.push(key); this.seq.push(this.counter++);
    let i = this.ids.length - 1;
    while (i > 0) { const parent = (i - 1) >> 1; if (this.less(i, parent)) { this.swap(i, parent); i = parent; } else break; }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!, lastKey = this.keys.pop()!, lastSeq = this.seq.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId; this.keys[0] = lastKey; this.seq[0] = lastSeq;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1, right = left + 1;
        let best = i;
        if (left < this.ids.length && this.less(left, best)) best = left;
        if (right < this.ids.length && this.less(right, best)) best = right;
        if (best === i) break;
        this.swap(i, best); i = best;
      }
    }
    return top;
  }
  private less(a: number, b: number) { return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.seq[a] < this.seq[b]); }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]]; [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]]; [this.seq[a], this.seq[b]] = [this.seq[b], this.seq[a]];
  }
}

type Cached = { key: string; around: string; route: Point[]; box: Box };

const sortedUnique = (values: number[]) => { const out = [...new Set(values)].sort((a, b) => a - b); return out; };
const routeBox = (route: readonly Point[]): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of route) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { x: minX - 2 * GRID, y: minY - 2 * GRID, width: maxX - minX + 4 * GRID, height: maxY - minY + 4 * GRID };
};
const aroundKey = (box: Box, obstacles: readonly Obstacle[]) => { let key = ""; for (const o of obstacles) if (boxesOverlap(box, o)) key += `${o.id}@${o.x},${o.y};`; return key; };

/**
 * The router with its cache. One per surface (the module's default serves the pure helpers); a test makes its own, so a
 * route never depends on what another test drew.
 */
export class WireRouter {
  private readonly cache = new Map<string, Cached>();
  private g = new Float64Array(0);
  private from = new Int32Array(0);
  private stamp = new Uint32Array(0);
  private closed = new Uint8Array(0);
  private generation = 0;
  private blockedFor: { key: string; area: Area | null; map: Uint8Array } | null = null;
  /** How many wires were routed by the search (not served from the cache) since the counter was last read. */
  routedCount = 0;

  /**
   * Every wire's route: cached when its ends and surroundings are unchanged, searched when not, bends kept as they are.
   * `quick` (while a device is being dragged) routes again only the wires whose ends moved; the wires the moving device
   * passes over keep their routes until it is let go.
   */
  routesOf(layout: Layout, options: { quick?: boolean } = {}): Map<string, Point[]> {
    const devices = devicesById(layout), junctions = junctionsById(layout);
    const zones = zonesOf(layout.devices);
    const obstacles: Obstacle[] = zones.map((zone) => ({ id: zone.id, ...zone.near }));
    const ends: Point[] = [];
    for (const wire of layout.wires) for (const end of [wire.from, wire.to]) { const place = endPoint(end, devices, junctions); if (place) ends.push(place); }
    for (const wire of layout.wires) for (const point of wire.points ?? []) ends.push(point);
    const area = areaOf(zones, ends);
    const blocked = this.blocked(zones, area);
    const routes = new Map<string, Point[]>();
    const seen = new Set<string>();
    // Wires with their own bends first: they do not move for anyone, and the others keep out of their way.
    const pending: { wire: Wire; a: EndPoint; b: EndPoint; ends: [string, string] }[] = [];
    const occupancy = area ? new Occupancy(area) : null;
    for (const wire of layout.wires) {
      const a = endPoint(wire.from, devices, junctions), b = endPoint(wire.to, devices, junctions);
      if (!a || !b) continue;
      seen.add(wire.id);
      const wireEnds: [string, string] = [endKey(wire.from), endKey(wire.to)];
      if (wire.points?.length) { const route = wireRoute(wire, devices, junctions); if (route) { routes.set(wire.id, route); occupancy?.add(route, wireEnds); } }
      else pending.push({ wire, a, b, ends: wireEnds });
    }
    // Then the auto-routed ones in order; a cached route stands when nothing around it changed.
    const fresh: typeof pending = [];
    for (const item of pending) {
      const key = `${item.a.x},${item.a.y},${item.a.side ?? "-"}|${item.b.x},${item.b.y},${item.b.side ?? "-"}`;
      const cached = this.cache.get(item.wire.id);
      if (cached && cached.key === key && (options.quick || cached.around === aroundKey(cached.box, obstacles))) { routes.set(item.wire.id, cached.route); occupancy?.add(cached.route, item.ends); }
      else fresh.push(item);
    }
    for (const item of fresh) {
      const route = this.route(item.a, item.b, blocked, occupancy, item.ends, area);
      routes.set(item.wire.id, route);
      occupancy?.add(route, item.ends);
      const box = routeBox(route);
      // A quick route is not remembered as settled: the next full pass looks at its surroundings again.
      this.cache.set(item.wire.id, { key: `${item.a.x},${item.a.y},${item.a.side ?? "-"}|${item.b.x},${item.b.y},${item.b.side ?? "-"}`, around: options.quick ? "?" : aroundKey(box, obstacles), route, box });
      this.routedCount += 1;
    }
    for (const id of [...this.cache.keys()]) if (!seen.has(id)) this.cache.delete(id);
    return routes;
  }

  forget() { this.cache.clear(); this.blockedFor = null; }

  /** The route a wire would take between two ends right now (the rubber band while drawing): round the plates, nothing cached. */
  preview(layout: Pick<Layout, "devices">, a: EndPoint, b: EndPoint): Point[] {
    const zones = zonesOf(layout.devices);
    const area = areaOf(zones, [a, b]);
    return this.route(a, b, this.blocked(zones, area), null, ["", ""], area);
  }

  private blocked(zones: readonly Zone[], area: Area | null) {
    const key = `${area ? `${area.x0},${area.y0},${area.cols},${area.rows}` : "-"}/${zones.map((zone) => `${zone.plate.x},${zone.plate.y},${zone.plate.width},${zone.plate.height}`).join("|")}`;
    if (this.blockedFor?.key !== key) this.blockedFor = { key, area, map: area ? blockedMap(zones, area) : new Uint8Array(0) };
    return this.blockedFor.map;
  }

  /** One wire's route from end to end: terminal, lead, the searched path, lead, terminal. */
  route(a: EndPoint, b: EndPoint, blocked: Uint8Array, occupancy: Occupancy | null, ends: readonly [string, string] = ["", ""], area: Area | null = null): Point[] {
    const start: Point = { x: a.x, y: a.y }, end: Point = { x: b.x, y: b.y };
    const la = leadOf(a), lb = leadOf(b);
    // First within a frame round the two ends, which is where nearly every wire fits; the whole area only when the frame's
    // best way runs over a plate, so the search stays small in a busy drawing.
    const pad = 240;
    const frame: Box = { x: Math.min(la.x, lb.x) - pad, y: Math.min(la.y, lb.y) - pad, width: Math.abs(la.x - lb.x) + 2 * pad, height: Math.abs(la.y - lb.y) + 2 * pad };
    // Spread too far for the maps, or a wire too long for a search: the plain way.
    const near = area ? this.search(la, lb, blocked, occupancy, ends, a.side, b.side, frame, area) : null;
    const inner = near && near.cost < OVER_PLATE ? near.path : (area ? this.search(la, lb, blocked, occupancy, ends, a.side, b.side, null, area) : null)?.path ?? near?.path ?? [la, { x: lb.x, y: la.y }, lb];
    return tidyRoute([start, ...inner, end]);
  }

  /** The search's arrays, grown when a search needs more; a typical drawing never does after its first wires. */
  private fit(states: number) {
    if (this.g.length >= states) return;
    const size = Math.max(states, this.g.length * 2, 60_000);
    this.g = new Float64Array(size); this.from = new Int32Array(size); this.stamp = new Uint32Array(size); this.closed = new Uint8Array(size);
    this.generation = 0;
  }

  private search(from: Point, to: Point, blocked: Uint8Array, occupancy: Occupancy | null, ends: readonly [string, string], fromSide: EndPoint["side"], toSide: EndPoint["side"], frame: Box | null, area: Area): { path: Point[]; cost: number } | null {
    if (from.x === to.x && from.y === to.y) return { path: [from], cost: 0 };
    // The way back from a lead to its terminal is never taken: a top terminal's wire first goes up or sideways, never down.
    const backFromStart = fromSide === "top" ? 1 : fromSide === "bottom" ? -1 : 0;
    const backIntoEnd = toSide === "top" ? -1 : toSide === "bottom" ? 1 : 0;
    const endA = occupancy ? occupancy.idOf(ends[0]) : 0, endB = occupancy ? occupancy.idOf(ends[1]) : 0;
    const X0 = area.x0, X1 = area.x0 + (area.cols - 1) * GRID, Y0 = area.y0, Y1 = area.y0 + (area.rows - 1) * GRID;
    const wx0 = frame ? Math.max(X0, Math.floor(frame.x / GRID) * GRID) : X0, wx1 = frame ? Math.min(X1, Math.ceil((frame.x + frame.width) / GRID) * GRID) : X1;
    const wy0 = frame ? Math.max(Y0, Math.floor(frame.y / GRID) * GRID) : Y0, wy1 = frame ? Math.min(Y1, Math.ceil((frame.y + frame.height) / GRID) * GRID) : Y1;
    if (((wx1 - wx0) / GRID + 3) * ((wy1 - wy0) / GRID + 3) > MAX_SEARCH_CELLS) return null;
    const cols: number[] = [], rows: number[] = [];
    for (let x = wx0; x <= wx1; x += GRID) cols.push(x);
    for (let y = wy0; y <= wy1; y += GRID) rows.push(y);
    const clampX = (x: number) => Math.min(wx1, Math.max(wx0, x)), clampY = (y: number) => Math.min(wy1, Math.max(wy0, y));
    const xs = sortedUnique([...cols, clampX(from.x), clampX(to.x)]), ys = sortedUnique([...rows, clampY(from.y), clampY(to.y)]);
    const C = xs.length, R = ys.length;
    const colOf = new Map(xs.map((x, index) => [x, index])), rowOf = new Map(ys.map((y, index) => [y, index]));
    const sc = colOf.get(clampX(from.x))!, sr = rowOf.get(clampY(from.y))!, ec = colOf.get(clampX(to.x))!, er = rowOf.get(clampY(to.y))!;
    const stateOf = (c: number, r: number, d: number) => (r * C + c) * DIRS + d;
    this.fit(C * R * DIRS);
    this.generation += 1;
    const gen = this.generation;
    const { g, from: cameFrom, stamp, closed } = this;
    const heap = new Heap();
    const h = (c: number, r: number) => Math.abs(xs[c] - xs[ec]) + Math.abs(ys[r] - ys[er]) + (c !== ec && r !== er ? TURN : 0);
    const open = (id: number, cost: number, prev: number, c: number, r: number) => {
      if (stamp[id] === gen && g[id] <= cost) return;
      stamp[id] = gen; g[id] = cost; cameFrom[id] = prev; closed[id] = 0;
      heap.push(id, cost + h(c, r));
    };
    const startId = stateOf(sc, sr, NONE);
    open(startId, 0, -1, sc, sr);
    let found = -1;
    const cellCost = (c: number, r: number, dir: number) => {
      if ((c === sc && r === sr) || (c === ec && r === er)) return 0;
      const cell = baseRow(area, ys[r]) * area.cols + baseCol(area, xs[c]);
      let cost = CELL_COST[blocked[cell]];
      if (occupancy) {
        if (occupancy.foreign(dir === HORIZONTAL, cell, endA, endB)) cost += SHARED;
        if (occupancy.foreign(dir !== HORIZONTAL, cell, endA, endB)) cost += CROSSED;
      }
      return cost;
    };
    while (heap.size) {
      const id = heap.pop();
      if (closed[id] && stamp[id] === gen) continue;
      closed[id] = 1;
      const d = id % DIRS, cell = (id - d) / DIRS, c = cell % C, r = (cell - c) / C;
      if (c === ec && r === er) { found = id; break; }
      const cost = g[id];
      const atStart = c === sc && r === sr;
      // Never the step from the start lead back toward its terminal, never the step into the end lead from its terminal's side.
      const mayStep = (nc: number, nr: number, dy: number) => !(atStart && backFromStart !== 0 && dy === backFromStart) && !(nc === ec && nr === er && backIntoEnd !== 0 && dy === backIntoEnd);
      // Right, left, down, up: the same order every time.
      if (c + 1 < C && mayStep(c + 1, r, 0)) { const step = xs[c + 1] - xs[c]; open(stateOf(c + 1, r, HORIZONTAL), cost + step + (d !== NONE && d !== HORIZONTAL ? TURN : 0) + cellCost(c + 1, r, HORIZONTAL), id, c + 1, r); }
      if (c > 0 && mayStep(c - 1, r, 0)) { const step = xs[c] - xs[c - 1]; open(stateOf(c - 1, r, HORIZONTAL), cost + step + (d !== NONE && d !== HORIZONTAL ? TURN : 0) + cellCost(c - 1, r, HORIZONTAL), id, c - 1, r); }
      if (r + 1 < R && mayStep(c, r + 1, 1)) { const step = ys[r + 1] - ys[r]; open(stateOf(c, r + 1, VERTICAL), cost + step + (d !== NONE && d !== VERTICAL ? TURN : 0) + cellCost(c, r + 1, VERTICAL), id, c, r + 1); }
      if (r > 0 && mayStep(c, r - 1, -1)) { const step = ys[r] - ys[r - 1]; open(stateOf(c, r - 1, VERTICAL), cost + step + (d !== NONE && d !== VERTICAL ? TURN : 0) + cellCost(c, r - 1, VERTICAL), id, c, r - 1); }
    }
    if (found < 0) return null;
    const path: Point[] = [];
    for (let id = found; id >= 0; id = cameFrom[id]) { const d = id % DIRS, cell = (id - d) / DIRS, c = cell % C, r = (cell - c) / C; path.push({ x: xs[c], y: ys[r] }); }
    path.reverse();
    // The clamp to the routable area is undone at the ends, so the route still starts and ends exactly at the leads.
    path[0] = from; path[path.length - 1] = to;
    return { path: tidyRoute(path), cost: g[found] };
  }
}

const defaultRouter = new WireRouter();
/** Every wire's route with the shared router. */
export const routeAll = (layout: Layout, options: { quick?: boolean } = {}) => defaultRouter.routesOf(layout, options);
export const forgetRoutes = () => defaultRouter.forget();
export const previewRoute = (layout: Pick<Layout, "devices">, a: EndPoint, b: EndPoint) => defaultRouter.preview(layout, a, b);

/** Whether a route runs over any of the boxes (a plate), apart from its first and last leg, which belong to a terminal on one. */
export function routeCrossesBox(route: readonly Point[], boxes: readonly Box[], skipEnds = true): boolean {
  const first = skipEnds ? 1 : 0, last = skipEnds ? route.length - 2 : route.length - 1;
  for (let index = first; index < last; index += 1) {
    const a = route[index], b = route[index + 1];
    const seg: Box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
    for (const box of boxes) if (seg.x < box.x + box.width && seg.x + seg.width > box.x && seg.y < box.y + box.height && seg.y + seg.height > box.y) return true;
  }
  return false;
}
