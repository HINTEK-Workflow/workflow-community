import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { INSTANCE_DEFAULTS } from "@/lib/instance-defaults";
import {
  effectiveMailConfig,
  mailSettingsInput,
  openPassword,
  parseStoredMail,
  sealPassword,
  type MailConfig,
  type StoredMail,
} from "@/lib/mail/settings";

// The secret the SMTP password is sealed with: the same one that protects the stored integration keys.
const secret = () => env.INTEGRATION_KEYS_SECRET ?? env.AUTH_SECRET;

async function readStored(): Promise<StoredMail> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { mail: true } });
  return parseStoredMail(row?.mail);
}

/** The e-mail settings that apply now (the app's where saved, otherwise .env). */
export async function mailConfig(): Promise<MailConfig> {
  const stored = await readStored();
  return effectiveMailConfig(stored, env, {
    password: stored.host ? openPassword(stored.passwordCipher, secret()) : "",
    loopbackQa: Boolean(INSTANCE_DEFAULTS.loopbackTestDatabase),
  });
}

/** Saves the superadmin's settings; an empty password keeps the saved one. */
export async function saveMailSettings(raw: unknown) {
  const input = mailSettingsInput.parse(raw);
  const current = await readStored();
  // An empty server means "use .env": nothing of the app's SMTP account is kept. The bin removes the password wherever
  // it came from, a new password replaces it (2026-10-03).
  const passwordCipher = input.password ? sealPassword(input.password, secret())
    : input.clearPassword || !input.host ? undefined : current.passwordCipher;
  const noPassword = input.password ? undefined : input.clearPassword ? true : input.host ? current.noPassword : undefined;
  const next: StoredMail = {
    host: input.host || undefined,
    port: input.port,
    secure: input.secure,
    user: input.host ? input.user : "",
    passwordCipher,
    noPassword,
    fromName: input.fromName,
    fromAddress: input.fromAddress,
    invitations: input.invitations,
    roundReminders: input.roundReminders,
    alerts: input.alerts,
    alertEmail: input.alertEmail,
    updatedAt: new Date().toISOString(),
  };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { mail: next }, create: { id: "global", mail: next } });
}
