import "server-only";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInput } from "openai/resources/responses/responses";
import { createOpenAiClient } from "@/lib/ai/openai-provider";
import type { ProviderUsage, StructuredProviderAdapter } from "@/lib/ai/structured-provider";

/** HINTEK's OpenAI provider behind the neutral adapter: the Responses API, a strict schema, nothing stored there. */
export const openAiStructuredProvider: StructuredProviderAdapter = {
  id: "OPENAI_RESPONSES",
  async generateStructured(request) {
    const client = await createOpenAiClient();
    const response = await client.responses.parse({
      model: request.model,
      service_tier: "default",
      reasoning: { effort: request.reasoningEffort },
      instructions: request.instructions,
      input: request.input,
      max_output_tokens: request.maxOutputTokens,
      ...(request.safetyIdentifier ? { safety_identifier: request.safetyIdentifier } : {}),
      ...(request.cacheKey ? { prompt_cache_key: request.cacheKey } : {}),
      store: false,
      text: { format: zodTextFormat(request.schema, request.schemaName) },
    });
    if (!response.output_parsed || !response.usage)
      throw new Error("OpenAI returnerade inget verifierbart svar eller tokenredovisning.");
    return {
      providerResponseId: response.id,
      // Checked against the schema here as well, so every adapter gives the same guarantee.
      output: request.schema.parse(response.output_parsed),
      usage: {
        inputTokens: response.usage.input_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: response.usage.output_tokens,
      },
    };
  },

  /**
   * The model may ask for tools before it answers (fas 1). Nothing is stored at the provider, so every turn sends the
   * question, the earlier calls and their results again; the unchanged start is read from the provider's prompt cache.
   * One call per turn, at most `maxToolCalls` of them, and the last turn may not call a tool at all.
   */
  async generateWithTools(request) {
    const client = await createOpenAiClient();
    const tools = request.tools.map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description, parameters: tool.parameters, strict: true }));
    const input: ResponseInput = [{ role: "user", content: request.input }];
    const usage: ProviderUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    let called = 0;
    for (let turn = 1; turn <= request.maxToolCalls + 1; turn += 1) {
      const response = await client.responses.create({
        model: request.model,
        service_tier: "default",
        reasoning: { effort: request.reasoningEffort },
        instructions: request.instructions,
        input,
        max_output_tokens: request.maxOutputTokens,
        tools,
        tool_choice: called < request.maxToolCalls ? "auto" : "none",
        parallel_tool_calls: false,
        // Without stored state the model's reasoning between turns travels with the request, encrypted.
        include: ["reasoning.encrypted_content"],
        ...(request.safetyIdentifier ? { safety_identifier: request.safetyIdentifier } : {}),
        ...(request.cacheKey ? { prompt_cache_key: request.cacheKey } : {}),
        store: false,
        text: { format: zodTextFormat(request.schema, request.schemaName) },
      });
      if (!response.usage) throw new Error("OpenAI returnerade ingen tokenredovisning.");
      usage.inputTokens += response.usage.input_tokens;
      usage.cachedInputTokens += response.usage.input_tokens_details?.cached_tokens ?? 0;
      usage.outputTokens += response.usage.output_tokens;
      const calls = response.output.filter((item) => item.type === "function_call");
      if (!calls.length) {
        let parsed: unknown;
        try { parsed = JSON.parse(response.output_text); } catch { throw new Error("OpenAI returnerade inget verifierbart svar."); }
        return { providerResponseId: response.id, output: request.schema.parse(parsed), usage, turns: turn };
      }
      // The model's reasoning and its calls go back as they came; nothing else can appear before a tool call.
      for (const item of response.output) if (item.type === "reasoning" || item.type === "function_call") input.push(item);
      for (const call of calls) {
        called += 1;
        // The server decides what the call may do; past the limit it is answered without being run.
        const output = called <= request.maxToolCalls ? await request.callTool(call.name, call.arguments) : JSON.stringify({ error: "Gränsen för verktygsanrop är nådd." });
        input.push({ type: "function_call_output", call_id: call.call_id, output });
      }
    }
    throw new Error("OpenAI gav inget slutligt svar inom tillåtet antal steg.");
  },
};
