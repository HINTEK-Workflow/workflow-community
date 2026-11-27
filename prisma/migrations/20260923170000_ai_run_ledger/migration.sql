CREATE TYPE "AiRunStatus" AS ENUM (
  'RESERVED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELED'
);

CREATE TABLE "AiRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "controlId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "status" "AiRunStatus" NOT NULL DEFAULT 'RESERVED',
  "provider" TEXT NOT NULL DEFAULT 'OPENAI',
  "model" TEXT NOT NULL,
  "reasoningEffort" TEXT NOT NULL,
  "pricingVersion" TEXT NOT NULL,
  "fxSource" TEXT NOT NULL,
  "fxEffectiveDate" TIMESTAMP(3) NOT NULL,
  "usdSekRateMicros" INTEGER NOT NULL,
  "inputPriceUsdMicrosPerMillion" INTEGER NOT NULL,
  "cachedInputPriceUsdMicrosPerMillion" INTEGER NOT NULL,
  "outputPriceUsdMicrosPerMillion" INTEGER NOT NULL,
  "targetGrossMarginBps" INTEGER NOT NULL,
  "creditFloorValueOre" INTEGER NOT NULL,
  "minimumCredits" INTEGER NOT NULL,
  "estimatedInputTokens" INTEGER NOT NULL,
  "inputTokenLimit" INTEGER NOT NULL,
  "maxOutputTokens" INTEGER NOT NULL,
  "reservedCredits" INTEGER NOT NULL,
  "inputTokens" INTEGER,
  "cachedInputTokens" INTEGER,
  "outputTokens" INTEGER,
  "providerCostUsdMicros" INTEGER,
  "providerCostOre" INTEGER,
  "chargedCredits" INTEGER,
  "releasedCredits" INTEGER,
  "providerResponseId" TEXT,
  "failureCode" TEXT,
  "reservationEntryId" TEXT NOT NULL,
  "releaseEntryId" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiRunEvent" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiRunEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiRun_providerResponseId_key" ON "AiRun"("providerResponseId");
CREATE UNIQUE INDEX "AiRun_reservationEntryId_key" ON "AiRun"("reservationEntryId");
CREATE UNIQUE INDEX "AiRun_releaseEntryId_key" ON "AiRun"("releaseEntryId");
CREATE UNIQUE INDEX "AiRun_organizationId_requestKey_key" ON "AiRun"("organizationId", "requestKey");
CREATE INDEX "AiRun_organizationId_controlId_createdAt_idx" ON "AiRun"("organizationId", "controlId", "createdAt");
CREATE INDEX "AiRun_organizationId_status_createdAt_idx" ON "AiRun"("organizationId", "status", "createdAt");
CREATE INDEX "AiRun_actorId_createdAt_idx" ON "AiRun"("actorId", "createdAt");
CREATE INDEX "AiRunEvent_runId_createdAt_idx" ON "AiRunEvent"("runId", "createdAt");
CREATE INDEX "AiRunEvent_organizationId_createdAt_idx" ON "AiRunEvent"("organizationId", "createdAt");

ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_controlId_organizationId_fkey"
  FOREIGN KEY ("controlId", "organizationId") REFERENCES "Control"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_reservationEntryId_fkey"
  FOREIGN KEY ("reservationEntryId") REFERENCES "CreditEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_releaseEntryId_fkey"
  FOREIGN KEY ("releaseEntryId") REFERENCES "CreditEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiRunEvent"
  ADD CONSTRAINT "AiRunEvent_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AiRun"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiRunEvent"
  ADD CONSTRAINT "AiRunEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
