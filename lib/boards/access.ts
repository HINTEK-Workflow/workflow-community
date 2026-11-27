import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";

/**
 * Vem får vad med tavlor (2026-11-18, frågorna 4–5): three rights for boards – read, create/change and publish to screens and
 * links – and one for screens (see, and connect/change/block). Admins and owners hold all by role. A right never turns the module
 * on, and the server checks every call (the menu only shows). Pure, for the server, the shell and the tests.
 */
export type BoardsAccessInput = { admin: boolean; workflowPermissions: WorkflowPermissionProfile };
export function boardsAccess(input: BoardsAccessInput) {
  const can = (subject: "boards" | "screens", action: "read" | "edit" | "publish") => input.admin || hasWorkflowPermission(input.workflowPermissions, subject, action);
  return {
    read: can("boards", "read"),
    edit: can("boards", "edit"),
    publish: can("boards", "publish"),
    screens: can("screens", "read"),
    manageScreens: can("screens", "edit"),
  };
}
/**
 * The rights as the pages read them, with the app's public address and, in the public demo, `demo` (screens and links need a
 * server, so those tabs say so). An older answer has neither; then the page's own origin is used.
 */
export type BoardsAccess = ReturnType<typeof boardsAccess> & { origin?: string; demo?: boolean };
/** The full address of a path on the app (2026-11-19: never a bare /skarm), from the configured address or the page's own. */
export function appAddress(access: { origin?: string } | null | undefined, path: string) {
  const origin = (access?.origin || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  return `${origin}${path}`;
}
