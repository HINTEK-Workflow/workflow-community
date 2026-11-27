import { prisma } from "@/lib/db";
import { issuedKeyProblem, parseIssuedToken } from "@/lib/integrations/keys";
import type { IntegrationPrincipal } from "@/lib/integrations/principal";

/**
 * Turns a presented token into the company and the member the key acts for (API/MCP server, 2026-09-30).
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

/**
 * Why a presented key was refused, for the 401 text (2026-10-18): only after the secret has matched is "revoked" or
 * "expired" told, so a guess learns nothing. Null when the token is not an issued key at all.
 */
export type KeyRefusal = "malformed" | "wrong-kind" | "invalid" | "revoked" | "expired" | "unavailable";
export async function integrationKeyRefusal(token: string, kind: "API" | "MCP", now = new Date()): Promise<KeyRefusal> {
  const parsed = parseIssuedToken(token);
  if (!parsed) return "malformed";
  if (parsed.kind !== kind) return "wrong-kind";
  const key = await prisma.integrationKey.findUnique({ where: { id: parsed.id } });
  if (!key || key.kind !== kind) return "invalid";
  const problem = issuedKeyProblem(parsed, key, now);
  return problem === "revoked" ? "revoked" : problem === "expired" ? "expired" : problem ? "invalid" : "unavailable";
}

/** Where a company admin issues API and MCP keys (the area page of Kopplingar). */
export const API_KEYS_PLACE = "Inställningar → Kopplingar → API och MCP";

/** The 401 text for a refused key; short, Swedish, and no more than the sender is entitled to know. */
export function keyRefusalMessage(refusal: KeyRefusal, kind: "API" | "MCP"): string {
  switch (refusal) {
    // The company's own page (användartest 2026-10-31: Tjänster och nycklar is the product owner's page, not the company's).
    case "revoked": return `Nyckeln är återkallad. En administratör skapar en ny under ${API_KEYS_PLACE}.`;
    case "expired": return `Nyckeln har gått ut. En administratör skapar en ny under ${API_KEYS_PLACE}.`;
    case "wrong-kind": return kind === "API" ? "Det här är en MCP-nyckel. API:t kräver en API-nyckel." : "Det här är en API-nyckel. MCP kräver en MCP-nyckel eller inloggning via OAuth.";
    case "unavailable": return "Nyckeln fungerar inte just nu. Kontakta företagets administratör.";
    default: return "Nyckeln är ogiltig.";
  }
}
