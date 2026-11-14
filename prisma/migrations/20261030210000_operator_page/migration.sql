-- Operatörssidan och operatörskonton (2026-10-30): the company's settings for the page, operator accounts (never a
-- User), which machines each sees, their device-bound sessions, fault reports with their photos, and the product owner's
-- switch on SystemSettings. Additive only: new tables and one new column with a default. Nothing existing is changed.
-- Its own transaction: Prisma runs a file statement by statement (tests/migration-interrupted.integration.ts).
BEGIN;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "operatorPage" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "OperatorSettings" (
    "organizationId" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "causes" JSONB NOT NULL DEFAULT '[]',
    "intake" TEXT NOT NULL DEFAULT 'order',
    "inactivityMinutes" INTEGER NOT NULL DEFAULT 15,
    "microsoftEnabled" BOOLEAN NOT NULL DEFAULT false,
    "microsoftTenantId" TEXT,
    "microsoftGroupId" TEXT,
    "microsoftGroupName" TEXT NOT NULL DEFAULT '',
    "microsoftConsentAt" TIMESTAMP(3),
    "microsoftCheck" JSONB NOT NULL DEFAULT '{}',
    "aiTroubleshooting" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "OperatorSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "OperatorAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "usernameKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'password',
    "passwordHash" TEXT,
    "microsoftTenantId" TEXT,
    "microsoftObjectId" TEXT,
    "displayName" TEXT NOT NULL DEFAULT '',
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sessionsRevokedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorAccountMachine" (
    "accountId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorAccountMachine_pkey" PRIMARY KEY ("accountId","nodeId")
);

-- CreateTable
CREATE TABLE "OperatorSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "client" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "OperatorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorFaultReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT,
    "accountName" TEXT NOT NULL,
    "reporterName" TEXT NOT NULL DEFAULT '',
    "machineNodeId" TEXT NOT NULL,
    "machineLabel" TEXT NOT NULL,
    "alarmFacilityId" TEXT,
    "cause" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "taskId" TEXT,
    "workOrderLabel" TEXT NOT NULL DEFAULT '',
    "maintenanceItemId" TEXT,
    "onCall" BOOLEAN NOT NULL DEFAULT false,
    "escalationStep" INTEGER NOT NULL DEFAULT 0,
    "escalatedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorFaultReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorFaultPhoto" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorFaultPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperatorSettings_pageKey_key" ON "OperatorSettings"("pageKey");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorAccount_organizationId_usernameKey_key" ON "OperatorAccount"("organizationId", "usernameKey");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorAccount_organizationId_microsoftTenantId_microsoftO_key" ON "OperatorAccount"("organizationId", "microsoftTenantId", "microsoftObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorAccount_id_organizationId_key" ON "OperatorAccount"("id", "organizationId");

-- CreateIndex
CREATE INDEX "OperatorAccountMachine_organizationId_nodeId_idx" ON "OperatorAccountMachine"("organizationId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorSession_tokenHash_key" ON "OperatorSession"("tokenHash");

-- CreateIndex
CREATE INDEX "OperatorSession_accountId_revokedAt_idx" ON "OperatorSession"("accountId", "revokedAt");

-- CreateIndex
CREATE INDEX "OperatorSession_lastSeenAt_idx" ON "OperatorSession"("lastSeenAt");

-- CreateIndex
CREATE INDEX "OperatorFaultReport_organizationId_createdAt_idx" ON "OperatorFaultReport"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OperatorFaultReport_accountId_createdAt_idx" ON "OperatorFaultReport"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "OperatorFaultReport_organizationId_taskId_idx" ON "OperatorFaultReport"("organizationId", "taskId");

-- CreateIndex
CREATE INDEX "OperatorFaultReport_organizationId_status_idx" ON "OperatorFaultReport"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OperatorFaultReport_onCall_acknowledgedAt_idx" ON "OperatorFaultReport"("onCall", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorFaultReport_id_organizationId_key" ON "OperatorFaultReport"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorFaultPhoto_storagePath_key" ON "OperatorFaultPhoto"("storagePath");

-- CreateIndex
CREATE INDEX "OperatorFaultPhoto_organizationId_reportId_idx" ON "OperatorFaultPhoto"("organizationId", "reportId");

-- AddForeignKey
ALTER TABLE "OperatorSettings" ADD CONSTRAINT "OperatorSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorAccount" ADD CONSTRAINT "OperatorAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorAccountMachine" ADD CONSTRAINT "OperatorAccountMachine_accountId_organizationId_fkey" FOREIGN KEY ("accountId", "organizationId") REFERENCES "OperatorAccount"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorSession" ADD CONSTRAINT "OperatorSession_accountId_organizationId_fkey" FOREIGN KEY ("accountId", "organizationId") REFERENCES "OperatorAccount"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorFaultReport" ADD CONSTRAINT "OperatorFaultReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorFaultReport" ADD CONSTRAINT "OperatorFaultReport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OperatorAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorFaultPhoto" ADD CONSTRAINT "OperatorFaultPhoto_reportId_organizationId_fkey" FOREIGN KEY ("reportId", "organizationId") REFERENCES "OperatorFaultReport"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "OperatorSettings" ADD CONSTRAINT "OperatorSettings_intake_check" CHECK ("intake" IN ('order', 'approval'));
ALTER TABLE "OperatorSettings" ADD CONSTRAINT "OperatorSettings_inactivity_check" CHECK ("inactivityMinutes" BETWEEN 5 AND 720);
ALTER TABLE "OperatorAccount" ADD CONSTRAINT "OperatorAccount_kind_check" CHECK ("kind" IN ('password', 'microsoft'));
ALTER TABLE "OperatorAccount" ADD CONSTRAINT "OperatorAccount_identity_check" CHECK (
  ("kind" = 'password' AND "microsoftObjectId" IS NULL) OR ("kind" = 'microsoft' AND "microsoftTenantId" IS NOT NULL AND "microsoftObjectId" IS NOT NULL AND "passwordHash" IS NULL));
ALTER TABLE "OperatorSession" ADD CONSTRAINT "OperatorSession_method_check" CHECK ("method" IN ('password', 'microsoft'));
ALTER TABLE "OperatorFaultReport" ADD CONSTRAINT "OperatorFaultReport_severity_check" CHECK ("severity" IN ('LOW', 'NORMAL', 'HIGH', 'ACUTE'));
ALTER TABLE "OperatorFaultReport" ADD CONSTRAINT "OperatorFaultReport_status_check" CHECK ("status" IN ('received', 'pending', 'rejected'));

-- The report's account is SET NULL on the id only (the report stays when the account goes); the database itself refuses an
-- account from another company (tests/tenant-schema.test.ts lists it with this protection).
CREATE OR REPLACE FUNCTION "operator_assert_account_tenant"() RETURNS trigger AS $$
BEGIN
  IF NEW."accountId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."accountId" IS DISTINCT FROM OLD."accountId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") AND NOT EXISTS (
    SELECT 1 FROM "OperatorAccount" WHERE "id" = NEW."accountId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Operatörskontot tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "OperatorFaultReport_account_tenant" BEFORE INSERT OR UPDATE OF "accountId", "organizationId" ON "OperatorFaultReport"
  FOR EACH ROW EXECUTE FUNCTION "operator_assert_account_tenant"();

COMMIT;
