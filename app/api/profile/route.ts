import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { checkOrigin, body, failure, ApiError } from "@/lib/kfid/server";
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
        authAccounts: { select: { provider: true } },
      },
    });
    return NextResponse.json({
      name: account.name,
      email: account.email,
      hasPassword: Boolean(account.passwordHash),
      google: account.authAccounts.some((a) => a.provider === "google"),
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
    } else throw new ApiError(400, "Okänd åtgärd.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
