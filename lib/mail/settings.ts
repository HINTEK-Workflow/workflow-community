import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * E-post (2026-09-30): the SMTP server, the sender and which mail is sent are set in the app by the superadmin
 * (Produktadministration → E-post) instead of only in the server's .env. What is saved in the app wins; anything not
 * saved falls back to .env, so an installation keeps working as before until someone saves. The password is stored
 * encrypted and never leaves the server. Pure: takes the stored value and the environment as arguments.
 */
export const storedMailSchema = z.object({
  host: z.string().trim().max(253).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().trim().max(320).optional(),
  passwordCipher: z.string().max(4000).optional(),
  fromName: z.string().trim().max(120).optional(),
  fromAddress: z.string().trim().email().max(320).optional(),
  invitations: z.boolean().optional(),
  roundReminders: z.boolean().optional(),
  alerts: z.boolean().optional(),
  alertEmail: z.union([z.literal(""), z.string().trim().email().max(320)]).optional(),
  updatedAt: z.string().optional(),
});
export type StoredMail = z.infer<typeof storedMailSchema>;

export const parseStoredMail = (value: unknown): StoredMail => {
  const parsed = storedMailSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

/** What the superadmin sends when saving; an empty password keeps the saved one, clearPassword removes it. */
export const mailSettingsInput = z.object({
  host: z.string().trim().max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(320),
  password: z.string().max(1000).optional(),
  clearPassword: z.boolean().optional(),
  fromName: z.string().trim().min(1, "Ange avsändarens namn.").max(120),
  fromAddress: z.string().trim().email("Ange avsändarens e-postadress."),
  invitations: z.boolean(),
  roundReminders: z.boolean(),
  alerts: z.boolean(),
  alertEmail: z.union([z.literal(""), z.string().trim().email("Ange en giltig adress för driftlarm.")]),
}).superRefine((value, ctx) => {
  if (value.alerts && !value.alertEmail) ctx.addIssue({ code: "custom", path: ["alertEmail"], message: "Driftlarm behöver en mottagaradress." });
});
export type MailSettingsInput = z.infer<typeof mailSettingsInput>;

export type MailEnv = {
  APP_URL?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  MAIL_FROM_NAME?: string;
  MAIL_FROM_ADDRESS?: string;
  INVITATION_DELIVERY_ENABLED?: boolean;
  ROUND_EMAIL_DELIVERY_ENABLED?: boolean;
  ALERT_EMAIL_DELIVERY_ENABLED?: boolean;
  ALERT_EMAIL?: string;
};

export type MailConfig = {
  /** "app" when the SMTP server is saved in the app, "server" when it comes from .env. */
  source: "app" | "server";
  transport: { host: string; port: number; secure: boolean; user: string; password: string };
  from: { name: string; address: string };
  delivery: { invitations: boolean; roundReminders: boolean; alerts: boolean };
  alertEmail: string;
  /** No mail at all leaves a loopback QA instance (HINTEK's rule), whatever is saved. */
  blockedReason: string | null;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);
const isLoopback = (url: string | undefined) => { try { return LOOPBACK.has(new URL(url ?? "").hostname); } catch { return false; } };

// Saving the E-post page for a switch alone stores the .env server and user without a password (the page never shows
// it); the .env password still applies to that same account, so mail keeps working (2026-10-03).
function sameAccountAsEnv(stored: StoredMail, env: MailEnv) {
  return stored.host === env.SMTP_HOST && (stored.user ?? "") === (env.SMTP_USER ?? "") ? env.SMTP_PASS ?? "" : "";
}

/** The settings that apply: the app's where saved, otherwise .env. */
export function effectiveMailConfig(stored: StoredMail, env: MailEnv, options: { password: string; loopbackQa: boolean }): MailConfig {
  const fromApp = Boolean(stored.host);
  const blockedReason = options.loopbackQa && isLoopback(env.APP_URL)
    ? "E-post skickas aldrig från en lokal testinstans." : null;
  const delivery = {
    invitations: stored.invitations ?? Boolean(env.INVITATION_DELIVERY_ENABLED),
    roundReminders: stored.roundReminders ?? Boolean(env.ROUND_EMAIL_DELIVERY_ENABLED),
    alerts: stored.alerts ?? Boolean(env.ALERT_EMAIL_DELIVERY_ENABLED),
  };
  return {
    source: fromApp ? "app" : "server",
    transport: fromApp
      ? { host: stored.host!, port: stored.port ?? 587, secure: stored.secure ?? false, user: stored.user ?? "", password: options.password || sameAccountAsEnv(stored, env) }
      : { host: env.SMTP_HOST ?? "localhost", port: env.SMTP_PORT ?? 1025, secure: Boolean(env.SMTP_SECURE), user: env.SMTP_USER ?? "", password: env.SMTP_PASS ?? "" },
    from: { name: stored.fromName || env.MAIL_FROM_NAME || "Workflow", address: stored.fromAddress || env.MAIL_FROM_ADDRESS || "noreply@example.com" },
    delivery: blockedReason ? { invitations: false, roundReminders: false, alerts: false } : delivery,
    alertEmail: stored.alertEmail ?? env.ALERT_EMAIL ?? "",
    blockedReason,
  };
}

/** What the E-post page may show: never the password, only whether one is set. */
export function publicMailSettings(config: MailConfig) {
  return {
    source: config.source,
    host: config.transport.host,
    port: config.transport.port,
    secure: config.transport.secure,
    user: config.transport.user,
    hasPassword: Boolean(config.transport.password),
    fromName: config.from.name,
    fromAddress: config.from.address,
    invitations: config.delivery.invitations,
    roundReminders: config.delivery.roundReminders,
    alerts: config.delivery.alerts,
    alertEmail: config.alertEmail,
    blockedReason: config.blockedReason,
  };
}
export type PublicMailSettings = ReturnType<typeof publicMailSettings>;

// The password is sealed with AES-256-GCM under a key derived from the installation's secret.
const keyFrom = (secret: string) => createHash("sha256").update(`workflow-mail-settings:${secret}`).digest();

export function sealPassword(password: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function openPassword(sealed: string | undefined, secret: string) {
  if (!sealed) return "";
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
