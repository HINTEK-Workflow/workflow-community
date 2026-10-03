import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { canAccessTest } from "@/lib/auth/access";
import { normalizeEmail } from "@/lib/auth/service";

// Koppla Google-konto (2026-10-03: "min privata och backupmail"): a signed-in person links another Google
// account – any address – to their own account, so it signs them in as themselves. The intent travels in a short-lived,
// signed, httpOnly cookie set by the person's own session; nobody else can link to an account.

export const GOOGLE_LINK_COOKIE = "wf-google-link";
const TTL_SECONDS = 600;

const sign = (payload: string) => createHmac("sha256", env.AUTH_SECRET).update(`google-link:${payload}`).digest("base64url");

export function createLinkIntent(userId: string, now = Date.now()) {
  const payload = `${userId}.${Math.floor(now / 1000) + TTL_SECONDS}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: TTL_SECONDS };
}

export function readLinkIntent(value: string | undefined, now = Date.now()): string | null {
  const [userId, expires, signature] = (value ?? "").split(".");
  if (!userId || !expires || !signature) return null;
  const expected = Buffer.from(sign(`${userId}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(expires) * 1000 > now ? userId : null;
}

export type LinkProfile = { sub?: string; email?: string; email_verified?: boolean; picture?: string; hd?: string };

/** Links the Google account to the person, unless it already belongs to someone else. */
export async function linkGoogleAccount(userId: string, profile: LinkProfile | undefined): Promise<{ ok: true } | { ok: false; error: string }> {
  const providerAccountId = String(profile?.sub ?? "").trim();
  const email = normalizeEmail(String(profile?.email ?? ""));
  if (!providerAccountId || !email) return { ok: false, error: "google_missing_email" };
  if (profile?.email_verified !== true) return { ok: false, error: "google_unverified_email" };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isActive: true } });
  if (!canAccessTest(user)) return { ok: false, error: "test_access" };
  const existing = await prisma.authAccount.findUnique({ where: { provider_providerAccountId: { provider: "google", providerAccountId } }, select: { userId: true } });
  if (existing && existing.userId !== userId) return { ok: false, error: "google_linked_elsewhere" };
  if (!existing)
    await prisma.authAccount.create({ data: { userId, provider: "google", providerAccountId, email, hostedDomain: profile?.hd ?? null, avatarUrl: profile?.picture ?? null, lastUsedAt: new Date() } });
  return { ok: true };
}
