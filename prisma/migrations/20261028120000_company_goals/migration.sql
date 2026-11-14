-- Företagets mål (2026-10-28: "Företagets egna mål ska ersätta hårdkodade mål", "Företaget ska kunna ange egna
-- ekonomiska mål"): one JSON column on WorkspaceSettings with the company's own goals (lib/workflow/company-goals.ts).
-- Additive only: every existing company gets '{}' = no goal set, so the statistics draw no target line until the admin
-- sets one (the old built-in level, two per active user and month, is gone). Nothing else is changed.
-- Its own transaction: Prisma runs a file statement by statement (tests/migration-interrupted.integration.ts).
BEGIN;
ALTER TABLE "WorkspaceSettings" ADD COLUMN "goalSettings" JSONB NOT NULL DEFAULT '{}';

COMMIT;
