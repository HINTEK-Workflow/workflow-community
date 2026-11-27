"use client";

import { useMemo, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { ArrowRightLeft, BatteryCharging, Box, Boxes, Building2, ChevronRight, ChevronsDownUp, ChevronsUpDown, Cog, Droplet, Fan, Gauge, GripVertical, Hammer, Lightbulb, PlugZap, Wind, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizePlaceName, placeForest, placeName, type FacilityItem, type PlaceNode } from "@/lib/workflow/customer-facility";

/** The three looks of the tree: an address, an object directly under it, and a sub-object further down. */
export type PlaceTreeLevel = "address" | "object" | "sub";
export const placeTreeLevel = (depth: number): PlaceTreeLevel => depth === 0 ? "address" : depth === 1 ? "object" : "sub";

/**
 * "Strömgatan 18, 123 42 Elstad": the address line of a top-level place, without its name. A street the name already
 * holds is left out (as facilityLabel does), and a postal code without a postort is named – never a bare number under
 * the address (2026-10-15: "446" stood alone under an address).
 */
export const placeAddressLine = (place: FacilityItem) => {
  const street = place.address?.trim() ?? "";
  const named = Boolean(street && place.name && normalizePlaceName(place.name).includes(normalizePlaceName(street)));
  const postal = place.postalCode?.trim() ?? "";
  const city = place.city?.trim() ?? "";
  const town = city ? [postal, city].filter(Boolean).join(" ") : postal ? `Postnummer ${postal}` : "";
  return [named ? "" : street, town].filter(Boolean).join(", ");
};

/** The tree's second line: the address under an address, the type under an object (2026-10-15). */
export const placeTreeLine = (place: FacilityItem, depth: number) => depth === 0 ? placeAddressLine(place) : place.objectType?.trim() ?? "";

// A symbol after what the object is (its type, else its name); a box when nothing matches. Only a picture – nothing is stored.
const ICONS: [RegExp, LucideIcon][] = [
  [/mätar|mätare/i, Gauge],
  [/laddbox|laddstolpe|laddplats|laddpunkt/i, PlugZap],
  [/ladd|ups|batteri|reservkraft|aggregat/i, BatteryCharging],
  [/pump/i, Droplet],
  [/fläkt|ventilation/i, Fan],
  [/belysning|armatur|lampa/i, Lightbulb],
  // Clearer pictures for common machine types (2026-11-02: the cog was "plottrig"); the cog stays for a motor only.
  // Kompressor before press: the word holds "press".
  [/kompressor|tryckluft/i, Wind],
  [/press|stans/i, Hammer],
  [/transportband|transportör|conveyor/i, ArrowRightLeft],
  [/motor/i, Cog],
  [/central|ställverk|tavla|skåp|grupp|kraft/i, Zap],
];
/** The symbol for a type or name, or null when nothing matches (the caller chooses its own default). */
export function typeIcon(text: string): LucideIcon | null {
  return ICONS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}
export function placeIcon(place: Pick<FacilityItem, "name" | "objectType">, level: PlaceTreeLevel): LucideIcon {
  if (level === "address") return Building2;
  const text = `${place.objectType ?? ""} ${place.name}`;
  return typeIcon(text) ?? (level === "object" ? Boxes : Box);
}

/** Every place with something under it: what "Fäll ut alla" folds out (the action card's fixed tool, 2026-10-24). */
export function placeParentIds<T extends FacilityItem>(places: readonly T[], compare?: (a: T, b: T) => number): string[] {
  const ids: string[] = [];
  const walk = (nodes: PlaceNode<T>[]) => { for (const node of nodes) if (node.children.length) { ids.push(node.place.id); walk(node.children); } };
  walk(placeForest(places, compare));
  return ids;
}

/**
 * Dra och släpp in the tree (2026-11-02), a complement to the tree's own move button, which stays for touch and keyboard: the
 * page says what may be dragged and what a drop means. Nothing here knows any rule, and no row moves until the server has answered.
 * A refused drop reaches `drop` too, so that the page can say why (a row that refuses the drop would never get the event).
 */
export type PlaceTreeDrag<T> = {
  canDrag: (place: T) => boolean;
  start: (place: T) => void;
  end: () => void;
  /** True while something from this page is being dragged; anything else (a file, a text) is not this tree's. */
  active: () => boolean;
  /** Over this row: "ok" lights it up, "refused" says it will not do, "same" shows nothing. */
  verdict: (target: T) => "ok" | "refused" | "same";
  drop: (target: T) => void;
};

/**
 * The tree of a customer's places (2026-10-15 night; one of the two Anläggningar panels, PlaceBrowser): one row
 * per place – arrow, icon and two lines of text (the name, and the address under an address or the type under an
 * object). Nothing else stands on a row; the place's content and every action are in the panel beside the tree, and the
 * objects are listed here only. The arrow folds, the row opens the place; several branches may be open at once and only
 * what is folded out is drawn, so a large customer stays light. The open row is marked as the side menu marks its page
 * (`.place-row[data-selected]` in app/globals.css); the icon keeps a tone per level (address blue, object turquoise,
 * sub-object amber).
 */
export function PlaceTreeView<T extends FacilityItem>({ places, open, onToggle, onFoldAll, selected, onOpen, testId = "place-tree", icon = placeIcon, line: lineOf = placeTreeLine, label = "Kundens adresser och objekt", drag, compare }: {
  places: readonly T[];
  /** The order among siblings when it is not by name (Egenkontroll's roles keep the company's own order, 2026-11-24). */
  compare?: (a: T, b: T) => number;
  /** The places that are folded out. */
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** "Fäll ut alla" (every place with something under it) or "Fäll ihop alla" (none); left out, there are no such buttons. */
  onFoldAll?: (ids: string[]) => void;
  /** The place that is open beside the tree: its row is marked. */
  selected?: string | null;
  /** The row was clicked. */
  onOpen: (place: T) => void;
  testId?: string;
  /** Another tree with the same look (the maintenance proposal's machines, 2026-10-30): its own icon per row. Default: placeIcon. */
  icon?: (place: T, level: PlaceTreeLevel) => LucideIcon;
  /** Its own second line per row, text or short status words. Default: placeTreeLine (the address or the object type). */
  line?: (place: T, depth: number) => ReactNode;
  /** The tree's accessible name. */
  label?: string;
  /** Rows can be dragged (only with a mouse: never given on the phone). */
  drag?: PlaceTreeDrag<T>;
}) {
  const forest = useMemo(() => placeForest(places, compare), [places, compare]);
  const [over, setOver] = useState<string | null>(null);
  const parents = useMemo(() => onFoldAll ? placeParentIds(places, compare) : [], [onFoldAll, places, compare]);

  const render = (node: PlaceNode<T>, depth: number) => {
    const { place } = node;
    const level = placeTreeLevel(depth);
    const Icon = icon(place, level);
    const isOpen = open.has(place.id);
    const foldable = node.children.length > 0;
    const line = lineOf(place, depth);
    const chosen = selected === place.id;
    const draggable = Boolean(drag?.canDrag(place));
    const verdict = drag && over === place.id ? drag.verdict(place) : null;
    const dragProps = drag ? {
      draggable: draggable || undefined,
      onDragStart: draggable ? (event: DragEvent<HTMLDivElement>) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", placeName(place)); drag.start(place); } : undefined,
      onDragEnd: () => { setOver(null); drag.end(); },
      onDragOver: (event: DragEvent<HTMLDivElement>) => { if (!drag.active()) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (over !== place.id) setOver(place.id); },
      onDragLeave: (event: DragEvent<HTMLDivElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver((current) => current === place.id ? null : current); },
      onDrop: (event: DragEvent<HTMLDivElement>) => { if (!drag.active()) return; event.preventDefault(); setOver(null); drag.drop(place); },
    } : {};
    return <li key={place.id} className="place-node" data-level={level} data-testid="place-node" data-place-id={place.id} data-depth={depth}
      role="treeitem" aria-level={depth + 1} aria-expanded={foldable ? isOpen : undefined} aria-selected={chosen}>
      <div className="place-row" style={{ "--depth": depth } as CSSProperties} data-selected={chosen ? "" : undefined} data-paused={place.isActive ? undefined : ""} data-drop={verdict && verdict !== "same" ? verdict : undefined} {...dragProps}>
        {foldable ? <button type="button" className="place-toggle" aria-label={`${isOpen ? "Fäll ihop" : "Fäll ut"} ${placeName(place)}`} aria-expanded={isOpen}
          onClick={() => onToggle(place.id)} data-testid="place-toggle">
          <ChevronRight className={cn("size-4 transition-transform", isOpen && "rotate-90")} aria-hidden="true" />
        </button> : <span className="place-toggle" aria-hidden="true" />}
        <button type="button" className="place-name-button" onClick={() => onOpen(place)} aria-current={chosen ? "true" : undefined}
          data-testid={depth === 0 ? "place-address" : "place-object"} data-place-id={place.id}>
          <span className="place-icon" aria-hidden="true"><Icon /></span>
          <span className="place-text">
            <span className="place-name">{placeName(place)}{place.isActive ? null : <span className="place-paused"> · Pausad</span>}</span>
            {line ? <span className="place-meta">{line}</span> : null}
          </span>
        </button>
        {draggable ? <span className="place-drag" aria-hidden="true" data-testid="place-drag"><GripVertical /></span> : null}
      </div>
      {isOpen && foldable ? <ul className="place-children" role="group">{node.children.map((child) => render(child, depth + 1))}</ul> : null}
    </li>;
  };

  return <div className="place-tree-box" data-testid={testId}>
    {onFoldAll && parents.length ? <div className="place-tree-tools">
      <button type="button" className="place-tool" onClick={() => onFoldAll(parents)} disabled={parents.every((id) => open.has(id))} title="Fäll ut alla" aria-label="Fäll ut alla" data-testid="place-tree-open-all"><ChevronsUpDown aria-hidden="true" /></button>
      <button type="button" className="place-tool" onClick={() => onFoldAll([])} disabled={!parents.some((id) => open.has(id))} title="Fäll ihop alla" aria-label="Fäll ihop alla" data-testid="place-tree-fold-all"><ChevronsDownUp aria-hidden="true" /></button>
    </div> : null}
    {forest.length ? <ul className="place-tree" role="tree" aria-label={label}>{forest.map((node) => render(node, 0))}</ul> : null}
  </div>;
}
