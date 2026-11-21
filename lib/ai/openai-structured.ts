import "server-only";
import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { Response, ResponseCreateParamsNonStreaming, ResponseInput } from "openai/resources/responses/responses";
import { createOpenAiClient } from "@/lib/ai/openai-provider";
import { toolChoiceFor, type ProviderUsage, type StructuredProviderAdapter, type StructuredProviderRequest } from "@/lib/ai/structured-provider";

/** The answer's text in a response: every output_text part of its messages (a streamed response has no output_text helper). */
export function responseText(response: Pick<Response, "output"> & { output_text?: string }) {
  if (typeof response.output_text === "string" && response.output_text) return response.output_text;
  return response.output.flatMap((item) => item.type === "message" ? item.content.flatMap((part) => part.type === "output_text" ? [part.text] : []) : []).join("");
}

/**
 * One call to the Responses API (2026-10-24, svar 6): streamed when the request has `onText` – each piece of text is handed on
 * as it arrives, and the finished response (output, usage) is what `response.completed` carries – otherwise one plain call. Either
 * way the caller gets the same finished response, so the token count, the settlement and the tool loop are the same. A failed or
 * cut-off stream throws, and the caller compensates the run as for any provider error.
 */
async function respond(client: OpenAI, params: ResponseCreateParamsNonStreaming, request: Pick<StructuredProviderRequest<unknown>, "onText" | "signal">): Promise<Response> {
  const options = request.signal ? { signal: request.signal } : undefined;
  if (!request.onText) return client.responses.create(params, options);
  const stream = await client.responses.create({ ...params, stream: true }, options);
  let finished: Response | null = null;
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") request.onText(event.delta);
    else if (event.type === "response.completed" || event.type === "response.incomplete") finished = event.response;
    else if (event.type === "response.failed") throw Object.assign(new Error("Leverantören avbröt svaret."), { code: event.response.error?.code ?? "response_failed" });
    else if (event.type === "error") throw Object.assign(new Error("Leverantören avbröt svaret."), { code: event.code ?? "stream_error" });
  }
  if (request.signal?.aborted) throw Object.assign(new Error("Svaret avbröts."), { name: "AbortError" });
  if (!finished) throw new Error("Leverantörens ström tog slut utan ett färdigt svar.");
  return finished;
}

/**
 * The Responses API behind the neutral adapter: a strict schema, nothing stored at the provider. The same adapter serves OpenAI and
 * Azure OpenAI (which speaks the same protocol on its own address): `getClient` says where, `modelFor` maps a route's model to the
 * provider's name for it (on Azure the owner's deployment name), and `plain` leaves out the request fields only OpenAI knows.
 */
export function makeResponsesProvider(config: { id: string; getClient: () => Promise<OpenAI>; modelFor: (model: string) => Promise<string> | string; plain?: boolean }): StructuredProviderAdapter {
  const { getClient, modelFor, plain } = config;
  const extras = (request: { safetyIdentifier?: string; cacheKey?: string }) => plain ? {} : {
    service_tier: "default" as const,
    ...(request.safetyIdentifier ? { safety_identifier: request.safetyIdentifier } : {}),
    ...(request.cacheKey ? { prompt_cache_key: request.cacheKey } : {}),
  };
  const usageOf = (response: Pick<Response, "usage">): ProviderUsage => {
    if (!response.usage) throw new Error("OpenAI returnerade ingen tokenredovisning.");
    return { inputTokens: response.usage.input_tokens, cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? 0, outputTokens: response.usage.output_tokens };
  };
  return {
  id: config.id,
  async generateStructured(request) {
    const client = await getClient();
    const params = {
      model: await modelFor(request.model),
      ...extras(request),
      reasoning: { effort: request.reasoningEffort },
      instructions: request.instructions,
      input: request.input,
      max_output_tokens: request.maxOutputTokens,
      store: false as const,
      text: { format: zodTextFormat(request.schema, request.schemaName) },
    };
    if (request.onText) {
      const response = await respond(client, params, request);
      let parsed: unknown;
      try { parsed = JSON.parse(responseText(response)); } catch { throw new Error("OpenAI returnerade inget verifierbart svar."); }
      return { providerResponseId: response.id, output: request.schema.parse(parsed), usage: usageOf(response) };
    }
    const response = await client.responses.parse(params, request.signal ? { signal: request.signal } : undefined);
    if (!response.output_parsed || !response.usage)
      throw new Error("OpenAI returnerade inget verifierbart svar eller tokenredovisning.");
    return {
      providerResponseId: response.id,
      // Checked against the schema here as well, so every adapter gives the same guarantee.
      output: request.schema.parse(response.output_parsed),
      usage: usageOf(response),
    };
  },

  /**
   * The model may ask for tools before it answers (fas 1). Nothing is stored at the provider, so every turn sends the
   * question, the earlier calls and their results again; the unchanged start is read from the provider's prompt cache.
   * One call per turn, at most `maxToolCalls` of them, and the last turn may not call a tool at all. The server runs every
   * call (`callTool`) – also when the answer streams.
   */
  async generateWithTools(request) {
    const client = await getClient();
    const tools = request.tools.map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description, parameters: tool.parameters, strict: true }));
    const input: ResponseInput = [{ role: "user", content: request.input }];
    const usage: ProviderUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    let called = 0;
    const started = Date.now();
    for (let turn = 1; turn <= request.maxToolCalls + 1; turn += 1) {
      const toolChoice = toolChoiceFor(called, request.maxToolCalls, Date.now() - started);
      let streamed = false;
      const onText = request.onText;
      const response = await respond(client, {
        model: await modelFor(request.model),
        ...extras(request),
        reasoning: { effort: request.reasoningEffort },
        instructions: request.instructions,
        input,
        max_output_tokens: request.maxOutputTokens,
        tools,
        tool_choice: toolChoice,
        parallel_tool_calls: false,
        // Without stored state the model's reasoning between turns travels with the request, encrypted.
        include: ["reasoning.encrypted_content"],
        store: false,
        text: { format: zodTextFormat(request.schema, request.schemaName) },
      }, { signal: request.signal, onText: onText ? (delta) => { streamed = true; onText(delta); } : undefined });
      const turnUsage = usageOf(response);
      usage.inputTokens += turnUsage.inputTokens;
      usage.cachedInputTokens += turnUsage.cachedInputTokens;
      usage.outputTokens += turnUsage.outputTokens;
      const calls = response.output.filter((item) => item.type === "function_call");
      if (!calls.length) {
        let parsed: unknown;
        try { parsed = JSON.parse(responseText(response)); } catch { throw new Error("OpenAI returnerade inget verifierbart svar."); }
        return { providerResponseId: response.id, output: request.schema.parse(parsed), usage, turns: turn };
      }
      // Text streamed in a turn that then called a tool is not the answer: the chat clears it.
      if (streamed) request.onTextReset?.();
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
}

/** Workflow's OpenAI provider behind the neutral adapter. */
export const openAiStructuredProvider: StructuredProviderAdapter = makeResponsesProvider({ id: "OPENAI_RESPONSES", getClient: createOpenAiClient, modelFor: (model) => model });
