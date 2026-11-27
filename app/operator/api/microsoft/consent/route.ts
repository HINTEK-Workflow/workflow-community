import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import { parseFlowCookie } from "@/lib/operator/microsoft-group";
import { ADMIN_RETURN, clearFlowCookie, FLOW_COOKIE } from "@/lib/operator/flow-cookie";

export const dynamic = "force-dynamic";

const go = (location: string) => new NextResponse(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

/**
 * The directory administrator's consent comes back here (redirect URI: <APP_URL>/operator/api/microsoft/consent). Kept
 * only for the directory already connected through a verified sign-in – the `tenant` in the address never sets the
 * directory. Whether the app may really read the group is shown by Kontrollera (Graph) afterwards.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const flow = parseFlowCookie((await cookies()).get(FLOW_COOKIE)?.value);
    const ctx = await context();
    requireAdmin(ctx);
    requireCloudStorage(ctx);
    const back = (result: string) => { const response = go(`${ADMIN_RETURN}&ms=${result}`); clearFlowCookie(response); return response; };
    if (!flow || flow.purpose !== "connect" || params.get("state") !== flow.state || ctx.organizationId !== flow.organizationId) return back("expired");
    if (params.get("admin_consent") !== "True") return back("no-consent");
    const tenant = (params.get("tenant") ?? "").toLowerCase();
    const { count } = await prisma.operatorSettings.updateMany({ where: { organizationId: ctx.organizationId, microsoftTenantId: tenant }, data: { microsoftConsentAt: new Date(), updatedById: ctx.user.id } });
    if (!count) return back("tenant");
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "operator_microsoft_consent", detail: "Katalogens administratör gav operatörssidan medgivande att läsa gruppmedlemskap." } });
    return back("consented");
  } catch (error) {
    return failure(error);
  }
}
