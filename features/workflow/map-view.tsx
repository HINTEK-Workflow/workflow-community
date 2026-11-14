"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { MAP_LICENSE, MAP_LICENSE_URL, MAP_SOURCE_NAME, type MapStatus } from "@/lib/map/attribution";

/**
 * Kartan (2026-10-04): Lantmäteriets Topografisk webbkarta from this installation's own server, drawn with
 * Leaflet bundled from npm. Nothing is fetched from Lantmäteriet or any other outside source in the browser; without
 * Lantmäteriet's sign-in the map is simply not shown.
 */
let statusRequest: Promise<MapStatus | null> | null = null;
export function useMapStatus() {
  const [status, setStatus] = useState<MapStatus | null>(null);
  useEffect(() => {
    const demo = (window as typeof window & { __workflowDemo?: boolean }).__workflowDemo;
    if (demo) return;
    statusRequest ??= fetch("/api/map/status").then((response) => response.ok ? response.json() as Promise<MapStatus> : null).catch(() => null);
    let active = true;
    void statusRequest.then((value) => { if (active) setStatus(value); });
    return () => { active = false; };
  }, []);
  return status?.enabled ? status : null;
}

export type MapPoint = { id: string; latitude: number; longitude: number; label: string; href?: string;
  /** The pin can be dragged to a new position (the place form, 2026-10-07); `onMove` gets where it was dropped. */
  draggable?: boolean;
  /** A pin that is only context – the position inherited from the place above – drawn grey and faint. */
  muted?: boolean };
export type MapPosition = { latitude: number; longitude: number };
// The middle of Sweden at a zoom that shows the country, when there is nothing to show.
const SWEDEN: [number, number] = [62.5, 16.5];
// What an empty place in the map shows (a tile the server answers 204 for): nothing, never a broken picture.
const EMPTY_TILE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
// A pin that can be dragged: a 28 px head on a 36 px pin, a comfortable target for a finger; the point is the tip.
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" aria-hidden="true"><path d="M14 35C14 35 2 21.5 2 13a12 12 0 0 1 24 0c0 8.5-12 22-12 22Z" fill="#2f7fd1" stroke="#113351" stroke-width="2"/><circle cx="14" cy="13" r="4.5" fill="#fff"/></svg>`;

export function MapAttribution() {
  return <p className="text-[11px] leading-4 text-muted-foreground" data-testid="map-attribution">
    Kartdata: {MAP_SOURCE_NAME} ©Lantmäteriet, <a className="underline" href={MAP_LICENSE_URL} target="_blank" rel="noopener noreferrer">{MAP_LICENSE}</a>. Kartbilderna visas oförändrade; kartnålarna är tillagda i Workflow.
  </p>;
}

/** The map's height (2026-10-24, "kartan är för liten"): 16:9 of its box, at least this on a phone … */
export const MAP_MIN_HEIGHT = 260;
/** … at most this on a computer, and Större karta makes it this much taller (always within the screen). */
export const MAP_MAX_HEIGHT = 420;
export const MAP_LARGE_HEIGHT = 720;
/** The size of the map box as CSS, normal or large; `dvh` keeps it inside a phone's screen. */
export function mapBoxStyle(large: boolean, height = MAP_MAX_HEIGHT): { aspectRatio?: string; minHeight?: string; maxHeight?: string; height?: string } {
  if (large) return { height: `max(${MAP_MIN_HEIGHT}px, min(${Math.max(MAP_LARGE_HEIGHT, Math.round(height * 1.6))}px, 85dvh))` };
  return { aspectRatio: "16 / 9", minHeight: `min(${MAP_MIN_HEIGHT}px, 55dvh)`, maxHeight: `max(${MAP_MIN_HEIGHT}px, min(${height}px, 65dvh))` };
}

export function PlaceMap({ status, points, onPick, onMove, focus, height = MAP_MAX_HEIGHT, label = "Karta", hint: lineText }: {
  status: MapStatus;
  points: MapPoint[];
  /** Setting a pin: a tap or click on the map gives the position. */
  onPick?: (position: MapPosition) => void;
  /** A draggable pin was dropped somewhere else. */
  onMove?: (id: string, position: MapPosition) => void;
  /** Centre the map on this point when it changes ("Visa på karta" on a place row, 2026-10-07). */
  focus?: (MapPosition & { nonce?: number }) | null;
  /** The tallest the map is at its normal size (it is 16:9 of its box up to this); Större karta goes beyond it. */
  height?: number;
  label?: string;
  /** The line under the map; by default it explains the tap when picking is possible. */
  hint?: string | null;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const pick = useRef(onPick);
  const move = useRef(onMove);
  useEffect(() => { pick.current = onPick; move.current = onMove; });
  // Whether the view has been fitted to the pins once; afterwards a moved pin only pans the map when it left the view.
  const framed = useRef("");
  const [ready, setReady] = useState(false);
  // Kartan fångar inte sidans scroll (2026-10-09, 2026-10-24): on a computer the wheel scrolls the page and
  // Ctrl (⌘) + wheel zooms the map; on a touch screen one finger scrolls the page and two fingers move and zoom the map
  // (cooperative gestures), and "Flytta kartan" turns on one-finger dragging until Klar. The zoom buttons and a tap to set
  // the pin always work.
  const [touch, setTouch] = useState(false);
  // Större karta (2026-10-24): one button on every map makes it taller, and back.
  const [large, setLarge] = useState(false);
  const [active, setActive] = useState(false);
  const [hint, setHint] = useState("");
  // Nothing in view has a picture (outside the map, or a map without tiles here): a short line instead of an empty box.
  const [noTiles, setNoTiles] = useState(false);
  const hintTimer = useRef(0);
  const showHint = (text: string) => { setHint(text); window.clearTimeout(hintTimer.current); hintTimer.current = window.setTimeout(() => setHint(""), 1600); };

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current || map.current) return;
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      setTouch(coarse);
      // Leaflet's own handlers: the wheel never zooms by itself. On a touch screen the pinch handler is always on – two
      // fingers move and zoom the map, while its touch-action (pan-x pan-y) leaves one finger to scroll the page – and
      // one-finger dragging waits for "Flytta kartan" (map.dragging is switched below).
      const instance = L.map(container.current, { attributionControl: false, zoomControl: true, minZoom: status.minZoom, maxZoom: status.maxZoom, center: SWEDEN, zoom: Math.max(status.minZoom, 5),
        scrollWheelZoom: false, dragging: !coarse, touchZoom: true, doubleClickZoom: !coarse });
      // Our own server's tiles; the source is named under the map.
      const tiles = L.tileLayer("/api/map/tiles/{z}/{x}/{y}.png", { minZoom: status.minZoom, maxZoom: status.maxZoom, tileSize: 256, crossOrigin: false, errorTileUrl: EMPTY_TILE }).addTo(instance);
      tiles.on("tileerror", (event) => event.tile.classList.add("workflow-map-tile-empty"));
      tiles.on("load", () => setNoTiles(!container.current?.querySelector("img.leaflet-tile-loaded:not(.workflow-map-tile-empty)")));
      layer.current = L.layerGroup().addTo(instance);
      instance.on("click", (event) => pick.current?.({ latitude: round6(event.latlng.lat), longitude: round6(event.latlng.lng) }));
      map.current = instance;
      framed.current = "";
      setReady(true);
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; layer.current = null; };
  }, [status.minZoom, status.maxZoom]);

  // The pins, and a view that shows them all.
  const key = points.map((point) => `${point.id}:${point.latitude}:${point.longitude}:${point.draggable ? "d" : ""}${point.muted ? "m" : ""}`).join("|");
  const ids = points.map((point) => point.id).join("|");
  useEffect(() => {
    if (!ready) return;
    void import("leaflet").then((L) => {
      const instance = map.current, group = layer.current;
      if (!instance || !group) return;
      group.clearLayers();
      for (const point of points) {
        const at: [number, number] = [point.latitude, point.longitude];
        if (point.draggable) {
          const marker = L.marker(at, { draggable: true, keyboard: true, title: point.label, alt: point.label, icon: L.divIcon({ className: "workflow-map-pin", html: PIN_SVG, iconSize: [28, 36], iconAnchor: [14, 35], tooltipAnchor: [0, -30] }) }).addTo(group);
          marker.bindTooltip(point.label, { direction: "top" });
          marker.on("dragend", () => { const { lat, lng } = marker.getLatLng(); move.current?.(point.id, { latitude: round6(lat), longitude: round6(lng) }); });
          continue;
        }
        const marker = L.circleMarker(at, point.muted
          ? { radius: 8, color: "#6b7280", weight: 2, fillColor: "#9ca3af", fillOpacity: 0.5, opacity: 0.7, dashArray: "3 3" }
          : { radius: 8, color: "#113351", weight: 2, fillColor: "#2f7fd1", fillOpacity: 0.9 }).addTo(group);
        marker.bindTooltip(point.label, { direction: "top", offset: [0, -6] });
        if (point.href) marker.on("click", (event) => { L.DomEvent.stopPropagation(event); window.location.href = point.href!; });
      }
      if (!points.length) return;
      const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude] as [number, number]));
      // The same set of pins: a pin that moved (dragged or tapped) pans the map only when it would otherwise be outside.
      if (framed.current === ids) { if (!instance.getBounds().contains(bounds)) instance.panInsideBounds(bounds.pad(0.2), { animate: true }); return; }
      framed.current = ids;
      if (points.length === 1) instance.setView([points[0].latitude, points[0].longitude], Math.min(status.maxZoom, Math.max(instance.getZoom(), 15)));
      else instance.fitBounds(bounds, { padding: [24, 24], maxZoom: Math.min(status.maxZoom, 16) });
    });
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Touch: one finger moves the map only while it is turned on; two fingers always do.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !touch) return;
    for (const handler of [instance.dragging, instance.doubleClickZoom]) { if (active) handler.enable(); else handler.disable(); }
  }, [ready, touch, active]);
  // The box changed size (Större karta, a wider column, a turned phone): Leaflet measures again and keeps the centre.
  useEffect(() => {
    const element = container.current;
    if (!ready || !element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => map.current?.invalidateSize({ pan: true }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);
  // Computer: Ctrl (or ⌘) + wheel zooms around the pointer; a plain wheel scrolls the page and says how to zoom.
  useEffect(() => {
    const element = container.current;
    if (!ready || !element) return;
    let last = 0;
    const onWheel = (event: WheelEvent) => {
      const instance = map.current;
      if (!instance) return;
      if (!(event.ctrlKey || event.metaKey)) { if (!touch) showHint(/Mac|iPhone|iPad/.test(navigator.platform) ? "Håll ⌘ för att zooma" : "Håll Ctrl för att zooma"); return; }
      event.preventDefault();
      const now = Date.now();
      if (now - last < 180 || !event.deltaY) return;
      last = now;
      instance.setZoomAround(instance.mouseEventToContainerPoint(event), instance.getZoom() + (event.deltaY < 0 ? 1 : -1));
    };
    // One finger on a touch screen scrolls the page; the map says how to move it.
    const onTouchMove = (event: TouchEvent) => { if (touch && !active && event.touches.length === 1) showHint("Använd två fingrar för att flytta kartan"); };
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => { element.removeEventListener("wheel", onWheel); element.removeEventListener("touchmove", onTouchMove); };
  }, [ready, touch, active]);
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  // "Visa på karta": the map centres on the place asked for.
  const focusKey = focus ? `${focus.latitude}:${focus.longitude}:${focus.nonce ?? 0}` : "";
  useEffect(() => {
    if (!ready || !focus || !map.current) return;
    map.current.setView([focus.latitude, focus.longitude], Math.min(status.maxZoom, Math.max(map.current.getZoom(), 16)), { animate: true });
  }, [ready, focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const line = lineText === undefined ? (onPick ? "Tryck i kartan för att sätta nålen." : null) : lineText;
  return <div className="space-y-1.5">
    <div className="relative">
      {/* A size that follows the box and the screen: 16:9 of the box's width between MAP_MIN_HEIGHT and `height`, taller
          with Större karta, never taller than the screen. */}
      <div ref={container} role="region" aria-label={label} data-testid="place-map" data-map-size={large ? "large" : "normal"} data-map-active={touch ? String(active) : undefined} data-no-edge-swipe={touch && active ? "" : undefined}
        className={`relative z-0 w-full overflow-hidden rounded-lg border bg-muted/30${touch && active ? " ring-2 ring-primary" : ""}`} style={mapBoxStyle(large, height)} />
      <button type="button" onClick={() => setLarge((value) => !value)} aria-pressed={large} data-testid="map-size"
        className="absolute right-2 top-2 z-[500] flex h-11 items-center gap-1.5 rounded-full border bg-card/95 px-3 text-sm font-medium text-foreground shadow-md sm:h-9">
        {large ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}{large ? "Mindre karta" : "Större karta"}
      </button>
      {touch ? <button type="button" onClick={() => setActive((value) => !value)} aria-pressed={active} data-testid="map-activate"
        className="absolute bottom-2 left-2 z-[500] flex h-11 items-center rounded-full border bg-card/95 px-4 text-sm font-medium text-foreground shadow-md">
        {active ? "Klar" : "Flytta kartan"}
      </button> : null}
      {noTiles && !hint ? <p role="status" className="pointer-events-none absolute inset-x-0 top-1/2 z-[500] mx-auto w-fit max-w-[90%] -translate-y-1/2 rounded-lg border bg-card/95 px-3 py-2 text-center text-sm text-muted-foreground shadow-md" data-testid="map-no-tiles">Inga kartbilder här.</p> : null}
      {hint ? <p role="status" className="pointer-events-none absolute inset-x-0 top-1/2 z-[500] mx-auto w-fit max-w-[90%] -translate-y-1/2 rounded-lg bg-slate-950/75 px-3 py-2 text-center text-sm text-white" data-testid="map-hint">{hint}</p> : null}
    </div>
    {line ? <p className="text-xs text-muted-foreground">{line}</p> : null}
    <MapAttribution />
  </div>;
}
