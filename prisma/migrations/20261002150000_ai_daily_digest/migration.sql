-- Dagsammanställningen (plan 2026-10-01, fas 4): one short digest per company and day, written at night for the
-- companies that have chosen it. Numbers and project names only. Additive.
CREATE TABLE "AiDailyDigest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDailyDigest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiDailyDigest_organizationId_day_key" ON "AiDailyDigest"("organizationId", "day");
CREATE INDEX "AiDailyDigest_organizationId_createdAt_idx" ON "AiDailyDigest"("organizationId", "createdAt");
