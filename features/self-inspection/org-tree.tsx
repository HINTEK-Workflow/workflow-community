"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, GripVertical, Link2, Link2Off, Network, Pencil, Plus, Save, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { EditorMoreMenu, EDITOR_ICON_BUTTON, type EditorMenuItem } from "@/components/editor-ribbon";
import { PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/features/kfid/confirm";
import { DialogActions, Field, Modal } from "@/features/kfid/ui";
import { useIsPhone } from "@/features/workflow/use-detail-level";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import type { ProgramContent, SelfInspectionView } from "@/lib/self-inspection/model";
import { arrangeCards, CARD_COLUMNS, CARD_ROWS, chartForest, clampColumn, clampRow, GRID_COLUMNS, proposedTree, roleTree, ROW_PX, treePlaces, wouldRing } from "@/lib/self-inspection/structure";
import { selfInspectionHref } from "@/lib/self-inspection/tabs";
import { rolePeople, type PartProps } from "./roles-page";
import { Tag } from "./shared";

/**
 * Organisation och ansvar (2026-11-24: "bättre och mer flexibelt … lägga till kort, flytta runt som jag vill, redigera
 * direkt i kortet"): a free surface of cards on the page itself – no card around it, no rows, no "under" or "över".
 *
 * - It starts empty. Lägg till kort puts a card on a free place (or where one clicks on the surface); the card opens with a
 *   chooser of role (the roles not yet on the surface, or Ny roll … with a name). Nothing else is asked.
 * - A card is edited in itself: the role and the responsibility of this place. The level requirement (Rollbeskrivningar) and
 *   the people with their levels (Kompetenskort and the hired staff in the programme) are only shown; "Ingen utsedd" warns.
 * - Cards are dragged anywhere and snap to an invisible grid (GRID_COLUMNS across the width, rows of ROW_PX), with a guide when
 *   they line up. Lines are drawn by hand from a card's point to another card: who reports to whom. A card has at most one line
 *   upwards (that line is the programme's tree); a ring is refused and explained. A line is chosen with a click and removed
 *   with × or Delete. Lines follow the cards, with right angles.
 * - Places are kept relative (column and row), so the chart fits every width; the surface grows downwards. Below about 768 px
 *   the chart is an indented tree built from the lines, edited in the cards; there Koppla till … in the card's menu moves it.
 * - Redigera, Ångra (Ctrl+Z), Avbryt (throws everything) and Spara (cards, places, lines and responsibilities at once).
 * - Keyboard: Tab between the cards, the arrows move the chosen card a step, Enter edits, Delete removes, Escape closes.
 * The programme's {{organisation}} and the PDF read the same places and lines (only to read).
 */
type Card = { roleId: string; x: number; y: number; parentId: string | null };
type Draft = { cards: Card[]; texts: Record<string, string>; newRoles: Record<string, string> };
type CardData = { id: string; name: string; level: number | null; isEre: boolean; people: { name: string; level: number | null; hired?: boolean }[] };
const PENDING = "pending";
const NEW_ROLE = "__new__";
const GAP_PX = 8;

/** The room the surface has, measured; null until it is known. */
function useWidth(): [(element: HTMLElement | null) => void, number | null] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}
/** Each card's height, measured, so lines start at a card's lower edge and the surface grows with the cards. */
function useHeights(): [(id: string) => (element: HTMLElement | null) => void, Record<string, number>] {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    observer.current = new ResizeObserver((entries) => setHeights((current) => {
      const next = { ...current };
      // The content's height plus the card's padding and border (py-2 and 1 px).
      for (const entry of entries) { const id = (entry.target as HTMLElement).dataset.measureId; if (id) next[id] = Math.ceil((entry.target as HTMLElement).offsetHeight) + 18; }
      return next;
    }));
    return () => observer.current?.disconnect();
  }, []);
  const refs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const register = useCallback((id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      let last: HTMLElement | null = null;
      ref = (element) => { if (last) observer.current?.unobserve(last); last = element; if (element) observer.current?.observe(element); };
      refs.current.set(id, ref);
    }
    return ref;
  }, []);
  return [register, heights];
}

/** The tree a set of cards makes with its lines (for the narrow form and the screen reader's levels). */
function cardForest(cards: readonly Card[]) {
  return chartForest(cards.map((card) => ({ roleId: card.roleId, parentId: card.parentId, order: card.x * 1000 + card.y })));
}
const depthOf = (cards: readonly Card[], id: string) => { let depth = 0; for (let at = cards.find((card) => card.roleId === id)?.parentId; at && depth < 20; at = cards.find((card) => card.roleId === at)?.parentId) depth += 1; return depth; };
/** A free place: under the lowest card, in the middle. */
function freePlace(cards: readonly Card[], heights: Record<string, number>): { x: number; y: number } {
  if (!cards.length) return { x: GRID_COLUMNS / 2 - CARD_COLUMNS / 2, y: 0 };
  const bottom = Math.max(...cards.map((card) => card.y + Math.ceil((heights[card.roleId] ?? 96) / ROW_PX)));
  return { x: GRID_COLUMNS / 2 - CARD_COLUMNS / 2, y: bottom + 2 };
}

/** The width of a name's longest word in the card's title font (measured once per name, in the browser). */
const wordWidths = new Map<string, number>();
function longestWord(name: string): number {
  if (!name || typeof document === "undefined") return 0;
  const known = wordWidths.get(name);
  if (known !== undefined) return known;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return 0;
  context.font = `500 14px ${getComputedStyle(document.body).fontFamily}`;
  const widest = Math.max(...name.split(/\s+/).map((word) => context.measureText(word).width));
  wordWidths.set(name, widest);
  return widest;
}

/**
 * The card's title. Whole words only; `hyphenate` (a word that does not fit even in a wider card) lets that word break with a
 * hyphen. With a grip (the surface's editor) the grip and the buttons get a row of their own, so the name has the card's width.
 */
function CardHead({ name, isEre = false, lead, actions, hyphenate = false }: { name: string; isEre?: boolean; lead?: ReactNode; actions?: ReactNode; hyphenate?: boolean }) {
  const title = <span className={cn("min-w-0 flex-1 py-0.5 text-sm font-medium leading-5 [overflow-wrap:normal]", hyphenate ? "hyphens-auto" : "hyphens-manual")} data-testid="org-card-name">{name}{isEre ? <span className="ml-1.5 align-middle"><Tag tone="primary">ERE</Tag></span> : null}</span>;
  if (lead) return <>
    <div className="-mt-0.5 flex items-center gap-1">{lead}<span className="flex-1" />{actions}</div>
    <div className="flex">{title}</div>
  </>;
  return <div className="flex items-start gap-1">{title}{actions}</div>;
}
/** The card's own text: the people with their levels and the role's level requirement. */
function CardFacts({ data }: { data: CardData }) {
  return <>
    <span className={cn("mt-0.5 block text-xs hyphens-manual [overflow-wrap:normal]", data.people.length ? "text-muted-foreground" : "text-amber-800 dark:text-amber-200")} data-testid="org-card-people">
      {data.people.length ? data.people.map((person) => `${person.name}${person.hired ? " (inhyrd)" : ""}${person.level ? ` · nivå ${person.level}` : ""}`).join(", ") : "Ingen utsedd"}</span>
    {data.level ? <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground" data-testid="self-inspection-role-level">Nivåkrav {data.level}</span> : null}
  </>;
}

/**
 * The surface: cards at their places and the lines between them; read only, or the editor when `edit` is given. Narrower than
 * a card row allows (about 768 px) it is the indented tree.
 */
type EditApi = {
  selected: string | null; open: string | null; drawing: boolean;
  select: (id: string | null) => void; openCard: (id: string | null) => void;
  move: (id: string, x: number, y: number) => void; link: (childId: string, parentId: string) => void; unlink: (childId: string) => void;
  remove: (id: string) => void; placePending: (x: number, y: number) => void;
  renderOpen: (id: string) => ReactNode; menu: (id: string) => ReactNode; selectedLink: string | null; selectLink: (childId: string | null) => void;
};
function ChartSurface({ cards, dataOf, texts, selectedRead, onSelectRead, edit, forceTree = false, pending, gliding = false }: {
  cards: Card[]; dataOf: (id: string) => CardData | null; texts: Record<string, string>; selectedRead?: string | null; onSelectRead?: (id: string) => void;
  edit?: EditApi; forceTree?: boolean; pending?: { x: number; y: number } | null; gliding?: boolean;
}) {
  const [measure, width] = useWidth();
  const [heightRef, heights] = useHeights();
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number } | null>(null);
  const [linking, setLinking] = useState<{ from: string; up: boolean; px: number; py: number } | null>(null);
  const [surfaceElement, setSurfaceElement] = useState<HTMLDivElement | null>(null);
  // The free surface from about 640 px of room; the indented tree only on a phone and in very narrow windows.
  const tree = forceTree || (width !== null && width < 640);
  const column = width ? width / GRID_COLUMNS : 0;
  const cardWidth = CARD_COLUMNS * column - GAP_PX;
  const shown = cards.map((card) => drag && drag.id === card.roleId ? { ...card, x: drag.x, y: drag.y } : card);
  const all = pending ? [...shown, { roleId: PENDING, x: pending.x, y: pending.y, parentId: null }] : shown;
  // A word is never broken in the middle (2026-11-24): a card whose longest word does not fit grows a little (at most a
  // third, around its middle and inside the surface); only a word that still does not fit is hyphenated.
  const needOf = (card: Card) => Math.ceil(longestWord(card.roleId === PENDING ? "" : dataOf(card.roleId)?.name ?? "")) + 22;
  // Cards on one row are as high as the highest of them (an opened or chosen card only grows itself), so the lines are even.
  const natural = (id: string) => heights[id] ?? 96;
  const expanded = (id: string) => Boolean(edit ? edit.open === id || id === PENDING : selectedRead === id);
  const rowHeight = (card: Card) => Math.max(natural(card.roleId), ...all.filter((other) => other.y === card.y && !expanded(other.roleId)).map((other) => natural(other.roleId)));
  // The room beside a card on its rows, up to the next card (keeping the usual gap) or the surface's edge.
  const room = (card: Card) => {
    const start = card.x * column + GAP_PX / 2, end = start + cardWidth;
    let left = start, right = (width ?? end) - end;
    for (const other of all) {
      if (other.roleId === card.roleId || !(other.y * ROW_PX < card.y * ROW_PX + natural(card.roleId) && card.y * ROW_PX < other.y * ROW_PX + natural(other.roleId))) continue;
      const otherStart = other.x * column + GAP_PX / 2, otherEnd = otherStart + cardWidth;
      if (otherEnd <= start) left = Math.min(left, start - otherEnd - GAP_PX); else if (otherStart >= end) right = Math.min(right, otherStart - end - GAP_PX);
    }
    return { left: Math.max(0, left), right: Math.max(0, right) };
  };
  const box = (card: Card) => {
    // Grows around its middle when it can, never over a neighbour; what does not fit is hyphenated (CardHead).
    const growth = Math.max(0, Math.min(needOf(card), cardWidth * 2) - cardWidth);
    const space = growth ? room(card) : { left: 0, right: 0 };
    const toLeft = Math.min(growth / 2, space.left), toRight = Math.min(growth - toLeft, space.right), more = Math.min(growth - toLeft - toRight, space.left - toLeft);
    const left = card.x * column + GAP_PX / 2 - toLeft - more;
    return { left, top: card.y * ROW_PX, width: Math.round(cardWidth + toLeft + toRight + more), height: rowHeight(card) };
  };
  const height = Math.max(...all.map((card) => card.y * ROW_PX + (heights[card.roleId] ?? 96)), 0) + (edit ? ROW_PX * 6 : ROW_PX);
  // Guides while dragging: another card in the same column or on the same row.
  const guides = drag ? { x: shown.some((card) => card.roleId !== drag.id && card.x === drag.x), y: shown.some((card) => card.roleId !== drag.id && card.y === drag.y) } : null;

  const point = (event: { clientX: number; clientY: number }) => { const rect = surfaceElement!.getBoundingClientRect(); return { px: event.clientX - rect.left, py: event.clientY - rect.top }; };
  const autoScroll = (clientY: number) => { if (clientY > window.innerHeight - 48) window.scrollBy(0, 16); else if (clientY < 48) window.scrollBy(0, -16); };
  const startDrag = (event: ReactPointerEvent, card: Card) => {
    if (!edit || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const { px, py } = point(event);
    const at = box(card);
    setDrag({ id: card.roleId, x: card.x, y: card.y, dx: px - at.left, dy: py - at.top });
    edit.select(card.roleId);
  };
  const moveDrag = (event: ReactPointerEvent) => {
    if (!drag) return;
    autoScroll(event.clientY);
    const { px, py } = point(event);
    setDrag({ ...drag, x: clampColumn((px - drag.dx) / column), y: clampRow((py - drag.dy) / ROW_PX) });
  };
  // A drag never also opens the card.
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const endDrag = () => { if (drag && edit) edit.move(drag.id, drag.x, drag.y); setDrag(null); };
  const startLink = (event: ReactPointerEvent, id: string, up: boolean) => {
    if (!edit || id === PENDING) return;
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setLinking({ from: id, up, ...point(event) });
  };
  const moveLink = (event: ReactPointerEvent) => { if (!linking) return; autoScroll(event.clientY); setLinking({ ...linking, ...point(event) }); };
  const endLink = (event: ReactPointerEvent) => {
    if (!linking || !edit) return;
    const target = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-card-id]")?.dataset.cardId;
    setLinking(null);
    if (!target || target === linking.from || target === PENDING) return;
    if (linking.up) edit.link(linking.from, target); else edit.link(target, linking.from);
  };
  const onKey = (event: ReactKeyboardEvent, card: Card) => {
    if (!edit || event.target !== event.currentTarget) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key as "ArrowLeft"];
    if (step && !tree) { event.preventDefault(); edit.move(card.roleId, clampColumn(card.x + step[0]!), clampRow(card.y + step[1]!)); return; }
    if (event.key === "Enter") { event.preventDefault(); edit.select(card.roleId); edit.openCard(card.roleId); }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); edit.remove(card.roleId); }
    if (event.key === "Escape") { event.preventDefault(); edit.openCard(null); }
  };
  const lineDelete = (event: ReactKeyboardEvent) => { if (edit?.selectedLink && (event.key === "Delete" || event.key === "Backspace")) { event.preventDefault(); edit.unlink(edit.selectedLink); } };

  const cardBody = (card: Card, inTree = false) => {
    const data = card.roleId === PENDING ? null : dataOf(card.roleId);
    if (card.roleId !== PENDING && !data) return null;
    const selected = edit ? edit.selected === card.roleId : selectedRead === card.roleId;
    const open = edit && (edit.open === card.roleId || card.roleId === PENDING);
    return <div data-card-id={card.roleId} data-natural-height={inTree ? undefined : heights[card.roleId]} data-testid="org-card" role="treeitem" aria-level={depthOf(cards, card.roleId) + 1} aria-selected={selected}
      aria-label={data?.name ?? "Nytt kort"} tabIndex={0} onKeyDown={(event) => onKey(event, card)}
      onClick={(event) => { event.stopPropagation(); if (edit) { edit.select(card.roleId); if (card.roleId !== PENDING) edit.openCard(card.roleId); } else onSelectRead?.(card.roleId); }}
      className={cn("rounded-lg border bg-card px-2.5 py-2 text-left shadow-xs outline-none transition-[box-shadow,border-color] focus-visible:ring-2 focus-visible:ring-ring", inTree ? "relative" : "absolute",
        selected && "border-primary ring-2 ring-primary/30", drag?.id === card.roleId && "z-20 shadow-lg",
        // Ordna korten: the cards glide to their new places (at once with reduced motion).
        gliding && "transition-[left,top,box-shadow,border-color] duration-[250ms] ease-out motion-reduce:transition-none")}
      style={inTree ? undefined : { left: box(card).left, top: box(card).top, width: box(card).width, minHeight: box(card).height }}>
      {/* No points on the new card before its role is chosen (#11, 2026-11-25: a line drawn from "Nytt kort" took the page down). */}
      {edit && !inTree && card.roleId !== PENDING ? <>
        {/* The points a line is drawn from: up to the one this card reports to, down to one who reports to it. */}
        <span role="presentation" onPointerDown={(event) => startLink(event, card.roleId, true)} onPointerMove={moveLink} onPointerUp={endLink} onClick={stop} title="Dra till kortet som den här rapporterar till"
          className="absolute -top-2 left-1/2 z-10 size-4 -translate-x-1/2 cursor-crosshair rounded-full border-2 border-primary bg-card" data-testid="org-card-point-up" />
        <span role="presentation" onPointerDown={(event) => startLink(event, card.roleId, false)} onPointerMove={moveLink} onPointerUp={endLink} onClick={stop} title="Dra till ett kort som rapporterar hit"
          className="absolute -bottom-2 left-1/2 z-10 size-4 -translate-x-1/2 cursor-crosshair rounded-full border-2 border-primary bg-card" data-testid="org-card-point-down" />
      </> : null}
      {/* The card's own content, measured without the row's common height (cards on one row are as high as the highest). */}
      <div ref={inTree ? undefined : heightRef(card.roleId)} data-measure-id={card.roleId}>
      <CardHead name={data?.name ?? "Nytt kort"} isEre={data?.isEre} hyphenate={!inTree && needOf(card) > box(card).width}
        lead={edit && !inTree && card.roleId !== PENDING ? <span role="presentation" onPointerDown={(event) => startDrag(event, card)} onPointerMove={moveDrag} onPointerUp={endDrag} onClick={stop}
          className="-ml-1 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-secondary active:cursor-grabbing" title="Dra för att flytta" data-testid="org-card-grip"><GripVertical className="size-4" aria-hidden="true" /></span> : null}
        actions={edit && card.roleId !== PENDING ? <>{edit.menu(card.roleId)}
          <button type="button" onClick={(event) => { event.stopPropagation(); edit.remove(card.roleId); }} aria-label={`Ta bort kortet ${data?.name ?? ""}`} title="Ta bort kortet (rollen finns kvar)" data-testid="org-card-remove"
            className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-secondary hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" aria-hidden="true" /></button></> : null} />
      {data && !open ? <CardFacts data={data} /> : null}
      {open ? <div className="mt-1.5">{edit!.renderOpen(card.roleId)}</div> : null}
      {!edit && selected && data ? <div className="mt-2 border-t pt-2 text-xs" data-testid="org-card-detail">
        <p>{texts[card.roleId] || <span className="text-muted-foreground">Inget ansvar beskrivet.</span>}</p>
        {card.roleId.startsWith("new:") ? null : <Link href={selfInspectionHref("roles", { role: card.roleId })} onClick={(event) => event.stopPropagation()} className="mt-1 inline-block text-primary hover:underline" data-testid="org-tree-role-link">Öppna rollen</Link>}
      </div> : null}
      </div>
    </div>;
  };

  if (tree) {
    // The narrow form: the tree the lines make, each card indented under the one it reports to.
    const rows: { card: Card; depth: number }[] = [];
    const walk = (list: ReturnType<typeof cardForest>, depth: number) => { for (const node of list) { const card = cards.find((item) => item.roleId === node.roleId); if (card) rows.push({ card, depth }); walk(node.children, depth + 1); } };
    walk(cardForest(cards), 0);
    return <div ref={measure} className="w-full min-w-0" data-testid="org-chart" data-layout="tree">
      <div role="tree" aria-label="Organisation och ansvar" className="space-y-2">
        {rows.map(({ card, depth }) => <div key={card.roleId} style={{ paddingLeft: `${Math.min(depth, 6)}rem` }} className={depth ? "border-l-2 border-border/0" : undefined}>{cardBody(card, true)}</div>)}
        {pending ? cardBody({ roleId: PENDING, x: 0, y: 0, parentId: null }, true) : null}
      </div>
    </div>;
  }
  const hangingParents = new Set(shown.filter((card) => card.parentId && shown.some((other) => other !== card && other.parentId === card.parentId && other.x === card.x && other.y !== card.y)).map((card) => card.parentId!));
  const lines = shown.flatMap((card) => {
    const parentCard = card.parentId ? shown.find((item) => item.roleId === card.parentId) : undefined;
    if (!parentCard) return [];
    const child = box(card);
    const parent = box(parentCard);
    const sx = parent.left + parent.width / 2, sy = parent.top + parent.height, ex = child.left + child.width / 2, ey = child.top;
    // Hanging children (two of the same parent in one column, on either side of its line): the parent's line runs straight down
    // between the columns and branches into each child's inner edge, so no line runs behind a card.
    if (ey > sy && hangingParents.has(card.parentId!) && (child.left > sx || child.left + child.width < sx)) {
      const into = ey + Math.min(20, child.height / 2);
      const edge = child.left > sx ? child.left : child.left + child.width;
      return [{ id: card.roleId, d: `M${sx},${sy} V${into} H${edge}`, mx: (sx + edge) / 2, my: into }];
    }
    const my = ey > sy ? (sy + ey) / 2 : Math.max(sy, ey) + ROW_PX / 2;
    return [{ id: card.roleId, d: `M${sx},${sy} V${my} H${ex} V${ey}`, mx: ex, my }];
  });
  // The line being drawn starts at its card; a card that is gone (removed, Ångra) draws nothing.
  const linkingFrom = linking ? all.find((card) => card.roleId === linking.from) : undefined;
  return <div ref={measure} className="w-full min-w-0" data-testid="org-chart" data-layout="surface" onKeyDown={lineDelete}>
    <div ref={setSurfaceElement} role="tree" aria-label="Organisation och ansvar" className={cn("relative w-full", edit && "cursor-copy")} style={{ height }} data-testid="org-surface"
      onClick={(event) => { if (!edit || event.target !== event.currentTarget) return; const { px, py } = point(event); edit.selectLink(null); edit.select(null); edit.placePending(clampColumn(px / column - CARD_COLUMNS / 2), clampRow(py / ROW_PX)); }}>
      {width ? <>
        {/* The grid's guides while a card is dragged. */}
        {drag && guides?.x ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-l border-dashed border-primary/60" style={{ left: drag.x * column + GAP_PX / 2 }} data-testid="org-guide" /> : null}
        {drag && guides?.y ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-dashed border-primary/60" style={{ top: drag.y * ROW_PX }} data-testid="org-guide" /> : null}
        <svg aria-hidden="true" className={cn("pointer-events-none absolute inset-0 h-full w-full overflow-visible", gliding ? "opacity-0 motion-reduce:opacity-100" : "opacity-100 transition-opacity duration-150")}>
          {lines.map((line) => <g key={line.id}>
            {edit ? <path d={line.d} className="pointer-events-auto cursor-pointer" stroke="transparent" strokeWidth={14} fill="none" onClick={(event) => { event.stopPropagation(); edit.selectLink(line.id); }} data-testid="org-line-hit" data-child={line.id} /> : null}
            <path d={line.d} fill="none" strokeWidth={edit?.selectedLink === line.id ? 3 : 2} className={edit?.selectedLink === line.id ? "stroke-primary" : "stroke-border"} data-testid="org-line" data-child={line.id} />
          </g>)}
          {linking && linkingFrom ? (() => { const from = box(linkingFrom); const x = from.left + from.width / 2, y = linking.up ? from.top : from.top + from.height;
            return <path d={`M${x},${y} L${linking.px},${linking.py}`} className="stroke-primary" strokeWidth={2} strokeDasharray="4 4" fill="none" />; })() : null}
        </svg>
        {edit?.selectedLink ? (() => { const line = lines.find((item) => item.id === edit.selectedLink); return line ? <button type="button" style={{ left: line.mx - 12, top: line.my - 12 }} onClick={(event) => { event.stopPropagation(); edit.unlink(line.id); }}
          className="absolute z-30 flex size-6 items-center justify-center rounded-full border bg-card text-destructive shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Ta bort kopplingen" data-testid="org-line-remove" autoFocus><X className="size-3.5" aria-hidden="true" /></button> : null; })() : null}
        {all.map((card) => <div key={card.roleId} className="contents">{cardBody(card)}</div>)}
      </> : null}
    </div>
  </div>;
}

/** The cards of a version or a draft as the programme froze them. */
function contentCards(content: Pick<ProgramContent, "roles" | "external" | "orgTree"> & { staff?: ProgramContent["staff"] }) {
  const roles = content.roles.map((role, index) => ({ ...role, id: role.id ?? `role-${index}`, sortOrder: index }));
  const data = new Map<string, CardData>(roles.map((role) => [role.id, { id: role.id, name: role.name, isEre: role.isEre, level: role.level ?? null,
    people: [...role.members.map((member) => ({ name: member.name || "Okänd person", level: content.staff?.find((person) => person.personId === member.personId)?.level ?? null })),
      ...(content.external ?? []).filter((person) => person.roleId === role.id).map((person) => ({ name: person.name, level: person.level, hired: true }))] }]));
  let cards: Card[] = roles.filter((role) => role.chartX !== null && role.chartX !== undefined && role.chartY !== null && role.chartY !== undefined)
    .map((role) => ({ roleId: role.id, x: role.chartX!, y: role.chartY!, parentId: role.parentId ?? null }));
  // A chart saved before cards had places: its tree, laid out.
  if (content.orgTree && !cards.length) {
    const nodes = roleTree(roles, true);
    const places = treePlaces(chartForest(nodes));
    cards = nodes.flatMap((node) => { const at = places.get(node.roleId); return at ? [{ roleId: node.roleId, ...at, parentId: node.parentId }] : []; });
  }
  return { cards, data, texts: Object.fromEntries(roles.map((role) => [role.id, role.responsibility ?? ""])) };
}

/** The chart in the programme (the {{organisation}} marker and the organisation block): the same cards and lines, only to read. */
export function OrgTreeView({ content }: { content: Pick<ProgramContent, "roles" | "external" | "orgTree" | "staff"> }) {
  const { cards, data, texts } = useMemo(() => contentCards(content), [content]);
  const [selected, setSelected] = useState<string | null>(null);
  return <div className="space-y-2" data-testid="self-inspection-org-tree-view">
    {cards.length ? <ChartSurface cards={cards} dataOf={(id) => data.get(id) ?? null} texts={texts} selectedRead={selected} onSelectRead={(id) => setSelected((current) => current === id ? null : id)} />
      : <p className="text-sm text-muted-foreground" data-testid="org-tree-view-empty">Organisationsschemat är inte ritat ännu.</p>}
  </div>;
}

// ---------- the part ----------

function draftOf(view: SelfInspectionView): Draft {
  const program = view.program!;
  const { cards, texts } = contentCards({ roles: program.roles.map((role) => ({ ...role, members: role.members.map((member) => ({ ...member, name: member.name })) })), external: [], orgTree: Boolean(program.orgTreeSaved) });
  return { cards, texts, newRoles: {} };
}
const comparable = (draft: Draft) => JSON.stringify([[...draft.cards].sort((a, b) => a.roleId.localeCompare(b.roleId)), Object.entries(draft.texts).filter(([, text]) => text).sort(), draft.newRoles]);

export function OrgTreePart({ view, busy, run }: PartProps) {
  const program = view.program;
  const router = useRouter();
  const phone = useIsPhone();
  const [draft, setDraft] = useState<Draft | null>(() => program ? draftOf(view) : null);
  const [start, setStart] = useState(() => draft ? comparable(draft) : "");
  const [history, setHistory] = useState<Draft[]>([]);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [linkingFor, setLinkingFor] = useState<string | null>(null);
  const [readSelected, setReadSelected] = useState<string | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const shown = editing && draft ? draft : program ? draftOf(view) : null;
  const dirty = editing && draft !== null && comparable(draft) !== start;
  useUnsavedGuard(dirty && !busy, confirm, undefined, { browserBack: true });

  const roleNames = useMemo(() => new Map((program?.roles ?? []).map((role) => [role.id, role.name])), [program?.roles]);
  const nameOf = (id: string) => roleNames.get(id) ?? shown?.newRoles[id] ?? "rollen";
  const dataOf = (id: string): CardData | null => {
    const role = program?.roles.find((item) => item.id === id);
    if (!role) return shown?.newRoles[id] ? { id, name: shown.newRoles[id]!, level: 1, isEre: false, people: [] } : null;
    return { id, name: role.name, isEre: role.isEre, level: role.level, people: [...rolePeople(view, role).map((person) => ({ name: person.name, level: person.level })),
      ...(view.externalPeople ?? []).filter((person) => person.inProgramme && person.roleId === id).map((person) => ({ name: person.name, level: person.level, hired: true }))] };
  };

  const change = (next: Draft) => { if (draft) setHistory([...history.slice(-50), draft]); setDraft(next); };
  const undo = useCallback(() => { if (!history.length) return; setDraft(history[history.length - 1]!); setHistory(history.slice(0, -1)); }, [history]);
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)) { event.preventDefault(); undo(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, undo]);

  const begin = () => { const fresh = draftOf(view); setDraft(fresh); setStart(comparable(fresh)); setHistory([]); setEditing(true); setSelected(null); setOpen(null); };
  const leave = () => { setHistory([]); setEditing(false); setSelected(null); setOpen(null); setPending(null); setSelectedLink(null); };
  const cancel = async () => { if (dirty && !await confirm({ title: "Kasta ändringarna?", message: "Allt du ändrat i schemat sedan du valde Redigera går förlorat.", confirmLabel: "Kasta ändringarna", tone: "danger" })) return; leave(); };
  const save = async () => {
    if (!program || !draft) return;
    const ids = [...program.roles.map((role) => role.id), ...Object.keys(draft.newRoles)];
    const done = await run({ action: "save_org_tree", revision: program.revision, nodes: ids.map((roleId, index) => {
      const card = draft.cards.find((item) => item.roleId === roleId);
      return { roleId, parentId: card?.parentId ?? null, order: index, responsibility: draft.texts[roleId] ?? "", x: card ? card.x : null, y: card ? card.y : null,
        ...(roleId.startsWith("new:") ? { name: draft.newRoles[roleId] } : {}) };
    }) }, "Organisationen är sparad.");
    if (done) leave();
  };

  // ---------- the editor's changes ----------
  const setCards = (cards: Card[]) => draft && change({ ...draft, cards });
  const move = (id: string, x: number, y: number) => { if (!draft) return; const card = draft.cards.find((item) => item.roleId === id); if (card && (card.x !== x || card.y !== y)) setCards(draft.cards.map((item) => item.roleId === id ? { ...item, x, y } : item)); };
  const link = (childId: string, parentId: string) => {
    if (!draft) return;
    if (wouldRing(draft.cards, childId, parentId)) { announce(`Det skulle bli en ring: ${nameOf(parentId)} rapporterar redan, direkt eller via andra, till ${nameOf(childId)}.`, true); return; }
    const had = draft.cards.find((card) => card.roleId === childId)?.parentId;
    setCards(draft.cards.map((card) => card.roleId === childId ? { ...card, parentId } : card));
    announce(had && had !== parentId ? `${nameOf(childId)} rapporterar nu till ${nameOf(parentId)} i stället för ${nameOf(had)}.` : `${nameOf(childId)} rapporterar till ${nameOf(parentId)}.`);
  };
  const unlink = (childId: string) => { if (!draft) return; setCards(draft.cards.map((card) => card.roleId === childId ? { ...card, parentId: null } : card)); setSelectedLink(null); announce("Kopplingen är borttagen."); };
  const remove = (id: string) => {
    if (!draft) return;
    if (id === PENDING) { setPending(null); return; }
    const { [id]: _gone, ...newRoles } = draft.newRoles;
    void _gone;
    change({ ...draft, newRoles: id.startsWith("new:") ? newRoles : draft.newRoles, cards: draft.cards.filter((card) => card.roleId !== id).map((card) => card.parentId === id ? { ...card, parentId: null } : card) });
    if (selected === id) setSelected(null);
    announce(`Kortet ${nameOf(id)} är borttaget. Rollen finns kvar.`);
  };
  const place = (roleId: string, at: { x: number; y: number }, name?: string) => {
    if (!draft) return;
    change({ ...draft, newRoles: name ? { ...draft.newRoles, [roleId]: name } : draft.newRoles, cards: [...draft.cards, { roleId, ...at, parentId: null }] });
    setPending(null); setSelected(roleId); setOpen(roleId);
  };
  const swapRole = (fromId: string, toId: string, name?: string) => {
    if (!draft) return;
    change({ ...draft, newRoles: name ? { ...draft.newRoles, [toId]: name } : draft.newRoles, texts: { ...draft.texts, [toId]: draft.texts[toId] || draft.texts[fromId] || "" },
      cards: draft.cards.map((card) => card.roleId === fromId ? { ...card, roleId: toId } : card.parentId === fromId ? { ...card, parentId: toId } : card) });
    setSelected(toId); setOpen(toId);
  };
  // Ordna korten (2026-11-24): a tidy chart from the lines, as one step that Ångra takes back; nothing is saved.
  const [gliding, setGliding] = useState(false);
  const glide = useRef<number | undefined>(undefined);
  const arrange = () => {
    if (!draft) return;
    // Each card's own height in rows (as measured on the surface), so a level is as high as its tallest card.
    const rowsOf = (id: string) => {
      const element = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="org-surface"] [data-natural-height]')).find((item) => item.dataset.cardId === id);
      return element ? Math.ceil(Number(element.dataset.naturalHeight) / ROW_PX) : CARD_ROWS;
    };
    change({ ...draft, cards: arrangeCards(draft.cards, rowsOf) });
    setGliding(true);
    window.clearTimeout(glide.current);
    glide.current = window.setTimeout(() => setGliding(false), 300);
    announce("Korten är ordnade. Välj Ångra om du vill ha tillbaka den förra placeringen.");
  };
  useEffect(() => () => window.clearTimeout(glide.current), []);
  const fromProposal = () => {
    if (!draft || !program) return;
    const nodes = proposedTree([...program.roles].sort((a, b) => a.sortOrder - b.sortOrder));
    const places = treePlaces(chartForest(nodes));
    change({ ...draft, cards: nodes.flatMap((node) => { const at = places.get(node.roleId); return at ? [{ roleId: node.roleId, ...at, parentId: node.parentId }] : []; }) });
  };
  const free = (exclude?: string) => [...(program?.roles ?? []).map((role) => ({ id: role.id, name: role.name })), ...Object.entries(draft?.newRoles ?? {}).map(([id, name]) => ({ id, name }))]
    .filter((role) => role.id === exclude || !draft?.cards.some((card) => card.roleId === role.id));

  const menu = (id: string) => {
    const card = draft?.cards.find((item) => item.roleId === id);
    const items: EditorMenuItem[] = [
      { label: "Koppla till …", icon: Link2, onSelect: () => setLinkingFor(id), testId: "org-card-link-to" },
      { label: "Ta bort koppling", icon: Link2Off, disabled: !card?.parentId, onSelect: () => unlink(id), testId: "org-card-unlink" },
      ...(id.startsWith("new:") ? [] : [{ label: "Öppna rollen", icon: ExternalLink, onSelect: () => router.push(selfInspectionHref("roles", { role: id })), testId: "org-card-open-role" }]),
      { label: "Ta bort kortet", icon: Trash2, danger: true, onSelect: () => remove(id), testId: "org-card-delete" },
    ];
    return <EditorMoreMenu label={`Åtgärder för ${nameOf(id)}`} triggerClassName={cn(EDITOR_ICON_BUTTON, "size-6 shrink-0")} items={items} testId="org-card-menu" />;
  };
  const renderOpen = (id: string) => <CardEditor key={id} id={id} roles={free(id === PENDING ? undefined : id)} nameOf={nameOf} text={draft?.texts[id] ?? ""} data={id === PENDING ? null : dataOf(id)}
    takenNames={[...roleNames.values(), ...Object.values(draft?.newRoles ?? {})]}
    onRole={(roleId, name) => { if (id === PENDING) place(roleId, pending ?? freePlace(draft?.cards ?? [], {}), name); else if (roleId !== id) swapRole(id, roleId, name); }}
    onText={(text) => draft && id !== PENDING && change({ ...draft, texts: { ...draft.texts, [id]: text } })} onClose={() => { if (id === PENDING) setPending(null); setOpen(null); }} />;

  const description = "Rollerna som kort med ansvar och vem som rapporterar till vem. Schemat visas i programmet.";
  if (!program || !shown) return <section data-testid="self-inspection-org-tree">
    <PageHeader title="Organisation och ansvar" description={description} />
    <p className="text-sm text-muted-foreground">Skapa programmet från mallen under Program först.</p>
  </section>;
  const addCard = () => { setSelectedLink(null); setOpen(PENDING); setPending(freePlace(draft?.cards ?? [], {})); };
  const actions = editing ? <>
    <Button variant="outline" disabled={!history.length} onClick={undo} data-testid="org-chart-undo" title="Ångra (Ctrl+Z)"><Undo2 />Ångra</Button>
    <Button variant="outline" disabled={!draft?.cards.length} onClick={arrange} data-testid="org-arrange"><Network />Ordna korten</Button>
    <Button variant="outline" onClick={addCard} data-testid="org-add-card"><Plus />Lägg till kort</Button>
    <Button variant="outline" disabled={busy} onClick={() => void cancel()} data-testid="org-tree-cancel">Avbryt</Button>
    <Button disabled={busy || !dirty} onClick={() => void save()} data-testid="org-tree-save"><Save />Spara</Button>
  </> : <Button onClick={begin} data-testid="org-tree-edit"><Pencil />Redigera</Button>;
  const empty = !shown.cards.length && !pending;
  const editApi: EditApi = { selected, open, drawing: false, select: setSelected, openCard: setOpen, move, link, unlink, remove, menu, renderOpen,
    // A click on the surface first closes what is open; on a calm surface it puts a new card there.
    placePending: (x, y) => { if (selected || open || selectedLink || pending) { setPending(null); setOpen(null); return; } setPending({ x, y }); setOpen(PENDING); }, selectedLink, selectLink: setSelectedLink };

  return <section className="space-y-4" data-testid="self-inspection-org-tree" data-editing={editing ? "" : undefined}>
    {confirmElement}
    <PageHeader title="Organisation och ansvar" description={description} actions={actions} />
    {editing && !empty ? <p className="text-sm text-muted-foreground" data-testid="org-chart-help">{phone ? "Ändra roll och ansvar i kortet. Välj ⋯ och Koppla till … för att visa vem kortet rapporterar till."
      : "Dra korten dit du vill ha dem. Dra från punkten på ett korts kant till ett annat kort för att visa vem som rapporterar till vem. Klicka på ytan för att lägga ett kort där. Inget sparas förrän du väljer Spara."}</p> : null}
    {!editing && !empty ? <p className="text-sm text-muted-foreground" data-testid="org-chart-help">Välj ett kort för att se ansvaret.</p> : null}
    {empty ? <div className="space-y-3 py-6 text-center" data-testid="org-empty">
      <p className="text-sm text-muted-foreground">{editing ? "Lägg till ett kort för att börja bygga organisationen." : "Organisationen är inte ritad ännu. Välj Redigera och lägg till ett kort för att börja."}</p>
      {editing ? <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={addCard} data-testid="org-empty-add"><Plus />Lägg till kort</Button>
        <Button variant="outline" onClick={fromProposal} data-testid="org-from-proposal"><Sparkles />Börja från förslag</Button>
      </div> : null}
    </div> : <ChartSurface cards={shown.cards} dataOf={dataOf} texts={shown.texts} forceTree={phone} pending={editing ? pending : null} gliding={gliding}
      selectedRead={readSelected} onSelectRead={(id) => setReadSelected((current) => current === id ? null : id)} edit={editing ? editApi : undefined} />}
    {linkingFor && draft ? <LinkTo cards={draft.cards} roleId={linkingFor} nameOf={nameOf} onClose={() => setLinkingFor(null)} onLink={(parentId) => { if (parentId) link(linkingFor, parentId); else unlink(linkingFor); setLinkingFor(null); }} /> : null}
  </section>;
}

/** A card opened for editing: its role (or a new role with a name) and the responsibility of this place; the rest is only shown. */
function CardEditor({ id, roles, nameOf, text, data, takenNames, onRole, onText, onClose }: {
  id: string; roles: { id: string; name: string }[]; nameOf: (id: string) => string; text: string; data: CardData | null; takenNames: string[];
  onRole: (roleId: string, name?: string) => void; onText: (text: string) => void; onClose: () => void;
}) {
  const [choice, setChoice] = useState(id === PENDING ? "" : id);
  const [name, setName] = useState("");
  const [value, setValue] = useState(text);
  const create = () => {
    const clean = name.trim();
    if (!clean) return;
    if (takenNames.some((taken) => taken.toLocaleLowerCase("sv") === clean.toLocaleLowerCase("sv"))) { announce("Det finns redan en roll med det namnet.", true); return; }
    onRole(`new:${Date.now().toString(36)}`, clean);
  };
  const keys = (event: ReactKeyboardEvent) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); onClose(); } };
  return <div className="space-y-2" onClick={(event) => event.stopPropagation()} onKeyDown={keys} data-testid="org-card-editor">
    <select autoFocus className="form-select h-8 w-full px-2 text-sm" aria-label="Roll" value={choice} data-testid="org-card-role"
      onChange={(event) => { setChoice(event.target.value); if (event.target.value && event.target.value !== NEW_ROLE) onRole(event.target.value); }}>
      {id === PENDING ? <option value="">Välj roll …</option> : null}
      {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
      <option value={NEW_ROLE}>Ny roll …</option>
    </select>
    {choice === NEW_ROLE ? <div className="flex gap-1">
      <input autoFocus className="form-input h-8 min-w-0 flex-1 px-2 text-sm" aria-label="Namn på den nya rollen" placeholder="Namn på rollen" value={name} onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); create(); } }} data-testid="org-card-new-name" />
      <Button size="sm" onClick={create} disabled={!name.trim()} data-testid="org-card-new-save">Skapa</Button>
    </div> : null}
    {data ? <>
      <span className={cn("block text-xs hyphens-manual [overflow-wrap:normal]", data.people.length ? "text-muted-foreground" : "text-amber-800 dark:text-amber-200")} data-testid="org-card-people">
        {data.people.length ? data.people.map((person) => `${person.name}${person.hired ? " (inhyrd)" : ""}${person.level ? ` · nivå ${person.level}` : ""}`).join(", ") : "Ingen utsedd"}</span>
      {data.level ? <span className="block text-[0.6875rem] text-muted-foreground">Nivåkrav {data.level} (Rollbeskrivningar)</span> : null}
      <textarea className="form-textarea min-h-16 w-full text-xs" aria-label={`Ansvar för ${nameOf(id)}`} placeholder="Ansvar på den här platsen" value={value}
        onChange={(event) => setValue(event.target.value)} onBlur={() => { if (value !== text) onText(value); }} data-testid="org-card-responsibility" />
      {id.startsWith("new:") ? null : <span className="flex flex-wrap gap-x-3 text-xs">
        <Link href={selfInspectionHref("roles", { role: id })} className="text-primary hover:underline">Rollen</Link>
        <Link href={selfInspectionHref("cards")} className="text-primary hover:underline">Kompetenskort</Link></span>}
    </> : null}
  </div>;
}

/** Koppla till …: the card this one reports to (never one that already stands under it), or none. */
function LinkTo({ cards, roleId, nameOf, onClose, onLink }: { cards: Card[]; roleId: string; nameOf: (id: string) => string; onClose: () => void; onLink: (parentId: string | null) => void }) {
  const NONE = "__none__";
  const choices = cards.filter((card) => card.roleId !== roleId && !wouldRing(cards, roleId, card.roleId)).map((card) => card.roleId);
  const [parent, setParent] = useState(cards.find((card) => card.roleId === roleId)?.parentId ?? NONE);
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={`Koppla ${nameOf(roleId)}`} size="compact">
    <div className="space-y-4" data-testid="org-link-dialog">
      <Field id="si-chart-link-parent" label="Rapporterar till" value={parent} onChange={setParent} options={[NONE, ...choices]} optionLabels={{ [NONE]: "Ingen (överst)", ...Object.fromEntries(choices.map((id) => [id, nameOf(id)])) }} />
      <p className="text-xs text-muted-foreground">Ett kort rapporterar till högst ett annat. Kort som redan står under det här kan inte väljas, eftersom det skulle bli en ring.</p>
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Koppla", onClick: () => onLink(parent === NONE ? null : parent), testId: "org-link-save" }} />
    </div>
  </Modal>;
}
