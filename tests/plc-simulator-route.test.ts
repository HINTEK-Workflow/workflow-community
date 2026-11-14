import assert from "node:assert/strict";
import test from "node:test";
import { drawnCrossesBox, drawnLength, drawRoute, hopsOf, pathOf, pointAlong, segmentPaths } from "../lib/machine/simulator/surface/draw";
import { addCorner, clipOf, connectWire, copyLabel, cornersOf, devicesInBox, duplicateSelection, insertClip, moveCorner, movingParts, removeCorner, removeSelection, routesOf, selectionBounds, translateSelection, wiresInBox } from "../lib/machine/simulator/surface/edit";
import { SURFACE_EXAMPLES } from "../lib/machine/simulator/surface/examples";
import { deviceTerminalPoint, endPoint, freeOffset, freePlace, GRID, junctionsById, labelBox, labelPlace, LEAD, PLC_BOX, plcTerminalPoint, removeButtonSpot, segmentsOf, terminalPoint } from "../lib/machine/simulator/surface/geometry";
import { DEVICE_DEFS } from "../lib/machine/simulator/surface/devices";
import { type DeviceInst, emptyLayout, type Layout, type Point, validateLayout, type Wire } from "../lib/machine/simulator/surface/layout";
import { obstaclesOf, platesOf, routeCrossesBox, WireRouter } from "../lib/machine/simulator/surface/route";
import { devicesById, solveNets } from "../lib/machine/simulator/surface/wiring";

// PLC-simulatorn, Grundläggande, ritverktyget (2026-11-03): the wire router (round the plates, orthogonal, deterministic,
// parallel wires apart, own bends kept, cached per wire), the two drawing styles with hops at crossings, and the editing
// operations behind corner handles, marquee selection, nudging and copies. Pure, without a browser.

const ref = (text: string) => { const [device, terminal] = text.split(":"); return { device, terminal }; };
const end = (text: string) => (text.startsWith("@") ? { junction: text.slice(1) } : ref(text));
const wiresOf = (pairs: [string, string][]): Wire[] => pairs.map(([from, to], index) => ({ id: `w${index + 1}`, from: end(from), to: end(to) }));
const device = (id: string, kind: Layout["devices"][number]["kind"], x: number, y: number) => ({ id, kind, x, y, label: id, options: {} });
const layoutWith = (devices: Layout["devices"], pairs: [string, string][], junctions: Layout["junctions"] = []): Layout => ({ ...emptyLayout(), devices, wires: wiresOf(pairs), junctions });
const orthogonal = (route: readonly Point[]) => route.every((point, index) => index === 0 || point.x === route[index - 1].x || point.y === route[index - 1].y);
const OFF = { do: Array(8).fill(false), ao: [0, 0] };
const sides = (layout: Layout, wire: Wire) => { const devices = devicesById(layout), junctions = junctionsById(layout); return { fromSide: endPoint(wire.from, devices, junctions)?.side ?? null, toSide: endPoint(wire.to, devices, junctions)?.side ?? null }; };

/** A big drawing: about 60 devices around the PLC and 150 wires, the way a busy exercise panel looks. */
function bigLayout(): Layout {
  const devices: Layout["devices"] = [];
  const kinds = ["knapp", "lampa", "vippa", "summer"] as const;
  let n = 0;
  for (const y of [24, 120]) for (let x = 16; x <= 1112; x += 92) devices.push(device(`d${n}`, kinds[n++ % kinds.length], x, y));
  for (const y of [500, 596]) for (let x = 16; x <= 1112; x += 92) devices.push(device(`d${n}`, kinds[n++ % kinds.length], x, y));
  for (const y of [270, 370]) for (const x of [16, 130, 240, 900, 1010, 1110]) devices.push(device(`d${n}`, kinds[n++ % kinds.length], x, y));
  const top = ["24V", "0V", ...Array.from({ length: 12 }, (_, index) => `DI${index}`), "AI0", "AI1", "AI2", "AI3"];
  const bottom = [...Array.from({ length: 8 }, (_, index) => `DO${index}`), "AO0", "AO1"];
  const pairs: [string, string][] = [];
  const terminalsOf = (item: Layout["devices"][number]) => (item.kind === "lampa" ? ["X1", "X2"] : ["1", "2"]);
  devices.forEach((item, index) => {
    const [a, b] = terminalsOf(item);
    const row = item.y < 235 ? top : bottom;
    pairs.push([`plc:${row[index % row.length]}`, `${item.id}:${a}`]);
    pairs.push([`${item.id}:${b}`, `plc:${row[(index + 7) % row.length]}`]);
  });
  for (let index = 0; index + 1 < devices.length && pairs.length < 150; index += 2) pairs.push([`${devices[index].id}:${terminalsOf(devices[index])[1]}`, `${devices[index + 1].id}:${terminalsOf(devices[index + 1])[0]}`]);
  while (pairs.length < 150) { const item = devices[pairs.length % devices.length]; pairs.push([`plc:DI${pairs.length % 12}`, `${item.id}:${terminalsOf(item)[1]}`]); }
  const wires = wiresOf(pairs.slice(0, 150)).filter((wire, index, all) => all.findIndex((other) => JSON.stringify([other.from, other.to]) === JSON.stringify([wire.from, wire.to])) === index);
  return { ...emptyLayout(), devices, wires };
}

/** Two segments of different wires that lie on one line and overlap more than a grid step: wires drawn on top of each other. */
function overlappingRuns(routes: Map<string, Point[]>, layout: Layout): string[] {
  const out: string[] = [];
  const wires = layout.wires;
  for (let i = 0; i < wires.length; i += 1) for (let j = i + 1; j < wires.length; j += 1) {
    const a = wires[i], b = wires[j];
    const shared = [a.from, a.to].some((x) => [b.from, b.to].some((y) => JSON.stringify(x) === JSON.stringify(y)));
    if (shared) continue;
    const ra = routes.get(a.id)!, rb = routes.get(b.id)!;
    for (const sa of segmentsOf(ra).slice(1, -1)) for (const sb of segmentsOf(rb).slice(1, -1)) {
      if (sa.horizontal !== sb.horizontal) continue;
      if (sa.horizontal && sa.a.y === sb.a.y) { const overlap = Math.min(Math.max(sa.a.x, sa.b.x), Math.max(sb.a.x, sb.b.x)) - Math.max(Math.min(sa.a.x, sa.b.x), Math.min(sb.a.x, sb.b.x)); if (overlap > 12) out.push(`${a.id}/${b.id} y=${sa.a.y} ${overlap}px`); }
      if (!sa.horizontal && sa.a.x === sb.a.x) { const overlap = Math.min(Math.max(sa.a.y, sa.b.y), Math.max(sb.a.y, sb.b.y)) - Math.max(Math.min(sa.a.y, sa.b.y), Math.min(sb.a.y, sb.b.y)); if (overlap > 12) out.push(`${a.id}/${b.id} x=${sa.a.x} ${overlap}px`); }
    }
  }
  return out;
}

test("every example wire is routed orthogonally from terminal to terminal, round every plate, with few bends", () => {
  for (const example of SURFACE_EXAMPLES) {
    const router = new WireRouter();
    const layout = example.layout;
    const routes = router.routesOf(layout);
    const plates = platesOf(layout.devices);
    const devices = devicesById(layout);
    for (const wire of layout.wires) {
      const route = routes.get(wire.id)!;
      assert.ok(route && route.length >= 2, `${example.id} ${wire.id} has a route`);
      assert.ok(orthogonal(route), `${example.id} ${wire.id} is orthogonal: ${JSON.stringify(route)}`);
      const from = terminalPoint(wire.from as { device: string; terminal: string }, devices)!, to = terminalPoint(wire.to as { device: string; terminal: string }, devices)!;
      assert.deepEqual(route[0], { x: from.x, y: from.y });
      assert.deepEqual(route[route.length - 1], { x: to.x, y: to.y });
      assert.ok(!routeCrossesBox(route, plates), `${example.id} ${wire.id} keeps off the plates: ${JSON.stringify(route)}`);
      assert.ok(route.length <= 9, `${example.id} ${wire.id} has at most seven bends: ${route.length - 2}`);
    }
  }
});

test("a wire goes round a device standing in its way instead of over it, and the result is the same every time", () => {
  // A lamp straight between a button and the PLC terminal it is wired to.
  const layout = layoutWith([device("knapp-1", "knapp", 360, 40), device("lampa-1", "lampa", 364, 130)], [["knapp-1:2", "plc:DI3"], ["plc:DI4", "knapp-1:1"]]);
  const router = new WireRouter();
  const routes = router.routesOf(layout);
  const plates = platesOf(layout.devices);
  for (const wire of layout.wires) {
    const route = routes.get(wire.id)!;
    assert.ok(orthogonal(route));
    assert.ok(!routeCrossesBox(route, plates), `${wire.id} goes round the lamp: ${JSON.stringify(route)}`);
  }
  const again = new WireRouter().routesOf(layout);
  assert.deepEqual([...again.entries()], [...routes.entries()], "a fresh router gives the same routes");
  assert.deepEqual([...router.routesOf(layout).entries()], [...routes.entries()], "the same router gives the same routes from its cache");
  // With the lamp gone the wire takes the straight way.
  const clear = { ...layout, devices: layout.devices.filter((candidate) => candidate.id !== "knapp-1" || true).filter((candidate) => candidate.kind !== "lampa") };
  const direct = new WireRouter().routesOf(clear).get("w1")!;
  assert.ok(direct.length <= routes.get("w1")!.length, "without the obstacle the route has no more bends");
});

test("parallel wires in one channel are spaced apart instead of drawn on top of each other", () => {
  // Four buttons in a row above the PLC, each wired to +24 V: four wires share the same channel toward one terminal.
  const layout = layoutWith([device("k1", "knapp", 40, 40), device("k2", "knapp", 140, 40), device("k3", "knapp", 240, 40), device("k4", "knapp", 1000, 40)], [["k1:2", "plc:DI0"], ["k2:2", "plc:DI1"], ["k3:2", "plc:DI2"], ["k4:2", "plc:DI3"]]);
  const routes = new WireRouter().routesOf(layout);
  assert.deepEqual(overlappingRuns(routes, layout), [], "no two wires lie on one line over more than a grid step");
  for (const wire of layout.wires) assert.ok(orthogonal(routes.get(wire.id)!));
  for (const example of SURFACE_EXAMPLES) assert.deepEqual(overlappingRuns(new WireRouter().routesOf(example.layout), example.layout), [], example.id);
});

test("a wire with its own bends keeps them when a device moves and is only stretched at the moved end; a plain wire is routed anew", () => {
  const base = layoutWith([device("lampa-1", "lampa", 800, 540), device("knapp-1", "knapp", 100, 60)], [["plc:DO0", "lampa-1:X1"], ["knapp-1:2", "plc:DI0"]]);
  const bent: Layout = { ...base, wires: base.wires.map((wire) => (wire.id === "w1" ? { ...wire, points: [{ x: 600, y: 520 }, { x: 760, y: 520 }] } : wire)) };
  const router = new WireRouter();
  const before = router.routesOf(bent);
  const moved: Layout = { ...bent, devices: bent.devices.map((candidate) => (candidate.id === "lampa-1" ? { ...candidate, x: 1000, y: 580 } : candidate.id === "knapp-1" ? { ...candidate, x: 200, y: 60 } : candidate)) };
  const after = router.routesOf(moved);
  const manual = after.get("w1")!;
  assert.ok(orthogonal(manual));
  assert.ok(manual.some((point) => point.x === 600 && point.y === 520) && manual.some((point) => point.x === 760 && point.y === 520), "the bends are still on the route");
  assert.deepEqual(manual.slice(0, 3), before.get("w1")!.slice(0, 3), "the unmoved end is untouched");
  const plain = after.get("w2")!;
  assert.ok(orthogonal(plain) && plain[0].x === deviceTerminalPoint(moved.devices[1], "2")!.x, "the plain wire follows its moved device");
  assert.notDeepEqual(plain, before.get("w2"));
});

test("the cache: moving one device routes again only the wires at it or round it; a busy drawing stays fast", () => {
  // Above the file format's 40 devices on purpose: the router has to stay smooth well past what a drawing may hold.
  const layout = bigLayout();
  assert.ok(layout.devices.length >= 58 && layout.wires.length >= 140, `${layout.devices.length} devices, ${layout.wires.length} wires`);
  assert.ok(validateLayout({ ...layout, devices: layout.devices.slice(0, 40), wires: layout.wires.filter((wire) => [wire.from, wire.to].every((end) => "device" in end && (end.device === "plc" || Number(end.device.slice(1)) < 40))) }).ok, "the same drawing within the format's limits is valid");
  const router = new WireRouter();
  const t0 = performance.now();
  const routes = router.routesOf(layout);
  const fresh = performance.now() - t0;
  assert.equal(routes.size, layout.wires.length);
  assert.equal(router.routedCount, layout.wires.length);
  const plates = platesOf(layout.devices);
  let overPlate = 0;
  for (const wire of layout.wires) { const route = routes.get(wire.id)!; assert.ok(orthogonal(route)); if (routeCrossesBox(route, plates)) overPlate += 1; }
  assert.ok(overPlate <= 2, `at most a couple of wires in a crowded drawing have no way round: ${overPlate}`);
  router.routedCount = 0;
  const moved: Layout = { ...layout, devices: layout.devices.map((candidate) => (candidate.id === "d5" ? { ...candidate, x: candidate.x + 16, y: candidate.y + 8 } : candidate)) };
  const t1 = performance.now();
  const after = router.routesOf(moved);
  const incremental = performance.now() - t1;
  assert.equal(after.size, layout.wires.length);
  assert.ok(router.routedCount < layout.wires.length / 3, `only the wires at or round the moved device were routed again: ${router.routedCount} of ${layout.wires.length}`);
  router.routedCount = 0;
  const t2 = performance.now();
  router.routesOf(moved);
  const cached = performance.now() - t2;
  assert.equal(router.routedCount, 0, "nothing changed: everything from the cache");
  // While a device is dragged, only the wires at it are routed again (quick); the wires it passes over wait for the drop.
  router.routedCount = 0;
  const dragging: Layout = { ...moved, devices: moved.devices.map((candidate) => (candidate.id === "d20" ? { ...candidate, x: candidate.x + 24, y: candidate.y + 16 } : candidate)) };
  const t3 = performance.now();
  const quick = router.routesOf(dragging, { quick: true });
  const quickMs = performance.now() - t3;
  const attached = layout.wires.filter((wire) => [wire.from, wire.to].some((end) => "device" in end && end.device === "d20")).length;
  assert.equal(router.routedCount, attached, `quick: exactly the ${attached} wires at the dragged device`);
  assert.equal(quick.size, layout.wires.length);
  console.log(`router: ${layout.devices.length} devices, ${layout.wires.length} wires: fresh ${fresh.toFixed(0)} ms, after one device moved ${incremental.toFixed(0)} ms (${router.routedCount} wires), one drag frame ${quickMs.toFixed(1)} ms, unchanged ${cached.toFixed(1)} ms`);
  assert.ok(fresh < 3000, `fresh routing within bounds: ${fresh} ms`);
  // Compared with the fresh routing on the same machine, so a busy computer does not turn it red; the wall clock only as an outer limit.
  assert.ok(incremental < fresh * 0.6, `incremental routing is a fraction of fresh: ${incremental} of ${fresh} ms`);
  assert.ok(incremental < 1000, `incremental routing within bounds: ${incremental} ms`);
  assert.ok(quickMs < 60, `a drag frame within bounds: ${quickMs} ms`);
  // The drawing of all of it, both styles, with hops.
  const devices = devicesById(moved), junctions = junctionsById(moved);
  const solved = solveNets(moved, { closed: new Set(), sourceVolts: new Map(), outputs: OFF });
  const netOf = (id: string) => { const wire = moved.wires.find((candidate) => candidate.id === id)!; return solved.netOf.get("device" in wire.from ? `${wire.from.device}:${wire.from.terminal}` : `@${wire.from.junction}`)?.id ?? null; };
  const t4 = performance.now();
  const drawn = new Map(moved.wires.map((wire) => [wire.id, drawRoute(after.get(wire.id)!, "soft", endPoint(wire.from, devices, junctions)?.side ?? null, endPoint(wire.to, devices, junctions)?.side ?? null, plates)]));
  const hops = hopsOf(drawn, moved.wires.map((wire) => wire.id), netOf);
  const paths = moved.wires.map((wire) => pathOf(drawn.get(wire.id)!, hops.get(wire.id) ?? [], 6));
  const drawing = performance.now() - t4;
  assert.equal(paths.length, moved.wires.length);
  console.log(`drawing: soft curves, crossings and paths for ${moved.wires.length} wires in ${drawing.toFixed(0)} ms (${[...hops.values()].reduce((sum, list) => sum + list.length, 0)} hops)`);
  assert.ok(drawing < 600, `drawing within bounds: ${drawing} ms`);
});

test("drawing: soft wires curve but never run over a plate; straight wires have small rounded corners; both keep the route's ends", () => {
  for (const example of SURFACE_EXAMPLES) {
    const layout = example.layout;
    const routes = new WireRouter().routesOf(layout);
    const plates = platesOf(layout.devices);
    for (const wire of layout.wires) {
      const route = routes.get(wire.id)!;
      const { fromSide, toSide } = sides(layout, wire);
      for (const style of ["soft", "straight"] as const) {
        const drawn = drawRoute(route, style, fromSide, toSide, plates);
        assert.deepEqual(drawn.points[0], route[0]);
        assert.deepEqual(drawn.points[drawn.points.length - 1], route[route.length - 1]);
        assert.ok(!drawnCrossesBox(drawn, plates), `${example.id} ${wire.id} (${style}) stays off the plates`);
        assert.equal(drawn.points.length, drawn.cumulative.length);
        assert.ok(drawnLength(drawn) > 0);
        if (route.length >= 4) assert.ok(drawn.points.length > route.length, `${wire.id} (${style}) has curved corners`);
        if (route.length >= 3 && fromSide) {
          // The lead stays straight: the first piece runs along the terminal's normal for the lead's length.
          const second = drawn.points[1];
          assert.equal(second.x, route[0].x, `${wire.id} (${style}) leaves its terminal straight`);
          assert.ok(Math.abs(second.y - route[0].y) >= LEAD - 0.5, `${wire.id} (${style}) keeps its lead`);
        }
        const groups = segmentPaths(drawn);
        assert.ok(groups.length >= 1 && groups.every((group) => group.d.startsWith("M ")));
      }
    }
  }
  // A Z from a bottom terminal to a top one: soft makes one S that swings away from the straight middle, straight stays on it.
  const route = [{ x: 100, y: 60 }, { x: 100, y: 150 }, { x: 405, y: 150 }, { x: 405, y: 235 }];
  const soft = drawRoute(route, "soft", "bottom", "top", []), straight = drawRoute(route, "straight", "bottom", "top", []);
  const farthest = (drawn: ReturnType<typeof drawRoute>) => Math.max(...drawn.points.map((point) => Math.min(...segmentsOf(route).map((segment) => Math.hypot(point.x - Math.min(Math.max(point.x, Math.min(segment.a.x, segment.b.x)), Math.max(segment.a.x, segment.b.x)), point.y - Math.min(Math.max(point.y, Math.min(segment.a.y, segment.b.y)), Math.max(segment.a.y, segment.b.y)))))));
  assert.ok(farthest(straight) < 3, `straight stays on its segments but for the small rounding: ${farthest(straight)}`);
  assert.ok(farthest(soft) > 15, `soft swings out as one S: ${farthest(soft)}`);
  assert.ok(soft.points.length > straight.points.length);
  const quarter = pointAlong(soft, drawnLength(soft) / 4);
  assert.ok(quarter.x > 100 && quarter.x < 405 && quarter.y > 60 && quarter.y < 235);
  assert.deepEqual(soft.points[1], { x: 100, y: 78 }, "the lead out of the bottom terminal stays straight");
});

test("hops: a crossing of two nets puts an arc on the wire drawn later; wires of one net or that share a node get none; the arc scales with the stroke", () => {
  // w1 runs across at y = 150 from a button to the PLC; w2 comes down from a lamp above through it to the PLC's bottom row.
  const layout = layoutWith([device("knapp-1", "knapp", 40, 60), device("lampa-1", "lampa", 300, 20)], [["knapp-1:2", "plc:DI5"], ["lampa-1:X1", "plc:DO0"]]);
  const devices = devicesById(layout), junctions = junctionsById(layout);
  const routes = new WireRouter().routesOf(layout);
  const drawnOf = (style: "soft" | "straight") => new Map(layout.wires.map((wire) => [wire.id, drawRoute(routes.get(wire.id)!, style, endPoint(wire.from, devices, junctions)?.side ?? null, endPoint(wire.to, devices, junctions)?.side ?? null, platesOf(layout.devices))]));
  const netOf = (id: string) => (id === "w1" ? 1 : 2);
  let crossed = false;
  for (const style of ["soft", "straight"] as const) {
    const drawn = drawnOf(style);
    const hops = hopsOf(drawn, ["w1", "w2"], netOf);
    const total = [...hops.values()].reduce((sum, list) => sum + list.length, 0);
    if (!total) continue;
    crossed = true;
    assert.ok(!hops.has("w1") || hops.has("w2"), "the later wire hops");
    const d = pathOf(drawn.get("w2")!, hops.get("w2") ?? [], 6);
    assert.match(d, / A 6 6 /, `${style}: a semicircular arc on w2: ${d}`);
    assert.doesNotMatch(pathOf(drawn.get("w1")!, hops.get("w1") ?? [], 6), / A /, "w1 is drawn plain");
    const wide = pathOf(drawn.get("w2")!, hops.get("w2") ?? [], 9);
    assert.match(wide, / A 9 9 /, "a thicker stroke gets a larger arc");
  }
  assert.ok(crossed, `the two wires cross in this drawing: ${JSON.stringify([...routes.values()])}`);
  // The same two wires on one net: no hop at the crossing.
  const same = hopsOf(drawnOf("straight"), ["w1", "w2"], () => 7);
  assert.equal(same.size, 0);
  // Two wires that share a junction: no hop where they meet, whatever the drawing style.
  const branched = layoutWith([device("knapp-1", "knapp", 100, 60), device("knapp-2", "knapp", 240, 60)], [["plc:24V", "@j1"], ["@j1", "knapp-1:1"], ["@j1", "knapp-2:1"]], [{ id: "j1", x: 200, y: 20 }]);
  const branchRoutes = new WireRouter().routesOf(branched);
  const branchDevices = devicesById(branched), branchJunctions = junctionsById(branched);
  const branchDrawn = new Map(branched.wires.map((wire) => [wire.id, drawRoute(branchRoutes.get(wire.id)!, "straight", endPoint(wire.from, branchDevices, branchJunctions)?.side ?? null, endPoint(wire.to, branchDevices, branchJunctions)?.side ?? null)]));
  const solved = solveNets(branched, { closed: new Set(), sourceVolts: new Map(), outputs: OFF });
  const net = (id: string) => { const wire = branched.wires.find((candidate) => candidate.id === id)!; return solved.netOf.get("device" in wire.from ? `${wire.from.device}:${wire.from.terminal}` : `@${wire.from.junction}`)?.id ?? null; };
  assert.equal(hopsOf(branchDrawn, branched.wires.map((wire) => wire.id), net).size, 0, "wires that meet in a junction never hop over one another");
  for (const wire of branched.wires) assert.doesNotMatch(pathOf(branchDrawn.get(wire.id)!), / A /);
});

test("corner handles: a wire's corners, a corner added on a segment, dragged with the segments kept orthogonal, dropped when it lies on the line, removed", () => {
  const layout = layoutWith([device("lampa-1", "lampa", 800, 540)], [["plc:DO0", "lampa-1:X1"]]);
  const wire = layout.wires[0];
  let routes = routesOf(layout);
  let route = routes.get("w1")!;
  const { fromSide, toSide } = sides(layout, wire);
  const corners = cornersOf(wire, route, fromSide, toSide);
  assert.ok(corners.length >= 1, `an auto-routed wire shows its corners: ${JSON.stringify(route)}`);
  assert.ok(corners.every((corner) => route.some((point) => point.x === corner.x && point.y === corner.y)));
  assert.ok(!corners.some((corner) => corner.y === route[0].y + LEAD && corner.x === route[0].x), "the lead's end is no corner");
  // A corner added on the first long segment lies on it.
  const longSegment = segmentsOf(route).findIndex((segment) => Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) > 60);
  assert.ok(longSegment >= 0);
  const seg = segmentsOf(route)[longSegment];
  const added = addCorner(layout, "w1", route, longSegment, { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 });
  const addedWire = added.wires[0];
  assert.ok(addedWire.points && addedWire.points.length === corners.length + 1, "one more corner, stored on the wire");
  const newCorner = addedWire.points!.find((point) => !corners.some((corner) => corner.x === point.x && corner.y === point.y))!;
  assert.ok(seg.horizontal ? newCorner.y === seg.a.y : newCorner.x === seg.a.x, "the new corner lies on the segment");
  routes = routesOf(added);
  assert.ok(orthogonal(routes.get("w1")!));
  // Dragging it sideways makes a jog: the route stays orthogonal and passes through the new place.
  const index = addedWire.points!.indexOf(newCorner);
  const grid = (value: number) => Math.round(value / 8) * 8;
  const target = seg.horizontal ? { x: newCorner.x, y: grid(newCorner.y + 40) } : { x: grid(newCorner.x + 40), y: newCorner.y };
  const dragged = moveCorner(added, "w1", routes.get("w1")!, index, target);
  route = routesOf(dragged).get("w1")!;
  assert.ok(orthogonal(route), JSON.stringify(route));
  assert.ok(route.some((point) => point.x === target.x && point.y === target.y), "the corner is where it was dragged");
  // Dragged back onto the line it came from, it is gone.
  const back = moveCorner(dragged, "w1", route, dragged.wires[0].points!.findIndex((point) => point.x === target.x && point.y === target.y), newCorner);
  assert.equal(back.wires[0].points?.length ?? 0, corners.length, "a corner laid on its neighbours' line disappears");
  // Delete on a corner removes just that corner; the last one gone makes the wire auto-routed again.
  let trimmed: Layout = added;
  while (trimmed.wires[0].points?.length) trimmed = removeCorner(trimmed, "w1", routesOf(trimmed).get("w1")!, 0);
  assert.equal(trimmed.wires[0].points, undefined);
  assert.ok(orthogonal(routesOf(trimmed).get("w1")!));
  // Out-of-range indices change nothing.
  assert.equal(removeCorner(added, "w1", route, 99), added);
  assert.equal(moveCorner(added, "w1", route, -1, { x: 0, y: 0 }), added);
});

test("a polyline drawn with the wire tool keeps its clicked corners as bends", () => {
  const layout = layoutWith([device("lampa-1", "lampa", 800, 540)], []);
  const result = connectWire(layout, { kind: "terminal", ref: ref("plc:DO1") }, { kind: "terminal", ref: ref("lampa-1:X1") }, "auto", [{ x: 496, y: 520 }, { x: 496, y: 600 }, { x: 702, y: 600 }, { x: 702, y: 600 }])!;
  assert.ok(result);
  const wire = result.layout.wires[0];
  assert.deepEqual(wire.points, [{ x: 496, y: 520 }, { x: 496, y: 600 }, { x: 704, y: 600 }], "corners kept on the grid, a repeated click dropped");
  const route = routesOf(result.layout).get(wire.id)!;
  assert.ok(orthogonal(route));
  assert.ok(route.some((point) => point.x === 496 && point.y === 600));
  assert.equal(connectWire(layout, { kind: "terminal", ref: ref("plc:DO1") }, { kind: "terminal", ref: ref("lampa-1:X1") }, "auto", Array.from({ length: 30 }, (_, index) => ({ x: index * 8, y: 100 }))), null, "too many corners are refused");
});

test("marquee, group moves, nudges and removal of a selection", () => {
  const layout = layoutWith([device("knapp-1", "knapp", 40, 40), device("knapp-2", "knapp", 160, 40), device("lampa-1", "lampa", 800, 540)], [["plc:24V", "knapp-1:1"], ["knapp-1:2", "knapp-2:1"], ["knapp-2:2", "plc:DI0"], ["plc:DO0", "lampa-1:X1"]]);
  const routes = routesOf(layout);
  assert.deepEqual(devicesInBox(layout, { x: 0, y: 0, width: 300, height: 200 }), ["knapp-1", "knapp-2"]);
  assert.deepEqual(devicesInBox(layout, { x: 0, y: 0, width: 200, height: 200 }), ["knapp-1"], "a plate half inside is not taken");
  assert.ok(wiresInBox(layout, routes, { x: 0, y: 0, width: 300, height: 200 }).includes("w2"), "the wire between the two buttons lies inside");
  assert.ok(!wiresInBox(layout, routes, { x: 0, y: 0, width: 300, height: 200 }).includes("w1"), "a wire to the PLC does not");
  const selection = { devices: ["knapp-1", "knapp-2"], wires: [] };
  const parts = movingParts(layout, selection);
  assert.ok(parts.wires.has("w2") && !parts.wires.has("w1"));
  const bent: Layout = { ...layout, wires: layout.wires.map((wire) => (wire.id === "w2" ? { ...wire, points: [{ x: 100, y: 20 }, { x: 180, y: 20 }] } : wire)) };
  const moved = translateSelection(bent, selection, 16, 8);
  assert.deepEqual(moved.devices.map((candidate) => [candidate.x, candidate.y]), [[56, 48], [176, 48], [800, 540]]);
  assert.deepEqual(moved.wires[1].points, [{ x: 116, y: 28 }, { x: 196, y: 28 }], "the bends of a wire between moved devices move with them");
  assert.equal(translateSelection(bent, selection, 0, 0), bent);
  const far = translateSelection(layout, selection, -100, -100);
  assert.deepEqual(far.devices.map((candidate) => [candidate.x, candidate.y]).slice(0, 2), [[-60, -60], [60, -60]], "the surface has no edge");
  const bounds = selectionBounds(layout, selection, routes)!;
  assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [40, 40, 192, 72]);
  assert.equal(selectionBounds(layout, { devices: [], wires: [] }, routes), null);
  const removed = removeSelection(layout, { devices: ["knapp-1"], wires: ["w4"] });
  assert.deepEqual(removed.devices.map((candidate) => candidate.id), ["knapp-2", "lampa-1"]);
  assert.deepEqual(removed.wires.map((wire) => wire.id), ["w3"], "the button's wires and the chosen wire are gone");
});

test("copies: Ctrl+D and paste give free ids and labels, keep the wires inside the selection and refuse what will not fit", () => {
  const layout = layoutWith([device("knapp-1", "knapp", 40, 40), device("knapp-2", "knapp", 160, 40), device("lampa-1", "lampa", 800, 540)], [["plc:24V", "knapp-1:1"], ["knapp-1:2", "knapp-2:1"], ["knapp-2:2", "plc:DI0"]]);
  layout.devices[0].label = "Start";
  layout.devices[1].label = "Tryckknapp 2";
  const copy = duplicateSelection(layout, { devices: ["knapp-1", "knapp-2"], wires: [] })!;
  assert.ok(copy);
  assert.deepEqual(copy.devices, ["knapp-3", "knapp-4"]);
  const added = copy.layout.devices.filter((candidate) => copy.devices.includes(candidate.id));
  assert.deepEqual(added.map((candidate) => candidate.label), ["Start 2", "Tryckknapp 4"], "a plain default label gets the next number of its kind");
  for (const candidate of added) assert.ok(!copy.layout.devices.some((other) => other.id !== candidate.id && Math.abs(other.x - candidate.x) < 72 && Math.abs(other.y - candidate.y) < 72), "a copy never lands on another device");
  assert.equal(copy.wires.length, 1, "only the wire between the two copied buttons is copied");
  const copied = copy.layout.wires.find((wire) => wire.id === copy.wires[0])!;
  assert.deepEqual([copied.from, copied.to], [ref("knapp-3:2"), ref("knapp-4:1")]);
  assert.ok(validateLayout(copy.layout).ok);
  assert.equal(copyLabel("Lampa", "lampa", layout.devices), "Lampa 2");
  assert.equal(copyLabel("Lampa 7", "lampa", layout.devices), "Lampa 2");
  assert.equal(copyLabel("Drift", "lampa", layout.devices), "Drift 2");
  const clip = clipOf(layout, { devices: ["lampa-1"], wires: [] });
  const pasted = insertClip(copy.layout, clip, { x: 24, y: 24 })!;
  assert.deepEqual(pasted.devices, ["lampa-2"]);
  assert.equal(insertClip(layout, { devices: [], wires: [], junctions: [] }, { x: 0, y: 0 }), null);
  const full: Layout = { ...layout, devices: Array.from({ length: 120 }, (_, index) => device(`l${index}`, "lampa", 10 + index * 80, 500)) };
  assert.equal(duplicateSelection(full, { devices: ["l0"], wires: [] }), null, "no room for one more device");
  // The PLC's terminals stay where they are: a copied wire to the PLC keeps its PLC end.
  const withPlc = duplicateSelection(layout, { devices: ["knapp-1"], wires: ["w1"] })!;
  assert.equal(withPlc.wires.length, 1);
  const plcWire = withPlc.layout.wires.find((wire) => wire.id === withPlc.wires[0])!;
  assert.deepEqual(plcWire.from, ref("plc:24V"));
  assert.deepEqual(plcWire.to, ref("knapp-3:1"));
  // Routes exist for every wire afterwards, round the plates as before.
  const routes = new WireRouter().routesOf(withPlc.layout);
  assert.equal(routes.size, withPlc.layout.wires.length);
  assert.ok(obstaclesOf(withPlc.layout.devices).length >= withPlc.layout.devices.length + 1, "the PLC and every plate, and the names as well");
  assert.ok(plcTerminalPoint("24V"));
});

// ---------- the surface without edges (2026-11-04) ----------

test("a device let go on another lands on the nearest free place on the grid, and a free place stays as asked", () => {
  const taken = device("k1", "knapp", 40, 40);
  const asked: DeviceInst = device("k2", "knapp", 48, 48);
  const placed = freePlace(asked, [taken]);
  assert.ok(Math.abs(placed.x - taken.x) >= 72 || Math.abs(placed.y - taken.y) >= 72, "not on the other plate");
  assert.equal((placed.x - asked.x) % GRID, 0, "on the grid from where it was asked");
  assert.deepEqual(freePlace(device("k3", "knapp", 2000, -900), [taken]), { x: 2000, y: -900 }, "a free place, also far out and below zero, is taken as it is");
  const onPlc = freePlace(device("k4", "knapp", PLC_BOX.x + 100, PLC_BOX.y + 50), []);
  assert.ok(onPlc.x + 72 <= PLC_BOX.x || onPlc.x >= PLC_BOX.x + PLC_BOX.width || onPlc.y + 72 <= PLC_BOX.y - 8 || onPlc.y >= PLC_BOX.y + PLC_BOX.height + 8, "not on the PLC either");
  // A group keeps its shape: one offset for all.
  const free = freeOffset([device("a", "knapp", 0, 0), device("b", "knapp", 100, 0)], [taken], 0, 0);
  assert.ok(free.dx !== 0 || free.dy !== 0);
});

test("the floating Ta bort stands outside the selected box, its name included, and on nothing else when it can", () => {
  const box = { x: 100, y: 100, width: 72, height: 90 };
  const button = { width: 72, height: 24 };
  const spot = removeButtonSpot(box, [], button, 6);
  assert.ok(spot.x >= box.x + box.width || spot.y + button.height <= box.y || spot.x + button.width <= box.x || spot.y >= box.y + box.height, "outside the box");
  const right = { x: 170, y: 90, width: 120, height: 120 };
  const moved = removeButtonSpot(box, [right], button, 6);
  assert.ok(moved.x + button.width <= right.x || moved.y + button.height <= right.y || moved.y >= right.y + right.height, "it gives way to a neighbour");
});

test("a device's name stands where no lead passes, and wires go round its text", () => {
  // A source has its terminals below: the name goes above. A device with terminals on both sides: to the left, never under a lead.
  assert.ok(labelPlace(DEVICE_DEFS.kalla24).y < 0);
  assert.ok(labelPlace(DEVICE_DEFS.lampa).y > DEVICE_DEFS.lampa.height);
  assert.ok(labelPlace(DEVICE_DEFS.rela).x < 0 && labelPlace(DEVICE_DEFS.rela).anchor === "end", "beside the plate, not below the leads");
  assert.ok(labelBox({ ...device("rela-1", "rela", 300, 100), label: "Relä" }).x + labelBox({ ...device("rela-1", "rela", 300, 100), label: "Relä" }).width <= 300);
  const source = { ...device("kalla24-1", "kalla24", 220, 300), label: "24 V DC" };
  const wall = { ...device("lampa-1", "lampa", 200, 120), label: "L" };
  const layout = layoutWith([source, wall], [["kalla24-1:+", "plc:24V"], ["kalla24-1:−", "plc:0V"], ["lampa-1:X1", "plc:DO0"]]);
  const box = labelBox(source);
  for (const route of new WireRouter().routesOf(layout).values()) assert.ok(!routeCrossesBox(route, [box], false), "no wire over the name");
});

test("the router follows a drawing far from where it started, and a drawing spread very far still gets routes", () => {
  const far = layoutWith([device("k1", "knapp", -3000, -2000), device("k2", "knapp", 4000, 2600)], [["k1:2", "plc:DI0"], ["k2:2", "plc:DI1"], ["k1:1", "k2:1"]]);
  const routes = new WireRouter().routesOf(far);
  assert.equal(routes.size, 3);
  for (const route of routes.values()) assert.ok(orthogonal(route));
  assert.equal(routes.get("w1")![0].x, deviceTerminalPoint(far.devices[0], "2")!.x);
  const spread = layoutWith([device("k1", "knapp", -900_000, -900_000), device("k2", "knapp", 900_000, 900_000)], [["k1:2", "plc:DI0"], ["k1:1", "k2:1"]]);
  const t0 = performance.now();
  const wide = new WireRouter().routesOf(spread);
  assert.equal(wide.size, 2);
  for (const route of wide.values()) assert.ok(orthogonal(route));
  assert.ok(performance.now() - t0 < 500, "no search over a sheet that size");
});

test("version 3 keeps places outside the old sheet; every older place still reads", () => {
  const layout = { ...layoutWith([device("k1", "knapp", -1500, 90_000)], []), outdoorC: 5 };
  const result = validateLayout(layout);
  assert.ok(result.ok && result.layout.devices[0].x === -1500 && result.layout.devices[0].y === 90_000);
  assert.equal(validateLayout({ ...layout, devices: [{ ...layout.devices[0], x: 1e12 }] }).ok, false, "an absurd number is refused");
});
