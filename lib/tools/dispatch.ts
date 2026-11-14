import { prisma } from "@/lib/db";
import { authenticateIntegrationKey, integrationKeyRefusal, keyRefusalMessage } from "@/lib/integrations/authenticate";
import { authenticateOAuthAccessToken } from "@/lib/oauth/server";
import { isOAuthAccessToken } from "@/lib/oauth/rules";
import { refreshRegistrationGate } from "@/lib/auth/registration";
import { runAsPrincipal, type IntegrationPrincipal } from "@/lib/integrations/principal";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { ToolError } from "@/lib/tools/call-route";
import { KEY_SCOPES } from "@/lib/integrations/key-catalog";
import { isToolName, keyMayRun, toolFieldNames, toolScope, TOOL_CATALOG, TOOL_NAMES } from "@/lib/tools/catalog";
import { unknownFields, unknownFieldWarnings } from "@/lib/tools/field-help";
import { runTool } from "@/lib/tools/registry";
import { aiMay, getAiSharingPolicy } from "@/lib/ai/sharing-policy";

/**
 * Calls per key (or connected app) and minute; enough for an AI client working in several steps, not for bulk scraping.
 * Counted in PostgreSQL (`RATE_RULES.integrationCall`, 2026-10-08), so the limit holds across app processes and
 * restarts; while the database cannot count, the in-process reserve in lib/security/rate-limit.ts keeps the same limit
 * per process instead of letting every call through.
 */
export const CALLS_PER_MINUTE = RATE_RULES.integrationCall.limit;

async function rateLimit(keyId: string) {
  const hit = await hitRateLimit(RATE_RULES.integrationCall, keyId);
  if (!hit.allowed) throw new ToolError(429, `För många anrop – högst ${CALLS_PER_MINUTE} per minut och nyckel. Försök igen om ${hit.retryAfterSeconds} s.`, hit.retryAfterSeconds);
}

/** The bearer token of a request, if any (never logged). */
export function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

export async function principalFor(request: Request, kind: "API" | "MCP") {
  await refreshRegistrationGate();
  const token = bearerToken(request);
  // The MCP server also takes an OAuth access token from an approved app (2026-10-02); the API does not.
  const principal = !token ? null : kind === "MCP" && isOAuthAccessToken(token) ? await authenticateOAuthAccessToken(token) : await authenticateIntegrationKey(token, kind);
  if (!principal) {
    if (!token) throw new ToolError(401, kind === "MCP" ? "Anslutningen kräver inloggning i Workflow via OAuth: starta anslutningen i appen och godkänn den i Workflow. (Klienter utan OAuth kan i stället använda en MCP-nyckel.)" : "Ange en API-nyckel (Authorization: Bearer hwf_api_…).");
    // An OAuth access token that no longer works is told apart from a key: the app is to be connected again.
    if (kind === "MCP" && isOAuthAccessToken(token)) throw new ToolError(401, "Anslutningen har gått ut eller är bortkopplad. Anslut appen igen i Workflow.");
    throw new ToolError(401, keyRefusalMessage(await integrationKeyRefusal(token, kind), kind));
  }
  return principal;
}

/** The tools a key may run, with their input schemas. */
export function toolsFor(principal: IntegrationPrincipal) {
  return TOOL_NAMES.filter((name) => keyMayRun(principal.kind, principal.scopes, name));
}

/**
 * The tools a key may run that the company also allows (2026-10-09, AI-beslut 3): Lagöversikt is listed only
 * while the company admin's switch is on; a call is refused by the tool itself when it is off.
 */
export async function toolsAvailableTo(principal: IntegrationPrincipal) {
  const names = toolsFor(principal);
  if (!names.includes("list_team_work") || aiMay(await getAiSharingPolicy(principal.organizationId), "teamOverview")) return names;
  return names.filter((name) => name !== "list_team_work");
}

/**
 * One tool call for a verified key: the key's scope for the tool, a rate limit, then the tool inside the key's
 * principal (so the route sees the acting member). Changes are logged in the company's administration history with
 * the key and the tool name – never the content.
 */
export async function dispatchTool(principal: IntegrationPrincipal, name: string, input: unknown) {
  if (!isToolName(name)) throw new ToolError(404, `Verktyget ${name} finns inte.`);
  if (!keyMayRun(principal.kind, principal.scopes, name)) { const needed = toolScope(principal.kind, name); throw new ToolError(403, `Nyckeln saknar behörigheten ”${[...KEY_SCOPES.API, ...KEY_SCOPES.MCP].find((item) => item.key === needed)?.label ?? needed}” (${needed}).`); }
  await rateLimit(principal.keyId);
  const result = await runAsPrincipal(principal, () => runTool(name, input));
  const effect = TOOL_CATALOG[name].effect;
  if (effect !== "read")
    await prisma.administrationEvent.create({ data: {
      actorId: principal.actingUserId, organizationId: principal.organizationId, action: "integration_call",
      detail: `${principal.via === "oauth" ? "Den anslutna appen" : principal.kind === "MCP" ? "MCP-nyckeln" : "API-nyckeln"} ”${principal.keyName}” körde ${TOOL_CATALOG[name].title.toLowerCase()} (${name}).`,
    } });
  // An unknown field is ignored as before; the answer only gets a warning (2026-10-18, API-12).
  const warnings = unknownFieldWarnings(unknownFields(toolFieldNames(name), input));
  if (!warnings.length) return result;
  return result && typeof result === "object" && !Array.isArray(result) ? { ...result, warnings } : { value: result, warnings };
}
