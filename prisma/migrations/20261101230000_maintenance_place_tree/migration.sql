-- Underhåll i två träd (2026-10-31, byggt i 0.38.0): Platser (Ort › Anläggning › Område › Avdelning, eget träd, skilt
-- från kundregistret) bredvid dagens maskinträd, som blir Utrustning (Maskin › Komponent › Del). En rot i maskinträdet är en
-- maskin och kan stå på en plats; utan plats visas den under "Utan plats" tills en person flyttar eller tar bort den.
--
-- Bara additivt: en ny tabell, en ny nullbar kolumn, nya index, ett nytt CHECK-villkor (alla rader har placeId NULL, så det håller
-- från början) och en ny trigger. Inget tas bort och inga rader skrivs. Den gamla appen läser aldrig tabellen eller kolumnen.
-- Beslutet "dagens maskinträd tas bort" genomförs inte här: produktionen rörs inte, befintliga maskiner ligger kvar.
-- Sammansatta FK ([placeId, organizationId], [parentId, organizationId]) gör att databasen nekar en plats i ett annat företag.

BEGIN;

-- AlterTable
ALTER TABLE "MachinePart" ADD COLUMN     "placeId" TEXT;

-- CreateTable
CREATE TABLE "MaintenancePlace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'SITE',
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenancePlace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenancePlace_organizationId_parentId_idx" ON "MaintenancePlace"("organizationId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenancePlace_id_organizationId_key" ON "MaintenancePlace"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenancePlace_organizationId_parentId_name_key" ON "MaintenancePlace"("organizationId", "parentId", "name");

-- CreateIndex
CREATE INDEX "MachinePart_organizationId_placeId_idx" ON "MachinePart"("organizationId", "placeId");

-- AddForeignKey
ALTER TABLE "MachinePart" ADD CONSTRAINT "MachinePart_placeId_organizationId_fkey" FOREIGN KEY ("placeId", "organizationId") REFERENCES "MaintenancePlace"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlace" ADD CONSTRAINT "MaintenancePlace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlace" ADD CONSTRAINT "MaintenancePlace_parentId_organizationId_fkey" FOREIGN KEY ("parentId", "organizationId") REFERENCES "MaintenancePlace"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Prisma kan inte beskriva CHECK-villkor och triggrar; de är ingen schemadrift.
ALTER TABLE "MaintenancePlace" ADD CONSTRAINT "MaintenancePlace_level_check" CHECK ("level" IN ('CITY', 'SITE', 'AREA', 'DEPARTMENT'));
ALTER TABLE "MaintenancePlace" ADD CONSTRAINT "MaintenancePlace_not_own_parent_check" CHECK ("parentId" IS NULL OR "parentId" <> "id");
-- Bara en maskin (en rot) står på en plats; komponenter och delar följer sin maskin.
ALTER TABLE "MachinePart" ADD CONSTRAINT "MachinePart_place_root_check" CHECK ("parentId" IS NULL OR "placeId" IS NULL);

-- Ingen cykel: en ny förälder får inte vara platsen själv eller något under den.
CREATE OR REPLACE FUNCTION "maintenance_assert_place_tree"() RETURNS trigger AS $$
BEGIN
  IF NEW."parentId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."parentId" IS DISTINCT FROM OLD."parentId") AND EXISTS (
    WITH RECURSIVE up("id", "parentId", "depth") AS (
      SELECT "id", "parentId", 1 FROM "MaintenancePlace" WHERE "id" = NEW."parentId" AND "organizationId" = NEW."organizationId"
      UNION ALL
      SELECT p."id", p."parentId", up."depth" + 1 FROM "MaintenancePlace" p JOIN up ON p."id" = up."parentId" WHERE up."depth" < 20
    )
    SELECT 1 FROM up WHERE up."id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'En plats kan inte ligga under sig själv.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MaintenancePlace_tree" BEFORE INSERT OR UPDATE OF "parentId" ON "MaintenancePlace"
  FOR EACH ROW EXECUTE FUNCTION "maintenance_assert_place_tree"();

COMMIT;
