/**
 * Låst sida bakom ett blad (mobil 2026-11-22: "lager på lager"): while a bottom sheet, Mer or the chat is open, the page behind it
 * never scrolls. The rule for one finger movement, kept pure so it can be tested without a browser: a drag is let through only
 * when it lands in something that can still scroll that way (the sheet's list, the chat's thread, the message field); anything
 * else – the dimmed page, the sheet's title, a list already at its end – is stopped, so the movement neither scrolls the page nor
 * chains over to it (iOS Safari passes an overscroll on to the page and ignores overflow: hidden while a finger drags).
 */
export type ScrollBox = { scrollTop: number; scrollHeight: number; clientHeight: number };

/**
 * `boxes`: the scrollable elements from the touched element outwards, up to (not including) the page itself. `dy`: the finger's
 * latest movement (positive = the finger moved down, i.e. the content would scroll towards its top).
 */
export function shouldBlockTouch(boxes: readonly ScrollBox[], dy: number): boolean {
  if (dy === 0) return false;
  for (const box of boxes) {
    if (box.scrollHeight - box.clientHeight <= 1) continue;
    const atTop = box.scrollTop <= 0;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
    if (dy > 0 && !atTop) return false;
    if (dy < 0 && !atBottom) return false;
  }
  return true;
}
