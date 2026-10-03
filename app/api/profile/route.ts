import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { checkOrigin, body, failure, ApiError } from "@/lib/kfid/server";
import { createLinkIntent, GOOGLE_LINK_COOKIE } from "@/lib/auth/google-link";
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
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await getCurrentUser();
    if (!user) throw new ApiError(401, "Logga in för att fortsätta.");
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
          "Använd Skapa/återställ lösenord via din verifierade e-post för första lösenordet.",
        );
      if (!(await verifyPassword(data.currentPassword, account.passwordHash)))
        throw new ApiError(400, "Nuvarande lösenord stämmer inte.");
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
    } else if (input.action === "google_link_start") {
      // The next Google sign-in from this browser links that Google account to this person (10 minutes).
      const intent = createLinkIntent(user.id);
      const response = NextResponse.json({ ok: true });
      response.cookies.set(GOOGLE_LINK_COOKIE, intent.value, { httpOnly: true, sameSite: "lax", secure: env.APP_URL.startsWith("https://"), path: "/", maxAge: intent.maxAge });
      return response;
    } else if (input.action === "google_unlink") {
      const id = z.string().min(1).max(60).parse(input.id);
      const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, authAccounts: { select: { id: true } } } });
      if (!account.authAccounts.some((item) => item.id === id)) throw new ApiError(404, "Kopplingen finns inte.");
      if (!account.passwordHash && account.authAccounts.length <= 1)
        throw new ApiError(409, "Du behöver ett lösenord eller ett annat Google-konto för att kunna logga in. Skapa ett lösenord först.");
      await prisma.authAccount.delete({ where: { id } });
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
