CREATE TYPE "BillingAdjustmentKind" AS ENUM ('REFUND', 'CREDIT_NOTE');
CREATE TYPE "BillingAdjustmentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'VOID');

ALTER TABLE "BillingOrder" ADD COLUMN "invoiceDueDays" INTEGER;

CREATE TABLE "BillingAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "purchaseId" TEXT,
    "sourcePaymentEventId" TEXT,
    "providerAdjustmentId" TEXT NOT NULL,
    "kind" "BillingAdjustmentKind" NOT NULL,
    "status" "BillingAdjustmentStatus" NOT NULL,
    "amountOre" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SEK',
    "reason" TEXT,
    "appliedCredits" INTEGER NOT NULL DEFAULT 0,
    "effectiveAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingAdjustment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BillingAdjustment_amount_positive" CHECK ("amountOre" > 0),
    CONSTRAINT "BillingAdjustment_applied_credits_nonnegative" CHECK ("appliedCredits" >= 0),
    CONSTRAINT "BillingAdjustment_single_target" CHECK (
      (("invoiceId" IS NOT NULL)::integer + ("purchaseId" IS NOT NULL)::integer) = 1
    )
);

CREATE UNIQUE INDEX "BillingAdjustment_providerAdjustmentId_key" ON "BillingAdjustment"("providerAdjustmentId");
CREATE INDEX "BillingAdjustment_organizationId_kind_status_createdAt_idx" ON "BillingAdjustment"("organizationId", "kind", "status", "createdAt");
CREATE INDEX "BillingAdjustment_invoiceId_idx" ON "BillingAdjustment"("invoiceId");
CREATE INDEX "BillingAdjustment_purchaseId_idx" ON "BillingAdjustment"("purchaseId");
CREATE INDEX "BillingAdjustment_sourcePaymentEventId_idx" ON "BillingAdjustment"("sourcePaymentEventId");

ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "BillingInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "CreditPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_sourcePaymentEventId_fkey"
  FOREIGN KEY ("sourcePaymentEventId") REFERENCES "PaymentEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_invoice_due_days_range"
  CHECK ("invoiceDueDays" IS NULL OR ("invoiceDueDays" >= 1 AND "invoiceDueDays" <= 365));
