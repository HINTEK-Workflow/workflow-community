// First superadmin of a new, empty installation (Fas 1, 2026-09-30):
//
//   INSTANCE_ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long password' npm run admin:create
//
// Creates the installation's own organization (INSTANCE_OPERATOR, slug from INSTANCE_OPERATOR_SLUGS) and its owner as
// SUPERADMIN. Refuses when any account already exists, so it can never take over or change an installation in use –
// on HINTEK's own installation it does nothing. The address must be INSTANCE_ADMIN_EMAIL (lib/auth/access.ts). A new
// installation starts with "Vem får logga in" set to Alla: everyone with an account, and since "Tillåt nya konton" stays
// off, an account comes only from an invitation. Everything happens in one transaction under the registration lock.
import "dotenv/config";
import { OrganizationMemberRole, UserRole } from "@prisma/client";
import { prisma } from "../../lib/db";
import { hashPassword } from "../../lib/auth/password";
import { COMMON_PASSWORD_REFUSAL, isCommonPassword } from "../../lib/auth/common-password";
import { normalizeEmail } from "../../lib/auth/service";
import { publicInstance } from "../../lib/instance";
import { instanceAdminEmail } from "../../lib/instance-server";
import { readLoginRule } from "../../lib/auth/login-rule";

// Exit codes the Community install scripts read (2026-11-20): a refused password is asked for again without starting
// the installation over, and an installation that already has accounts is left as it is. Every other error exits 1.
const EXIT_PASSWORD_REFUSED = 2;
const EXIT_HAS_ACCOUNTS = 3;
class ExitError extends Error {
  constructor(message: string, readonly code: number) { super(message); }
}

async function main() {
  const instance = publicInstance();
  const slug = instance.operatorSlugs[0] ?? "workflow";
  // ADMIN_CREATE_CHECK=1 (install.sh/install.ps1 on a run where .env already exists): exits 0 when the installation still
  // has no account, so the script goes on to create it, and EXIT_HAS_ACCOUNTS when it already has one. Reads only. An
  // environment variable rather than an argument, since PowerShell 5.1 can drop a "--" on the way to npm.
  if (process.env.ADMIN_CREATE_CHECK === "1") {
    const taken = (await prisma.user.count()) > 0
      || Boolean(await prisma.organization.findUnique({ where: { slug }, select: { id: true } }));
    if (taken) throw new ExitError("Installationen har redan ett konto.", EXIT_HAS_ACCOUNTS);
    console.log("Installationen har inget konto ännu.");
    return;
  }
  if (!process.env.INSTANCE_ADMIN_EMAIL?.trim()) throw new Error("Set INSTANCE_ADMIN_EMAIL to the new superadmin's address.");
  const email = normalizeEmail(instanceAdminEmail());
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("INSTANCE_ADMIN_EMAIL is not an address.");
  const password = process.env.ADMIN_PASSWORD ?? "";
  // The person installing reads these two in the install script, so they are in Swedish, as in admin:recover.
  if (password.length < 12) throw new ExitError("Lösenordet måste ha minst 12 tecken.", EXIT_PASSWORD_REFUSED);
  // Vanliga lösenord (säkerhetsgranskning 2026-11-20, L3): the same list and words as every other account.
  if (isCommonPassword(password)) throw new ExitError(COMMON_PASSWORD_REFUSAL, EXIT_PASSWORD_REFUSED);
  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8216647)`;
    // Inside the lock, so two runs at the same time cannot both find the installation empty.
    if (await tx.user.count()) throw new ExitError("This installation already has accounts; admin:create only sets up an empty one.", EXIT_HAS_ACCOUNTS);
    if (await tx.organization.findUnique({ where: { slug }, select: { id: true } })) throw new ExitError(`An organization with the slug ${slug} already exists; admin:create only sets up an empty installation.`, EXIT_HAS_ACCOUNTS);
    const settings = await tx.systemSettings.findUnique({ where: { id: "global" }, select: { loginAccess: true } });
    if (!readLoginRule(settings?.loginAccess).mode) {
      const loginAccess = { mode: "ALL", allow: [], block: [] };
      await tx.systemSettings.upsert({ where: { id: "global" }, update: { loginAccess }, create: { id: "global", loginAccess } });
    }
    const organization = await tx.organization.create({
      data: { name: instance.operator, slug, isActive: true, storageMode: "HINTEK_CLOUD" },
    });
    const created = await tx.user.create({
      data: {
        email,
        name: process.env.ADMIN_NAME?.trim() || email,
        passwordHash,
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
    // The first sign-in opens the setup guide, as for a newly registered owner (registration.ts); without it a new
    // installation landed on Produktöversikten (2026-11-16).
    await tx.userPreferences.create({ data: { userId: created.id, data: { tours: { setupPending: new Date().toISOString() } } } });
    return created;
  });
  console.log(`Created superadmin ${user.email} in ${instance.operator} (${slug}). Sign in at ${process.env.APP_URL ?? "APP_URL"}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error instanceof ExitError ? error.code : 1;
  })
  .finally(() => prisma.$disconnect());
