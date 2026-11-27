import { BlockList, isIP } from "node:net";

/**
 * Which forwarded headers the app may believe (proxy trust, 2026-10-08). Pure parsing only, so that lib/env.ts can
 * validate the settings without importing the request helper. See lib/security/client-ip.ts for how it is used.
 */

export type ProxyTrust = {
  /** Number of reverse proxies in front of the app that each append to X-Forwarded-For (nginx = 1). 0 = trust none. */
  hops: number;
  /** Addresses/ranges of trusted proxies; when set it replaces `hops` and the right-most untrusted entry is used. */
  proxies: BlockList | null;
};

export const NO_PROXY_TRUST: ProxyTrust = { hops: 0, proxies: null };

const MAX_ENTRY_LENGTH = 64;

/**
 * One X-Forwarded-For / X-Real-IP entry as a bare address, or null when it is not an IP address. Accepts the forms
 * proxies write: "203.0.113.9", "203.0.113.9:4711", "2001:db8::1", "[2001:db8::1]:4711", quoted entries, and maps
 * IPv4-mapped IPv6 ("::ffff:203.0.113.9") to plain IPv4 so the same caller always gets the same key.
 */
export function normalizeIp(raw: string): string | null {
  let value = raw.trim();
  if (!value || value.length > MAX_ENTRY_LENGTH) return null;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1).trim();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  value = value.toLowerCase();
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return null;
  const mapped = /^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];
  return value;
}

/** Parses TRUSTED_PROXIES: addresses or CIDR ranges separated by commas or spaces. `invalid` lists what was not understood. */
export function parseTrustedProxies(source: string | undefined): { list: BlockList | null; invalid: string[] } {
  const parts = (source ?? "").split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { list: null, invalid: [] };
  const list = new BlockList();
  const invalid: string[] = [];
  for (const part of parts) {
    const [addressPart, prefixPart, extra] = part.split("/");
    const address = normalizeIp(addressPart);
    const type = address ? (isIP(address) === 4 ? "ipv4" : "ipv6") : null;
    const max = type === "ipv4" ? 32 : 128;
    const prefix = prefixPart === undefined ? max : /^\d{1,3}$/.test(prefixPart) ? Number(prefixPart) : NaN;
    if (!address || !type || extra !== undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > max) {
      invalid.push(part);
      continue;
    }
    list.addSubnet(address, prefix, type);
  }
  return { list: invalid.length ? null : list, invalid };
}

export function isTrustedProxy(trust: ProxyTrust, address: string) {
  if (!trust.proxies) return false;
  return trust.proxies.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");
}

/**
 * Proxy trust from the installation settings. TRUSTED_PROXIES wins when set; otherwise TRUSTED_PROXY_HOPS; when neither
 * is set a production build trusts one proxy (nginx in front of the app, docs/drift/NGINX.md) and development/test trust
 * none, so a caller on a dev server can never choose its own address.
 */
export function proxyTrustFrom(source: { NODE_ENV?: string; TRUSTED_PROXY_HOPS?: number | string; TRUSTED_PROXIES?: string }): ProxyTrust {
  const proxies = parseTrustedProxies(source.TRUSTED_PROXIES).list;
  if (proxies) return { hops: 0, proxies };
  const configured = typeof source.TRUSTED_PROXY_HOPS === "string" ? source.TRUSTED_PROXY_HOPS.trim() : source.TRUSTED_PROXY_HOPS;
  if (configured !== undefined && configured !== "") {
    const hops = Number(configured);
    return Number.isInteger(hops) && hops >= 0 && hops <= 10 ? { hops, proxies: null } : NO_PROXY_TRUST;
  }
  return { hops: source.NODE_ENV === "production" ? 1 : 0, proxies: null };
}
