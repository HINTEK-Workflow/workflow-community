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
  const passwordCipher = input.clearPassword ? undefined
    : input.password ? sealPassword(input.password, secret()) : current.passwordCipher;
  const next: StoredMail = {
    host: input.host || undefined,
    port: input.port,
    secure: input.secure,
    user: input.user,
    passwordCipher,
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
