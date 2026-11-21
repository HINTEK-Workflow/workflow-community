import assert from "node:assert/strict";
import test from "node:test";
import { parseEnv } from "../lib/env";
import { INSTANCE_DEFAULTS } from "../lib/instance-defaults";

// Workflow's loopback QA rules exist only in its own installation (lib/instance-defaults.ts), not in the community edition.
const hintekQa = { skip: INSTANCE_DEFAULTS.loopbackTestDatabase ? false : "Workflow's loopback QA rules only" };

const localProduction = {
  NODE_ENV: "production",
  APP_URL: "http://127.0.0.1:3000",
  AUTH_SECRET: "a-local-test-secret-that-is-longer-than-32-characters",
  DATABASE_URL: "postgresql://workflow:test-only@127.0.0.1:5432/kfid_v3_test?schema=public",
  INVITATION_DELIVERY_ENABLED: "false",
  STRIPE_SANDBOX_ENABLED: "false",
  STRIPE_CHECKOUT_ENABLED: "false",
  STRIPE_PORTAL_ENABLED: "false",
  OPENAI_PROVIDER_ENABLED: "false",
  SEED_ADMIN_PASSWORD: "a-strong-explicit-local-seed-password",
} satisfies NodeJS.ProcessEnv;

test("development keeps documented local defaults", () => {
  const parsed = parseEnv({ NODE_ENV: "development" });
  assert.equal(parsed.APP_URL, "http://localhost:3000");
});

test("production rejects implicit development credentials and database", () => {
  assert.throws(
    () => parseEnv({ NODE_ENV: "production" }),
    /development placeholder|development database default/,
  );
});

test("loopback production is restricted to the isolated test database", hintekQa, () => {
  assert.equal(parseEnv(localProduction).DATABASE_URL.includes("kfid_v3_test"), true);
  assert.throws(
    () => parseEnv({ ...localProduction, DATABASE_URL: "postgresql://workflow:test-only@127.0.0.1:5432/workflow?schema=public" }),
    /kfid_v3_test/,
  );
  assert.throws(
    () => parseEnv({ ...localProduction, INVITATION_DELIVERY_ENABLED: "true" }),
    /Invitation delivery must remain disabled/,
  );
  assert.throws(
    () => parseEnv({ ...localProduction, BILLING_EMAIL_DELIVERY_ENABLED: "true" }),
    /Billing email delivery must remain disabled/,
  );
  assert.throws(
    () => parseEnv({ ...localProduction, ROUND_EMAIL_DELIVERY_ENABLED: "true" }),
    /Round reminder email delivery must remain disabled/,
  );
  assert.throws(
    () => parseEnv({ ...localProduction, STRIPE_CARD_RETRY_ENABLED: "true" }),
    /Card retries must remain disabled/,
  );
});

test("non-loopback production requires HTTPS and explicit safe values", () => {
  const hosted = {
    ...localProduction,
    APP_URL: "https://workflow.example.com",
    DATABASE_URL: "postgresql://workflow:strong-password@database.internal:5432/workflow_prod?schema=public&sslmode=verify-full&sslrootcert=/app/certs/db-ca.crt",
  };
  assert.equal(parseEnv(hosted).APP_URL, hosted.APP_URL);
  assert.throws(
    () => parseEnv({ ...hosted, APP_URL: "http://workflow.example.com" }),
    /must use HTTPS/,
  );
});

test("production integrations fail closed when configuration is incomplete", () => {
  assert.throws(
    () => parseEnv({ ...localProduction, GOOGLE_CLIENT_ID: "client-only" }),
    /must either both be set or both be absent/,
  );
  assert.throws(
    () => parseEnv({ ...localProduction, STRIPE_CHECKOUT_ENABLED: "true" }),
    /require the explicitly enabled sandbox/,
  );
  const hosted = {
    ...localProduction,
    APP_URL: "https://workflow.example.com",
    DATABASE_URL: "postgresql://workflow:strong-password@database.internal:5432/workflow_prod?schema=public&sslmode=verify-full&sslrootcert=/app/certs/db-ca.crt",
  };
  assert.throws(
    () => parseEnv({ ...hosted, STRIPE_CARD_RETRY_ENABLED: "true" }),
    /require the explicitly enabled sandbox or live Stripe|require the Stripe sandbox or live Stripe/,
  );
  assert.throws(
    () => parseEnv({ ...localProduction, STRIPE_SANDBOX_ENABLED: "true", STRIPE_SECRET_KEY: "sk_live_example" }),
    /test-mode secret key/,
  );
  assert.throws(
    () => parseEnv({ ...localProduction, OPENAI_PROVIDER_ENABLED: "true" }),
    /server-side API key/,
  );
  assert.throws(
    () => parseEnv({
      ...localProduction,
      OPENAI_PROVIDER_ENABLED: "true",
      OPENAI_API_KEY: "sk-test-placeholder-not-a-real-key",
      OPENAI_DPA_APPROVED: "true",
      OPENAI_PROVIDER_EVAL_APPROVED: "false",
    }),
    /approved synthetic provider evaluation/,
  );
  assert.throws(
    () => parseEnv({
      ...localProduction,
      OPENAI_PROVIDER_ENABLED: "true",
      OPENAI_API_KEY: "sk-test-placeholder-not-a-real-key",
      OPENAI_DPA_APPROVED: "false",
    }),
    /data-processing agreement/,
  );
  assert.throws(
    () => parseEnv({
      ...localProduction,
      OPENAI_PROVIDER_ENABLED: "true",
      OPENAI_API_KEY: "sk-test-placeholder-not-a-real-key",
      OPENAI_DPA_APPROVED: "true",
      OPENAI_PROCESSING_REGION: "EU",
    }),
    /EU data controls/,
  );
  assert.throws(
    () => parseEnv({ ...localProduction, OPENAI_EVAL_ENABLED: "true" }),
    /server-side API key|verified EU data controls/,
  );
  assert.equal(
    parseEnv({
      ...localProduction,
      OPENAI_EVAL_ENABLED: "true",
      OPENAI_API_KEY: "sk-test-placeholder-not-a-real-key",
    }).OPENAI_EVAL_ENABLED,
    true,
  );
  assert.throws(
    () => parseEnv({
      ...localProduction,
      OPENAI_PROVIDER_ENABLED: "true",
      OPENAI_EVAL_ENABLED: "true",
      OPENAI_API_KEY: "sk-test-placeholder-not-a-real-key",
      OPENAI_DPA_APPROVED: "true",
      OPENAI_PROVIDER_EVAL_APPROVED: "false",
    }),
    /normal provider to remain disabled/,
  );
});

test("live Stripe (prepared 2026-09-30) only on the public HTTPS server with a live key, never with the sandbox or kfid_v3_test", hintekQa, () => {
  const publicServer = { ...localProduction, APP_URL: "https://workflow.example.com", DATABASE_URL: "postgresql://workflow:secret@postgres:5432/workflow?schema=public" };
  const live = { ...publicServer, STRIPE_LIVE_ENABLED: "true", STRIPE_SECRET_KEY: "sk_live_example", STRIPE_WEBHOOK_SECRET: "whsec_example", STRIPE_CHECKOUT_ENABLED: "true", STRIPE_PORTAL_ENABLED: "true" };
  assert.equal(parseEnv(live).STRIPE_LIVE_ENABLED, true);
  assert.throws(() => parseEnv({ ...live, APP_URL: "http://127.0.0.1:3000" }), /Live Stripe may never run on a loopback address/);
  assert.throws(() => parseEnv({ ...live, DATABASE_URL: "postgresql://workflow:secret@postgres:5432/kfid_v3_test?schema=public" }), /never use the kfid_v3_test database/);
  assert.throws(() => parseEnv({ ...live, STRIPE_SECRET_KEY: "sk_test_example" }), /live-mode secret/);
  assert.throws(() => parseEnv({ ...live, STRIPE_WEBHOOK_SECRET: "not-a-webhook-secret" }), /webhook signing secret/);
  // Servernycklar (2026-10-09): the keys may be entered in the app instead; the start does not stop without them, and
  // every Stripe call is refused until they are in place (ee/stripe/sandbox.ts).
  assert.equal(parseEnv({ ...live, STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" }).STRIPE_LIVE_ENABLED, true);
  assert.throws(() => parseEnv({ ...live, STRIPE_SANDBOX_ENABLED: "true" }), /cannot be enabled together|sandbox may only run/);
  assert.throws(() => parseEnv({ ...publicServer, STRIPE_CHECKOUT_ENABLED: "true" }), /sandbox or live Stripe/);
  assert.throws(() => parseEnv({ ...localProduction, ALERT_EMAIL_DELIVERY_ENABLED: "true", ALERT_EMAIL: "drift@example.test" }), /Alert email delivery must remain disabled/);
});

test("pilot access (prepared 2026-09-30) is refused on loopback QA", hintekQa, () => {
  assert.throws(() => parseEnv({ ...localProduction, PILOT_ACCESS_EMAILS: "kund@example.se" }), /No real pilot identity/);
});

test("a database on another machine needs verified TLS in production (2026-10-04)", () => {
  const remote = { ...localProduction, APP_URL: "https://workflow.example.com" };
  const at = (query: string) => ({ ...remote, DATABASE_URL: `postgresql://workflow_app:strong-password@10.0.0.10:5432/workflow?schema=public${query}` });
  assert.throws(() => parseEnv(at("")), /sslmode=verify-full/);
  assert.throws(() => parseEnv(at("&sslmode=require")), /sslmode=verify-full/);
  assert.throws(() => parseEnv(at("&sslmode=verify-full")), /sslrootcert/);
  assert.equal(parseEnv(at("&sslmode=verify-full&sslrootcert=/app/certs/db-ca.crt")).APP_URL, "https://workflow.example.com");
  // The database in the same compose network ("postgres") is unchanged.
  assert.equal(parseEnv({ ...remote, DATABASE_URL: "postgresql://workflow:strong-password@postgres:5432/workflow?schema=public" }).APP_URL, "https://workflow.example.com");
});
