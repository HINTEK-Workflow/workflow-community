/** The workspace shows these as its toast, so an important message is seen wherever the person is on the page. */
export const WORKSPACE_TOAST_EVENT = "hwf-toast";
/** A button in the toast, e.g. "Ångra" after something was created or filled in for the person. */
export type WorkspaceToastAction = { label: string; run: () => void };
/** `withdraw`: the toast showing exactly this text is taken away (it no longer applies). */
export type WorkspaceToast = { text: string; error?: boolean; warning?: boolean; actions?: WorkspaceToastAction[]; withdraw?: boolean; clear?: boolean; durationMs?: number };
/** `durationMs`: how long it stays; by default longer for an error or a message with buttons. */
export function announce(text: string, error = false, actions?: WorkspaceToastAction[], durationMs?: number) {
  window.dispatchEvent(new CustomEvent<WorkspaceToast>(WORKSPACE_TOAST_EVENT, { detail: { text, error, actions, durationMs } }));
}
/** Something that went through but needs a look (a booking that clashes): the warning tone, not the green one (kundresa 2026-11-07, L58). */
export function announceWarning(text: string, actions?: WorkspaceToastAction[]) {
  window.dispatchEvent(new CustomEvent<WorkspaceToast>(WORKSPACE_TOAST_EVENT, { detail: { text, warning: true, actions } }));
}
/** A message that no longer applies leaves the screen (QA 2026-10-10: "Ange en rubrik först." stayed after Skapa had worked). */
export function withdrawAnnouncement(text: string) {
  window.dispatchEvent(new CustomEvent<WorkspaceToast>(WORKSPACE_TOAST_EVENT, { detail: { text, withdraw: true } }));
}
/**
 * Kort lyckat besked (beslut 12, 2026-10-18): "Sparat", "Tid sparad", "Plats sparad". En händelse = ett besked; skicka det
 * efter att åtgärden lyckats, aldrig tillsammans med en röd rad om samma sak.
 */
export function notice(text: string) {
  announce(text, false, undefined, 3500);
}
/** Every message on the screen leaves (the action it belonged to has changed or the person has moved on). */
export function clearAnnouncements() {
  window.dispatchEvent(new CustomEvent<WorkspaceToast>(WORKSPACE_TOAST_EVENT, { detail: { text: "", clear: true } }));
}

/** A message given within this time of a page change belongs to the action that changed the page and stays. */
export const FRESH_TOAST_MS = 1500;
/** Whether a message left over from before a page change is stale: older than the action that moved the page, and without a button (Ångra) of its own. */
export function toastIsStale(toast: { at?: number; actions?: readonly unknown[] }, now = Date.now()) {
  return !toast.actions?.length && now - (toast.at ?? 0) > FRESH_TOAST_MS;
}
/**
 * En händelse = ett besked (beslut 12): a toast is not drawn when the page already says the same thing in a row or a banner
 * of its own. `shown` are the visible texts of the page; short texts ("Sparat") are never matched against it.
 */
export function sentenceAlreadyShown(text: string, shown: readonly string[]) {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = normalize(text);
  if (wanted.length < 12) return false;
  return shown.some((item) => {
    const own = normalize(item);
    return own.length >= 12 && own.startsWith(wanted); // never the other way round: a row title ("Objektdata på platser") is not the message "…är påslaget."
  });
}
