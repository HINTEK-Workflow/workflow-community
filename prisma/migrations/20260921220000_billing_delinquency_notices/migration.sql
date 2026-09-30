CREATE TYPE "BillingNoticeStage" AS ENUM (
  'DUE_TODAY',
  'DAY_3_REMINDER',
  'DAY_7_FINAL_WARNING',
  'DAY_8_WRITE_PAUSED'
);

CREATE TYPE "BillingNoticeEmailStatus" AS ENUM (
  'NOT_REQUESTED',
  'QUEUED',
  'SENT',
  'CANCELED',
  'FAILED'
);

CREATE TABLE "BillingNotice" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "stage" "BillingNoticeStage" NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "emailStatus" "BillingNoticeEmailStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "emailSentAt" TIMESTAMP(3),
  "emailFailure" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingNotice_invoiceId_stage_key"
  ON "BillingNotice"("invoiceId", "stage");
CREATE INDEX "BillingNotice_organizationId_resolvedAt_effectiveAt_idx"
  ON "BillingNotice"("organizationId", "resolvedAt", "effectiveAt");
CREATE INDEX "BillingNotice_emailStatus_createdAt_idx"
  ON "BillingNotice"("emailStatus", "createdAt");

ALTER TABLE "BillingNotice"
  ADD CONSTRAINT "BillingNotice_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingNotice"
  ADD CONSTRAINT "BillingNotice_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "BillingInvoice"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
