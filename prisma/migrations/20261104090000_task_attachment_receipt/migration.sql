-- Kvitto (2026-11-04): additive; existing pictures count as ordinary pictures.
BEGIN;
ALTER TABLE "WorkflowTaskAttachment" ADD COLUMN "receipt" BOOLEAN NOT NULL DEFAULT false;
COMMIT;
