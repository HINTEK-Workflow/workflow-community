import { NextResponse } from "next/server";
import { ToolError } from "@/lib/tools/call-route";
import { isToolName, MCP_SCOPE_OF, TOOL_CATALOG, toolDescription, toolInputSchema, type ToolName } from "@/lib/tools/catalog";
import { describePrompt, getPrompt, knowledgeResource, promptsFor, readKnowledgeResource } from "@/lib/mcp/prompts";
import { dispatchTool, principalFor, toolsAvailableTo } from "@/lib/tools/dispatch";
import type { IntegrationPrincipal } from "@/lib/integrations/principal";
import { publicInstance } from "@/lib/instance";
import { resourceMetadataUrl } from "@/lib/oauth/server";
import { readLimitedText } from "@/lib/security/limited-body";
import { batchProblem } from "@/lib/mcp/batch";

export const dynamic = "force-dynamic";

/**
 * Workflow's MCP server (2026-09-30): the Model Context Protocol over Streamable HTTP, stateless, with
 * JSON responses. External AI clients connect with an MCP key; every tool runs Workflow's own routes as the member the
 * key acts for, so they can never do more than that person can in Workflow. Reading, creating/changing and removing are
 * separate tools and scopes; permanent deletion is not offered. External MCP use never spends Workflow AI credits.
 */
// MCP clients in a browser call with a bearer token, never cookies; the 401's header must be readable to them.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Retry-After",
};
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
// Fas 1: the product name comes from the instance settings; the technical server name stays stable for clients.
const serverInfo = () => ({ name: "hintek-workflow", title: publicInstance().name, version: "1.0.0" });
const instructions = () => [
  `${publicInstance().name}: projekt, uppgifter, arbetsordrar, protokoll, kontroller, planering, tid och kunder för ett företag.`,
  "Börja med search (eller list_*) för att hitta rätt objekt och hämta sedan detaljer med get_task, get_project eller get_customer.",
  "Allt sker med behörigheten hos den användare som nyckeln gäller för. Skapa och ändra bara det användaren har bett om.",
  "Slutförande, signering och permanent radering görs av en person i Workflow och finns inte som verktyg.",
  // Workflow AI-kunskap (2026-11-21): the help, the ways of working and the knowledge package, so the client's AI uses Workflow as it is meant.
  "Frågor om hur något görs i Workflow besvaras med search_help. Färdiga arbetsgångar finns som prompts, och resursen workflow://kunskap/kunskapspaket beskriver hur Workflow fungerar.",
  "Gör inga säkerhetsbedömningar och hitta aldrig på gränsvärden, belopp eller kunder.",
  "Det du hämtar lämnar Workflow och behandlas hos den AI-tjänst användaren har anslutit, under företagets eget avtal med den.",
].join(" ");

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const result = (id: Message["id"], value: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const failure = (id: Message["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function describe(name: ToolName) {
  const tool = TOOL_CATALOG[name];
  return {
    name, title: tool.title, description: toolDescription(name), inputSchema: toolInputSchema(name),
    annotations: {
      title: tool.title,
      readOnlyHint: tool.effect === "read",
      destructiveHint: tool.effect === "delete" || tool.effect === "update",
      idempotentHint: tool.effect === "read",
      openWorldHint: false,
    },
  };
}

// The longest wait a rate-limited tool call in this HTTP request asked for, sent as Retry-After (2026-10-08).
type Exchange = { retryAfterSeconds?: number };

async function handle(message: Message, principal: IntegrationPrincipal, exchange: Exchange = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return failure(null, -32600, "Ogiltig JSON-RPC-begäran.");
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return failure(message.id, -32600, "Ogiltig JSON-RPC-begäran.");
  const isNotification = message.id === undefined;
  if (isNotification) return null; // notifications/initialized and others need no answer
  switch (message.method) {
    case "initialize": {
      const requested = String(message.params?.protocolVersion ?? "");
      return result(message.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
        serverInfo: serverInfo(),
        instructions: instructions(),
      });
    }
    case "ping":
      return result(message.id, {});
    case "tools/list":
      return result(message.id, { tools: (await toolsAvailableTo(principal)).map(describe) });
    // Arbetsgångar (2026-11-21): a prompt is listed and given only when the tools it needs are the key's or app's to run.
    case "prompts/list":
      return result(message.id, { prompts: promptsFor(await toolsAvailableTo(principal)).map(describePrompt) });
    case "prompts/get": {
      const prompt = getPrompt(String(message.params?.name ?? ""), message.params?.arguments, await toolsAvailableTo(principal));
      if (!prompt) return failure(message.id, -32602, `Okänd arbetsgång: ${String(message.params?.name ?? "")}`);
      if ("error" in prompt) return failure(message.id, -32602, prompt.error ?? "Ogiltiga argument.");
      return result(message.id, prompt);
    }
    // Kunskapspaketet (2026-11-21): Workflow's own text about how it works, for whoever may read (mcp:read); no company data.
    case "resources/list":
      return result(message.id, { resources: principal.scopes.includes(MCP_SCOPE_OF.read) ? [knowledgeResource()] : [] });
    case "resources/templates/list":
      return result(message.id, { resourceTemplates: [] });
    case "resources/read": {
      const read = principal.scopes.includes(MCP_SCOPE_OF.read) ? readKnowledgeResource(String(message.params?.uri ?? "")) : null;
      return read ? result(message.id, read) : failure(message.id, -32002, `Resursen finns inte: ${String(message.params?.uri ?? "")}`);
    }
    case "tools/call": {
      const name = String(message.params?.name ?? "");
      if (!isToolName(name)) return failure(message.id, -32602, `Okänt verktyg: ${name}`);
      try {
        const value = await dispatchTool(principal, name, message.params?.arguments ?? {});
        const structured = value && typeof value === "object" && !Array.isArray(value) ? value : { value };
        return result(message.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: structured, isError: false });
      } catch (error) {
        // Tool failures (no permission, not found, invalid input) are answered as a tool result the client can read.
        if (error instanceof ToolError && error.status === 429 && error.retryAfterSeconds) {
          exchange.retryAfterSeconds = Math.max(exchange.retryAfterSeconds ?? 0, error.retryAfterSeconds);
          return result(message.id, { content: [{ type: "text", text: error.message }], structuredContent: { error: "rate_limited", retryAfterSeconds: error.retryAfterSeconds }, isError: true });
        }
        if (error instanceof ToolError) return result(message.id, { content: [{ type: "text", text: error.message }], isError: true });
        console.error("MCP tool failed", error instanceof Error ? error.name : "Unknown");
        return result(message.id, { content: [{ type: "text", text: "Verktyget kunde inte slutföras. Försök igen." }], isError: true });
      }
    }
    default:
      return failure(message.id, -32601, `Metoden ${message.method} stöds inte.`);
  }
}

export async function POST(request: Request) {
  let principal: IntegrationPrincipal;
  try {
    principal = await principalFor(request, "MCP");
  } catch (error) {
    // Valid, but the company has not allowed its own AI apps (2026-11-21): no login prompt, the admin's switch decides.
    if (error instanceof ToolError && error.status === 403) return NextResponse.json(failure(null, -32003, error.message), { status: 403, headers: CORS });
    const message = error instanceof ToolError ? error.message : "Ogiltig nyckel.";
    // The header tells an MCP client where to find the OAuth server (RFC 9728), so it can ask the person to log in.
    return NextResponse.json(failure(null, -32001, message), { status: 401, headers: { ...CORS, "WWW-Authenticate": `Bearer realm="${publicInstance().name.replace(/["\\]/g, "")} MCP", resource_metadata="${resourceMetadataUrl()}"` } });
  }
  const text = await readLimitedText(request, 1_000_000).catch(() => null);
  if (text === null) return NextResponse.json(failure(null, -32600, "För stor begäran."), { status: 413, headers: CORS });
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return NextResponse.json(failure(null, -32700, "Ogiltig JSON."), { status: 400, headers: CORS }); }
  // Batches (allowed by earlier protocol versions) are answered in order, one message at a time and at most MCP_MAX_BATCH
  // in one request (granskningen 2026-11-24, lib/mcp/batch.ts); a batch of only notifications gets 202.
  const exchange: Exchange = {};
  // A rate-limited tool call is still a JSON-RPC result the client reads; the header tells HTTP-aware clients when to retry.
  const retryHeader = (): Record<string, string> => (exchange.retryAfterSeconds ? { "Retry-After": String(exchange.retryAfterSeconds) } : {});
  if (Array.isArray(payload)) {
    const problem = batchProblem(payload);
    if (problem) return NextResponse.json(failure(null, -32600, problem.message), { status: problem.status, headers: CORS });
    const answers: unknown[] = [];
    for (const item of payload) {
      const answer = await handle(item as Message, principal, exchange);
      if (answer) answers.push(answer);
    }
    return answers.length ? NextResponse.json(answers, { headers: { ...CORS, ...retryHeader() } }) : new NextResponse(null, { status: 202, headers: CORS });
  }
  if (!payload || typeof payload !== "object") return NextResponse.json(failure(null, -32600, "Ogiltig JSON-RPC-begäran."), { status: 400, headers: CORS });
  const answer = await handle(payload as Message, principal, exchange);
  return answer ? NextResponse.json(answer, { headers: { ...CORS, "Cache-Control": "no-store", ...retryHeader() } }) : new NextResponse(null, { status: 202, headers: CORS });
}

/** No server-initiated stream: the server answers each request directly (stateless Streamable HTTP). */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
