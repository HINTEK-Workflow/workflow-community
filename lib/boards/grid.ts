/**
 * Tavlans rutnät (2026-11-18): 24 columns and a fixed number of rows (14 lying, 40 standing), so a board looks the same on 720p
 * and 4K – the player divides the screen into the same cells. Cards snap to whole cells. Moving or resizing a card pushes the
 * cards it lands on downwards; a change that would push a card off the board is not made. Pure and small, so it is tested
 * (tests/boards-grid.test.ts) instead of adding a grid library.
 */
export const GRID_COLUMNS = 24;
export const ROWS_BY_ORIENTATION = { landscape: 14, portrait: 40 } as const;
export type Orientation = keyof typeof ROWS_BY_ORIENTATION;

export type Rect = { x: number; y: number; w: number; h: number };
export type GridItem = Rect & { id: string };
export type SizeLimits = { minW: number; minH: number; maxW?: number; maxH?: number };

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The rectangle inside the board: at least 1×1, never past the edges. */
export function clampRect(rect: Rect, rows: number, columns = GRID_COLUMNS, limits?: SizeLimits): Rect {
  const minW = Math.min(columns, Math.max(1, limits?.minW ?? 1));
  const minH = Math.min(rows, Math.max(1, limits?.minH ?? 1));
  const w = Math.max(minW, Math.min(limits?.maxW ?? columns, columns, Math.round(rect.w) || 1));
  const h = Math.max(minH, Math.min(limits?.maxH ?? rows, rows, Math.round(rect.h) || 1));
  const x = Math.max(0, Math.min(columns - w, Math.round(rect.x) || 0));
  const y = Math.max(0, Math.min(rows - h, Math.round(rect.y) || 0));
  return { x, y, w, h };
}

/** The first free place for a card of this size, row by row from the top left; null when the board is full. */
export function firstFree<T extends GridItem>(items: readonly T[], w: number, h: number, rows: number, columns = GRID_COLUMNS): { x: number; y: number } | null {
  for (let y = 0; y + h <= rows; y += 1) {
    for (let x = 0; x + w <= columns; x += 1) {
      const rect = { x, y, w, h };
      if (!items.some((item) => overlaps(rect, item))) return { x, y };
    }
  }
  return null;
}

/**
 * The cards after one card got a new place or size: the card keeps it, and every card it lands on moves down far enough to be
 * free – which can push further cards, in order from the top. Returns null when some card would end up below the board, so the
 * caller keeps the board as it was.
 */
export function placeItem<T extends GridItem>(items: readonly T[], id: string, rect: Rect, rows: number, columns = GRID_COLUMNS, limits?: SizeLimits): T[] | null {
  const target = items.find((item) => item.id === id);
  if (!target) return null;
  const placed = { ...target, ...clampRect(rect, rows, columns, limits) };
  const fixed: T[] = [placed];
  const others = items.filter((item) => item.id !== id).map((item) => ({ ...item })).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const item of others) {
    let y = item.y;
    while (fixed.some((other) => overlaps({ ...item, y }, other))) y += 1;
    if (y + item.h > rows) return null;
    fixed.push({ ...item, y });
  }
  const order = new Map(items.map((item, index) => [item.id, index]));
  return fixed.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** Cells moved by a pointer drag of `dx`/`dy` pixels on a grid whose cells are `cellW`×`cellH` pixels. */
export const cellsMoved = (dx: number, dy: number, cellW: number, cellH: number) => ({ x: cellW > 0 ? Math.round(dx / cellW) : 0, y: cellH > 0 ? Math.round(dy / cellH) : 0 });

/** The order on a phone, where the cards are stacked: top to bottom, then left to right. */
export function stackedOrder<T extends GridItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The lowest row any card reaches (an empty board is 0). */
export const usedRows = (items: readonly Rect[]) => items.reduce((most, item) => Math.max(most, item.y + item.h), 0);

/** The same cards on a board turned the other way: rows and heights scale with the new number of rows, the columns stay. */
export function reorient<T extends GridItem, L extends { orientation: Orientation; rows: number; cards: T[] }>(layout: L, orientation: Orientation): L {
  if (layout.orientation === orientation) return layout;
  const rows = ROWS_BY_ORIENTATION[orientation];
  const scale = rows / layout.rows;
  return { ...layout, orientation, rows, cards: layout.cards.map((card) => ({ ...card, y: Math.round(card.y * scale), h: Math.max(1, Math.round(card.h * scale)) })) };
}
