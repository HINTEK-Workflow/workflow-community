import assert from "node:assert/strict";
import test from "node:test";
import { base32Decode, base32Encode, newTotpSecret, totpCode, totpStep, totpUri, verifyTotp, TOTP_STEP_SECONDS } from "../lib/security/totp";
import { BACKUP_CODE_COUNT, hashBackupCode, looksLikeBackupCode, newBackupCodes, normalizeBackupCode } from "../lib/security/backup-codes";
import { coarseClient, ipHash, securityLogCutoff, SECURITY_EVENT_TYPES, SECURITY_LOG_MONTHS } from "../lib/security/security-log-core";
import { freshlyAuthenticated, REAUTH_WINDOW_SECONDS, sessionNeedsTouch, sessionRowEnded, tokenRevoked } from "../lib/auth/session-rules";
import { fallbackHit, RATE_RULES, rateLimitBucketKey } from "../lib/security/rate-limit";
import { ApiError, ReauthRequired } from "../lib/kfid/errors";

// Tvåstegsverifiering, säkerhetslogg och aktiva inloggningar (2026-10-10).

// RFC 6238 appendix B, SHA-1: the ASCII secret "12345678901234567890"; the RFC's 8-digit codes end in our 6 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

test("TOTP matches the RFC 6238 test vectors", () => {
  assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  for (const [seconds, code] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"]] as const)
    assert.equal(totpCode(RFC_SECRET, Math.floor(seconds / TOTP_STEP_SECONDS)), code, `T=${seconds}`);
});

test("base32 round trip and a new secret of 160 bits", () => {
  const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  assert.deepEqual(base32Decode("gezd gnbv-gy3t"), base32Decode("GEZDGNBVGY3T"), "case, spaces and dashes ignored");
  const secret = newTotpSecret();
  assert.equal(base32Decode(secret).length, 20);
  assert.notEqual(secret, newTotpSecret());
  assert.throws(() => base32Decode("not base32!"));
});

test("TOTP accepts one step either side of now and nothing further", () => {
  const now = 1_800_000_000_000;
  const step = totpStep(now);
  const at = (offset: number) => totpCode(RFC_SECRET, step + offset);
  assert.equal(verifyTotp(RFC_SECRET, at(0), { now }), step);
  assert.equal(verifyTotp(RFC_SECRET, at(-1), { now }), step - 1, "30 s behind");
  assert.equal(verifyTotp(RFC_SECRET, at(1), { now }), step + 1, "30 s ahead");
  assert.equal(verifyTotp(RFC_SECRET, at(-2), { now }), null, "60 s behind is too old");
  assert.equal(verifyTotp(RFC_SECRET, at(2), { now }), null, "60 s ahead is too far");
  assert.equal(verifyTotp(RFC_SECRET, `${at(0).slice(0, 3)} ${at(0).slice(3)}`, { now }), step, "a space in the middle is fine");
  for (const wrong of ["", "12345", "1234567", "abcdef", "12 34 5"]) assert.equal(verifyTotp(RFC_SECRET, wrong, { now }), null, wrong);
});

test("a TOTP code is never accepted twice (replay)", () => {
  const now = 1_800_000_000_000;
  const step = totpStep(now);
  const code = totpCode(RFC_SECRET, step);
  assert.equal(verifyTotp(RFC_SECRET, code, { now, lastStep: step }), null, "the same step again");
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), { now, lastStep: step }), null, "an older step after a newer one");
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), { now, lastStep: step }), step + 1, "the next step is fine");
  assert.equal(verifyTotp(RFC_SECRET, code, { now, lastStep: null }), step);
});

test("the QR address names the installation and the account", () => {
  const uri = totpUri(RFC_SECRET, "anna@example.se", "Elfirman Workflow");
  assert.match(uri, /^otpauth:\/\/totp\/Elfirman%20Workflow%3Aanna%40example\.se\?/);
  const params = new URL(uri).searchParams;
  assert.equal(params.get("secret"), RFC_SECRET);
  assert.equal(params.get("issuer"), "Elfirman Workflow");
  assert.equal(params.get("digits"), "6");
  assert.equal(params.get("period"), "30");
});

test("ten backup codes, unique, readable, hashed with a key and the person", () => {
  const codes = newBackupCodes();
  assert.equal(codes.length, BACKUP_CODE_COUNT);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    assert.match(code, /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
    assert.equal(looksLikeBackupCode(code), true);
  }
  const secret = "a-test-secret-that-is-long-enough-for-hkdf";
  const [code] = codes;
  const hash = hashBackupCode("user-1", code, secret);
  assert.equal(hashBackupCode("user-1", code.toLowerCase().replace("-", " "), secret), hash, "typed in lower case with a space");
  assert.notEqual(hashBackupCode("user-2", code, secret), hash, "another person's hash differs");
  assert.notEqual(hashBackupCode("user-1", code, `${secret}-other`), hash, "another installation's key differs");
  assert.ok(!hash.includes(normalizeBackupCode(code)), "the code itself is not in the hash");
  assert.equal(looksLikeBackupCode("123456"), false, "a TOTP code is not a backup code");
});

test("sessions: a revoked, foreign, missing or expired row ends the token", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const row = { userId: "u1", revokedAt: null, lastSeenAt: new Date(now - 3600_000) };
  const day = 24 * 3600;
  assert.equal(sessionRowEnded(row, "u1", day, now), false);
  assert.equal(sessionRowEnded({ ...row, revokedAt: new Date(now - 1000) }, "u1", day, now), true, "signed out");
  assert.equal(sessionRowEnded(row, "u2", day, now), true, "another person's row");
  assert.equal(sessionRowEnded(null, "u1", day, now), true, "row removed");
  assert.equal(sessionRowEnded({ ...row, lastSeenAt: new Date(now - 2 * day * 1000) }, "u1", day, now), true, "unused longer than a session lives");
  assert.equal(sessionNeedsTouch(new Date(now - 60_000), now), false);
  assert.equal(sessionNeedsTouch(new Date(now - 6 * 60_000), now), true);
});

test("Logga ut överallt and a password change end older tokens, not newer ones", () => {
  const revoked = new Date("2026-10-10T12:00:00Z");
  const before = Math.floor(revoked.getTime() / 1000) - 60;
  const after = Math.floor(revoked.getTime() / 1000) + 60;
  assert.equal(tokenRevoked(before, null, revoked), true, "signed in before Logga ut överallt");
  assert.equal(tokenRevoked(after, null, revoked), false, "signed in again afterwards");
  assert.equal(tokenRevoked(before, revoked, null), true, "password changed");
  assert.equal(tokenRevoked(before, null, null), false);
  assert.equal(tokenRevoked(undefined, revoked, revoked), false, "no sign-in time: decided by the session row");
});

test("fresh sign-in holds ten minutes from sign-in or confirmation", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const seconds = (ms: number) => Math.floor(ms / 1000);
  assert.equal(REAUTH_WINDOW_SECONDS, 600);
  assert.equal(freshlyAuthenticated(seconds(now - 5 * 60_000), null, now), true, "signed in 5 min ago");
  assert.equal(freshlyAuthenticated(seconds(now - 11 * 60_000), null, now), false, "signed in 11 min ago");
  assert.equal(freshlyAuthenticated(seconds(now - 3600_000), new Date(now - 2 * 60_000), now), true, "confirmed 2 min ago");
  assert.equal(freshlyAuthenticated(seconds(now - 3600_000), new Date(now - 20 * 60_000), now), false, "confirmed 20 min ago");
  assert.equal(freshlyAuthenticated(undefined, null, now), false);
  const error = new ReauthRequired();
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 403);
});

test("wrong codes are limited to five per person in 15 minutes", () => {
  const rule = RATE_RULES.twoFactor;
  assert.equal(rule.limit, 5);
  assert.equal(rule.windowSeconds, 15 * 60);
  const key = rateLimitBucketKey(rule, "user-limit-test");
  const start = Date.parse("2026-10-10T12:00:00Z");
  const hits = Array.from({ length: 6 }, (_, index) => fallbackHit(rule, key, start + index * 1000));
  assert.deepEqual(hits.map((hit) => hit.allowed), [true, true, true, true, true, false]);
  assert.equal(fallbackHit(rule, key, start + 15 * 60_000 + 1).allowed, true, "a new window");
});

test("the security log keeps 12 months", () => {
  assert.equal(SECURITY_LOG_MONTHS, 12);
  assert.equal(securityLogCutoff(new Date("2026-10-10T12:00:00Z")).toISOString(), "2025-10-10T12:00:00.000Z");
  for (const type of ["login_ok", "login_failed", "two_factor_on", "two_factor_off", "backup_code_used", "password_changed", "session_revoked", "sessions_revoked_all", "api_key_created", "api_key_revoked"])
    assert.ok(type in SECURITY_EVENT_TYPES, type);
});

test("the IP address is a keyed HMAC (pseudonym), never the address", () => {
  const secret = "a-test-secret-that-is-long-enough-for-hkdf";
  const now = new Date("2026-10-10T12:00:00Z");
  const hash = ipHash("203.0.113.7", secret, now)!;
  assert.match(hash, /^[A-Za-z0-9_-]{22}$/);
  assert.ok(!hash.includes("203"), "not the address");
  assert.equal(ipHash(" 203.0.113.7 ", secret, new Date("2026-03-01T00:00:00Z")), hash, "the same address in the same year");
  assert.notEqual(ipHash("203.0.113.8", secret, now), hash, "another address");
  assert.notEqual(ipHash("203.0.113.7", `${secret}-other`, now), hash, "another installation's key");
  assert.notEqual(ipHash("203.0.113.7", secret, new Date("2027-01-02T00:00:00Z")), hash, "a new year gives new values");
  assert.equal(ipHash("local", secret, now), null, "no proxy: nothing stored");
  assert.equal(ipHash("", secret, now), null);
});

test("only a coarse browser text is kept", () => {
  assert.equal(coarseClient("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"), "Chrome på Windows");
  assert.equal(coarseClient("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0"), "Edge på Windows");
  assert.equal(coarseClient("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"), "Safari på iPhone");
  assert.equal(coarseClient("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0"), "Firefox på Mac");
  assert.equal(coarseClient("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"), "Chrome på Android");
  assert.equal(coarseClient("curl/8.4.0"), "Annan klient");
  assert.equal(coarseClient(null), "");
});
