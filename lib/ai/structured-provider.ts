import type { z } from "zod";
import type { AiReasoningEffort } from "@/lib/ai/model-catalog";

/**
 * The one way from Workflow's agents to an AI provider (plan 2026-10-01, fas 0): a request with fixed instructions,
 * untrusted input as data and a schema the answer must follow. Provider-neutral, so another provider is one more
 * adapter and nothing else changes.
 */
export type StructuredProviderRequest<T> = {
  model: string;
  reasoningEffort: AiReasoningEffort;
  maxOutputTokens: number;
  /** A hash of the organisation and the person, never an id. */
  safetyIdentifier?: string;
  instructions: string;
  input: string;
  /** Groups requests that share a prefix, so the provider can reuse its prompt cache. A hash, never an id. */
  cacheKey?: string;
  schema: z.ZodType<T>;
  /** The schema's name at the provider: lower case, digits and underscores. */
  schemaName: string;
  /**
   * Strömning (2026-10-24): with this the provider streams (Responses API, stream: true) and every piece of the answer's text
   * is handed on as it arrives. The result, the usage and the schema check are exactly as without it.
   */
  onText?: (delta: string) => void;
  /** A turn that streamed text but ended with tool calls: what was handed on is not the answer. */
  onTextReset?: () => void;
  /** Stops the call (the person closed the chat or pressed Stoppa); the adapter then throws and the caller settles nothing. */
  signal?: AbortSignal;
};

export type ProviderUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number };

export type StructuredProviderResult<T> = { providerResponseId: string; output: T; usage: ProviderUsage };

/** A function the model may ask the server to run: a name, what it does and a strict JSON Schema for its input. */
export type ProviderTool = { name: string; description: string; parameters: Record<string, unknown> };

/**
 * An answer the model may prepare with tool calls (plan 2026-10-01, fas 1). The adapter only carries the calls: the
 * server decides in `callTool` whether a call is allowed and what it returns, and the adapter never runs more than
 * `maxToolCalls` of them. `maxOutputTokens` is per turn; an answer takes at most `maxToolCalls + 1` turns.
 */
export type ToolLoopRequest<T> = StructuredProviderRequest<T> & {
  tools: ProviderTool[];
  maxToolCalls: number;
  /** Runs one call and returns its result as text (data for the model). Refusals are returned as text, not thrown. */
  callTool(name: string, argumentsJson: string): Promise<string>;
};

/**
 * How long a tool loop may keep fetching before the model must answer with what it has (2026-10-05: an answer
 * with three calls could take most of a minute). The last turn is always an answer.
 */
export const TOOL_LOOP_BUDGET_MS = 20_000;

/** Whether the next turn may call a tool: within the call limit and the time budget. */
export function toolChoiceFor(called: number, maxToolCalls: number, elapsedMs: number): "auto" | "none" {
  return called < maxToolCalls && elapsedMs < TOOL_LOOP_BUDGET_MS ? "auto" : "none";
}

export type ToolLoopResult<T> = StructuredProviderResult<T> & { turns: number };

export type StructuredProviderAdapter = {
  id: string;
  generateStructured<T>(request: StructuredProviderRequest<T>): Promise<StructuredProviderResult<T>>;
  /** The usage is the sum of every turn. */
  generateWithTools<T>(request: ToolLoopRequest<T>): Promise<ToolLoopResult<T>>;
};
