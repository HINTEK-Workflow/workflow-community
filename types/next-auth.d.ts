import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: UserRole;
      activeOrganizationId: string | null;
      activeOrganizationName: string | null;
      activeOrganizationSlug: string | null;
      /** The UserSession row of this sign-in (2026-10-10); absent for tokens from before it. */
      sessionId?: string;
      /** When the person signed in (seconds). */
      authAt?: number;
      /** password, password+totp, password+backup, google, passkey or microsoft. */
      authMethod?: string;
    };
  }

  interface User {
    id: string;
    role: UserRole;
    activeOrganizationId?: string | null;
    activeOrganizationName?: string | null;
    activeOrganizationSlug?: string | null;
    /** Set by the password sign-in: how the person proved who they are (2026-10-10). */
    signInMethod?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** When the person signed in (seconds); a password change after it ends the session. */
    authAt?: number;
    /** The UserSession row (2026-10-10): revoked or gone ends the session. */
    sid?: string;
    /** How the person signed in. */
    method?: string;
    role?: UserRole;
    activeOrganizationId?: string | null;
    activeOrganizationName?: string | null;
    activeOrganizationSlug?: string | null;
  }
}
