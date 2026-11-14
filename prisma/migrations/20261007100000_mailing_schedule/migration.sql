-- Schemalagda utskick och veckobrev (2026-10-06): a mailing can wait for its time, remembers the version notes it
-- carried, and the weekly newsletter's settings live with the other system settings. Additive and safe to run again.

ALTER TYPE "MailingStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED' BEFORE 'QUEUED';
ALTER TABLE "Mailing" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
ALTER TABLE "Mailing" ADD COLUMN IF NOT EXISTS "releaseVersion" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "newsletter" JSONB NOT NULL DEFAULT '{}';
