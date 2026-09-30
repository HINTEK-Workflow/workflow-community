ALTER TABLE "BillingInvoice"
  ADD COLUMN "replacesInvoiceId" TEXT,
  ADD COLUMN "replacementRequestKey" TEXT,
  ADD COLUMN "replacementReason" TEXT,
  ADD COLUMN "replacementActorId" TEXT;

CREATE UNIQUE INDEX "BillingInvoice_replacesInvoiceId_key"
ON "BillingInvoice"("replacesInvoiceId");

CREATE UNIQUE INDEX "BillingInvoice_replacementRequestKey_key"
ON "BillingInvoice"("replacementRequestKey");

ALTER TABLE "BillingInvoice"
ADD CONSTRAINT "BillingInvoice_replacesInvoiceId_fkey"
FOREIGN KEY ("replacesInvoiceId") REFERENCES "BillingInvoice"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
