-- Materialsökningen (2026-10-09): a price file may carry the manufacturer's article number beside the
-- supplier's; it is kept on the article and copied to a material row when the article is picked. Additive, no data
-- changes: existing articles get "" and keep everything else.
ALTER TABLE "CatalogueArticle" ADD COLUMN "manufacturerArticleNo" TEXT NOT NULL DEFAULT '';
