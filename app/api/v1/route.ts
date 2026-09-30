import { NextResponse } from "next/server";
import { ToolError } from "@/lib/tools/call-route";
import { TOOL_CATALOG, toolInputSchema } from "@/lib/tools/catalog";
import { principalFor, toolsFor } from "@/lib/tools/dispatch";

export const dynamic = "force-dynamic";

/**
 * HINTEK Workflow API v1 (Daniel 2026-09-30): the same tools as MCP and Workflow's own AI, over plain HTTP with an API
 * key. GET lists what the key may run; POST /api/v1/tools/{name} runs a tool with a JSON body.
 */
export async function GET(request: Request) {
  try {
    const principal = await principalFor(request, "API");
    return NextResponse.json({
      name: "HINTEK Workflow API", version: "1",
      usage: "POST /api/v1/tools/{name} med Authorization: Bearer <API-nyckel> och indata som JSON.",
      tools: toolsFor(principal).map((name) => ({ name, title: TOOL_CATALOG[name].title, description: TOOL_CATALOG[name].description, effect: TOOL_CATALOG[name].effect, input: toolInputSchema(name) })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ToolError ? error.status : 500;
    return NextResponse.json({ error: error instanceof ToolError ? error.message : "Åtgärden kunde inte slutföras." }, { status, headers: status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined });
  }
}
