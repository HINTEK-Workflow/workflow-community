// PLC-simulatorn (2026-11-06): the hop at a crossing stays put when Start is pressed, and a soft wire never turns angled as a
// whole when one corner has to tighten. The owner saw the bubble over the wires "kommer och går" and a wire "i vinkel" in Fritt.
import assert from "node:assert/strict";
import test from "node:test";
import { drawRoute, hopsOf, wiringGroups } from "../lib/machine/simulator/surface/draw";
import type { Point, Wire } from "../lib/machine/simulator/surface/layout";

const wire = (id: string, from: string, to: string): Wire => {
  const end = (ref: string) => (ref.startsWith("j") ? { junction: ref } : { device: ref.split(":")[0], terminal: ref.split(":")[1] });
  return { id, from: end(from), to: end(to) };
};

test("wiring groups follow only the drawing: wires sharing a terminal or a junction, nothing else", () => {
  const wires = [
    wire("w1", "src:+", "knapp:1"),
    wire("w2", "knapp:2", "plc:DI0"),
    wire("w3", "src:+", "j1"),
    wire("w4", "j1", "lampa:X1"),
  ];
  const groups = wiringGroups(wires);
  assert.equal(groups[0], groups[2], "w1 and w3 share src:+");
  assert.equal(groups[2], groups[3], "w3 and w4 share the junction");
  assert.notEqual(groups[0], groups[1], "the button's two sides are two groups, whether its contact is closed or not");
  // The groups depend on nothing but the wires: the same list gives the same groups, as in STOP and RUN.
  assert.deepEqual(wiringGroups(wires), groups);
});

test("a crossing between the button's two sides hops the same, however the contact stands", () => {
  // w1 runs across, w2 runs down through it; the two are in different wiring groups.
  const wires = [wire("w1", "src:+", "knapp:1"), wire("w2", "knapp:2", "plc:DI0")];
  const across: Point[] = [{ x: 0, y: 100 }, { x: 200, y: 100 }], down: Point[] = [{ x: 100, y: 0 }, { x: 100, y: 200 }];
  const drawn = new Map([["w1", drawRoute(across, "straight", null, null)], ["w2", drawRoute(down, "straight", null, null)]]);
  const order = wires.map((item) => item.id);
  const groups = wiringGroups(wires);
  const netOf = (id: string) => groups[order.indexOf(id)] ?? null;
  const hops = hopsOf(drawn, order, netOf);
  assert.equal([...hops.values()].flat().length, 1, "one hop at the crossing");
  // Pressing Start joined the two nets electrically, and the old code took the hop away; the wiring groups do not change.
  assert.deepEqual(hopsOf(drawn, order, netOf), hops);
});

const distanceTo = (points: readonly Point[], at: Point) => {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx - at.x, a.y + t * dy - at.y));
  }
  return best;
};

test("a corner that cannot clear a plate tightens with its neighbours only; the other corners keep their soft curve", () => {
  const route: Point[] = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 800 }, { x: 1200, y: 800 }];
  // A plate sits right on the third corner: no curve there can clear it. Its neighbours may tighten with it, the first may not.
  const plate = { x: 780, y: 380, width: 40, height: 40 };
  const free = drawRoute(route, "soft", null, null, []);
  const crowded = drawRoute(route, "soft", null, null, [plate]);
  assert.ok(distanceTo(free.points, route[1]) > 15, "a free soft corner swings well clear of the corner point");
  assert.ok(distanceTo(crowded.points, route[1]) > 15, "the first corner keeps its soft curve beside the plate");
  assert.ok(distanceTo(crowded.points, route[3]) < distanceTo(free.points, route[3]), "the corner at the plate is the one that tightened");
});
