/** Flerval i listor och papperskorgar: rena regler som både skärmen och servern delar. */
export const BULK_LIMIT = 100;
export type BulkAction = "delete" | "restore" | "purge";
export type BulkFailure = { id: string; reason: string };
export type BulkOutcome = { ok: number; failed: BulkFailure[] };

/** none / some / all of the rows on the page are marked (a checkbox shows "some" as indeterminate). */
export function selectionState(selected: readonly string[], pageIds: readonly string[]): "none" | "some" | "all" {
  if (!pageIds.length) return "none";
  const marked = pageIds.filter((id) => selected.includes(id)).length;
  return marked === 0 ? "none" : marked === pageIds.length ? "all" : "some";
}

/** Markera alla på sidan adds the page's rows (never above the limit); off removes them. Marks on other pages stay. */
export function toggleAllOnPage(selected: readonly string[], pageIds: readonly string[], on: boolean): string[] {
  if (!on) return selected.filter((id) => !pageIds.includes(id));
  return limitIds([...new Set([...selected, ...pageIds])]);
}

export function toggleOne(selected: readonly string[], id: string, on: boolean): string[] {
  if (!on) return selected.filter((value) => value !== id);
  return selected.includes(id) ? [...selected] : limitIds([...selected, id]);
}

export function limitIds(ids: readonly string[]): string[] {
  return ids.slice(0, BULK_LIMIT);
}

/** "1 vald" / "3 valda". */
export function selectedLabel(count: number): string {
  return count === 1 ? "1 vald" : `${count} valda`;
}

const DONE: Record<BulkAction, [string, string]> = {
  delete: ["flyttad till papperskorgen", "flyttade till papperskorgen"],
  restore: ["återställd", "återställda"],
  purge: ["raderad", "raderade"],
};

/** The one line shown after a bulk action. A partial result says how many went through and how many did not. */
export function bulkOutcomeMessage(action: BulkAction, outcome: BulkOutcome, noun: [string, string] = ["post", "poster"]): { text: string; error: boolean } {
  const { ok, failed } = outcome;
  const total = ok + failed.length;
  const [one, many] = DONE[action];
  if (!failed.length) return { text: ok === 1 ? `1 ${noun[0]} ${one}.` : `${ok} ${noun[1]} ${many}.`, error: false };
  if (!ok) return { text: `Ingen ${noun[0]} blev ${one}. ${failed[0]?.reason ?? ""}`.trim(), error: true };
  return { text: `${ok} av ${total} ${noun[1]} ${many}. ${failed.length} gick inte. ${failed[0]?.reason ?? ""}`.trim(), error: true };
}

/**
 * Decides per record what a bulk action may do. Nothing is skipped silently: a missing record or a purge outside the
 * papperskorg ends up in `failed` with a reason, and the rest goes through.
 */
export function planBulk(action: BulkAction, ids: readonly string[], found: readonly { id: string; deletedAt: Date | null }[]): { apply: string[]; failed: BulkFailure[] } {
  const byId = new Map(found.map((record) => [record.id, record]));
  const apply: string[] = [];
  const failed: BulkFailure[] = [];
  for (const id of new Set(ids)) {
    const record = byId.get(id);
    if (!record) failed.push({ id, reason: "Posten finns inte." });
    else if (action === "purge" && !record.deletedAt) failed.push({ id, reason: "Posten ligger inte i papperskorgen." });
    else if (action === "restore" && !record.deletedAt) failed.push({ id, reason: "Posten ligger inte i papperskorgen." });
    else if (action === "delete" && record.deletedAt) failed.push({ id, reason: "Posten ligger redan i papperskorgen." });
    else apply.push(id);
  }
  return { apply, failed };
}
