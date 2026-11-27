-- Serverjobb (2026-11-14): one row per scheduled job the app runs, with its pause switch, the running run's lease and the
-- last run. Additive: a new table; the old app never reads it, and a job that cannot reach it runs as before (scripts/ops/job.ts).
BEGIN;

-- CreateTable
CREATE TABLE "ServerJob" (
    "key" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pausedById" TEXT,
    "pausedAt" TIMESTAMP(3),
    "runRequestedAt" TIMESTAMP(3),
    "runRequestedById" TEXT,
    "runId" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "lastTrigger" TEXT,
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastMessage" TEXT,
    "lastDurationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerJob_pkey" PRIMARY KEY ("key")
);

COMMIT;
