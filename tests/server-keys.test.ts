import assert from "node:assert/strict";
import test from "node:test";
import { keyState } from "../lib/integrations/key-catalog";
import { checkEventDetail, formatCheckMessage, parseCheckEvent, serverKeyStatuses, stripeKeyMode } from "../lib/integrations/server-keys";

// Serverns nycklar (Daniel 2026-09-29): the server's own keys are described by status only – never a value.
const stripeTest = "sk_test_PlaceholderNotARealKey0000";
const openai = "sk-proj-abcdefghijklmnopqrstuvwxyz0123";
const full = {
  AUTH_SECRET: "a-real-production-secret-with-more-than-32-chars",
  INTEGRATION_KEYS_SECRET: "another-real-secret-with-more-than-32-characters",
  GOOGLE_CLIENT_ID: "12345-abc.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "GOCSPX-secretvalue",
  SMTP_HOST: "smtp.example.se",
  SMTP_USER: "mailer",
  SMTP_PASS: "mail-password-value",
  STRIPE_SECRET_KEY: stripeTest,
  STRIPE_WEBHOOK_SECRET: "whsec_abcdefghijklmnopqrstuvwxyz",
  STRIPE_SANDBOX_ENABLED: true,
  STRIPE_CHECKOUT_ENABLED: true,
  OPENAI_API_KEY: openai,
};

test("every server key is described by status, and no value, length or host ever appears in the result", () => {
  const statuses = serverKeyStatuses(full);
  assert.deepEqual(statuses.map((item) => item.id), ["stripe_secret", "stripe_webhook", "openai", "google", "smtp", "integration_keys", "auth"]);
  assert.ok(statuses.every((item) => item.configured && item.formatOk === true));
  const text = JSON.stringify(statuses);
  for (const value of [stripeTest, "whsec_abc", openai, "12345-abc", "GOCSPX", "smtp.example.se", "mailer", "mail-password", "a-real-production", "another-real"])
    assert.equal(text.includes(value), false, `${value} must not leak`);
  const stripe = statuses.find((item) => item.id === "stripe_secret")!;
  assert.equal(stripe.mode, "test");
  assert.equal(stripe.check, "service");
  assert.deepEqual(stripe.switches.map((item) => `${item.label}:${item.on}`), ["Sandlåda:true", "Kassa:true", "Kundportal:false", "Nya kortförsök:false"]);
});

test("missing, wrongly shaped and live keys are told apart", () => {
  const empty = serverKeyStatuses({ SMTP_HOST: "localhost" });
  const byId = (list: ReturnType<typeof serverKeyStatuses>, id: string) => list.find((item) => item.id === id)!;
  assert.equal(byId(empty, "stripe_secret").configured, false);
  assert.equal(byId(empty, "stripe_secret").formatOk, null);
  assert.equal(byId(empty, "openai").configured, false);
  assert.equal(byId(empty, "smtp").mode, "test", "a loopback SMTP host is the local test server");
  assert.equal(byId(empty, "auth").formatOk, false, "no secret or the development placeholder is flagged");
  assert.match(byId(empty, "integration_keys").note, /härleds ur inloggningshemligheten/);

  const live = serverKeyStatuses({ ...full, STRIPE_SECRET_KEY: "sk_live_51QaBcDeFgHiJkLmNoPq", GOOGLE_CLIENT_SECRET: undefined, STRIPE_WEBHOOK_SECRET: "not-a-webhook-secret" });
  assert.equal(byId(live, "stripe_secret").mode, "live");
  assert.equal(byId(live, "stripe_secret").check, "format", "a live key is never called from Workflow yet");
  assert.equal(byId(live, "google").formatOk, false, "only one of client id and secret");
  assert.equal(byId(live, "stripe_webhook").formatOk, false);
  assert.equal(stripeKeyMode("rk_test_abcdefghijklmn"), "test");
  assert.equal(stripeKeyMode("pk_test_abcdefghijklmn"), null, "a publishable key is not a secret key");
});

test("a format check never calls anything and its record in the history carries no value", () => {
  const openaiStatus = serverKeyStatuses(full).find((item) => item.id === "openai")!;
  assert.deepEqual(formatCheckMessage(openaiStatus), { ok: true, message: "Formen stämmer (inget anrop gjordes)." });
  const missing = serverKeyStatuses({}).find((item) => item.id === "openai")!;
  assert.equal(formatCheckMessage(missing).ok, false);
  const detail = checkEventDetail(openaiStatus.label, true, "Formen stämmer (inget anrop gjordes).");
  const parsed = parseCheckEvent("server_key_check:openai", detail, new Date("2026-09-30T08:00:00Z"));
  assert.deepEqual(parsed, { id: "openai", ok: true, message: "Formen stämmer (inget anrop gjordes).", at: "2026-09-30T08:00:00.000Z" });
  assert.equal(parseCheckEvent("server_key_check:unknown", detail, new Date()), null);
  assert.equal(parseCheckEvent("integration_key", detail, new Date()), null);
});

test("company keys show active, expiring within two weeks, expired, revoked or removed", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const day = 86_400_000;
  assert.equal(keyState({ kind: "API", expiresAt: null, revokedAt: null }, now), "active");
  assert.equal(keyState({ kind: "API", expiresAt: new Date(now.getTime() + 30 * day), revokedAt: null }, now), "active");
  assert.equal(keyState({ kind: "MCP", expiresAt: new Date(now.getTime() + 10 * day).toISOString(), revokedAt: null }, now), "expiring");
  assert.equal(keyState({ kind: "API", expiresAt: new Date(now.getTime() - day), revokedAt: null }, now), "expired");
  assert.equal(keyState({ kind: "API", expiresAt: null, revokedAt: now }, now), "revoked");
  assert.equal(keyState({ kind: "EXTERNAL", expiresAt: null, revokedAt: now }, now), "removed");
});
