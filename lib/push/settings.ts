import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { validVapidSubject } from "@/lib/push/web-push";

/**
 * Webbpush (2026-10-07): the installation's VAPID key pair and on/off are set in the app by the superadmin
 * (Installation → E-post), not in .env text: the private key is sealed with AES-256-GCM like the SMTP password
 * and never leaves the server; the page only learns whether keys exist and shows the public key. Pure: takes the stored
 * value as an argument. `SystemSettings.push` holds it.
 */
export const storedPushSchema = z.object({
  enabled: z.boolean().optional(),
  /** The public key the browsers subscribe with (base64url, 65 bytes). */
  publicKey: z.string().max(200).optional(),
  /** The sealed private key. */
  privateKeyCipher: z.string().max(4000).optional(),
  /** A mailto: or https: address the push services can reach the sender on (RFC 8292); empty = the sender's e-mail address. */
  subject: z.string().trim().max(320).optional(),
  keysCreatedAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type StoredPush = z.infer<typeof storedPushSchema>;

export const parseStoredPush = (value: unknown): StoredPush => {
  const parsed = storedPushSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

/** What the superadmin sends when saving: on or off and the contact address (empty = the e-mail sender's address). */
export const pushSettingsInput = z.object({
  enabled: z.boolean(),
  subject: z.string().trim().max(320).refine((value) => value === "" || validVapidSubject(value), "Ange en adress som börjar med mailto: eller https://."),
});

/** The contact address pushes are signed with: the one chosen, otherwise the e-mail sender's address; "" when neither fits. */
export function effectivePushSubject(stored: Pick<StoredPush, "subject">, fromAddress: string) {
  if (stored.subject && validVapidSubject(stored.subject)) return stored.subject;
  const fallback = `mailto:${fromAddress}`;
  return validVapidSubject(fallback) && !/@example\.com$/i.test(fromAddress) ? fallback : "";
}

export const pushHasKeys = (stored: StoredPush) => Boolean(stored.publicKey && stored.privateKeyCipher);

/** What the page may show: never the private key, only whether keys exist and the public one. */
export function publicPushSettings(stored: StoredPush, options: { fromAddress: string; blockedReason: string | null }) {
  const hasKeys = pushHasKeys(stored);
  const subject = effectivePushSubject(stored, options.fromAddress);
  return {
    enabled: Boolean(stored.enabled && hasKeys),
    hasKeys,
    publicKey: hasKeys ? stored.publicKey! : "",
    subject: stored.subject ?? "",
    effectiveSubject: subject,
    keysCreatedAt: stored.keysCreatedAt ?? null,
    /** Pushes can actually be sent: switched on, keys, a contact address and not a loopback test instance. */
    ready: Boolean(stored.enabled && hasKeys && subject && !options.blockedReason),
    blockedReason: options.blockedReason,
  };
}
export type PublicPushSettings = ReturnType<typeof publicPushSettings>;

// The private key is sealed under a key derived from the installation's secret (the one that protects the SMTP password).
const keyFrom = (secret: string) => createHash("sha256").update(`workflow-push-settings:${secret}`).digest();

export function sealPushKey(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function openPushKey(sealed: string | undefined, secret: string) {
  if (!sealed) return "";
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) return "";
  try {
    const ivBytes = Buffer.from(iv, "base64");
    const tagBytes = Buffer.from(tag, "base64");
    // The 96-bit IV and the whole 128-bit tag, checked before decrypting (granskningen Codex 2026-10-21).
    if (ivBytes.length !== 12 || tagBytes.length !== 16) return "";
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), ivBytes, { authTagLength: 16 });
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
