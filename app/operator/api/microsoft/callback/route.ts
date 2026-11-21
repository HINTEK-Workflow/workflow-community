import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import { recordSecurityEvent } from "@/lib/security/security-log";
import { parseFlowCookie } from "@/lib/operator/microsoft-group";
import { companyLockAllows, groupSignIn, identityFromCode, installationAccepts } from "@/lib/operator/microsoft-group-server";
import { deviceId, setOperatorCookies, startOperatorSession } from "@/lib/operator/session";
import { ADMIN_RETURN, clearFlowCookie, FLOW_COOKIE } from "@/lib/operator/flow-cookie";
import { operatorPagePath } from "@/lib/operator/rules";

export const dynamic = "force-dynamic";

const go = (location: string) => new NextResponse(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

/**
 * Microsoft's answer (redirect URI: <APP_URL>/operator/api/microsoft/callback). The state must match the short cookie
 * this browser got when it started; the ID token is verified (signature, issuer, audience, times, nonce, directory).
 * Operator: the group is asked, the account found by tid + oid or made, and a device-bound session starts. Connect: the
 * admin's verified directory becomes the company's (consent, group and the switch start over when it changes).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const flow = parseFlowCookie((await cookies()).get(FLOW_COOKIE)?.value);
  const stateOk = Boolean(flow && params.get("state") && params.get("state") === flow.state);
  const code = params.get("code") ?? "";
  try {
    if (!flow || flow.purpose === "operator") {
      const back = (error: string) => { const response = go(flow ? `${operatorPagePath(flow.pageKey)}?fel=${error}` : "/"); clearFlowCookie(response); return response; };
      if (!flow || !stateOk) return back("expired");
      if (!code) return back("token");
      const settings = await prisma.operatorSettings.findUnique({ where: { organizationId: flow.organizationId }, select: { microsoftTenantId: true, pageKey: true } });
      if (!settings?.microsoftTenantId) return back("off");
      const identity = await identityFromCode({ code, flow, tenant: settings.microsoftTenantId });
      if (!identity) return back("token");
      const result = await groupSignIn({ organizationId: flow.organizationId, identity });
      if (!result.ok) {
        await recordSecurityEvent({ type: "operator_login_failed", organizationId: flow.organizationId, platform: false, detail: "Microsoft", headers: request.headers });
        return back(result.error);
      }
      const device = await deviceId();
      const token = await startOperatorSession({ accountId: result.accountId, organizationId: flow.organizationId, device: device.id, method: "microsoft", headers: request.headers });
      await recordSecurityEvent({ type: "operator_login_ok", organizationId: flow.organizationId, actorId: `operator:${result.accountId}`, platform: false, detail: "Microsoft", headers: request.headers });
      const response = go(operatorPagePath(settings.pageKey));
      setOperatorCookies(response, { token, device });
      clearFlowCookie(response);
      return response;
    }
    // Koppla katalogen: the company's admin, in the company the flow started in.
    const ctx = await context();
    requireAdmin(ctx);
    requireCloudStorage(ctx);
    const back = (result: string) => { const response = go(`${ADMIN_RETURN}&ms=${result}`); clearFlowCookie(response); return response; };
    if (!stateOk || ctx.organizationId !== flow.organizationId) return back("expired");
    if (!code) return back("token");
    const identity = await identityFromCode({ code, flow, tenant: "organizations" });
    if (!identity) return back("token");
    if (!(await installationAccepts(identity.tid))) return back("tenant");
    if (!(await companyLockAllows(ctx.organizationId, identity.tid))) return back("locked");
    const before = await prisma.operatorSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { microsoftTenantId: true } });
    const changed = before?.microsoftTenantId !== identity.tid;
    await prisma.$transaction(async (tx) => {
      await tx.operatorSettings.update({ where: { organizationId: ctx.organizationId }, data: changed
        ? { microsoftTenantId: identity.tid, microsoftConsentAt: null, microsoftEnabled: false, microsoftGroupId: null, microsoftGroupName: "", microsoftCheck: {}, updatedById: ctx.user.id }
        : { updatedById: ctx.user.id } });
      await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "operator_microsoft_directory", detail: `Kopplade företagets Microsoft-katalog (${identity.tid}) till operatörssidan.` } });
    });
    return back("connected");
  } catch (error) {
    return failure(error);
  }
}
