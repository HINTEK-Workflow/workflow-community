"use client";

import { useEffect, useRef, useState } from "react";
import { SCREEN_SIZES, screenPixels, type ScreenSizeKey, type ScreenTurn } from "@/lib/boards/capacity";
import type { BoardLayout, Distance } from "@/lib/boards/model";
import type { CardData } from "@/lib/boards/shapes";
import { BoardGrid } from "./board-grid";

/**
 * Förhandsvisa i en skärmstorlek (2026-11-19: "från en iPad till 65 tum och större"): the board drawn at the screen's real size
 * in pixels, exactly as the player draws it there (the same padding and gaps, the cards filling the screen), and then shrunk to fit
 * the editor. Because the cards scale with their own size, what is seen here is what that screen shows, only smaller. The sizes and
 * what is readable on them are in lib/boards/capacity.ts.
 */
export const PREVIEW_SIZES = SCREEN_SIZES;
export type PreviewSizeKey = ScreenSizeKey;
export type PreviewTurn = ScreenTurn;
export const previewPixels = screenPixels;

export function BoardPreview({ layout, feed, labels, now, size, turn, distance }: {
  layout: BoardLayout; feed: Record<string, CardData> | null; labels: Record<string, string>; now: number; size: PreviewSizeKey; turn: PreviewTurn;
  /** Avstånd to see the board at (the board's own, or one a fixed screen may choose). */
  distance: Distance;
}) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setRoom(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { w, h } = previewPixels(size, turn);
  const maxHeight = typeof window === "undefined" ? 720 : Math.max(320, window.innerHeight * 0.7);
  const scale = room ? Math.min(room / w, maxHeight / h) : 0;
  const vmin = Math.min(w, h) / 100;
  return <div ref={frame} className="w-full" data-testid="board-preview" data-size={size} data-turn={turn} data-distance={distance}>
    <div className="relative mx-auto overflow-hidden rounded-lg border shadow-sm" style={{ width: w * scale, height: h * scale }}>
      {scale ? <div className="absolute left-0 top-0 bg-background text-foreground" style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "0 0", padding: 0.6 * vmin }}>
        <BoardGrid layout={layout} feed={feed} labels={labels} mode="fill" gap={`${0.45 * vmin}px`} now={now} distance={distance} testId="board-preview-grid" />
      </div> : null}
    </div>
    <p className="mt-2 text-center text-xs text-muted-foreground">{w} × {h} bildpunkter, visad i {Math.round(scale * 100)} %.</p>
  </div>;
}
