import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { requireCentralKeyChange, requireCentralKeyViewer } from "@/lib/secrets/central-access";
import { CentralStoreError } from "@/lib/secrets/central-store";

import { checkMicrosoft, MicrosoftSettingsError, microsoftView, saveMicrosoftSettings } from "@/lib/auth/microsoft";

export const dynamic = "force-dynamic";

// Workflow's superadmin only, and a fresh sign-in for every change of a key (lib/secrets/central-access.ts, 2026-10-25).
async function superadmin() {
  const ctx = await context({ skipLegal: true });
  requireCentralKeyViewer(ctx);
  return Object.assign(ctx, { ...ctx.user, activeOrganizationId: ctx.organizationId });
}

/**
 * Inloggning med Microsoft (2026-10-11): the keys under Installation → Servernycklar and the switch under
 * Inloggning. Status only – the client secret is sealed and never returned. Changes go to the administration history
 * without any value.
 */
export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await microsoftView(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await superadmin();
    const input = z.object({
      clientId: z.string().trim().max(100).nullable().optional(),
      secret: z.string().max(400).nullable().optional(),
      tenant: z.string().trim().max(100).optional(),
      enabled: z.boolean().optional(),
      // Microsofts tvåsteg räknas som Workflows (2026-11-27); on by default.
      mfaAsSecondStep: z.boolean().optional(),
      action: z.enum(["check"]).optional(),
    }).strict().parse(await body(request));
    const changes: string[] = [];
    if (input.clientId !== undefined || input.secret !== undefined || input.tenant !== undefined || input.enabled !== undefined || input.mfaAsSecondStep !== undefined) {
      try { await saveMicrosoftSettings(input, await requireCentralKeyChange(user)); }
      catch (error) { if (error instanceof MicrosoftSettingsError) throw new ApiError(400, error.message); throw error; }
      if (input.clientId === null || input.secret === null) changes.push("Nycklarna för Microsoft-inloggning togs bort.");
      else if (input.clientId || input.secret) changes.push("Nycklarna för Microsoft-inloggning byttes.");
      if (input.tenant !== undefined) changes.push("Vilka Microsoft-konton som får logga in ändrades.");
      if (input.enabled !== undefined) changes.push(input.enabled ? "Fortsätt med Microsoft slogs på." : "Fortsätt med Microsoft stängdes av.");
      if (input.mfaAsSecondStep !== undefined) changes.push(input.mfaAsSecondStep ? "Microsofts tvåsteg räknas som tvåsteg i Workflow." : "Microsofts tvåsteg räknas inte längre som tvåsteg i Workflow.");
    }
    // New keys are checked at once, so the button comes on (or the reason it does not) without another click.
    const check = input.action === "check" || input.clientId || input.secret ? await checkMicrosoft() : null;
    if (check) changes.push(`Kontroll av Microsoft-inloggning: ${check.ok ? "OK" : "fel"} – ${check.message}`);
    if (user.activeOrganizationId && changes.length)
      await prisma.administrationEvent.create({ data: { actorId: user.id, organizationId: user.activeOrganizationId, action: "microsoft_sign_in_settings", detail: changes.join(" ").slice(0, 1000) } });
    return NextResponse.json({ ...(await microsoftView()), ...(check ? { check } : {}) });
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}
