-- Etapp på jobbet (2026-10-11). Additive: an optional text label that groups a project's jobs.

ALTER TABLE "WorkflowTask" ADD COLUMN "stage" TEXT NOT NULL DEFAULT '';
