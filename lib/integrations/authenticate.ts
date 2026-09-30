import { prisma } from "@/lib/db";
import { issuedKeyProblem, parseIssuedToken } from "@/lib/integrations/keys";
import type { IntegrationPrincipal } from "@/lib/integrations/principal";

/**
 * Turns a presented token into the company and the member the key acts for (API/MCP server, Daniel 2026-09-30).
 * Fails closed: an unknown, revoked or expired key, a key of the other kind, or a member who is no longer active in an
 * active Cloud company gives null. A key without a chosen member acts for the admin who created it, who must still be
 * an admin. The scope for the call is checked by the dispatcher per tool. `lastUsedAt` is written at most once a minute.
 */
export async function authenticateIntegrationKey(token: string, kind: "API" | "MCP", now = new Date()): Promise<IntegrationPrincipal | null> {
  const parsed = parseIssuedToken(token);
  if (!parsed || parsed.kind !== kind) return null;
  const key = await prisma.integrationKey.findUnique({ where: { id: parsed.id } });
  if (!key || key.kind !== kind || issuedKeyProblem(parsed, key, now)) return null;
  const actingUserId = key.actingUserId ?? key.createdById;
  const membership = await prisma.organizationMember.findFirst({
    where: {
      organizationId: key.organizationId, userId: actingUserId, isActive: true, user: { isActive: true },
      organization: { isActive: true, storageMode: "HINTEK_CLOUD" },
      ...(key.actingUserId ? {} : { role: { in: ["OWNER", "ADMIN"] } }),
    },
    select: { id: true },
  });
  if (!membership) return null;
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > 60_000)
    await prisma.integrationKey.update({ where: { id: key.id }, data: { lastUsedAt: now } });
  return { keyId: key.id, keyName: key.name, kind, organizationId: key.organizationId, actingUserId, scopes: key.scopes };
}
