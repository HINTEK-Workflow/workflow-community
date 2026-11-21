import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Underhåll (2026-10-06, decision B1): a company setting, off by default. Read and written with plain SQL, so a
 * database without the migration simply reads as off.
 */
export async function readMaintenance(organizationId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ maintenance: boolean }[]>`SELECT "maintenance" FROM "WorkspaceSettings" WHERE "organizationId" = ${organizationId} LIMIT 1`;
    return rows[0]?.maintenance === true;
  } catch {
    return false;
  }
}

export async function writeMaintenance(organizationId: string, on: boolean) {
  await prisma.$executeRaw`INSERT INTO "WorkspaceSettings" ("id", "organizationId", "maintenance") VALUES (${randomUUID()}, ${organizationId}, ${on})
    ON CONFLICT ("organizationId") DO UPDATE SET "maintenance" = EXCLUDED."maintenance"`;
}
