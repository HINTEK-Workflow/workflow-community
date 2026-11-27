import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { requireCentralKeyChange, requireCentralKeyViewer } from "@/lib/secrets/central-access";
import { CentralStoreError } from "@/lib/secrets/central-store";
import { checkOpenAiKey } from "@/lib/ai/openai-provider";
import { openAiSettings, clearProviderKey, openAiModelCards, providerSettingsView, saveOpenAiModelCards, saveProviderSettings } from "@/lib/ai/provider-settings-server";
import { azureModelPriced, azureModelSchema } from "@/lib/ai/azure-settings";
import { providerInputSchema, validOpenAiKey } from "@/lib/ai/provider-settings";

export const dynamic = "force-dynamic";

// Workflow's superadmin only, and a fresh sign-in for every change (lib/secrets/central-access.ts, 2026-10-25).
async function superadmin() {
  const ctx = await context();
  requireCentralKeyViewer(ctx);
  return ctx;
}

/**
 * Workflow AI:s leverantör i appen (2026-10-03): the superadmin pastes the OpenAI key (sealed, shown again only as
 * its last four characters), switches AI on and confirms the agreement and the test suite. Saved here wins over .env.
 */
export async function GET() {
  try {
    await superadmin();
    return NextResponse.json({ ...(await providerSettingsView()), models: await openAiModelCards() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), settings: providerInputSchema }),
  z.object({ action: z.literal("check"), apiKey: z.string().trim().max(400).optional() }),
  z.object({ action: z.literal("clear_key") }),
  // OpenAI's price fields (2026-10-24, svar 3): one card per model, with source and date.
  z.object({ action: z.literal("save_models"), models: z.array(azureModelSchema.strict()).max(10) }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const command = commandSchema.parse(await body(request));
    const actor = command.action === "check" ? null : await requireCentralKeyChange(ctx);
    const audit = (detail: string) => prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "ai_provider_settings", detail } });
    if (command.action === "check") {
      // A key typed in the field is checked as it is; otherwise the key that applies now.
      const current = await openAiSettings();
      const apiKey = command.apiKey || current.apiKey;
      if (!apiKey) throw new ApiError(400, "Klistra in en nyckel först.");
      if (!validOpenAiKey(apiKey)) throw new ApiError(400, "Nyckeln ser inte ut som en OpenAI-nyckel (den börjar med sk-).");
      return NextResponse.json(await checkOpenAiKey(apiKey), { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "save_models") {
      const models = await saveOpenAiModelCards(command.models);
      await audit(`OpenAI-modellernas priser: ${models.map((model) => `${model.deployment} ${azureModelPriced(model) ? `in ${model.inputUsdPerMillion}, cache ${model.cachedInputUsdPerMillion ?? "som in"}, ut ${model.outputUsdPerMillion} USD/M (${model.priceSetOn || "odaterat"})` : "pris saknas"}`).join("; ")}.`);
      return NextResponse.json({ ...(await providerSettingsView()), models });
    }
    if (command.action === "clear_key") {
      await clearProviderKey(actor!);
      await audit("Tog bort OpenAI-nyckeln som sparats i appen.");
      return NextResponse.json(await providerSettingsView());
    }
    let saved: { keyChanged: boolean };
    try { saved = await saveProviderSettings(command.settings, actor!); }
    catch (error) { if (error instanceof Error && /OpenAI-nyckel/.test(error.message)) throw new ApiError(400, error.message); throw error; }
    const s = command.settings;
    await audit(`AI-leverantören: ${s.enabled ? "påslagen" : "avslagen"}, DPA ${s.dpaApproved ? "bekräftat" : "ej bekräftat"}, provsvit ${s.evalApproved ? "godkänd" : "ej godkänd"}, global behandling${saved.keyChanged ? ", ny nyckel" : ""}.`);
    return NextResponse.json(await providerSettingsView());
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}
