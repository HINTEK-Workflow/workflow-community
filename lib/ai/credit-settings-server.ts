import "server-only";
import { prisma } from "@/lib/db";
import type { AiTaskKind } from "@/lib/ai/model-catalog";
import { fxSnapshot, minimumCreditsFor, parseAiCreditSettings } from "@/lib/ai/credit-settings";
import { publicInstance } from "@/lib/instance";

/** Whether AI runs are paid with credits; without HINTEK's credit system they are free with the installation's own key. */
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

/** What a run is priced with right now: its minimum and the exchange rate. */
export async function aiRunPricing(taskKind: AiTaskKind) {
  const settings = await readAiCreditSettings();
  return { minimumCredits: minimumCreditsFor(taskKind, settings), fx: fxSnapshot(settings), free: !aiCreditsCharged() };
}
