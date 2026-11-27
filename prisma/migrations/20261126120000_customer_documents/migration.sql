-- Dokument (0.87.0): files filed on a customer or one of its places (lib/documents). Only additions: one new table with its indexes,
-- its foreign keys, a CHECK on the scan status and a trigger that keeps a document's place in the same company and under the same
-- customer; the old app never reads the table.
BEGIN;

-- CreateTable
CREATE TABLE "CustomerDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "placeId" TEXT,
    "name" TEXT NOT NULL,
    "storagePath" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "scanSignature" TEXT,
    "scanError" TEXT,
    "scanAttempts" INTEGER NOT NULL DEFAULT 0,
    "scannedAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerDocument_scanStatus_check" CHECK ("scanStatus" IN ('pending', 'clean', 'infected', 'unscanned')),
    -- An infected file keeps no bytes: its row is the record of what was found.
    CONSTRAINT "CustomerDocument_infected_no_file_check" CHECK ("scanStatus" <> 'infected' OR "storagePath" IS NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDocument_storagePath_key" ON "CustomerDocument"("storagePath");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDocument_id_organizationId_key" ON "CustomerDocument"("id", "organizationId");

-- CreateIndex
CREATE INDEX "CustomerDocument_organizationId_deletedAt_createdAt_idx" ON "CustomerDocument"("organizationId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerDocument_organizationId_customerId_deletedAt_idx" ON "CustomerDocument"("organizationId", "customerId", "deletedAt");

-- CreateIndex
CREATE INDEX "CustomerDocument_placeId_idx" ON "CustomerDocument"("placeId");

-- CreateIndex
CREATE INDEX "CustomerDocument_scanStatus_updatedAt_idx" ON "CustomerDocument"("scanStatus", "updatedAt");

-- AddForeignKey
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "CustomerFacility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A document's place belongs to the same company and the same customer (the route checks it too).
CREATE OR REPLACE FUNCTION "customer_document_place_check"() RETURNS trigger AS $$
BEGIN
  IF NEW."placeId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "CustomerFacility" f
    WHERE f."id" = NEW."placeId" AND f."organizationId" = NEW."organizationId" AND f."customerId" = NEW."customerId"
  ) THEN
    RAISE EXCEPTION 'CustomerDocument place must belong to the same company and customer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "customer_document_place_check"
  BEFORE INSERT OR UPDATE OF "placeId", "customerId", "organizationId" ON "CustomerDocument"
  FOR EACH ROW EXECUTE FUNCTION "customer_document_place_check"();

COMMIT;
