-- Beteendeanalys (2026-10-07): anonymous daily counters and the settings that govern them. Additive and repeatable.
CREATE TABLE IF NOT EXISTS "AnalyticsCounter" (
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AnalyticsCounter_pkey" PRIMARY KEY ("day", "kind", "key")
);
CREATE INDEX IF NOT EXISTS "AnalyticsCounter_kind_day_idx" ON "AnalyticsCounter"("kind", "day");
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "analytics" JSONB NOT NULL DEFAULT '{}';
