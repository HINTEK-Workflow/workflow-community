import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * Gemensam försegling med nyckelring (2026-10-25, beslut 3a): one sealing function for every
 * value the installation keeps encrypted at rest – Workflow's central keys, the companies' external keys (through their
 * data keys), TOTP secrets and the staff register's identity numbers.
 *
 * - Format v2: `v2.<kid>.<iv>.<tag>.<data>` (base64url). AES-256-GCM, a key per purpose derived with HKDF-SHA256 from
 *   the ring's secret, and the purpose plus a context (the field, the company, the person) as additional data, so a
 *   sealed value copied to another field, company or person cannot be opened there.
 * - The kid names which secret in the ring sealed it (a keyed fingerprint, never the secret), so a rotation knows what
 *   is left on the old one.
 * - The ring: the current secret seals; it and the previous ones open. A rotation adds a new current secret, keeps the
 *   old one as previous, reseals everything (scripts/secrets/reseal.ts) and only then drops the old one.
 * - The older formats (v1 from before 2026-10-25: two derivations, no kid, no context) are still opened with every
 *   secret in the ring, so nothing becomes unreadable while it is resealed.
 *
 * Pure: the ring is an argument; lib/security/key-ring.ts reads it from the environment. Never logs or returns a secret.
 */
export type KeyRing = { current: string; previous: string[] };

export const SEAL_PURPOSES = ["central", "totp", "staff-register", "org-data-key", "integration-key", "vault-quarantine", "invoice-identity"] as const;
export type SealPurpose = (typeof SEAL_PURPOSES)[number];

/** The older v1 sealings each purpose may still meet (what wrote it before 2026-10-25). */
type Legacy = { kind: "hkdf" } | { kind: "label"; label: string; prefix: string };
const LEGACY: Record<SealPurpose, Legacy[]> = {
  // Servernycklar, SMTP, SCB, kartan, adressuppslaget (label workflow-mail-settings), Microsoft (prefix microsoft:),
  // webbpush (workflow-push-settings) and the AI keys (HKDF integration-keys-v1).
  central: [
    { kind: "label", label: "workflow-mail-settings", prefix: "" },
    { kind: "label", label: "workflow-mail-settings", prefix: "microsoft:" },
    { kind: "label", label: "workflow-push-settings", prefix: "" },
    { kind: "hkdf" },
  ],
  totp: [{ kind: "label", label: "workflow-mail-settings", prefix: "totp:" }],
  "staff-register": [{ kind: "label", label: "workflow-mail-settings", prefix: "staff-register:" }],
  "org-data-key": [],
  "integration-key": [{ kind: "hkdf" }],
  "vault-quarantine": [],
  "invoice-identity": [],
};

const MIN_SECRET = 16;

/** A secret's id in sealed values: 8 hex characters of a keyed hash (reveals nothing about the secret). */
export function keyId(secret: string) {
  return createHmac("sha256", secret).update("hintek-workflow-kid-v2").digest("hex").slice(0, 8);
}

const purposeKey = (secret: string, purpose: SealPurpose) =>
  Buffer.from(hkdfSync("sha256", secret, "hintek-workflow-seal-v2", `seal-v2:${purpose}`, 32));
const aad = (purpose: SealPurpose, context: string) => Buffer.from(`${purpose}\n${context}`, "utf8");

/** The secrets of a ring, current first, without blanks or repeats. */
export function ringSecrets(ring: KeyRing) {
  return [ring.current, ...ring.previous].filter((secret, index, all) => secret && secret.length >= MIN_SECRET && all.indexOf(secret) === index);
}

/** Seals a value with the ring's current secret, bound to the purpose and the context. */
export function seal(purpose: SealPurpose, value: string, context: string, ring: KeyRing) {
  if (!ring.current || ring.current.length < MIN_SECRET) throw new Error("Serverns hemlighet för förseglingen saknas.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", purposeKey(ring.current, purpose), iv);
  cipher.setAAD(aad(purpose, context));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v2", keyId(ring.current), iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export type Opened =
  | { ok: true; value: string; /** Sealed with the current secret in the v2 format: nothing to reseal. */ current: boolean }
  | { ok: false; reason: "empty" | "format" | "unreadable" };

const gcmOpen = (key: Buffer, iv: Buffer, tag: Buffer, data: Buffer, additional?: Buffer) => {
  if (iv.length !== 12 || tag.length !== 16) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    if (additional) decipher.setAAD(additional);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
};

function openLegacy(legacy: Legacy, parts: string[], secret: string) {
  const [, iv, tag, data] = parts;
  if (legacy.kind === "hkdf") {
    const key = Buffer.from(hkdfSync("sha256", secret, "hintek-workflow", "integration-keys-v1", 32));
    return gcmOpen(key, Buffer.from(iv, "base64url"), Buffer.from(tag, "base64url"), Buffer.from(data, "base64url"));
  }
  const key = createHash("sha256").update(`${legacy.label}:${legacy.prefix}${secret}`).digest();
  return gcmOpen(key, Buffer.from(iv, "base64"), Buffer.from(tag, "base64"), Buffer.from(data, "base64"));
}

/**
 * Opens a sealed value of either format with any secret in the ring. `current` is false for an older format or another
 * secret than the current one – the reseal script's work list. An unreadable value is never guessed at.
 */
export function open(purpose: SealPurpose, sealed: string | null | undefined, context: string, ring: KeyRing): Opened {
  if (!sealed) return { ok: false, reason: "empty" };
  const parts = sealed.split(".");
  const secrets = ringSecrets(ring);
  if (parts[0] === "v2" && parts.length === 5) {
    const [, kid, iv, tag, data] = parts;
    // The kid picks the secret; the others are not tried (a v2 value always names its secret).
    const secret = secrets.find((candidate) => keyId(candidate) === kid);
    if (!secret) return { ok: false, reason: "unreadable" };
    const value = gcmOpen(purposeKey(secret, purpose), Buffer.from(iv, "base64url"), Buffer.from(tag, "base64url"), Buffer.from(data, "base64url"), aad(purpose, context));
    return value === null ? { ok: false, reason: "unreadable" } : { ok: true, value, current: secret === ring.current };
  }
  if (parts[0] === "v1" && parts.length === 4 && parts.every(Boolean)) {
    for (const legacy of LEGACY[purpose]) {
      for (const secret of secrets) {
        const value = openLegacy(legacy, parts, secret);
        if (value !== null) return { ok: true, value, current: false };
      }
    }
    return { ok: false, reason: "unreadable" };
  }
  return { ok: false, reason: "format" };
}

/** The kid a sealed value names, "v1" for the older format, null when it is not a sealed value. */
export function sealedKeyId(sealed: string | null | undefined) {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts[0] === "v2" && parts.length === 5) return parts[1];
  if (parts[0] === "v1" && parts.length === 4) return "v1";
  return null;
}
