-- Förrådet (2026-10-31, byggt i 0.38.0): egen nummerserie per förråd, förvaringen som träd (Förråd › Skåp › Hylla ›
-- Hyllplats, valfritt djup), hyllan som text på artikeln, och förrådets eget nummer skilt från raden "Beställs som"
-- (articleNo och supplierName, som redan finns).
--
-- Bara additivt: nya nullbara kolumner och kolumner med DEFAULT, nya index, nya CHECK-villkor (alla rader är NULL eller ''
-- från början) och en ny trigger. Inget tas bort och inga rader skrivs. Förråd och artiklar som finns behåller sina saldon och sin
-- logg. Det unika indexet på (organizationId, name) ligger kvar: name är hela vägen ("Fabriken › Skåp 1 › Hylla 2"), så två
-- syskon aldrig heter likadant medan två skåp kan ha varsin "Hylla 1"; label är platsens eget namn. Äldre rader har label '' och
-- får serie och nummer först när någon använder dem (lib/maintenance/store-server.ts). Den gamla appen läser inte kolumnerna.

BEGIN;

-- AlterTable
ALTER TABLE "StoreLocation" ADD COLUMN     "label" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "seriesStart" INTEGER;

-- AlterTable
ALTER TABLE "StoreItem" ADD COLUMN     "homeStoreId" TEXT,
ADD COLUMN     "ownNumber" INTEGER,
ADD COLUMN     "shelfText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "unitPrice" DECIMAL(14,4);

-- CreateIndex
CREATE INDEX "StoreLocation_organizationId_parentId_idx" ON "StoreLocation"("organizationId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreLocation_organizationId_seriesStart_key" ON "StoreLocation"("organizationId", "seriesStart");

-- CreateIndex
CREATE INDEX "StoreItem_organizationId_homeStoreId_idx" ON "StoreItem"("organizationId", "homeStoreId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreItem_organizationId_ownNumber_key" ON "StoreItem"("organizationId", "ownNumber");

-- AddForeignKey
ALTER TABLE "StoreLocation" ADD CONSTRAINT "StoreLocation_parentId_organizationId_fkey" FOREIGN KEY ("parentId", "organizationId") REFERENCES "StoreLocation"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_homeStoreId_organizationId_fkey" FOREIGN KEY ("homeStoreId", "organizationId") REFERENCES "StoreLocation"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "StoreLocation" ADD CONSTRAINT "StoreLocation_not_own_parent_check" CHECK ("parentId" IS NULL OR "parentId" <> "id");
-- Nummerserien hör till förrådet högst upp, och nummer är större än noll.
ALTER TABLE "StoreLocation" ADD CONSTRAINT "StoreLocation_series_top_check" CHECK ("parentId" IS NULL OR "seriesStart" IS NULL);
ALTER TABLE "StoreLocation" ADD CONSTRAINT "StoreLocation_seriesStart_check" CHECK ("seriesStart" IS NULL OR "seriesStart" > 0);
ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_ownNumber_check" CHECK ("ownNumber" IS NULL OR "ownNumber" > 0);
ALTER TABLE "StoreItem" ADD CONSTRAINT "StoreItem_unitPrice_check" CHECK ("unitPrice" IS NULL OR "unitPrice" >= 0);

-- Ingen cykel: en ny förälder får inte vara platsen själv eller något under den.
CREATE OR REPLACE FUNCTION "store_assert_location_tree"() RETURNS trigger AS $$
BEGIN
  IF NEW."parentId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."parentId" IS DISTINCT FROM OLD."parentId") AND EXISTS (
    WITH RECURSIVE up("id", "parentId", "depth") AS (
      SELECT "id", "parentId", 1 FROM "StoreLocation" WHERE "id" = NEW."parentId" AND "organizationId" = NEW."organizationId"
      UNION ALL
      SELECT p."id", p."parentId", up."depth" + 1 FROM "StoreLocation" p JOIN up ON p."id" = up."parentId" WHERE up."depth" < 100
    )
    SELECT 1 FROM up WHERE up."id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'En förrådsplats kan inte ligga under sig själv.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "StoreLocation_tree" BEFORE INSERT OR UPDATE OF "parentId" ON "StoreLocation"
  FOR EACH ROW EXECUTE FUNCTION "store_assert_location_tree"();

COMMIT;
