import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, failure, signedInUser } from "@/lib/kfid/server";
import { saveUpdateCheckSetting, updateCheckState } from "@/lib/updates/version-check-server";

export const dynamic = "force-dynamic";

async function superadmin() {
  const user = await signedInUser();
  if (!user) throw new ApiError(401, "Logga in för att fortsätta.");
  if (user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  return user;
}

/**
 * Kontrollera nya versioner (K4.8, 2026-11-28), under Hjälp → Om Workflow for the installation's administrator: the version,
 * its age and, when the switch is on (Community only, off from the start), whether a newer version is published.
 */
export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await updateCheckState(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

const input = z.object({ enabled: z.boolean() }).strict();

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await superadmin();
    const { enabled } = input.parse(await body(request));
    const before = await updateCheckState();
    if (!before.available) throw new ApiError(404, "Kontrollera nya versioner finns bara i Community.");
    await saveUpdateCheckSetting(enabled);
    if (user.activeOrganizationId && before.enabled !== enabled)
      await prisma.administrationEvent.create({ data: { actorId: user.id, organizationId: user.activeOrganizationId, action: "update_check_settings", detail: `Kontrollera nya versioner ${enabled ? "påslagen" : "avstängd"}.` } });
    return NextResponse.json(await updateCheckState(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
