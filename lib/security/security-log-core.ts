import { createHmac, hkdfSync } from "node:crypto";

/**
 * Säkerhetslogg (2026-10-10), the parts without a database: event types and their Swedish names, the keyed hash of an
 * IP address, the coarse browser text and the retention time. Data minimisation: no password, code, token, key value,
 * error text or full user agent is ever written; `detail` only carries fixed words from the code (never free text).
 */
export const SECURITY_EVENT_TYPES = {
  login_ok: "Inloggning",
  login_failed: "Misslyckad inloggning",
  two_factor_failed: "Fel kod vid inloggning",
  rate_limited: "För många försök",
  backup_code_used: "Reservkod använd",
  two_factor_on: "Tvåstegsverifiering påslagen",
  two_factor_off: "Tvåstegsverifiering avstängd",
  backup_codes_renewed: "Nya reservkoder",
  password_changed: "Lösenordet bytt",
  session_revoked: "Inloggning avslutad",
  sessions_revoked_all: "Utloggad överallt",
  api_key_created: "Nyckel skapad",
  api_key_revoked: "Nyckel återkallad",
  two_factor_policy: "Krav på tvåstegsverifiering ändrat",
  // Passkeys och Microsoft (2026-10-11).
  passkey_added: "Passkey tillagd",
  passkey_removed: "Passkey borttagen",
  microsoft_linked: "Microsoft-konto kopplat",
  microsoft_unlinked: "Microsoft-konto bortkopplat",
  microsoft_tenant_policy: "Microsoft-inloggning låst till katalog ändrat",
  // Centrala nycklar (2026-10-25, lib/secrets/central-store.ts): the field's name in detail, never a value.
  central_key_saved: "Central nyckel sparad",
  central_key_removed: "Central nyckel borttagen",
  central_keys_moved: "Centrala nycklar kopierade till nyckelvalvet",
  central_key_changed_outside: "Central nyckel ändrad utanför Workflow",
  // Hybriden (2026-10-26): a key restored from the vault on a person's request.
  central_key_restored: "Central nyckel återställd från nyckelvalvet",
  central_key_removed_outside: "Central nyckel borttagen i nyckelvalvet",
  central_store_conflict: "Motstridiga versioner av en central nyckel",
  // Kontrollera och synka (2026-11-01): counts and field names in detail, never a value.
  central_sync_run: "Centrala nycklar kontrollerade och synkade",
  // Exportera till nyckelvalvet (2026-11-22, ee/): the count in detail, never a value.
  central_keys_exported: "Centrala nycklar exporterade till fil",
  // Serverns nycklar till nyckelvalvet (2026-11-22, ee/, kommandoraden i appens container): counts only, never a value.
  server_keys_exported: "Serverns nycklar exporterade från kommandoraden",
  // Läs in centrala nycklar från fil (2026-11-26, ee/): the count in detail, never a value.
  central_keys_imported: "Centrala nycklar inlästa från fil",
  // Företagets nycklar som fil (2026-11-26, the company's admin): the count in detail, never a value.
  company_keys_exported: "Företagets nycklar exporterade till fil",
  company_keys_imported: "Företagets nycklar inlästa från fil",
  // Kalenderlänken (PL14, 2026-11-01): the person's own link; never the address.
  calendar_link_created: "Kalenderlänk skapad",
  calendar_link_removed: "Kalenderlänk borttagen",
  // Operatörskonton (2026-10-30, lib/operator): company events; the account in detail as fixed words, never a password.
  operator_login_ok: "Operatör inloggad",
  operator_login_failed: "Misslyckad operatörsinloggning",
  operator_locked: "Operatörskonto spärrat en stund (för många försök)",
  // Behörighetsstyrning (K2, 2026-11-28): company events; the length or a count in detail, never what was read.
  support_access_granted: "Supportåtkomst given",
  support_access_revoked: "Supportåtkomst återkallad",
  support_access_expired: "Supportåtkomst har gått ut",
  support_access_used: "Supporten läste företagets uppgifter",
  access_review_signed: "Behörigheter granskade",
  access_review_reminder: "Påminnelse om granskning ändrad",
} as const;
export type SecurityEventType = keyof typeof SECURITY_EVENT_TYPES;
export const isSecurityEventType = (value: string): value is SecurityEventType => value in SECURITY_EVENT_TYPES;

/**
 * A person's events without a company are kept 12 months, then removed by the nightly system cleanup (history:retention).
 * A company's events follow the company's log retention since 2026-11-27 (lib/traceability/log-retention.ts).
 */
export const SECURITY_LOG_MONTHS = 12;

export function securityLogCutoff(now = new Date(), months = SECURITY_LOG_MONTHS) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}

const ipKey = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "hintek-workflow", "security-log-ip-v1", 32));

/**
 * The IP address as a keyed HMAC: the same address gives the same value within a calendar year (so repeated tries from
 * one place can be seen), a new year gives new values. This is pseudonymisation, not anonymisation – whoever has the
 * installation's secret can test an address against it – so it is treated as personal data. "local" (no proxy) is null.
 */
export function ipHash(ip: string, secret: string, now = new Date()) {
  const value = ip.trim().toLowerCase();
  if (!value || value === "local") return null;
  return createHmac("sha256", ipKey(secret)).update(`${now.getUTCFullYear()}:${value}`).digest("base64url").slice(0, 22);
}

/** Browser family and platform only, e.g. "Chrome på Windows" – never the full user agent. */
export function coarseClient(userAgent: string | null | undefined) {
  const ua = userAgent ?? "";
  if (!ua) return "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /SamsungBrowser\//.test(ua) ? "Samsung Internet" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const platform = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "";
  if (browser && platform) return `${browser} på ${platform}`;
  return browser || platform || "Annan klient";
}

