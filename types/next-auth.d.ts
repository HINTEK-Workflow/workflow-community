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
    };
  }

  interface User {
    id: string;
    role: UserRole;
    activeOrganizationId?: string | null;
    activeOrganizationName?: string | null;
    activeOrganizationSlug?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    activeOrganizationId?: string | null;
    activeOrganizationName?: string | null;
    activeOrganizationSlug?: string | null;
  }
}
