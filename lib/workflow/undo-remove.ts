/**
 * Ångra borttagen rad (2026-10-11): a removed row can be put back for a short while – from the toast's Ångra
 * button or Ctrl/Cmd+Z – at its original place and with everything it held (a catalogue copy, sources, ROT mark…).
 * Pure rules shared by the quote, the invoice basis and the work order's rows, so every list behaves the same.
 */

/** How long Ångra is offered (the toast stays that long, and so does Ctrl/Cmd+Z). */
export const UNDO_REMOVE_MS = 8000;

/** A removed row with where it stood: its index and the row it followed. */
export type RemovedRow<T> = { item: T; index: number; afterId: string | null; at: number };

/** The list without the row, and what is needed to put it back; the list unchanged (and null) when the row is not there. */
export function removeRow<T extends { id: string }>(list: readonly T[], id: string, now = Date.now()): { list: T[]; removed: RemovedRow<T> | null } {
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return { list: [...list], removed: null };
  return { list: list.filter((item) => item.id !== id), removed: { item: list[index], index, afterId: index > 0 ? list[index - 1].id : null, at: now } };
}

/**
 * The row put back where it stood: right after the row it followed when that is still there, otherwise at its old index
 * (or last when the list is now shorter). A row that is already in the list is never added twice.
 */
export function restoreRow<T extends { id: string }>(list: readonly T[], removed: RemovedRow<T>): T[] {
  if (list.some((item) => item.id === removed.item.id)) return [...list];
  let index = Math.min(removed.index, list.length);
  if (removed.afterId === null) index = 0;
  else {
    const after = list.findIndex((item) => item.id === removed.afterId);
    if (after >= 0) index = after + 1;
  }
  return [...list.slice(0, index), removed.item, ...list.slice(index)];
}

/** Whether Ångra is still offered for a row removed at `at`. */
export const undoStillOffered = (removed: Pick<RemovedRow<unknown>, "at">, now = Date.now()) => now - removed.at <= UNDO_REMOVE_MS;
