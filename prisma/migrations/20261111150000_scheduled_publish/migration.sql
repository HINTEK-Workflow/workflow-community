-- Schemalägg och innehållsserier (2026-11-11): three new tables; nothing existing changes, and the old app never reads them.
BEGIN;

-- CreateTable
CREATE TABLE "ScheduledPublish" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "runAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seriesId" TEXT,
    "scheduledById" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "result" TEXT,
    "publishedAt" TIMESTAMP(3),
    "failureMailedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledPublish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentSeries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDay" TEXT NOT NULL,
    "endDay" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "time" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentSeriesItem" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "slotAt" TIMESTAMP(3) NOT NULL,
    "theme" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "textSource" TEXT NOT NULL DEFAULT 'rules',

    CONSTRAINT "ContentSeriesItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledPublish_status_nextAttemptAt_idx" ON "ScheduledPublish"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ScheduledPublish_organizationId_runAt_idx" ON "ScheduledPublish"("organizationId", "runAt");

-- CreateIndex
CREATE INDEX "ScheduledPublish_organizationId_kind_targetId_idx" ON "ScheduledPublish"("organizationId", "kind", "targetId");

-- CreateIndex
CREATE INDEX "ContentSeries_organizationId_createdAt_idx" ON "ContentSeries"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentSeries_id_organizationId_key" ON "ContentSeries"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentSeriesItem_postId_key" ON "ContentSeriesItem"("postId");

-- CreateIndex
CREATE INDEX "ContentSeriesItem_seriesId_position_idx" ON "ContentSeriesItem"("seriesId", "position");

-- AddForeignKey
ALTER TABLE "ScheduledPublish" ADD CONSTRAINT "ScheduledPublish_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledPublish" ADD CONSTRAINT "ScheduledPublish_seriesId_organizationId_fkey" FOREIGN KEY ("seriesId", "organizationId") REFERENCES "ContentSeries"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentSeries" ADD CONSTRAINT "ContentSeries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentSeriesItem" ADD CONSTRAINT "ContentSeriesItem_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ContentSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
