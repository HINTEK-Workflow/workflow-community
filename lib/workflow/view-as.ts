// "Visa som" (2026-10-03): the superadmin previews how the menus and pages look for a customer's roles and plans.
// Display only – the server still decides every request by the person's real rights, so nothing opens or closes.
import { defaultWorkflowPermissionProfile, workflowPermissionPresets, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";

export const VIEW_AS_COOKIE = "wf_view_as";
export const VIEW_AS_MODES = ["owner", "member", "local"] as const;
export type ViewAs = (typeof VIEW_AS_MODES)[number];

export const VIEW_AS_LABELS: Record<ViewAs, { label: string; description: string }> = {
  owner: { label: "Kundföretagets ägare (Cloud)", description: "Ett betalande företag i serverlagring: allt utom Installation." },
  member: { label: "Medarbetare (Cloud)", description: "En anställd som utför arbete: inga kunder, ingen ekonomi och inga företagsinställningar." },
  local: { label: "Gratisföretag (Local)", description: "Ett nytt konto i Local: hela Workflow i den egna filen, utan AI och MCP." },
};

/**
 * The rights a preview draws the pages with. Medarbetare is what a real worker sees (2026-11-06): Utföra arbete without
 * Kunder, so no Kunder in the menu and no Teamet, Ekonomi or Kunder on Översikt. Display only, like the rest of Visa som.
 */
export function viewAsViewer(viewAs: ViewAs): { admin: boolean; workflowPermissions: WorkflowPermissionProfile } {
  if (viewAs !== "member") return { admin: true, workflowPermissions: defaultWorkflowPermissionProfile() };
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;
  return { admin: false, workflowPermissions: { version: 1, grants: field.grants.filter((grant) => !grant.startsWith("customers:")) } };
}

export function parseViewAs(value: string | undefined | null): ViewAs | null {
  return (VIEW_AS_MODES as readonly string[]).includes(value ?? "") ? (value as ViewAs) : null;
}

/** The preview mode in a Cookie header. */
export function viewAsFromCookieHeader(header: string | null | undefined): ViewAs | null {
  const cookie = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${VIEW_AS_COOKIE}=`));
  return parseViewAs(cookie?.slice(VIEW_AS_COOKIE.length + 1));
}
/** The preview mode a request is made under, read from its cookie (an API route refuses Workflow-wide changes then). */
export const viewAsFromRequest = (request: Request): ViewAs | null => viewAsFromCookieHeader(request.headers.get("cookie"));

/** The fourth choice in Visa som (2026-11-05): no preview cookie. It is the role's default, so nothing has to be chosen. */
export const SUPERADMIN_VIEW = { label: "Superadmin", description: "Allt i företaget du är inloggad i: alla menyer, sidor och funktioner, också det som är avstängt. Andra företags data är spärrad." };

/**
 * Superadmin sees everything (2026-11-05): modules, work profiles, hidden menu items and the work view stop hiding pages in the
 * company the person is signed in to, and an action in a module that is off goes through and is logged. The server decides from the real
 * role and membership, never from anything the browser can set: the cookie can only turn it off. It gives no rights, no other company's
 * data and nothing to an API or MCP key, and it asks to be an admin of the company, so a plain membership in a customer's company stays plain.
 */
export function superadminSeesAll(who: { role: string | null | undefined; memberRole: string | null | undefined; viewAs: ViewAs | null; integration?: boolean }): boolean {
  return who.role === "SUPERADMIN" && (who.memberRole === "OWNER" || who.memberRole === "ADMIN") && !who.viewAs && !who.integration;
}
