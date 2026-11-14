import { env } from "@/lib/env";
import { keyId, open, ringSecrets, seal, type KeyRing, type SealPurpose } from "@/lib/security/sealing";

/**
 * The installation's key ring (2026-10-25, lib/security/sealing.ts): INTEGRATION_KEYS_SECRET seals and opens (AUTH_SECRET
 * when it is not set – exactly the secret every module used before the ring); INTEGRATION_KEYS_SECRET_PREVIOUS only opens.
 * Nothing else is ever tried: a value that could not be opened before the ring stays unopened, so an old key can never
 * come back and take precedence over the one that applies (QA showed it, 2026-10-25). A rotation names the old secret
 * in INTEGRATION_KEYS_SECRET_PREVIOUS on purpose. Values only ever live in the environment.
 */
let ringOverride: KeyRing | null = null;

/** Tests only (never in production): another ring, to try a rotation and its way back. */
export function setKeyRingForTests(ring: KeyRing | null) {
  if (env.NODE_ENV === "production") throw new Error("Bara i tester.");
  ringOverride = ring;
}

export function keyRing(): KeyRing {
  if (ringOverride) return ringOverride;
  const current = env.INTEGRATION_KEYS_SECRET || env.AUTH_SECRET;
  const previous = (env.INTEGRATION_KEYS_SECRET_PREVIOUS ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return { current, previous };
}

/** Every secret in the ring, current first – for the keyed hashes (backup codes, lookups) that are checked, not opened. */
export const ringHashSecrets = () => ringSecrets(keyRing());

/** What the status page may say about the ring: ids and counts, never a secret. */
export function keyRingStatus() {
  const ring = keyRing();
  return {
    currentKeyId: keyId(ring.current),
    /** The sealing secret is its own, not the session secret (M2 in the utredning 2026-10-25). */
    separate: Boolean(env.INTEGRATION_KEYS_SECRET) && env.INTEGRATION_KEYS_SECRET !== env.AUTH_SECRET,
    previousCount: ringSecrets(ring).length - 1,
  };
}

/**
 * The ids an emergency copy of .env is compared with (lib/secrets/emergency-copy.ts): AUTH_SECRET's and the secret the
 * ring seals with – the same as the AUTH_SECRET and "Förseglar med nyckel-id" lines of scripts/secrets/key-fingerprint.cjs
 * (which trims, as the environment does). Never a secret.
 */
export function currentKeyIds() {
  return { authKeyId: keyId((env.AUTH_SECRET ?? "").trim()), sealKeyId: keyId(keyRing().current.trim()) };
}

// Sealed values that could not be opened since the process started: where, and when first seen. Never the value.
const unreadable = new Map<string, string>();

export function noteUnreadable(where: string) {
  if (!unreadable.has(where)) unreadable.set(where, new Date().toISOString());
}

/** The places whose sealed value could not be opened (for the status page and the alarm). */
export const unreadableValues = () => [...unreadable.entries()].map(([where, since]) => ({ where, since }));
export const clearUnreadable = (where: string) => unreadable.delete(where);

export function sealValue(purpose: SealPurpose, value: string, context: string) {
  return seal(purpose, value, context, keyRing());
}

/**
 * Opens a sealed value, "" when there is none. A value that is there but cannot be opened is no longer silent
 * (utredningen 2026-10-25, brist 4): it is noted under `where` for the status page and the alarm, and still gives "".
 */
export function openValue(purpose: SealPurpose, sealed: string | null | undefined, context: string, where: string) {
  const result = open(purpose, sealed, context, keyRing());
  if (result.ok) {
    clearUnreadable(where);
    return result.value;
  }
  if (result.reason !== "empty") noteUnreadable(where);
  return "";
}
