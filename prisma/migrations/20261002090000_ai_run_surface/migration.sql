-- Where in Workflow an AI run was asked for (chat, a tip, the summary, the import), so tokens and cost can be
-- measured per place (plan 2026-10-01, fas 0). Additive; empty for older runs.
ALTER TABLE "AiRun" ADD COLUMN "surface" TEXT;
