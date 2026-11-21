import assert from "node:assert/strict";
import test from "node:test";
import { clientIp, UNKNOWN_CLIENT_IP } from "../lib/security/client-ip";
import { normalizeIp, parseTrustedProxies, proxyTrustFrom, type ProxyTrust } from "../lib/security/proxy-trust";
import { parseEnv } from "../lib/env";

// Proxy trust (2026-10-08): a caller must never be able to choose the address its rate limits are counted under.
const none: ProxyTrust = { hops: 0, proxies: null };
const nginx: ProxyTrust = { hops: 1, proxies: null };
const twoHops: ProxyTrust = { hops: 2, proxies: null };
const cidr = (list: string): ProxyTrust => ({ hops: 0, proxies: parseTrustedProxies(list).list });
const xff = (value: string, extra: Record<string, string> = {}) => new Headers({ "x-forwarded-for": value, ...extra });

test("without a trusted proxy every forwarded header is ignored", () => {
  assert.equal(clientIp(xff("203.0.113.9"), none), UNKNOWN_CLIENT_IP);
  assert.equal(clientIp(new Headers({ "x-real-ip": "203.0.113.9" }), none), UNKNOWN_CLIENT_IP);
  assert.equal(clientIp({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "198.51.100.1" }, none), UNKNOWN_CLIENT_IP);
});

test("extra entries the caller adds to X-Forwarded-For never win", () => {
  assert.equal(clientIp(xff("1.1.1.1, 2.2.2.2, 203.0.113.9"), nginx), "203.0.113.9");
  // A second header line is joined after the first, so the proxy's own entry still decides.
  const repeated = new Headers();
  repeated.append("x-forwarded-for", "6.6.6.6");
  repeated.append("x-forwarded-for", "203.0.113.9");
  assert.equal(clientIp(repeated, nginx), "203.0.113.9");
  assert.equal(clientIp({ "x-forwarded-for": ["6.6.6.6", "203.0.113.9"] }, nginx), "203.0.113.9");
  // A made-up X-Real-IP does not override X-Forwarded-For.
  assert.equal(clientIp(xff("203.0.113.9", { "x-real-ip": "6.6.6.6" }), nginx), "203.0.113.9");
  // Thousands of padded entries: still the right-most one.
  assert.equal(clientIp(xff(`${"6.6.6.6, ".repeat(5000)}203.0.113.9`), nginx), "203.0.113.9");
});

test("with several proxies the n-th entry from the right is the caller", () => {
  assert.equal(clientIp(xff("6.6.6.6, 203.0.113.9, 10.0.0.5"), twoHops), "203.0.113.9");
  // Fewer entries than hops: every entry came from a proxy, so the left-most one is used.
  assert.equal(clientIp(xff("203.0.113.9"), twoHops), "203.0.113.9");
});

test("a list of trusted proxies skips them from the right and stops at the first other address", () => {
  const trust = cidr("10.0.0.0/8, 172.16.0.0/12, ::1, fd00::/8");
  assert.equal(clientIp(xff("6.6.6.6, 203.0.113.9, 10.1.2.3, 172.20.0.4"), trust), "203.0.113.9");
  assert.equal(clientIp(xff("6.6.6.6, 2001:db8::7, fd12::1"), trust), "2001:db8::7");
  assert.equal(clientIp(xff("203.0.113.9"), trust), "203.0.113.9");
  // Only trusted addresses: the left-most one, written by a trusted proxy.
  assert.equal(clientIp(xff("10.9.9.9, 10.1.1.1"), trust), "10.9.9.9");
  // A spoofed "trusted" address to the left of the caller does not matter.
  assert.equal(clientIp(xff("10.0.0.1, 203.0.113.9"), trust), "203.0.113.9");
});

test("IPv6 and port forms are normalised to one key", () => {
  assert.equal(clientIp(xff("2001:DB8::1"), nginx), "2001:db8::1");
  assert.equal(clientIp(xff("[2001:db8::1]:51234"), nginx), "2001:db8::1");
  assert.equal(clientIp(xff("203.0.113.9:51234"), nginx), "203.0.113.9");
  assert.equal(clientIp(xff("::ffff:203.0.113.9"), nginx), "203.0.113.9");
  assert.equal(clientIp(xff('"203.0.113.9"'), nginx), "203.0.113.9");
  assert.equal(clientIp(new Headers({ "x-real-ip": "2001:db8::2" }), nginx), "2001:db8::2");
});

test("a malformed entry where the caller should be gives unknown, never a guess further left", () => {
  for (const value of ["unknown", "not-an-ip", "6.6.6.6, 999.1.1.1", "6.6.6.6, <script>", "6.6.6.6, 1.2.3", `6.6.6.6, ${"a".repeat(200)}`, "6.6.6.6, _hidden"]) {
    assert.equal(clientIp(xff(value), nginx), UNKNOWN_CLIENT_IP, value);
  }
  assert.equal(clientIp(xff(" , ,"), nginx), UNKNOWN_CLIENT_IP);
  assert.equal(clientIp(new Headers({ "x-real-ip": "bogus" }), nginx), UNKNOWN_CLIENT_IP);
  // In the list mode a malformed entry stops the walk.
  assert.equal(clientIp(xff("203.0.113.9, garbage, 10.0.0.1"), cidr("10.0.0.0/8")), UNKNOWN_CLIENT_IP);
});

test("addresses and trusted-proxy lists are parsed strictly", () => {
  assert.equal(normalizeIp("  198.51.100.4 "), "198.51.100.4");
  assert.equal(normalizeIp("0:0:0:0:0:ffff:198.51.100.4"), "198.51.100.4");
  assert.equal(normalizeIp("::1"), "::1");
  assert.equal(normalizeIp("[::1]"), "::1");
  assert.equal(normalizeIp("1.2.3.4:99999999"), null);
  assert.equal(normalizeIp(""), null);
  assert.deepEqual(parseTrustedProxies("127.0.0.1, 10.0.0.0/8 ::1/128").invalid, []);
  assert.deepEqual(parseTrustedProxies("10.0.0.0/33, nonsense, 10.0.0.0/8/1, ::1/129").invalid, ["10.0.0.0/33", "nonsense", "10.0.0.0/8/1", "::1/129"]);
  assert.equal(parseTrustedProxies("").list, null);
});

test("the installation default trusts nginx in production and nothing in development", () => {
  assert.deepEqual(proxyTrustFrom({ NODE_ENV: "production" }), nginx);
  assert.deepEqual(proxyTrustFrom({ NODE_ENV: "development" }), none);
  assert.deepEqual(proxyTrustFrom({ NODE_ENV: "test" }), none);
  assert.deepEqual(proxyTrustFrom({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: 0 }), none);
  assert.deepEqual(proxyTrustFrom({ NODE_ENV: "development", TRUSTED_PROXY_HOPS: "2" }), twoHops);
  assert.deepEqual(proxyTrustFrom({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "" }), nginx);
  const listed = proxyTrustFrom({ NODE_ENV: "production", TRUSTED_PROXIES: "127.0.0.1" });
  assert.equal(listed.hops, 0);
  assert.ok(listed.proxies);
});

test("the settings are validated at start", () => {
  assert.equal(parseEnv({ NODE_ENV: "development", TRUSTED_PROXY_HOPS: "" }).TRUSTED_PROXY_HOPS, undefined);
  assert.equal(parseEnv({ NODE_ENV: "development", TRUSTED_PROXY_HOPS: "2" }).TRUSTED_PROXY_HOPS, 2);
  assert.throws(() => parseEnv({ NODE_ENV: "development", TRUSTED_PROXY_HOPS: "-1" }));
  assert.throws(() => parseEnv({ NODE_ENV: "development", TRUSTED_PROXY_HOPS: "many" }));
  assert.throws(() => parseEnv({ NODE_ENV: "development", TRUSTED_PROXIES: "10.0.0.0/99" }), /TRUSTED_PROXIES/);
  assert.throws(() => parseEnv({ NODE_ENV: "development", TRUSTED_PROXIES: "127.0.0.1", TRUSTED_PROXY_HOPS: "1" }), /not both/);
  assert.equal(parseEnv({ NODE_ENV: "development", TRUSTED_PROXIES: "127.0.0.1, 172.16.0.0/12" }).TRUSTED_PROXIES, "127.0.0.1, 172.16.0.0/12");
});
