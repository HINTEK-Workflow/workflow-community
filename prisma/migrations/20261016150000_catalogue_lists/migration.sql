-- Favoriter och artikellistor (2026-10-16, docs/artikellistor.md).
--
-- Additive only: three new tables. Nothing existing is changed or removed.
-- 1. A favourite belongs to one person within one company; a list and its lines belong to one company, and a line points
--    at its list through [listId, organizationId] -> [id, organizationId], so the database refuses a line in another
--    company's list.
-- 2. Neither a favourite nor a line has a foreign key into the register: they point at an article by its key
--    ("E:1234567", "RSK:…", "GTIN:…", "MPN:…" for a product, "A:<id>" for a supplier's own article), so a new price file,
--    a removed import or a product made again never removes them, and they always show today's price. A CHECK keeps the
--    key's form; the server resolves it within the caller's company only.

-- CreateTable
CREATE TABLE "CatalogueFavorite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refKey" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "updatedById" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogueList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueListLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "refKey" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DECIMAL(14,4) NOT NULL,
    "snapshot" JSONB,

    CONSTRAINT "CatalogueListLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogueFavorite_organizationId_userId_createdAt_idx" ON "CatalogueFavorite"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueFavorite_organizationId_userId_refKey_key" ON "CatalogueFavorite"("organizationId", "userId", "refKey");

-- CreateIndex
CREATE INDEX "CatalogueList_organizationId_name_idx" ON "CatalogueList"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueList_id_organizationId_key" ON "CatalogueList"("id", "organizationId");

-- CreateIndex
CREATE INDEX "CatalogueListLine_organizationId_listId_position_idx" ON "CatalogueListLine"("organizationId", "listId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueListLine_id_organizationId_key" ON "CatalogueListLine"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "CatalogueFavorite" ADD CONSTRAINT "CatalogueFavorite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueFavorite" ADD CONSTRAINT "CatalogueFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueList" ADD CONSTRAINT "CatalogueList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueListLine" ADD CONSTRAINT "CatalogueListLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueListLine" ADD CONSTRAINT "CatalogueListLine_listId_organizationId_fkey" FOREIGN KEY ("listId", "organizationId") REFERENCES "CatalogueList"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- The key's form and a positive quantity ----------
ALTER TABLE "CatalogueFavorite" ADD CONSTRAINT "CatalogueFavorite_refKey_check" CHECK ("refKey" ~ '^(E|RSK|GTIN|MPN|A):.{1,120}$');
ALTER TABLE "CatalogueListLine" ADD CONSTRAINT "CatalogueListLine_refKey_check" CHECK ("refKey" IS NULL OR "refKey" ~ '^(E|RSK|GTIN|MPN|A):.{1,120}$');
ALTER TABLE "CatalogueListLine" ADD CONSTRAINT "CatalogueListLine_quantity_check" CHECK ("quantity" > 0);
