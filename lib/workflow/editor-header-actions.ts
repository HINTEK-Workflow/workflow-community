/**
 * Högst fyra knappar i sidhuvudet (Lika är rätt, 2026-11-14): an editor's header shows at most four buttons besides
 * Avbryt and Spara – the red one, the secondary ones and the timer counted together, with "Mer ⋯" as one of the four when it
 * is needed. The rest go under Mer. The rule lives here and in the shared EditorHeader, so every editor follows it.
 *
 * What moves first: the red button (Ta bort …), then the buttons that are not marked `keep`, from the left, then the kept
 * ones. A button that cannot be a menu row (a button that opens its own menu or dialog) is never moved; it stays visible.
 */
export const EDITOR_HEADER_MAX_BUTTONS = 4;

export type HeaderButton = { key: string; /** It can be a row in Mer. */ movable: boolean; /** Moved last. */ keep?: boolean; /** The red one. */ destructive?: boolean };

/**
 * The keys moved to Mer, in the order they stood. `fixed` counts what is always shown and never moved (the timer);
 * `more` says Mer is shown anyway (rows that always live there).
 */
export function headerOverflow(buttons: HeaderButton[], { fixed = 0, more = false, max = EDITOR_HEADER_MAX_BUTTONS }: { fixed?: number; more?: boolean; max?: number } = {}): string[] {
  if (buttons.length + fixed + (more ? 1 : 0) <= max) return [];
  // Mer is shown now and takes one place.
  const room = Math.max(0, max - 1 - fixed);
  const order = [
    ...buttons.filter((button) => button.movable && button.destructive),
    ...buttons.filter((button) => button.movable && !button.destructive && !button.keep),
    ...buttons.filter((button) => button.movable && !button.destructive && button.keep),
  ];
  const moved = new Set<string>();
  let shown = buttons.length;
  for (const button of order) {
    if (shown <= room) break;
    moved.add(button.key);
    shown -= 1;
  }
  return buttons.filter((button) => moved.has(button.key)).map((button) => button.key);
}
