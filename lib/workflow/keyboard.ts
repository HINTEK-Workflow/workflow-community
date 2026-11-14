/**
 * Whether the on-screen keyboard is up (shared by the shell and the dialogs, 2026-10-13). iOS keeps the page's height
 * and only shortens the visual viewport; Chrome on Android (interactive-widget=resizes-content) shrinks the whole page,
 * so the page's own height cannot be the measure there. The tallest height seen at the same width is the screen without
 * a keyboard; a turn of the phone (another width) starts over.
 */
let baseline = { width: 0, height: 0 };

export function heightWithoutKeyboard(): number {
  const width = window.innerWidth;
  const height = Math.max(window.innerHeight, window.visualViewport?.height ?? 0);
  if (width !== baseline.width || height > baseline.height) baseline = { width, height };
  return baseline.height;
}

/** True while someone types in a field and the on-screen keyboard covers part of the screen (not a pinch zoom). */
export function onScreenKeyboardOpen(): boolean {
  if (typeof window === "undefined") return false;
  const visual = window.visualViewport;
  if (!visual || visual.scale > 1.05) return false;
  // Only a touch screen has an on-screen keyboard: a computer window made lower while a field has focus is not one
  // (2026-10-27 – it hid the floating navigation).
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window || Boolean(window.matchMedia?.("(any-pointer: coarse)").matches);
  if (!touch) return false;
  const full = heightWithoutKeyboard();
  const editing = document.activeElement?.matches("input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=file]), textarea, select, [contenteditable=true]");
  return Boolean(editing && (window.innerHeight - visual.height > 120 || full - visual.height > 120));
}
