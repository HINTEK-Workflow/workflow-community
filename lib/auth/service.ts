import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env, absoluteUrl } from "@/lib/env";
import { sendSystemEmail } from "@/lib/mail/mailer";
import {
  buildEmailVerificationEmail,
  buildPasswordResetEmail,
} from "@/lib/mail/templates";
import { hashPassword } from "@/lib/auth/password";
import { canAccessTest, mayAuthenticate } from "@/lib/auth/access";
import {
  createRawToken,
  expiresInHours,
  expiresInMinutes,
  hashToken,
} from "@/lib/auth/tokens";

export const authOrganizationSelect = {
  id: true,
  name: true,
  slug: true,
  domain: true,
  isActive: true,
  storageMode: true,
} satisfies Prisma.OrganizationSelect;

export const authUserSelect = {
  id: true,
  name: true,
  image: true,
  email: true,
  role: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  passwordChangedAt: true,
  isActive: true,
  activeOrganizationId: true,
  activeOrganization: {
    select: authOrganizationSelect,
  },
  organizationMemberships: {
    where: { isActive: true },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      role: true,
      workflowPermissions: true,
      organization: {
        select: authOrganizationSelect,
      },
    },
  },
  createdAt: true,
} satisfies Prisma.UserSelect;

export type AppUser = Prisma.UserGetPayload<{
  select: typeof authUserSelect;
}>;

export function resolveActiveOrganization(
  user: Pick<AppUser, "activeOrganization" | "organizationMemberships">,
) {
  const active = user.activeOrganization;
  if (!active?.isActive) return null;
  return user.organizationMemberships.some(
    (membership) =>
      membership.organization.id === active.id &&
      membership.organization.isActive,
  )
    ? active
    : null;
}

export function resolveInitialOrganizationId(user: {
  activeOrganizationId: string | null;
  organizationMemberships: Array<{ organizationId: string }>;
}) {
  return user.organizationMemberships.some(
    (membership) => membership.organizationId === user.activeOrganizationId,
  )
    ? user.activeOrganizationId
    : (user.organizationMemberships[0]?.organizationId ?? null);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function displayName(user: Pick<AppUser, "email" | "name">) {
  return user.name?.trim() || user.email;
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: authUserSelect,
  });
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: authUserSelect,
  });
}

export async function requestPasswordReset(email: string) {
  if (!mayAuthenticate(email)) return;
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    return;
  }

  const rawToken = createRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = expiresInMinutes(env.PASSWORD_RESET_TTL_MINUTES);

  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        sentTo: user.email,
      },
    }),
  ]);

  const resetUrl = absoluteUrl(`/reset-password?token=${rawToken}`);
  const template = buildPasswordResetEmail({
    name: displayName(user),
    resetUrl,
    expiresInMinutes: env.PASSWORD_RESET_TTL_MINUTES,
  });

  await sendSystemEmail({
    to: user.email,
    subject: "Återställ ditt lösenord",
    html: template.html,
    text: template.text,
  });
}

export async function sendVerificationEmail(email: string) {
  if (!mayAuthenticate(email)) return;
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerifiedAt: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive || user.emailVerifiedAt) {
    return;
  }

  const rawToken = createRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = expiresInHours(env.EMAIL_VERIFICATION_TTL_HOURS);

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
    }),
    prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        sentTo: user.email,
      },
    }),
  ]);

  const verifyUrl = absoluteUrl(`/verify-email?token=${rawToken}`);
  const template = buildEmailVerificationEmail({
    name: displayName(user),
    verifyUrl,
    expiresInHours: env.EMAIL_VERIFICATION_TTL_HOURS,
  });

  await sendSystemEmail({
    to: user.email,
    subject: "Verifiera din e-postadress",
    html: template.html,
    text: template.text,
  });
}

export async function inspectPasswordResetToken(rawToken: string) {
  const token = await prisma.passwordResetToken.findUnique({
    where: {
      tokenHash: hashToken(rawToken),
    },
    include: {
      user: {
        select: authUserSelect,
      },
    },
  });

  if (
    !token ||
    token.usedAt ||
    token.expiresAt <= new Date() ||
    !canAccessTest(token.user)
  ) {
    return null;
  }

  return token;
}

export async function resetPasswordWithToken(
  rawToken: string,
  password: string,
) {
  const token = await prisma.passwordResetToken.findUnique({
    where: {
      tokenHash: hashToken(rawToken),
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          isActive: true,
        },
      },
    },
  });

  if (
    !token ||
    token.usedAt ||
    token.expiresAt <= new Date() ||
    !canAccessTest(token.user)
  ) {
    return {
      ok: false,
      message: "Återställningslänken är ogiltig eller har gått ut.",
    } as const;
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: token.userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: token.id },
      data: {
        usedAt: new Date(),
      },
    }),
    prisma.passwordResetToken.updateMany({
      where: {
        userId: token.userId,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    }),
  ]);

  return {
    ok: true,
    message: "Lösenordet är uppdaterat. Du kan nu logga in.",
  } as const;
}

export async function verifyEmailWithToken(rawToken: string) {
  const token = await prisma.verificationToken.findUnique({
    where: {
      tokenHash: hashToken(rawToken),
    },
    include: {
      user: {
        select: authUserSelect,
      },
    },
  });

  if (
    !token ||
    token.usedAt ||
    token.expiresAt <= new Date() ||
    !canAccessTest(token.user)
  ) {
    return {
      ok: false,
      message: "Verifieringslänken är ogiltig eller har gått ut.",
    } as const;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: token.userId },
      data: {
        emailVerifiedAt: new Date(),
      },
    }),
    prisma.verificationToken.update({
      where: { id: token.id },
      data: {
        usedAt: new Date(),
      },
    }),
    prisma.verificationToken.updateMany({
      where: {
        userId: token.userId,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    }),
  ]);

  return {
    ok: true,
    message: "E-postadressen är verifierad.",
    email: token.user.email,
  } as const;
}
