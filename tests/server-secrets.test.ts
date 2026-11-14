import assert from "node:assert/strict";
import test from "node:test";
import { openPassword, sealPassword } from "../lib/mail/settings";
import { serverKeyStatuses } from "../lib/integrations/server-keys";
import {
  googleCredentialsFrom,
  lastChange,
  parseStoredServerKeys,
  resolveServerSecrets,
  resolvedAsEnv,
  serverSecretProblem,
  withServerSecret,
  type StoredServerKeys,
} from "../lib/integrations/server-secret-values";

// Servernycklar i appen (2026-10-09): Stripe's and Google's keys are entered in the app and sealed in the
// database; the app's value wins and the environment is the fallback. Placeholder values only – none is a real key.
const master = "a-master-secret-that-lives-only-in-the-environment-123";
const seal = (value: string) => sealPassword(value, master);
const open = (cipher: string) => openPassword(cipher, master);
const appStripe = ["sk", "test", "AppPlaceholder0000000000"].join("_");
const envStripe = ["sk", "test", "EnvPlaceholder0000000000"].join("_");
const env = {
  STRIPE_SECRET_KEY: envStripe,
  STRIPE_WEBHOOK_SECRET: "whsec_EnvPlaceholder000000000",
  GOOGLE_CLIENT_ID: "env-123.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "env-google-secret-placeholder",
};
const enter = (stored: StoredServerKeys, field: Parameters<typeof withServerSecret>[1], value: string | null) =>
  withServerSecret(stored, field, value, seal, "Testperson", new Date("2026-10-09T10:00:00Z"));

test("sealing round trip: the stored JSON never holds the value, and only the master secret opens it", () => {
  const stored = enter({}, "stripeSecretKey", appStripe);
  assert.equal(JSON.stringify(stored).includes(appStripe), false, "the value is sealed");
  assert.equal(open(stored.stripeSecretKey!.cipher!), appStripe);
  assert.equal(openPassword(stored.stripeSecretKey!.cipher, "another-master-secret-of-enough-length-000"), "", "the wrong master secret opens nothing");
  assert.deepEqual(parseStoredServerKeys(JSON.parse(JSON.stringify(stored))), stored, "survives a trip through the JSON column");
  assert.deepEqual(parseStoredServerKeys("not an object"), {});
});

test("resolution order: the app's value first, the environment as fallback, nothing when neither", () => {
  const fromEnv = resolveServerSecrets({}, env, open);
  assert.deepEqual(fromEnv.stripeSecretKey, { value: envStripe, source: "server" });
  assert.equal(fromEnv.googleClientId.source, "server");

  const fromApp = resolveServerSecrets(enter({}, "stripeSecretKey", appStripe), env, open);
  assert.deepEqual(fromApp.stripeSecretKey, { value: appStripe, source: "app" });
  assert.equal(fromApp.stripeWebhookSecret.source, "server", "fields not entered in the app still come from the environment");

  assert.deepEqual(resolveServerSecrets({}, {}, open).stripeSecretKey, { value: "", source: null });
});

test("the bin removes a value wherever it came from; a new value replaces the removal", () => {
  const removed = enter({}, "stripeWebhookSecret", null);
  assert.deepEqual(resolveServerSecrets(removed, env, open).stripeWebhookSecret, { value: "", source: null }, "the environment's value no longer applies");
  const again = enter(removed, "stripeWebhookSecret", "whsec_AppPlaceholder000000000");
  assert.equal(resolveServerSecrets(again, env, open).stripeWebhookSecret.source, "app");
});

test("a sealed value that can no longer be opened (master secret changed) falls back to the environment", () => {
  const stored = withServerSecret({}, "stripeSecretKey", appStripe, (value) => sealPassword(value, "an-old-master-secret-that-was-replaced-000"), "Testperson");
  assert.deepEqual(resolveServerSecrets(stored, env, open).stripeSecretKey, { value: envStripe, source: "server" });
});

test("Google's id and secret are one pair: never an id from the app with a secret from the environment", () => {
  const onlyId = enter({}, "googleClientId", "app-456.apps.googleusercontent.com");
  const resolved = resolveServerSecrets(onlyId, env, open);
  assert.equal(resolved.googleClientId.source, "app");
  assert.deepEqual(resolved.googleClientSecret, { value: "", source: null });
  assert.equal(googleCredentialsFrom(resolved), null, "no provider with half a pair");
  const both = enter(onlyId, "googleClientSecret", "app-google-secret-placeholder");
  assert.deepEqual(googleCredentialsFrom(resolveServerSecrets(both, env, open)), { clientId: "app-456.apps.googleusercontent.com", clientSecret: "app-google-secret-placeholder" });
  assert.deepEqual(googleCredentialsFrom(resolveServerSecrets({}, env, open)), { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET });
});

test("the status rows describe the value that applies, never the value itself", () => {
  const stored = enter({}, "stripeSecretKey", ["sk", "live", "AppPlaceholder0000000000"].join("_"));
  const statuses = serverKeyStatuses({ ...env, ...resolvedAsEnv(resolveServerSecrets(stored, env, open)) });
  const stripe = statuses.find((item) => item.id === "stripe_secret")!;
  assert.equal(stripe.mode, "live", "the app's key wins over the environment's test key");
  const text = JSON.stringify(statuses);
  for (const value of ["AppPlaceholder", "EnvPlaceholder", "env-google-secret", "env-123"]) assert.equal(text.includes(value), false, `${value} must not leak`);
  assert.equal(lastChange(stored, "stripe_secret"), "2026-10-09T10:00:00.000Z");
  assert.equal(lastChange(stored, "google"), null);
});

test("a value of the wrong shape is refused before it is stored, and the refusal never repeats it", () => {
  assert.equal(serverSecretProblem("stripeSecretKey", appStripe), null);
  assert.equal(serverSecretProblem("stripeWebhookSecret", "whsec_AppPlaceholder000000000"), null);
  assert.equal(serverSecretProblem("googleClientId", "app-456.apps.googleusercontent.com"), null);
  assert.equal(serverSecretProblem("googleClientSecret", "app-google-secret-placeholder"), null);
  const wrong = ["pk_test_PublishableNotSecret00", "whsec_short", "secret with spaces", ""];
  for (const value of wrong) {
    const problem = serverSecretProblem(value.startsWith("whsec") ? "stripeWebhookSecret" : "stripeSecretKey", value);
    assert.ok(problem, `${value || "empty"} is refused`);
    if (value) assert.equal(problem!.includes(value), false);
  }
  assert.ok(serverSecretProblem("googleClientId", "not-a-google-id"));
});
