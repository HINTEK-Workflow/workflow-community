import type { Prisma, PrismaClient } from "@prisma/client";

// Kept apart from lib/oauth/server.ts (server-only) so the unit and integration tests can run it outside Next.

export type ClaimedCode = { id: string; clientId: string; organizationId: string; userId: string; scopes: string[]; resource: string };
type Db = Pick<PrismaClient, "$transaction" | "organizationMember">;

const member = (db: Db, code: ClaimedCode, activeOnly: boolean) =>
  db.organizationMember.findFirst({ where: { organizationId: code.organizationId, userId: code.userId, ...(activeOnly ? { isActive: true } : {}) }, select: { id: true } });

/**
 * Turns a claimed authorization code into a connection (OAuthGrant) and binds the code to it. Returns null when the person
 * is no longer an active member of the company the code was approved for – removed or deactivated between the approval
 * and the token exchange – so the token endpoint answers `invalid_grant` instead of failing. The database refuses such a
 * grant as well (trigger OAuthGrant_member, 20261009200000); if the membership goes in the moment between this check and
 * the insert, that refusal is recognised here by checking the membership again.
 */
export async function grantForClaimedCode(db: Db, code: ClaimedCode) {
  if (!(await member(db, code, true))) return null;
  try {
    return await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const grant = await tx.oAuthGrant.create({ data: { clientId: code.clientId, organizationId: code.organizationId, userId: code.userId, scopes: code.scopes, resource: code.resource } });
      await tx.oAuthAuthorizationCode.update({ where: { id: code.id }, data: { grantId: grant.id } });
      return grant;
    });
  } catch (error) {
    if (!(await member(db, code, false))) return null;
    throw error;
  }
}
