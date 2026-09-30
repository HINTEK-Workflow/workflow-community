CREATE TYPE "CreditExpiryNoticeStage" AS ENUM ('DAY_30', 'DAY_7');

CREATE TABLE "CreditExpiryNotice" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "lotId" TEXT NOT NULL,
  "stage" "CreditExpiryNoticeStage" NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "credits" INTEGER NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "emailStatus" "BillingNoticeEmailStatus" NOT NULL DEFAULT 'QUEUED',
  "emailSentAt" TIMESTAMP(3),
  "emailLastAttemptAt" TIMESTAMP(3),
  "emailAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "emailFailure" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditExpiryNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditExpiryNotice_lotId_stage_expiresAt_key"
ON "CreditExpiryNotice"("lotId", "stage", "expiresAt");

CREATE INDEX "CreditExpiryNotice_organizationId_resolvedAt_effectiveAt_idx"
ON "CreditExpiryNotice"("organizationId", "resolvedAt", "effectiveAt");

CREATE INDEX "CreditExpiryNotice_emailStatus_createdAt_idx"
ON "CreditExpiryNotice"("emailStatus", "createdAt");

ALTER TABLE "CreditExpiryNotice"
ADD CONSTRAINT "CreditExpiryNotice_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreditExpiryNotice"
ADD CONSTRAINT "CreditExpiryNotice_lotId_fkey"
FOREIGN KEY ("lotId") REFERENCES "CreditLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
