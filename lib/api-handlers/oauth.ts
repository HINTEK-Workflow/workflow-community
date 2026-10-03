import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import type { RouteHandlers } from "@/lib/extensions/types";
import { approvedScopes } from "@/lib/oauth/rules";
import {
  OAuthError, authorizationServerMetadata, disconnectOwn, listOwnConnections, checkAuthorizationRequest, errorRedirect, exchangeToken, issueCode,
  protectedResourceMetadata, registerClient, revokeToken,
} from "@/lib/oauth/server";

export const dynamic = "force-dynamic";

// The public OAuth endpoints are called by other servers and by MCP clients in a browser; they never use cookies, so
// any origin may call them (2026-10-02: OAuth 2.1 for the MCP server).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "600",
};
const options = () => new NextResponse(null, { status: 204, headers: CORS });
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } });
const oauthFailure = (error: unknown) => {
  if (error instanceof OAuthError) return json({ error: error.code, error_description: error.message }, error.status);
  console.error("OAuth endpoint failed", error instanceof Error ? error.name : "Unknown");
  return json({ error: "server_error", error_description: "Något gick fel." }, 500);
};

/** Open endpoints are limited per address so nobody can flood them. */
const windows = new Map<string, { start: number; count: number }>();
function limit(request: Request, bucket: string, perHour: number) {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
  const key = `${bucket}:${ip}`; const now = Date.now();
  const window = windows.get(key);
  if (!window || now - window.start >= 3_600_000) { windows.set(key, { start: now, count: 1 }); return; }
  if (++window.count > perHour) throw new OAuthError(429, "slow_down", "För många försök. Vänta en stund.");
}

async function form(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  const text = await request.text();
  if (text.length > 20_000) throw new OAuthError(413, "invalid_request", "För stor begäran.");
  if (type.includes("application/json")) {
    try { return new URLSearchParams(Object.entries(JSON.parse(text) as Record<string, string>).map(([key, value]) => [key, String(value)])); }
    catch { throw new OAuthError(400, "invalid_request", "Ogiltig JSON."); }
  }
  return new URLSearchParams(text);
}

export const protectedResource: RouteHandlers = { GET: () => json(protectedResourceMetadata()), OPTIONS: options };
export const authorizationServer: RouteHandlers = { GET: () => json(authorizationServerMetadata()), OPTIONS: options };

export const register: RouteHandlers = {
  OPTIONS: options,
  async POST(request) {
    try {
      limit(request, "register", 20);
      const text = await request.text();
      if (text.length > 20_000) throw new OAuthError(413, "invalid_client_metadata", "För stor begäran.");
      let input: unknown;
      try { input = JSON.parse(text); } catch { throw new OAuthError(400, "invalid_client_metadata", "Ogiltig JSON."); }
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new OAuthError(400, "invalid_client_metadata", "Ogiltig registrering.");
      return json(await registerClient(input as Record<string, unknown>), 201);
    } catch (error) { return oauthFailure(error); }
  },
};

export const token: RouteHandlers = {
  OPTIONS: options,
  async POST(request) {
    try { limit(request, "token", 600); return json(await exchangeToken(await form(request), request.headers.get("authorization"))); }
    catch (error) { return oauthFailure(error); }
  },
};

export const revoke: RouteHandlers = {
  OPTIONS: options,
  async POST(request) {
    try { limit(request, "revoke", 600); await revokeToken(await form(request), request.headers.get("authorization")); return new NextResponse(null, { status: 200, headers: CORS }); }
    catch (error) { return oauthFailure(error); }
  },
};

const decisionSchema = z.object({
  params: z.record(z.string(), z.string().max(2000)),
  decision: z.enum(["approve", "deny"]),
  scopes: z.array(z.string().max(40)).max(10).default([]),
});

/**
 * The approval page's answer. Same checks as the page (the request is checked again here), then a session, the same
 * Origin, a member of a Cloud company, and the legal gate through context(). Any member may connect an app for
 * themselves (2026-10-02); the app then has exactly that member's rights.
 */
export const decide: RouteHandlers = {
  async POST(request) {
    try {
      checkOrigin(request);
      const ctx = await context();
      if (ctx.organization.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Appar kan bara anslutas till ett företag i serverlagring.");
      const input = decisionSchema.parse(await body(request));
      const checked = await checkAuthorizationRequest(input.params);
      if (!checked.ok) {
        if ("redirect" in checked) return NextResponse.json({ redirect: checked.redirect });
        throw new ApiError(400, checked.show);
      }
      const { request: authorization } = checked;
      if (input.decision === "deny") return NextResponse.json({ redirect: errorRedirect(authorization.redirectUri, authorization.state, "access_denied", "Anslutningen nekades.") });
      const scopes = approvedScopes(input.scopes, authorization.scopes);
      const redirect = await issueCode(authorization, { userId: ctx.user.id, organizationId: ctx.organizationId }, scopes);
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "oauth_connect", detail: `Appen ”${authorization.client.name}” anslöts till MCP-servern (${scopes.join(", ")}).` } });
      return NextResponse.json({ redirect });
    } catch (error) { return failure(error); }
  },
};

/** The person's own connected apps (Mina inställningar): list them and disconnect one. */
export const connections: RouteHandlers = {
  async GET() {
    try {
      const ctx = await context();
      return NextResponse.json({ connections: ctx.organization.storageMode === "HINTEK_CLOUD" ? await listOwnConnections(ctx.organizationId, ctx.user.id) : [] }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) { return failure(error); }
  },
  async POST(request) {
    try {
      checkOrigin(request);
      const ctx = await context();
      const input = z.object({ id: z.string().min(1).max(60) }).parse(await body(request));
      const app = await disconnectOwn(ctx.organizationId, ctx.user.id, input.id);
      if (!app) throw new ApiError(404, "Anslutningen finns inte.");
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "oauth_disconnect", detail: `Kopplade från appen ”${app}” från MCP-servern.` } });
      return NextResponse.json({ ok: true });
    } catch (error) { return failure(error); }
  },
};
