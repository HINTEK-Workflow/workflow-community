/** The workspace shows these as its toast, so an important message is seen wherever the person is on the page. */
export const WORKSPACE_TOAST_EVENT = "hwf-toast";
/** A button in the toast, e.g. "Ångra" after something was created or filled in for the person. */
export type WorkspaceToastAction = { label: string; run: () => void };
export type WorkspaceToast = { text: string; error?: boolean; actions?: WorkspaceToastAction[] };
export function announce(text: string, error = false, actions?: WorkspaceToastAction[]) {
  window.dispatchEvent(new CustomEvent<WorkspaceToast>(WORKSPACE_TOAST_EVENT, { detail: { text, error, actions } }));
}
