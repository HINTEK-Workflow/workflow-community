-- Förpackning, beställningsmultipel, artikelstatus och artiklar som saknas i senaste prisfilen (2026-10-15).
-- Additive only: new columns with defaults; nothing existing is changed.
ALTER TABLE "CatalogueArticle" ADD COLUMN "packageSize" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogueArticle" ADD COLUMN "orderMultiple" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogueArticle" ADD COLUMN "minOrderQuantity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogueArticle" ADD COLUMN "stocked" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogueArticle" ADD COLUMN "status" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogueImport" ADD COLUMN "missingArticles" INTEGER NOT NULL DEFAULT 0;
