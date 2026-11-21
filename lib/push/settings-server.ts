import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { mailConfig } from "@/lib/mail/settings-server";
import { centralSecret, saveCentralSecret, type CentralActor } from "@/lib/secrets/central-store";
import {
  effectivePushSubject,
  parseStoredPush,
  publicPushSettings,
  pushHasKeys,
  pushSettingsInput,
  type StoredPush,
} from "@/lib/push/settings";
import { generateVapidKeys, validVapidKeys, type VapidKeys } from "@/lib/push/web-push";

// The private key is a central key (lib/secrets/central-store.ts, 2026-10-25); SystemSettings.push keeps the public key,
// the contact address and on/off. The pure helpers see a marker where the private key is, never the key.
async function readStoredPush(): Promise<StoredPush> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { push: true } });
  return parseStoredPush(row?.push);
}

export async function readPushSettings(): Promise<StoredPush> {
  const [stored, privateKey] = await Promise.all([readStoredPush(), centralSecret("push.privateKey")]);
  return { ...stored, privateKeyCipher: privateKey ? "central" : undefined };
}

async function writePushSettings(next: StoredPush) {
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { push: next }, create: { id: "global", push: next } });
}

/** What the superadmin's page shows: whether pushes are on, the public key, never the private one. */
export async function currentPushSettings() {
  const [stored, mail] = await Promise.all([readPushSettings(), mailConfig()]);
  // A loopback QA instance never sends mail, and never pushes either (the same rule, worded for push).
  return publicPushSettings(stored, { fromAddress: mail.from.address, blockedReason: mail.blockedReason ? "Push skickas aldrig från en lokal testinstans." : null });
}

/** The keys and contact address pushes are signed with, or null while pushes are off, incomplete or the keys cannot be opened. */
export async function loadPushConfig(): Promise<{ keys: VapidKeys; subject: string } | null> {
  const [stored, mail] = await Promise.all([readPushSettings(), mailConfig()]);
  if (!stored.enabled || !pushHasKeys(stored)) return null;
  const subject = effectivePushSubject(stored, mail.from.address);
  const keys = { publicKey: stored.publicKey!, privateKey: await centralSecret("push.privateKey") };
  return subject && validVapidKeys(keys) ? { keys, subject } : null;
}

/** On or off and the contact address. Switching on needs keys and a contact address to sign with. */
export async function savePushSettings(raw: unknown) {
  const input = pushSettingsInput.parse(raw);
  const [current, saved, mail] = await Promise.all([readPushSettings(), readStoredPush(), mailConfig()]);
  const next: StoredPush = { ...saved, enabled: input.enabled, subject: input.subject || undefined, updatedAt: new Date().toISOString() };
  if (input.enabled && !pushHasKeys(current)) throw new ApiError(409, "Skapa nycklarna först.");
  if (input.enabled && !effectivePushSubject(next, mail.from.address)) throw new ApiError(409, "Ange en kontaktadress som börjar med mailto: eller https://.");
  await writePushSettings(next);
}

/**
 * Creates a new key pair. The devices that said yes to push are bound to the old public key, so they are removed with it
 * and the people must switch push on again; that is why replacing existing keys has to be asked for.
 */
export async function generatePushKeys(options: { replace: boolean }, actor: CentralActor) {
  const current = await readPushSettings();
  if (pushHasKeys(current) && !options.replace) throw new ApiError(409, "Det finns redan nycklar. Att byta dem tar bort alla enheter som tagit emot push.");
  const keys = generateVapidKeys();
  const now = new Date().toISOString();
  // The private key first (in the key vault too, where the installation has one): when that fails the old pair stays as it was.
  await saveCentralSecret("push.privateKey", keys.privateKey, actor);
  await writePushSettings({ ...(await readStoredPush()), publicKey: keys.publicKey, privateKeyCipher: undefined, keysCreatedAt: now, updatedAt: now });
  const [removed] = await prisma.$transaction([
    prisma.pushSubscription.deleteMany({}),
    prisma.noticePreference.updateMany({ where: { push: true }, data: { push: false } }),
  ]);
  return { publicKey: keys.publicKey, removedDevices: removed.count };
}
