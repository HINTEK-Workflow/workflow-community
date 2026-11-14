import { z } from "zod";
import { azureModelPriced, azureModelSchema, cardPolicy, type AzureModelInfo } from "@/lib/ai/azure-settings";
import { AI_MODEL_ROUTES, GLOBAL_MODEL_PRICES, type AiModelPolicy } from "@/lib/ai/model-catalog";

// OpenAI's models as price fields (2026-10-24, svar 3: "alla leverantörers priser (även OpenAI) blir fält som ändras utan kod,
// med källa och datum, i samma struktur som Azure-korten; dagens kodpriser blir startvärden"). Pure, without Prisma. Stored in
// SystemSettings.aiProvider.models; one card per model the routes use, keyed by the model's name (the card's `deployment`).

export const OPENAI_ROUTE_MODELS = [...new Set(Object.values(AI_MODEL_ROUTES).map((route) => route.model))];
const STARTING_DATE = "2026-09-23";
const usd = (micros: number) => micros / 1_000_000;

/** The starting cards: the prices the code had, with that as their source. OpenAI is never the EU (2026-11-01). */
export function openAiStartingCards(): AzureModelInfo[] {
  return Object.entries(GLOBAL_MODEL_PRICES).map(([model, price]) => azureModelSchema.parse({
    deployment: model, modelName: model, region: "Global", deploymentType: "Standard",
    inputUsdPerMillion: usd(price.input), cachedInputUsdPerMillion: usd(price.cachedInput), outputUsdPerMillion: usd(price.output),
    priceSource: "Startvärde: OpenAI:s globala standardpris som stod i koden", priceSetOn: STARTING_DATE,
    features: ["tools", "structured", "reasoning", "promptCache"],
  }));
}

export const storedOpenAiModelsSchema = z.array(azureModelSchema).max(10).catch([]);

/**
 * Bara Azure räknas som EU (2026-11-01): an OpenAI card never says EU, whatever an older save holds. The saved
 * euVerified, euSource and region are dropped on every read and every save; the columns themselves stay.
 */
export const openAiCardWithoutEu = (card: AzureModelInfo): AzureModelInfo => ({ ...card, euVerified: false, euSource: "", region: "Global" });

/** The cards that apply: one per route model, the saved card when there is one, otherwise its starting card. Never EU. */
export function openAiCards(saved: AzureModelInfo[] | undefined): AzureModelInfo[] {
  const starting = openAiStartingCards();
  return OPENAI_ROUTE_MODELS.map((model) => openAiCardWithoutEu(saved?.find((card) => card.deployment === model) ?? starting.find((card) => card.deployment === model) ?? azureModelSchema.parse({ deployment: model, modelName: model })));
}

/** What stops OpenAI's models from being used by customers: a card without a price ("Pris saknas"). */
export function openAiCardsProblem(cards: AzureModelInfo[]): string | null {
  for (const model of OPENAI_ROUTE_MODELS) {
    if (!azureModelPriced(cards.find((card) => card.deployment === model))) return `Pris saknas för ${model}.`;
  }
  return null;
}

/**
 * A route's policy on OpenAI from its card. A card with exactly the code's starting prices keeps the code's pricing version, so runs
 * before and after the fields existed read the same; another price is a new version named after the card. No price: no policy.
 */
export function openAiRoutePolicy(route: AiModelPolicy, cards: AzureModelInfo[]): AiModelPolicy {
  const card = cards.find((item) => item.deployment === route.model);
  if (!card || !azureModelPriced(card)) throw new Error(`Pris saknas för ${route.model}.`);
  const policy = cardPolicy(route, card, { provider: "OPENAI", name: route.model, prefix: "openai", region: "GLOBAL" });
  const unchanged = policy.inputPriceUsdMicrosPerMillion === route.inputPriceUsdMicrosPerMillion && policy.cachedInputPriceUsdMicrosPerMillion === route.cachedInputPriceUsdMicrosPerMillion
    && policy.outputPriceUsdMicrosPerMillion === route.outputPriceUsdMicrosPerMillion;
  return unchanged ? Object.freeze({ ...policy, pricingVersion: route.pricingVersion, model: route.model }) : Object.freeze({ ...policy, model: route.model });
}
