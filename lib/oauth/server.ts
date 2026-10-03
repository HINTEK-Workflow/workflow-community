import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { canAccessTest } from "@/lib/auth/access";
import { authUserSelect } from "@/lib/auth/service";
import type { IntegrationPrincipal } from "@/lib/integrations/principal";
import { publicInstance } from "@/lib/instance";
import {
  ACCESS_TTL_MS, CODE_TTL_MS, OAUTH_SCOPES, REFRESH_TTL_MS, formatToken, hashToken, newSecret, parseToken, pkceMatches,
  redirectMatches, requestedScopes, sameHash, validChallenge, validRedirectUri, type OAuthScope,
} from "@/lib/oauth/rules";

// OAuth 2.1 for the MCP server (2026-10-02): Workflow is its own authorization server. Everyone who can log in
// may connect an app for themselves in a Cloud company; the app then acts as that person with the scopes approved –
// every tool call still goes through the ordinary routes and permissions, exactly like an MCP key.

export const origin = () => new URL(env.APP_URL).origin;
export const mcpResource = () => `${origin()}/api/mcp`;
export const resourceMetadataUrl = () => `${origin()}/.well-known/oauth-protected-resource/api/mcp`;

export class OAuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [origin()],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: publicInstance().name,
  };
}

export function authorizationServerMetadata() {
  const base = origin();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [...OAUTH_SCOPES],
  };
}

// ---------- Dynamic client registration (RFC 7591) ----------
const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"];

export async function registerClient(input: Record<string, unknown>) {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((item): item is string => typeof item === "string") : [];
  if (!uris.length || uris.length > 10 || !uris.every(validRedirectUri))
    throw new OAuthError(400, "invalid_redirect_uri", "redirect_uris måste vara https-adresser (http bara på den egna datorn).");
  const method = typeof input.token_endpoint_auth_method === "string" ? input.token_endpoint_auth_method : "none";
  if (!AUTH_METHODS.includes(method)) throw new OAuthError(400, "invalid_client_metadata", "token_endpoint_auth_method stöds inte.");
  const grantTypes = Array.isArray(input.grant_types) ? input.grant_types : ["authorization_code", "refresh_token"];
  if (!grantTypes.every((item) => item === "authorization_code" || item === "refresh_token"))
    throw new OAuthError(400, "invalid_client_metadata", "Bara authorization_code och refresh_token stöds.");
  const name = (typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim() : "Okänd app").slice(0, 100);
  // Registrations nobody ever approved are cleared after a week, so open registration cannot fill the table.
  await prisma.oAuthClient.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) }, grants: { none: {} } } });
  const secret = method === "none" ? null : newSecret();
  const client = await prisma.oAuthClient.create({ data: { name, redirectUris: [...new Set(uris)], authMethod: method, secretHash: secret ? hashToken(secret) : null } });
  return {
    client_id: client.id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: OAUTH_SCOPES.join(" "),
  };
}

// ---------- Authorization request ----------
export type AuthorizationRequest = {
  client: { id: string; name: string };
  redirectUri: string; state: string | null; codeChallenge: string; scopes: OAuthScope[]; resource: string;
};

/**
 * Checks an authorization request. A wrong app or redirect address is shown on the page (never redirected to); anything
 * else wrong goes back to the app as an OAuth error.
 */
export async function checkAuthorizationRequest(params: Record<string, string | undefined>):
  Promise<{ ok: true; request: AuthorizationRequest } | { ok: false; show: string } | { ok: false; redirect: string }> {
  const client = params.client_id ? await prisma.oAuthClient.findUnique({ where: { id: params.client_id } }) : null;
  if (!client) return { ok: false, show: "Appen är inte registrerad hos Workflow. Starta anslutningen igen från appen." };
  const redirectUri = params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) return { ok: false, show: "Appens återgångsadress stämmer inte med den registrerade. Anslutningen avbröts." };
  const state = params.state ?? null;
  const back = (error: string, description: string) => ({ ok: false as const, redirect: errorRedirect(redirectUri, state, error, description) });
  if (params.response_type !== "code") return back("unsupported_response_type", "Bara response_type=code stöds.");
  if (params.code_challenge_method !== "S256" || !validChallenge(params.code_challenge ?? "")) return back("invalid_request", "PKCE med S256 krävs.");
  const resource = params.resource ?? mcpResource();
  if (resource.replace(/\/$/, "") !== mcpResource()) return back("invalid_target", "Bara Workflows MCP-server kan anslutas.");
  return { ok: true, request: { client: { id: client.id, name: client.name }, redirectUri, state, codeChallenge: params.code_challenge!, scopes: requestedScopes(params.scope), resource: mcpResource() } };
}

export function errorRedirect(redirectUri: string, state: string | null, error: string, description?: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("iss", origin());
  return url.toString();
}

/** The person approved: a one-time code (five minutes) bound to the app, the address, the PKCE challenge and the company. */
export async function issueCode(request: AuthorizationRequest, person: { userId: string; organizationId: string }, scopes: OAuthScope[]) {
  await prisma.oAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
  const code = randomBytes(32).toString("base64url");
  await prisma.oAuthAuthorizationCode.create({ data: {
    codeHash: hashToken(code), clientId: request.client.id, organizationId: person.organizationId, userId: person.userId,
    redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, scopes, resource: request.resource, expiresAt: new Date(Date.now() + CODE_TTL_MS),
  } });
  const url = new URL(request.redirectUri);
  url.searchParams.set("code", code);
  if (request.state) url.searchParams.set("state", request.state);
  url.searchParams.set("iss", origin());
  return url.toString();
}

// ---------- Token endpoint ----------
type ClientCredentials = { clientId: string | null; secret: string | null };

/** The app's identity at the token endpoint: client_id (and secret) in the form, or HTTP Basic. */
export function clientCredentials(form: URLSearchParams, authorization: string | null): ClientCredentials {
  const basic = /^Basic\s+(.+)$/i.exec(authorization ?? "");
  if (basic) {
    const [id, secret] = Buffer.from(basic[1], "base64").toString("utf8").split(":");
    return { clientId: decodeURIComponent(id ?? ""), secret: decodeURIComponent(secret ?? "") };
  }
  return { clientId: form.get("client_id"), secret: form.get("client_secret") };
}

async function authenticateClient(credentials: ClientCredentials) {
  const client = credentials.clientId ? await prisma.oAuthClient.findUnique({ where: { id: credentials.clientId } }) : null;
  if (!client) throw new OAuthError(401, "invalid_client", "Okänd app.");
  if (client.secretHash && (!credentials.secret || !sameHash(credentials.secret, client.secretHash))) throw new OAuthError(401, "invalid_client", "Appens hemlighet stämmer inte.");
  return client;
}

async function issueTokens(grantId: string, scopes: string[]) {
  const accessSecret = newSecret(); const refreshSecret = newSecret();
  const now = Date.now();
  const [access, refresh] = await prisma.$transaction([
    prisma.oAuthToken.create({ data: { grantId, kind: "ACCESS", secretHash: hashToken(accessSecret), expiresAt: new Date(now + ACCESS_TTL_MS) } }),
    prisma.oAuthToken.create({ data: { grantId, kind: "REFRESH", secretHash: hashToken(refreshSecret), expiresAt: new Date(now + REFRESH_TTL_MS) } }),
  ]);
  await prisma.oAuthToken.deleteMany({ where: { grantId, expiresAt: { lt: new Date(now - 86_400_000) } } });
  return {
    access_token: formatToken("ACCESS", access.id, accessSecret), token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: formatToken("REFRESH", refresh.id, refreshSecret), scope: scopes.join(" "),
  };
}

async function revokeGrant(grantId: string, revokedById: string | null) {
  const now = new Date();
  await prisma.$transaction([
    prisma.oAuthGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: now, revokedById } }),
    prisma.oAuthToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
}

export async function exchangeToken(form: URLSearchParams, authorization: string | null) {
  const client = await authenticateClient(clientCredentials(form, authorization));
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const stored = code ? await prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash: hashToken(code) } }) : null;
    if (!stored || stored.clientId !== client.id || stored.expiresAt <= new Date()) throw new OAuthError(400, "invalid_grant", "Koden är ogiltig eller för gammal.");
    if (stored.usedAt) {
      // A code used twice may have been stolen: the connection it made is disconnected (RFC 9700).
      if (stored.grantId) await revokeGrant(stored.grantId, null);
      throw new OAuthError(400, "invalid_grant", "Koden är redan använd.");
    }
    if ((form.get("redirect_uri") ?? stored.redirectUri) !== stored.redirectUri) throw new OAuthError(400, "invalid_grant", "Återgångsadressen stämmer inte.");
    if (!pkceMatches(form.get("code_verifier") ?? "", stored.codeChallenge)) throw new OAuthError(400, "invalid_grant", "PKCE-kontrollen misslyckades.");
    const resource = form.get("resource");
    if (resource && resource.replace(/\/$/, "") !== stored.resource) throw new OAuthError(400, "invalid_target", "Fel resurs.");
    const claimed = await prisma.oAuthAuthorizationCode.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!claimed.count) throw new OAuthError(400, "invalid_grant", "Koden är redan använd.");
    const grant = await prisma.oAuthGrant.create({ data: { clientId: client.id, organizationId: stored.organizationId, userId: stored.userId, scopes: stored.scopes, resource: stored.resource } });
    await prisma.oAuthAuthorizationCode.update({ where: { id: stored.id }, data: { grantId: grant.id } });
    await prisma.oAuthClient.update({ where: { id: client.id }, data: { lastUsedAt: new Date() } });
    return issueTokens(grant.id, grant.scopes);
  }
  if (grantType === "refresh_token") {
    const parsed = parseToken(form.get("refresh_token") ?? "");
    const token = parsed?.kind === "REFRESH" ? await prisma.oAuthToken.findUnique({ where: { id: parsed.id }, include: { grant: true } }) : null;
    if (!parsed || !token || token.kind !== "REFRESH" || !sameHash(parsed.secret, token.secretHash) || token.grant.clientId !== client.id)
      throw new OAuthError(400, "invalid_grant", "Förnyelsetoken är ogiltig.");
    if (token.usedAt) {
      // A refresh token used twice: someone else has a copy, so the whole connection is closed.
      await revokeGrant(token.grantId, null);
      throw new OAuthError(400, "invalid_grant", "Förnyelsetoken är redan använd.");
    }
    if (token.revokedAt || token.grant.revokedAt || token.expiresAt <= new Date()) throw new OAuthError(400, "invalid_grant", "Anslutningen är bortkopplad eller för gammal.");
    const claimed = await prisma.oAuthToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!claimed.count) throw new OAuthError(400, "invalid_grant", "Förnyelsetoken är redan använd.");
    // The person must still have access to the company for the connection to live on.
    if (!(await principalOfGrant(token.grantId))) { await revokeGrant(token.grantId, null); throw new OAuthError(400, "invalid_grant", "Personen har inte längre åtkomst."); }
    return issueTokens(token.grantId, token.grant.scopes);
  }
  throw new OAuthError(400, "unsupported_grant_type", "Bara authorization_code och refresh_token stöds.");
}

/** RFC 7009: a token handed back disconnects its connection. Unknown tokens are answered the same way. */
export async function revokeToken(form: URLSearchParams, authorization: string | null) {
  const client = await authenticateClient(clientCredentials(form, authorization));
  const parsed = parseToken(form.get("token") ?? "");
  if (!parsed) return;
  const token = await prisma.oAuthToken.findUnique({ where: { id: parsed.id }, include: { grant: true } });
  if (token && token.grant.clientId === client.id && sameHash(parsed.secret, token.secretHash)) await revokeGrant(token.grantId, token.grant.userId);
}

// ---------- The MCP server's check ----------
async function principalOfGrant(grantId: string): Promise<IntegrationPrincipal | null> {
  const grant = await prisma.oAuthGrant.findUnique({ where: { id: grantId }, include: { client: { select: { name: true } } } });
  if (!grant || grant.revokedAt || grant.resource !== mcpResource()) return null;
  const [user, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: grant.userId }, select: authUserSelect }),
    prisma.organizationMember.findFirst({
      where: { organizationId: grant.organizationId, userId: grant.userId, isActive: true, organization: { isActive: true, storageMode: "HINTEK_CLOUD" } },
      select: { id: true },
    }),
  ]);
  if (!canAccessTest(user) || !membership) return null;
  return { keyId: grant.id, keyName: grant.client.name, via: "oauth", kind: "MCP", organizationId: grant.organizationId, actingUserId: grant.userId, scopes: grant.scopes };
}

/** An access token presented to the MCP server, or null when it is not valid (any more). */
export async function authenticateOAuthAccessToken(token: string, now = new Date()): Promise<IntegrationPrincipal | null> {
  const parsed = parseToken(token);
  if (!parsed || parsed.kind !== "ACCESS") return null;
  const stored = await prisma.oAuthToken.findUnique({ where: { id: parsed.id } });
  if (!stored || stored.kind !== "ACCESS" || stored.revokedAt || stored.expiresAt <= now || !sameHash(parsed.secret, stored.secretHash)) return null;
  const principal = await principalOfGrant(stored.grantId);
  if (!principal) return null;
  await prisma.oAuthGrant.updateMany({ where: { id: stored.grantId, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - 60_000) } }] }, data: { lastUsedAt: now } });
  return principal;
}

// ---------- Connections in API och MCP ----------
export async function listConnections(organizationId: string, userId?: string) {
  const grants = await prisma.oAuthGrant.findMany({
    where: { organizationId, ...(userId ? { userId } : {}) }, orderBy: { createdAt: "desc" }, take: 50,
    select: { id: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true, client: { select: { name: true, redirectUris: true } }, user: { select: { name: true, email: true } } },
  });
  return grants.map((grant) => ({
    id: grant.id, app: grant.client.name, redirectHost: hostOf(grant.client.redirectUris[0]), person: grant.user.name || grant.user.email,
    scopes: grant.scopes, createdAt: grant.createdAt, lastUsedAt: grant.lastUsedAt, revokedAt: grant.revokedAt,
  }));
}

export async function listOwnConnections(organizationId: string, userId: string) {
  return (await listConnections(organizationId, userId)).filter((item) => !item.revokedAt);
}

export async function disconnectOwn(organizationId: string, userId: string, grantId: string) {
  const grant = await prisma.oAuthGrant.findFirst({ where: { id: grantId, organizationId, userId, revokedAt: null }, select: { id: true } });
  return grant ? disconnect(organizationId, grant.id, userId) : null;
}

export async function disconnect(organizationId: string, grantId: string, actorId: string) {
  const grant = await prisma.oAuthGrant.findFirst({ where: { id: grantId, organizationId }, include: { client: { select: { name: true } } } });
  if (!grant) return null;
  await revokeGrant(grant.id, actorId);
  return grant.client.name;
}

export function hostOf(uri: string | undefined) {
  if (!uri) return "";
  try { const url = new URL(uri); return url.protocol === "https:" || url.protocol === "http:" ? url.host : url.protocol.replace(/:$/, ""); } catch { return ""; }
}

export const scopeList = (scopes: string[]) => scopes.filter((item): item is OAuthScope => (OAUTH_SCOPES as readonly string[]).includes(item));
