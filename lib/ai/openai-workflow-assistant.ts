import "server-only";
import { openAiStructuredProvider } from "@/lib/ai/openai-structured";
import {
  assistantStructuredResultSchema,
  type AssistantProviderAdapter,
} from "@/lib/ai/workflow-assistant";

export const openAiWorkflowAssistantProvider: AssistantProviderAdapter = {
  id: openAiStructuredProvider.id,
  async generate(request) {
    const { tools, ...plain } = request;
    const structured = { ...plain, schema: assistantStructuredResultSchema, schemaName: "hintek_workflow_assistant" };
    const response = tools
      ? await openAiStructuredProvider.generateWithTools({ ...structured, tools: tools.definitions, maxToolCalls: tools.maxToolCalls, callTool: tools.callTool })
      : await openAiStructuredProvider.generateStructured(structured);
    return {
      providerResponseId: response.providerResponseId,
      answer: response.output.answer,
      citationKeys: response.output.citations,
      usage: response.usage,
    };
  },
};
