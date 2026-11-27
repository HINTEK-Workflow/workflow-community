-- Solars kategorier (2026-10-15): the wholesaler's category tree from Solar's Get Categories, fetched by the
-- product owner under Servernycklar. Global HINTEK product data, one row per Solar category for every company – no
-- organizationId. Additive only: a new table, nothing existing is changed.

-- CreateTable
CREATE TABLE "SolarCategory" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "etimClass" TEXT NOT NULL DEFAULT '',
    "etimName" TEXT NOT NULL DEFAULT '',
    "parent" TEXT NOT NULL DEFAULT '',
    "countryCode" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolarCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SolarCategory_parent_idx" ON "SolarCategory"("parent");
