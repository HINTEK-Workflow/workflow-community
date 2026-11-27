// Gallring av agentkörningar och AI-förslag (granskningen 2026-11-24, G-27 / data-ai F-05). Pure rules shared by the nightly
// job and the tests; no Prisma here.

/**
 * How long an agent run (its report, what it read and did, and who got the feedback) and an AI proposal are kept, counted
 * from when they were made. 180 days: long enough to look back over a half-year (a monthly agent's six latest reports, a
 * proposal's undo and follow-up), short enough that names and incidents in a report do not stay for years. It applies to
 * every company, whatever history retention the company chose; the shortest company choice (6 months) is about the same.
 * The cost of a run (AiRun, the credit ledger) is accounting and is never touched here. A chat whose proposals are gone
 * is left to the company's own history retention ("Chattar med Workflow AI"), as every other chat.
 */
export const AGENT_RUN_RETENTION_DAYS = 180;
export const AI_PROPOSAL_RETENTION_DAYS = 180;

/** A run that is still waiting or running is never removed, however old its slot is. */
export const AGENT_RUN_ACTIVE_STATUSES = ["queued", "running"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The moment before which rows go: the given number of whole days back from now. */
export function daysCutoff(days: number, now = new Date()) {
  if (!Number.isInteger(days) || days <= 0) throw new Error("The retention time must be a whole number of days.");
  return new Date(now.getTime() - days * DAY_MS);
}

export type AgentRetentionCounts = { runs: number; proposals: number };

/** The line written to the company's administration history (counts only, never content or names). */
export function agentRetentionDetail(counts: AgentRetentionCounts) {
  const parts = [
    counts.runs ? `${counts.runs} ${counts.runs === 1 ? "agentkörning" : "agentkörningar"} äldre än ${AGENT_RUN_RETENTION_DAYS} dagar` : "",
    counts.proposals ? `${counts.proposals} AI-förslag äldre än ${AI_PROPOSAL_RETENTION_DAYS} dagar` : "",
  ].filter(Boolean);
  return `Raderat enligt lagringstiden: ${parts.length ? parts.join(" och ") : "inget"}.`;
}
