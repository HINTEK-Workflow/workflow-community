import { env } from "@/lib/env";
import { isTrustedProxy, normalizeIp, proxyTrustFrom, type ProxyTrust } from "./proxy-trust";

/** The caller's address when it cannot be known; callers skip or share the per-IP limit for it. */
export const UNKNOWN_CLIENT_IP = "local";

/** Only the right-most entries can matter; a header padded with thousands of entries is not walked further. */
const MAX_FORWARDED_ENTRIES = 32;

let installationTrust: ProxyTrust | null = null;
function defaultTrust() {
  installationTrust ??= proxyTrustFrom(env);
  return installationTrust;
}

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderSource, name: string) {
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const value = headers[name] ?? headers[name.toLowerCase()];
  // Repeated headers keep their order, as Headers.get joins them.
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

/**
 * The caller's IP address behind the installation's reverse proxy (security review 2026-10-04, proxy trust 2026-10-08).
 * The only place the app reads X-Forwarded-For / X-Real-IP; every rate limit goes through here.
 *
 * - No trusted proxy (development and test by default): forwarded headers are ignored and the caller is "local".
 * - TRUSTED_PROXY_HOPS = n (production default 1, nginx): each trusted proxy appends the address it saw, so the n-th
 *   entry from the right is the one the nearest outside proxy vouches for; anything further left was sent by the caller
 *   and is never used. With fewer entries than hops the left-most one is used (every entry came from a proxy).
 * - TRUSTED_PROXIES = CIDR list: entries are walked from the right, skipping trusted proxy addresses; the first other
 *   address is the caller.
 * - X-Real-IP is used only when a proxy is trusted and there is no X-Forwarded-For.
 * - A malformed entry where the caller's address should be gives "local", never a guess further left.
 *
 * Next.js does not expose the socket address, so the app must be reachable only through the proxy (127.0.0.1:3000).
 */
export function clientIp(headers: HeaderSource, trust: ProxyTrust = defaultTrust()): string {
  if (trust.hops <= 0 && !trust.proxies) return UNKNOWN_CLIENT_IP;
  const forwarded = headerValue(headers, "x-forwarded-for").split(",").map((part) => part.trim()).filter(Boolean).slice(-MAX_FORWARDED_ENTRIES);
  if (!forwarded.length) return normalizeIp(headerValue(headers, "x-real-ip")) ?? UNKNOWN_CLIENT_IP;

  if (trust.proxies) {
    for (let index = forwarded.length - 1; index >= 0; index -= 1) {
      const address = normalizeIp(forwarded[index]);
      if (!address) return UNKNOWN_CLIENT_IP;
      if (index === 0 || !isTrustedProxy(trust, address)) return address;
    }
    return UNKNOWN_CLIENT_IP;
  }

  const index = Math.max(0, forwarded.length - trust.hops);
  return normalizeIp(forwarded[index]) ?? UNKNOWN_CLIENT_IP;
}
