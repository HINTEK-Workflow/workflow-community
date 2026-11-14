-- Radering efter avslut (2026-10-10): the countdown for companies whose Cloud agreement has ended, and the
-- instance switch "Automatisk radering påslagen" (off by default; with it off the job only counts down and notifies).
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "autoEraseEndedCompanies" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "CompanyClosure" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "exportUntil" TIMESTAMP(3) NOT NULL,
    "postponedUntil" TIMESTAMP(3),
    "postponeReason" TEXT NOT NULL DEFAULT '',
    "noticesSent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstNoticeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyClosure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyClosure_organizationId_key" ON "CompanyClosure"("organizationId");
CREATE INDEX IF NOT EXISTS "CompanyClosure_exportUntil_idx" ON "CompanyClosure"("exportUntil");
