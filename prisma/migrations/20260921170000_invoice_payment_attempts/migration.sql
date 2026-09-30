ALTER TABLE "BillingInvoice"
  ADD COLUMN "firstPaymentFailedAt" TIMESTAMP(3),
  ADD COLUMN "lastPaymentAttemptAt" TIMESTAMP(3),
  ADD COLUMN "paymentAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextPaymentAttemptAt" TIMESTAMP(3);

ALTER TABLE "BillingInvoice"
  ADD CONSTRAINT "BillingInvoice_payment_attempt_count"
  CHECK ("paymentAttemptCount" >= 0);
