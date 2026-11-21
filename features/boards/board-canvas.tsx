"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { MoveDiagonal2 } from "lucide-react";
import { cellsMoved, clampRect, GRID_COLUMNS, placeItem, type Rect } from "@/lib/boards/grid";
import { cardDefinition, CARD_TYPES, type BoardCard, type BoardLayout, type CardType } from "@/lib/boards/model";
import type { CardData } from "@/lib/boards/shapes";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { BoardCardView } from "./board-card";
import { boardAspect, cardBox, cardRows, distanceStyle } from "./board-grid";

/**
 * Redigerarens rutnät (Tavlor etapp 1, 2026-11-18; as Skapa formulär's sheet 2026-11-19): the board in its proportions with faint cell
 * lines, on a sheet under the editor's bar. A card is moved by dragging it and resized by its corner (dnd-kit, as in the form
 * builder); both snap to whole cells, and a card that lands on others pushes them down (lib/boards/grid.ts). A card type from the
 * bar's ribbon can be dragged onto a cell too, which is why the bar is drawn inside this drag area (`toolbar`). The keyboard works:
 * a chosen card moves with the arrow keys, Skift + pil changes its size and Delete removes it. The cards show their real figures
 * and the text size of the board's Avstånd while they are edited. In Förhandsgranska `replace` takes the grid's place.
 */
type Drag = { id: string; kind: "move" | "resize"; from: Rect; target: Rect } | { id: string; kind: "new"; type: CardType; target: Rect | null };
/** The id of a card type dragged from the ribbon. */
export const libraryDragId = (type: CardType) => `library:${type}`;
const libraryType = (id: string): CardType | null => { const type = id.startsWith("library:") ? id.slice(8) : ""; return (CARD_TYPES as readonly string[]).includes(type) ? type as CardType : null; };

export function BoardCanvas({ layout, feed, labels, selected, onSelect, onCards, onRemove, onAddAt, now, toolbar, replace, beside }: {
  layout: BoardLayout;
  feed: Record<string, CardData> | null;
  labels: Record<string, string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCards: (cards: BoardCard[]) => void;
  onRemove: (id: string) => void;
  /** A card type dropped from the ribbon at a place. */
  onAddAt: (type: CardType, rect: Rect) => void;
  now: number;
  /** The editor's bar, inside the drag area so the ribbon's card types can be dragged onto the grid. */
  toolbar?: ReactNode;
  /** Drawn instead of the grid (Förhandsgranska). */
  replace?: ReactNode;
  /** Beside the sheet from 1280 px: the chosen card's settings (the column stays when nothing is chosen, so the sheet never moves). */
  beside?: ReactNode;
}) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const showing = !replace;
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [showing]);
  const cellW = size.w / GRID_COLUMNS;
  const cellH = size.h / layout.rows;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const cardOf = (id: string) => layout.cards.find((card) => card.id === id);

  const targetOf = (current: { id: string; kind: "move" | "resize"; from: Rect }, dx: number, dy: number): Rect => {
    const card = cardOf(current.id)!;
    const moved = cellsMoved(dx, dy, cellW, cellH);
    const rect = current.kind === "move" ? { ...current.from, x: current.from.x + moved.x, y: current.from.y + moved.y } : { ...current.from, w: current.from.w + moved.x, h: current.from.h + moved.y };
    return clampRect(rect, layout.rows, GRID_COLUMNS, cardDefinition(card.type).size);
  };
  /** Where a new card of `type` lands under the pointer: its starting size centred on the cell, inside the board; null outside the grid. */
  const dropOf = (type: CardType, event: DragMoveEvent | DragEndEvent): Rect | null => {
    const box = frame.current?.getBoundingClientRect();
    const begun = event.activatorEvent as PointerEvent | null;
    if (!box || !begun || !cellW || !cellH || typeof begun.clientX !== "number") return null;
    const px = begun.clientX + event.delta.x;
    const py = begun.clientY + event.delta.y;
    if (px < box.left || px > box.right || py < box.top || py > box.bottom) return null;
    const definition = cardDefinition(type);
    return clampRect({ x: Math.round((px - box.left) / cellW - definition.start.w / 2), y: Math.round((py - box.top) / cellH - definition.start.h / 2), ...definition.start }, layout.rows, GRID_COLUMNS, definition.size);
  };
  const place = (id: string, rect: Rect) => {
    const card = cardOf(id);
    if (!card) return;
    if (rect.x === card.x && rect.y === card.y && rect.w === card.w && rect.h === card.h) return;
    const next = placeItem(layout.cards, id, rect, layout.rows, GRID_COLUMNS, cardDefinition(card.type).size);
    if (next) onCards(next);
    else announce("Det finns inte plats för kortet där. Gör plats på tavlan eller välj en annan plats.", true);
  };
  const start = (event: DragStartEvent) => {
    const raw = String(event.active.id);
    const type = libraryType(raw);
    if (type) { setDrag({ id: raw, kind: "new", type, target: null }); return; }
    const kind = raw.startsWith("resize:") ? "resize" : "move";
    const id = kind === "resize" ? raw.slice(7) : raw;
    const card = cardOf(id);
    if (!card) return;
    onSelect(id);
    const from = { x: card.x, y: card.y, w: card.w, h: card.h };
    setDrag({ id, kind, from, target: from });
  };
  const move = (event: DragMoveEvent) => setDrag((current) => !current ? current : current.kind === "new" ? { ...current, target: dropOf(current.type, event) } : { ...current, target: targetOf(current, event.delta.x, event.delta.y) });
  const end = (event: DragEndEvent) => {
    if (drag?.kind === "new") { const rect = dropOf(drag.type, event); if (rect) onAddAt(drag.type, rect); }
    else if (drag) place(drag.id, targetOf(drag, event.delta.x, event.delta.y));
    setDrag(null);
  };
  const keys = (event: KeyboardEvent, card: BoardCard) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (step[event.key]) {
      event.preventDefault();
      const [dx, dy] = step[event.key];
      const rect = event.shiftKey ? { x: card.x, y: card.y, w: card.w + dx, h: card.h + dy } : { x: card.x + dx, y: card.y + dy, w: card.w, h: card.h };
      place(card.id, clampRect(rect, layout.rows, GRID_COLUMNS, cardDefinition(card.type).size));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemove(card.id);
    } else if (event.key === "Escape") onSelect(null);
  };

  return <DndContext sensors={sensors} onDragStart={start} onDragMove={move} onDragEnd={end} onDragCancel={() => setDrag(null)}>
    {toolbar}
    {replace ?? <div className="grid items-start gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]" data-testid="board-layout">{beside}<div className="min-w-0 rounded-xl border bg-card p-2 shadow-sm sm:p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect(null); }} data-testid="board-sheet">
      <div className="mx-auto w-full" style={{ maxWidth: layout.orientation === "portrait" ? "30rem" : undefined }}>
        <div ref={frame} className="relative w-full rounded-lg border bg-muted/40" style={{ aspectRatio: boardAspect(layout), ...distanceStyle(layout.distance), backgroundImage: "linear-gradient(to right, color-mix(in srgb, var(--border) 70%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 70%, transparent) 1px, transparent 1px)", backgroundSize: `${100 / GRID_COLUMNS}% ${100 / layout.rows}%` }}
          onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect(null); }}
          role="group" aria-label="Tavlans rutnät" data-testid="board-canvas" data-distance={layout.distance ?? "near"}>
          {layout.cards.map((card) => <CanvasCard key={card.id} card={card} rows={layout.rows} data={feed?.[card.id]} label={labels[card.id] ?? feed?.[card.id]?.label} chosen={selected === card.id}
            dragging={drag && drag.kind !== "new" && drag.id === card.id ? drag.kind : null} onSelect={() => onSelect(card.id)} onKey={(event) => keys(event, card)} now={now} />)}
          {drag?.target ? <div className="pointer-events-none absolute rounded-lg border-2 border-dashed border-primary bg-primary/10" style={cardBox(drag.target, layout.rows)} aria-hidden="true" data-testid="board-drop-target" /> : null}
          {!layout.cards.length ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">Klicka på en korttyp i raden ovanför, eller dra den hit.</p> : null}
        </div>
      </div>
    </div></div>}
    <DragOverlay dropAnimation={null}>{drag?.kind === "new" ? <div className="rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-lg">{cardDefinition(drag.type).label}</div> : null}</DragOverlay>
  </DndContext>;
}

/** A card type in the ribbon that can also be dragged onto the grid (the form builder's DraggableBlock, for cards). */
export function useLibraryDrag(type: CardType, disabled?: boolean) {
  return useDraggable({ id: libraryDragId(type), data: { kind: "library", type }, disabled });
}

function CanvasCard({ card, rows, data, label, chosen, dragging, onSelect, onKey, now }: {
  card: BoardCard; rows: number; data?: CardData; label?: string; chosen: boolean; dragging: "move" | "resize" | null;
  onSelect: () => void; onKey: (event: KeyboardEvent) => void; now: number;
}) {
  const { setNodeRef, attributes, listeners, transform } = useDraggable({ id: card.id });
  const { setNodeRef: setCornerRef, attributes: cornerAttributes, listeners: cornerListeners } = useDraggable({ id: `resize:${card.id}` });
  const shift = dragging === "move" && transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined;
  const name = `${cardDefinition(card.type).label}${card.title ? `: ${card.title}` : label ? `: ${label}` : ""}`;
  return <div ref={setNodeRef} {...attributes} {...listeners} role="button" aria-pressed={chosen} aria-label={`${name}. Bredd ${card.w}, höjd ${card.h}. Pilarna flyttar, Skift och pilarna ändrar storleken.`}
    tabIndex={0} onClick={onSelect} onKeyDown={onKey} onFocus={onSelect}
    className={cn("absolute cursor-grab p-1 outline-none touch-none", dragging && "z-20 cursor-grabbing opacity-80")}
    style={{ ...cardBox(card, rows), ...cardRows(card), transform: shift }} data-testid="board-canvas-card" data-card-id={card.id}>
    <div className={cn("pointer-events-none h-full rounded-lg ring-offset-2 ring-offset-background", chosen ? "ring-2 ring-primary" : "")}>
      <BoardCardView card={card} data={data} sourceLabel={label} editing now={now} />
    </div>
    {chosen ? <button type="button" ref={setCornerRef} {...cornerAttributes} aria-label="Ändra storlek" title="Dra för att ändra storlek"
      onPointerDown={(event: ReactPointerEvent) => { event.stopPropagation(); cornerListeners?.onPointerDown?.(event as never); }}
      className="absolute -bottom-1 -right-1 z-10 flex size-6 cursor-nwse-resize items-center justify-center rounded-full border bg-card text-primary shadow touch-none" data-testid="board-card-resize">
      <MoveDiagonal2 className="size-3.5" aria-hidden="true" />
    </button> : null}
  </div>;
}
