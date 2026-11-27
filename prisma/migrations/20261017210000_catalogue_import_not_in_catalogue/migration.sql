-- Prisfiler synkas mot grossistens katalog (2026-10-17): how many rows of a price file found no article in the wholesaler's catalogue
-- (or only one with another unit) and were left out. Additive: one column with a default.
ALTER TABLE "CatalogueImport" ADD COLUMN "notInCatalogue" INTEGER NOT NULL DEFAULT 0;
