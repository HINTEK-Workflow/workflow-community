import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { googleKeysConfigured, googleSignInAllowed, setGoogleSignInAllowed } from "@/lib/auth/login-settings";
import { publicInstance } from "@/lib/instance";
import { ApiError, body, checkOrigin, failure } from "@/lib/kfid/server";

export const dynamic = "force-dynamic";

async function superadmin() {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Logga in för att fortsätta.");
  if (user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratör krävs.");
  return user;
}

const view = async () => ({ googleSignIn: await googleSignInAllowed(), googleConfigured: googleKeysConfigured(), googleAvailable: publicInstance().features.googleSignIn });

/** Inloggning (2026-10-03): whether "Fortsätt med Google" is offered on the login page. */
export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await view(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await superadmin();
    const input = z.object({ googleSignIn: z.boolean() }).strict().parse(await body(request));
    await setGoogleSignInAllowed(input.googleSignIn);
    if (user.activeOrganizationId)
      await prisma.administrationEvent.create({ data: { actorId: user.id, organizationId: user.activeOrganizationId, action: "login_settings", detail: `Inloggning med Google ${input.googleSignIn ? "påslagen" : "avstängd"}.` } });
    return NextResponse.json(await view());
  } catch (error) {
    return failure(error);
  }
}
