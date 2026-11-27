import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { requireCentralKeyChange, requireCentralKeyViewer } from "@/lib/secrets/central-access";
import { CentralStoreError } from "@/lib/secrets/central-store";
import { probeAzure } from "@/lib/ai/azure-provider";
import { AI_PROFILE_NAME, azureInputSchema, azureModelPriced, azureProbeInputSchema, euVerifiedCount } from "@/lib/ai/azure-settings";
import { azureSettingsView, clearAzureKey, saveAzureSettings } from "@/lib/ai/azure-settings-server";

export const dynamic = "force-dynamic";

// Workflow's superadmin only, and a fresh sign-in for every change (lib/secrets/central-access.ts, 2026-10-25).
async function superadmin() {
  const ctx = await context();
  requireCentralKeyViewer(ctx);
  return ctx;
}

/**
 * Workflow AI på Azure i appen (2026-10-19, 2026-11-21): the superadmin gives the resource address, the key (sealed, shown
 * again only as its last four characters), the deployments of each AI profile (Standard and EU) and the model cards, where EU is
 * marked per model, and confirms that Microsoft's agreement is in place. Nothing is on until all of it is.
 */
export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await azureSettingsView(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), settings: azureInputSchema }),
  // Kontrollera (a minimal real call against the deployment) and Provfråga (synthetic text): unsaved values from the form, or the saved ones.
  azureProbeInputSchema.extend({ action: z.literal("check") }),
  azureProbeInputSchema.extend({ action: z.literal("probe") }),
  z.object({ action: z.literal("clear_key") }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const command = commandSchema.parse(await body(request));
    const actor = command.action === "check" || command.action === "probe" ? null : await requireCentralKeyChange(ctx);
    const audit = (detail: string) => prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "ai_azure_settings", detail } });
    if (command.action === "check" || command.action === "probe") {
      // Charged to no company: a free run in Workflow's own organisation, shown in AI-användning as Azure's trial.
      const { action, ...values } = command;
      const result = await probeAzure({ organizationId: ctx.organizationId, actorId: ctx.user.id, kind: action === "check" ? "check" : "question", ...values });
      await audit(`Azure: ${action === "check" ? "kontroll" : "provfråga"} (profil ${AI_PROFILE_NAME[values.profile ?? "standard"]}) mot ${values.deployment || "sparad driftsättning"} – ${result.ok ? "lyckades" : "misslyckades"}.`);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "clear_key") {
      await clearAzureKey(actor!);
      await audit("Tog bort Azure-nyckeln som sparats i appen.");
      return NextResponse.json(await azureSettingsView());
    }
    let saved: { keyChanged: boolean };
    try { saved = await saveAzureSettings(command.settings, actor!); }
    catch (error) { if (error instanceof Error && /Adressen|nyckeln|driftsättningsnamn|källan/.test(error.message)) throw new ApiError(400, error.message); throw error; }
    const s = command.settings;
    const after = await azureSettingsView();
    await audit(`Azure: ${s.enabled ? "påslagen" : "avslagen"}, avtal ${s.dpaApproved ? "bekräftat" : "ej bekräftat"}, ${euVerifiedCount(after)} EU-verifierade modeller${s.models ? `, modeller: ${s.models.map((model) => `${model.deployment} (${azureModelPriced(model) ? "pris" : "pris saknas"}, EU ${model.euVerified ? "verifierad" : "ej verifierad"})`).join(", ")}` : ""}${saved.keyChanged ? ", ny nyckel" : ""}.`);
    return NextResponse.json(after);
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}
