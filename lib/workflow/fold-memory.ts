/**
 * Minnet för ihopfällda kort (2026-11-02, docs/design-standard.md "Ihopfällt eller öppet"): what a person has folded
 * or opened is remembered on this device, per person. Only in the browser's own storage: nothing goes to the server and
 * nothing is in the database. The key holds the person's id, so two people on one device never share a fold; without a
 * known person nothing is remembered. Pure, so the rules are tested without a browser (the hook: features/workflow/use-fold-memory.ts).
 */
export type FoldStorage = Pick<Storage, "getItem" | "setItem">;
export type RememberedFolds = Record<string, boolean>;

const PREFIX = "hintek.folds.v1.";

/** The storage key of one person's folds; null without a person, and then nothing is read or written. */
export function foldStoreKey(ownerId: string | null | undefined): string | null {
  return ownerId ? `${PREFIX}${ownerId}` : null;
}

/** What is stored, keeping only real answers: anything damaged or strange reads as nothing remembered. */
export function parseFolds(raw: string | null | undefined): RememberedFolds {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch { return {}; }
}

/** One person's folds from the storage; a storage that refuses (private mode, turned off) reads as nothing remembered. */
export function readFolds(storage: FoldStorage | null | undefined, ownerId: string | null | undefined): RememberedFolds {
  const key = foldStoreKey(ownerId);
  if (!storage || !key) return {};
  try { return parseFolds(storage.getItem(key)); } catch { return {}; }
}

/** Keeps one fold for one person and answers the person's folds now. A refused write only means it is not kept. */
export function writeFold(storage: FoldStorage | null | undefined, ownerId: string | null | undefined, foldKey: string, collapsed: boolean): RememberedFolds {
  const next = { ...readFolds(storage, ownerId), [foldKey]: collapsed };
  const key = foldStoreKey(ownerId);
  if (storage && key) { try { storage.setItem(key, JSON.stringify(next)); } catch { /* full or turned off: the fold still works on this page */ } }
  return next;
}

/**
 * Whether a fold is shut. The order is the rule: what happened on the page now (the person's click, or an address that
 * opened it) comes first, so an address always wins; then what the person chose before; last the card's own start.
 */
export function foldIsShut(input: { now: boolean | null; remembered: boolean | null; start: boolean }): boolean {
  return input.now ?? input.remembered ?? input.start;
}
