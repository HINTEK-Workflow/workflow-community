import { UserRole } from "@prisma/client";
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
import { canAccessTest, isAllowedPrivateEmail, isTestEmail, localRoleQaSessionCookie } from "@/lib/auth/access";
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
        const email = normalizeEmail(credentials?.email ?? "");
        const password = credentials?.password ?? "";

        if (!isTestEmail(email) || !password) {
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
          !user.passwordHash ||
          user.role !== UserRole.SUPERADMIN
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
      const email = account?.provider === "google"
        ? (profile as GoogleOAuthProfile | undefined)?.email
        : user.email;
      if (!isTestEmail(email)) return "/login?error=test_access";
      if (account?.provider !== "google") {
        return true;
      }

      const result = await syncGoogleAccountSignIn(profile as GoogleOAuthProfile | undefined);

      if (!result.ok) {
        return `/login?error=${result.error}`;
      }

      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && account.providerAccountId) {
        const linkedUser = await findUserForLinkedAuthAccount(
          account.provider,
          account.providerAccountId,
        );

        if (canAccessTest(linkedUser) && linkedUser) {
          return setTokenFromUser(token, linkedUser);
        }
        return {};
      }

      if (user?.id) {
        const dbUser = await findUserById(user.id);

        if (canAccessTest(dbUser) && dbUser) {
          return setTokenFromUser(token, dbUser);
        }
        return {};
      }

      if (token.sub) {
        const dbUser = await findUserById(token.sub);

        if (canAccessTest(dbUser) && dbUser) {
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
