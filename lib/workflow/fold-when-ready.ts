/**
 * A fold that opens only when its content can be shown whole (2026-10-24: "innehåll först när det är klart"):
 * the person asks for it, the content is read, and the fold opens in one sweep once it is ready – never open on a
 * half-built part that grows piece by piece. While the content is on its way the fold stays shut and its arrow says it
 * is busy; a second click while it is busy takes the wish back.
 */
export type FoldWish = { asked: boolean; ready: boolean };

/** What the fold shows: open when asked and ready, busy (shut, arrow marked) when asked and not ready yet. */
export function foldShown({ asked, ready }: FoldWish): { open: boolean; opening: boolean } {
  return { open: asked && ready, opening: asked && !ready };
}

/**
 * The wish after a click on the fold's header. An open fold shuts; a shut one is asked for; a busy one (asked, not ready)
 * is no longer asked for, so a person who changes their mind is never surprised by it opening later.
 */
export function foldWishAfterClick(wish: FoldWish): boolean {
  return !wish.asked;
}
