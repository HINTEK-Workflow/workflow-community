-- Maskinanalys (0.19.0). Additive only: two nullable columns on MachineSource and one new table.
-- (sourceId, dedupeKey) is unique, so the same observation never makes two suggestions.

-- AlterTable
ALTER TABLE "MachineSource" ADD COLUMN "analysisTuning" JSONB,
ADD COLUMN "lastAnalysedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MachineSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "MachineSuggestion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachineSuggestion_kind_check" CHECK ("kind" IN ('flutter', 'denser', 'silent')),
    CONSTRAINT "MachineSuggestion_status_check" CHECK ("status" IN ('open', 'dismissed', 'acknowledged'))
);

-- CreateIndex
CREATE UNIQUE INDEX "MachineSuggestion_sourceId_dedupeKey_key" ON "MachineSuggestion"("sourceId", "dedupeKey");
CREATE INDEX "MachineSuggestion_organizationId_status_createdAt_idx" ON "MachineSuggestion"("organizationId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "MachineSuggestion" ADD CONSTRAINT "MachineSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineSuggestion" ADD CONSTRAINT "MachineSuggestion_sourceId_organizationId_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "MachineSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
