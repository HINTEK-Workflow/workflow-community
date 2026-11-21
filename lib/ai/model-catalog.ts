export const AI_TASK_KINDS = [
  "SIMPLE_CHAT",
  "WORKFLOW_SEARCH",
  "DOCUMENT_ANALYSIS",
  "WORKFLOW_PROPOSAL",
  "KFID_CONTROL_REVIEW",
  // Texts and proposals written from material the server prepared (fas 2 and 4): a summary, a draft, the daily digest.
  "WRITING",
] as const;

export type AiTaskKind = (typeof AI_TASK_KINDS)[number];

export type AiReasoningEffort = "none" | "low" | "medium" | "high";

/** Who runs the model: OpenAI (Community's choice) or Microsoft Azure (Workflow AI in Cloud; lib/ai/azure-settings.ts). The region is per model card. */
export type AiRunProvider = "OPENAI" | "AZURE_OPENAI";

export type AiModelPolicy = {
  provider: AiRunProvider;
  taskKind: AiTaskKind;
  /** The route's model (gpt-5.6-luna, -terra, -sol); on Azure the name of the model behind the owner's deployment. */
  model: string;
  reasoningEffort: AiReasoningEffort;
  pricingVersion: string;
  inputPriceUsdMicrosPerMillion: number;
  cachedInputPriceUsdMicrosPerMillion: number;
  outputPriceUsdMicrosPerMillion: number;
  targetGrossMarginBps: number;
  creditFloorValueOre: number;
  minimumCredits: number;
  processingRegion: "GLOBAL" | "EU";
  storeProviderState: false;
};

const COMMERCIAL_POLICY = Object.freeze({
  // The starting value only: 100 % markup on the provider's cost (2026-11-21, F2) is a 50 % margin; a run is priced with the
  // product owner's markup (marginBpsOf in lib/ai/credit-settings.ts) and stores it.
  targetGrossMarginBps: 5_000,
  // The starting value only (500 kr / 600 credits in price version 1): a run is priced against the active price
  // version's value (aiCreditValueOre in lib/ai/credit-settings-server.ts) and stores it (prisrättning 1, 2026-10-23).
  creditFloorValueOre: 83,
  minimumCredits: 1,
  processingRegion: "GLOBAL" as const,
  storeProviderState: false as const,
});

// Global standard-processing prices. Region-specific uplifts must use a new,
// explicitly versioned snapshot before a regional endpoint is enabled.
/** OpenAI's global standard prices as they stood in the code (2026-09-23): since 2026-10-24 only the starting values of the price fields (lib/ai/openai-models.ts). */
export const GLOBAL_MODEL_PRICES = Object.freeze({
  "gpt-5.6-luna": {
    input: 200_000,
    cachedInput: 20_000,
    output: 1_200_000,
    version: "openai-gpt-5.6-luna-global-standard-2026-09-23-v1",
  },
  "gpt-5.6-terra": {
    input: 2_000_000,
    cachedInput: 200_000,
    output: 12_000_000,
    version: "openai-gpt-5.6-terra-global-standard-2026-09-23-v1",
  },
  "gpt-5.6-sol": {
    input: 4_000_000,
    cachedInput: 400_000,
    output: 20_000_000,
    version: "openai-gpt-5.6-sol-global-standard-2026-09-23-v1",
  },
});

function policy(
  taskKind: AiTaskKind,
  model: keyof typeof GLOBAL_MODEL_PRICES,
  reasoningEffort: AiReasoningEffort,
): AiModelPolicy {
  const price = GLOBAL_MODEL_PRICES[model];
  return Object.freeze({
    provider: "OPENAI" as const,
    taskKind,
    model,
    reasoningEffort,
    pricingVersion: price.version,
    inputPriceUsdMicrosPerMillion: price.input,
    cachedInputPriceUsdMicrosPerMillion: price.cachedInput,
    outputPriceUsdMicrosPerMillion: price.output,
    ...COMMERCIAL_POLICY,
  });
}

export const AI_MODEL_ROUTES = Object.freeze({
  // Low, not none (2026-10-02: answers to quickly typed field questions were clumsy and missed typos).
  SIMPLE_CHAT: policy("SIMPLE_CHAT", "gpt-5.6-luna", "low"),
  WORKFLOW_SEARCH: policy("WORKFLOW_SEARCH", "gpt-5.6-luna", "low"),
  DOCUMENT_ANALYSIS: policy("DOCUMENT_ANALYSIS", "gpt-5.6-terra", "medium"),
  WORKFLOW_PROPOSAL: policy("WORKFLOW_PROPOSAL", "gpt-5.6-terra", "medium"),
  KFID_CONTROL_REVIEW: policy("KFID_CONTROL_REVIEW", "gpt-5.6-sol", "medium"),
  WRITING: policy("WRITING", "gpt-5.6-luna", "low"),
} satisfies Record<AiTaskKind, AiModelPolicy>);

export function routeAiModel(taskKind: AiTaskKind): AiModelPolicy {
  return AI_MODEL_ROUTES[taskKind];
}

/**
 * The starting exchange rate before the product owner has set one in the app. Pricing reads the setting
 * (ee/ai/credit-settings.ts, Installation → AI-provider → Kostnad per AI-svar); this is only the default.
 */
export const AI_INTERNAL_FX_POLICY = Object.freeze({
  source: "HINTEK_INTERNAL_MONTHLY",
  version: "2026-10-v1",
  usdSekRateMicros: 12_000_000,
  effectiveDate: new Date("2026-10-01T00:00:00.000Z"),
  reviewAfter: new Date("2026-11-01T00:00:00.000Z"),
});
