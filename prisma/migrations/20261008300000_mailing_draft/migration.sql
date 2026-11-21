-- Veckobrev som utkast (2026-10-07): the weekly newsletter is never sent by itself. The weekly job writes a draft,
-- the superadmin reads it and approves it, and only then is it queued. A draft that is skipped is kept (without
-- recipients) so the same version notes are not drafted again. Additive and safe to run again. The new values are not
-- used in this migration (a new enum value cannot be used in the transaction that adds it).

ALTER TYPE "MailingStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "MailingStatus" ADD VALUE IF NOT EXISTS 'DISMISSED';
ALTER TABLE "Mailing" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "Mailing" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
