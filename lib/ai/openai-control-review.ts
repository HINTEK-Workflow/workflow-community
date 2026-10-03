import "server-only";
import { configuredStructuredProvider } from "@/lib/ai/assistant-provider";
import {
  buildControlReviewRequest,
  controlReviewResultSchema,
  parseControlReviewResult,
} from "@/lib/ai/control-review";
import type { PreparedAgentRun } from "@/lib/ai/run-policy";

export async function runOpenAiControlReview(run: PreparedAgentRun) {
  const request = buildControlReviewRequest(run);
  const provider = await configuredStructuredProvider();
  const response = await provider.generateStructured({
    model: request.model,
    reasoningEffort: request.reasoning.effort,
    instructions: request.instructions,
    input: request.input,
    maxOutputTokens: request.maxOutputTokens,
    cacheKey: "hwf-control-review",
    schema: controlReviewResultSchema,
    schemaName: "kfid_control_review",
  });
  return {
    providerResponseId: response.providerResponseId,
    result: parseControlReviewResult(response.output),
    usage: response.usage,
  };
}
