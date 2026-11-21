-- Prisfiler, etapp 1 (2026-10-12, docs/proposals/prisfiler-analys-2026-10-12.md, docs/prisfiler-import-och-sok.md).
-- Additive only: one new table, new columns with defaults, a trigger, indexes. Nothing existing is changed or removed.
--
-- 1. One article register per company (2026-10-12): "CatalogueProduct" is a product of ONE company, keyed by a
--    common number – the E-nummer (el) or the RSK-nummer (VVS), seven digits. Each supplier's article (its own article
--    number, price history and unit, unchanged in "CatalogueArticle") links to the company's product with the same
--    common number. Articles without a common number stay their supplier's own product (productId NULL). Products are
--    never merged on similar names or on digits from another numbering system, never shared between companies, and the
--    link is a composite [productId, organizationId] key, so the database refuses a link into another company.
-- 2. Article search: the article number normalised ("articleNoNorm": folded letters and digits only; "articleNoCore":
--    without an E in front of seven digits and without leading zeros) and one folded search text, kept by a trigger
--    (the same steps as lib/catalogue/normalize.ts), with B-tree indexes for exact and prefix hits and a trigram index
--    for words, parts of words and typing errors. Prisma never reads or writes these three columns (@ignore).
-- 3. The saved column profile of a supplier also keeps how the file is read ("format": headings or not, fixed-width
--    positions, price scale, article number as E-nummer).

CREATE TABLE "CatalogueProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "numberKind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueProduct_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CatalogueProduct_numberKind_check" CHECK ("numberKind" IN ('E', 'RSK')),
    CONSTRAINT "CatalogueProduct_number_check" CHECK ("number" ~ '^[0-9]{7}$')
);

CREATE UNIQUE INDEX "CatalogueProduct_id_organizationId_key" ON "CatalogueProduct"("id", "organizationId");
CREATE UNIQUE INDEX "CatalogueProduct_organizationId_numberKind_number_key" ON "CatalogueProduct"("organizationId", "numberKind", "number");

ALTER TABLE "CatalogueProduct" ADD CONSTRAINT "CatalogueProduct_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogueArticle" ADD COLUMN "rskNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogueArticle" ADD COLUMN "productId" TEXT;
ALTER TABLE "CatalogueArticle" ADD COLUMN "articleNoNorm" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogueArticle" ADD COLUMN "articleNoCore" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CatalogueArticle" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

-- NO ACTION: a product is removed only by the app when no article links to it any more (lib/catalogue/server.ts).
ALTER TABLE "CatalogueArticle" ADD CONSTRAINT "CatalogueArticle_productId_organizationId_fkey"
    FOREIGN KEY ("productId", "organizationId") REFERENCES "CatalogueProduct"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE INDEX "CatalogueArticle_organizationId_productId_idx" ON "CatalogueArticle"("organizationId", "productId");
CREATE INDEX "CatalogueArticle_organizationId_articleNoNorm_idx" ON "CatalogueArticle"("organizationId", "articleNoNorm" text_pattern_ops);
CREATE INDEX "CatalogueArticle_organizationId_articleNoCore_idx" ON "CatalogueArticle"("organizationId", "articleNoCore");

ALTER TABLE "CatalogueImportProfile" ADD COLUMN "format" JSONB;

-- The normalised numbers and the search text. If search_fold() or these steps change, update lib/catalogue/normalize.ts
-- and run the backfill below again in that migration.
CREATE OR REPLACE FUNCTION catalogue_article_search_text() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  norm text;
  plain text;
BEGIN
  norm := regexp_replace(search_fold(coalesce(NEW."supplierArticleNo", '')), '[^a-z0-9]', '', 'g');
  plain := CASE WHEN norm ~ '^e[0-9]{7}$' THEN substr(norm, 2) ELSE norm END;
  NEW."articleNoNorm" := norm;
  NEW."articleNoCore" := CASE WHEN plain = '' THEN '' WHEN ltrim(plain, '0') = '' THEN '0' ELSE ltrim(plain, '0') END;
  NEW."searchText" := left(search_fold(
    coalesce(NEW.name, '') || ' ' || coalesce(NEW."supplierArticleNo", '') || ' ' || norm || ' ' ||
    coalesce(NEW."manufacturerArticleNo", '') || ' ' || regexp_replace(search_fold(coalesce(NEW."manufacturerArticleNo", '')), '[^a-z0-9]', '', 'g') || ' ' ||
    coalesce(NEW."eNumber", '') || ' ' || coalesce(NEW."rskNumber", '')), 2000);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "CatalogueArticle_search_text" ON "CatalogueArticle";
CREATE TRIGGER "CatalogueArticle_search_text" BEFORE INSERT OR UPDATE OF name, "supplierArticleNo", "manufacturerArticleNo", "eNumber", "rskNumber" ON "CatalogueArticle"
  FOR EACH ROW EXECUTE FUNCTION catalogue_article_search_text();

-- Existing rows: assigning a watched column runs the trigger once per row.
UPDATE "CatalogueArticle" SET name = name;

-- Existing articles with a seven-digit E-nummer join their company's product (one per company and number).
INSERT INTO "CatalogueProduct" ("id", "organizationId", "numberKind", "number", "name", "unit")
SELECT DISTINCT ON (a."organizationId", a."eNumber")
  'cp' || substr(md5(a."organizationId" || ':E:' || a."eNumber"), 1, 23), a."organizationId", 'E', a."eNumber", a.name, a.unit
FROM "CatalogueArticle" a
WHERE a."eNumber" ~ '^[0-9]{7}$'
ORDER BY a."organizationId", a."eNumber", a."createdAt", a.id
ON CONFLICT DO NOTHING;

UPDATE "CatalogueArticle" a SET "productId" = p.id
FROM "CatalogueProduct" p
WHERE p."organizationId" = a."organizationId" AND p."numberKind" = 'E' AND p."number" = a."eNumber" AND a."productId" IS NULL;

-- The trigram index on the search text, with pg_trgm's own schema (the extension may live outside the search path).
DO $$
DECLARE
  trgm_schema text;
BEGIN
  SELECT n.nspname INTO trgm_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm';
  IF trgm_schema IS NOT NULL THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS "CatalogueArticle_searchText_trgm" ON "CatalogueArticle" USING gin ("searchText" %I.gin_trgm_ops)', trgm_schema);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'The article search trigram index was not created (%); the search still works.', SQLERRM;
END
$$;
