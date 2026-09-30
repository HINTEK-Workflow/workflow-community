// First superadmin of a new, empty installation (Fas 1, 2026-09-30):
//
//   INSTANCE_ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long password' npm run admin:create
//
// Creates the installation's own organization (INSTANCE_OPERATOR, slug from INSTANCE_OPERATOR_SLUGS) and its owner as
// SUPERADMIN. Refuses when any account already exists, so it can never take over or change an installation in use –
// on HINTEK's own installation it does nothing. The address must be INSTANCE_ADMIN_EMAIL: the only one that may sign
// in during a private test (lib/auth/access.ts).
import "dotenv/config";
import { OrganizationMemberRole, UserRole } from "@prisma/client";
import { prisma } from "../../lib/db";
import { hashPassword } from "../../lib/auth/password";
import { normalizeEmail } from "../../lib/auth/service";
import { publicInstance } from "../../lib/instance";
import { instanceAdminEmail } from "../../lib/instance-server";

async function main() {
  const email = normalizeEmail(instanceAdminEmail());
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!process.env.INSTANCE_ADMIN_EMAIL?.trim()) throw new Error("Set INSTANCE_ADMIN_EMAIL to the new superadmin's address.");
  if (password.length < 12) throw new Error("Set ADMIN_PASSWORD to at least 12 characters.");
  if (await prisma.user.count()) throw new Error("This installation already has accounts; admin:create only sets up an empty one.");

  const instance = publicInstance();
  const slug = instance.operatorSlugs[0] ?? "workflow";
  const user = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: instance.operator, slug, isActive: true, storageMode: "HINTEK_CLOUD" },
    });
    const created = await tx.user.create({
      data: {
        email,
        name: process.env.ADMIN_NAME?.trim() || email,
        passwordHash: await hashPassword(password),
        role: UserRole.SUPERADMIN,
        isActive: true,
        emailVerifiedAt: new Date(),
        activeOrganizationId: organization.id,
      },
      select: { id: true, email: true },
    });
    await tx.organizationMember.create({
      data: { organizationId: organization.id, userId: created.id, role: OrganizationMemberRole.OWNER },
    });
    return created;
  });
  console.log(`Created superadmin ${user.email} in ${instance.operator} (${slug}). Sign in at ${process.env.APP_URL ?? "APP_URL"}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
