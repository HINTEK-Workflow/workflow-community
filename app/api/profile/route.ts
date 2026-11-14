import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentAuth, getCurrentUser } from "@/lib/auth/session";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { assertMayTryApi } from "@/lib/auth/sign-in-limit";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { recordSecurityEvent } from "@/lib/security/security-log";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { checkOrigin, body, failure, ApiError } from "@/lib/kfid/server";
import { createLinkIntent, GOOGLE_LINK_COOKIE, MICROSOFT_LINK_COOKIE } from "@/lib/auth/google-link";
import { LAST_SIGN_IN_WAY, mayRemoveSignInWay } from "@/lib/auth/passkey-core";
import { signInWays } from "@/lib/auth/passkeys";
import { microsoftSignInReady } from "@/lib/auth/microsoft";
import { MICROSOFT_PROVIDER } from "@/lib/auth/microsoft-core";
import { env } from "@/lib/env";
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new ApiError(401, "Logga in för att fortsätta.");
    const account = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        name: true,
        email: true,
        passwordHash: true,
        newsletterOptInAt: true,
        authAccounts: { select: { id: true, provider: true, email: true } },
      },
    });
    return NextResponse.json({
      name: account.name,
      email: account.email,
      hasPassword: Boolean(account.passwordHash),
      google: account.authAccounts.some((a) => a.provider === "google"),
      newsletter: Boolean(account.newsletterOptInAt),
      googleAccounts: account.authAccounts.filter((a) => a.provider === "google").map((a) => ({ id: a.id, email: a.email ?? "" })),
      // Microsoft (2026-10-11): offered only while sign-in with Microsoft is ready; the label is Microsoft's unverified name.
      microsoftAvailable: await microsoftSignInReady(),
      microsoftAccounts: account.authAccounts.filter((a) => a.provider === MICROSOFT_PROVIDER).map((a) => ({ id: a.id, email: a.email ?? "" })),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const auth = await getCurrentAuth();
    const user = auth?.user;
    if (!auth || !user) throw new ApiError(401, "Logga in för att fortsätta.");
    const input = await body(request);
    if (input.action === "profile") {
      const name = z.string().trim().min(1).max(200).parse(input.name);
      await prisma.user.update({ where: { id: user.id }, data: { name } });
    } else if (input.action === "password") {
      const data = z
        .object({
          currentPassword: z.string().max(72),
          password: z
            .string()
            .min(12, "Använd minst 12 tecken.")
            .max(72)
            .refine(
              (v) => Buffer.byteLength(v) <= 72,
              "Lösenordet får vara högst 72 byte.",
            ),
        })
        .parse(input);
      const account = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { passwordHash: true },
      });
      if (!account.passwordHash)
        throw new ApiError(
          409,
          "Skapa ditt första lösenord med Skapa / återställ lösenord via e-post.",
        );
      // The current password is the fresh confirmation here (2026-10-10); wrong tries count like wrong sign-ins.
      await assertMayTryApi(RATE_RULES.loginAccount, user.email);
      if (!(await verifyPassword(data.currentPassword, account.passwordHash))) {
        await hitRateLimit(RATE_RULES.loginAccount, user.email);
        throw new ApiError(400, "Nuvarande lösenord stämmer inte.");
      }
      const passwordHash = await hashPassword(data.password);
      const result = await prisma.user.updateMany({
        where: { id: user.id, passwordHash: account.passwordHash },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      if (!result.count)
        throw new ApiError(409, "Lösenordet har ändrats. Försök igen.");
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await recordSecurityEvent({ type: "password_changed", userId: user.id, actorId: user.id, headers: request.headers });
    } else if (input.action === "google_link_start") {
      // The next Google sign-in from this browser links that Google account to this person (10 minutes). A new way to
      // sign in needs a fresh confirmation (2026-10-10).
      await requireFreshAuth(user.id, auth);
      const intent = createLinkIntent(user.id);
      const response = NextResponse.json({ ok: true });
      response.cookies.set(GOOGLE_LINK_COOKIE, intent.value, { httpOnly: true, sameSite: "lax", secure: env.APP_URL.startsWith("https://"), path: "/", maxAge: intent.maxAge });
      return response;
    } else if (input.action === "google_unlink" || input.action === "microsoft_unlink") {
      // The last way to sign in can never be removed (2026-10-11: passkeys and Microsoft count too).
      const provider = input.action === "google_unlink" ? "google" : MICROSOFT_PROVIDER;
      const id = z.string().min(1).max(60).parse(input.id);
      const linked = await prisma.authAccount.findFirst({ where: { id, userId: user.id, provider }, select: { id: true } });
      if (!linked) throw new ApiError(404, "Kopplingen finns inte.");
      if (provider === MICROSOFT_PROVIDER) await requireFreshAuth(user.id, auth);
      if (!mayRemoveSignInWay(await signInWays(user.id))) throw new ApiError(409, LAST_SIGN_IN_WAY);
      await prisma.authAccount.delete({ where: { id } });
      if (provider === MICROSOFT_PROVIDER) await recordSecurityEvent({ type: "microsoft_unlinked", userId: user.id, actorId: user.id, headers: request.headers });
    } else if (input.action === "microsoft_link_start") {
      // Koppla Microsoft-konto (2026-10-11): as for Google, from this session with a fresh confirmation, 10 minutes.
      await requireFreshAuth(user.id, auth);
      if (!(await microsoftSignInReady())) throw new ApiError(409, "Inloggning med Microsoft är inte påslagen.");
      const intent = createLinkIntent(user.id, Date.now(), "microsoft-link");
      const response = NextResponse.json({ ok: true });
      response.cookies.set(MICROSOFT_LINK_COOKIE, intent.value, { httpOnly: true, sameSite: "lax", secure: env.APP_URL.startsWith("https://"), path: "/", maxAge: intent.maxAge });
      return response;
    } else if (input.action === "newsletter") {
      // Nyhetsutskick (2026-10-03): the person's own choice, with the time it was given.
      const on = z.boolean().parse(input.on);
      await prisma.user.update({ where: { id: user.id }, data: { newsletterOptInAt: on ? new Date() : null } });
    } else throw new ApiError(400, "Okänd åtgärd.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
