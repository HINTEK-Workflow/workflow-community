import "server-only";
import { openAiStructuredProvider } from "@/lib/ai/openai-structured";
import type { StructuredProviderAdapter } from "@/lib/ai/structured-provider";
import { answerFieldStreamer } from "@/lib/ai/stream-text";
import {
  assistantStructuredResultSchema,
  type AssistantProviderAdapter,
} from "@/lib/ai/workflow-assistant";

/** The assistant on top of any structured provider (Microsoft Azure for Workflow AI, or OpenAI where Community chose it). */
export const makeWorkflowAssistantProvider = (provider: StructuredProviderAdapter): AssistantProviderAdapter => ({
  id: provider.id,
  async generate(request) {
    const { tools, onAnswerText, onAnswerReset, ...plain } = request;
    // Strömning (2026-10-24): the provider streams the JSON answer; only its "answer" text goes on to the chat.
    const field = onAnswerText ? answerFieldStreamer(onAnswerText) : null;
    const structured = {
      ...plain, schema: assistantStructuredResultSchema, schemaName: "hintek_workflow_assistant",
      ...(field ? { onText: (delta: string) => field.push(delta), onTextReset: () => { field.reset(); onAnswerReset?.(); } } : {}),
    };
    const response = tools
      ? await provider.generateWithTools({ ...structured, tools: tools.definitions, maxToolCalls: tools.maxToolCalls, callTool: tools.callTool })
      : await provider.generateStructured(structured);
    return {
      providerResponseId: response.providerResponseId,
      answer: response.output.answer,
      citationKeys: response.output.citations,
      usage: response.usage,
    };
  },
});

export const openAiWorkflowAssistantProvider: AssistantProviderAdapter = makeWorkflowAssistantProvider(openAiStructuredProvider);
