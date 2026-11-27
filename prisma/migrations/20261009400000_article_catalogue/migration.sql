-- Artiklar och priser, steg 1 (2026-10-08, docs/proposals/grossistimport-2026-10-08.md).
-- Each company's own catalogue: its suppliers, articles, prices as history, imports and saved column mappings. New
-- tables only; nothing existing is changed. Every link between the tables is a composite [x, organizationId] key, so the
-- database refuses a link into another company. Prices are append-only: a trigger refuses UPDATE (DELETE stays possible,
-- through "delete an import" and the company's own removal). Prisma does not manage triggers, so it is not schema drift
-- (same convention as 20260925180000_tenant_hardening).

-- CreateTable
CREATE TABLE "CatalogueSupplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "customerNumber" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogueSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueArticle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierArticleNo" TEXT NOT NULL DEFAULT '',
    "eNumber" TEXT NOT NULL DEFAULT '',
    "articleKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogueArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CataloguePrice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "perQuantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SEK',
    "priceDate" DATE NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CataloguePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdById" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "newArticles" INTEGER NOT NULL DEFAULT 0,
    "changedPrices" INTEGER NOT NULL DEFAULT 0,
    "unchangedPrices" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueImportProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogueImportProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueSupplier_id_organizationId_key" ON "CatalogueSupplier"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueSupplier_organizationId_nameKey_key" ON "CatalogueSupplier"("organizationId", "nameKey");

-- CreateIndex
CREATE INDEX "CatalogueArticle_organizationId_eNumber_idx" ON "CatalogueArticle"("organizationId", "eNumber");

-- CreateIndex
CREATE INDEX "CatalogueArticle_organizationId_name_idx" ON "CatalogueArticle"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueArticle_id_organizationId_key" ON "CatalogueArticle"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueArticle_organizationId_supplierId_articleKey_key" ON "CatalogueArticle"("organizationId", "supplierId", "articleKey");

-- CreateIndex
CREATE INDEX "CataloguePrice_organizationId_articleId_createdAt_idx" ON "CataloguePrice"("organizationId", "articleId", "createdAt");

-- CreateIndex
CREATE INDEX "CataloguePrice_importId_idx" ON "CataloguePrice"("importId");

-- CreateIndex
CREATE INDEX "CatalogueImport_organizationId_createdAt_idx" ON "CatalogueImport"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogueImport_organizationId_contentHash_idx" ON "CatalogueImport"("organizationId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueImport_id_organizationId_key" ON "CatalogueImport"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueImportProfile_organizationId_supplierId_fingerprin_key" ON "CatalogueImportProfile"("organizationId", "supplierId", "fingerprint");

-- AddForeignKey
ALTER TABLE "CatalogueSupplier" ADD CONSTRAINT "CatalogueSupplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueArticle" ADD CONSTRAINT "CatalogueArticle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueArticle" ADD CONSTRAINT "CatalogueArticle_supplierId_organizationId_fkey" FOREIGN KEY ("supplierId", "organizationId") REFERENCES "CatalogueSupplier"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CataloguePrice" ADD CONSTRAINT "CataloguePrice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CataloguePrice" ADD CONSTRAINT "CataloguePrice_articleId_organizationId_fkey" FOREIGN KEY ("articleId", "organizationId") REFERENCES "CatalogueArticle"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CataloguePrice" ADD CONSTRAINT "CataloguePrice_importId_organizationId_fkey" FOREIGN KEY ("importId", "organizationId") REFERENCES "CatalogueImport"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueImport" ADD CONSTRAINT "CatalogueImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueImport" ADD CONSTRAINT "CatalogueImport_supplierId_organizationId_fkey" FOREIGN KEY ("supplierId", "organizationId") REFERENCES "CatalogueSupplier"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueImportProfile" ADD CONSTRAINT "CatalogueImportProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueImportProfile" ADD CONSTRAINT "CatalogueImportProfile_supplierId_organizationId_fkey" FOREIGN KEY ("supplierId", "organizationId") REFERENCES "CatalogueSupplier"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Append-only price history.
CREATE OR REPLACE FUNCTION catalogue_price_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CataloguePrice is append-only: a new price is a new row.' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CataloguePrice_append_only" BEFORE UPDATE ON "CataloguePrice"
  FOR EACH ROW EXECUTE FUNCTION catalogue_price_append_only();
