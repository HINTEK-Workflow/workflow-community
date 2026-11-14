import { isGuid, type MicrosoftIdentity } from "@/lib/auth/microsoft-core";

/**
 * Microsoft-grupp för operatörer (2026-10-30), the rules without a database or network.
 *
 * The company's admin connects the company's own Entra directory once (by signing in with a Microsoft account of that
 * directory – the directory id then comes from a verified ID token, never from an address the browser can change) and
 * chooses one group. A member of that group signs in on the operator page and gets an operator account the first time;
 * someone who has left the group is refused at the next sign-in (membership is asked of Microsoft Graph every time). A new
 * operator sees no machines until the admin chooses. Identity is tid + oid, never the e-mail address.
 *
 * This changes "Microsoft only after linking from a signed-in session" (lib/auth/microsoft.ts) for operator accounts only;
 * a person's Workflow account still signs in with Microsoft only after linking. Off by default per company.
 *
 * Microsoft Graph: the app registration needs the application permission GroupMember.Read.All with the directory
 * administrator's consent; the check is POST /users/{oid}/checkMemberGroups.
 */
export const OPERATOR_MS_CALLBACK_PATH = "/operator/api/microsoft/callback";
export const OPERATOR_MS_CONSENT_PATH = "/operator/api/microsoft/consent";
export const GRAPH = "https://graph.microsoft.com/v1.0";
export const LOGIN = "https://login.microsoftonline.com";
/** The keys of every directory (the token's own tid is checked against the issuer afterwards). */
export const MICROSOFT_KEYS_URL = `${LOGIN}/common/discovery/v2.0/keys`;
/** How long a started sign-in (state, nonce, PKCE verifier in a short cookie) may take. */
export const FLOW_MINUTES = 10;
/** Leeway for the clocks when checking the token's times. */
export const CLOCK_SKEW_SECONDS = 300;

export type GroupSettings = { enabled: boolean; tenantId: string | null; groupId: string | null; consentAt: Date | null };

export const OPERATOR_MS_ERRORS = {
  off: "Inloggning med Microsoft är inte påslagen för företagets operatörer.",
  identity: "Microsoft skickade inte ett konto vi känner igen. Försök igen.",
  tenant: "Kontot hör till en annan katalog än företagets.",
  not_member: "Du är inte med i gruppen som får logga in här. Kontakta din administratör.",
  graph: "Det gick inte att fråga Microsoft om gruppen just nu. Försök igen om en stund.",
  blocked: "Kontot är spärrat. Kontakta din administratör.",
  expired: "Inloggningen tog för lång tid. Försök igen.",
  token: "Microsoft-inloggningen kunde inte kontrolleras. Försök igen.",
} as const;
export type OperatorMsError = keyof typeof OPERATOR_MS_ERRORS;
export const isOperatorMsError = (value: string): value is OperatorMsError => value in OPERATOR_MS_ERRORS;

/** Whether the company's group sign-in is set up enough to offer the button. */
export const groupSignInReady = (settings: GroupSettings) =>
  Boolean(settings.enabled && settings.tenantId && isGuid(settings.tenantId) && settings.groupId && isGuid(settings.groupId) && settings.consentAt);

/**
 * The decision at sign-in: the setting is on, the identity is whole, it is the company's directory, and Microsoft said
 * it is a member of the group (`member` is null when Graph could not be asked – never let in on a guess).
 */
export function groupSignInDecision(input: { settings: GroupSettings; identity: MicrosoftIdentity | null; member: boolean | null }): { ok: true } | { ok: false; error: OperatorMsError } {
  if (!groupSignInReady(input.settings)) return { ok: false, error: "off" };
  if (!input.identity) return { ok: false, error: "identity" };
  if (input.identity.tid !== input.settings.tenantId) return { ok: false, error: "tenant" };
  if (input.member === null) return { ok: false, error: "graph" };
  if (!input.member) return { ok: false, error: "not_member" };
  return { ok: true };
}

/** Graph's answer to checkMemberGroups: { value: [groupIds the user is a (transitive) member of] }. */
export function memberOfGroup(answer: unknown, groupId: string): boolean {
  const value = (answer as { value?: unknown } | null)?.value;
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.toLowerCase() === groupId.toLowerCase());
}

/** The account's name in the list: the person's name from the token, else the unverified label, else a fallback. */
export const microsoftOperatorName = (identity: Pick<MicrosoftIdentity, "name" | "label">) => (identity.name || identity.label || "Microsoft-konto").slice(0, 80);

export function authorizeUrl(input: { tenant: string; clientId: string; redirectUri: string; state: string; nonce: string; codeChallenge: string; prompt?: string }) {
  const url = new URL(`${LOGIN}/${encodeURIComponent(input.tenant)}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: input.clientId, response_type: "code", redirect_uri: input.redirectUri, response_mode: "query",
    scope: "openid profile", state: input.state, nonce: input.nonce, code_challenge: input.codeChallenge, code_challenge_method: "S256",
    prompt: input.prompt ?? "select_account",
  }).toString();
  return url.toString();
}

/** Microsoft's admin consent for the app's Graph permission in one directory (the directory's own administrator answers). */
export function adminConsentUrl(input: { tenant: string; clientId: string; redirectUri: string; state: string }) {
  const url = new URL(`${LOGIN}/${encodeURIComponent(input.tenant)}/v2.0/adminconsent`);
  url.search = new URLSearchParams({ client_id: input.clientId, redirect_uri: input.redirectUri, state: input.state, scope: "https://graph.microsoft.com/.default" }).toString();
  return url.toString();
}

export type IdTokenClaims = { iss?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown; iat?: unknown; nonce?: unknown; tid?: unknown; oid?: unknown; email?: unknown; preferred_username?: unknown; name?: unknown };

/**
 * The ID token's claims, after its signature is verified: Microsoft's issuer for the token's own directory, our client
 * id as the audience, within its times, the nonce we sent, and – when a directory is expected – that directory.
 */
export function idTokenClaimsProblem(claims: IdTokenClaims, expected: { clientId: string; nonce: string; tenant: string | null; now?: number }): string | null {
  const now = Math.floor((expected.now ?? Date.now()) / 1000);
  const tid = typeof claims.tid === "string" ? claims.tid.toLowerCase() : "";
  if (!isGuid(tid)) return "tid";
  if (claims.iss !== `${LOGIN}/${tid}/v2.0`) return "iss";
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(expected.clientId)) return "aud";
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < now) return "exp";
  if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_SECONDS > now) return "nbf";
  if (claims.nonce !== expected.nonce) return "nonce";
  if (expected.tenant && tid !== expected.tenant.toLowerCase()) return "tenant";
  return null;
}

export type FlowCookie = { purpose: "operator" | "connect"; state: string; nonce: string; verifier: string; pageKey: string; organizationId: string; at: number };

/** The started sign-in kept in a short cookie: whole, of the expected purpose and not older than FLOW_MINUTES. */
export function parseFlowCookie(raw: string | undefined, now = Date.now()): FlowCookie | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<FlowCookie>;
    if ((value.purpose !== "operator" && value.purpose !== "connect") || !value.state || !value.nonce || !value.verifier || typeof value.at !== "number") return null;
    if (now - value.at > FLOW_MINUTES * 60_000 || value.at > now + 60_000) return null;
    return { purpose: value.purpose, state: value.state, nonce: value.nonce, verifier: value.verifier, pageKey: value.pageKey ?? "", organizationId: value.organizationId ?? "", at: value.at };
  } catch {
    return null;
  }
}
export const flowCookieValue = (value: FlowCookie) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
