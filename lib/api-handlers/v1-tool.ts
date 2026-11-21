import { NextResponse } from "next/server";
import { retryAfterHeaders, ToolError } from "@/lib/tools/call-route";
import { dispatchTool, principalFor } from "@/lib/tools/dispatch";
import { readLimitedText } from "@/lib/security/limited-body";

export const dynamic = "force-dynamic";

/** Runs one tool for an API key (see GET /api/v1 for the list and the input of each tool). */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const principal = await principalFor(request, "API");
    const { name } = await params;
    const text = await readLimitedText(request, 1_000_000).catch(() => { throw new ToolError(413, "För stor begäran."); });
    let input: unknown = {};
    try { input = text ? JSON.parse(text) : {}; } catch { throw new ToolError(400, "Ogiltig JSON."); }
    return NextResponse.json({ result: await dispatchTool(principal, name, input) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ToolError ? error.status : 500;
    if (!(error instanceof ToolError)) console.error("API v1 tool failed", error instanceof Error ? error.name : "Unknown");
    return NextResponse.json({ error: error instanceof ToolError ? error.message : "Åtgärden kunde inte slutföras." }, { status, headers: status === 401 ? { "WWW-Authenticate": "Bearer" } : retryAfterHeaders(error) });
  }
}
