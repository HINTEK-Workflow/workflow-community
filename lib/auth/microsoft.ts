import { UserRole } from "@prisma/client";
import type { OAuthConfig } from "next-auth/providers/oauth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { canAccessTest, mayAuthenticate } from "@/lib/auth/access";
import { resolveInitialOrganizationId } from "@/lib/auth/service";
import { centralSecret, saveCentralSecret, type CentralActor } from "@/lib/secrets/central-store";
import {
  clientIdLooksRight,
  companyLocksAllow,
  discoveryLooksRight,
  isGuid,
  MICROSOFT_PROVIDER,
  microsoftDiscoveryUrl,
  microsoftIdentity,
  normalizeTenant,
  tenantAccepted,
  type MicrosoftClaims,
  type MicrosoftError,
  type MicrosoftIdentity,
} from "@/lib/auth/microsoft-core";

/**
 * Inloggning med Microsoft (Entra ID, OIDC; 2026-10-09, built 2026-10-11). Off until configured: the app
 * registration's client id and secret and the tenant mode are entered under Installation → Servernycklar
 * (the secret sealed like the other server keys, never shown again), Kontrollera asks Microsoft's discovery document,
 * and the superadmin switches "Fortsätt med Microsoft" on under Inloggning. The button and the provider exist only
 * while all three hold. Nobody gets an account through Microsoft: a signed-in person links their Microsoft account
 * under Mina inställningar, and only a linked account signs in – matched on tid + oid, never on e-mail.
 */
// The client secret is a central key (lib/secrets/central-store.ts, 2026-10-25); microsoftSignIn keeps the rest. Within
// this module secretCipher is only a marker that a secret is in place – the raw JSON's old value is left as it is.
const CENTRAL_MARK = "central";

type Stored = {
  enabled?: boolean;
  clientId?: string;
  secretCipher?: string;
  tenant?: string;
  lastCheck?: { ok: boolean; message: string; at: string };
  updatedAt?: string;
  updatedBy?: string;
};

let cached: { at: number; value: Stored } | null = null;
async function rawStored(): Promise<Stored> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { microsoftSignIn: true } });
  return (row?.microsoftSignIn ?? {}) as Stored;
}
async function stored(fresh = false): Promise<Stored> {
  if (!fresh && cached && Date.now() - cached.at < 15_000) return cached.value;
  const [raw, secret] = await Promise.all([rawStored(), centralSecret("microsoft.clientSecret")]);
  const value: Stored = { ...raw, secretCipher: secret ? CENTRAL_MARK : undefined };
  cached = { at: Date.now(), value };
  return value;
}
const open = async () => centralSecret("microsoft.clientSecret");
async function save(next: Stored, secretChanged = false) {
  // The marker is never written; the old sealed value stays where it was until it is moved (or the secret changes).
  const raw = await rawStored();
  const json = { ...next, secretCipher: secretChanged ? undefined : raw.secretCipher } as object;
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { microsoftSignIn: json }, create: { id: "global", microsoftSignIn: json } });
  cached = null;
}

export const microsoftRedirectUri = () => `${new URL(env.APP_URL).origin}/api/auth/callback/${MICROSOFT_PROVIDER}`;

const configured = (value: Stored) => Boolean(value.clientId && value.secretCipher);
/** Shown to customers only when switched on, with keys in place and a passed check of exactly these keys. */
const ready = (value: Stored) => Boolean(value.enabled && configured(value) && value.lastCheck?.ok);

/** What the product owner sees. The client id is not secret (it is in every sign-in address); the secret never leaves. */
export async function microsoftView() {
  const value = await stored(true);
  return {
    enabled: Boolean(value.enabled), configured: configured(value), ready: ready(value),
    clientId: value.clientId ?? null, tenant: value.tenant ?? "common", lastCheck: value.lastCheck ?? null,
    redirectUri: microsoftRedirectUri(), updatedAt: value.updatedAt ?? null, updatedBy: value.updatedBy ?? null,
  };
}

export class MicrosoftSettingsError extends Error {}

export async function saveMicrosoftSettings(input: { clientId?: string | null; secret?: string | null; tenant?: string; enabled?: boolean }, actor: CentralActor) {
  const current = await stored(true);
  const next: Stored = { ...current, updatedAt: new Date().toISOString(), updatedBy: actor.label };
  if (input.clientId !== undefined) {
    const clientId = (input.clientId ?? "").trim().toLowerCase();
    if (clientId && !clientIdLooksRight(clientId)) throw new MicrosoftSettingsError("Klient-id:t ska vara ett GUID, till exempel 0a1b2c3d-…, från appregistreringens översikt.");
    next.clientId = clientId || undefined;
  }
  // The secret first (in the key vault too, where the installation has one): when that fails nothing of the save is kept.
  if (input.secret !== undefined) await saveCentralSecret("microsoft.clientSecret", input.secret?.trim() || null, actor);
  if (input.tenant !== undefined) {
    const tenant = normalizeTenant(input.tenant);
    if (!tenant) throw new MicrosoftSettingsError("Välj vilka konton som får logga in, eller ange katalogens id (ett GUID).");
    next.tenant = tenant;
  }
  if (input.enabled !== undefined) next.enabled = input.enabled;
  // Other keys or another tenant: the old check says nothing about them, so the button waits for a new one.
  if (input.clientId !== undefined || input.secret !== undefined || (input.tenant !== undefined && next.tenant !== current.tenant)) next.lastCheck = undefined;
  await save(next, input.secret !== undefined);
}

/**
 * Kontrollera: the shape of the client id, that a secret is there, Microsoft's discovery document for the tenant
 * setting, and – for a single directory, where it can be asked – that Microsoft accepts the id and secret.
 */
export async function checkMicrosoft(fetcher: typeof fetch = fetch) {
  const value = await stored(true);
  const tenant = value.tenant ?? "common";
  const at = new Date().toISOString();
  let result: { ok: boolean; message: string; at: string };
  const clientSecret = await open();
  if (!clientIdLooksRight(value.clientId)) result = { ok: false, message: "Klient-id saknas eller har fel form.", at };
  else if (!clientSecret) result = { ok: false, message: "Klienthemligheten saknas.", at };
  else {
    try {
      const response = await fetcher(microsoftDiscoveryUrl(tenant), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) result = { ok: false, message: response.status === 400 ? "Microsoft känner inte igen katalogen." : `Microsoft svarade ${response.status}.`, at };
      else {
        const discovery = discoveryLooksRight(await response.json(), tenant);
        result = { ...discovery, at };
        if (discovery.ok && isGuid(tenant)) {
          const token = await fetcher(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
            method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
            body: new URLSearchParams({ grant_type: "client_credentials", client_id: value.clientId!, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default" }),
            signal: AbortSignal.timeout(10_000),
          });
          // Only the outcome is kept; the token itself is thrown away unread.
          if (token.ok) result = { ok: true, message: "Microsoft godtar klient-id och hemlighet för katalogen.", at };
          else if (token.status === 401) result = { ok: false, message: "Microsoft godtar inte klienthemligheten. Den kan ha gått ut – skapa en ny i appregistreringen.", at };
          else result = { ok: false, message: "Microsoft godtar inte klient-id:t i den här katalogen.", at };
        }
      }
    } catch {
      result = { ok: false, message: "Microsofts inloggning svarade inte. Försök igen om en stund.", at };
    }
  }
  await save({ ...value, lastCheck: result });
  return result;
}

/** The provider's keys while sign-in is ready, else null (the route then never registers the provider). */
export async function microsoftSignInConfig() {
  const value = await stored();
  if (!ready(value)) return null;
  const clientSecret = await open();
  return clientSecret ? { clientId: value.clientId!, clientSecret, tenant: value.tenant ?? "common" } : null;
}
export const microsoftSignInReady = async () => Boolean(await microsoftSignInConfig());

/**
 * The NextAuth provider: authorization code with PKCE and state, the ID token's claims as the profile (no Graph call),
 * and the account id `tid:oid`. openid-client checks the ID token's signature, audience and issuer (for the
 * multi-directory modes with the token's own tid in Microsoft's issuer template).
 */
export function microsoftProvider(config: { clientId: string; clientSecret: string; tenant: string }): OAuthConfig<MicrosoftClaims & { sub?: string }> {
  return {
    id: MICROSOFT_PROVIDER,
    name: "Microsoft",
    type: "oauth",
    wellKnown: microsoftDiscoveryUrl(config.tenant),
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    authorization: { params: { scope: "openid profile email", prompt: "select_account" } },
    idToken: true,
    checks: ["pkce", "state"],
    // The secret in the form body: the method every Entra app registration accepts.
    client: { token_endpoint_auth_method: "client_secret_post" },
    profile(claims) {
      const identity = microsoftIdentity(claims);
      // Nothing here becomes the person: the jwt callback reads the Workflow account the id is linked to (role included).
      return { id: identity?.providerAccountId ?? "", name: identity?.name || null, email: null, image: null, role: UserRole.STAFF };
    },
  };
}

/** The directories the person's active companies have locked Microsoft sign-in to. */
async function companyLocks(userId: string) {
  // A paused company is still read by its people (beslut 11, 2026-11-01), so its lock still holds.
  const memberships = await prisma.organizationMember.findMany({ where: { userId, isActive: true }, select: { organizationId: true } });
  if (!memberships.length) return [];
  const rows = await prisma.workspaceSettings.findMany({ where: { organizationId: { in: memberships.map((item) => item.organizationId) }, microsoftTenantId: { not: null } }, select: { microsoftTenantId: true } });
  return rows.map((row) => row.microsoftTenantId);
}

type Outcome = { ok: true; userId: string } | { ok: false; error: MicrosoftError | "test_access" };

/** A Microsoft sign-in: only an account linked by tid + oid, allowed by "Vem får logga in", active, within any company lock. */
export async function microsoftSignIn(claims: MicrosoftClaims | undefined): Promise<Outcome> {
  const config = await microsoftSignInConfig();
  if (!config) return { ok: false, error: "microsoft_disabled" };
  const identity = microsoftIdentity(claims);
  if (!identity) return { ok: false, error: "microsoft_identity" };
  if (!tenantAccepted(config.tenant, identity.tid)) return { ok: false, error: "microsoft_tenant" };
  const linked = await prisma.authAccount.findUnique({
    where: { provider_providerAccountId: { provider: MICROSOFT_PROVIDER, providerAccountId: identity.providerAccountId } },
    select: { id: true, user: { select: { id: true, email: true, isActive: true, activeOrganizationId: true, organizationMemberships: { where: { isActive: true }, orderBy: [{ organization: { isActive: "desc" } }, { createdAt: "asc" }], select: { organizationId: true }, take: 1 } } } },
  });
  if (!linked) return { ok: false, error: "microsoft_not_linked" };
  if (!mayAuthenticate(linked.user.email)) return { ok: false, error: "test_access" };
  if (!linked.user.isActive) return { ok: false, error: "microsoft_account_disabled" };
  if (!companyLocksAllow(await companyLocks(linked.user.id), identity.tid)) return { ok: false, error: "microsoft_tenant_locked" };
  const now = new Date();
  await prisma.$transaction([
    prisma.authAccount.update({ where: { id: linked.id }, data: { email: identity.label || null, lastUsedAt: now } }),
    prisma.user.update({ where: { id: linked.user.id }, data: { lastLoginAt: now, activeOrganizationId: resolveInitialOrganizationId(linked.user) } }),
  ]);
  return { ok: true, userId: linked.user.id };
}

/** Koppla Microsoft-konto: from the person's own signed intent only; never an account that belongs to someone else. */
export async function linkMicrosoftAccount(userId: string, claims: MicrosoftClaims | undefined): Promise<Outcome & { identity?: MicrosoftIdentity }> {
  const config = await microsoftSignInConfig();
  if (!config) return { ok: false, error: "microsoft_disabled" };
  const identity = microsoftIdentity(claims);
  if (!identity) return { ok: false, error: "microsoft_identity" };
  if (!tenantAccepted(config.tenant, identity.tid)) return { ok: false, error: "microsoft_tenant" };
  return linkMicrosoftIdentity(userId, identity);
}

/** The database part of linking, apart from the provider's settings (tested on its own). */
export async function linkMicrosoftIdentity(userId: string, identity: MicrosoftIdentity): Promise<Outcome & { identity?: MicrosoftIdentity }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isActive: true } });
  if (!canAccessTest(user)) return { ok: false, error: "test_access" };
  if (!companyLocksAllow(await companyLocks(userId), identity.tid)) return { ok: false, error: "microsoft_tenant_locked" };
  const where = { provider_providerAccountId: { provider: MICROSOFT_PROVIDER, providerAccountId: identity.providerAccountId } };
  const existing = await prisma.authAccount.findUnique({ where, select: { userId: true } });
  if (existing && existing.userId !== userId) return { ok: false, error: "microsoft_linked_elsewhere" };
  if (!existing) {
    try {
      await prisma.authAccount.create({ data: { userId, provider: MICROSOFT_PROVIDER, providerAccountId: identity.providerAccountId, email: identity.label || null, hostedDomain: identity.tid, lastUsedAt: new Date() } });
    } catch {
      // Linked by someone else at the same moment: the unique key decides.
      const winner = await prisma.authAccount.findUnique({ where, select: { userId: true } });
      if (winner?.userId !== userId) return { ok: false, error: "microsoft_linked_elsewhere" };
    }
  }
  return { ok: true, userId, identity };
}
