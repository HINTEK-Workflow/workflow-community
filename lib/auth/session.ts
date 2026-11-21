import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { DEFAULT_LOGIN_REDIRECT } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { authUserSelect } from "@/lib/auth/service";
import { canAccessTest } from "@/lib/auth/access";
import { refreshRegistrationGate } from "@/lib/auth/registration";

/** The signed-in person with this sign-in's session id, time and method (2026-10-10: sessions, fresh sign-in, 2FA). */
export async function getCurrentAuth() {
  await refreshRegistrationGate();
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: authUserSelect,
  });
  if (!canAccessTest(user) || !user) return null;
  return { user, sessionId: session.user.sessionId, authAt: session.user.authAt, method: session.user.authMethod ?? "password" };
}

export async function getCurrentUser() {
  return (await getCurrentAuth())?.user ?? null;
}

export async function requireUser(returnTo = DEFAULT_LOGIN_REDIRECT) {
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return user;
}

export async function requireVerifiedUser(returnTo = DEFAULT_LOGIN_REDIRECT) {
  const user = await requireUser(returnTo);

  if (!user.emailVerifiedAt) {
    redirect(`/verify-email?email=${encodeURIComponent(user.email)}`);
  }

  return user;
}

export async function requireVerifiedSuperadmin(returnTo = DEFAULT_LOGIN_REDIRECT) {
  const user = await requireVerifiedUser(returnTo);

  if (user.role !== UserRole.SUPERADMIN) {
    redirect("/login?error=superadmin_required");
  }

  return user;
}
