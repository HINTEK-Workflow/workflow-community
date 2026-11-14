-- Återkommande och kö (2026-11-12): the company's publishing rhythm for posts, and the kind of a content series
-- (themes or queue). Additive: one new table and one column with a default; the old app never reads them.
BEGIN;

-- AlterTable
ALTER TABLE "ContentSeries" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'themes';

-- CreateTable
CREATE TABLE "PostingRhythm" (
    "organizationId" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "time" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingRhythm_pkey" PRIMARY KEY ("organizationId")
);

-- AddForeignKey
ALTER TABLE "PostingRhythm" ADD CONSTRAINT "PostingRhythm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
