-- Prissteg (2026-11-20,docs/beslut/betalning-och-landningssida.md): a price version can hold fixed steps after the
-- number of active users (Cloud 5, Cloud 10, Cloud 20) instead of base price + price per extra user, and a Cloud subscription
-- remembers its step. Additive: one JSON column with an empty default (every existing version keeps the older model and its
-- amounts) and two nullable columns (every existing subscription keeps its price until an audited move). The old app never
-- reads them.
BEGIN;

-- AlterTable
ALTER TABLE "PriceVersion" ADD COLUMN "cloudTiers" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "CloudSubscription" ADD COLUMN "cloudTierKey" TEXT, ADD COLUMN "cloudTierFrom" TIMESTAMP(3);

-- The steps are frozen like the other amounts once a version has left DRAFT (the guard of 20260929150000, with "cloudTiers"
-- added; the rest is unchanged, and the trigger itself stays as it is).
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
    NEW."cloudTiers" <> OLD."cloudTiers" OR
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

COMMIT;
