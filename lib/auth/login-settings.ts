import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

// Inloggning (2026-10-03): the superadmin can switch off "Fortsätt med Google" on the login page. The server
// refuses a Google sign-in while it is off; hiding the button is not enough.
let cached: { at: number; value: boolean } | null = null;

export async function googleSignInAllowed() {
  if (cached && Date.now() - cached.at < 15_000) return cached.value;
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { googleSignIn: true } });
  const value = row?.googleSignIn ?? true;
  cached = { at: Date.now(), value };
  return value;
}

export async function setGoogleSignInAllowed(value: boolean) {
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { googleSignIn: value }, create: { id: "global", googleSignIn: value } });
  cached = null;
}

export const googleKeysConfigured = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
