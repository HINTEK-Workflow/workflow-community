import {
  routeAiModel,
  type AiModelPolicy,
  type AiTaskKind,
} from "@/lib/ai/model-catalog";

// Backwards-compatible default for the first existing agent. New assistant
// capabilities must select a trusted task kind explicitly through routeAiModel.
export const AI_CREDIT_POLICY = routeAiModel("KFID_CONTROL_REVIEW");

export type AiPricingSnapshot = {
  inputPriceUsdMicrosPerMillion: number;
  cachedInputPriceUsdMicrosPerMillion: number;
  outputPriceUsdMicrosPerMillion: number;
  targetGrossMarginBps: number;
  creditFloorValueOre: number;
  minimumCredits: number;
  usdSekRateMicros: number;
};

export type AiTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

const MILLION = BigInt(1_000_000);
const USD_SEK_MICRO_SCALE = BigInt(1_000_000_000_000);

function positiveSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} måste vara ett positivt heltal.`);
}

function nonNegativeSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} måste vara ett icke-negativt heltal.`);
}

function ceilDiv(value: bigint, divisor: bigint) {
  return (value + divisor - BigInt(1)) / divisor;
}

function safeNumber(value: bigint, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} är för stort.`);
  return result;
}

export function validateAiPricingSnapshot(snapshot: AiPricingSnapshot) {
  positiveSafeInteger(snapshot.inputPriceUsdMicrosPerMillion, "Inputpriset");
  positiveSafeInteger(snapshot.cachedInputPriceUsdMicrosPerMillion, "Priset för cachelagrad input");
  positiveSafeInteger(snapshot.outputPriceUsdMicrosPerMillion, "Outputpriset");
  positiveSafeInteger(snapshot.creditFloorValueOre, "Kreditens lägsta värde");
  positiveSafeInteger(snapshot.minimumCredits, "Minsta kredituttag");
  positiveSafeInteger(snapshot.usdSekRateMicros, "USD/SEK-kursen");
  if (!Number.isSafeInteger(snapshot.targetGrossMarginBps) ||
      snapshot.targetGrossMarginBps < 0 || snapshot.targetGrossMarginBps >= 10_000)
    throw new Error("Bruttomarginalen måste vara mellan 0 och 99,99 procent.");
  if (snapshot.cachedInputPriceUsdMicrosPerMillion > snapshot.inputPriceUsdMicrosPerMillion)
    throw new Error("Cachepriset får inte vara högre än inputpriset.");
  return snapshot;
}

export function calculateAiUsageCost(
  usage: AiTokenUsage,
  snapshot: AiPricingSnapshot,
) {
  validateAiPricingSnapshot(snapshot);
  nonNegativeSafeInteger(usage.inputTokens, "Antalet inputtokens");
  nonNegativeSafeInteger(usage.cachedInputTokens, "Antalet cachelagrade inputtokens");
  nonNegativeSafeInteger(usage.outputTokens, "Antalet outputtokens");
  if (usage.cachedInputTokens > usage.inputTokens)
    throw new Error("Cachelagrade inputtokens kan inte överstiga samtliga inputtokens.");

  const uncachedInputTokens = usage.inputTokens - usage.cachedInputTokens;
  const uncachedInputCost = ceilDiv(
    BigInt(uncachedInputTokens) * BigInt(snapshot.inputPriceUsdMicrosPerMillion),
    MILLION,
  );
  const cachedInputCost = ceilDiv(
    BigInt(usage.cachedInputTokens) * BigInt(snapshot.cachedInputPriceUsdMicrosPerMillion),
    MILLION,
  );
  const outputCost = ceilDiv(
    BigInt(usage.outputTokens) * BigInt(snapshot.outputPriceUsdMicrosPerMillion),
    MILLION,
  );
  const providerCostUsdMicros = uncachedInputCost + cachedInputCost + outputCost;
  const providerCostOre = ceilDiv(
    providerCostUsdMicros * BigInt(snapshot.usdSekRateMicros) * BigInt(100),
    USD_SEK_MICRO_SCALE,
  );
  const marginDenominator =
    BigInt(snapshot.creditFloorValueOre) * BigInt(10_000 - snapshot.targetGrossMarginBps);
  const calculatedCredits = ceilDiv(providerCostOre * BigInt(10_000), marginDenominator);
  const chargedCredits = calculatedCredits > BigInt(snapshot.minimumCredits)
    ? calculatedCredits
    : BigInt(snapshot.minimumCredits);

  return {
    providerCostUsdMicros: safeNumber(providerCostUsdMicros, "Leverantörskostnaden"),
    providerCostOre: safeNumber(providerCostOre, "Leverantörskostnaden i öre"),
    chargedCredits: safeNumber(chargedCredits, "Kredituttaget"),
  };
}

export function quoteAiRun(input: {
  inputTokenLimit: number;
  maxOutputTokens: number;
  usdSekRateMicros: number;
  taskKind?: AiTaskKind;
  policy?: AiModelPolicy;
  /** The product owner's minimum for this kind of run (lib/ai/credit-settings.ts); the catalog's when left out. */
  minimumCredits?: number;
  /** No credits at all: an installation without HINTEK's credit system (the community edition, 2026-10-03). */
  free?: boolean;
}) {
  positiveSafeInteger(input.inputTokenLimit, "Gränsen för inputtokens");
  positiveSafeInteger(input.maxOutputTokens, "Gränsen för outputtokens");
  const base = input.policy ?? routeAiModel(input.taskKind ?? "KFID_CONTROL_REVIEW");
  if (input.minimumCredits !== undefined) positiveSafeInteger(input.minimumCredits, "Minsta kredituttag");
  const selected = input.minimumCredits !== undefined ? { ...base, minimumCredits: input.minimumCredits } : base;
  const snapshot: AiPricingSnapshot = {
    ...selected,
    usdSekRateMicros: input.usdSekRateMicros,
  };
  const maximum = calculateAiUsageCost({
    inputTokens: input.inputTokenLimit,
    cachedInputTokens: 0,
    outputTokens: input.maxOutputTokens,
  }, snapshot);
  if (maximum.chargedCredits > 1_000)
    throw new Error("AI-körningens beräknade maxkostnad överskrider 1 000 krediter.");
  return {
    policy: selected,
    snapshot,
    ...maximum,
    ...(input.free ? { chargedCredits: 0 } : {}),
    reservedCredits: input.free ? 0 : maximum.chargedCredits,
  };
}
