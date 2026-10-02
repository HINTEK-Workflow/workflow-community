-- HINTEK AI credit settings made in the app (2026-10-01): the least credits an AI answer costs, per kind of run;
-- additive, empty = the defaults in ee/ai/credit-settings.ts.
ALTER TABLE "SystemSettings" ADD COLUMN "ai" JSONB NOT NULL DEFAULT '{}';
