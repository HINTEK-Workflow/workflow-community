import { blankAzureModel, usedDeployments, type AzureModelInfo, type AzurePreset, type AzureRouteModel } from "@/lib/ai/azure-settings";

// The EU provider's model cards as the form on Tjänster och nycklar holds them (2026-10-24). Pure, without React.

/** A model card as the form holds it: the prices as typed text, so "0," or "0.1" can be typed; turned into numbers on saving. */
export type AzureModelForm = Omit<AzureModelInfo, "inputUsdPerMillion" | "cachedInputUsdPerMillion" | "outputUsdPerMillion"> & { input: string; cached: string; output: string };

const priceText = (value: number | null) => (value === null ? "" : String(value));
export const toModelForm = (model: AzureModelInfo): AzureModelForm => {
  const { inputUsdPerMillion, cachedInputUsdPerMillion, outputUsdPerMillion, ...rest } = model;
  return { ...rest, input: priceText(inputUsdPerMillion), cached: priceText(cachedInputUsdPerMillion), output: priceText(outputUsdPerMillion) };
};

/** A typed price: empty is "no price"; anything else must be a number above zero (comma or point). */
export function parsePrice(text: string): { ok: true; value: number | null } | { ok: false } {
  const clean = text.trim().replace(",", ".");
  if (!clean) return { ok: true, value: null };
  const value = Number(clean);
  return Number.isFinite(value) && value > 0 && value <= 1_000 ? { ok: true, value } : { ok: false };
}

export function fromModelForm(model: AzureModelForm): AzureModelInfo | null {
  const { input, cached, output, ...rest } = model;
  const [a, b, c] = [parsePrice(input), parsePrice(cached), parsePrice(output)];
  if (!a.ok || !b.ok || !c.ok) return null;
  return { ...rest, inputUsdPerMillion: a.value, cachedInputUsdPerMillion: b.value, outputUsdPerMillion: c.value };
}

/** One card per deployment the routes use: the saved card, or a blank one (with the installation's suggestion when it has one). */
export function modelCardsFor(deployments: Record<AzureRouteModel, string>, models: AzureModelForm[], preset: AzurePreset | null): AzureModelForm[] {
  return usedDeployments({ deployments }).filter(Boolean).map((deployment) => models.find((model) => model.deployment === deployment) ?? toModelForm(blankAzureModel(deployment, preset)));
}

