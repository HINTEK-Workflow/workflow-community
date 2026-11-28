import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { ApiError, body, checkOrigin, context, failure, requireAdmin } from "@/lib/kfid/server";
import { SUPPORT_ACCESS_DEFAULT_HOURS, SUPPORT_ACCESS_HOURS } from "@/lib/security/access-rules";
import { grantSupportAccess, revokeSupportAccess, supportAccessForCompany } from "@/lib/security/support-access";

export const dynamic = "force-dynamic";

/**
 * Supportåtkomst (K2.3, beslut 2026-11-28), under Användare → Säkerhet: the company's own admin – for the active company only,
 * in a session (never an API or MCP key) – gives the installation's support read-only access for 1 hour, 24 hours or 7 days,
 * sees everything support read, and can take it back at any time. Off until the admin gives it.
 */
async function admin() {
  const ctx = await context();
  requireAdmin(ctx);
  if (ctx.integration) throw new ApiError(403, "Supportåtkomst ges bara av en inloggad administratör, inte med en nyckel.");
  if (ctx.organization.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Företaget använder lokal lagring. Supporten har inga uppgifter att läsa på servern.");
  return ctx;
}

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET() {
  try {
    const ctx = await admin();
    return NextResponse.json({ ...(await supportAccessForCompany(ctx.organizationId)), choices: SUPPORT_ACCESS_HOURS, defaultHours: SUPPORT_ACCESS_DEFAULT_HOURS }, noStore);
  } catch (error) {
    return failure(error);
  }
}

const hours = z.union([z.literal(SUPPORT_ACCESS_HOURS[0]), z.literal(SUPPORT_ACCESS_HOURS[1]), z.literal(SUPPORT_ACCESS_HOURS[2])]).default(SUPPORT_ACCESS_DEFAULT_HOURS);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("grant"), hours }),
  z.object({ action: z.literal("revoke") }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await admin();
    const command = input.parse(await body(request));
    if (command.action === "grant") {
      // The consent is the company's own: a superadmin who is also a member here can never give it to the installation itself.
      if (ctx.user.role === "SUPERADMIN") throw new ApiError(403, "Supportåtkomst ges av kundföretagets egen administratör.");
      // Like a new key: a password, code or passkey within ten minutes before the company's data opens to anyone outside it.
      await requireFreshAuth(ctx.user.id, ctx.auth);
      const grant = await grantSupportAccess({ organizationId: ctx.organizationId, actorId: ctx.user.id, hours: command.hours, headers: request.headers });
      return NextResponse.json({ ok: true, expiresAt: grant.expiresAt.toISOString() }, noStore);
    }
    // Taking it back is always possible at once, without a new confirmation.
    const closed = await revokeSupportAccess({ organizationId: ctx.organizationId, actorId: ctx.user.id, headers: request.headers });
    if (!closed) throw new ApiError(409, "Supporten har ingen åtkomst just nu.");
    return NextResponse.json({ ok: true }, noStore);
  } catch (error) {
    return failure(error);
  }
}
