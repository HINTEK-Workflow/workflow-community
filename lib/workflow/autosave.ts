/**
 * Calm autosave (2026-10-05: "Autosparar upplevs störigt och hoppar till. Fungerade mycket bra i V1."). Like V1:
 * saved quietly after a pause in the typing, on leaving a field, when the tab is hidden and before navigating; one
 * small status of fixed width that never moves the page, and an error only when a save really failed.
 */

/** The pause after the last change before an autosave. */
export const AUTOSAVE_DELAY_MS = 2500;

export type AutosaveState = "idle" | "saving" | "error";
export type SaveIndicator = { label: string; tone: "muted" | "error"; state: "saved" | "saving" | "changed" | "error" };

/**
 * The status text. "Sparat" is said only when everything is saved (2026-11-01: "Sparat" showed while a change waited
 * for its autosave): with autosave on, "Sparar…" from the first change, through the pause and the save, until the server
 * has answered; then "Sparat" with the time. It stays calm without a delay of its own: while the person types the label
 * stays "Sparar…", so it changes once when the typing starts and once when the save is done. Without autosave a change
 * says "Ändrat", since nothing saves it by itself; a failed save says "Inte sparat".
 */
export function saveIndicator({ state, dirty, autosave, savedAt }: { state: AutosaveState; dirty: boolean; autosave: boolean; savedAt: string }): SaveIndicator {
  if (state === "error") return { label: "Inte sparat", tone: "error", state: "error" };
  if (state === "saving" || (dirty && autosave)) return { label: "Sparar…", tone: "muted", state: "saving" };
  if (dirty) return { label: "Ändrat", tone: "muted", state: "changed" };
  return { label: savedAt ? `Sparat ${savedAt}` : "Sparat", tone: "muted", state: "saved" };
}

/** A live event about the person's own save in this tab, already applied from the save's reply: nothing to read. */
export function isOwnEcho(change: { byUserId: string; version: number; reason: string }, userId: string | undefined, savedVersion: number | undefined): boolean {
  return Boolean(userId) && change.byUserId === userId && change.reason === "save" && savedVersion !== undefined && change.version <= savedVersion;
}
