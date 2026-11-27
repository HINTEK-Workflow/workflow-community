"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Maximize2, Pencil } from "lucide-react";
import { createPortal } from "react-dom";
import { PageBackButton, PageHeader, PageSkeleton, usePageTrail } from "@/components/page-shell";
import { boardsTabHref } from "@/lib/boards/tabs";
import { Button } from "@/components/ui/button";
import { Empty } from "@/features/kfid/ui";
import { useIsPhone } from "@/features/workflow/use-detail-level";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { appImageUrl, boardHref, boardsGet, type BoardDetail, type BoardFeedAnswer } from "./boards-api";
import { BoardImages } from "./board-card";
import { BoardGrid } from "./board-grid";
import { BoardPlayer, useFeedLoop, type PlayerFeed } from "./board-player";

/**
 * En tavla i appen (Tavlor etapp 1, 2026-11-18): the published version with its figures counted as the person looking (a card the
 * person may not see says so), Presentera for the whole screen without the app's frame, and Redigera for whoever may change it. On a
 * phone the cards stand under each other. The head is the list's (2026-11-19): the name in bold, the description under it and
 * the section's tabs under that (drawn by the shell, Tavlor marked), with Tillbaka to the list beside the board's own buttons.
 */
/** The subtitle of a board without a description of its own (2026-11-19: "KPI-tavlor" where it helps). */
const BOARD_SUBTITLE = "KPI-tavla med nyckeltal, diagram och information.";

export function BoardView({ boardId }: { boardId: string }) {
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [failed, setFailed] = useState("");
  const [presenting, setPresenting] = useState(false);
  const phone = useIsPhone();
  const load = useCallback(async () => {
    try { setBoard(await boardsGet<BoardDetail>(`part=board&id=${encodeURIComponent(boardId)}`)); }
    catch (error) { setFailed(error instanceof Error ? error.message : "Tavlan kunde inte läsas."); }
  }, [boardId]);
  useLoadEffect(load);
  usePageTrail({ heading: board?.name });
  const readFeed = useCallback(() => boardsGet<BoardFeedAnswer>(`part=feed&id=${encodeURIComponent(boardId)}`), [boardId]);
  const live = useFeedLoop(readFeed, 30_000, { isFinal: (error) => [403, 404].includes((error as { status?: number }).status ?? 0) });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(tick); }, []);
  const back = <PageBackButton href={boardsTabHref("boards")} testId="board-back" />;
  if (failed) return <div className="space-y-4"><PageHeader title="Tavla" description={BOARD_SUBTITLE} actions={back} /><p className="notice" role="alert">{failed}</p></div>;
  if (!board) return <PageSkeleton label="Hämtar tavlan…" panels={1} />;
  const published = board.published;
  const present = async () => {
    setPresenting(true);
    try { await document.documentElement.requestFullscreen?.(); } catch { /* the overlay covers the window anyway */ }
  };
  const close = () => {
    setPresenting(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  };
  const feed: PlayerFeed | null = published && live.data ? { boards: [{ id: board.id, name: board.name, layout: published.layout, cards: live.data.cards }], seconds: 0, at: live.data.at } : null;
  return <div className="space-y-4" data-testid="board-view">
    <PageHeader title={board.name} description={board.description || BOARD_SUBTITLE} actions={<>
      {back}
      {board.canEdit ? <Button asChild variant="outline"><Link href={boardHref(board.id, true)}><Pencil aria-hidden="true" />Redigera</Link></Button> : null}
      {published ? <Button type="button" onClick={() => void present()} data-testid="board-present"><Maximize2 aria-hidden="true" />Presentera</Button> : null}
    </>}>
      {published ? <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="size-4" aria-hidden="true" />Version {published.number}, publicerad {formatSwedish(published.publishedAt, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</p> : null}
    </PageHeader>
    {!published ? <div className="rounded-xl border bg-card"><Empty title="Tavlan är inte publicerad än" description={board.canPublish ? "Fasta skärmar och delade länkar visar bara publicerade tavlor. Öppna tavlan i redigeraren, förhandsgranska den där och välj Publicera när den är klar." : "Fasta skärmar och delade länkar visar bara publicerade tavlor. Den syns här när den har publicerats."}>
      {board.canEdit ? <Button asChild><Link href={boardHref(board.id, true)}><Pencil aria-hidden="true" />Redigera</Link></Button> : null}
    </Empty></div>
      : <BoardImages url={appImageUrl}>
        <div className="rounded-xl border bg-muted/30 p-1.5">
          <BoardGrid layout={published.layout} feed={live.data?.cards ?? null} mode={phone ? "stack" : "frame"} now={now} />
        </div>
      </BoardImages>}
    {presenting && published ? createPortal(<div className="fixed inset-0 z-[80]"><BoardPlayer feed={feed} imageUrl={appImageUrl} lostSince={live.lostSince} onReload={() => void live.refresh()} onClose={close} title={board.name} /></div>, document.body) : null}
  </div>;
}
