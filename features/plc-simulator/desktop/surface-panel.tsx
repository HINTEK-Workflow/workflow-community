"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { designedDef, designsVersion, subscribeDesigns } from "@/lib/machine/simulator/surface/device-designs";
import { drawnMidpoint, drawRoute, pathOf, WIRE_STYLES, type WireStyle } from "@/lib/machine/simulator/surface/draw";
import {
  addCorner, type Clip, clipOf, devicesInBox, duplicateSelection, EMPTY_SELECTION, type Hit, hitAt, insertClip, moveCorner as moveCornerOp, moveJunction as moveJunctionOp, moveSegment as moveSegmentOp, removeCorner, removeSelection, segmentMovable, type SelectionSet, selectionBounds, translateSelection, wiresInBox,
} from "@/lib/machine/simulator/surface/edit";
import { createDeviceState } from "@/lib/machine/simulator/surface/engine";
import { type Box, contentBounds, deviceBox, type Dir, endPoint, type EndPoint, freeOffset, GRID, junctionsById, leadOf, PLC_BOX, removeButtonSpot, SNAP, segmentsOf, snap, stepTo, suggestPlace, tidyRoute, unionBox } from "@/lib/machine/simulator/surface/geometry";
import { endKey, type Layout, MAX_BENDS, type Point, SURFACE_HEIGHT, SURFACE_WIDTH, type TerminalRef } from "@/lib/machine/simulator/surface/layout";
import { previewRoute, routeAll } from "@/lib/machine/simulator/surface/route";
import { devicesById } from "@/lib/machine/simulator/surface/wiring";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { DeviceDrawing } from "../surface/device-drawings";
import { PRIMARY, SurfaceDefs } from "../surface/parts";
import { PlcDrawing } from "../surface/plc-drawing";
import { FloatingRemove, FloatingSettings, HoverTip, type MenuItem, SurfaceMenu } from "../surface/surface-overlays";
import { designFor, settableOptions } from "@/lib/machine/simulator/surface/device-designs";
import { DEVICE_DEFS } from "@/lib/machine/simulator/surface/devices";
import { readView, usePreference, writeView } from "../surface/surface-preferences";
import { netLabel, sidesOf, useDrawnWires, useHops, WireLayer } from "../surface/surface-wires";
import type { Selection } from "../surface/use-runtime";
import { useRuntimeSnapshot, useDesktop, useDeskState } from "./context";

// PLC-simulatorn (owner 2026-11-02: "ett kort som är en rityta", a panel of the desktop since 2026-11-04): the surface. Ritverktyget (2026-11-03, the owner:
// "Gör själva ritverktyget bättre", "bättre när man klickade på punkt till punkt", "tydligt hur man tar bort en linje",
// "roligare när sträcken var mer fria"): a wire is drawn point to point in Markera – click a terminal, it lights up and the
// wire follows the pointer round the plates, click the terminal (or wire, or junction) to connect to; Esc or empty surface
// cancels. Dragging from a terminal still works. The Ledning tool draws a free polyline, corner by corner, to a free end or
// anything else. A selected wire shows a floating Ta bort, handles on every corner and end, and a right-click menu; Delete
// and Backspace remove it. Devices snap to the grid with alignment guides, a marquee or Shift+click selects several, arrows
// nudge, Ctrl+D, Ctrl+C/V copy, the wheel zooms at the pointer, Space or the middle button pans, two fingers pan and zoom.
// Wires are drawn Mjuka (soft curves) or Raka (straight with rounded corners), with a hop where two nets cross.
// Since 2026-11-06 (the owner: nothing may change by mistake while panning or zooming) all of the editing above needs Ctrl held,
// Redigera locked on in the toolbar, or the Ledning tool; without them a drag moves the view and a click only selects. A
// device's own button or switch still answers a plain click, and the keys act on the selection as before.

type View = { x: number; y: number; scale: number };
type Guide = { axis: "x" | "y"; at: number };
type Drag =
  | { kind: "devices"; ids: string[]; grab: string; origin: Point; start: Point; dx: number; dy: number; moved: boolean; guides: Guide[] }
  | { kind: "pan"; startX: number; startY: number; viewX: number; viewY: number; moved: boolean; click: SelectionSet }
  | { kind: "marquee"; start: Point; current: Point; additive: boolean }
  | { kind: "wire-new"; from: Hit; start: Point; x: number; y: number; hit: Hit | null; moved: boolean }
  | { kind: "wire-end"; wireId: string; which: "from" | "to"; x: number; y: number; hit: Hit | null }
  | { kind: "segment"; wireId: string; route: Point[]; index: number; horizontal: boolean; value: number; moved: boolean }
  | { kind: "junction"; id: string; x: number; y: number }
  | { kind: "corner"; wireId: string; route: Point[]; index: number; x: number; y: number; moved: boolean }
  | { kind: "pinch"; startDistance: number; startMid: Point; startScale: number }
  | null;
/** A wire being drawn click by click: where it started, the corners clicked so far, the pointer and what it would take. */
type Pending = { from: Hit; points: Point[]; pointer: Point | null; hit: Hit | null };
type Menu = { x: number; y: number; items: MenuItem[] };

/** 10–400 %. One unit of the drawing is one pixel at 100 %. */
const MIN_SCALE = 0.1, MAX_SCALE = 4;
/** How close an edge or centre has to come to another's to snap to it and show a guide. */
const GUIDE_SNAP = 6;
const LONG_PRESS_MS = 500;
/** The floating Ta bort, in pixels. */
const FLOATING_W = 72, FLOATING_H = 24;

const parseRef = (key: string): TerminalRef => { const [device, terminal] = key.split(":"); return { device, terminal }; };
const sameHit = (a: Hit, b: Hit) => (a.kind === "terminal" && b.kind === "terminal" ? endKey(a.ref) === endKey(b.ref) : a.kind === "junction" && b.kind === "junction" ? a.id === b.id : false);

/** The selection as a set, whichever shape the store holds it in. */
const selectionOf = (selected: Selection): SelectionSet => (!selected ? EMPTY_SELECTION : selected.kind === "device" ? { devices: [selected.id], wires: [] } : selected.kind === "wire" ? { devices: [], wires: [selected.id] } : { devices: selected.devices, wires: selected.wires });
const toSelection = (set: SelectionSet): Selection => (set.devices.length + set.wires.length === 0 ? null : set.devices.length === 1 && !set.wires.length ? { kind: "device", id: set.devices[0] } : set.wires.length === 1 && !set.devices.length ? { kind: "wire", id: set.wires[0] } : { kind: "many", devices: [...set.devices], wires: [...set.wires] });

/** The view that shows a box with some air around it, in an element of the given size. */
function fitView(box: Box, size: { w: number; h: number }, pad = 40): View {
  if (!size.w || !size.h) return { x: 0, y: 0, scale: 1 };
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(size.w / (box.width + pad * 2), size.h / (box.height + pad * 2))));
  return { x: box.x + box.width / 2 - size.w / scale / 2, y: box.y + box.height / 2 - size.h / scale / 2, scale };
}
/** The grid's step: a fine one close up, coarser as the view zooms out, so it stays discreet at every zoom. */
const gridStep = (scale: number) => { for (const step of [GRID * 5, GRID * 25, GRID * 125]) if (step * scale >= 16) return step; return GRID * 625; };

/** A polyline for the wire tool's preview: out of the start, through the clicked corners, to the pointer, always orthogonal. */
function polylineOf(anchor: EndPoint, points: readonly Point[], pointer: Point | null): Point[] {
  const path: Point[] = [{ x: anchor.x, y: anchor.y }];
  let dir: Dir = null;
  if (anchor.side) { path.push(leadOf(anchor)); dir = "v"; }
  for (const point of points) dir = stepTo(path, point, dir);
  if (pointer) stepTo(path, pointer, dir);
  return tidyRoute(path);
}

/** The segment of a route a point lies nearest to. */
function nearestSegmentIndex(route: readonly Point[], point: Point): number {
  let best: { index: number; distance: number } | null = null;
  for (const segment of segmentsOf(route)) {
    const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y;
    const length2 = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / length2));
    const distance = Math.hypot(point.x - (segment.a.x + t * dx), point.y - (segment.a.y + t * dy));
    if (!best || distance < best.distance) best = { index: segment.index, distance };
  }
  return best?.index ?? 0;
}

export function SurfacePanel() {
  const { runtime, desk } = useDesktop();
  const snapshot = useRuntimeSnapshot();
  const { tool, wireKind, placing, selectedCorner, popouts, guideTerminals, editLock } = useDeskState();
  // A published device design (PLC-apparater) redraws the surface when it arrives.
  useSyncExternalStore(subscribeDesigns, designsVersion, designsVersion);
  const setSelectedCorner = useCallback((corner: { wireId: string; index: number } | null) => desk.set({ selectedCorner: corner }), [desk]);
  const setTool = useCallback((next: "select" | "wire") => desk.set({ tool: next }), [desk]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [wireStyle] = usePreference<WireStyle>("wireStyle", "soft", WIRE_STYLES);
  const [hover, setHover] = useState<{ wireId: string; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  // Mellanslag pans whenever the pointer is over the surface, also when a device's button or the palette has the focus (the
  // owner 2026-11-06 could not pan: Space only worked while the surface itself had the focus). Never while typing in a field.
  const pointerInsideRef = useRef(false);
  useEffect(() => {
    const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const down = (event: KeyboardEvent) => { if (event.key === " " && pointerInsideRef.current && !typing(event.target)) { event.preventDefault(); setSpaceHeld(true); } };
    const up = (event: KeyboardEvent) => { if (event.key === " ") setSpaceHeld(false); };
    const reset = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", reset); };
  }, []);
  // Ctrl (Cmd on a Mac) held: the surface edits (moves devices, draws wires, a marquee). Without it a drag moves the view and a
  // click only selects, so nothing changes by mistake while panning (the owner 2026-11-06). Redigera locks the editing on.
  const [ctrlHeld, setCtrlHeld] = useState(false);
  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.key === "Control" || event.key === "Meta") setCtrlHeld(true); };
    const up = (event: KeyboardEvent) => { if (event.key === "Control" || event.key === "Meta") setCtrlHeld(false); };
    const reset = () => setCtrlHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", reset); };
  }, []);
  const editing = editLock || ctrlHeld || tool === "wire";
  const editsNow = (event: { ctrlKey: boolean; metaKey: boolean }) => editLock || tool === "wire" || event.ctrlKey || event.metaKey;
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The view: null until the person moves it; until then the remembered one, else the whole sheet, as the element's size allows.
  const [chosenView, setView] = useState<View | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const clipboardRef = useRef<{ clip: Clip; pastes: number } | null>(null);
  const { layout, engine, selected, highlight } = snapshot;
  const selection = useMemo(() => selectionOf(selected), [selected]);
  const select = useCallback((set: SelectionSet) => { runtime.select(toSelection(set)); setSelectedCorner(null); }, [runtime, setSelectedCorner]);

  // The element's size, so the view keeps the drawing's proportions and Anpassa knows the room.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => { const box = svg.getBoundingClientRect(); setSize({ w: Math.round(box.width), h: Math.round(box.height) }); };
    measure();
    // The observer of the window the panel stands in: a panel in a window of its own is measured there.
    const Observer = svg.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const observer = new Observer(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [popouts]);
  const [firstFit] = useState(() => contentBounds(layout, []));
  const view = useMemo((): View => chosenView ?? (size.w && size.h ? readView(MIN_SCALE, MAX_SCALE) ?? fitView(firstFit, size) : { x: 0, y: 0, scale: 1 }), [chosenView, size, firstFit]);
  useEffect(() => { if (!chosenView) return; const timer = setTimeout(() => writeView(chosenView), 300); return () => clearTimeout(timer); }, [chosenView]);
  const viewW = (size.w || SURFACE_WIDTH) / view.scale, viewH = (size.h || SURFACE_HEIGHT) / view.scale;

  const toSurface = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX; point.y = clientY;
    const mapped = point.matrixTransform(matrix.inverse());
    return { x: mapped.x, y: mapped.y };
  }, []);
  /** A surface point as pixels inside the frame (for the floating button, the menu and the tip). */
  const toFrame = useCallback((point: Point) => ({ x: ((point.x - view.x) / viewW) * size.w, y: ((point.y - view.y) / viewH) * size.h }), [view, viewW, viewH, size]);
  const clientToFrame = (clientX: number, clientY: number) => { const box = frameRef.current?.getBoundingClientRect(); return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) }; };

  // What is drawn while something is being dragged: the layout with the moving part where the pointer has it.
  const shownLayout: Layout = useMemo(() => {
    if (!drag) return layout;
    if (drag.kind === "devices") return drag.moved ? translateSelection(layout, { devices: drag.ids, wires: selection.wires }, drag.dx, drag.dy) : layout;
    if (drag.kind === "junction") return moveJunctionOp(layout, drag.id, { x: drag.x, y: drag.y });
    if (drag.kind === "segment" && drag.moved) return moveSegmentOp(layout, drag.wireId, drag.route, drag.index, drag.value);
    if (drag.kind === "corner" && drag.moved) return moveCornerOp(layout, drag.wireId, drag.route, drag.index, { x: drag.x, y: drag.y });
    return layout;
  }, [layout, drag, selection.wires]);
  const quick = drag?.kind === "devices";
  const devices = useMemo(() => devicesById(shownLayout), [shownLayout]);
  const junctions = useMemo(() => junctionsById(shownLayout), [shownLayout]);
  const routes = useMemo(() => routeAll(shownLayout, { quick }), [shownLayout, quick]);
  const drawn = useDrawnWires(shownLayout, routes, wireStyle, devices, junctions, quick);
  const hops = useHops(shownLayout, drawn);
  const highlighted = useMemo(() => engine.findings.find((finding) => finding.id === highlight) ?? null, [engine.findings, highlight]);
  const markedTerminals = useMemo(() => new Set([...(highlighted?.terminals ?? []), ...guideTerminals]), [highlighted, guideTerminals]);
  const markedWires = useMemo(() => new Set(highlighted?.wires ?? []), [highlighted]);
  const selectedWires = useMemo(() => new Set(selection.wires), [selection.wires]);
  const selectedDevices = useMemo(() => new Set(selection.devices), [selection.devices]);

  // Placing from the palette: the pointer is followed over the whole document, and released over the surface it places the device.
  useEffect(() => {
    if (!placing) return;
    const up = (event: PointerEvent) => {
      const svg = svgRef.current;
      const box = svg?.getBoundingClientRect();
      const inside = box && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      const def = designedDef({ kind: placing.kind, options: placing.options ?? {} });
      if (inside) { const point = toSurface(event.clientX, event.clientY); runtime.addDevice(placing.kind, snap(point.x - def.width / 2), snap(point.y - def.height / 2), placing.options); }
      else if (Math.hypot(event.clientX - placing.startX, event.clientY - placing.startY) < 8) {
        const spot = suggestPlace(placing.kind, layout.devices);
        runtime.addDevice(placing.kind, spot.x, spot.y, placing.options);
        // A click in the palette puts the device on a free spot; if that spot is outside the view, the view goes to it.
        const added = { id: "ny", kind: placing.kind, x: spot.x, y: spot.y, label: "", options: {} };
        const room = deviceBox(added);
        const seen = room.x >= view.x && room.y >= view.y && room.x + room.width <= view.x + size.w / view.scale && room.y + room.height <= view.y + size.h / view.scale;
        if (!seen) setView(fitView(contentBounds({ devices: [...layout.devices, added], junctions: layout.junctions }, []), size));
      }
      desk.set({ placing: null });
    };
    const doc = placing.doc;
    doc.addEventListener("pointerup", up, { once: true });
    return () => doc.removeEventListener("pointerup", up);
  }, [placing, runtime, desk, layout.devices, layout.junctions, toSurface, view, size, setView]);

  // The wheel zooms at the pointer (Ctrl+wheel too); a native listener, since React's is passive and could not stop the page's scroll.
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = toSurface(event.clientX, event.clientY);
      const step = event.ctrlKey || event.metaKey ? 1.2 : 1.12;
      const factor = event.deltaY < 0 ? step : 1 / step;
      setView((current) => {
        const base = current ?? viewRef.current;
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, base.scale * factor));
        const ratio = base.scale / scale;
        return { scale, x: point.x - (point.x - base.x) * ratio, y: point.y - (point.y - base.y) * ratio };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toSurface]);

  const hitFor = (point: Point, exclude: { wireId?: string; junctionId?: string } = {}) => hitAt(shownLayout, point, routes, exclude, SNAP / Math.min(1, view.scale));
  const hitPoint = useCallback((hit: Hit | null, fallback: Point): EndPoint | null => {
    if (!hit) return { ...fallback, side: null };
    if (hit.kind === "terminal") return endPoint(hit.ref, devices, junctions);
    if (hit.kind === "junction") { const junction = junctions.get(hit.id); return junction ? { x: junction.x, y: junction.y, side: null } : null; }
    return { ...hit.point, side: null };
  }, [devices, junctions]);
  const clearLongPress = () => { if (longPressRef.current) { clearTimeout(longPressRef.current.timer); longPressRef.current = null; } };
  const openMenuAt = (clientX: number, clientY: number, items: MenuItem[]) => { const at = clientToFrame(clientX, clientY); setMenu({ x: at.x, y: at.y, items }); };

  /** Finishes a wire from the pending start to a hit (or a free end), with the corners clicked on the way. */
  const finishWire = (from: Hit, to: Hit, points: Point[]) => {
    const id = runtime.connectWire(from, to, wireKind, points);
    setPending(null);
    if (id) { select({ devices: [], wires: [id] }); svgRef.current?.focus({ preventScroll: true }); }
    else announce("Ledningen gick inte att dra dit.", true);
    return id;
  };
  /** The wire tool's next corner: the elbow the preview showed and the clicked point. */
  const addPolylinePoint = (current: Pending, point: Point): Pending => {
    const anchor = hitPoint(current.from, point);
    if (!anchor) return current;
    const snapped = { x: snap(point.x), y: snap(point.y) };
    const last = current.points[current.points.length - 1];
    if (last && last.x === snapped.x && last.y === snapped.y) return current;
    // Everything the preview adds after the known corners becomes a corner, the lead left out.
    const known = polylineOf(anchor, current.points, null);
    const preview = polylineOf(anchor, current.points, snapped);
    const tail = known[known.length - 1];
    const fresh = preview.slice(known.length - 1).filter((candidate) => candidate.x !== tail.x || candidate.y !== tail.y);
    return { ...current, points: [...current.points, ...fresh].slice(0, MAX_BENDS) };
  };

  const copy = (set: SelectionSet) => { const clip = clipOf(layout, set); if (clip.devices.length || clip.wires.length) clipboardRef.current = { clip, pastes: 0 }; };
  const paste = () => {
    const held = clipboardRef.current;
    if (!held) return;
    held.pastes += 1;
    const offset = { x: 24 * held.pastes, y: 24 * held.pastes };
    let placed: SelectionSet | null = null;
    runtime.edit((current) => { const result = insertClip(current, held.clip, offset); if (!result) return null; placed = { devices: result.devices, wires: result.wires }; return result.layout; });
    if (placed) select(placed); else announce("Det finns inte plats för fler apparater eller ledningar.", true);
  };
  const duplicate = (set: SelectionSet) => {
    let placed: SelectionSet | null = null;
    runtime.edit((current) => { const result = duplicateSelection(current, set); if (!result) return null; placed = { devices: result.devices, wires: result.wires }; return result.layout; });
    if (placed) select(placed); else announce("Det finns inte plats för fler apparater eller ledningar.", true);
  };
  const removeCurrent = () => {
    if (selectedCorner) { const route = routes.get(selectedCorner.wireId); const chosen = selectedCorner; if (route) runtime.edit((current) => removeCorner(current, chosen.wireId, route, chosen.index)); setSelectedCorner(null); return; }
    if (selection.devices.length + selection.wires.length) runtime.edit((current) => removeSelection(current, selection));
  };
  const nudge = (dx: number, dy: number) => {
    if (!(selection.devices.length + selection.wires.length)) return;
    const moving = layout.devices.filter((device) => selection.devices.includes(device.id)), rest = layout.devices.filter((device) => !selection.devices.includes(device.id));
    const free = freeOffset(moving, rest, dx, dy);
    runtime.edit((current) => translateSelection(current, selection, free.dx, free.dy));
  };

  const menuForWire = (wireId: string, at: Point): MenuItem[] => {
    const wire = layout.wires.find((candidate) => candidate.id === wireId);
    const route = routes.get(wireId);
    const items: MenuItem[] = [{ label: "Ta bort", hint: "Delete", danger: true, onPick: () => runtime.removeWire(wireId) }];
    if (route) items.push({ label: "Lägg till böj", hint: "Dubbelklick", onPick: () => runtime.edit((current) => addCorner(current, wireId, route, nearestSegmentIndex(route, at), at)) });
    if (wire?.points?.length) items.push({ label: "Räta ut", onPick: () => runtime.straightenWire(wireId) });
    return items;
  };
  const menuForDevices = (ids: string[]): MenuItem[] => [
    { label: ids.length > 1 ? `Ta bort (${ids.length})` : "Ta bort", hint: "Delete", danger: true, onPick: () => runtime.edit((current) => removeSelection(current, { devices: ids, wires: selection.wires })) },
    { label: "Duplicera", hint: "Ctrl+D", onPick: () => duplicate({ devices: ids, wires: selection.wires }) },
    { label: "Kopiera", hint: "Ctrl+C", onPick: () => copy({ devices: ids, wires: selection.wires }) },
  ];
  const menuForEmpty = (): MenuItem[] => [
    ...(clipboardRef.current ? [{ label: "Klistra in", hint: "Ctrl+V", onPick: () => paste() }] : []),
    { label: "Markera allt", hint: "Ctrl+A", onPick: () => select({ devices: layout.devices.map((device) => device.id), wires: layout.wires.map((wire) => wire.id) }) },
  ];

  /** Where a dragged device lands: on the grid, or on another plate's or the PLC's edge or centre when one is within reach, with the guide to show it. */
  const snapWithGuides = (grab: Layout["devices"][number], x: number, y: number, moving: ReadonlySet<string>) => {
    const def = designedDef(grab);
    const others: Box[] = [{ x: PLC_BOX.x, y: PLC_BOX.y, width: PLC_BOX.width, height: PLC_BOX.height }, ...layout.devices.filter((device) => !moving.has(device.id)).map((device) => { const other = designedDef(device); return { x: device.x, y: device.y, width: other.width, height: other.height }; })];
    const best = { x: snap(x), y: snap(y) };
    const guides: Guide[] = [];
    let bestX: { delta: number; at: number; offset: number } | null = null, bestY: { delta: number; at: number; offset: number } | null = null;
    for (const other of others) {
      for (const [mine, theirs] of [[0, other.x], [def.width / 2, other.x + other.width / 2], [def.width, other.x + other.width]] as const) { const delta = Math.abs(x + mine - theirs); if (delta <= GUIDE_SNAP && (!bestX || delta < bestX.delta)) bestX = { delta, at: theirs, offset: mine }; }
      for (const [mine, theirs] of [[0, other.y], [def.height / 2, other.y + other.height / 2], [def.height, other.y + other.height]] as const) { const delta = Math.abs(y + mine - theirs); if (delta <= GUIDE_SNAP && (!bestY || delta < bestY.delta)) bestY = { delta, at: theirs, offset: mine }; }
    }
    if (bestX) { best.x = bestX.at - bestX.offset; guides.push({ axis: "x", at: bestX.at }); }
    if (bestY) { best.y = bestY.at - bestY.offset; guides.push({ axis: "y", at: bestY.at }); }
    return { ...best, guides };
  };

  /** A drag that moves the view; let go without moving, it was a click and selects `click`. */
  const startPan = (event: ReactPointerEvent<Element>, click: SelectionSet = EMPTY_SELECTION) => setDrag({ kind: "pan", startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y, moved: false, click });
  const armLongPress = (event: ReactPointerEvent<Element>, fire: () => void) => {
    if (event.pointerType !== "touch") return;
    clearLongPress();
    longPressRef.current = { x: event.clientX, y: event.clientY, timer: setTimeout(() => { longPressRef.current = null; fire(); }, LONG_PRESS_MS) };
  };

  const onSurfacePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    setMenu(null);
    setHover(null);
    const target = event.target as Element;
    const point = toSurface(event.clientX, event.clientY);
    const capture = () => svgRef.current?.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch") {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // A second finger: whatever was going on becomes a pinch (pan and zoom).
      if (pointersRef.current.size === 2) {
        clearLongPress();
        const [a, b] = [...pointersRef.current.values()];
        capture();
        setPending(null);
        setDrag({ kind: "pinch", startDistance: Math.hypot(a.x - b.x, a.y - b.y), startMid: toSurface((a.x + b.x) / 2, (a.y + b.y) / 2), startScale: view.scale });
        return;
      }
    }
    if (event.button !== 0 && event.button !== 1) return;
    svgRef.current?.focus({ preventScroll: true });
    if (event.button === 1 || spaceHeld) { event.preventDefault(); capture(); startPan(event); return; }
    // A wire on its way, click by click: this click says where it goes next.
    if (pending) {
      event.preventDefault();
      const terminal = target.closest<SVGElement>("[data-terminal]")?.dataset.terminal;
      const hit: Hit = terminal ? { kind: "terminal", ref: parseRef(terminal) } : hitFor(point);
      if (hit.kind !== "empty" && !sameHit(hit, pending.from)) { finishWire(pending.from, hit, pending.points); return; }
      if (hit.kind === "empty" && tool === "wire") { setPending(addPolylinePoint(pending, point)); return; }
      if (hit.kind === "empty") setPending(null);
      return;
    }
    // Not editing: a drag anywhere moves the view, a click selects a wire or clears the selection. Nothing in the drawing changes.
    if (!editsNow(event)) {
      event.preventDefault(); capture();
      const wireId = target.closest<SVGElement>("[data-wire][data-segment]")?.dataset.wire;
      const handle = target.closest("[data-corner], [data-wire-end]");
      const click: SelectionSet = wireId
        ? event.shiftKey ? (selectedWires.has(wireId) ? { devices: selection.devices, wires: selection.wires.filter((id) => id !== wireId) } : { devices: selection.devices, wires: [...selection.wires, wireId] }) : { devices: [], wires: [wireId] }
        : handle ? selection : event.shiftKey ? selection : EMPTY_SELECTION;
      startPan(event, click);
      armLongPress(event, () => { setDrag(null); if (wireId) { select({ devices: [], wires: [wireId] }); openMenuAt(event.clientX, event.clientY, menuForWire(wireId, point)); } else openMenuAt(event.clientX, event.clientY, menuForEmpty()); });
      return;
    }
    const terminal = target.closest<SVGElement>("[data-terminal]")?.dataset.terminal;
    if (terminal) {
      event.preventDefault(); capture();
      setDrag({ kind: "wire-new", from: { kind: "terminal", ref: parseRef(terminal) }, start: point, x: point.x, y: point.y, hit: null, moved: false });
      return;
    }
    const cornerHandle = target.closest<SVGElement>("[data-corner]");
    if (cornerHandle?.dataset.corner && cornerHandle.dataset.wire) {
      event.preventDefault(); capture();
      const wireId = cornerHandle.dataset.wire, index = Number(cornerHandle.dataset.corner);
      setSelectedCorner({ wireId, index });
      setDrag({ kind: "corner", wireId, route: [...(routes.get(wireId) ?? [])], index, x: point.x, y: point.y, moved: false });
      return;
    }
    const endHandle = target.closest<SVGElement>("[data-wire-end]");
    if (endHandle?.dataset.wireEnd && endHandle.dataset.wire) {
      event.preventDefault(); capture();
      setDrag({ kind: "wire-end", wireId: endHandle.dataset.wire, which: endHandle.dataset.wireEnd as "from" | "to", x: point.x, y: point.y, hit: null });
      return;
    }
    const junction = target.closest<SVGElement>("[data-junction]")?.dataset.junction;
    if (junction) {
      event.preventDefault(); capture();
      if (tool === "wire") setDrag({ kind: "wire-new", from: { kind: "junction", id: junction }, start: point, x: point.x, y: point.y, hit: null, moved: false });
      else { const place = junctions.get(junction); if (place) setDrag({ kind: "junction", id: junction, x: place.x, y: place.y }); }
      return;
    }
    const segment = target.closest<SVGElement>("[data-wire][data-segment]");
    if (segment?.dataset.wire) {
      event.preventDefault(); capture();
      const wireId = segment.dataset.wire;
      const route = routes.get(wireId) ?? [];
      const index = Number(segment.dataset.segment);
      if (tool === "wire") { const hit = hitFor(point); setDrag({ kind: "wire-new", from: hit.kind === "wire" ? hit : { kind: "wire", wireId, point }, start: point, x: point.x, y: point.y, hit: null, moved: false }); return; }
      if (event.shiftKey) { select(selectedWires.has(wireId) ? { devices: selection.devices, wires: selection.wires.filter((id) => id !== wireId) } : { devices: selection.devices, wires: [...selection.wires, wireId] }); return; }
      if (!(selectedWires.has(wireId) && selection.devices.length + selection.wires.length === 1)) select({ devices: [], wires: [wireId] });
      armLongPress(event, () => { setDrag(null); openMenuAt(event.clientX, event.clientY, menuForWire(wireId, point)); });
      const wire = layout.wires.find((candidate) => candidate.id === wireId);
      const { fromSide, toSide } = wire ? sidesOf(wire, devices, junctions) : { fromSide: null, toSide: null };
      if (route.length > index + 1 && segmentMovable(route, index, fromSide, toSide)) {
        const horizontal = route[index].y === route[index + 1].y;
        setDrag({ kind: "segment", wireId, route, index, horizontal, value: horizontal ? route[index].y : route[index].x, moved: false });
      }
      return;
    }
    if (target === event.currentTarget || target.closest("[data-surface-background]")) {
      event.preventDefault(); capture();
      if (tool === "wire") { setDrag({ kind: "wire-new", from: hitFor(point), start: point, x: point.x, y: point.y, hit: null, moved: false }); return; }
      if (event.pointerType === "touch") { startPan(event); armLongPress(event, () => { setDrag(null); openMenuAt(event.clientX, event.clientY, menuForEmpty()); }); return; }
      setDrag({ kind: "marquee", start: point, current: point, additive: event.shiftKey });
    }
  };
  const onDevicePointerDown = (id: string) => (event: ReactPointerEvent<SVGRectElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu(null);
    if (pending) { setPending(null); return; }
    if (event.pointerType === "touch") pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const device = devices.get(id);
    if (!device) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    svgRef.current?.focus({ preventScroll: true });
    if (event.button === 1 || spaceHeld) { startPan(event); return; }
    if (event.button !== 0) return;
    // Not editing: a click selects the device (Shift adds or removes it), a drag moves the view; the device stays where it is.
    if (!editsNow(event)) {
      const click: SelectionSet = event.shiftKey ? (selectedDevices.has(id) ? { devices: selection.devices.filter((other) => other !== id), wires: selection.wires } : { devices: [...selection.devices, id], wires: selection.wires }) : { devices: [id], wires: [] };
      startPan(event, click);
      const ids = selectedDevices.has(id) ? [...selection.devices] : [id];
      armLongPress(event, () => { setDrag(null); if (!selectedDevices.has(id)) select({ devices: [id], wires: [] }); openMenuAt(event.clientX, event.clientY, menuForDevices(ids)); });
      return;
    }
    if (event.shiftKey) { select(selectedDevices.has(id) ? { devices: selection.devices.filter((other) => other !== id), wires: selection.wires } : { devices: [...selection.devices, id], wires: selection.wires }); return; }
    const ids = selectedDevices.has(id) ? [...selection.devices] : [id];
    if (!selectedDevices.has(id)) select({ devices: [id], wires: [] });
    const point = toSurface(event.clientX, event.clientY);
    armLongPress(event, () => { setDrag(null); openMenuAt(event.clientX, event.clientY, menuForDevices(ids)); });
    setDrag({ kind: "devices", ids, grab: id, origin: { x: device.x, y: device.y }, start: point, dx: 0, dy: 0, moved: false, guides: [] });
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "touch" && pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (longPressRef.current && Math.hypot(event.clientX - longPressRef.current.x, event.clientY - longPressRef.current.y) > 6) clearLongPress();
    const point = toSurface(event.clientX, event.clientY);
    if (pending && !drag) { setPending({ ...pending, pointer: point, hit: hitFor(point) }); return; }
    if (!drag) {
      const segment = (event.target as Element).closest<SVGElement>("[data-wire][data-segment]");
      const at = clientToFrame(event.clientX, event.clientY);
      setHover(segment?.dataset.wire ? { wireId: segment.dataset.wire, x: at.x, y: at.y } : null);
      return;
    }
    switch (drag.kind) {
      case "devices": {
        const grab = layout.devices.find((device) => device.id === drag.grab);
        if (!grab) break;
        const raw = { x: drag.origin.x + (point.x - drag.start.x), y: drag.origin.y + (point.y - drag.start.y) };
        const moved = drag.moved || Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 3;
        const snapped = snapWithGuides(grab, raw.x, raw.y, new Set(drag.ids));
        setDrag({ ...drag, dx: snapped.x - drag.origin.x, dy: snapped.y - drag.origin.y, moved, guides: moved ? snapped.guides : [] });
        break;
      }
      case "pan": {
        const unitsPerPx = viewW / Math.max(1, size.w);
        setDrag({ ...drag, moved: drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3 });
        setView((current) => ({ scale: (current ?? view).scale, x: drag.viewX - (event.clientX - drag.startX) * unitsPerPx, y: drag.viewY - (event.clientY - drag.startY) * unitsPerPx }));
        break;
      }
      case "marquee": setDrag({ ...drag, current: point }); break;
      case "wire-new": setDrag({ ...drag, x: point.x, y: point.y, hit: hitFor(point), moved: drag.moved || Math.hypot(point.x - drag.start.x, point.y - drag.start.y) >= 4 }); break;
      case "wire-end": setDrag({ ...drag, x: point.x, y: point.y, hit: hitFor(point, { wireId: drag.wireId }) }); break;
      case "segment": setDrag({ ...drag, value: drag.horizontal ? point.y : point.x, moved: drag.moved || Math.abs((drag.horizontal ? point.y : point.x) - (drag.horizontal ? drag.route[drag.index].y : drag.route[drag.index].x)) > 3 }); break;
      case "junction": setDrag({ ...drag, x: point.x, y: point.y }); break;
      case "corner": setDrag({ ...drag, x: point.x, y: point.y, moved: drag.moved || Math.hypot(point.x - drag.x, point.y - drag.y) > 2 }); break;
      case "pinch": {
        const touches = [...pointersRef.current.values()];
        if (touches.length < 2) break;
        const [a, b] = touches;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, drag.startScale * (distance / Math.max(1, drag.startDistance))));
        const box = svgRef.current?.getBoundingClientRect();
        if (!box) break;
        const midPx = { x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top };
        const nextViewW = Math.max(1, size.w) / scale, nextViewH = Math.max(1, size.h) / scale;
        setView({ scale, x: drag.startMid.x - (midPx.x / Math.max(1, size.w)) * nextViewW, y: drag.startMid.y - (midPx.y / Math.max(1, size.h)) * nextViewH });
        break;
      }
    }
  };
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    clearLongPress();
    if (event.pointerType === "touch") pointersRef.current.delete(event.pointerId);
    if (!drag) return;
    const point = toSurface(event.clientX, event.clientY);
    switch (drag.kind) {
      case "devices": if (drag.moved && (drag.dx || drag.dy)) {
        const set = { devices: drag.ids, wires: selection.wires };
        // Let go on another device, it lands on the nearest free place on the grid.
        const moving = layout.devices.filter((device) => drag.ids.includes(device.id)), rest = layout.devices.filter((device) => !drag.ids.includes(device.id));
        const { dx, dy } = freeOffset(moving, rest, drag.dx, drag.dy);
        runtime.edit((current) => translateSelection(current, set, dx, dy));
      } break;
      case "pan": if (!drag.moved) select(drag.click); break;
      case "marquee": {
        const box: Box = { x: Math.min(drag.start.x, drag.current.x), y: Math.min(drag.start.y, drag.current.y), width: Math.abs(drag.current.x - drag.start.x), height: Math.abs(drag.current.y - drag.start.y) };
        if (box.width < 4 && box.height < 4) { if (!drag.additive) select(EMPTY_SELECTION); break; }
        const found = { devices: devicesInBox(layout, box), wires: wiresInBox(layout, routes, box) };
        select(drag.additive ? { devices: [...new Set([...selection.devices, ...found.devices])], wires: [...new Set([...selection.wires, ...found.wires])] } : found);
        break;
      }
      case "wire-new": {
        if (drag.moved) { finishWire(drag.from, drag.hit ?? hitFor(point), []); break; }
        // A click: the wire starts here and follows the pointer until the next click says where it goes.
        setPending({ from: drag.from, points: [], pointer: point, hit: null });
        select(EMPTY_SELECTION);
        break;
      }
      case "wire-end": runtime.moveWireEnd(drag.wireId, drag.which, drag.hit ?? hitFor(point, { wireId: drag.wireId })); break;
      case "segment": if (drag.moved) runtime.moveSegment(drag.wireId, drag.route, drag.index, drag.value); break;
      case "junction": runtime.moveJunction(drag.id, { x: drag.x, y: drag.y }); break;
      case "corner": if (drag.moved) { const { wireId, route, index, x, y } = drag; runtime.edit((current) => moveCornerOp(current, wireId, route, index, { x, y })); setSelectedCorner(null); } break;
      case "pinch": break;
    }
    setDrag(null);
  };
  const onPointerCancel = (event: ReactPointerEvent<SVGSVGElement>) => { clearLongPress(); pointersRef.current.delete(event.pointerId); setDrag(null); };
  const onDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const target = event.target as Element;
    const point = toSurface(event.clientX, event.clientY);
    if (pending && tool === "wire") { event.preventDefault(); finishWire(pending.from, { kind: "empty", point: { x: snap(point.x), y: snap(point.y) } }, pending.points); return; }
    const segment = target.closest<SVGElement>("[data-wire][data-segment]");
    if (segment?.dataset.wire && tool === "select" && editsNow(event)) {
      const wireId = segment.dataset.wire, index = Number(segment.dataset.segment);
      const route = routes.get(wireId);
      if (route) { event.preventDefault(); runtime.edit((current) => addCorner(current, wireId, route, index, point)); }
    }
  };
  const onContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    const target = event.target as Element;
    const point = toSurface(event.clientX, event.clientY);
    if (target.closest("[data-terminal]")) return;
    const segment = target.closest<SVGElement>("[data-wire][data-segment]");
    if (segment?.dataset.wire) { const wireId = segment.dataset.wire; if (!selectedWires.has(wireId)) select({ devices: [], wires: [wireId] }); openMenuAt(event.clientX, event.clientY, menuForWire(wireId, point)); return; }
    const device = target.closest<SVGElement>("[data-device]")?.dataset.device;
    if (device) { const ids = selectedDevices.has(device) ? [...selection.devices] : [device]; if (!selectedDevices.has(device)) select({ devices: [device], wires: [] }); openMenuAt(event.clientX, event.clientY, menuForDevices(ids)); return; }
    openMenuAt(event.clientX, event.clientY, menuForEmpty());
  };
  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (event.key === " ") { event.preventDefault(); setSpaceHeld(true); return; }
    if (event.key === "Escape") { event.preventDefault(); if (menu) setMenu(null); else if (pending) setPending(null); else if (drag) setDrag(null); else if (selectedCorner) setSelectedCorner(null); else if (selection.devices.length + selection.wires.length) select(EMPTY_SELECTION); else setTool("select"); return; }
    if (event.key === "Enter" && pending) { event.preventDefault(); const at = pending.pointer ?? pending.points[pending.points.length - 1]; if (at) finishWire(pending.from, { kind: "empty", point: { x: snap(at.x), y: snap(at.y) } }, pending.points); return; }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeCurrent(); return; }
    if (mod && !event.shiftKey && key === "z") { event.preventDefault(); runtime.undo(); return; }
    if (mod && (key === "y" || (event.shiftKey && key === "z"))) { event.preventDefault(); runtime.redo(); return; }
    if (mod && key === "a") { event.preventDefault(); select({ devices: layout.devices.map((device) => device.id), wires: layout.wires.map((wire) => wire.id) }); return; }
    if (mod && key === "d") { event.preventDefault(); if (selection.devices.length) duplicate(selection); return; }
    if (mod && key === "c") { event.preventDefault(); copy(selection); return; }
    if (mod && key === "v") { event.preventDefault(); paste(); return; }
    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const step = (event.shiftKey ? 5 : 1) * GRID;
      nudge(event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
      return;
    }
    if (!mod && key === "l") setTool("wire");
    else if (!mod && key === "v") setTool("select");
  };
  const onKeyUp = (event: React.KeyboardEvent<SVGSVGElement>) => { if (event.key === " ") setSpaceHeld(false); };
  const zoomAt = (factor: number, at: Point) => setView((current) => {
    const base = current ?? view;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, base.scale * factor));
    const ratio = base.scale / scale;
    return { scale, x: at.x - (at.x - base.x) * ratio, y: at.y - (at.y - base.y) * ratio };
  });
  const zoomStep = (factor: number) => zoomAt(factor, { x: view.x + viewW / 2, y: view.y + viewH / 2 });
  const fitContent = () => setView(fitView(contentBounds(layout, [...routes.values()]), size));
  // What the toolbar, the menu and the keys ask of the surface: the commands read the latest closures through a ref.
  const commands = useRef({ zoomStep, fitContent, duplicate, removeCurrent, selection });
  useEffect(() => { commands.current = { zoomStep, fitContent, duplicate, removeCurrent, selection }; });
  useEffect(() => {
    desk.setSurface({
      zoomIn: () => commands.current.zoomStep(1.25), zoomOut: () => commands.current.zoomStep(1 / 1.25), fit: () => commands.current.fitContent(),
      duplicate: () => { const { selection: chosen, duplicate: copyIt } = commands.current; if (chosen.devices.length) copyIt(chosen); },
      remove: () => commands.current.removeCurrent(),
    });
    return () => desk.setSurface(null);
  }, [desk]);
  useEffect(() => { desk.set({ zoom: Math.round(view.scale * 100) }); }, [desk, view.scale]);

  // What the pointer is about to take while a wire is on its way or an end is dragged: lit before the drop; the start stays lit too.
  const liveHit = drag && (drag.kind === "wire-new" || drag.kind === "wire-end") ? drag.hit : pending ? pending.hit : null;
  const startTerminal = pending?.from.kind === "terminal" ? endKey(pending.from.ref) : drag?.kind === "wire-new" && drag.from.kind === "terminal" ? endKey(drag.from.ref) : null;
  const hotTerminal = liveHit?.kind === "terminal" ? endKey(liveHit.ref) : startTerminal;
  const hotJunction = liveHit?.kind === "junction" ? liveHit.id : null;
  const hotWire = liveHit?.kind === "wire" ? liveHit.wireId : null;
  // The rubber band: from where the wire started (or the other end of the one being moved), round the plates, to the pointer.
  const band = useMemo((): Point[] | null => {
    const draftFrom = drag?.kind === "wire-new" ? (drag.moved ? drag.from : null) : pending ? pending.from : null;
    const pointer = drag?.kind === "wire-new" ? { x: drag.x, y: drag.y } : pending?.pointer ?? null;
    const target = drag?.kind === "wire-new" ? drag.hit : pending?.hit ?? null;
    if (draftFrom && pointer) {
      const anchor = hitPoint(draftFrom, pointer);
      const end = hitPoint(target, { x: snap(pointer.x), y: snap(pointer.y) });
      if (!anchor || !end) return null;
      if (tool === "wire") return polylineOf(anchor, pending?.points ?? [], { x: end.x, y: end.y });
      return previewRoute(shownLayout, anchor, end);
    }
    if (drag?.kind === "wire-end") {
      const wire = layout.wires.find((candidate) => candidate.id === drag.wireId);
      const other = wire ? endPoint(drag.which === "from" ? wire.to : wire.from, devices, junctions) : null;
      const end = hitPoint(drag.hit, { x: snap(drag.x), y: snap(drag.y) });
      if (!other || !end) return null;
      return previewRoute(shownLayout, end, other);
    }
    return null;
  }, [drag, pending, tool, shownLayout, devices, junctions, layout.wires, hitPoint]);
  const bandPath = band && band.length > 1 ? pathOf(drawRoute(band, wireStyle, null, null)) : null;
  const bandEnd = band ? band[band.length - 1] : null;

  // Where the floating Ta bort stands: over a selected wire's middle or above the selected devices.
  const floating = useMemo(() => {
    if (drag || pending || menu || !(selection.devices.length + selection.wires.length)) return null;
    const button = { width: FLOATING_W / view.scale, height: FLOATING_H / view.scale }, gap = 6 / view.scale;
    const chosen = new Set(selection.devices);
    const others = [{ x: PLC_BOX.x, y: PLC_BOX.y - 8, width: PLC_BOX.width, height: PLC_BOX.height + 16 }, ...shownLayout.devices.filter((device) => !chosen.has(device.id)).map(deviceBox)];
    if (!selection.devices.length && selection.wires.length === 1) {
      const shape = drawn.get(selection.wires[0]);
      if (!shape) return null;
      const middle = drawnMidpoint(shape);
      return { ...removeButtonSpot({ x: middle.x, y: middle.y, width: 0, height: 0 }, others, button, gap), label: "Ta bort ledningen" };
    }
    const bounds = selectionBounds(shownLayout, selection, routes);
    if (!bounds) return null;
    // The whole of what is selected, the names too: the button stands outside it and covers no text.
    const box = shownLayout.devices.filter((device) => chosen.has(device.id)).map(deviceBox).reduce(unionBox, bounds);
    const count = selection.devices.length + selection.wires.length;
    return { ...removeButtonSpot(box, others, button, gap), label: count > 1 ? `Ta bort ${count} markerade` : "Ta bort apparaten" };
  }, [drag, pending, menu, selection, drawn, shownLayout, routes, view.scale]);
  const floatingAt = floating ? toFrame(floating) : null;
  // One device selected: its settings behind a small cog beside Ta bort.
  const settingsDevice = selection.devices.length === 1 && !selection.wires.length ? shownLayout.devices.find((device) => device.id === selection.devices[0]) ?? null : null;
  const settingsOptions = settingsDevice ? settableOptions(settingsDevice, designFor(settingsDevice)).filter((option) => option.key !== "limitC") : [];

  const count = selection.devices.length + selection.wires.length;
  const dragHow = editing ? "dra för att flytta" : "håll Ctrl och dra för att flytta";
  const hint = pending ? (tool === "wire" ? "Klicka för nästa hörn · klicka en plint eller ledning för att koppla · dubbelklick eller Enter ger en fri ände · Esc avbryter" : "Klicka plinten att koppla till (en ledning ger en förgrening) · Esc avbryter")
    : drag?.kind === "devices" && drag.moved ? "Släpp för att lägga apparaten · hjälplinjerna visar vad den ligger i linje med"
      : selectedCorner ? "Markerat hörn · Delete tar bort hörnet · dra det för att flytta"
        : count === 1 && selection.wires.length === 1 ? (editing ? "Markerad ledning · Delete tar bort · dra hörnen, ändarna eller ett segment · dubbelklick lägger till ett hörn" : "Markerad ledning · Delete tar bort · håll Ctrl för att dra hörn, ändar och segment")
          : count > 1 ? `${count} markerade · Delete tar bort · ${dragHow} · pilarna knuffar · Ctrl+D kopierar`
            : count === 1 ? `Markerad apparat · Delete tar bort · ${dragHow} · Ctrl+D kopierar`
              : tool === "wire" ? "Fri ledning: klicka där den ska börja (plint, ledning eller tom yta), sedan hörn för hörn"
                : editing ? "Redigerar · dra en plint för att koppla · dra apparater · dra på tom yta för att markera flera"
                  : "Dra för att flytta vyn · klicka för att markera · håll Ctrl eller välj Redigera för att flytta och rita";
  const marquee = drag?.kind === "marquee" ? { x: Math.min(drag.start.x, drag.current.x), y: Math.min(drag.start.y, drag.current.y), width: Math.abs(drag.current.x - drag.start.x), height: Math.abs(drag.current.y - drag.start.y) } : null;
  const guides = drag?.kind === "devices" ? drag.guides : [];
  const hoverWire = hover ? layout.wires.find((wire) => wire.id === hover.wireId) ?? null : null;
  const selectedWireForEnds = selection.wires.length === 1 && !selection.devices.length ? shownLayout.wires.find((wire) => wire.id === selection.wires[0]) ?? null : null;

  return <div className="relative flex h-full min-h-0 flex-col" data-testid="plc-surface-card">
        <div ref={frameRef} className="relative min-h-0 min-w-0 flex-1">
          <svg ref={svgRef} viewBox={`${view.x} ${view.y} ${viewW} ${viewH}`} preserveAspectRatio="xMidYMid meet"
            className={cn("absolute inset-0 block h-full w-full touch-none select-none bg-[var(--plc-sheet)] outline-none", placing && "cursor-copy", (tool === "wire" || pending) && !placing && "cursor-crosshair", (spaceHeld || (!editing && !pending && !placing)) && "cursor-grab", drag?.kind === "pan" && drag.moved && "cursor-grabbing")}
            role="application" aria-label="Rityta med PLC och apparater" tabIndex={0} data-testid="plc-surface" data-tool={tool} data-editing={editing ? "true" : "false"} data-pending={pending ? "true" : undefined} data-wire-style={wireStyle}
            onPointerDown={onSurfacePointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onPointerEnter={() => { pointerInsideRef.current = true; }} onPointerLeave={() => { pointerInsideRef.current = false; setHover(null); }} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}>
            <SurfaceDefs />
            <defs>
              <pattern id="plc-grid-live" x={0} y={0} width={gridStep(view.scale)} height={gridStep(view.scale)} patternUnits="userSpaceOnUse">
                <path d={`M ${gridStep(view.scale)} 0 L 0 0 0 ${gridStep(view.scale)}`} fill="none" stroke="var(--plc-sheet-grid)" strokeWidth={1 / view.scale} />
              </pattern>
            </defs>
            {/* No frame and no edge: the grid fills whatever the view shows. */}
            <rect data-surface-background="" data-testid="plc-grid" x={view.x} y={view.y} width={viewW} height={viewH} fill="url(#plc-grid-live)" />
            <WireLayer layout={shownLayout} routes={routes} drawn={drawn} hops={hops} solved={engine.solved} devices={devices} junctions={junctions} selectedWires={selectedWires} selectedCorner={selectedCorner} markedWires={markedWires} hotWire={hotWire} hotJunction={hotJunction} wireTool={tool === "wire"} showHandles={tool === "select" && drag?.kind !== "wire-end"} style={wireStyle} />
            {/* The PLC and the devices are drawn over the wires, so a terminal that already has a wire can start another. */}
            <PlcDrawing engine={engine} onRun={runtime.setRun} hotTerminal={hotTerminal} markedTerminals={markedTerminals} />
            {shownLayout.devices.map((device) => <DeviceDrawing key={device.id} device={device} state={engine.devices[device.id] ?? createDeviceState()} plant={engine.plant} selected={selectedDevices.has(device.id)} highlighted={highlighted?.devices.includes(device.id) ?? false} hotTerminal={hotTerminal} onPointerDown={onDevicePointerDown(device.id)} onTouch={(change) => runtime.touch(device.id, change)} onOption={(key, value) => runtime.setDeviceOption(device.id, key, value)} />)}
            {/* Alignment guides while a device is dragged: thin lines along the edge or centre it lines up with. */}
            {guides.map((guide) => (guide.axis === "x" ? <line key={`x${guide.at}`} x1={guide.at} y1={view.y} x2={guide.at} y2={view.y + viewH} stroke={PRIMARY} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.8} pointerEvents="none" data-testid="plc-guide" />
              : <line key={`y${guide.at}`} x1={view.x} y1={guide.at} x2={view.x + viewW} y2={guide.at} stroke={PRIMARY} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.8} pointerEvents="none" data-testid="plc-guide" />))}
            {/* The selected wire's ends can be taken and moved. */}
            {selectedWireForEnds && tool === "select" && drag?.kind !== "wire-end" ? (["from", "to"] as const).map((which) => { const place = endPoint(selectedWireForEnds[which], devices, junctions); return place ? <circle key={which} cx={place.x} cy={place.y} r={7} fill="#0d1626" stroke={PRIMARY} strokeWidth={2} data-wire-end={which} data-wire={selectedWireForEnds.id} className="cursor-grab" data-testid="plc-wire-handle" /> : null; }) : null}
            {/* The rubber band: the wire on its way, drawn as it will be, to the pointer or to what it would snap to. */}
            {bandPath && bandEnd ? <g pointerEvents="none" data-testid="plc-wire-band">
              <path d={bandPath} fill="none" stroke={PRIMARY} strokeWidth={2.2} strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={bandEnd.x} cy={bandEnd.y} r={liveHit && liveHit.kind !== "empty" ? 7 : 5} fill="#0d1626" stroke={PRIMARY} strokeWidth={2} />
            </g> : null}
            {marquee ? <rect x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} fill={PRIMARY} fillOpacity={0.08} stroke={PRIMARY} strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" data-testid="plc-marquee" /> : null}
          </svg>
          {/* How to move the view, always in sight (the owner 2026-11-06 did not know): the keys that really apply. */}
          <p className="pointer-events-none absolute bottom-1.5 left-2 z-[1] rounded bg-[var(--plc-sheet)]/80 px-1.5 py-0.5 text-[11px] leading-4 text-[var(--plc-sheet-muted)]" data-testid="plc-pan-hint">
            <span className="max-md:hidden">Dra flyttar vyn, hjulet zoomar. Håll Ctrl eller välj Redigera för att flytta och rita.</span>
            <span className="md:hidden">Dra flyttar vyn, nyp zoomar. Välj Redigera för att flytta och rita.</span>
          </p>
          {/* While editing is on, a small label says so (Ctrl held or Redigera locked). */}
          {editing && tool !== "wire" ? <span className="pointer-events-none absolute left-2 top-2 z-[1] rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-primary-foreground" data-testid="plc-edit-badge">{editLock ? "Redigera på" : "Redigerar (Ctrl)"}</span> : null}
          {floating && floatingAt && settingsDevice && settingsOptions.length ? <FloatingSettings x={Math.max(2, Math.min(size.w - FLOATING_W - 2, floatingAt.x) - 30)} y={Math.max(2, Math.min(size.h - FLOATING_H - 2, floatingAt.y))}
            title={settingsDevice.label || DEVICE_DEFS[settingsDevice.kind].label} options={settingsOptions} values={settingsDevice.options} onChange={(key, value) => runtime.setDeviceOption(settingsDevice.id, key, value)} /> : null}
          {floating && floatingAt ? <FloatingRemove x={Math.max(2, Math.min(size.w - FLOATING_W - 2, floatingAt.x))} y={Math.max(2, Math.min(size.h - FLOATING_H - 2, floatingAt.y))} label={floating.label} onRemove={removeCurrent} /> : null}
          {menu ? <SurfaceMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} width={size.w} height={size.h} /> : null}
          {hover && hoverWire && !drag && !pending && !menu ? <HoverTip x={hover.x} y={hover.y} text={netLabel(hoverWire, engine.solved, devices)} /> : null}
        </div>
        <p className="h-[18px] flex-none truncate border-t border-[var(--plc-line)] px-2 leading-[18px] plc-help" aria-live="polite" data-testid="plc-hint">{hint}</p>
  </div>;
}
