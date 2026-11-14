-- Stripe webhooks (security review 2026-10-04): a delivery claims the event before processing it, so two deliveries of
-- the same event at once cannot both apply it.
ALTER TABLE "PaymentEvent" ADD COLUMN "processingStartedAt" TIMESTAMP(3);
