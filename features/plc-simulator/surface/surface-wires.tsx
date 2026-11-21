"use client";

import { useMemo } from "react";
import { type Drawn, drawRoute, hopRadius, hopsOf, pathOf, segmentPaths, wiringGroups, type WireStyle } from "@/lib/machine/simulator/surface/draw";
import { cornersOf, type Routes, segmentMovable } from "@/lib/machine/simulator/surface/edit";
import { endPoint, type Side } from "@/lib/machine/simulator/surface/geometry";
import { type DeviceInst, endKey, type Junction, type Layout, PLC_DEVICE_ID, type Point, type Wire, wiresAtJunction } from "@/lib/machine/simulator/surface/layout";
import { platesOf } from "@/lib/machine/simulator/surface/route";
import { netLevelOf, potential, type Solved, wireColour, type WireColour } from "@/lib/machine/simulator/surface/wiring";
import { cn } from "@/lib/utils";
import { PRIMARY, WARN } from "./parts";

// PLC-simulatorn (ritverktyget, 2026-11-03): the wires as drawn on the surface. Every wire's route becomes a
// drawn polyline in the chosen style (Mjuka or Raka, draw.ts), cached per wire so a drag redraws only what moved; the
// crossings between nets get their hops; a junction dot stands only where three or more wires really meet; a selected wire
// shows a handle on every corner and at both ends. The pointer picks a wire through transparent wide paths, one per route
// segment, so a segment can be dragged and a corner added where the pointer is.

export const WIRE_LOOK: Record<WireColour, { stroke: string; width: number; edge: string | null }> = {
  plus: { stroke: "#dc2626", width: 3, edge: null },
  minus: { stroke: "#ffffff", width: 3, edge: "#9ca3af" },
  analog: { stroke: "#dc2626", width: 1.5, edge: null },
  signal: { stroke: "#0a111c", width: 2.5, edge: "#8ea2b8" },
};

export type WireSides = { fromSide: Side | null; toSide: Side | null };
export const sidesOf = (wire: Wire, devices: ReadonlyMap<string, DeviceInst>, junctions: ReadonlyMap<string, Junction>): WireSides => ({ fromSide: endPoint(wire.from, devices, junctions)?.side ?? null, toSide: endPoint(wire.to, devices, junctions)?.side ?? null });

type DrawnEntry = { platesKey: string; drawn: Drawn };
/** Drawn polylines by route (the router keeps a route's identity while it stands) and style; forgotten with the route. */
const drawnCache = new WeakMap<readonly Point[], Map<WireStyle, DrawnEntry>>();

/**
 * The drawn polyline of every wire, kept between renders: a wire is drawn again only when its route or the style changed, or
 * – once the pointer has let go – when the plates it might swing over moved.
 */
export function useDrawnWires(layout: Layout, routes: Routes, style: WireStyle, devices: ReadonlyMap<string, DeviceInst>, junctions: ReadonlyMap<string, Junction>, quick: boolean): Map<string, Drawn> {
  const platesKey = useMemo(() => layout.devices.map((device) => `${device.id}:${device.x},${device.y}`).join(";"), [layout.devices]);
  return useMemo(() => {
    const plates = platesOf(layout.devices);
    const out = new Map<string, Drawn>();
    for (const wire of layout.wires) {
      const route = routes.get(wire.id);
      if (!route) continue;
      let byStyle = drawnCache.get(route);
      const cached = byStyle?.get(style);
      if (cached && (quick || cached.platesKey === platesKey)) { out.set(wire.id, cached.drawn); continue; }
      const { fromSide, toSide } = sidesOf(wire, devices, junctions);
      const drawn = drawRoute(route, style, fromSide, toSide, plates);
      if (!byStyle) { byStyle = new Map(); drawnCache.set(route, byStyle); }
      byStyle.set(style, { platesKey: quick ? cached?.platesKey ?? "" : platesKey, drawn });
      out.set(wire.id, drawn);
    }
    return out;
  }, [layout.devices, layout.wires, routes, style, devices, junctions, quick, platesKey]);
}

/** Where wires of different wiring groups cross: the running lengths on the wire drawn on top, per wire. The same in STOP and RUN. */
export function useHops(layout: Layout, drawn: Map<string, Drawn>): Map<string, number[]> {
  const groupKey = useMemo(() => wiringGroups(layout.wires).join(","), [layout.wires]);
  return useMemo(() => {
    const groups = groupKey.split(",").map(Number);
    const order = layout.wires.map((wire) => wire.id);
    const index = new Map(order.map((id, position) => [id, position]));
    const netOf = (id: string) => { const position = index.get(id); return position === undefined ? null : groups[position] ?? null; };
    return hopsOf(drawn, order, netOf);
  }, [layout.wires, drawn, groupKey]);
}

const voltsText = (volts: number) => `${volts.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} V`;

/** What the net under the pointer is and carries: "+24 V · 24,0 V", "0 V", "DI3 · 0 V", "AI0 · 5,0 V", "Ledning · flytande". */
export function netLabel(wire: Wire, solved: Solved, devices: ReadonlyMap<string, DeviceInst>): string {
  const key = endKey(wire.from);
  const net = solved.netOf.get(key);
  const volts = potential(solved, key);
  const plcKeys = net ? net.keys.filter((candidate) => candidate.startsWith(`${PLC_DEVICE_ID}:`)).map((candidate) => candidate.slice(PLC_DEVICE_ID.length + 1)) : [];
  const role = plcKeys.includes("24V") ? "+24 V" : plcKeys.includes("0V") ? "0 V" : plcKeys.find((candidate) => /^(DI|DO|AI|AO)\d+$/.test(candidate))
    ?? (net?.plus.length ? `+ från ${labelOf(net.plus[0].source, devices)}` : net?.minus.length ? `− från ${labelOf(net.minus[0].source, devices)}` : net?.signals.length ? `Signal från ${labelOf(net.signals[0].source, devices)}` : "Ledning");
  if (role === "0 V" && volts === 0) return "0 V";
  return `${role} · ${volts === null ? "flytande" : voltsText(volts)}`;
}
const labelOf = (source: string, devices: ReadonlyMap<string, DeviceInst>) => (source === PLC_DEVICE_ID ? "PLC" : devices.get(source)?.label || source);

export type WireLayerProps = {
  layout: Layout;
  routes: Routes;
  drawn: Map<string, Drawn>;
  hops: Map<string, number[]>;
  solved: Solved;
  devices: ReadonlyMap<string, DeviceInst>;
  junctions: ReadonlyMap<string, Junction>;
  selectedWires: ReadonlySet<string>;
  selectedCorner: { wireId: string; index: number } | null;
  markedWires: ReadonlySet<string>;
  hotWire: string | null;
  hotJunction: string | null;
  wireTool: boolean;
  showHandles: boolean;
  style: WireStyle;
};

export function WireLayer({ layout, routes, drawn, hops, solved, devices, junctions, selectedWires, selectedCorner, markedWires, hotWire, hotJunction, wireTool, showHandles, style }: WireLayerProps) {
  return <>
    {layout.wires.map((wire) => {
      const route = routes.get(wire.id), shape = drawn.get(wire.id);
      if (!route || !shape) return null;
      const colour = wireColour(wire, solved, devices);
      const look = WIRE_LOOK[colour];
      const wireHops = hops.get(wire.id) ?? [];
      const d = pathOf(shape, wireHops, hopRadius(look.width));
      const isSelected = selectedWires.has(wire.id);
      const shorted = solved.shortedWires.has(wire.id);
      const marked = markedWires.has(wire.id);
      const live = netLevelOf(solved, endKey(wire.from)) === "plus";
      const { fromSide, toSide } = sidesOf(wire, devices, junctions);
      const horizontalOf = (segment: number) => route[segment] !== undefined && route[segment + 1] !== undefined && route[segment].y === route[segment + 1].y;
      return <g key={wire.id} data-testid="plc-wire" data-wire={wire.id} data-colour={colour} data-style={style} data-hops={wireHops.length || undefined} data-shorted={shorted || undefined} data-live={live || undefined} data-selected={isSelected || undefined}>
        {isSelected || marked || hotWire === wire.id ? <path d={d} fill="none" stroke={marked ? WARN : PRIMARY} strokeWidth={look.width + 7} strokeOpacity={isSelected ? 0.35 : 0.3} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" /> : null}
        {look.edge ? <path d={d} fill="none" stroke={look.edge} strokeWidth={look.width + 1.5} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" /> : null}
        <path d={d} fill="none" stroke={look.stroke} strokeWidth={isSelected ? look.width + 0.8 : look.width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={shorted ? "6 4" : undefined} className={cn(shorted && "motion-safe:animate-pulse")} pointerEvents="none" data-testid="plc-wire-path" />
        {live && !shorted ? <path d={d} fill="none" stroke="#fecaca" strokeWidth={Math.max(0.8, look.width - 2)} strokeOpacity={0.9} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" /> : null}
        {segmentPaths(shape).map((piece) => <path key={piece.segment} d={piece.d} fill="none" stroke="transparent" strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" data-wire={wire.id} data-segment={piece.segment}
          className={cn(wireTool ? "cursor-crosshair" : segmentMovable(route, piece.segment, fromSide, toSide) ? (horizontalOf(piece.segment) ? "cursor-ns-resize" : "cursor-ew-resize") : "cursor-pointer")} />)}
      </g>;
    })}
    {/* Junctions: a dot only where three or more wires meet (a real node), a ring at a loose end, nothing where two wires simply continue. */}
    {layout.junctions.map((junction) => {
      const count = wiresAtJunction(layout, junction.id).length;
      const loose = count <= 1;
      const touched = wiresAtJunction(layout, junction.id).some((wire) => selectedWires.has(wire.id));
      return <g key={junction.id} data-testid="plc-junction" data-junction={junction.id} data-loose={loose || undefined} data-node={count >= 3 || undefined} className={wireTool ? "cursor-crosshair" : "cursor-move"}>
        <circle cx={junction.x} cy={junction.y} r={9} fill="transparent" data-junction={junction.id} />
        {loose ? <circle cx={junction.x} cy={junction.y} r={4.5} fill="#0d1626" stroke={WARN} strokeWidth={1.8} pointerEvents="none" />
          : count >= 3 ? <circle cx={junction.x} cy={junction.y} r={4} fill="#cbd5e1" pointerEvents="none" />
            : touched && showHandles ? <rect x={junction.x - 3.5} y={junction.y - 3.5} width={7} height={7} fill="var(--card)" stroke={PRIMARY} strokeWidth={1.5} transform={`rotate(45 ${junction.x} ${junction.y})`} pointerEvents="none" /> : null}
        {hotJunction === junction.id ? <circle cx={junction.x} cy={junction.y} r={9} fill="none" stroke={PRIMARY} strokeWidth={1.5} strokeDasharray="2 2" pointerEvents="none" /> : null}
      </g>;
    })}
    {/* The selected wires' corners: a square handle on every bend, the chosen one filled. */}
    {showHandles ? layout.wires.filter((wire) => selectedWires.has(wire.id)).map((wire) => {
      const route = routes.get(wire.id);
      if (!route) return null;
      const { fromSide, toSide } = sidesOf(wire, devices, junctions);
      return cornersOf(wire, route, fromSide, toSide).map((corner, index) => {
        const chosen = selectedCorner?.wireId === wire.id && selectedCorner.index === index;
        return <rect key={`${wire.id}:${index}`} x={corner.x - 4.5} y={corner.y - 4.5} width={9} height={9} rx={1.5} fill={chosen ? PRIMARY : "var(--card)"} stroke={PRIMARY} strokeWidth={1.8} data-wire={wire.id} data-corner={index} data-testid="plc-corner-handle" data-selected={chosen || undefined} className="cursor-move" />;
      });
    }) : null}
  </>;
}
