import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { publicInstance } from "@/lib/instance";
import {
  findUserForLinkedAuthAccount,
  type GoogleOAuthProfile,
  syncGoogleAccountSignIn,
} from "@/lib/auth/oauth";
import { verifyPassword } from "@/lib/auth/password";
import { googleSignInAllowed } from "@/lib/auth/login-settings";
import { GOOGLE_LINK_COOKIE, linkGoogleAccount, readLinkIntent } from "@/lib/auth/google-link";
import { REGISTRATION_COOKIE, RegistrationError, readRegistrationIntent, refreshRegistrationGate, registerAccount } from "@/lib/auth/registration";
import { cookies } from "next/headers";
import { canAccessTest, isAllowedPrivateEmail, localRoleQaSessionCookie, mayAuthenticate, sessionOutdated } from "@/lib/auth/access";
import {
  findUserById,
  normalizeEmail,
  resolveActiveOrganization,
  resolveInitialOrganizationId,
  type AppUser,
} from "@/lib/auth/service";

function setTokenFromUser(token: JWT, user: AppUser) {
  const activeOrganization = resolveActiveOrganization(user);

  token.sub = user.id;
  token.name = user.name ?? user.email;
  token.email = user.email;
  token.picture = user.image ?? undefined;
  token.role = user.role;
  token.activeOrganizationId = activeOrganization?.id ?? null;
  token.activeOrganizationName = activeOrganization?.name ?? null;
  token.activeOrganizationSlug = activeOrganization?.slug ?? null;

  return token;
}

export const authOptions: NextAuthOptions = {
  secret: env.AUTH_SECRET,
  ...(localRoleQaSessionCookie() ? {
    cookies: {
      sessionToken: {
        name: localRoleQaSessionCookie()!,
        options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: false },
      },
    },
  } : {}),
  session: {
    strategy: "jwt",
    maxAge: env.SESSION_MAX_AGE_HOURS * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: {
          label: "E-post",
          type: "email",
        },
        password: {
          label: "Lösenord",
          type: "password",
        },
      },
      async authorize(credentials) {
        await refreshRegistrationGate();
        const email = normalizeEmail(credentials?.email ?? "");
        const password = credentials?.password ?? "";

        if (!mayAuthenticate(email) || !password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            passwordHash: true,
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

        if (
          !user ||
          !user.isActive ||
          !user.passwordHash
        ) {
          return null;
        }

        const valid = await verifyPassword(password, user.passwordHash);

        if (!valid) {
          return null;
        }

        const activeOrganizationId = resolveInitialOrganizationId(user);

        await prisma.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            activeOrganizationId,
          },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
    // Google sign-in belongs to HINTEK's edition (ee/); the community edition never registers it.
    ...(publicInstance().features.googleSignIn && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      await refreshRegistrationGate();
      if (account?.provider !== "google") return mayAuthenticate(user.email) ? true : "/login?error=test_access";
      if (!(await googleSignInAllowed())) return "/login?error=google_disabled";

      // A signed-in person linking another Google account to their own (Koppla Google-konto, 2026-10-03).
      const jar = await cookies();
      const linkingUserId = readLinkIntent(jar.get(GOOGLE_LINK_COOKIE)?.value);
      if (jar.get(GOOGLE_LINK_COOKIE)) jar.delete(GOOGLE_LINK_COOKIE);
      if (linkingUserId) {
        const linked = await linkGoogleAccount(linkingUserId, profile as GoogleOAuthProfile | undefined);
        return linked.ok ? true : `/?view=settings&googleLink=${linked.error}`;
      }

      // Skapa konto med Google (2026-10-03): the company details wait in a signed cookie from the registration page.
      const registration = readRegistrationIntent(jar.get(REGISTRATION_COOKIE)?.value);
      if (jar.get(REGISTRATION_COOKIE)) jar.delete(REGISTRATION_COOKIE);
      if (registration) {
        const google = profile as GoogleOAuthProfile | undefined;
        const googleEmail = String(google?.email ?? "").trim().toLowerCase();
        if (!googleEmail || google?.email_verified !== true) return "/register?error=google_unverified_email";
        const known = await prisma.user.findUnique({ where: { email: googleEmail }, select: { id: true } });
        if (!known) {
          try { await registerAccount(registration, { email: googleEmail, name: String(google?.name ?? "").trim() || googleEmail, emailVerified: true }); }
          catch (error) { return `/register?error=${encodeURIComponent(error instanceof RegistrationError ? error.message : "Kontot kunde inte skapas.")}`; }
        }
      }

      // The Google address must be allowed – unless this Google account is already linked to an allowed account.
      const result = await syncGoogleAccountSignIn(profile as GoogleOAuthProfile | undefined);

      if (!result.ok) {
        return `/login?error=${result.error}`;
      }

      return true;
    },
    async jwt({ token, user, account }) {
      await refreshRegistrationGate();
      if (account?.provider === "google" && account.providerAccountId) {
        const linkedUser = await findUserForLinkedAuthAccount(
          account.provider,
          account.providerAccountId,
        );

        if (canAccessTest(linkedUser) && linkedUser) {
          token.authAt = Math.floor(Date.now() / 1000);
          return setTokenFromUser(token, linkedUser);
        }
        return {};
      }

      if (user?.id) {
        const dbUser = await findUserById(user.id);

        if (canAccessTest(dbUser) && dbUser) {
          token.authAt = Math.floor(Date.now() / 1000);
          return setTokenFromUser(token, dbUser);
        }
        return {};
      }

      if (token.sub) {
        const dbUser = await findUserById(token.sub);

        if (canAccessTest(dbUser) && dbUser && !sessionOutdated(token.authAt ?? (token.iat as number | undefined), dbUser.passwordChangedAt)) {
          return setTokenFromUser(token, dbUser);
        }
      }

      return {};
    },
    async session({ session, token }) {
      if (!token.sub || !isAllowedPrivateEmail(token.email)) {
        delete (session as { user?: unknown }).user;
        return session;
      }
      if (session.user && token.sub && token.role) {
        session.user.id = token.sub;
        session.user.role = token.role;
        session.user.activeOrganizationId = token.activeOrganizationId ?? null;
        session.user.activeOrganizationName = token.activeOrganizationName ?? null;
        session.user.activeOrganizationSlug = token.activeOrganizationSlug ?? null;
      }

      if (session.user && typeof token.picture === "string") {
        session.user.image = token.picture;
      }

      return session;
    },
  },
};
