import "server-only";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { createOpenAiEvalClient } from "@/lib/ai/openai-provider";

export const OPENAI_PROVIDER_EVAL_MODELS = [
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
] as const;

const providerEvalResultSchema = z.object({
  result: z.literal("PASS"),
  purpose: z.literal("HINTEK_WORKFLOW_PROVIDER_EVAL"),
});

export async function runOpenAiProviderEvalSuite() {
  const client = createOpenAiEvalClient();
  const results = [];
  for (const model of OPENAI_PROVIDER_EVAL_MODELS) {
    const response = await client.responses.parse({
      model,
      service_tier: "default",
      reasoning: { effort: "none" },
      instructions:
        "This is a synthetic provider connectivity evaluation. Return only the required structured result. Do not call tools.",
      input: "Confirm the fixed synthetic HINTEK Workflow provider evaluation.",
      max_output_tokens: 100,
      store: false,
      text: {
        format: zodTextFormat(providerEvalResultSchema, "hintek_provider_eval"),
      },
    });
    if (!response.output_parsed || !response.usage)
      throw new Error(`Provider-eval saknar verifierbart svar eller usage för ${model}.`);
    results.push({
      model,
      result: response.output_parsed.result,
      inputTokens: response.usage.input_tokens,
      cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
      outputTokens: response.usage.output_tokens,
      serviceTier: response.service_tier ?? "default",
    });
  }
  return results;
}
