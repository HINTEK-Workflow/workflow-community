-- HINTEK AI's proposals (plan 2026-10-01, fas 2): the existing, so far unused AiProposal table is extended so a
-- proposal can be made on a page (no conversation), belongs to the person it was made for, records what was created
-- and can be undone. Additive: a new status, a relaxed column and three new columns.
ALTER TYPE "AiProposalStatus" ADD VALUE IF NOT EXISTS 'UNDONE';
ALTER TABLE "AiProposal" ALTER COLUMN "conversationId" DROP NOT NULL;
ALTER TABLE "AiProposal" ADD COLUMN "createdById" TEXT;
ALTER TABLE "AiProposal" ADD COLUMN "runId" TEXT;
ALTER TABLE "AiProposal" ADD COLUMN "result" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "AiProposal_organizationId_createdById_createdAt_idx" ON "AiProposal"("organizationId", "createdById", "createdAt");
