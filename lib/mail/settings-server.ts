import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { centralSecret, saveCentralSecret, type CentralActor } from "@/lib/secrets/central-store";
import { INSTANCE_DEFAULTS } from "@/lib/instance-defaults";
import {
  effectiveMailConfig,
  mailSettingsInput,
  parseStoredMail,
  type MailConfig,
  type StoredMail,
} from "@/lib/mail/settings";

// The SMTP password is a central key (lib/secrets/central-store.ts, 2026-10-25): sealed with the key ring, in serverlagring
// kept in its key vault where it has one; SystemSettings.mail keeps the server, the sender and the switches.

async function readStored(): Promise<StoredMail> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { mail: true } });
  return parseStoredMail(row?.mail);
}

/** The e-mail settings that apply now (the app's where saved, otherwise .env). */
export async function mailConfig(): Promise<MailConfig> {
  const stored = await readStored();
  return effectiveMailConfig(stored, env, {
    password: stored.host ? await centralSecret("smtp.password") : "",
    loopbackQa: Boolean(INSTANCE_DEFAULTS.loopbackTestDatabase),
  });
}

/** Saves the superadmin's settings; an empty password keeps the saved one. */
export async function saveMailSettings(raw: unknown, actor: CentralActor) {
  const input = mailSettingsInput.parse(raw);
  const current = await readStored();
  // An empty server means "use .env": nothing of the app's SMTP account is kept. The bin removes the password wherever
  // it came from, a new password replaces it (2026-10-03). The password first: when it cannot be saved (the key vault
  // not answering), nothing of the save is kept.
  if (input.password) await saveCentralSecret("smtp.password", input.password, actor);
  else if (input.clearPassword || !input.host) {
    if (current.passwordCipher || await centralSecret("smtp.password")) await saveCentralSecret("smtp.password", null, actor);
  }
  const passwordCipher = input.password || input.clearPassword || !input.host ? undefined : current.passwordCipher;
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
    notices: input.notices ?? current.notices,
    alertEmail: input.alertEmail,
    updatedAt: new Date().toISOString(),
  };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { mail: next }, create: { id: "global", mail: next } });
}
