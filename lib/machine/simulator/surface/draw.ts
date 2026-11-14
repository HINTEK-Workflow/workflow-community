import { type Box, LEAD, type Side } from "./geometry";
import { endKey, type Point, type Wire } from "./layout";

// PLC-simulatorn (ritverktyget, 2026-11-03): how a routed wire is drawn. Two styles (owner: "roligare när
// sträcken var mer fria och inte så strickta"): *Mjuka* draws the orthogonal route as a flexible cable – long gentle curves
// through the route's corners, a Z becomes one S – and *Raka* draws it as straight runs with small rounded corners. Both keep
// the same waypoints, so the handles, the routing round the plates and the crossings are the same. A curve is checked
// against every plate and tightened until it clears them, so a soft wire never runs over a device. Where two wires of
// different nets cross, the one drawn later gets a small semicircular hop (owner: "en liten båge på korsade linjer"), so a
// crossing never reads as a connection; a junction dot is drawn only where three or more wires really meet. Everything here
// is pure and works on points, so it is tested without a browser.

export type WireStyle = "soft" | "straight";
export const WIRE_STYLES: readonly WireStyle[] = ["soft", "straight"];
export const WIRE_STYLE_LABELS: Record<WireStyle, string> = { soft: "Mjuka", straight: "Raka" };

/** A wire as drawn: a flattened polyline, the route segment every piece belongs to, and the running length at every point. */
export type Drawn = { points: Point[]; segmentOf: number[]; cumulative: number[] };

/** How far before and after a corner the curve departs from the straight run, per style. */
const REACH: Record<WireStyle, number> = { soft: 80, straight: 6 };
/** Below this reach a corner is never merged with its neighbour into one S. */
const MERGE_MIN = 12;
const PIECE = 6;

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const unit = (a: Point, b: Point): Point => { const d = dist(a, b) || 1; return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }; };
const along = (p: Point, u: Point, s: number): Point => ({ x: p.x + u.x * s, y: p.y + u.y * s });
const quadratic = (p0: Point, p1: Point, p2: Point, t: number): Point => { const m = 1 - t; return { x: m * m * p0.x + 2 * m * t * p1.x + t * t * p2.x, y: m * m * p0.y + 2 * m * t * p1.y + t * t * p2.y }; };
const cubic = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => { const m = 1 - t; return { x: m * m * m * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * p3.x, y: m * m * m * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * p3.y }; };

function finish(points: Point[], segmentOf: number[]): Drawn {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) cumulative.push(cumulative[index - 1] + dist(points[index - 1], points[index]));
  return { points, segmentOf, cumulative };
}

/** Whether a straight piece touches a box grown by `pad`. */
function pieceHitsBox(a: Point, b: Point, box: Box, pad: number): boolean {
  const x0 = box.x - pad, y0 = box.y - pad, x1 = box.x + box.width + pad, y1 = box.y + box.height + pad;
  // Liang–Barsky clipping of the piece against the box.
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number) => { if (p === 0) return q >= 0; const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
  return clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y);
}

/**
 * The polyline a wire is drawn as, in a style. `plates` are the device plates and the PLC housing without margin: a soft
 * curve that would run over one is pulled in until it does not. The first and last leg of a terminal wire stay straight
 * for the lead's length, so a wire always leaves its terminal squarely.
 */
export function drawRoute(route: readonly Point[], style: WireStyle, fromSide: Side | null, toSide: Side | null, plates: readonly Box[] = []): Drawn {
  const n = route.length;
  if (n < 3) return finish(route.map((p) => ({ ...p })), route.length > 1 ? [0] : []);
  const corners = n - 2;
  const reach = new Array<number>(n).fill(REACH[style]);
  // Only the plates a curve could reach: the route's box, grown by the furthest a soft corner swings.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of route) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  const swing = REACH.soft;
  const near = style === "soft" ? plates.filter((plate) => plate.x < maxX + swing && plate.x + plate.width > minX - swing && plate.y < maxY + swing && plate.y + plate.height > minY - swing) : [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const drawn = build(route, reach, fromSide, toSide, style === "soft");
    if (style !== "soft" || !near.length) return drawn;
    // Which corners' curves run over a plate? Pull those in and try again; straight leads are never the culprit.
    let culprit = false;
    for (let piece = 0; piece < drawn.points.length - 1; piece += 1) {
      const corner = drawn.cornerOf[piece];
      if (corner < 0) continue;
      const a = drawn.points[piece], b = drawn.points[piece + 1];
      if (near.some((plate) => pieceHitsBox(a, b, plate, 2))) {
        culprit = true;
        for (let c = Math.max(1, corner - 1); c <= Math.min(corners, corner + 1); c += 1) reach[c] = reach[c] > MERGE_MIN ? Math.max(MERGE_MIN, reach[c] / 2) : REACH.straight;
      }
    }
    if (!culprit) return drawn;
  }
  // Only the corners that still ran over a plate have become tight; every other corner keeps its soft curve, so a soft wire never
  // turns into a stiff, angled one as a whole (the owner 2026-11-06: "strecket i vinkel även att jag valt fritt").
  return build(route, reach.map((value) => (value > MERGE_MIN ? value : REACH.straight)), fromSide, toSide, true);
}

type Built = Drawn & { cornerOf: number[] };

function build(route: readonly Point[], reach: readonly number[], fromSide: Side | null, toSide: Side | null, merge: boolean): Built {
  const n = route.length, last = n - 1;
  const lengths: number[] = [], dirs: Point[] = [];
  for (let i = 0; i < last; i += 1) { lengths.push(dist(route[i], route[i + 1])); dirs.push(unit(route[i], route[i + 1])); }
  const points: Point[] = [{ ...route[0] }], segmentOf: number[] = [], cornerOf: number[] = [];
  const push = (p: Point, segment: number, corner: number) => { points.push(p); segmentOf.push(segment); cornerOf.push(corner); };
  // How much of a segment's start the previous curve already used.
  let used = 0;
  const budgetIn = (corner: number) => { const segment = corner - 1; const whole = lengths[segment]; const keep = segment === 0 && fromSide ? LEAD : 0; return Math.max(0, Math.min(whole - used, whole - keep - used)); };
  const budgetOut = (corner: number, lastOfPair: boolean) => { const segment = corner; const whole = lengths[segment]; if (segment === last - 1) return Math.max(0, toSide ? whole - LEAD : whole / 2); return lastOfPair ? whole / 2 : whole / 2; };
  let i = 1;
  while (i <= last - 1) {
    const canMerge = merge && i + 1 <= last - 1 && lengths[i] < 2 * REACH.soft && reach[i] > MERGE_MIN && reach[i + 1] > MERGE_MIN;
    if (canMerge) {
      const ra = Math.min(reach[i], budgetIn(i)), rb = Math.min(reach[i + 1], budgetOut(i + 1, true));
      const start = along(route[i], dirs[i - 1], -ra), end = along(route[i + 1], dirs[i + 1], rb);
      push(start, i - 1, -1);
      const pieces = Math.max(6, Math.ceil((ra + lengths[i] + rb) / PIECE));
      for (let k = 1; k <= pieces; k += 1) { const t = k / pieces; push(cubic(start, route[i], route[i + 1], end, t), t < 1 / 3 ? i - 1 : t < 2 / 3 ? i : i + 1, t < 0.5 ? i : i + 1); }
      used = rb;
      i += 2;
      continue;
    }
    const ra = Math.min(reach[i], budgetIn(i)), rb = Math.min(reach[i], budgetOut(i, false));
    if (ra < 0.5 || rb < 0.5) { push({ ...route[i] }, i - 1, -1); used = 0; i += 1; continue; }
    const start = along(route[i], dirs[i - 1], -ra), end = along(route[i], dirs[i], rb);
    push(start, i - 1, -1);
    const pieces = Math.max(3, Math.ceil((ra + rb) / PIECE));
    for (let k = 1; k <= pieces; k += 1) { const t = k / pieces; push(quadratic(start, route[i], end, t), t < 0.5 ? i - 1 : i, i); }
    used = rb;
    i += 1;
  }
  push({ ...route[last] }, last - 1, -1);
  const drawn = finish(points, segmentOf);
  return { ...drawn, cornerOf };
}

/** The point a running length along the drawn wire falls on. */
export function pointAlong(drawn: Drawn, s: number): Point {
  const { points, cumulative } = drawn;
  const total = cumulative[cumulative.length - 1];
  if (s <= 0) return points[0];
  if (s >= total) return points[points.length - 1];
  let index = 1;
  while (index < cumulative.length - 1 && cumulative[index] < s) index += 1;
  const a = points[index - 1], b = points[index], span = cumulative[index] - cumulative[index - 1] || 1;
  const t = (s - cumulative[index - 1]) / span;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
export const drawnLength = (drawn: Drawn) => drawn.cumulative[drawn.cumulative.length - 1] ?? 0;
export const drawnMidpoint = (drawn: Drawn) => pointAlong(drawn, drawnLength(drawn) / 2);

/** Where two straight pieces cross strictly inside both (not at their ends): the parameters along each, or null. */
export function crossingOf(a: Point, b: Point, c: Point, d: Point): { t: number; u: number; point: Point } | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
  const lenA = Math.hypot(rx, ry), lenB = Math.hypot(sx, sy);
  const margin = 0.5;
  if (t * lenA < margin || (1 - t) * lenA < margin || u * lenB < margin || (1 - u) * lenB < margin) return null;
  return { t, u, point: { x: a.x + rx * t, y: a.y + ry * t } };
}

const CELL = 48;

/**
 * Every crossing between wires of different nets: for each wire, the running lengths where it hops over an earlier one. The
 * wire later in `order` is the one on top and gets the hop, so a crossing always looks the same. Wires of one net (they share
 * a node somewhere) never hop: a dot or nothing marks what they share. Found through a grid of cells, so 150 wires cost
 * about what their pieces cost, not their pairs.
 */
export function hopsOf(drawn: ReadonlyMap<string, Drawn>, order: readonly string[], netOf: (wireId: string) => string | number | null): Map<string, number[]> {
  const cells = new Map<number, number[]>();
  const items = order.map((id) => drawn.get(id) ?? null);
  const nets = order.map((id) => netOf(id));
  // A cell key and an entry are plain numbers: the grid is offset so a point a little off the sheet still has a key.
  const OFFSET = 64, SPAN = 1 << 12;
  const keyOf = (cx: number, cy: number) => (cx + OFFSET) * SPAN + (cy + OFFSET);
  items.forEach((item, wire) => {
    if (!item) return;
    for (let piece = 0; piece < item.points.length - 1; piece += 1) {
      const a = item.points[piece], b = item.points[piece + 1];
      const cx0 = Math.floor(Math.min(a.x, b.x) / CELL), cx1 = Math.floor(Math.max(a.x, b.x) / CELL), cy0 = Math.floor(Math.min(a.y, b.y) / CELL), cy1 = Math.floor(Math.max(a.y, b.y) / CELL);
      const entry = wire * SPAN + piece;
      for (let cx = cx0; cx <= cx1; cx += 1) for (let cy = cy0; cy <= cy1; cy += 1) { const key = keyOf(cx, cy); const list = cells.get(key); if (list) list.push(entry); else cells.set(key, [entry]); }
    }
  });
  const hops = new Map<string, number[]>();
  for (const [key, list] of cells) {
    if (list.length < 2) continue;
    const cx = Math.floor(key / SPAN) - OFFSET, cy = (key % SPAN) - OFFSET;
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
      const p = { wire: Math.floor(list[i] / SPAN), piece: list[i] % SPAN }, q = { wire: Math.floor(list[j] / SPAN), piece: list[j] % SPAN };
      if (p.wire === q.wire) continue;
      const netP = nets[p.wire], netQ = nets[q.wire];
      if (netP !== null && netQ !== null && netP === netQ) continue;
      const A = items[p.wire]!, B = items[q.wire]!;
      const hit = crossingOf(A.points[p.piece], A.points[p.piece + 1], B.points[q.piece], B.points[q.piece + 1]);
      if (!hit) continue;
      // A pair may share several cells: only the cell holding the crossing point counts it.
      if (Math.floor(hit.point.x / CELL) !== cx || Math.floor(hit.point.y / CELL) !== cy) continue;
      const upper = p.wire > q.wire ? p : q, parameter = p.wire > q.wire ? hit.t : hit.u;
      const item = items[upper.wire]!;
      const at = item.cumulative[upper.piece] + parameter * (item.cumulative[upper.piece + 1] - item.cumulative[upper.piece]);
      const id = order[upper.wire];
      const existing = hops.get(id);
      if (existing) existing.push(at); else hops.set(id, [at]);
    }
  }
  for (const list of hops.values()) list.sort((a, b) => a - b);
  return hops;
}

/** The hop's radius for a stroke width: scales with the wire so it stays visible when zoomed out. */
export const hopRadius = (strokeWidth: number) => Math.max(5.5, strokeWidth * 2.3);

const fmt = (value: number) => (Math.round(value * 10) / 10).toString();

/**
 * The SVG path of a drawn wire with its hops: a semicircular arc over every crossing (neighbouring crossings share one
 * flatter arc), bulging up on a horizontal run and to the right on a vertical one, whichever way the wire is drawn.
 */
export function pathOf(drawn: Drawn, hops: readonly number[] = [], radius = 6): string {
  const { points, cumulative } = drawn;
  if (!points.length) return "";
  const total = cumulative[cumulative.length - 1];
  const intervals: [number, number][] = [];
  for (const at of hops) {
    if (at - radius < 1 || at + radius > total - 1) continue;
    const last = intervals[intervals.length - 1];
    if (last && at - radius <= last[1]) last[1] = at + radius; else intervals.push([at - radius, at + radius]);
  }
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  let index = 1;
  for (const [s0, s1] of intervals) {
    while (index < points.length && cumulative[index] < s0) { d += ` L ${fmt(points[index].x)} ${fmt(points[index].y)}`; index += 1; }
    const a = pointAlong(drawn, s0), b = pointAlong(drawn, s1);
    const dx = b.x - a.x, dy = b.y - a.y;
    const normal = Math.abs(dx) >= Math.abs(dy) ? { x: 0, y: -1 } : { x: 1, y: 0 };
    const sweep = dx * normal.y - dy * normal.x < 0 ? 1 : 0;
    const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
    d += ` L ${fmt(a.x)} ${fmt(a.y)} A ${fmt((s1 - s0) / 2)} ${fmt(radius)} ${angle} 0 ${sweep} ${fmt(b.x)} ${fmt(b.y)}`;
    while (index < points.length && cumulative[index] <= s1) index += 1;
  }
  while (index < points.length) { d += ` L ${fmt(points[index].x)} ${fmt(points[index].y)}`; index += 1; }
  return d;
}

/** The drawn pieces grouped by the route segment they belong to, as paths: what the pointer takes to pick a segment. */
export function segmentPaths(drawn: Drawn): { segment: number; d: string }[] {
  const out: { segment: number; d: string }[] = [];
  let current: { segment: number; d: string } | null = null;
  for (let piece = 0; piece < drawn.points.length - 1; piece += 1) {
    const segment = drawn.segmentOf[piece];
    const a = drawn.points[piece], b = drawn.points[piece + 1];
    if (!current || current.segment !== segment) { current = { segment, d: `M ${fmt(a.x)} ${fmt(a.y)}` }; out.push(current); }
    current.d += ` L ${fmt(b.x)} ${fmt(b.y)}`;
  }
  return out;
}

/** Whether a drawn wire's curve runs over any of the boxes, leads aside. */
export function drawnCrossesBox(drawn: Drawn, boxes: readonly Box[], pad = 0): boolean {
  const lastSegment = drawn.segmentOf.length ? Math.max(...drawn.segmentOf) : 0;
  for (let piece = 0; piece < drawn.points.length - 1; piece += 1) {
    const segment = drawn.segmentOf[piece];
    const a = drawn.points[piece], b = drawn.points[piece + 1];
    for (const box of boxes) if (pieceHitsBox(a, b, box, pad)) {
      // A lead starts on its own plate: the first and last route segments may touch the box they leave or reach.
      const first = segment === 0, last = segment === lastSegment;
      if ((first && pointInBoxPad(drawn.points[0], box, pad + 1)) || (last && pointInBoxPad(drawn.points[drawn.points.length - 1], box, pad + 1))) continue;
      return true;
    }
  }
  return false;
}
const pointInBoxPad = (p: Point, box: Box, pad: number) => p.x >= box.x - pad && p.x <= box.x + box.width + pad && p.y >= box.y - pad && p.y <= box.y + box.height + pad;

/**
 * Which wires the drawing itself joins: wires that share a terminal or a junction, and so on through them. Only the wiring
 * counts, never a contact or the running PLC, so a crossing looks the same in STOP and RUN (the owner 2026-11-06: the hop "kommer
 * och går" when Start was pressed, because a closed contact used to join two nets and take the hop away).
 */
export function wiringGroups(wires: readonly Wire[]): number[] {
  const parent = new Map<string, string>();
  const find = (key: string): string => { let root = key; while (parent.get(root) !== root) root = parent.get(root) ?? root; parent.set(key, root); return root; };
  const add = (key: string) => { if (!parent.has(key)) parent.set(key, key); };
  for (const wire of wires) {
    const a = endKey(wire.from), b = endKey(wire.to);
    add(a); add(b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const ids = new Map<string, number>();
  return wires.map((wire) => { const root = find(endKey(wire.from)); if (!ids.has(root)) ids.set(root, ids.size); return ids.get(root)!; });
}
