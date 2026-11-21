import "server-only";
import { prisma } from "@/lib/db";
import { routeAiModel, type AiModelPolicy, type AiTaskKind } from "@/lib/ai/model-catalog";
import { azureRoutePolicy } from "@/lib/ai/azure-settings";
import { openAiRoutePolicy } from "@/lib/ai/openai-models";
import { providerChoiceFor, standardProvider } from "@/lib/ai/provider-choice-server";
import { azureSettings } from "@/lib/ai/azure-settings-server";
import { openAiModelCards } from "@/lib/ai/provider-settings-server";
import { creditsChargedIn, fxSnapshot, marginBpsOf, minimumCreditsFor, parseAiCreditSettings, type AiChargeMode } from "@/lib/ai/credit-settings";
import { companyWeeklyQuota } from "@/lib/ai/weekly-quota-server";
import { publicInstance } from "@/lib/instance";
import { serverExtensions } from "@/lib/extensions/server";

/** Whether AI runs are paid with credits; without Workflow's credit system they are free with the installation's own key. */
export const aiCreditsCharged = () => publicInstance().features.credits;

/** The product owner's AI settings (SystemSettings.ai): minimums, exchange rate and provider. */
export async function readAiCreditSettings() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { ai: true } });
  return parseAiCreditSettings(settings?.ai);
}

/** The least credits a run of this kind costs right now. */
export async function aiMinimumCredits(taskKind: AiTaskKind) {
  return minimumCreditsFor(taskKind, await readAiCreditSettings());
}

/**
 * What one credit is worth (öre) when a run is priced (prisrättning 1, 2026-10-23): the active price version's cheapest
 * package per credit, so a new package price reaches the AI price without a code change. Without Workflow's credit
 * system (or a version without packages) the catalog's starting value; a version that cannot be read is logged and
 * the catalog's value used, so the run is never priced against nothing.
 */
export async function aiCreditValueOre() {
  const catalog = routeAiModel("KFID_CONTROL_REVIEW").creditFloorValueOre;
  if (!aiCreditsCharged()) return catalog;
  try {
    return (await serverExtensions.aiCreditValueOre()) ?? catalog;
  } catch (error) {
    console.error("AI credit value: the active price version could not be read", error instanceof Error ? error.message.slice(0, 200) : "unknown");
    return catalog;
  }
}

/**
 * The provider, model and prices a run for this company is made with (2026-10-24, 2026-11-21): the Azure model behind the
 * route's deployment in the company's profile, with the prices the product owner entered (or, in a Community installation that
 * chose OpenAI for Standard, OpenAI's card). The same rule as the adapter's choice (lib/ai/assistant-provider.ts), so the estimate,
 * the reservation and the call agree; when the profile is not ready this throws with the reason, never falling back.
 */
export async function aiRunPolicy(taskKind: AiTaskKind, organizationId?: string): Promise<AiModelPolicy> {
  const route = routeAiModel(taskKind);
  // Without a company (a trial question, the settings page): the Standard provider's card price, or the code's starting value.
  if (!organizationId) {
    try {
      if ((await standardProvider()) === "AZURE_OPENAI") return azureRoutePolicy(route, await azureSettings(), "standard");
      return openAiRoutePolicy(route, await openAiModelCards());
    } catch { return route; }
  }
  const { choice, azure } = await providerChoiceFor(organizationId);
  if (choice.use === "none") throw new Error(choice.reason);
  if (choice.use === "azure" && azure) return azureRoutePolicy(route, azure, choice.profile);
  return openAiRoutePolicy(route, await openAiModelCards());
}

/** Whether a run in this mode costs credits here (2026-11-21): only agentläge, and only with Workflow's credit system. */
export const aiCreditsChargedFor = (mode: AiChargeMode) => creditsChargedIn(mode, aiCreditsCharged());

/**
 * What a run is priced with right now: its policy (provider, model, prices), its minimum, the exchange rate and the credit's value.
 * `mode` (2026-11-21): "included" – everything Workflow AI does today – is free of credits, but the run still records the
 * provider's exact cost; "agent" (the coming agentläge) is charged the cost plus the markup.
 */
export async function aiRunPricing(taskKind: AiTaskKind, organizationId?: string, asked?: AiChargeMode) {
  const [settings, creditValueOre, routed, quota] = await Promise.all([
    readAiCreditSettings(), aiCreditValueOre(), aiRunPolicy(taskKind, organizationId),
    organizationId && !asked ? companyWeeklyQuota(organizationId) : Promise.resolve(null),
  ]);
  // Veckokvot (2026-11-21): past the week's quota a run is made on credits only when the admin chose it; otherwise it pauses.
  if (quota?.decision.mode === "paused") throw new Error(quota.decision.reason);
  const mode: AiChargeMode = asked ?? (quota?.decision.mode === "credits" ? "credits" : "included");
  // Påslaget is the product owner's one setting for every provider (2026-10-24); the run stores it.
  const policy: AiModelPolicy = Object.freeze({ ...routed, targetGrossMarginBps: marginBpsOf(settings) });
  return { minimumCredits: minimumCreditsFor(taskKind, settings), fx: fxSnapshot(settings), free: !aiCreditsChargedFor(mode), creditValueOre, policy, mode };
}
