import { redirect } from "next/navigation";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { requireVerifiedUser } from "@/lib/auth/session";
import { ApiError, context } from "@/lib/kfid/server";
import type { LandingDecision } from "@/lib/extensions/types";
import { checkAuthorizationRequest, hostOf } from "@/lib/oauth/server";
import { SCOPE_LABEL } from "@/lib/oauth/rules";
import { OAuthConsent } from "@/features/oauth/consent";

const shell = (description: string, children: React.ReactNode): LandingDecision => ({
  kind: "render",
  node: <AuthShell title="Anslut en app" description={description}>{children}</AuthShell>,
});
const message = (text: string) => <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{text}</p>;

/**
 * The approval page (2026-10-02, OAuth 2.1 for the MCP server). The request is checked before anything else; a
 * person who is not signed in goes to the login page and comes back here. Everyone who can log in may connect an app for
 * themselves (2026-10-02), in a Cloud company, for the company that is active right now.
 */
export async function oauthAuthorizePage(params: Record<string, string | undefined>): Promise<LandingDecision> {
  const checked = await checkAuthorizationRequest(params);
  if (!checked.ok && "redirect" in checked) redirect(checked.redirect);
  if (!checked.ok) return shell("Anslutningen kan inte göras.", message(checked.show));
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  await requireVerifiedUser(`/oauth/authorize?${query.toString()}`);
  let ctx: Awaited<ReturnType<typeof context>>;
  try { ctx = await context(); }
  catch (error) { return shell("Anslutningen kan inte göras.", message(error instanceof ApiError ? error.message : "Du saknar ett aktivt företag.")); }
  if (ctx.organization.storageMode !== "HINTEK_CLOUD") return shell("Anslutningen kan inte göras.", message("Appar kan bara anslutas till ett företag i serverlagring."));
  const { request } = checked;
  return shell(`${request.client.name} vill använda Workflow åt dig.`,
    <OAuthConsent
      params={Object.fromEntries(query)}
      app={request.client.name}
      redirectHost={hostOf(request.redirectUri)}
      company={ctx.organization.name}
      person={ctx.user.name || ctx.user.email}
      scopes={request.scopes.map((scope) => ({ key: scope, label: SCOPE_LABEL[scope] }))}
    />);
}
