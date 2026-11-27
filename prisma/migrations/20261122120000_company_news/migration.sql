-- Nyheter (2026-11-21): the company's internal news under Mer > Nyheter (lib/news). Only additions: one new table with its indexes
-- and its foreign key; the old app never reads it. The module key "news" needs no data change: a company's list of what is off is
-- empty for it, so the module is on everywhere from the start.
BEGIN;

-- CreateTable
CREATE TABLE "CompanyNewsPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "agentMissionId" TEXT,
    "agentName" TEXT,
    "authorUserId" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyNewsPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyNewsPost_organizationId_source_sourceRef_key" ON "CompanyNewsPost"("organizationId", "source", "sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyNewsPost_id_organizationId_key" ON "CompanyNewsPost"("id", "organizationId");

-- CreateIndex
CREATE INDEX "CompanyNewsPost_organizationId_deletedAt_status_publishedAt_idx" ON "CompanyNewsPost"("organizationId", "deletedAt", "status", "publishedAt");

-- AddForeignKey
ALTER TABLE "CompanyNewsPost" ADD CONSTRAINT "CompanyNewsPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
