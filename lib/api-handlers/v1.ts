import { NextResponse } from "next/server";
import { publicInstance } from "@/lib/instance";
import { ToolError } from "@/lib/tools/call-route";
import { TOOL_CATALOG, toolDescription, toolInputSchema } from "@/lib/tools/catalog";
import { principalFor, toolsAvailableTo } from "@/lib/tools/dispatch";

export const dynamic = "force-dynamic";

/**
 * Workflow API v1 (2026-09-30): the same tools as MCP and Workflow's own AI, over plain HTTP with an API
 * key. GET lists what the key may run; POST /api/v1/tools/{name} runs a tool with a JSON body.
 */
export async function GET(request: Request) {
  try {
    const principal = await principalFor(request, "API");
    return NextResponse.json({
      name: `${publicInstance().name} API`, version: "1",
      usage: "POST /api/v1/tools/{name} med Authorization: Bearer <API-nyckel> och indata som JSON. Okända fält ignoreras och ger en varning (warnings).",
      tools: (await toolsAvailableTo(principal)).map((name) => ({ name, title: TOOL_CATALOG[name].title, description: toolDescription(name), effect: TOOL_CATALOG[name].effect, input: toolInputSchema(name) })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ToolError ? error.status : 500;
    return NextResponse.json({ error: error instanceof ToolError ? error.message : "Åtgärden kunde inte slutföras." }, { status, headers: status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined });
  }
}
