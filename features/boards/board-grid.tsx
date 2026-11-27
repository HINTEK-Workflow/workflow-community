"use client";

import type { CSSProperties } from "react";
import { GRID_COLUMNS, stackedOrder } from "@/lib/boards/grid";
import { DISTANCE, type BoardCard, type BoardLayout, type Distance } from "@/lib/boards/model";
import type { CardData } from "@/lib/boards/shapes";
import { cn } from "@/lib/utils";
import { BoardCardView } from "./board-card";

/**
 * Tavlans rutnät som visning (2026-11-18): the cards at their cells of the 24 columns and the board's rows. `frame` keeps the board's
 * proportions (16:9 lying, 9:16 standing) at the width it is given – the board's page and the editor's preview; `fill` takes the whole
 * box it is in (a screen, Presentera), so the cells follow the screen and the board looks the same on 720p and 4K; `stack` is the
 * phone: the cards under each other, top to bottom and left to right, without the ones hidden on a phone. Avstånd (2026-11-19): the
 * grid sets the cards' text factor (--board-distance) from the board's distance or the one given (a fixed screen's own); the phone,
 * held in the hand, always reads as Nära. Since 2026-11-20 `frame` and `stack` are the board inside Workflow and size the text by the
 * room instead (.board-room-app); only `fill` (Förhandsgranska, Presentera, a screen, a link) follows the distance.
 */
export type GridMode = "frame" | "fill" | "stack";

export function cardBox(card: Pick<BoardCard, "x" | "y" | "w" | "h">, rows: number): CSSProperties {
  return { left: `${(card.x / GRID_COLUMNS) * 100}%`, top: `${(card.y / rows) * 100}%`, width: `${(card.w / GRID_COLUMNS) * 100}%`, height: `${(card.h / rows) * 100}%` };
}
export const boardAspect = (layout: Pick<BoardLayout, "orientation">) => layout.orientation === "portrait" ? "9 / 16" : "16 / 9";
/** The style that gives the cards inside their text factor for a distance. */
export const distanceStyle = (distance: Distance | undefined) => {
  const shown = DISTANCE[distance ?? "near"];
  return { "--board-distance": String(shown.scale), "--board-enough": String(shown.enough), "--board-most": String(shown.most) } as CSSProperties;
};
/** A card's height in rows, which its text measures the board's rows by (Avstånd). */
export const cardRows = (card: Pick<BoardCard, "h">) => ({ "--card-rows": String(card.h) }) as CSSProperties;

export function BoardGrid({ layout, feed, mode, labels, now, gap = "0.35rem", distance, className, testId = "board-grid" }: {
  layout: BoardLayout;
  feed: Record<string, CardData> | null;
  mode: GridMode;
  /** The name of each card's source, for a card without a title of its own. */
  labels?: Record<string, string>;
  now: number;
  gap?: string;
  /** Another distance than the board's own (a fixed screen's, or the one chosen in Förhandsgranska). */
  distance?: Distance | null;
  className?: string;
  testId?: string;
}) {
  if (mode === "stack") {
    const cards = stackedOrder(layout.cards).filter((card) => !card.hideOnPhone);
    return <div className={cn("board-room-app grid gap-3", className)} data-testid={testId} data-room="app">
      {cards.map((card) => <div key={card.id} style={{ height: `clamp(7.5rem, ${card.h * 2.4}rem, 24rem)` }}>
        <BoardCardView card={card} data={feed?.[card.id]} sourceLabel={labels?.[card.id] ?? feed?.[card.id]?.label} now={now} />
      </div>)}
    </div>;
  }
  const shown = distance ?? layout.distance ?? "near";
  // Inside Workflow (`frame`, the board's page with the menu beside it) the cards follow the room they have, not the distance
  // (2026-11-20): app/globals.css .board-room-app keeps their text to the app's own sizes.
  const inApp = mode === "frame";
  return <div className={cn("relative w-full", mode === "fill" && "h-full", inApp && "board-room-app", className)} style={{ ...(inApp ? { aspectRatio: boardAspect(layout) } : distanceStyle(shown)) }}
    data-testid={testId} data-orientation={layout.orientation} data-distance={shown} data-room={inApp ? "app" : "screen"}>
    {layout.cards.map((card) => <div key={card.id} className="absolute" style={{ ...cardBox(card, layout.rows), ...cardRows(card), padding: gap }}>
      <BoardCardView card={card} data={feed?.[card.id]} sourceLabel={labels?.[card.id] ?? feed?.[card.id]?.label} now={now} />
    </div>)}
  </div>;
}
