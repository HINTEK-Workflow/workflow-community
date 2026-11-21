import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export function hashPassword(password: string) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** A bcrypt hash of a random value no one knows (cost 12), compared when the account does not exist. */
export const DUMMY_PASSWORD_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5lR8Zq2mVAt3y7Gm0E0x5Wq1o2X7pKa";
/** The error a sign-in gets while the address or the IP address is over its limit; the form explains it. */
export const LOGIN_RATE_LIMITED = "RATE_LIMITED";
/**
 * The error a sign-in gets while the shared sign-in counter cannot be reached (2026-10-11): the sign-in is refused,
 * never let through uncounted, and the form says calmly to try again in a while.
 */
export const LOGIN_UNAVAILABLE = "TRY_AGAIN_LATER";
