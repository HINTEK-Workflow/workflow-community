import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_SECRET ??= "test-secret-for-the-code-step-only-0123456789";

// Behörighetshärdning (säkerhetsgranskningen 2026-11-24, P3), the rules without a database.

test("G-09: Google and Microsoft no longer meet a two-step requirement by themselves; a passkey does", async () => {
  const { strongSignInMethod } = await import("../lib/auth/session-rules");
  assert.equal(strongSignInMethod("google"), false);
  assert.equal(strongSignInMethod("microsoft"), false);
  assert.equal(strongSignInMethod("passkey"), true);
  assert.equal(strongSignInMethod("password"), false);
});

test("G-09: the code step after Google or Microsoft is signed, short-lived and cannot be changed", async () => {
  const { createOAuthCodeStep, readOAuthCodeStep, OAUTH_CODE_STEP_SECONDS } = await import("../lib/auth/oauth-code-step");
  const now = Date.now();
  const step = { userId: "user-1", provider: "google" as const, profile: { sub: "g-1", email: "a@example.invalid", email_verified: true } };
  const value = createOAuthCodeStep(step, now);
  assert.deepEqual(readOAuthCodeStep(value, now + 1_000), step);
  assert.equal(readOAuthCodeStep(value, now + (OAUTH_CODE_STEP_SECONDS + 1) * 1000), null, "expired");
  const [payload, signature] = value.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), userId: "someone-else" })).toString("base64url");
  assert.equal(readOAuthCodeStep(`${forged}.${signature}`, now), null, "another person cannot be put in");
  assert.equal(readOAuthCodeStep(undefined, now), null);
  assert.equal(readOAuthCodeStep("garbage", now), null);
});

test("G-21: a sign-in has an absolute length, shorter for a superadmin", async () => {
  const { sessionTooOld, SESSION_ABSOLUTE_SECONDS, SUPERADMIN_SESSION_ABSOLUTE_SECONDS } = await import("../lib/auth/session-rules");
  const now = Date.now();
  const at = (secondsAgo: number) => Math.floor(now / 1000) - secondsAgo;
  assert.equal(sessionTooOld(at(60), "STAFF", now), false);
  assert.equal(sessionTooOld(at(SESSION_ABSOLUTE_SECONDS + 60), "STAFF", now), true, "a session used every day still ends");
  assert.equal(sessionTooOld(at(SUPERADMIN_SESSION_ABSOLUTE_SECONDS + 60), "SUPERADMIN", now), true);
  assert.equal(sessionTooOld(at(SUPERADMIN_SESSION_ABSOLUTE_SECONDS + 60), "STAFF", now), false);
  assert.ok(SUPERADMIN_SESSION_ABSOLUTE_SECONDS < SESSION_ABSOLUTE_SECONDS);
});
