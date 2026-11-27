import { readFileSync } from "node:fs";
import { checkServerIdentity, type ConnectionOptions } from "node:tls";

/**
 * Databasen på en egen server (2026-10-04): one DATABASE_URL in the familiar libpq form
 *   postgresql://user:pass@10.0.0.10:5432/workflow?schema=public&sslmode=verify-full&sslrootcert=/app/certs/ca.crt
 * turned into what each client actually honours, because they do not agree (tried against a TLS-only Postgres 16):
 *
 * - node-pg (Prisma's adapter in the app and the live-sync listener) checks the certificate against "localhost" when
 *   the host is an IP address, so verify-full to 10.0.0.10 never connects. It gets an explicit TLS setting with the
 *   CA and an identity check against the host in the URL.
 * - Prisma's CLI (migrate deploy at every start) ignores sslmode=verify-full and sslrootcert – it encrypts but accepts
 *   any certificate. It verifies CA and host only with its own form: sslmode=require&sslcert=<CA>&sslaccept=strict.
 *
 * Without sslmode=verify-full the URL is passed through unchanged (the database in the same compose network today).
 * Pure apart from reading the CA file, so prisma.config.ts can use it too.
 */
const TLS_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "sslaccept", "sslidentity", "sslpassword", "ssl", "uselibpqcompat"];

const verified = (url: URL) => url.searchParams.get("sslmode") === "verify-full";

function rootCertPath(url: URL) {
  const path = url.searchParams.get("sslrootcert");
  if (!path) throw new Error("DATABASE_URL has sslmode=verify-full but no sslrootcert (the CA file).");
  return path;
}

/** Connection settings for node-pg: never plain text and never an unchecked certificate when verify-full is asked. */
export function nodePgConfig(databaseUrl: string): { connectionString: string; ssl?: ConnectionOptions } {
  const url = new URL(databaseUrl);
  if (!verified(url)) return { connectionString: databaseUrl };
  const ca = readFileSync(rootCertPath(url), "utf8");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  for (const name of TLS_PARAMS) url.searchParams.delete(name);
  return {
    connectionString: url.toString(),
    ssl: { ca, rejectUnauthorized: true, checkServerIdentity: (_servername, certificate) => checkServerIdentity(host, certificate) },
  };
}

/** The same database for Prisma's CLI, in the form under which it verifies the CA and the host. */
export function prismaCliUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (!verified(url)) return databaseUrl;
  const ca = rootCertPath(url);
  for (const name of TLS_PARAMS) url.searchParams.delete(name);
  url.searchParams.set("sslmode", "require");
  url.searchParams.set("sslcert", ca);
  url.searchParams.set("sslaccept", "strict");
  return url.toString();
}

const PG_DURATION = /^\d{1,7}(ms|s|min|h)?$/;

/**
 * Migreringssäkerhet (2026-10-28): lock_timeout and statement_timeout for Prisma's CLI (migrate deploy), set
 * from MIGRATE_LOCK_TIMEOUT and MIGRATE_STATEMENT_TIMEOUT (e.g. "10s", "5min"). Prisma's schema engine does not read
 * PGOPTIONS, but it passes the URL parameter `options` on to Postgres in the startup message (checked 2026-10-28 with
 * Prisma 7.10 against a stub server: options="-c lock_timeout=10s -c statement_timeout=5min"), where it becomes the
 * session's setting for every migration. Without the variables the URL is unchanged; an invalid value is refused so a
 * typo never silently removes the limit. Existing `options` in the URL are kept in front.
 */
export function withMigrationTimeouts(databaseUrl: string, env: Record<string, string | undefined> = process.env) {
  const settings: string[] = [];
  for (const [name, setting] of [["MIGRATE_LOCK_TIMEOUT", "lock_timeout"], ["MIGRATE_STATEMENT_TIMEOUT", "statement_timeout"]] as const) {
    const value = env[name]?.trim();
    if (!value) continue;
    if (!PG_DURATION.test(value)) throw new Error(`${name} must be a duration like 10s or 5min.`);
    settings.push(`-c ${setting}=${value}`);
  }
  if (settings.length === 0) return databaseUrl;
  const url = new URL(databaseUrl);
  const existing = url.searchParams.get("options")?.trim();
  url.searchParams.set("options", [existing, ...settings].filter(Boolean).join(" "));
  return url.toString();
}
