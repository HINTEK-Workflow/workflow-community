import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Formulärets tidsstämpel (2026-11-12, made general 2026-11-13): a public form gets a signed time stamp when it is shown, and
 * a send faster than a person types counts as a robot. The purpose is part of the signature, so a stamp issued for one form
 * (the newsletter) is never accepted by another (a report).
 */
export const MIN_FILL_MS = 2_000;
export const MAX_STAMP_AGE_MS = 6 * 3600_000;

const signStamp = (purpose: string, issued: number) => createHmac("sha256", env.AUTH_SECRET).update(`${purpose}:${issued}`).digest("base64url");

/** Issued when the form is shown. */
export const issueFormStamp = (purpose: string, now = Date.now()) => `${now}.${signStamp(purpose, now)}`;

/** ok: signed for this purpose, at least MIN_FILL_MS old and not older than MAX_STAMP_AGE_MS; fast: filled in quicker than a person does. */
export function checkFormStamp(purpose: string, stamp: unknown, now = Date.now()): "ok" | "fast" | "invalid" {
  if (typeof stamp !== "string" || stamp.length > 100) return "invalid";
  const [issuedText, signature] = stamp.split(".");
  const issued = Number(issuedText);
  if (!Number.isSafeInteger(issued) || !signature) return "invalid";
  const expected = Buffer.from(signStamp(purpose, issued));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
  if (now - issued > MAX_STAMP_AGE_MS || issued > now + 60_000) return "invalid";
  return now - issued < MIN_FILL_MS ? "fast" : "ok";
}
