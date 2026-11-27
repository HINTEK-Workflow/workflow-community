-- Prisfiler (2026-10-13 natt): a price is the wholesaler's base price before the customer's discount (BASE: GNP,
-- Listpris, GN-pris) or the customer's own net price (NET). Earlier rows keep NET, as they were used. Additive only.
ALTER TABLE "CataloguePrice" ADD COLUMN "priceKind" TEXT NOT NULL DEFAULT 'NET';
ALTER TABLE "CataloguePrice" ADD CONSTRAINT "CataloguePrice_priceKind_check" CHECK ("priceKind" IN ('NET', 'BASE'));
ALTER TABLE "CatalogueImport" ADD COLUMN "priceKind" TEXT NOT NULL DEFAULT 'NET';
ALTER TABLE "CatalogueImport" ADD CONSTRAINT "CatalogueImport_priceKind_check" CHECK ("priceKind" IN ('NET', 'BASE'));

-- Grossistrutorna: which of the four wholesalers a supplier is (null = another supplier); the wholesale export reads it
-- instead of guessing from the name. One supplier row per account, so a company can have two Solar accounts.
ALTER TABLE "CatalogueSupplier" ADD COLUMN "wholesaler" TEXT;
ALTER TABLE "CatalogueSupplier" ADD CONSTRAINT "CatalogueSupplier_wholesaler_check" CHECK ("wholesaler" IS NULL OR "wholesaler" IN ('solar', 'ahlsell', 'sonepar', 'rexel'));
CREATE INDEX "CatalogueSupplier_organizationId_wholesaler_idx" ON "CatalogueSupplier"("organizationId", "wholesaler");
-- Suppliers already named after a wholesaler get it, as the export already took them to be.
UPDATE "CatalogueSupplier" SET "wholesaler" = CASE
  WHEN lower("name") ~ '\msolar\M' THEN 'solar'
  WHEN lower("name") ~ '\mahlsell\M' THEN 'ahlsell'
  WHEN lower("name") ~ '\msonepar\M' THEN 'sonepar'
  WHEN lower("name") ~ '\mrexel\M' THEN 'rexel'
  ELSE NULL END
WHERE "wholesaler" IS NULL;
