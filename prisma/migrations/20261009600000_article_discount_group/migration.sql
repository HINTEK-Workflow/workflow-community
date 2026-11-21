-- Artiklar och priser, prisfil (2026-10-08): the supplier's discount group on an article (Rabattgrupp/Produktgrupp in
-- the company's own price file), kept for steg 2 (discount file -> net price). Backward compatible: a new column with
-- an empty default, nothing existing changes.
ALTER TABLE "CatalogueArticle" ADD COLUMN "discountGroup" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "CatalogueArticle_organizationId_supplierId_discountGroup_idx" ON "CatalogueArticle"("organizationId", "supplierId", "discountGroup");
