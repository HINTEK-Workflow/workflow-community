-- Agenter (2026-11-21): missions HINTEK AI carries out on a schedule with the owner's own rights, and their runs. A run has
-- its own key per mission and slot (unique per company), so the same run is never made twice; its feedback channels keep their own
-- status. Removing a mission sets deletedAt, so its runs and what it made stay. The built-in agents' choices have a table of their own. Three new tables; nothing else changes.
BEGIN;

-- CreateTable
CREATE TABLE "AgentMission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instruction" TEXT NOT NULL DEFAULT '',
    "templateKey" TEXT NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "schedule" JSONB NOT NULL,
    "target" JSONB NOT NULL,
    "feedback" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "pausedReason" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "firstRunPending" BOOLEAN NOT NULL DEFAULT true,
    "failureStreak" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastOutcome" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "slotAt" TIMESTAMP(3) NOT NULL,
    "event" JSONB,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "read" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "report" JSONB NOT NULL DEFAULT '{}',
    "feedback" JSONB NOT NULL DEFAULT '{}',
    "cost" TEXT NOT NULL DEFAULT 'rules',
    "chargedCredits" INTEGER NOT NULL DEFAULT 0,
    "aiRunId" TEXT,
    "message" TEXT,
    "startedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable: the built-in agents' own choices, the company's (userId '') and each person's.
CREATE TABLE "AgentSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "agentId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentSetting_organizationId_userId_agentId_key" ON "AgentSetting"("organizationId", "userId", "agentId");

-- AddForeignKey
ALTER TABLE "AgentSetting" ADD CONSTRAINT "AgentSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AgentMission_status_nextRunAt_idx" ON "AgentMission"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "AgentMission_organizationId_deletedAt_createdAt_idx" ON "AgentMission"("organizationId", "deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMission_id_organizationId_key" ON "AgentMission"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AgentRun_status_nextAttemptAt_idx" ON "AgentRun"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AgentRun_missionId_createdAt_idx" ON "AgentRun"("missionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_organizationId_runKey_key" ON "AgentRun"("organizationId", "runKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_id_organizationId_key" ON "AgentRun"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "AgentMission" ADD CONSTRAINT "AgentMission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_missionId_organizationId_fkey" FOREIGN KEY ("missionId", "organizationId") REFERENCES "AgentMission"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
