import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from "node:crypto";
import { prisma } from "@/lib/db";
import { absoluteUrl } from "@/lib/env";
import { microsoftSignInConfig } from "@/lib/auth/microsoft";
import { companyLocksAllow, isGuid, microsoftIdentity, tenantAccepted, type MicrosoftIdentity } from "@/lib/auth/microsoft-core";
import {
  adminConsentUrl, authorizeUrl, GRAPH, groupSignInDecision, idTokenClaimsProblem, LOGIN, memberOfGroup, MICROSOFT_KEYS_URL, microsoftOperatorName,
  OPERATOR_MS_CALLBACK_PATH, OPERATOR_MS_CONSENT_PATH, type FlowCookie, type IdTokenClaims, type OperatorMsError,
} from "@/lib/operator/microsoft-group";
import { microsoftUsernameKey } from "@/lib/operator/rules";

/**
 * Microsoft-grupp för operatörer, the network and database part (rules: microsoft-group.ts). Uses the installation's own
 * Microsoft app registration (Installation → Servernycklar; lib/auth/microsoft.ts) – the button exists only
 * while Microsoft sign-in is ready there and the installation's tenant setting accepts the company's directory. `fetcher`
 * is replaceable so the tests can answer for Microsoft (mocked Graph and token answers; no network in tests).
 */
type Fetcher = typeof fetch;
type AppConfig = { clientId: string; clientSecret: string; tenant: string };
let configForTests: AppConfig | null = null;
/** Unit tests only: the app registration without the database (null: the installation's own, lib/auth/microsoft.ts). */
export function setMicrosoftConfigForTests(next: AppConfig | null) { configForTests = next; }
const appConfig = async () => configForTests ?? microsoftSignInConfig();
const timeout = () => AbortSignal.timeout(10_000);
const b64url = (value: Buffer) => value.toString("base64url");

export const callbackUri = () => absoluteUrl(OPERATOR_MS_CALLBACK_PATH);
export const consentUri = () => absoluteUrl(OPERATOR_MS_CONSENT_PATH);

/** A new flow: state, nonce and the PKCE pair. */
export function newFlow(purpose: FlowCookie["purpose"], pageKey: string, organizationId: string): FlowCookie & { challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { purpose, pageKey, organizationId, state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier, at: Date.now(), challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

/** Where the browser goes to sign in: the company's own directory for an operator, any work directory for the admin's connect. */
export async function startUrl(flow: FlowCookie & { challenge: string }, tenant: string) {
  const config = await appConfig();
  if (!config) return null;
  return authorizeUrl({ tenant, clientId: config.clientId, redirectUri: callbackUri(), state: flow.state, nonce: flow.nonce, codeChallenge: flow.challenge });
}

export async function consentUrl(tenant: string, state: string) {
  const config = await appConfig();
  return config ? adminConsentUrl({ tenant, clientId: config.clientId, redirectUri: consentUri(), state }) : null;
}

/** RS256 signature of an ID token against Microsoft's published keys. */
export async function verifiedClaims(idToken: string, expected: { clientId: string; nonce: string; tenant: string | null }, fetcher: Fetcher = fetch): Promise<IdTokenClaims | null> {
  const [head, body, signature] = idToken.split(".");
  if (!head || !body || !signature) return null;
  try {
    const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8")) as { alg?: string; kid?: string };
    if (header.alg !== "RS256" || !header.kid) return null;
    const keys = await fetcher(MICROSOFT_KEYS_URL, { headers: { accept: "application/json" }, signal: timeout() });
    if (!keys.ok) return null;
    const jwk = ((await keys.json()) as { keys?: (JsonWebKey & { kid?: string })[] }).keys?.find((key) => key.kid === header.kid);
    if (!jwk) return null;
    const ok = verify("RSA-SHA256", Buffer.from(`${head}.${body}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(signature, "base64url"));
    if (!ok) return null;
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as IdTokenClaims;
    return idTokenClaimsProblem(claims, expected) ? null : claims;
  } catch {
    return null;
  }
}

/** The code for tokens (with the PKCE verifier) and the verified identity in the ID token. */
export async function identityFromCode(input: { code: string; flow: FlowCookie; tenant: string }, fetcher: Fetcher = fetch): Promise<MicrosoftIdentity | null> {
  const config = await appConfig();
  if (!config) return null;
  const response = await fetcher(`${LOGIN}/${encodeURIComponent(input.tenant)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, signal: timeout(),
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, client_secret: config.clientSecret, code: input.code, redirect_uri: callbackUri(), code_verifier: input.flow.verifier, scope: "openid profile" }),
  }).catch(() => null);
  if (!response?.ok) return null;
  const idToken = ((await response.json().catch(() => ({}))) as { id_token?: unknown }).id_token;
  if (typeof idToken !== "string") return null;
  const claims = await verifiedClaims(idToken, { clientId: config.clientId, nonce: input.flow.nonce, tenant: isGuid(input.tenant) ? input.tenant : null }, fetcher);
  return claims ? microsoftIdentity(claims) : null;
}

/** An app token for Graph in the company's directory (client credentials); null when the directory has not consented. */
async function graphToken(tenant: string, fetcher: Fetcher) {
  const config = await appConfig();
  if (!config) return null;
  const response = await fetcher(`${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, signal: timeout(),
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret, scope: "https://graph.microsoft.com/.default" }),
  }).catch(() => null);
  if (!response?.ok) return null;
  const token = ((await response.json().catch(() => ({}))) as { access_token?: unknown }).access_token;
  return typeof token === "string" ? token : null;
}

/** Is the person a (transitive) member of the group? null when Microsoft could not be asked. */
export async function isGroupMember(input: { tenant: string; oid: string; groupId: string }, fetcher: Fetcher = fetch): Promise<boolean | null> {
  const token = await graphToken(input.tenant, fetcher);
  if (!token) return null;
  const response = await fetcher(`${GRAPH}/users/${encodeURIComponent(input.oid)}/checkMemberGroups`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }, signal: timeout(),
    body: JSON.stringify({ groupIds: [input.groupId] }),
  }).catch(() => null);
  if (!response) return null;
  if (response.status === 404) return false;
  if (!response.ok) return null;
  return memberOfGroup(await response.json().catch(() => null), input.groupId);
}

/** Kontrollera: the app may read the group in the directory; its name. Only the outcome is kept. */
export async function checkGroup(input: { tenant: string; groupId: string }, fetcher: Fetcher = fetch) {
  const at = new Date().toISOString();
  const token = await graphToken(input.tenant, fetcher);
  if (!token) return { ok: false, message: "Microsoft gav ingen åtkomst. Ge medgivandet i katalogen först.", at, name: "" };
  const response = await fetcher(`${GRAPH}/groups/${encodeURIComponent(input.groupId)}?$select=id,displayName`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: timeout() }).catch(() => null);
  if (!response) return { ok: false, message: "Microsoft svarade inte. Försök igen om en stund.", at, name: "" };
  if (response.status === 404) return { ok: false, message: "Gruppen finns inte i katalogen.", at, name: "" };
  if (response.status === 403) return { ok: false, message: "Appen får inte läsa grupper. Kontrollera behörigheten GroupMember.Read.All och medgivandet.", at, name: "" };
  if (!response.ok) return { ok: false, message: `Microsoft svarade ${response.status}.`, at, name: "" };
  const name = String(((await response.json().catch(() => ({}))) as { displayName?: unknown }).displayName ?? "").slice(0, 120);
  return { ok: true, message: `Appen kan läsa gruppen ${name || input.groupId}.`, at, name };
}

/** The company's Microsoft lock (WorkspaceSettings.microsoftTenantId) must allow the directory too. */
export async function companyLockAllows(organizationId: string, tid: string) {
  const row = await prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { microsoftTenantId: true } });
  return companyLocksAllow([row?.microsoftTenantId], tid);
}

/** The installation's tenant setting must accept the company's directory (single-directory installations). */
export async function installationAccepts(tid: string) {
  const config = await appConfig();
  return Boolean(config && tenantAccepted(config.tenant, tid));
}

export type GroupSignIn = { ok: true; accountId: string; created: boolean } | { ok: false; error: OperatorMsError };

/**
 * An operator's Microsoft sign-in after the identity is verified: the company's setting, the directory, the group (asked
 * every time), then the account – found by tid + oid, or made now with no machines (the admin chooses; a notice tells them).
 */
export async function groupSignIn(input: { organizationId: string; identity: MicrosoftIdentity | null }, fetcher: Fetcher = fetch): Promise<GroupSignIn> {
  const row = await prisma.operatorSettings.findUnique({ where: { organizationId: input.organizationId } });
  const settings = { enabled: Boolean(row?.microsoftEnabled), tenantId: row?.microsoftTenantId ?? null, groupId: row?.microsoftGroupId ?? null, consentAt: row?.microsoftConsentAt ?? null };
  const identity = input.identity;
  const precheck = groupSignInDecision({ settings, identity, member: true });
  if (!precheck.ok) return precheck;
  const member = await isGroupMember({ tenant: settings.tenantId!, oid: identity!.oid, groupId: settings.groupId! }, fetcher);
  const decision = groupSignInDecision({ settings, identity, member });
  if (!decision.ok) return decision;
  const where = { organizationId_microsoftTenantId_microsoftObjectId: { organizationId: input.organizationId, microsoftTenantId: identity!.tid, microsoftObjectId: identity!.oid } };
  const existing = await prisma.operatorAccount.findUnique({ where, select: { id: true, active: true } });
  const name = microsoftOperatorName(identity!);
  if (existing) {
    if (!existing.active) return { ok: false, error: "blocked" };
    await prisma.operatorAccount.updateMany({ where: { id: existing.id, organizationId: input.organizationId }, data: { displayName: name } });
    return { ok: true, accountId: existing.id, created: false };
  }
  try {
    const created = await prisma.$transaction(async (tx) => {
      const account = await tx.operatorAccount.create({ data: {
        organizationId: input.organizationId, username: name, usernameKey: microsoftUsernameKey(identity!.oid), kind: "microsoft", microsoftTenantId: identity!.tid, microsoftObjectId: identity!.oid,
        displayName: name, shared: false, active: true,
      }, select: { id: true } });
      await tx.administrationEvent.create({ data: { actorId: "system:operator-microsoft", organizationId: input.organizationId, action: "operator_account_microsoft",
        detail: `Nytt operatörskonto via Microsoft-gruppen: ”${name}”. Det ser inga maskiner förrän en administratör väljer.` } });
      return account;
    });
    return { ok: true, accountId: created.id, created: true };
  } catch {
    // Made by a second sign-in at the same moment: the unique key decides.
    const raced = await prisma.operatorAccount.findUnique({ where, select: { id: true, active: true } });
    return raced?.active ? { ok: true, accountId: raced.id, created: false } : { ok: false, error: "identity" };
  }
}
