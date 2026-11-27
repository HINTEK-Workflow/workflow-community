-- Gemensamt artikelregister (2026-10-17, docs/proposals/gemensamt-artikelregister-forslag-2026-10-17.md; replaces the
-- decision of 2026-10-15 "no shared product database"): a wholesaler's catalogue as a shared, price-free search register.
-- Global HINTEK product data – no organizationId, no price column, no company data – written only by the register sync and
-- read by every company's article search; the companies' own price files, prices and discount letters are unchanged.
-- Additive only: two new tables and their indexes, nothing existing is changed.

CREATE TABLE "WholesaleArticle" (
    "id" TEXT NOT NULL,
    "wholesaler" TEXT NOT NULL,
    "articleNo" TEXT NOT NULL,
    "eNumber" TEXT NOT NULL DEFAULT '',
    "gtin" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "manufacturerArticleNo" TEXT NOT NULL DEFAULT '',
    "mpnNorm" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "productType" TEXT NOT NULL DEFAULT '',
    "etimClass" TEXT NOT NULL DEFAULT '',
    "series" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "productKey" TEXT NOT NULL DEFAULT '',
    "searchText" TEXT NOT NULL DEFAULT '',
    "lastChanged" TIMESTAMP(3),
    "seenRun" TEXT NOT NULL DEFAULT '',
    "pendingRun" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesaleArticle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WholesaleArticle_wholesaler_check" CHECK ("wholesaler" IN ('solar', 'ahlsell', 'rexel', 'sonepar')),
    CONSTRAINT "WholesaleArticle_eNumber_check" CHECK ("eNumber" = '' OR "eNumber" ~ '^[0-9]{7}$'),
    CONSTRAINT "WholesaleArticle_gtin_check" CHECK ("gtin" = '' OR "gtin" ~ '^[0-9]{14}$')
);

CREATE UNIQUE INDEX "WholesaleArticle_wholesaler_articleNo_key" ON "WholesaleArticle"("wholesaler", "articleNo");
CREATE INDEX "WholesaleArticle_eNumber_idx" ON "WholesaleArticle"("eNumber");
CREATE INDEX "WholesaleArticle_gtin_idx" ON "WholesaleArticle"("gtin");
CREATE INDEX "WholesaleArticle_mpnNorm_idx" ON "WholesaleArticle"("mpnNorm");
CREATE INDEX "WholesaleArticle_productKey_idx" ON "WholesaleArticle"("productKey");
CREATE INDEX "WholesaleArticle_wholesaler_seenRun_idx" ON "WholesaleArticle"("wholesaler", "seenRun");

CREATE TABLE "WholesaleRegisterSync" (
    "wholesaler" TEXT NOT NULL,
    "syncedFrom" TIMESTAMP(3),
    "lastFullAt" TIMESTAMP(3),
    "runId" TEXT,
    "runKind" TEXT,
    "runStartedAt" TIMESTAMP(3),
    "runHeartbeatAt" TIMESTAMP(3),
    "requestedKind" TEXT,
    "requestedAt" TIMESTAMP(3),
    "requestedBy" TEXT,
    "lastRun" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesaleRegisterSync_pkey" PRIMARY KEY ("wholesaler")
);

-- The trigram index on the search text, with pg_trgm's own schema (the extension may live outside the search path).
DO $$
DECLARE
  trgm_schema text;
BEGIN
  SELECT n.nspname INTO trgm_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm';
  IF trgm_schema IS NOT NULL THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS "WholesaleArticle_searchText_trgm" ON "WholesaleArticle" USING gin ("searchText" %I.gin_trgm_ops)', trgm_schema);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'The register search trigram index was not created (%); the search still works.', SQLERRM;
END
$$;
