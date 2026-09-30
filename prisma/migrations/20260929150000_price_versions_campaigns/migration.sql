-- Price versions, price change notices and campaign discounts on orders (Daniel 2026-09-29, docs/PLAN_LANDNINGSSIDA_PLANER_PRISER_20260929.md).
-- Additive only. Amounts change through a new PriceVersion mirrored to new Stripe prices; existing subscriptions keep their price
-- until an audited move after a 30-day notice. Orders keep subtotalOre undiscounted (like Stripe) and store the discount separately.
-- CreateEnum
CREATE TYPE "PriceVersionStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "PriceChangeNoticeStatus" AS ENUM ('NOTIFIED', 'MOVED', 'CANCELED');

-- AlterTable
ALTER TABLE "BillingOrder" ADD COLUMN     "amendsOrderId" TEXT,
ADD COLUMN     "campaignKey" TEXT,
ADD COLUMN     "discountAmountOre" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountCode" TEXT,
ADD COLUMN     "priceVersion" INTEGER,
ADD COLUMN     "providerCouponId" TEXT,
ADD COLUMN     "providerPromotionCodeId" TEXT;

-- AlterTable
ALTER TABLE "BillingOrderItem" ADD COLUMN     "discountAmountOre" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PriceVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PriceVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "cloudBaseAmountOre" INTEGER NOT NULL,
    "cloudExtraUserAmountOre" INTEGER NOT NULL,
    "includedUsers" INTEGER NOT NULL,
    "creditPackages" JSONB NOT NULL,
    "stripePrices" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT NOT NULL DEFAULT '',
    "termsVersion" TEXT,
    "creditTermsVersion" TEXT,
    "createdById" TEXT NOT NULL,
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceChangeNotice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "priceVersionId" TEXT NOT NULL,
    "fromPriceAmountOre" INTEGER NOT NULL,
    "fromExtraUserAmountOre" INTEGER,
    "status" "PriceChangeNoticeStatus" NOT NULL DEFAULT 'NOTIFIED',
    "noticedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveNotBefore" TIMESTAMP(3) NOT NULL,
    "movedAt" TIMESTAMP(3),
    "amendmentOrderId" TEXT,
    "createdById" TEXT NOT NULL,
    "movedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceChangeNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceVersion_version_key" ON "PriceVersion"("version");

-- CreateIndex
CREATE INDEX "PriceVersion_status_idx" ON "PriceVersion"("status");

-- CreateIndex
CREATE INDEX "PriceChangeNotice_organizationId_status_idx" ON "PriceChangeNotice"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PriceChangeNotice_subscriptionId_priceVersionId_key" ON "PriceChangeNotice"("subscriptionId", "priceVersionId");

-- AddForeignKey
ALTER TABLE "PriceChangeNotice" ADD CONSTRAINT "PriceChangeNotice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceChangeNotice" ADD CONSTRAINT "PriceChangeNotice_priceVersionId_fkey" FOREIGN KEY ("priceVersionId") REFERENCES "PriceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_amendsOrderId_fkey" FOREIGN KEY ("amendsOrderId") REFERENCES "BillingOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one active version, at most one version in progress (DRAFT or READY).
CREATE UNIQUE INDEX "PriceVersion_single_active" ON "PriceVersion"((1)) WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "PriceVersion_single_in_progress" ON "PriceVersion"((1)) WHERE "status" IN ('DRAFT', 'READY');
ALTER TABLE "PriceVersion" ADD CONSTRAINT "PriceVersion_amounts_check" CHECK ("cloudBaseAmountOre" > 0 AND "cloudExtraUserAmountOre" > 0 AND "includedUsers" >= 1);
ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_discount_check" CHECK ("discountAmountOre" >= 0 AND "discountAmountOre" <= "subtotalOre");
ALTER TABLE "BillingOrderItem" ADD CONSTRAINT "BillingOrderItem_discount_check" CHECK ("discountAmountOre" >= 0 AND "discountAmountOre" <= "subtotalOre");

-- Amounts and Stripe prices of a version are frozen once it has left DRAFT; the status only moves forward and a version
-- that has been active is never deleted (webhooks accept prices from every version that has been active).
CREATE OR REPLACE FUNCTION price_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only a draft price version can be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."version" <> OLD."version" OR
    NEW."cloudBaseAmountOre" <> OLD."cloudBaseAmountOre" OR
    NEW."cloudExtraUserAmountOre" <> OLD."cloudExtraUserAmountOre" OR
    NEW."includedUsers" <> OLD."includedUsers" OR
    NEW."creditPackages" <> OLD."creditPackages" OR
    NEW."stripePrices" <> OLD."stripePrices"
  ) THEN
    RAISE EXCEPTION 'A price version is immutable after it has left DRAFT';
  END IF;
  IF (OLD."status" = 'READY' AND NEW."status" NOT IN ('READY', 'ACTIVE')) OR
     (OLD."status" = 'ACTIVE' AND NEW."status" NOT IN ('ACTIVE', 'RETIRED')) OR
     (OLD."status" = 'RETIRED' AND NEW."status" <> 'RETIRED') OR
     (OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'READY')) THEN
    RAISE EXCEPTION 'Invalid price version status change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PriceVersion_guard" BEFORE UPDATE OR DELETE ON "PriceVersion" FOR EACH ROW EXECUTE FUNCTION price_version_guard();
