import { NextResponse } from "next/server";
import { context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import { groupSignInReady } from "@/lib/operator/microsoft-group";
import { consentUrl, installationAccepts, newFlow, startUrl } from "@/lib/operator/microsoft-group-server";
import { ensureOperatorSettings, settingsByPageKey } from "@/lib/operator/settings-server";
import { ADMIN_RETURN, setFlowCookie } from "@/lib/operator/flow-cookie";
import { isPageKey, operatorPagePath } from "@/lib/operator/rules";

export const dynamic = "force-dynamic";

const go = (location: string) => new NextResponse(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

/**
 * Starts a Microsoft sign-in (lib/operator/microsoft-group.ts):
 * - `?page=<key>`: an operator on the company's page – only while the company's group sign-in is on and set up;
 * - `?connect=1`: the company's admin connects the directory by signing in with a Microsoft work account;
 * - `?consent=1`: the company's admin asks the directory's administrator for the app's consent (GroupMember.Read.All).
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const page = params.get("page") ?? "";
    if (page) {
      const settings = isPageKey(page) ? await settingsByPageKey(page) : null;
      if (!settings) return go("/");
      const ready = groupSignInReady({ enabled: settings.microsoftEnabled, tenantId: settings.microsoftTenantId, groupId: settings.microsoftGroupId, consentAt: settings.microsoftConsentAt });
      const flow = newFlow("operator", page, settings.organizationId);
      const url = ready && (await installationAccepts(settings.microsoftTenantId!)) ? await startUrl(flow, settings.microsoftTenantId!) : null;
      if (!url) return go(`${operatorPagePath(page)}?fel=off`);
      const response = go(url);
      setFlowCookie(response, flow);
      return response;
    }
    const ctx = await context();
    requireAdmin(ctx);
    requireCloudStorage(ctx);
    const settings = await ensureOperatorSettings(ctx.organizationId);
    const flow = newFlow("connect", "", ctx.organizationId);
    const url = params.get("consent") === "1"
      ? (settings.microsoftTenantId ? await consentUrl(settings.microsoftTenantId, flow.state) : null)
      : await startUrl(flow, "organizations");
    if (!url) return go(`${ADMIN_RETURN}&ms=off`);
    const response = go(url);
    setFlowCookie(response, flow);
    return response;
  } catch (error) {
    return failure(error);
  }
}
