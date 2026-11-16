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
import { googleCredentials } from "@/lib/integrations/server-secrets";
import { GOOGLE_LINK_COOKIE, linkGoogleAccount, MICROSOFT_LINK_COOKIE, readLinkIntent } from "@/lib/auth/google-link";
import { authorizePasskey } from "@/lib/auth/passkey-sign-in";
import { linkMicrosoftAccount, microsoftSignIn } from "@/lib/auth/microsoft";
import { MICROSOFT_PROVIDER, type MicrosoftClaims } from "@/lib/auth/microsoft-core";
import { REGISTRATION_COOKIE, RegistrationError, readRegistrationIntent, refreshRegistrationGate, registerAccount } from "@/lib/auth/registration";
import { cookies, headers } from "next/headers";
import { canAccessTest, isAllowedPrivateEmail, localRoleQaSessionCookie, mayAuthenticate } from "@/lib/auth/access";
import { tokenRevoked } from "@/lib/auth/session-rules";
import { sessionStillValid, startSession } from "@/lib/auth/sessions";
import { backupCodesLeft, TOTP_INVALID, TOTP_REQUIRED, twoFactorEnabled, verifySecondFactor } from "@/lib/auth/two-factor";
import { recordSecurityEvent } from "@/lib/security/security-log";
import { clearRateLimit, hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { assertMayTry, countIpTry } from "@/lib/auth/sign-in-limit";
import { clientIp } from "@/lib/security/client-ip";
import { DUMMY_PASSWORD_HASH } from "@/lib/auth/password";
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

/** The request's headers inside a NextAuth callback, for the session's coarse device text and the IP hash. */
async function requestHeaders() {
  try { return await headers(); } catch { return null; }
}

/** A new sign-in: its session row (the id travels in the token) and the event in the security log. */
async function beginSession(token: JWT, userId: string, method: string) {
  const source = await requestHeaders();
  token.authAt = Math.floor(Date.now() / 1000);
  token.method = method;
  try { token.sid = await startSession(userId, method, source); } catch { delete token.sid; }
  await recordSecurityEvent({ type: "login_ok", userId, actorId: userId, detail: method, headers: source });
}

/** "Fortsätt med Google" as a provider when the edition offers it and both keys are in place; otherwise none. */
function googleProviders(credentials: { clientId: string; clientSecret: string } | null) {
  // Google sign-in can be left out of an edition (instance features); then it is never registered.
  return publicInstance().features.googleSignIn && credentials ? [GoogleProvider(credentials)] : [];
}

/**
 * Microsoft (2026-10-11): a link the signed-in person asked for (signed intent cookie, like Google), or a sign-in with
 * an already linked account. Never an account by e-mail and never a new account.
 */
async function microsoftSignInCallback(claims: MicrosoftClaims | undefined) {
  const jar = await cookies();
  const linkingUserId = readLinkIntent(jar.get(MICROSOFT_LINK_COOKIE)?.value, Date.now(), "microsoft-link");
  if (jar.get(MICROSOFT_LINK_COOKIE)) jar.delete(MICROSOFT_LINK_COOKIE);
  const source = await requestHeaders();
  if (linkingUserId) {
    const linked = await linkMicrosoftAccount(linkingUserId, claims);
    if (linked.ok) await recordSecurityEvent({ type: "microsoft_linked", userId: linkingUserId, actorId: linkingUserId, headers: source });
    return linked.ok ? true : `/?view=settings&microsoftLink=${linked.error}`;
  }
  const result = await microsoftSignIn(claims);
  return result.ok ? true : `/login?error=${result.error}`;
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
        // Tvåstegsverifiering (2026-10-10): the code from the authenticator app or a backup code, asked after the password.
        code: {
          label: "Kod",
          type: "text",
        },
      },
      async authorize(credentials, req) {
        await refreshRegistrationGate();
        const email = normalizeEmail(credentials?.email ?? "");
        const password = credentials?.password ?? "";

        // Gissade lösenord (security review 2026-10-04): ten tries per address and fifty per IP address in 15 minutes;
        // past that the sign-in is refused without checking the password, and the form says so. While the shared counter
        // cannot be reached the sign-in is refused too (plan 1G, 2026-10-11), never checked uncounted.
        const ip = clientIp(req?.headers ?? {});
        if (email) await assertMayTry(RATE_RULES.loginAccount, email);
        // Per IP only when the proxy told us the address; an unknown one ("local") would put everyone in one bucket.
        await countIpTry(RATE_RULES.loginIp, ip);

        // Every refused try counts, also for an address that may not sign in here, so nothing tells the cases apart.
        if (!mayAuthenticate(email) || !password) {
          await verifyPassword(password || "-", DUMMY_PASSWORD_HASH);
          if (email) await hitRateLimit(RATE_RULES.loginAccount, email);
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
            totpSecret: true,
            totpEnabledAt: true,
            activeOrganizationId: true,
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
        });

        // The same bcrypt work whether the account exists or not, so the answer's timing does not tell.
        const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
        if (!user || !user.isActive || !user.passwordHash || !valid) {
          await hitRateLimit(RATE_RULES.loginAccount, email);
          // Logged only for an existing account; an unknown address leaves no trace (data minimisation).
          if (user) await recordSecurityEvent({ type: "login_failed", userId: user.id, detail: "Fel lösenord", headers: req?.headers ?? null });
          return null;
        }

        // Tvåstegsverifiering (2026-10-10): the password was right; with TOTP on, a code is needed too. The form asks
        // for it and sends everything again. Wrong codes count in their own window per person.
        let signInMethod = "password";
        if (twoFactorEnabled(user)) {
          const code = String(credentials?.code ?? "").trim();
          if (!code) throw new Error(TOTP_REQUIRED);
          await assertMayTry(RATE_RULES.twoFactor, user.id).catch(async (error) => {
            await recordSecurityEvent({ type: "rate_limited", userId: user.id, detail: "Kod", headers: req?.headers ?? null });
            throw error;
          });
          const proof = await verifySecondFactor(user.id, code);
          if (!proof) {
            await hitRateLimit(RATE_RULES.twoFactor, user.id);
            await recordSecurityEvent({ type: "two_factor_failed", userId: user.id, headers: req?.headers ?? null });
            throw new Error(TOTP_INVALID);
          }
          await clearRateLimit(RATE_RULES.twoFactor, user.id);
          if (proof === "backup") {
            signInMethod = "password+backup";
            await recordSecurityEvent({ type: "backup_code_used", userId: user.id, detail: `${await backupCodesLeft(user.id)} kvar`, headers: req?.headers ?? null });
          } else signInMethod = "password+totp";
        }
        await clearRateLimit(RATE_RULES.loginAccount, email);

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
          signInMethod,
        };
      },
    }),
    // Passkeys (2026-10-11): the signed answer from the browser, checked against the challenge this browser started.
    CredentialsProvider({
      id: "passkey",
      name: "Passkey",
      credentials: { response: { label: "Passkey", type: "text" } },
      async authorize(credentials, req) {
        await refreshRegistrationGate();
        return authorizePasskey(credentials?.response, req?.headers ?? {});
      },
    }),
    // Google from the environment here; the sign-in route itself uses authOptionsForRequest(), which also sees keys
    // entered under Servernycklar. Sessions (getServerSession) never need the Google provider.
    ...googleProviders(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : null),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      await refreshRegistrationGate();
      if (account?.provider === MICROSOFT_PROVIDER) return microsoftSignInCallback(profile as MicrosoftClaims | undefined);
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
      if ((account?.provider === "google" || account?.provider === MICROSOFT_PROVIDER) && account.providerAccountId) {
        const linkedUser = await findUserForLinkedAuthAccount(
          account.provider,
          account.providerAccountId,
        );

        if (canAccessTest(linkedUser) && linkedUser) {
          // The provider's own two-step verification protects this sign-in; Workflow asks for no code of its own.
          await beginSession(token, linkedUser.id, account.provider);
          return setTokenFromUser(token, linkedUser);
        }
        return {};
      }

      if (user?.id) {
        const dbUser = await findUserById(user.id);

        if (canAccessTest(dbUser) && dbUser) {
          await beginSession(token, dbUser.id, user.signInMethod ?? "password");
          return setTokenFromUser(token, dbUser);
        }
        return {};
      }

      if (token.sub) {
        delete token.unavailable;
        try {
          const dbUser = await findUserById(token.sub);

          // Ended by a password change or "Logga ut överallt", and – for a token with a session row – by ending that row.
          if (canAccessTest(dbUser) && dbUser
            && !tokenRevoked(token.authAt ?? (token.iat as number | undefined), dbUser.passwordChangedAt, dbUser.sessionsRevokedAt)
            && (!token.sid || await sessionStillValid(token.sid, dbUser.id))) {
            return setTokenFromUser(token, dbUser);
          }
        } catch {
          // Utloggad efter omstart (2026-11-16): the database could not be asked (a restart, a lost connection). An error here
          // made NextAuth's session route delete the cookie – a real sign-out. Now nothing is let in for this request (the
          // session callback gives no user), but the token is kept and checked in full again at the next request.
          return { ...token, unavailable: true };
        }
      }

      return {};
    },
    async session({ session, token }) {
      if (token.unavailable) {
        // Not checked (the database could not be asked): no user, and the answer says why, so the page does not say "utloggad".
        delete (session as { user?: unknown }).user;
        return Object.assign(session, { unavailable: true });
      }
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
        if (token.sid) session.user.sessionId = token.sid;
        if (token.authAt) session.user.authAt = token.authAt;
        if (token.method) session.user.authMethod = token.method;
      }

      if (session.user && typeof token.picture === "string") {
        session.user.image = token.picture;
      }

      return session;
    },
  },
};

/**
 * The options for the sign-in route (/api/auth/*), built per request (2026-10-09): Google's keys are read where
 * they apply – entered under Servernycklar, else the environment – so a saved or removed key works without a restart.
 * The keys are held in memory for half a minute and the cache is cleared when they are saved.
 */
export async function authOptionsForRequest(): Promise<NextAuthOptions> {
  const credentials = await googleCredentials();
  return { ...authOptions, providers: [...authOptions.providers.filter((provider) => provider.id !== "google"), ...googleProviders(credentials)] };
}
