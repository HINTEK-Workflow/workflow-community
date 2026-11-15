import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { clearTwoFactorRequiredCache } from "@/lib/auth/two-factor";
import { ApiError, body, checkOrigin, failure, signedInAuth } from "@/lib/kfid/server";
import { platformSecurityLog, recordSecurityEvent } from "@/lib/security/security-log";

export const dynamic = "force-dynamic";

/**
 * Installation → Inloggning → Säkerhet (2026-10-10): whether superadmins must use two-factor, and the
 * installation-level security log – superadmin accounts and the installation's rules only, never a customer's members.
 */
async function superadmin() {
  const auth = await signedInAuth();
  if (!auth) throw new ApiError(401, "Logga in för att fortsätta.");
  if (auth.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  return auth;
}

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(request: Request) {
  try {
    await superadmin();
    const cursor = new URL(request.url).searchParams.get("before");
    if (cursor) return NextResponse.json({ log: await platformSecurityLog(cursor) }, noStore);
    const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { requireTwoFactorSuperadmin: true } });
    return NextResponse.json({ required: Boolean(row?.requireTwoFactorSuperadmin), log: await platformSecurityLog() }, noStore);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const auth = await superadmin();
    const { required } = z.object({ required: z.boolean() }).strict().parse(await body(request));
    await requireFreshAuth(auth.user.id, auth);
    await prisma.systemSettings.upsert({ where: { id: "global" }, update: { requireTwoFactorSuperadmin: required }, create: { id: "global", requireTwoFactorSuperadmin: required } });
    clearTwoFactorRequiredCache();
    await recordSecurityEvent({ type: "two_factor_policy", actorId: auth.user.id, platform: true, detail: required ? "Krävs för superadmin" : "Krävs inte för superadmin", headers: request.headers });
    return NextResponse.json({ ok: true, required });
  } catch (error) {
    return failure(error);
  }
}
