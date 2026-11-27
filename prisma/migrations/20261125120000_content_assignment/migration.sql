-- Innehållsuppdrag (2026-11-25): the instruction an external system gave through the API (create_content_brief), kept with the
-- draft post it produced, and the company's own rule for approving such posts automatically (OFF unless an admin turns it on).
-- Only additions: two new tables, each tied to its company (and the assignment to its post), removed with them.
-- Safe to run again; one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS "ContentAssignment" (
    "postId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "instruction" JSONB NOT NULL,
    "textSource" TEXT NOT NULL DEFAULT 'brief',
    "reason" TEXT,
    "platform" TEXT NOT NULL DEFAULT '',
    "scheduledId" TEXT,
    "autoApprovedAt" TIMESTAMP(3),
    "autoApprovedKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentAssignment_pkey" PRIMARY KEY ("postId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContentAssignment_postId_organizationId_key" ON "ContentAssignment"("postId", "organizationId");
CREATE INDEX IF NOT EXISTS "ContentAssignment_organizationId_createdAt_idx" ON "ContentAssignment"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ContentAssignment_organizationId_autoApprovedAt_idx" ON "ContentAssignment"("organizationId", "autoApprovedAt");

DO $$ BEGIN
  ALTER TABLE "ContentAssignment" ADD CONSTRAINT "ContentAssignment_postId_organizationId_fkey"
    FOREIGN KEY ("postId", "organizationId") REFERENCES "SocialPost"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AutoPublishSetting" (
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "caps" JSONB NOT NULL DEFAULT '{}',
    "stoppedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutoPublishSetting_pkey" PRIMARY KEY ("organizationId")
);

DO $$ BEGIN
  ALTER TABLE "AutoPublishSetting" ADD CONSTRAINT "AutoPublishSetting_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
