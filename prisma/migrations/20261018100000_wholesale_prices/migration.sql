-- Priser direkt mot grossistens katalogartikel (2026-10-17, alternativ C in docs/proposals/priser-mot-katalogartikel-2026-10-17.md):
-- the wholesaler's article exists once (WholesaleArticle); a company stores only its price on it (WholesalePrice) and, per import,
-- one bit list of the articles the file had (WholesaleImportSeen) instead of a confirmation row per unchanged price.
-- Additive only: a running number on the register, two new tables, a wider key check. Nothing existing is changed or removed;
-- the companies' own suppliers keep CatalogueArticle/CataloguePrice untouched. Production has no register rows yet.

-- A running number, never reused. ADD COLUMN ... SERIAL numbers the rows that exist.
ALTER TABLE "WholesaleArticle" ADD COLUMN "seq" SERIAL NOT NULL;
CREATE UNIQUE INDEX "WholesaleArticle_seq_key" ON "WholesaleArticle"("seq");

CREATE TABLE "WholesalePrice" (
    "id" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "perQuantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SEK',
    "priceKind" TEXT NOT NULL DEFAULT 'NET',
    "priceDate" DATE NOT NULL,
    "discountGroup" TEXT NOT NULL DEFAULT '',
    "packageSize" TEXT NOT NULL DEFAULT '',
    "orderMultiple" TEXT NOT NULL DEFAULT '',
    "minOrderQuantity" TEXT NOT NULL DEFAULT '',
    "stocked" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesalePrice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WholesalePrice_priceKind_check" CHECK ("priceKind" IN ('NET', 'BASE')),
    CONSTRAINT "WholesalePrice_perQuantity_check" CHECK ("perQuantity" >= 1)
);

-- seq first: the restrict check on the register, "has a price" and the search look up by article; the company comes next.
CREATE INDEX "WholesalePrice_seq_organizationId_createdAt_idx" ON "WholesalePrice"("seq", "organizationId", "createdAt");
CREATE INDEX "WholesalePrice_organizationId_idx" ON "WholesalePrice"("organizationId");
CREATE INDEX "WholesalePrice_importId_idx" ON "WholesalePrice"("importId");

ALTER TABLE "WholesalePrice" ADD CONSTRAINT "WholesalePrice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- The composite key makes the database itself refuse a price whose import belongs to another company.
ALTER TABLE "WholesalePrice" ADD CONSTRAINT "WholesalePrice_importId_organizationId_fkey" FOREIGN KEY ("importId", "organizationId") REFERENCES "CatalogueImport"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT: an article with a price can never be deleted (the sync marks it obsolete, status 40, instead).
ALTER TABLE "WholesalePrice" ADD CONSTRAINT "WholesalePrice_seq_fkey" FOREIGN KEY ("seq") REFERENCES "WholesaleArticle"("seq") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WholesaleImportSeen" (
    "importId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "seen" BYTEA NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "confirmedDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesaleImportSeen_pkey" PRIMARY KEY ("importId")
);

CREATE INDEX "WholesaleImportSeen_organizationId_idx" ON "WholesaleImportSeen"("organizationId");

ALTER TABLE "WholesaleImportSeen" ADD CONSTRAINT "WholesaleImportSeen_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleImportSeen" ADD CONSTRAINT "WholesaleImportSeen_importId_organizationId_fkey" FOREIGN KEY ("importId", "organizationId") REFERENCES "CatalogueImport"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only, like CataloguePrice: a new price is a new row, and a bit list is written once when the import finishes.
CREATE OR REPLACE FUNCTION wholesale_price_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: a change is a new row, a bit list is written once.', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WholesalePrice_append_only" BEFORE UPDATE ON "WholesalePrice"
  FOR EACH ROW EXECUTE FUNCTION wholesale_price_append_only();
CREATE TRIGGER "WholesaleImportSeen_append_only" BEFORE UPDATE ON "WholesaleImportSeen"
  FOR EACH ROW EXECUTE FUNCTION wholesale_price_append_only();

-- Favourites and list lines may also point at a wholesaler's article without a common number: W:<wholesaler>:<article number>.
ALTER TABLE "CatalogueFavorite" DROP CONSTRAINT "CatalogueFavorite_refKey_check";
ALTER TABLE "CatalogueFavorite" ADD CONSTRAINT "CatalogueFavorite_refKey_check" CHECK ("refKey" ~ '^(E|RSK|GTIN|MPN|A|W):.{1,120}$');
ALTER TABLE "CatalogueListLine" DROP CONSTRAINT "CatalogueListLine_refKey_check";
ALTER TABLE "CatalogueListLine" ADD CONSTRAINT "CatalogueListLine_refKey_check" CHECK ("refKey" IS NULL OR "refKey" ~ '^(E|RSK|GTIN|MPN|A|W):.{1,120}$');
