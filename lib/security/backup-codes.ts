import { createHmac, hkdfSync, randomInt } from "node:crypto";

/**
 * Reservkoder (2026-10-10): ten one-time codes shown once when two-factor sign-in is turned on or the codes are renewed.
 * Each code is ten characters from an alphabet without look-alikes (about 50 bits). Only a keyed hash is stored –
 * HMAC-SHA256 under a key derived from the installation's secret, with the person's id in the message – so a copy of
 * the database alone cannot be used to try codes, and the same code for two people gives two different hashes.
 */
export const BACKUP_CODE_COUNT = 10;
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O, 1/I
const LENGTH = 10;

export function newBackupCodes(count = BACKUP_CODE_COUNT) {
  return Array.from({ length: count }, () => {
    let code = "";
    for (let index = 0; index < LENGTH; index++) code += ALPHABET[randomInt(ALPHABET.length)];
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/** Upper case, without the spaces and dashes the person may type. */
export const normalizeBackupCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, "");
export const looksLikeBackupCode = (code: string) => new RegExp(`^[${ALPHABET}]{${LENGTH}}$`).test(normalizeBackupCode(code));

const keyFrom = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "hintek-workflow", "backup-codes-v1", 32));

export function hashBackupCode(userId: string, code: string, secret: string) {
  return createHmac("sha256", keyFrom(secret)).update(`${userId}:${normalizeBackupCode(code)}`).digest("base64url");
}
