import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { centralActor, requireCentralKeyChange, requireCentralKeyViewer } from "@/lib/secrets/central-access";
import { CentralStoreError } from "@/lib/secrets/central-store";

import { MAP_LAYERS } from "@/lib/map/attribution";
import { checkMap, clearMapCache, mapSettingsView, MAX_CACHE_MB, saveMapSettings } from "@/lib/map/topowebb";

export const dynamic = "force-dynamic";

// Workflow's superadmin only, and a fresh sign-in for every change of a key (lib/secrets/central-access.ts, 2026-10-25).
async function superadmin() {
  const ctx = await context({ skipLegal: true });
  requireCentralKeyViewer(ctx);
  return Object.assign(ctx, { ...ctx.user, activeOrganizationId: ctx.organizationId });
}

/** Karta från Lantmäteriet under Installation → Servernycklar (2026-10-04): status only, never the sign-in. */
export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await mapSettingsView(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await superadmin();
    const input = z.object({
      user: z.string().trim().max(200).nullable().optional(),
      password: z.string().max(400).nullable().optional(),
      layer: z.enum(MAP_LAYERS).optional(),
      capMb: z.number().int().min(50).max(MAX_CACHE_MB).optional(),
      action: z.enum(["check", "clear_cache"]).optional(),
    }).strict().parse(await body(request));
    const changes: string[] = [];
    if (input.action === "clear_cache") { await clearMapCache(); changes.push("Kartcachen tömdes."); }
    if (input.user !== undefined || input.password !== undefined || input.layer || input.capMb !== undefined) {
      await saveMapSettings(input, input.user !== undefined || input.password !== undefined ? await requireCentralKeyChange(user) : centralActor(user));
      if (input.user === null || input.password === null) changes.push("Inloggningen för Lantmäteriets karta togs bort.");
      else if (input.user || input.password) changes.push("Inloggningen för Lantmäteriets karta byttes.");
      if (input.layer) changes.push(`Kartlager: ${input.layer}.`);
      if (input.capMb !== undefined) changes.push(`Kartcachens gräns: ${input.capMb} MB.`);
    }
    // A new sign-in is checked at once, so the map comes on (or the reason it does not) without another click.
    const check = input.action === "check" || input.user || input.password ? await checkMap() : null;
    if (check) changes.push(`Kontroll av kartan: ${check.ok ? "OK" : "fel"} – ${check.message}`);
    if (user.activeOrganizationId && changes.length)
      await prisma.administrationEvent.create({ data: { actorId: user.id, organizationId: user.activeOrganizationId, action: "map_settings", detail: changes.join(" ").slice(0, 1000) } });
    return NextResponse.json({ ...(await mapSettingsView()), ...(check ? { check } : {}) });
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}
