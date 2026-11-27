-- Tavlor och skärmar, etapp 1 (2026-11-18, docs/beslut/tavlor-och-skarmar.md): boards with a draft and locked published versions,
-- the boards' own tables (Egen tabell) with their rows, and the pictures of the image cards. Additive: five new tables; the old
-- app never reads them.
BEGIN;

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "draft" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "publishedVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "layout" JSONB NOT NULL,
    "visibility" JSONB NOT NULL DEFAULT '{}',
    "publishedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardDataSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'table',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "columns" JSONB NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BoardDataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardDataRow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "values" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardDataRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardImage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Board_organizationId_deletedAt_updatedAt_idx" ON "Board"("organizationId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Board_id_organizationId_key" ON "Board"("id", "organizationId");

-- CreateIndex
CREATE INDEX "BoardVersion_organizationId_boardId_idx" ON "BoardVersion"("organizationId", "boardId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardVersion_boardId_number_key" ON "BoardVersion"("boardId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "BoardVersion_id_organizationId_key" ON "BoardVersion"("id", "organizationId");

-- CreateIndex
CREATE INDEX "BoardDataSource_organizationId_deletedAt_idx" ON "BoardDataSource"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BoardDataSource_id_organizationId_key" ON "BoardDataSource"("id", "organizationId");

-- CreateIndex
CREATE INDEX "BoardDataRow_organizationId_sourceId_position_idx" ON "BoardDataRow"("organizationId", "sourceId", "position");

-- CreateIndex
CREATE INDEX "BoardImage_organizationId_createdAt_idx" ON "BoardImage"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardVersion" ADD CONSTRAINT "BoardVersion_boardId_organizationId_fkey" FOREIGN KEY ("boardId", "organizationId") REFERENCES "Board"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardDataSource" ADD CONSTRAINT "BoardDataSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardDataRow" ADD CONSTRAINT "BoardDataRow_sourceId_organizationId_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "BoardDataSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardImage" ADD CONSTRAINT "BoardImage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
