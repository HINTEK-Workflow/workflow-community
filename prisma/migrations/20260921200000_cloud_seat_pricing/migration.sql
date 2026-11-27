ALTER TABLE "BillingOrder" ADD COLUMN "billableUserCount" INTEGER;
ALTER TABLE "CloudSubscription"
  ADD COLUMN "providerExtraUserPriceId" TEXT,
  ADD COLUMN "extraUserPriceAmountOre" INTEGER,
  ADD COLUMN "billableUserCount" INTEGER;

ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_billable_user_count_positive"
  CHECK ("billableUserCount" IS NULL OR "billableUserCount" >= 1);
ALTER TABLE "CloudSubscription" ADD CONSTRAINT "CloudSubscription_billable_user_count_positive"
  CHECK ("billableUserCount" IS NULL OR "billableUserCount" >= 1);
ALTER TABLE "CloudSubscription" ADD CONSTRAINT "CloudSubscription_extra_user_price_nonnegative"
  CHECK ("extraUserPriceAmountOre" IS NULL OR "extraUserPriceAmountOre" >= 0);
