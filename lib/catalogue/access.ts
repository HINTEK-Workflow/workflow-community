import { ApiError } from "@/lib/kfid/errors";
import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";

/**
 * Artiklar och priser (2026-10-08, steg 1): who may do what, checked on the server for every call. `read` = the
 * catalogue page; `pick` = search it from a work order's material row (catalogue:read, or work-order:edit so existing
 * profiles keep working, or quotes:edit for a quote's lines, 2026-10-09); `edit` = import price files, change suppliers
 * and delete an import. Admins may do everything. Prices in a search are shown only to someone who may see prices
 * (lib/workflow/material-prices.ts); others pick an article without its price and the server prices the row on save.
 */
export type CatalogueCaller = { organizationId: string; userId: string; admin: boolean; permissions: WorkflowPermissionProfile; storageMode: string };

export function catalogueAccess(caller: Pick<CatalogueCaller, "admin" | "permissions">) {
  const can = (subject: "catalogue" | "work-order" | "quotes", action: "read" | "edit") => caller.admin || hasWorkflowPermission(caller.permissions, subject, action);
  const read = can("catalogue", "read");
  return { read, pick: read || can("work-order", "edit") || can("quotes", "edit"), edit: can("catalogue", "edit") };
}

export function requireCatalogue(caller: Pick<CatalogueCaller, "admin" | "permissions" | "storageMode">, need: "read" | "pick" | "edit") {
  // Local (.hwf) companies keep their data on their own computer: the catalogue is Cloud only (decision 2026-10-08).
  if (caller.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Artiklar och priser finns bara med serverlagring. I en lokal arbetsyta skriver du material och pris för hand.");
  if (!catalogueAccess(caller)[need]) throw new ApiError(403, need === "edit" ? "Du saknar behörighet att importera och ändra artiklar och priser." : "Du saknar behörighet att se artiklar och priser.");
}
