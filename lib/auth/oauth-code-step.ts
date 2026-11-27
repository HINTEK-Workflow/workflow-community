import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { GoogleOAuthProfile } from "@/lib/auth/oauth";
import type { MicrosoftClaims } from "@/lib/auth/microsoft-core";

/**
 * Koden efter Google eller Microsoft (säkerhetsgranskningen 2026-11-24, G-09): when the account has two-factor on, a Google or
 * Microsoft sign-in gives no session by itself. The provider's answer waits in a short-lived, signed, httpOnly cookie; the
 * login page asks for the code, and only a right code (the provider "oauth-code" in lib/auth/config.ts) finishes the sign-in
 * – and, for Google, makes a first link to the account. The cookie holds the provider's own profile fields, never a secret.
 */
export const OAUTH_CODE_COOKIE = "wf-oauth-code";
export const OAUTH_CODE_STEP_SECONDS = 300;
export const OAUTH_CODE_EXPIRED = "OAUTH_CODE_EXPIRED";

export type OAuthCodeStep =
  | { userId: string; provider: "google"; profile: GoogleOAuthProfile }
  | { userId: string; provider: "microsoft"; profile: MicrosoftClaims };

const sign = (payload: string) => createHmac("sha256", env.AUTH_SECRET).update(`oauth-code:${payload}`).digest("base64url");

export function createOAuthCodeStep(step: OAuthCodeStep, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ ...step, expires: Math.floor(now / 1000) + OAUTH_CODE_STEP_SECONDS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readOAuthCodeStep(value: string | undefined, now = Date.now()): OAuthCodeStep | null {
  const [payload, signature, extra] = (value ?? "").split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { expires, ...step } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthCodeStep & { expires: number };
    if (typeof expires !== "number" || expires * 1000 <= now) return null;
    if (typeof step.userId !== "string" || (step.provider !== "google" && step.provider !== "microsoft") || !step.profile || typeof step.profile !== "object") return null;
    return step;
  } catch {
    return null;
  }
}

/** The cookie's settings: only this site, never readable by the page, gone after five minutes. */
export const oauthCodeCookieOptions = () => ({ httpOnly: true, sameSite: "lax" as const, path: "/", secure: env.APP_URL.startsWith("https://"), maxAge: OAUTH_CODE_STEP_SECONDS });
