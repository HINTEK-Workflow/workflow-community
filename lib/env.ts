import { z } from "zod";
import { INSTANCE_DEFAULTS } from "./instance-defaults";

const booleanFlag = z
  .union([z.literal("true"), z.literal("false")])
  .optional()
  .transform((value) => value === "true");

const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  });

const DEVELOPMENT_AUTH_SECRETS = new Set([
  "change-this-development-auth-secret-32-characters",
  "change-this-to-a-long-random-secret-at-least-32-characters",
]);
const DEVELOPMENT_DATABASE_URL =
  "postgresql://workflow:workflow@localhost:5432/workflow?schema=public";
const DEVELOPMENT_SEED_PASSWORDS = new Set([
  "WorkflowTemp2026!",
  "replace-with-strong-seed-password",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z
    .string()
    .min(32)
    .default("change-this-development-auth-secret-32-characters"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://workflow:workflow@localhost:5432/workflow?schema=public"),
  SMTP_HOST: z.string().min(1).default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_SECURE: booleanFlag,
  MAIL_FROM_NAME: z.string().min(1).default(INSTANCE_DEFAULTS.name),
  MAIL_FROM_ADDRESS: z.string().email().default(INSTANCE_DEFAULTS.supportEmail),
  STORAGE_ROOT: z.string().min(1).default("./storage"),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(72),
  INVITATION_DELIVERY_ENABLED: booleanFlag,
  BILLING_SCHEDULER_ENABLED: booleanFlag,
  BILLING_EMAIL_DELIVERY_ENABLED: booleanFlag,
  // Round reminders by e-mail (Daniel 2026-09-30); off until switched on, like the other mail.
  ROUND_EMAIL_DELIVERY_ENABLED: booleanFlag,
  // Operations alerts (drift, 2026-09-30): the monitor e-mails ALERT_EMAIL when something fails; off until enabled.
  ALERT_EMAIL_DELIVERY_ENABLED: booleanFlag,
  // The pilot's sign-in addresses (comma-separated); honoured only on the public HTTPS server (lib/auth/access.ts).
  PILOT_ACCESS_EMAILS: z.string().default(""),
  ALERT_EMAIL: z.union([z.literal(""), z.email()]).default(""),
  SESSION_MAX_AGE_HOURS: z.coerce.number().int().positive().default(8),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_SANDBOX_ENABLED: booleanFlag,
  // Live Stripe (prepared 2026-09-30): only on the public HTTPS server, never with kfid_v3_test or the sandbox.
  STRIPE_LIVE_ENABLED: booleanFlag,
  STRIPE_CHECKOUT_ENABLED: booleanFlag,
  STRIPE_PORTAL_ENABLED: booleanFlag,
  STRIPE_CARD_RETRY_ENABLED: booleanFlag,
  OPENAI_PROVIDER_ENABLED: booleanFlag,
  OPENAI_EVAL_ENABLED: booleanFlag,
  OPENAI_DPA_APPROVED: booleanFlag,
  OPENAI_PROCESSING_REGION: z.enum(["GLOBAL", "EU"]).default("GLOBAL"),
  OPENAI_EU_DATA_CONTROLS_APPROVED: booleanFlag,
  OPENAI_PROVIDER_EVAL_APPROVED: booleanFlag,
  OPENAI_API_KEY: optionalString,
  // Encrypts the external keys companies store under API och MCP; derived from AUTH_SECRET when not set.
  INTEGRATION_KEYS_SECRET: optionalString,
  SEED_ADMIN_EMAIL: z.string().email().default(INSTANCE_DEFAULTS.adminEmail || "admin@example.com"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("WorkflowTemp2026!"),
  SEED_ADMIN_NAME: z.string().min(1).default(INSTANCE_DEFAULTS.adminName),
  SEED_ADMIN_EMAIL_VERIFIED: booleanFlag,
  SEED_ORGANIZATION_NAME: z.string().min(1).default(`${INSTANCE_DEFAULTS.operator} Internal`),
  SEED_ORGANIZATION_SLUG: z.string().min(1).default(`${INSTANCE_DEFAULTS.operatorSlugs[0] ?? "workflow"}-internal`),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") return;

  const issue = (path: string, message: string) =>
    context.addIssue({ code: "custom", path: [path], message });
  const appUrl = new URL(value.APP_URL);
  const databaseUrl = new URL(value.DATABASE_URL);
  const loopback = LOOPBACK_HOSTS.has(appUrl.hostname);
  const databaseName = databaseUrl.pathname.replace(/^\//, "");

  if (DEVELOPMENT_AUTH_SECRETS.has(value.AUTH_SECRET))
    issue("AUTH_SECRET", "AUTH_SECRET must not use a development placeholder in production.");
  if (value.DATABASE_URL === DEVELOPMENT_DATABASE_URL)
    issue("DATABASE_URL", "DATABASE_URL must not use the development database default in production.");
  if (DEVELOPMENT_SEED_PASSWORDS.has(value.SEED_ADMIN_PASSWORD))
    issue("SEED_ADMIN_PASSWORD", "SEED_ADMIN_PASSWORD must not use a development placeholder in production.");
  if (value.INTEGRATION_KEYS_SECRET && (value.INTEGRATION_KEYS_SECRET.startsWith("replace-with") || value.INTEGRATION_KEYS_SECRET.length < 32))
    issue("INTEGRATION_KEYS_SECRET", "INTEGRATION_KEYS_SECRET must be at least 32 random characters, not the example placeholder.");

  // HINTEK's QA rules for a production build on a loopback address (none in a community installation).
  if (loopback && INSTANCE_DEFAULTS.loopbackTestDatabase) {
    if (databaseName !== INSTANCE_DEFAULTS.loopbackTestDatabase)
      issue("DATABASE_URL", "A loopback production build may only use the isolated kfid_v3_test database.");
    if (value.INVITATION_DELIVERY_ENABLED)
      issue("INVITATION_DELIVERY_ENABLED", "Invitation delivery must remain disabled in a loopback production build.");
    if (value.BILLING_EMAIL_DELIVERY_ENABLED)
      issue("BILLING_EMAIL_DELIVERY_ENABLED", "Billing email delivery must remain disabled in a loopback production build.");
    if (value.ROUND_EMAIL_DELIVERY_ENABLED)
      issue("ROUND_EMAIL_DELIVERY_ENABLED", "Round reminder email delivery must remain disabled in a loopback production build.");
    if (value.ALERT_EMAIL_DELIVERY_ENABLED)
      issue("ALERT_EMAIL_DELIVERY_ENABLED", "Alert email delivery must remain disabled in a loopback production build.");
    if (value.PILOT_ACCESS_EMAILS.trim())
      issue("PILOT_ACCESS_EMAILS", "No real pilot identity may be enabled on a loopback QA instance.");
    if (value.STRIPE_CARD_RETRY_ENABLED)
      issue("STRIPE_CARD_RETRY_ENABLED", "Card retries must remain disabled in a loopback production build.");
  } else if (!loopback && appUrl.protocol !== "https:") {
    issue("APP_URL", "A non-loopback production APP_URL must use HTTPS.");
  }

  if (Boolean(value.GOOGLE_CLIENT_ID) !== Boolean(value.GOOGLE_CLIENT_SECRET))
    issue("GOOGLE_CLIENT_SECRET", "Google client ID and secret must either both be set or both be absent.");

  if (value.ALERT_EMAIL_DELIVERY_ENABLED && !value.ALERT_EMAIL)
    issue("ALERT_EMAIL", "Alert delivery needs the address that receives the alerts.");
  if (value.INVITATION_DELIVERY_ENABLED || value.BILLING_EMAIL_DELIVERY_ENABLED || value.ROUND_EMAIL_DELIVERY_ENABLED || value.ALERT_EMAIL_DELIVERY_ENABLED) {
    if (LOOPBACK_HOSTS.has(value.SMTP_HOST))
      issue("SMTP_HOST", "Invitation delivery requires a non-loopback SMTP host in production.");
    if (!value.SMTP_USER || value.SMTP_USER === "replace-with-smtp-user")
      issue("SMTP_USER", "Invitation delivery requires explicit SMTP credentials in production.");
    if (!value.SMTP_PASS || value.SMTP_PASS === "replace-with-smtp-password")
      issue("SMTP_PASS", "Invitation delivery requires explicit SMTP credentials in production.");
  }

  if ((value.STRIPE_CHECKOUT_ENABLED || value.STRIPE_PORTAL_ENABLED) && !value.STRIPE_SANDBOX_ENABLED && !value.STRIPE_LIVE_ENABLED)
    issue("STRIPE_SANDBOX_ENABLED", "Checkout and Portal require the explicitly enabled sandbox or live Stripe.");
  if (value.STRIPE_LIVE_ENABLED) {
    if (value.STRIPE_SANDBOX_ENABLED) issue("STRIPE_LIVE_ENABLED", "Live Stripe and the Stripe sandbox cannot be enabled together.");
    if (loopback) issue("STRIPE_LIVE_ENABLED", "Live Stripe may never run on a loopback address.");
    if (databaseName === "kfid_v3_test") issue("STRIPE_LIVE_ENABLED", "Live Stripe may never use the kfid_v3_test database.");
    if (!value.STRIPE_SECRET_KEY?.startsWith("sk_live_") && !value.STRIPE_SECRET_KEY?.startsWith("rk_live_"))
      issue("STRIPE_SECRET_KEY", "Live Stripe requires a live-mode secret or restricted key.");
    if (!value.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) issue("STRIPE_WEBHOOK_SECRET", "Live Stripe requires the webhook signing secret.");
  }
  if (value.STRIPE_SANDBOX_ENABLED) {
    if (!loopback || databaseName !== "kfid_v3_test")
      issue("STRIPE_SANDBOX_ENABLED", "Stripe sandbox may only run on loopback with kfid_v3_test.");
    if (!value.STRIPE_SECRET_KEY?.startsWith("sk_test_"))
      issue("STRIPE_SECRET_KEY", "Stripe sandbox requires a test-mode secret key.");
  }
  if (value.STRIPE_CARD_RETRY_ENABLED && !value.STRIPE_SANDBOX_ENABLED && !value.STRIPE_LIVE_ENABLED)
    issue("STRIPE_CARD_RETRY_ENABLED", "Card retries require the Stripe sandbox or live Stripe.");
  if (value.OPENAI_PROVIDER_ENABLED && !value.OPENAI_API_KEY?.startsWith("sk-"))
    issue("OPENAI_API_KEY", "The OpenAI provider requires an explicit server-side API key.");
  if (value.OPENAI_PROVIDER_ENABLED && !value.OPENAI_DPA_APPROVED)
    issue(
      "OPENAI_DPA_APPROVED",
      "The OpenAI provider requires explicit confirmation of the applicable data-processing agreement and legal basis.",
    );
  if (value.OPENAI_PROVIDER_ENABLED && !value.OPENAI_PROVIDER_EVAL_APPROVED)
    issue(
      "OPENAI_PROVIDER_EVAL_APPROVED",
      "The OpenAI provider requires an explicitly approved synthetic provider evaluation.",
    );
  if (value.OPENAI_PROVIDER_ENABLED && value.OPENAI_PROCESSING_REGION === "EU" && !value.OPENAI_EU_DATA_CONTROLS_APPROVED)
    issue(
      "OPENAI_EU_DATA_CONTROLS_APPROVED",
      "The OpenAI provider requires explicit confirmation that EU data controls are approved for the project.",
    );
  if (value.OPENAI_EVAL_ENABLED) {
    if (value.OPENAI_PROVIDER_ENABLED)
      issue("OPENAI_EVAL_ENABLED", "OpenAI eval mode requires the normal provider to remain disabled.");
    if (!loopback || databaseName !== "kfid_v3_test")
      issue("OPENAI_EVAL_ENABLED", "OpenAI eval mode may only run on loopback with kfid_v3_test.");
    if (!value.OPENAI_API_KEY?.startsWith("sk-"))
      issue("OPENAI_API_KEY", "OpenAI eval mode requires an explicit server-side API key.");
    if (value.OPENAI_PROCESSING_REGION === "EU" && !value.OPENAI_EU_DATA_CONTROLS_APPROVED)
      issue("OPENAI_EU_DATA_CONTROLS_APPROVED", "OpenAI eval mode requires verified EU data controls.");
  }
});

export function parseEnv(source: NodeJS.ProcessEnv) {
  return envSchema.parse(source);
}

export const env = parseEnv(process.env);

export function absoluteUrl(pathname: string) {
  return new URL(pathname, env.APP_URL).toString();
}
