import { EE_PRESENT } from "@ee/present";
import { publicInstance } from "@/lib/instance";
import { hasWorkflowPermission, mayBuildFormsWith } from "@/lib/workflow/permissions";
import { enabledModules } from "@/lib/workflow/modules";
import type { SearchAccess } from "@/lib/search/commands";
import type { Context } from "@/lib/kfid/server";

/** The public film page's path on the landing site (ee/landing, FILMS_PATH); the core cannot import ee/. */
export const HELP_FILMS_PATH = "/filmer";

/**
 * What the person may open, for the help search (search_help): the same rules as Sök uses in the browser
 * (features/kfid/global-search.tsx), built on the server from the request's own context – the member's role, permissions, the
 * company's storage and modules and the installation's parts. Only a way there: every page still checks the rights itself.
 */
export function helpAccessFor(ctx: Pick<Context, "admin" | "workflowPermissions" | "organization" | "user">): SearchAccess {
  const features = publicInstance().features;
  const local = ctx.organization.storageMode !== "HINTEK_CLOUD";
  return {
    admin: ctx.admin,
    superadmin: ctx.user.role === "SUPERADMIN",
    local,
    canBuildForms: mayBuildFormsWith({ admin: ctx.admin, workflowPermissions: ctx.workflowPermissions, cloud: !local }),
    can: (subject, action) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, action),
    features: { credits: features.credits, billing: features.billing, ai: features.ai, integrations: features.integrations, landingEditor: features.landingEditor, import: EE_PRESENT && !local },
    modules: enabledModules(ctx.organization.disabledModules),
  };
}

/** The published film page, or null where the installation has no landing page with films (Community). */
export function helpFilmsPage(): string | null {
  const instance = publicInstance();
  return instance.features.landingEditor ? `${instance.publicSiteUrl}${HELP_FILMS_PATH}` : null;
}
