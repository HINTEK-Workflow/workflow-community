import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Tvåstegsverifiering (2026-10-10): TOTP after RFC 6238 on node:crypto – HMAC-SHA1, 30-second steps, six digits – the
 * same codes Microsoft Authenticator, Google Authenticator and every other authenticator app show. No dependency.
 * A code is accepted one step before or after the server's clock (±30 s), and never twice: the caller stores the step
 * of the last accepted code and passes it back, and only a later step is accepted.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array) {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Ogiltig nyckel.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits, the RFC's recommendation) as base32. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_STEP_SECONDS);

/** The six-digit code for one step (RFC 4226 dynamic truncation). */
export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** Digits only: spaces and dashes the person typed are ignored. */
export const normalizeTotpInput = (code: string) => code.replace(/[\s-]/g, "");
export const looksLikeTotp = (code: string) => /^\d{6}$/.test(normalizeTotpInput(code));

/**
 * The step the code belongs to, or null. Accepts ±TOTP_WINDOW steps around now; a step at or before `lastStep` (already
 * used) is refused, so a code seen over someone's shoulder cannot be used again.
 */
export function verifyTotp(secret: string, code: string, options: { now?: number; lastStep?: number | null } = {}) {
  const given = normalizeTotpInput(code);
  if (!/^\d{6}$/.test(given)) return null;
  const current = totpStep(options.now);
  let match: number | null = null;
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
    const step = current + offset;
    // Compare every candidate in constant time, so the answer's timing does not tell which step matched.
    const equal = timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(given));
    if (equal && match === null && (options.lastStep == null || step > options.lastStep)) match = step;
  }
  return match;
}

/** The otpauth:// address the QR code carries; the app shows "issuer (account)". */
export function totpUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The secret in groups of four, easier to type by hand. */
export const groupedSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;
