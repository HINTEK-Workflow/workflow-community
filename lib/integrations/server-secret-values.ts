import { z } from "zod";
import { stripeKeyMode } from "@/lib/integrations/server-keys";
import { SOLAR_COUNTRY_CANDIDATES, isSolarCountryCode } from "@/lib/integrations/solar";

/**
 * Servernycklar i appen (2026-10-09, after the Stripe keys disappeared with the app server's .env): the Stripe
 * and Google keys are entered under Installation → Servernycklar and kept sealed (AES-256-GCM, the same
 * sealing as the other stored keys) in SystemSettings.serverKeys – on the database server, apart from the app server.
 * Resolution order everywhere a key is read: the app's stored value first, the environment variable as fallback, so an
 * installation that only has .env (a Community install, or production before anything is saved) works as before.
 *
 * What deliberately stays in the environment and is never stored here:
 * - AUTH_SECRET and INTEGRATION_KEYS_SECRET: they seal these values. The master secret must never lie next to what it
 *   encrypts – a copy of the database alone must not be enough to open the keys.
 * - DATABASE_URL: the app needs it to reach the database where these values live.
 * - The switches (STRIPE_LIVE_ENABLED, STRIPE_SANDBOX_ENABLED, STRIPE_CHECKOUT_ENABLED, STRIPE_PORTAL_ENABLED,
 *   STRIPE_CARD_RETRY_ENABLED …): per-server safety gates checked at start, so a database row can never turn on live
 *   payments on a server that was not set up for them.
 *
 * Pure: takes the stored JSON, the environment and the opening function as arguments; never returns a value to a page.
 */
// Solar (2026-10-13 natt): Workflow's client at Solar's API, read only (lib/integrations/solar.ts).
export const SERVER_SECRET_FIELDS = ["stripeSecretKey", "stripeWebhookSecret", "googleClientId", "googleClientSecret", "solarClientId", "solarClientSecret"] as const;
export type ServerSecretField = (typeof SERVER_SECRET_FIELDS)[number];

export type ServerSecretEnv = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SOLAR_CLIENT_ID?: string;
  SOLAR_CLIENT_SECRET?: string;
};

export const SERVER_SECRET_ENV: Record<ServerSecretField, keyof ServerSecretEnv> = {
  stripeSecretKey: "STRIPE_SECRET_KEY",
  stripeWebhookSecret: "STRIPE_WEBHOOK_SECRET",
  googleClientId: "GOOGLE_CLIENT_ID",
  googleClientSecret: "GOOGLE_CLIENT_SECRET",
  solarClientId: "SOLAR_CLIENT_ID",
  solarClientSecret: "SOLAR_CLIENT_SECRET",
};

/** The field's name on the page and in the administration history. */
export const SERVER_SECRET_LABELS: Record<ServerSecretField, string> = {
  stripeSecretKey: "Stripe – hemlig nyckel",
  stripeWebhookSecret: "Stripe – webhookhemlighet",
  googleClientId: "Google – klient-id",
  googleClientSecret: "Google – klienthemlighet",
  solarClientId: "Solar – klient-id",
  solarClientSecret: "Solar – klienthemlighet",
};

/** The status row on Servernycklar each field belongs to. */
export type ServerSecretRow = "stripe_secret" | "stripe_webhook" | "google" | "solar";
export const SERVER_SECRET_ROW: Record<ServerSecretField, ServerSecretRow> = {
  stripeSecretKey: "stripe_secret",
  stripeWebhookSecret: "stripe_webhook",
  googleClientId: "google",
  googleClientSecret: "google",
  solarClientId: "solar",
  solarClientSecret: "solar",
};

const GOOGLE_FIELDS = ["googleClientId", "googleClientSecret"] as const;

const storedEntry = z.object({
  /** The sealed value. */
  cipher: z.string().max(4000).optional(),
  /** The bin was used: no value at all, not even the environment's (secrets-fields-simple). */
  removed: z.boolean().optional(),
  updatedAt: z.string().max(40).optional(),
  updatedBy: z.string().max(200).optional(),
});
/**
 * Solars katalognummer (2026-10-14): the catalogId of Solar's Swedish catalogue, a product-owner setting beside
 * the Solar key. Not a secret – stored as it is – and never guessed: until it is entered the catalogue lookup says
 * "inte inställt" and asks Solar nothing.
 * Solars landskod (2026-10-15): the `countrycode` Solar accepted at the latest Kontrollera (SE, se or sv), kept here so
 * the article search and the category fetch use it; SE until a check has found one.
 */
const storedSetting = z.object({ value: z.string().max(140), updatedAt: z.string().max(40).optional(), updatedBy: z.string().max(200).optional() });
// githubIssuesRepo (Rapportera fel eller förslag, 2026-11-13): owner/repo of the private issue repository, used by ee/ only.
export const SERVER_SETTING_FIELDS = ["solarCatalogId", "solarCountryCode", "solarApiEnabled", "githubIssuesRepo"] as const;
export type ServerSettingField = (typeof SERVER_SETTING_FIELDS)[number];
export const SERVER_SETTING_LABELS: Record<ServerSettingField, string> = { solarCatalogId: "Solars katalognummer (catalogId)", solarCountryCode: "Solars landskod (countrycode)", solarApiEnabled: "Solars API-anslutning", githubIssuesRepo: "Repo för ärenden" };

export const storedServerKeysSchema = z.object({
  stripeSecretKey: storedEntry.optional(),
  stripeWebhookSecret: storedEntry.optional(),
  googleClientId: storedEntry.optional(),
  googleClientSecret: storedEntry.optional(),
  solarClientId: storedEntry.optional(),
  solarClientSecret: storedEntry.optional(),
  solarCatalogId: storedSetting.optional(),
  solarCountryCode: storedSetting.optional(),
  /** API-anslutning aktiv (2026-10-17): "on" lets the register import Solar's catalogue; anything else blocks every API import. */
  solarApiEnabled: storedSetting.optional(),
  githubIssuesRepo: storedSetting.optional(),
});
export type StoredServerKeys = z.infer<typeof storedServerKeysSchema>;

export const parseStoredServerKeys = (value: unknown): StoredServerKeys => {
  const parsed = storedServerKeysSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

/** "app" = entered under Servernycklar, "server" = from the server's environment, null = none. */
export type ServerSecretSource = "app" | "server" | null;
export type ResolvedServerSecret = { value: string; source: ServerSecretSource };
export type ResolvedServerSecrets = Record<ServerSecretField, ResolvedServerSecret>;

const NONE: ResolvedServerSecret = { value: "", source: null };

/**
 * The values that apply: the app's where saved, otherwise the environment's – unless the bin removed it. A sealed
 * value that can no longer be opened (the master secret changed) counts as not saved, so the environment's still
 * applies. Google's client id and secret are one pair: once either is entered or removed in the app, both come from
 * the app, so an id from one place is never paired with a secret from the other.
 */
export function resolveServerSecrets(stored: StoredServerKeys, env: ServerSecretEnv, open: (cipher: string) => string): ResolvedServerSecrets {
  const fromApp = (field: ServerSecretField): ResolvedServerSecret | null => {
    const cipher = stored[field]?.cipher;
    const value = cipher ? open(cipher).trim() : "";
    return value ? { value, source: "app" } : null;
  };
  const fromEnv = (field: ServerSecretField): ResolvedServerSecret => {
    const value = env[SERVER_SECRET_ENV[field]]?.trim() ?? "";
    return value ? { value, source: "server" } : NONE;
  };
  const single = (field: ServerSecretField) => fromApp(field) ?? (stored[field]?.removed ? NONE : fromEnv(field));
  const googleInApp = GOOGLE_FIELDS.some((field) => stored[field]?.cipher || stored[field]?.removed);
  const google = (field: ServerSecretField) => (googleInApp ? fromApp(field) ?? NONE : fromEnv(field));
  const solarInApp = (["solarClientId", "solarClientSecret"] as const).some((field) => stored[field]?.cipher || stored[field]?.removed);
  const solar = (field: ServerSecretField) => (solarInApp ? fromApp(field) ?? NONE : fromEnv(field));
  return {
    stripeSecretKey: single("stripeSecretKey"),
    stripeWebhookSecret: single("stripeWebhookSecret"),
    googleClientId: google("googleClientId"),
    googleClientSecret: google("googleClientSecret"),
    // Solar's pair follows the same rule as Google's: both from the app once either is entered there.
    solarClientId: solar("solarClientId"),
    solarClientSecret: solar("solarClientSecret"),
  };
}

/** The resolved values in the environment's names, for the status rows (serverKeyStatuses). */
export function resolvedAsEnv(resolved: ResolvedServerSecrets): ServerSecretEnv {
  const value = (field: ServerSecretField) => resolved[field].value || undefined;
  return {
    STRIPE_SECRET_KEY: value("stripeSecretKey"),
    STRIPE_WEBHOOK_SECRET: value("stripeWebhookSecret"),
    GOOGLE_CLIENT_ID: value("googleClientId"),
    GOOGLE_CLIENT_SECRET: value("googleClientSecret"),
    SOLAR_CLIENT_ID: value("solarClientId"),
    SOLAR_CLIENT_SECRET: value("solarClientSecret"),
  };
}

/** Google's pair when both are in place, otherwise null (the button is not offered and no provider is registered). */
export function googleCredentialsFrom(resolved: ResolvedServerSecrets) {
  const clientId = resolved.googleClientId.value;
  const clientSecret = resolved.googleClientSecret.value;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Why a typed value is refused, or null when it has the shape the service uses. Never repeats the value. */
export function serverSecretProblem(field: ServerSecretField, raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Klistra in hela värdet.";
  if (/\s/.test(value)) return "Värdet får inte innehålla mellanslag eller radbrytningar.";
  switch (field) {
    case "stripeSecretKey":
      return stripeKeyMode(value) ? null : "Det ser inte ut som Stripes hemliga nyckel (den börjar med sk_ eller rk_).";
    case "stripeWebhookSecret":
      return /^whsec_[A-Za-z0-9]{16,}$/.test(value) ? null : "Det ser inte ut som en webhookhemlighet från Stripe (den börjar med whsec_).";
    case "googleClientId":
      return /^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/.test(value) ? null : "Det ser inte ut som ett klient-id från Google (det slutar med .apps.googleusercontent.com).";
    case "googleClientSecret":
      return value.length >= 10 && value.length <= 200 ? null : "Det ser inte ut som en klienthemlighet från Google.";
    case "solarClientId":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? null : "Det ser inte ut som ett klient-id från Solar (ett id med 36 tecken och bindestreck).";
    case "solarClientSecret":
      return value.length >= 10 && value.length <= 200 ? null : "Det ser inte ut som en klienthemlighet från Solar.";
  }
}

/** The stored JSON after a field is entered (a value) or removed with the bin (null). */
export function withServerSecret(
  stored: StoredServerKeys,
  field: ServerSecretField,
  value: string | null,
  seal: (value: string) => string,
  actor: string,
  now = new Date(),
): StoredServerKeys {
  const stamp = { updatedAt: now.toISOString(), updatedBy: actor.slice(0, 200) };
  return { ...stored, [field]: value ? { cipher: seal(value.trim()), ...stamp } : { removed: true, ...stamp } };
}

/** When a row's value last changed in the app, so a check made before it no longer counts. */
export function lastChange(stored: StoredServerKeys, row: ServerSecretRow): string | null {
  const times = SERVER_SECRET_FIELDS.filter((field) => SERVER_SECRET_ROW[field] === row)
    .map((field) => stored[field]?.updatedAt).filter((value): value is string => Boolean(value)).sort();
  return times.at(-1) ?? null;
}

/** owner/repo as GitHub allows them: an owner of at most 39 characters, a name of at most 100. */
export const GITHUB_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** Why a typed setting is refused, or null. Solar's catalogId is a whole number; the country code one of the candidates. */
export function serverSettingProblem(field: ServerSettingField, raw: string): string | null {
  const value = raw.trim();
  if (field === "solarCatalogId") return /^\d{1,9}$/.test(value) ? null : "Katalognumret är ett heltal (det nummer Solar har gett för den svenska katalogen).";
  if (field === "solarCountryCode") return isSolarCountryCode(value) ? null : `Landskoden är en av ${SOLAR_COUNTRY_CANDIDATES.join(", ")}.`;
  if (field === "solarApiEnabled") return value === "on" || value === "off" ? null : "API-anslutningen är på eller av.";
  if (field === "githubIssuesRepo") return GITHUB_REPO.test(value) ? null : "Skriv repot som ägare/namn, till exempel organisation/arenden.";
  return null;
}

/** The stored JSON after a setting is entered (a value) or removed (null). */
export function withServerSetting(stored: StoredServerKeys, field: ServerSettingField, value: string | null, actor: string, now = new Date()): StoredServerKeys {
  const next = { ...stored };
  if (value === null) delete next[field];
  else next[field] = { value: value.trim(), updatedAt: now.toISOString(), updatedBy: actor.slice(0, 200) };
  return next;
}

/** A setting's value, "" when none. */
export const serverSetting = (stored: StoredServerKeys, field: ServerSettingField) => stored[field]?.value?.trim() ?? "";
