import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { DEFAULT_LOGIN_REDIRECT } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { authUserSelect } from "@/lib/auth/service";
import { canAccessTest } from "@/lib/auth/access";

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: authUserSelect,
  });
  return canAccessTest(user) ? user : null;
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
