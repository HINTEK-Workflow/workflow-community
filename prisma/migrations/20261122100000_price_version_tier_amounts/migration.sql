-- Prissteg (2026-11-20, 20261120180000_cloud_price_tiers): a version with steps keeps no price per extra user (0), which the
-- amounts check of 20260929150000 refused. The check now asks for a price per extra user only in a version without steps; the
-- base amount (the first step's price) and the included users are checked as before. Nothing else changes.
BEGIN;

ALTER TABLE "PriceVersion" DROP CONSTRAINT "PriceVersion_amounts_check";
ALTER TABLE "PriceVersion" ADD CONSTRAINT "PriceVersion_amounts_check" CHECK (
  "cloudBaseAmountOre" > 0 AND "includedUsers" >= 1 AND ("cloudExtraUserAmountOre" > 0 OR jsonb_array_length("cloudTiers") > 0)
);

COMMIT;
