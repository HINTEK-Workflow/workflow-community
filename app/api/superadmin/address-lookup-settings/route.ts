import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { requireCentralKeyChange, requireCentralKeyViewer } from "@/lib/secrets/central-access";
import { CentralStoreError } from "@/lib/secrets/central-store";

import { ADDRESS_ENVIRONMENTS, ADDRESS_METHODS, addressLookupView, checkAddressLookup, saveAddressLookupSettings } from "@/lib/geo/address-lookup";

export const dynamic = "force-dynamic";

// Workflow's superadmin only, and a fresh sign-in for every change of a key (lib/secrets/central-access.ts, 2026-10-25).
async function superadmin() {
  const ctx = await context({ skipLegal: true });
  requireCentralKeyViewer(ctx);
  return Object.assign(ctx, { ...ctx.user, activeOrganizationId: ctx.organizationId });
}

const METHOD_NAMES = { map: "samma inloggning som kartan", basic: "eget användarnamn och lösenord", oauth: "API-nyckel (OAuth2)" } as const;

/** Adresser från Lantmäteriet under Installation → Tjänster (2026-10-08, 2026-10-15): status only, never a value. */
export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await addressLookupView(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await superadmin();
    const input = z.object({
      method: z.enum(ADDRESS_METHODS).optional(),
      user: z.string().trim().max(200).nullable().optional(),
      password: z.string().max(400).nullable().optional(),
      key: z.string().trim().max(400).nullable().optional(),
      secret: z.string().max(400).nullable().optional(),
      environment: z.enum(ADDRESS_ENVIRONMENTS).optional(),
      action: z.enum(["check"]).optional(),
    }).strict().parse(await body(request));
    const before = await addressLookupView();
    const changes: string[] = [];
    const { action, ...settings } = input;
    if (Object.values(settings).some((value) => value !== undefined)) {
      await saveAddressLookupSettings(settings, await requireCentralKeyChange(user));
      if (input.method && input.method !== before.method) changes.push(`Inloggning för adresser: ${METHOD_NAMES[input.method]}.`);
      if (input.user === null || input.password === null) changes.push("Användarnamn och lösenord för adresser togs bort.");
      else if (input.user || input.password) changes.push("Användarnamn eller lösenord för adresser byttes.");
      if (input.key === null || input.secret === null) changes.push("API-nyckeln för adresser togs bort.");
      else if (input.key || input.secret) changes.push("API-nyckeln för adresser byttes.");
      if (input.environment && input.environment !== before.environment) changes.push(`Miljö för adresser: ${input.environment === "production" ? "produktion" : "verifiering"}.`);
    }
    // A new sign-in (new values, or another way chosen) is checked at once when it is complete, so proposals and search
    // come on – or the reason they do not – without another click.
    const after = await addressLookupView();
    const newSignIn = Boolean(input.user || input.password || input.key || input.secret || (input.method && input.method !== before.method) || (input.environment && input.environment !== before.environment));
    const check = action === "check" || (newSignIn && after.configured) ? await checkAddressLookup() : null;
    if (check) changes.push(`Kontroll av adresser: ${check.ok ? "OK" : "fel"} – ${check.message}`);
    if (user.activeOrganizationId && changes.length)
      await prisma.administrationEvent.create({ data: { actorId: user.id, organizationId: user.activeOrganizationId, action: "address_lookup_settings", detail: changes.join(" ").slice(0, 1000) } });
    return NextResponse.json({ ...(await addressLookupView()), ...(check ? { check } : {}) });
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}
