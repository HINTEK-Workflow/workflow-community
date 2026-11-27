-- Platser (2026-10-04): customer facilities become a tree with optional levels. Every existing facility stays as
-- the top level (kind FACILITY, no parent), so nothing is lost and every link to it keeps working.
ALTER TABLE "CustomerFacility" ADD COLUMN "parentId" TEXT;
ALTER TABLE "CustomerFacility" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'FACILITY';
ALTER TABLE "CustomerFacility" ADD COLUMN "code" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CustomerFacility" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "CustomerFacility" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "CustomerFacility" ADD CONSTRAINT "CustomerFacility_kind_check" CHECK ("kind" IN ('FACILITY', 'BUILDING', 'SPACE', 'OBJECT', 'OTHER'));
ALTER TABLE "CustomerFacility" ADD CONSTRAINT "CustomerFacility_position_check" CHECK (
  ("latitude" IS NULL AND "longitude" IS NULL)
  OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);
-- NO ACTION (checked at the end of the statement) so deleting a customer or a company removes its whole tree at once.
ALTER TABLE "CustomerFacility" ADD CONSTRAINT "CustomerFacility_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CustomerFacility"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "CustomerFacility_parentId_idx" ON "CustomerFacility"("parentId");

-- A place's parent belongs to the same customer (and so the same company), and a place is never its own ancestor.
CREATE OR REPLACE FUNCTION "workflow_assert_place_parent"() RETURNS trigger AS $$
DECLARE
  cursor_id TEXT := NEW."parentId";
  depth INT := 0;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "CustomerFacility" WHERE "id" = NEW."parentId" AND "customerId" = NEW."customerId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Den överordnade platsen hör till en annan kund.' USING ERRCODE = '23503';
  END IF;
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW."id" THEN
      RAISE EXCEPTION 'En plats kan inte ligga under sig själv.' USING ERRCODE = '23514';
    END IF;
    depth := depth + 1;
    IF depth > 12 THEN
      RAISE EXCEPTION 'Platsträdet är för djupt.' USING ERRCODE = '23514';
    END IF;
    SELECT "parentId" INTO cursor_id FROM "CustomerFacility" WHERE "id" = cursor_id;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CustomerFacility_place_parent" BEFORE INSERT OR UPDATE OF "parentId", "customerId", "organizationId" ON "CustomerFacility"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_place_parent"();
