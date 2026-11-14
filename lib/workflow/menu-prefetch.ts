import { hasWorkflowPermission, type WorkflowPermissionProfile, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { moduleInList, moduleOfView } from "./modules";

/**
 * Förhämtning av vanliga vyer (stabil sidladdning steg 8c, 2026-10-22/23): when the menu is shown, the router is told
 * about a few views the person most likely opens next – never the whole menu, since every prefetch reaches the server and
 * the database and the VPS traffic has drawn complaints. At most MENU_PREFETCH_LIMIT, only views the menu shows
 * the person (not hidden, readable by their permissions), never the open one. app/page.tsx does not count a prefetch as a
 * visit. The router's default kind is used on purpose: a full prefetch would be kept for minutes, and a page must never be
 * shown from an old server answer (permissions, Visa som).
 */
export const MENU_PREFETCH_LIMIT = 5;

/** The common views in the order they are likely opened, with the area a member must be able to read (none: everyone). */
const COMMON_VIEWS: readonly { view: string; area?: WorkflowPermissionSubject }[] = [
  { view: "stats" },
  { view: "tasks" },
  { view: "projects", area: "projects" },
  { view: "time" },
  { view: "customers", area: "customers" },
  { view: "quotes", area: "quotes" },
];

export function menuPrefetchHrefs(input: { view: string; hidden?: readonly string[]; admin: boolean; permissions: WorkflowPermissionProfile | null; local?: boolean; modules?: readonly string[] | null }): string[] {
  const hidden = new Set(input.hidden ?? []);
  return COMMON_VIEWS
    .filter((item) => item.view !== input.view && !hidden.has(item.view))
    .filter((item) => !(input.local && item.view === "quotes"))
    .filter((item) => { const owner = moduleOfView(item.view); return !owner || moduleInList(input.modules, owner); })
    .filter((item) => !item.area || input.admin || (input.permissions !== null && hasWorkflowPermission(input.permissions, item.area, "read")))
    .slice(0, MENU_PREFETCH_LIMIT)
    .map((item) => `/?view=${item.view}`);
}
