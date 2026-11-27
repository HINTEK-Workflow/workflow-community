import { prisma } from "@/lib/db";
import {
  authUserSelect,
  normalizeEmail,
  resolveInitialOrganizationId,
} from "@/lib/auth/service";
import { mayAuthenticate } from "@/lib/auth/access";
import { twoFactorEnabled } from "@/lib/auth/two-factor";

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
      /** Two-factor is on for the account: nothing was written, and the sign-in waits for the code (G-09). */
      needsCode?: true;
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

/**
 * A Google sign-in. With two-factor on for the account (säkerhetsgranskningen 2026-11-24, G-09) nothing is written – no
 * first link by e-mail, no sign-in – until the code is right: then this runs again with `codeVerified`.
 */
export async function syncGoogleAccountSignIn(
  profile: GoogleOAuthProfile | undefined,
  options: { codeVerified?: boolean } = {},
): Promise<GoogleSignInSyncResult> {
  const providerAccountId = String(profile?.sub ?? "").trim();
  const email = normalizeEmail(String(profile?.email ?? ""));
  const emailVerified = profile?.email_verified === true;

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
          totpSecret: true,
          totpEnabledAt: true,
          organizationMemberships: {
            where: { isActive: true },
            // A paused company can still be read (beslut 11, 2026-11-01), but an active one comes first.
            orderBy: [{ organization: { isActive: "desc" } }, { createdAt: "asc" }],
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
    if (!mayAuthenticate(linkedAccount.user.email)) return { ok: false, error: "test_access" };

    if (!linkedAccount.user.isActive) {
      return {
        ok: false,
        error: "google_account_disabled",
      };
    }
    if (!options.codeVerified && twoFactorEnabled(linkedAccount.user)) return { ok: true, userId: linkedAccount.userId, needsCode: true };

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

  // Not linked yet: the Google address itself must be allowed and belong to an account.
  if (!mayAuthenticate(email)) return { ok: false, error: "test_access" };
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
      totpSecret: true,
      totpEnabledAt: true,
      organizationMemberships: {
        where: { isActive: true },
        orderBy: [{ organization: { isActive: "desc" } }, { createdAt: "asc" }],
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

  if (!existingUser.isActive) {
    return {
      ok: false,
      error: "google_account_disabled",
    };
  }
  // The first link by e-mail waits for the account's own code when two-factor is on.
  if (!options.codeVerified && twoFactorEnabled(existingUser)) return { ok: true, userId: existingUser.id, needsCode: true };

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
