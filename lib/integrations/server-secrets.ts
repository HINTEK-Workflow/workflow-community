import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { centralFieldInfo, centralSecret, saveCentralSecret, type CentralActor } from "@/lib/secrets/central-store";
import type { CentralField } from "@/lib/secrets/central-fields";
import {
  googleCredentialsFrom,
  parseStoredServerKeys,
  resolveServerSecrets,
  serverSecretProblem,
  serverSetting,
  serverSettingProblem,
  SERVER_SECRET_FIELDS,
  withServerSetting,
  type ServerSettingField,
  type ResolvedServerSecrets,
  type ServerSecretField,
  type StoredServerKeys,
} from "@/lib/integrations/server-secret-values";
import { SOLAR_COUNTRY } from "@/lib/integrations/solar";

/**
 * Servernycklar i appen (2026-10-09): the Stripe, Google and Solar keys, read where they are needed – the app's
 * value first, the environment as fallback (see server-secret-values.ts for the order and for what stays in the
 * environment). Since 2026-10-25 the app's value is a central key (lib/secrets/central-store.ts: sealed with the key ring,
 * kept in the installation's key vault where it has one, with the sealed copy here); SystemSettings.serverKeys keeps the settings beside them
 * (Solar's catalogue number, country code, API switch) and, until moved, the values sealed before that day.
 * Read for a short time from memory and cleared on save, so a saved key applies at once in this process.
 */
export const SERVER_SECRET_CENTRAL: Record<ServerSecretField, CentralField> = {
  stripeSecretKey: "stripe.secretKey", stripeWebhookSecret: "stripe.webhookSecret",
  googleClientId: "google.clientId", googleClientSecret: "google.clientSecret",
  solarClientId: "solar.clientId", solarClientSecret: "solar.clientSecret",
};
const CACHE_MS = 30_000;
let cached: { at: number; value: ResolvedServerSecrets } | null = null;

export class ServerSecretError extends Error {}

export async function storedServerKeys(): Promise<StoredServerKeys> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { serverKeys: true } });
  return parseStoredServerKeys(row?.serverKeys);
}

/** Every key's value and source. Server-side only: the values never leave the server. */
export async function serverSecrets(): Promise<ResolvedServerSecrets> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const opened = new Map<string, string>();
  // The resolver (pure, server-secret-values.ts) gets a marker per field instead of a cipher; the values stay here.
  const value = resolveServerSecrets(await appServerKeys(opened), env, (marker) => opened.get(marker) ?? "");
  cached = { at: Date.now(), value };
  return value;
}

/**
 * The stored keys as the resolver reads them: the settings from serverKeys, and per key the central value (marked),
 * "removed" when the bin was used, or nothing – then the environment applies.
 */
async function appServerKeys(opened = new Map<string, string>()): Promise<StoredServerKeys> {
  const stored = await storedServerKeys();
  const view: StoredServerKeys = { ...stored };
  for (const field of SERVER_SECRET_FIELDS) {
    const [value, info] = await Promise.all([centralSecret(SERVER_SECRET_CENTRAL[field]), centralFieldInfo(SERVER_SECRET_CENTRAL[field])]);
    const stamp = { updatedAt: info.updatedAt ?? stored[field]?.updatedAt, updatedBy: info.updatedBy ?? stored[field]?.updatedBy };
    if (value) { opened.set(`central:${field}`, value); view[field] = { cipher: `central:${field}`, ...stamp }; }
    else if (info.removed || (info.storage === null && !info.unreadable && stored[field]?.removed)) view[field] = { removed: true, ...stamp };
    else view[field] = stamp.updatedAt ? stamp : undefined;
  }
  return view;
}

/** The stored keys with each key's latest change (for "a check made before the latest change no longer counts"). */
export const serverKeysWithChanges = () => appServerKeys();

export const clearServerSecretsCache = () => { cached = null; };

/** Google's client id and secret when both are in place, otherwise null. */
export async function googleCredentials() {
  return googleCredentialsFrom(await serverSecrets());
}

/** Enters (a value) or removes (null) one key. A value of the wrong shape is refused before anything is stored. */
export async function saveServerSecret(field: ServerSecretField, value: string | null, actor: CentralActor) {
  if (value !== null) {
    const problem = serverSecretProblem(field, value);
    if (problem) throw new ServerSecretError(problem);
  }
  await saveCentralSecret(SERVER_SECRET_CENTRAL[field], value, actor);
  clearServerSecretsCache();
}

/** Enters (a value) or removes (null) a product-owner setting beside the keys (Solar's catalogId, 2026-10-14). */
export async function saveServerSetting(field: ServerSettingField, value: string | null, actor: string) {
  if (value !== null) {
    const problem = serverSettingProblem(field, value);
    if (problem) throw new ServerSecretError(problem);
  }
  const next = withServerSetting(await storedServerKeys(), field, value, actor);
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { serverKeys: next }, create: { id: "global", serverKeys: next } });
  clearServerSecretsCache();
}

/**
 * Solar's catalogue as the article search uses it (2026-10-14): Workflow's one client and the Swedish catalogue's number,
 * or why it cannot be used – the key is missing, or the catalogue number is not entered (never guessed).
 */
export async function solarCatalogue(): Promise<{ ok: true; clientId: string; clientSecret: string; catalogId: string; countryCode: string } | { ok: false; reason: "no-key" | "no-catalog" }> {
  const solar = await solarCredentials();
  if (!solar.ok) return solar;
  const catalogId = serverSetting(await storedServerKeys(), "solarCatalogId");
  if (!catalogId) return { ok: false, reason: "no-catalog" };
  return { ...solar, catalogId };
}

/**
 * Workflow's Solar client and the country code the latest check found ("" when none has yet), for the calls that need no
 * catalogue number – the categories (2026-10-15).
 */
export async function solarCredentials(): Promise<{ ok: true; clientId: string; clientSecret: string; countryCode: string; countryVerified: boolean } | { ok: false; reason: "no-key" }> {
  const [secrets, stored] = await Promise.all([serverSecrets(), storedServerKeys()]);
  const clientId = secrets.solarClientId.value;
  const clientSecret = secrets.solarClientSecret.value;
  if (!clientId || !clientSecret) return { ok: false, reason: "no-key" };
  const verified = serverSetting(stored, "solarCountryCode");
  return { ok: true, clientId, clientSecret, countryCode: verified || SOLAR_COUNTRY, countryVerified: Boolean(verified) };
}
