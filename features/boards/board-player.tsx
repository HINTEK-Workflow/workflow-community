"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RotateCw, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoardLayout, Distance } from "@/lib/boards/model";
import type { CardData } from "@/lib/boards/shapes";
import { nextRetryDelay } from "@/lib/boards/player";
import { swedishClock } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { BoardImages, type BoardImageUrl } from "./board-card";
import { BoardGrid } from "./board-grid";

/**
 * Spelaren (Tavlor och skärmar, 2026-11-18; plan 4.6): one player for Presentera in the app, a connected screen (/skarm) and a shared
 * link (/visa). Full screen without the app's frame; a small gear shows only when the mouse moves or the screen is touched. It follows
 * the screen's size (the board's cells divide the screen), keeps the last figures when the connection is lost and says so quietly,
 * tries again by itself (2, 4, 8 … at most 60 seconds, and at once when the network or the tab comes back), keeps the screen awake
 * (Screen Wake Lock) and can move the picture a pixel now and then against burn-in. It fetches nothing from a third party.
 */
export type PlayerBoard = { id: string; name: string; layout: BoardLayout; cards: Record<string, CardData>; /** A playlist's seconds for this board. */ seconds?: number };
export type PlayerFeed = { boards: PlayerBoard[]; seconds: number; at: string };

/**
 * Reads the feed again and again: every `everyMs` while it answers, and with growing waits while it does not. The last good answer
 * stays; `lostSince` is when the answers stopped. `stop` (an answer that means "no longer allowed") ends the loop.
 */
export function useFeedLoop<T>(read: () => Promise<T>, everyMs: number, options: { isFinal?: (error: unknown) => boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [lostSince, setLostSince] = useState<number | null>(null);
  const [final, setFinal] = useState<unknown>(null);
  const failures = useRef(0);
  const timer = useRef<number | null>(null);
  const readRef = useRef(read);
  const isFinal = useRef(options.isFinal);
  const again = useRef<() => void>(() => undefined);
  useEffect(() => { readRef.current = read; isFinal.current = options.isFinal; });
  const run = useCallback(async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    try {
      const answer = await readRef.current();
      failures.current = 0;
      setData(answer);
      setLostSince(null);
      timer.current = window.setTimeout(() => again.current(), everyMs);
    } catch (error) {
      if (isFinal.current?.(error)) { setFinal(error); return; }
      failures.current += 1;
      setLostSince((since) => since ?? Date.now());
      timer.current = window.setTimeout(() => again.current(), nextRetryDelay(failures.current));
    }
  }, [everyMs]);
  useEffect(() => { again.current = () => void run(); }, [run]);
  useEffect(() => {
    queueMicrotask(() => void run());
    const again = () => { if (document.visibilityState === "visible") void run(); };
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [run]);
  return { data, lostSince, final, refresh: run };
}

/** Keeps the screen awake while the player is shown, asking again when the tab comes back (the lock ends when it is hidden). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    const ask = async () => { try { lock = await (navigator as Navigator & { wakeLock: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen"); } catch { /* the screen may sleep */ } };
    const again = () => { if (document.visibilityState === "visible") void ask(); };
    void ask();
    document.addEventListener("visibilitychange", again);
    return () => { document.removeEventListener("visibilitychange", again); void lock?.release().catch(() => undefined); };
  }, [on]);
}

export function BoardPlayer({ feed, imageUrl, lostSince, onReload, onClose, title, extra, burnIn = false, identify, distance, testId = "board-player" }: {
  feed: PlayerFeed | null;
  imageUrl: BoardImageUrl;
  lostSince: number | null;
  onReload: () => void;
  /** Presentera in the app: Stäng (and Escape). A screen has no way out. */
  onClose?: () => void;
  /** The screen's or the link's own name for the gear. */
  title?: string;
  /** More rows in the gear (the screen's settings). */
  extra?: ReactNode;
  burnIn?: boolean;
  /** Identifiera: the screen's name large for a moment. */
  identify?: string | null;
  /** A fixed screen's own Avstånd, for every board it shows; otherwise each board's own. */
  distance?: Distance | null;
  testId?: string;
}) {
  const [index, setIndex] = useState(0);
  const [pointer, setPointer] = useState(false);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const [now, setNow] = useState(() => Date.now());
  const hide = useRef<number | null>(null);
  const boards = feed?.boards ?? [];
  const shown = boards.length ? boards[index % boards.length] : null;
  useWakeLock(true);
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(tick); }, []);
  const dwell = Math.max(5, shown?.seconds || feed?.seconds || 30) * 1000;
  useEffect(() => {
    if (boards.length < 2) return;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % boards.length), dwell);
    return () => window.clearTimeout(timer);
  }, [boards.length, index, dwell]);
  useEffect(() => {
    if (!burnIn) return;
    const timer = window.setInterval(() => setShift({ x: Math.round(Math.random() * 4) - 2, y: Math.round(Math.random() * 4) - 2 }), 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [burnIn]);
  useEffect(() => {
    if (!onClose) return;
    const keys = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onClose]);
  const wake = () => {
    setPointer(true);
    if (hide.current) window.clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setPointer(false), 4000);
  };
  return <div className="board-player" data-pointer={pointer ? "" : undefined} onPointerMove={wake} onPointerDown={wake} data-testid={testId} role="region" aria-label={shown?.name ?? title ?? "Tavla"}>
    {/* Presentera (filmed 2026-11-20: the bar covered the title of the top-right card): the board starts under the bar, which is
        there whenever the presenter moves the mouse. A fixed screen and a shared link keep the whole screen for the board. */}
    <div className={cn("size-full p-[0.6vmin]", onClose && "pt-[calc(1vmin+3.5rem)]")} style={{ transform: shift.x || shift.y ? `translate(${shift.x}px, ${shift.y}px)` : undefined }}>
      {shown ? <BoardImages url={imageUrl}><BoardGrid key={shown.id} layout={shown.layout} feed={shown.cards} mode="fill" gap="0.45vmin" now={now} distance={distance} testId="board-player-grid" /></BoardImages>
        : <div className="flex size-full items-center justify-center text-[2.5vmin] text-muted-foreground">{feed ? "Det finns ingen publicerad tavla att visa." : "Hämtar tavlan…"}</div>}
    </div>
    {lostSince ? <p className="pointer-events-none fixed bottom-[1vmin] right-[1vmin] rounded-md bg-card/90 px-[1vmin] py-[0.4vmin] text-[1.4vmin] text-muted-foreground shadow" role="status" data-testid="board-player-offline">Ingen kontakt sedan {swedishClock(lostSince)}</p> : null}
    {identify ? <div className="fixed inset-0 flex items-center justify-center bg-background/85 text-[9vmin] font-bold" role="status" data-testid="board-player-identify">{identify}</div> : null}
    <div className={cn("fixed right-[1vmin] top-[1vmin] flex items-center gap-2 rounded-lg border bg-card/95 p-2 shadow transition-opacity motion-reduce:transition-none", pointer ? "opacity-100" : "pointer-events-none opacity-0")} data-testid="board-player-gear">
      <Settings className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="max-w-[40vw] truncate text-sm font-medium">{shown?.name ?? title ?? "Tavla"}{boards.length > 1 ? ` · ${(index % boards.length) + 1} av ${boards.length}` : ""}</span>
      <span className="text-xs text-muted-foreground">{lostSince ? "Ingen kontakt" : feed ? `Uppdaterad ${swedishClock(feed.at)}` : ""}</span>
      {extra}
      <Button type="button" size="sm" variant="outline" onClick={onReload}><RotateCw aria-hidden="true" />Ladda om</Button>
      {onClose ? <Button type="button" size="sm" variant="outline" onClick={onClose} data-testid="board-player-close"><X aria-hidden="true" />Stäng</Button> : null}
    </div>
  </div>;
}
