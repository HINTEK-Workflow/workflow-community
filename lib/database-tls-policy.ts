// The rule for where the database may be reached without verified TLS (2026-10-04). Pure, so lib/env.ts can use it
// without pulling node:fs or node:tls; the URL handling itself is in lib/database-url.ts.
const verified = (url: URL) => url.searchParams.get("sslmode") === "verify-full";

const SAME_HOST = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/**
 * A database on another machine must be reached with verified TLS. A host without a dot or colon is a name in the
 * same compose network (today's "postgres") or this machine, and is left as it is.
 */
export function databaseTlsProblem(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const host = url.hostname;
  if (SAME_HOST.has(host) || !/[.:]/.test(host)) return null;
  if (!verified(url)) return "A database on another machine must use sslmode=verify-full (never plain text or an unchecked certificate).";
  if (!url.searchParams.get("sslrootcert")) return "sslmode=verify-full needs sslrootcert, the path to the database server's CA certificate.";
  return null;
}
