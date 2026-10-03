// Nödväg in (2026-10-03): when the superadmin is locked out – a forgotten password, Google switched off, mail that
// does not work – root on the server repairs it without the app. Runs inside the app container:
//
//   docker compose -p workflowhintekse exec -e ADMIN_PASSWORD='a long new password' app npm run admin:recover -- --password
//   docker compose -p workflowhintekse exec app npm run admin:recover -- --google --mail
//
//   --password  sets a new password for the installation's superadmin (INSTANCE_ADMIN_EMAIL) and ends every session
//   --google    switches "Fortsätt med Google" on again under Inloggning
//   --mail      empties the SMTP server, user and password saved in the app, so the server's .env applies again
//
// Only reachable for whoever can run commands on the server; every change is written to the administration history.
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { hashPassword } from "../../lib/auth/password";
import { normalizeEmail } from "../../lib/auth/service";
import { instanceAdminEmail } from "../../lib/instance-server";

async function main() {
  const flags = new Set(process.argv.slice(2));
  const known = ["--password", "--google", "--mail"];
  if (!flags.size || [...flags].some((flag) => !known.includes(flag)))
    throw new Error(`Ange något av ${known.join(", ")}.`);
  const email = normalizeEmail(instanceAdminEmail());
  const admin = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, activeOrganizationId: true } });
  if (!admin || admin.role !== "SUPERADMIN" || !admin.activeOrganizationId) throw new Error(`Hittar ingen superadmin med adressen ${email}.`);
  const organizationId = admin.activeOrganizationId;
  const done: string[] = [];

  if (flags.has("--password")) {
    const password = process.env.ADMIN_PASSWORD ?? "";
    if (password.length < 12) throw new Error("Sätt ADMIN_PASSWORD till minst 12 tecken.");
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), isActive: true } });
    done.push("nytt lösenord för superadmin (alla inloggningar avslutade)");
  }
  if (flags.has("--google")) {
    await prisma.systemSettings.upsert({ where: { id: "global" }, update: { googleSignIn: true }, create: { id: "global", googleSignIn: true } });
    done.push("Fortsätt med Google påslaget");
  }
  if (flags.has("--mail")) {
    const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { mail: true } });
    const mail = row?.mail && typeof row.mail === "object" && !Array.isArray(row.mail) ? { ...(row.mail as Record<string, Prisma.InputJsonValue>) } : {};
    for (const key of ["host", "user", "passwordCipher", "noPassword"]) delete mail[key];
    await prisma.systemSettings.upsert({ where: { id: "global" }, update: { mail }, create: { id: "global", mail } });
    done.push("e-postens server, användare och lösenord tömda i appen – serverns .env gäller");
  }
  await prisma.administrationEvent.create({ data: { actorId: admin.id, organizationId, action: "admin_recover", detail: `Nödväg från servern: ${done.join("; ")}.` } });
  console.log(`Klart: ${done.join("; ")}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
