// The open core's own API routes for Workflow AI, the API, MCP with OAuth, import and the key pages (2026-10-03:
// "alla funktioner finns medan kunden får lägga in egna nycklar"). They load on first use, like the routes in ee/, so
// modules that use the core's context() never form an import cycle at start.
import { NextResponse } from "next/server";
import type { RouteContext, RouteHandlers } from "@/lib/extensions/types";

export const coreRoutes = {
  "ai/evals": () => import("@/lib/api-handlers/ai-evals"),
  "ai/chat": () => import("@/lib/api-handlers/ai-chat"),
  "ai/conversations": () => import("@/lib/api-handlers/ai-conversations"),
  "ai/digest": () => import("@/lib/api-handlers/ai-digest"),
  "ai/memory": () => import("@/lib/api-handlers/ai-memory"),
  "ai/policy": () => import("@/lib/api-handlers/ai-policy"),
  "ai/profiles": () => import("@/lib/api-handlers/ai-profiles"),
  "ai/proposals": () => import("@/lib/api-handlers/ai-proposals"),
  "ai/quote": () => import("@/lib/api-handlers/ai-quote"),
  "ai/review": () => import("@/lib/api-handlers/ai-review"),
  "ai/status": () => import("@/lib/api-handlers/ai-status"),
  // Användning (2026-11-21): the week's quota, the weeks, answers and questions per person, for the company; and per company for the superadmin.
  "ai/usage": () => import("@/lib/api-handlers/ai-usage"),
  "superadmin/ai-company-usage": () => import("@/lib/api-handlers/ai-company-usage"),
  "superadmin/ai-usage": () => import("@/lib/api-handlers/superadmin-ai-usage"),
  "superadmin/ai-credit-settings": () => import("@/lib/api-handlers/ai-credit-settings"),
  "superadmin/ai-provider": () => import("@/lib/api-handlers/ai-provider-settings"),
  "superadmin/ai-azure": () => import("@/lib/api-handlers/ai-azure-settings"),
  "integration-keys": () => import("@/lib/api-handlers/integration-keys"),
  "ingest/events": () => import("@/lib/api-handlers/ingest-events"),
  "ingest/raw": () => import("@/lib/api-handlers/ingest-raw"),
  "machine-sources": () => import("@/lib/api-handlers/machine-sources"),
  website: () => import("@/lib/api-handlers/website"),
  "website/media": () => import("@/lib/api-handlers/website-media"),
  "website/frame": () => import("@/lib/api-handlers/website-frame"),
  meta: () => import("@/lib/api-handlers/meta"),
  "meta/posts": () => import("@/lib/api-handlers/meta-posts"),
  // LinkedIn (2026-11-11): the connection and LinkedIn's answer to Koppla LinkedIn; the posts go through meta/posts (Inlägg).
  linkedin: () => import("@/lib/api-handlers/linkedin"),
  "linkedin/callback": () => import("@/lib/api-handlers/linkedin-callback"),
  // YouTube (2026-11-20): the connection, Google's answer to Koppla YouTube, and the films (Filmer).
  youtube: () => import("@/lib/api-handlers/youtube"),
  "youtube/callback": () => import("@/lib/api-handlers/youtube-callback"),
  "youtube/videos": () => import("@/lib/api-handlers/youtube-videos"),
  mcp: () => import("@/lib/api-handlers/mcp"),
  v1: () => import("@/lib/api-handlers/v1"),
  "v1/tool": () => import("@/lib/api-handlers/v1-tool"),
  import: () => import("@/lib/api-handlers/import"),
  // Schemalägg och innehållsserier (2026-11-11): scheduled posts and pages, in the core like Inlägg.
  schedule: () => import("@/lib/api-handlers/schedule"),
  // Fakturor (2026-11-04; in the core since 2026-11-10): the company's own invoices to its customers.
  "customer-invoices": () => import("@/lib/api-handlers/customer-invoices"),
  "customer-invoice-link": () => import("@/lib/api-handlers/customer-invoice-link"),
  "superadmin/customer-invoices": () => import("@/lib/api-handlers/superadmin-customer-invoices"),
  "oauth/protected-resource": async () => (await import("@/lib/api-handlers/oauth")).protectedResource,
  "oauth/authorization-server": async () => (await import("@/lib/api-handlers/oauth")).authorizationServer,
  "oauth/register": async () => (await import("@/lib/api-handlers/oauth")).register,
  "oauth/token": async () => (await import("@/lib/api-handlers/oauth")).token,
  "oauth/revoke": async () => (await import("@/lib/api-handlers/oauth")).revoke,
  "oauth/decide": async () => (await import("@/lib/api-handlers/oauth")).decide,
  "oauth/connections": async () => (await import("@/lib/api-handlers/oauth")).connections,
} satisfies Record<string, () => Promise<RouteHandlers>>;
export type CoreRouteKey = keyof typeof coreRoutes;

const notFound = () => NextResponse.json({ error: "Finns inte i den här installationen." }, { status: 404 });

/** The handlers for one of the core's lazily loaded routes; a method the handler lacks answers 404. */
export function coreRoute(key: CoreRouteKey): Required<RouteHandlers> {
  const pick = (method: keyof RouteHandlers) => async (request: Request, context: RouteContext) => {
    const handlers: RouteHandlers = await coreRoutes[key]();
    const handler = handlers[method];
    return handler ? handler(request, context) : notFound();
  };
  return { GET: pick("GET"), POST: pick("POST"), PUT: pick("PUT"), PATCH: pick("PATCH"), DELETE: pick("DELETE"), OPTIONS: pick("OPTIONS") };
}

/** Whether Workflow AI's control review can run and whether a model provider is configured (workspace overview). */
export async function coreAiOverview() {
  const [{ aiProviderStatus }, { getWorkflowAgent }] = await Promise.all([import("@/lib/ai/provider-status"), import("@/lib/ai/agent-registry")]);
  const provider = await aiProviderStatus();
  return { enabled: provider.enabled && getWorkflowAgent("kfid-control-review")?.lifecycle === "ENABLED", configured: provider.configured };
}

export async function coreOauthAuthorize(params: Record<string, string | undefined>) {
  return (await import("@/lib/oauth/page")).oauthAuthorizePage(params);
}
