import { prisma } from "@/lib/db";
import { publicInstance } from "@/lib/instance";
import { getAiSharingPolicy } from "@/lib/ai/sharing-policy";

/**
 * Tillåt egna AI-appar (MCP) (2026-11-21, F6): MCP is the company's own AI (ChatGPT, Claude, Copilot or another), which the
 * company pays for and is responsible for. In Cloud it is off for a company until its admin turns it on under Inställningar → API
 * och MCP; Community keeps MCP on unless the admin turns it off. Checked on every MCP call (MCP keys and approved apps alike) and
 * before an app is approved. Stored in the company's AI choices (WorkspaceSettings.aiPolicy.mcpAllowed), written only here.
 */
export const mcpAllowedOf = (policy: { mcpAllowed?: boolean }, community: boolean) => policy.mcpAllowed ?? community;

export const MCP_OFF_REASON = "Företagets admin har inte slagit på egna AI-appar (MCP). Det görs under Inställningar → Kopplingar → API och MCP.";

export async function companyAllowsMcp(organizationId: string) {
  return mcpAllowedOf(await getAiSharingPolicy(organizationId), publicInstance().community);
}

export async function setCompanyMcpAllowed(organizationId: string, on: boolean) {
  const current = await getAiSharingPolicy(organizationId);
  const aiPolicy = { ...current, mcpAllowed: on };
  await prisma.workspaceSettings.upsert({ where: { organizationId }, create: { organizationId, aiPolicy }, update: { aiPolicy } });
}
