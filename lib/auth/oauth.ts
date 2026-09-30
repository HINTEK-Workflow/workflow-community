import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  authUserSelect,
  normalizeEmail,
  resolveInitialOrganizationId,
} from "@/lib/auth/service";
import { isTestEmail } from "@/lib/auth/access";

export type GoogleOAuthProfile = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  hd?: string;
};

type GoogleSignInSyncResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      error:
        | "test_access"
        | "google_missing_email"
        | "google_unverified_email"
        | "google_account_disabled"
        | "google_invite_required"
        | "google_superadmin_required";
    };

function fallbackName(name: string | undefined, email: string) {
  const trimmedName = name?.trim();

  return trimmedName ? trimmedName : email;
}

export async function syncGoogleAccountSignIn(
  profile: GoogleOAuthProfile | undefined,
): Promise<GoogleSignInSyncResult> {
  const providerAccountId = String(profile?.sub ?? "").trim();
  const email = normalizeEmail(String(profile?.email ?? ""));
  const emailVerified = profile?.email_verified === true;

  if (!isTestEmail(email)) return { ok: false, error: "test_access" };

  if (!providerAccountId || !email) {
    return {
      ok: false,
      error: "google_missing_email",
    };
  }

  if (!emailVerified) {
    return {
      ok: false,
      error: "google_unverified_email",
    };
  }

  const now = new Date();
  const linkedAccount = await prisma.authAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: "google",
        providerAccountId,
      },
    },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          role: true,
          isActive: true,
          emailVerifiedAt: true,
          activeOrganizationId: true,
          organizationMemberships: {
            where: {
              isActive: true,
              organization: { isActive: true },
            },
            orderBy: {
              createdAt: "asc",
            },
            select: {
              organizationId: true,
            },
            take: 1,
          },
        },
      },
    },
  });

  if (linkedAccount) {
    if (!isTestEmail(linkedAccount.user.email)) return { ok: false, error: "test_access" };
    if (linkedAccount.user.role !== UserRole.SUPERADMIN) {
      return {
        ok: false,
        error: "google_superadmin_required",
      };
    }

    if (!linkedAccount.user.isActive) {
      return {
        ok: false,
        error: "google_account_disabled",
      };
    }

    await prisma.$transaction([
      prisma.authAccount.update({
        where: {
          id: linkedAccount.id,
        },
        data: {
          email,
          hostedDomain: profile?.hd ?? null,
          avatarUrl: profile?.picture ?? null,
          lastUsedAt: now,
        },
      }),
      prisma.user.update({
        where: {
          id: linkedAccount.userId,
        },
        data: {
          name: linkedAccount.user.name ?? fallbackName(profile?.name, email),
          image: linkedAccount.user.image ?? profile?.picture ?? null,
          emailVerifiedAt: linkedAccount.user.emailVerifiedAt ?? now,
          lastLoginAt: now,
          activeOrganizationId: resolveInitialOrganizationId(linkedAccount.user),
        },
      }),
    ]);

    return {
      ok: true,
      userId: linkedAccount.userId,
    };
  }

  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
    select: {
      id: true,
      name: true,
      image: true,
      role: true,
      isActive: true,
      emailVerifiedAt: true,
      activeOrganizationId: true,
      organizationMemberships: {
        where: {
          isActive: true,
          organization: { isActive: true },
        },
        orderBy: {
          createdAt: "asc",
        },
        select: {
          organizationId: true,
        },
        take: 1,
      },
    },
  });

  if (!existingUser) {
    return {
      ok: false,
      error: "google_invite_required",
    };
  }

  if (existingUser.role !== UserRole.SUPERADMIN) {
    return {
      ok: false,
      error: "google_superadmin_required",
    };
  }

  if (!existingUser.isActive) {
    return {
      ok: false,
      error: "google_account_disabled",
    };
  }

  await prisma.$transaction([
    prisma.authAccount.create({
      data: {
        userId: existingUser.id,
        provider: "google",
        providerAccountId,
        email,
        hostedDomain: profile?.hd ?? null,
        avatarUrl: profile?.picture ?? null,
        lastUsedAt: now,
      },
    }),
    prisma.user.update({
      where: {
        id: existingUser.id,
      },
      data: {
        name: existingUser.name ?? fallbackName(profile?.name, email),
        image: existingUser.image ?? profile?.picture ?? null,
        emailVerifiedAt: existingUser.emailVerifiedAt ?? now,
        lastLoginAt: now,
        activeOrganizationId: resolveInitialOrganizationId(existingUser),
      },
    }),
  ]);

  return {
    ok: true,
    userId: existingUser.id,
  };
}

export async function findUserForLinkedAuthAccount(
  provider: string,
  providerAccountId: string,
) {
  const account = await prisma.authAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId,
      },
    },
    select: {
      user: {
        select: authUserSelect,
      },
    },
  });

  return account?.user ?? null;
}
