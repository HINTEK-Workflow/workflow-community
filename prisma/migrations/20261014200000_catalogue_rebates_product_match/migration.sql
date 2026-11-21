-- Rabattbrev, samma produkt och grossistens katalog (2026-10-14). Additive: new columns with defaults, two new
-- tables and indexes; the product's two CHECK constraints are widened (they keep every row they accepted before).

-- 1. Samma produkt hos flera leverantörer: an article's GTIN/EAN and manufacturer from the company's own file, and on the
--    product the GTIN and manufacturer key it is known by, so a file without E-nummer meets the same product.
ALTER TABLE "CatalogueArticle" ADD COLUMN "gtin" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogueArticle" ADD COLUMN "manufacturer" TEXT NOT NULL DEFAULT '';
CREATE INDEX "CatalogueArticle_organizationId_gtin_idx" ON "CatalogueArticle"("organizationId", "gtin");

ALTER TABLE "CatalogueProduct" ADD COLUMN "gtin" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogueProduct" ADD COLUMN "mpnKey" TEXT NOT NULL DEFAULT '';
-- Master data from a wholesaler's catalogue (Solar's API: name, unit, GTIN, manufacturer, image link), with its source
-- and time. Never a price.
ALTER TABLE "CatalogueProduct" ADD COLUMN "master" JSONB;
ALTER TABLE "CatalogueProduct" DROP CONSTRAINT "CatalogueProduct_numberKind_check";
ALTER TABLE "CatalogueProduct" ADD CONSTRAINT "CatalogueProduct_numberKind_check" CHECK ("numberKind" IN ('E', 'RSK', 'GTIN', 'MPN'));
ALTER TABLE "CatalogueProduct" DROP CONSTRAINT "CatalogueProduct_number_check";
ALTER TABLE "CatalogueProduct" ADD CONSTRAINT "CatalogueProduct_number_check" CHECK (
  ("numberKind" IN ('E', 'RSK') AND "number" ~ '^[0-9]{7}$')
  OR ("numberKind" = 'GTIN' AND "number" ~ '^[0-9]{14}$')
  OR ("numberKind" = 'MPN' AND length("number") BETWEEN 3 AND 120));
CREATE INDEX "CatalogueProduct_organizationId_gtin_idx" ON "CatalogueProduct"("organizationId", "gtin");
CREATE INDEX "CatalogueProduct_organizationId_mpnKey_idx" ON "CatalogueProduct"("organizationId", "mpnKey");

-- 2. Rabattbrev: an import is a price list or a discount letter; a letter's rules per group or article. Only the latest
--    finished letter of a supplier applies; removing it brings back the one before.
ALTER TABLE "CatalogueImport" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PRICES';
ALTER TABLE "CatalogueImport" ADD CONSTRAINT "CatalogueImport_kind_check" CHECK ("kind" IN ('PRICES', 'REBATE'));
CREATE INDEX "CatalogueImport_organizationId_supplierId_kind_createdAt_idx" ON "CatalogueImport"("organizationId", "supplierId", "kind", "createdAt");

CREATE TABLE "CatalogueRebate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "percent2" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "netPrice" DECIMAL(14,4),
    CONSTRAINT "CatalogueRebate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CatalogueRebate_kind_check" CHECK ("kind" IN ('GROUP', 'ARTICLE', 'NET')),
    CONSTRAINT "CatalogueRebate_percent_check" CHECK ("percent" BETWEEN 0 AND 100 AND "percent2" BETWEEN 0 AND 100)
);
CREATE INDEX "CatalogueRebate_importId_kind_key_idx" ON "CatalogueRebate"("importId", "kind", "key");
CREATE INDEX "CatalogueRebate_organizationId_idx" ON "CatalogueRebate"("organizationId");
ALTER TABLE "CatalogueRebate" ADD CONSTRAINT "CatalogueRebate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogueRebate" ADD CONSTRAINT "CatalogueRebate_supplierId_organizationId_fkey"
    FOREIGN KEY ("supplierId", "organizationId") REFERENCES "CatalogueSupplier"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogueRebate" ADD CONSTRAINT "CatalogueRebate_importId_organizationId_fkey"
    FOREIGN KEY ("importId", "organizationId") REFERENCES "CatalogueImport"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Grossistens katalog: short-lived answers of a wholesaler's catalogue API per identifier (master data only, never a
--    price), shared by every company since it is the wholesaler's public product data, not a company's.
CREATE TABLE "ExternalProductCache" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "identifierKind" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "data" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalProductCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExternalProductCache_source_identifierKind_identifier_key" ON "ExternalProductCache"("source", "identifierKind", "identifier");
