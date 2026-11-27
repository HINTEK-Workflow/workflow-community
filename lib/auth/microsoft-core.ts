/**
 * Inloggning med Microsoft (Entra ID, OIDC; 2026-10-09, built 2026-10-11), the rules without a database or
 * network, so they can be tested alone.
 *
 * Identity is the pair tid (the directory) + oid (the person in it), never the e-mail address: Entra's email and
 * preferred_username are not verified the way Google's email_verified is, so a Microsoft account signs in only after the
 * person linked it from a signed-in session, and is never matched to an account by address.
 */
export const MICROSOFT_PROVIDER = "microsoft";
/** The directory personal Microsoft accounts (outlook.com, hotmail.com, live.com) belong to. */
export const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

import { MICROSOFT_TENANT_MODES } from "@/lib/auth/microsoft-text";

export { MICROSOFT_ERRORS, MICROSOFT_TENANT_LABELS, MICROSOFT_TENANT_MODES, type MicrosoftError, type MicrosoftTenantMode } from "@/lib/auth/microsoft-text";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isGuid = (value: string) => GUID.test(value);

/** A tenant setting: one of the three modes or a directory id (lower case); null when it is neither. */
export function normalizeTenant(value: string | null | undefined): string | null {
  const clean = (value ?? "").trim().toLowerCase();
  if ((MICROSOFT_TENANT_MODES as readonly string[]).includes(clean)) return clean;
  return isGuid(clean) ? clean : null;
}

/** The application (client) id from the app registration is a GUID. */
export const clientIdLooksRight = (value: string | null | undefined) => isGuid((value ?? "").trim().toLowerCase());

export const microsoftAuthority = (tenant: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0`;
export const microsoftDiscoveryUrl = (tenant: string) => `${microsoftAuthority(tenant)}/.well-known/openid-configuration`;

/**
 * Kontrollera: whether the discovery document is Microsoft's for this tenant setting. The multi-directory modes have
 * the issuer as a template with {tenantid}; a single directory or the consumer directory has its own id in it.
 */
export function discoveryLooksRight(document: unknown, tenant: string): { ok: boolean; message: string } {
  const value = (document ?? {}) as Record<string, unknown>;
  const issuer = typeof value.issuer === "string" ? value.issuer : "";
  const endpoints = ["authorization_endpoint", "token_endpoint", "jwks_uri"].every((key) => typeof value[key] === "string" && String(value[key]).startsWith("https://login.microsoftonline.com/"));
  if (!issuer.startsWith("https://login.microsoftonline.com/") || !endpoints) return { ok: false, message: "Svaret liknar inte Microsofts inloggning." };
  const expected = tenant === "consumers" ? MICROSOFT_CONSUMER_TENANT : tenant === "common" || tenant === "organizations" ? "{tenantid}" : tenant;
  if (!issuer.includes(`/${expected}/`)) return { ok: false, message: "Microsoft svarade för en annan katalog än den som är vald." };
  return { ok: true, message: "Microsofts inloggning svarar för den valda katalogen." };
}

export type MicrosoftClaims = { tid?: unknown; oid?: unknown; email?: unknown; preferred_username?: unknown; name?: unknown; amr?: unknown };

/**
 * Microsofts tvåsteg räknas som Workflows (2026-11-27). Microsoft's documentation (Optional claims reference,
 * "v2.0-specific optional claims set") says `amr` is in v1.0 tokens but in a v2.0 ID token only when the app registration
 * asks for it (Token configuration → optional claim `amr`, token type ID); `mfa` is in it "only when the user has completed
 * MFA". So: true only when the verified ID token's `amr` is a list of strings that holds exactly "mfa". No amr, another
 * shape or no "mfa" (a password only, Windows integrated sign-in) is false, and Workflow asks for its own code as before.
 * The claims come only from the ID token openid-client has verified (signature, issuer, audience, expiry, nonce).
 */
export function microsoftMfaAsserted(claims: MicrosoftClaims | null | undefined) {
  const amr = claims?.amr;
  return Array.isArray(amr) && amr.length <= 20 && amr.every((item) => typeof item === "string") && amr.includes("mfa");
}

/** Whether a Microsoft sign-in's own multi-factor stands for Workflow's second step: the switch on and Microsoft's word in the token. */
export const microsoftMfaCounts = (claims: MicrosoftClaims | null | undefined, settingOn: boolean) => settingOn && microsoftMfaAsserted(claims);

/**
 * What a Microsoft sign-in needs as its second step (after the account, tenant, active and company-lock checks have passed):
 * "code" – Workflow's own code first (two-step on, no usable word from Microsoft); "mfa" – Microsoft's multi-factor stood
 * for it (session method "microsoft+mfa", which also meets a superadmin's or a company's requirement); "none" – no code
 * asked (two-step off and no MFA word, or the code was already right). After Workflow's code the claims are the signed
 * cookie's copy and amr is never read.
 */
export function microsoftSecondStep(input: { codeVerified: boolean; twoFactorOn: boolean; settingOn: boolean; claims: MicrosoftClaims | null | undefined }): "code" | "mfa" | "none" {
  if (input.codeVerified) return "none";
  if (microsoftMfaCounts(input.claims, input.settingOn)) return "mfa";
  return input.twoFactorOn ? "code" : "none";
}

/** The sign-in method (UserSession, security log) of a Microsoft sign-in whose multi-factor stood for the second step. */
export const MICROSOFT_MFA_METHOD = "microsoft+mfa";
export type MicrosoftIdentity = { tid: string; oid: string; providerAccountId: string; label: string; name: string };

/**
 * The stable identity from the ID token's claims. `label` (email or preferred_username) is unverified and only ever shown
 * to the person as the linked account's name – it is never used to find or match an account.
 */
export function microsoftIdentity(claims: MicrosoftClaims | null | undefined): MicrosoftIdentity | null {
  const tid = typeof claims?.tid === "string" ? claims.tid.trim().toLowerCase() : "";
  const oid = typeof claims?.oid === "string" ? claims.oid.trim().toLowerCase() : "";
  if (!isGuid(tid) || !isGuid(oid)) return null;
  const label = [claims?.email, claims?.preferred_username].find((item): item is string => typeof item === "string" && item.trim().length > 0)?.trim().slice(0, 200) ?? "";
  const name = typeof claims?.name === "string" ? claims.name.trim().slice(0, 200) : "";
  return { tid, oid, providerAccountId: `${tid}:${oid}`, label, name };
}

/** Whether a directory may sign in under the installation's tenant setting (Microsoft checks it too; this is the floor). */
export function tenantAccepted(setting: string, tid: string) {
  if (setting === "common") return true;
  if (setting === "consumers") return tid === MICROSOFT_CONSUMER_TENANT;
  if (setting === "organizations") return tid !== MICROSOFT_CONSUMER_TENANT;
  return tid === setting;
}

/**
 * Företagets katalog: a company may lock Microsoft sign-in to its own directory. A person in several companies meets
 * the strictest: every lock among their active companies must be this directory.
 */
export function companyLocksAllow(locks: (string | null | undefined)[], tid: string) {
  return locks.every((lock) => !lock || lock === tid);
}
