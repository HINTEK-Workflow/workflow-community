-- Utgår (2026-10-09): a job (work order, protocol, risk assessment) that will not be done gets the status
-- CANCELLED with a required reason instead of being deleted. "status" is a text column, so the new value needs no type
-- change; the columns below keep when, by whom, why and the status it had before, so Återuppta can give it back.
-- Additive only: every existing row gets NULL/'' and keeps its status. Nothing is rewritten or deleted.
ALTER TABLE "WorkflowTask" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "WorkflowTask" ADD COLUMN "cancelledBy" TEXT;
ALTER TABLE "WorkflowTask" ADD COLUMN "cancelReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WorkflowTask" ADD COLUMN "cancelledFromStatus" TEXT;
