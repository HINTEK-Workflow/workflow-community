import { prisma } from "@/lib/db";
import { authenticateIntegrationKey } from "@/lib/integrations/authenticate";
import { runAsPrincipal, type IntegrationPrincipal } from "@/lib/integrations/principal";
import { ToolError } from "@/lib/tools/call-route";
import { isToolName, keyMayRun, TOOL_CATALOG, TOOL_NAMES } from "@/lib/tools/catalog";
import { runTool } from "@/lib/tools/registry";

/** Calls per key and minute; enough for an AI client working in several steps, not for bulk scraping. */
export const CALLS_PER_MINUTE = 120;
const windows = new Map<string, { start: number; count: number }>();

function rateLimit(keyId: string, now = Date.now()) {
  const window = windows.get(keyId);
  if (!window || now - window.start >= 60_000) { windows.set(keyId, { start: now, count: 1 }); return; }
  window.count += 1;
  if (window.count > CALLS_PER_MINUTE) throw new ToolError(429, `För många anrop – högst ${CALLS_PER_MINUTE} per minut och nyckel.`);
}

/** The bearer token of a request, if any (never logged). */
export function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

export async function principalFor(request: Request, kind: "API" | "MCP") {
  const token = bearerToken(request);
  const principal = token ? await authenticateIntegrationKey(token, kind) : null;
  if (!principal) throw new ToolError(401, kind === "MCP" ? "Ange en giltig MCP-nyckel (Authorization: Bearer hwf_mcp_…)." : "Ange en giltig API-nyckel (Authorization: Bearer hwf_api_…).");
  return principal;
}

/** The tools a key may run, with their input schemas. */
export function toolsFor(principal: IntegrationPrincipal) {
  return TOOL_NAMES.filter((name) => keyMayRun(principal.kind, principal.scopes, name));
}

/**
 * One tool call for a verified key: the key's scope for the tool, a rate limit, then the tool inside the key's
 * principal (so the route sees the acting member). Changes are logged in the company's administration history with
 * the key and the tool name – never the content.
 */
export async function dispatchTool(principal: IntegrationPrincipal, name: string, input: unknown) {
  if (!isToolName(name)) throw new ToolError(404, `Verktyget ${name} finns inte.`);
  if (!keyMayRun(principal.kind, principal.scopes, name)) throw new ToolError(403, "Nyckeln har inte behörighet för det här verktyget.");
  rateLimit(principal.keyId);
  const result = await runAsPrincipal(principal, () => runTool(name, input));
  const effect = TOOL_CATALOG[name].effect;
  if (effect !== "read")
    await prisma.administrationEvent.create({ data: {
      actorId: principal.actingUserId, organizationId: principal.organizationId, action: "integration_call",
      detail: `${principal.kind === "MCP" ? "MCP-nyckeln" : "API-nyckeln"} ”${principal.keyName}” körde ${TOOL_CATALOG[name].title.toLowerCase()} (${name}).`,
    } });
  return result;
}
