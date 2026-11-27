-- Artiklar och priser, pris ändrat (2026-10-08): a re-import stores a new price row only when the price (amount
-- or per-quantity) changed; an unchanged price is recorded as confirmed on the file's date by that import. Backward
-- compatible: a new table and a unique index on (id, organizationId) for the composite link. CataloguePrice stays
-- append-only (its trigger is untouched). Existing data needs no backfill: a price without a confirmation is confirmed
-- on its own price date, which is the latest price date of each article.

-- CreateTable
CREATE TABLE "CataloguePriceConfirmation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "priceId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "confirmedDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CataloguePriceConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CataloguePriceConfirmation_organizationId_priceId_createdAt_idx" ON "CataloguePriceConfirmation"("organizationId", "priceId", "createdAt");

-- CreateIndex
CREATE INDEX "CataloguePriceConfirmation_importId_idx" ON "CataloguePriceConfirmation"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "CataloguePrice_id_organizationId_key" ON "CataloguePrice"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "CataloguePriceConfirmation" ADD CONSTRAINT "CataloguePriceConfirmation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CataloguePriceConfirmation" ADD CONSTRAINT "CataloguePriceConfirmation_priceId_organizationId_fkey" FOREIGN KEY ("priceId", "organizationId") REFERENCES "CataloguePrice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CataloguePriceConfirmation" ADD CONSTRAINT "CataloguePriceConfirmation_importId_organizationId_fkey" FOREIGN KEY ("importId", "organizationId") REFERENCES "CatalogueImport"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

