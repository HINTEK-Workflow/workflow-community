import "dotenv/config";
import { OrganizationMemberRole, UserRole } from "@prisma/client";
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { hashPassword } from "../lib/auth/password";
import { normalizeEmail } from "../lib/auth/service";

async function main() {
  const email = normalizeEmail(env.SEED_ADMIN_EMAIL);
  const organization = await prisma.organization.upsert({
    where: {
      slug: env.SEED_ORGANIZATION_SLUG,
    },
    update: {
      name: env.SEED_ORGANIZATION_NAME,
      isActive: true,
      storageMode: "HINTEK_CLOUD",
    },
    create: {
      name: env.SEED_ORGANIZATION_NAME,
      slug: env.SEED_ORGANIZATION_SLUG,
      isActive: true,
      storageMode: "HINTEK_CLOUD",
    },
  });

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      emailVerifiedAt: true,
    },
  });

  const passwordHash = existingUser?.passwordHash
    ? existingUser.passwordHash
    : await hashPassword(env.SEED_ADMIN_PASSWORD);
  const emailVerifiedAt =
    existingUser?.emailVerifiedAt ??
    (env.SEED_ADMIN_EMAIL_VERIFIED ? new Date() : null);

  const user = existingUser
    ? await prisma.user.update({
        where: { email },
        data: {
          name: env.SEED_ADMIN_NAME,
          passwordHash,
          role: UserRole.SUPERADMIN,
          isActive: true,
          emailVerifiedAt,
          activeOrganizationId: organization.id,
        },
        select: {
          id: true,
          email: true,
        },
      })
    : await prisma.user.create({
        data: {
          email,
          name: env.SEED_ADMIN_NAME,
          passwordHash,
          role: UserRole.SUPERADMIN,
          isActive: true,
          emailVerifiedAt,
          activeOrganizationId: organization.id,
        },
        select: {
          id: true,
          email: true,
        },
      });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
    update: {
      role: OrganizationMemberRole.OWNER,
    },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: OrganizationMemberRole.OWNER,
    },
  });

  console.log(`Seeded superadmin user: ${email}`);
  console.log(`Ensured organization: ${organization.slug}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
