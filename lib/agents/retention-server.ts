import { prisma } from "@/lib/db";
import { AGENT_RUN_ACTIVE_STATUSES, AGENT_RUN_RETENTION_DAYS, AI_PROPOSAL_RETENTION_DAYS, agentRetentionDetail, daysCutoff } from "./retention";

/**
 * Nightly (history:retention, granskningen 2026-11-24 G-27): removes every company's agent runs and AI proposals older than
 * their fixed retention time (lib/agents/retention.ts), whatever history retention the company chose. A run still queued or
 * running stays. Every removal leaves one counted line in the company's administration history; counts only, never
 * content. A dry run counts.
 */
export async function purgeExpiredAgentHistory(now = new Date(), options: { dryRun?: boolean } = {}) {
  const runBefore = daysCutoff(AGENT_RUN_RETENTION_DAYS, now);
  const proposalBefore = daysCutoff(AI_PROPOSAL_RETENTION_DAYS, now);
  const runWhere = (organizationId?: string) => ({ ...(organizationId ? { organizationId } : {}), createdAt: { lt: runBefore }, status: { notIn: [...AGENT_RUN_ACTIVE_STATUSES] } });
  const proposalWhere = (organizationId?: string) => ({ ...(organizationId ? { organizationId } : {}), createdAt: { lt: proposalBefore } });
  // Only companies that have anything old enough.
  const [runCompanies, proposalCompanies] = await Promise.all([
    prisma.agentRun.groupBy({ by: ["organizationId"], where: runWhere() }),
    prisma.aiProposal.groupBy({ by: ["organizationId"], where: proposalWhere() }),
  ]);
  const organizationIds = [...new Set([...runCompanies, ...proposalCompanies].map((item) => item.organizationId))].sort();
  const results: { organizationId: string; runs: number; proposals: number }[] = [];
  for (const organizationId of organizationIds) {
    if (options.dryRun) {
      const [runs, proposals] = await Promise.all([prisma.agentRun.count({ where: runWhere(organizationId) }), prisma.aiProposal.count({ where: proposalWhere(organizationId) })]);
      if (runs || proposals) results.push({ organizationId, runs, proposals });
      continue;
    }
    const result = await prisma.$transaction(async (tx) => {
      const runs = (await tx.agentRun.deleteMany({ where: runWhere(organizationId) })).count;
      const proposals = (await tx.aiProposal.deleteMany({ where: proposalWhere(organizationId) })).count;
      if (runs || proposals) await tx.administrationEvent.create({ data: { actorId: "system:agent-retention", organizationId, action: "agent_retention", detail: agentRetentionDetail({ runs, proposals }) } });
      return { runs, proposals };
    }, { timeout: 120_000 });
    if (result.runs || result.proposals) results.push({ organizationId, ...result });
  }
  return results;
}
