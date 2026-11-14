ALTER TABLE "BillingInvoice"
ADD COLUMN "paidOutOfBandRequestKey" TEXT;

CREATE UNIQUE INDEX "BillingInvoice_paidOutOfBandRequestKey_key"
ON "BillingInvoice"("paidOutOfBandRequestKey");
