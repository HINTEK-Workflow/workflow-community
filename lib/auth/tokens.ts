import { createHash, randomBytes } from "node:crypto";

export function createRawToken() {
  return randomBytes(32).toString("hex");
}

export function hashToken(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function expiresInMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function expiresInHours(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
