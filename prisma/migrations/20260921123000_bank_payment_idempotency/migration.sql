ALTER TABLE "BankPayment" ADD COLUMN "requestKey" TEXT NOT NULL;
CREATE UNIQUE INDEX "BankPayment_requestKey_key" ON "BankPayment"("requestKey");
ALTER TABLE "BillingInvoice" ADD COLUMN "providerPaidEventId" TEXT;
CREATE UNIQUE INDEX "BillingInvoice_providerPaidEventId_key" ON "BillingInvoice"("providerPaidEventId");
