ALTER TABLE "Organization" ADD COLUMN "weeklyWorkMinutes" INTEGER NOT NULL DEFAULT 2400;
ALTER TABLE "OrganizationMember" ADD COLUMN "weeklyWorkMinutes" INTEGER;

ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_id_organizationId_key" UNIQUE ("id", "organizationId");

CREATE TABLE "WorkScheduleEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "memberId" TEXT,
  "scope" TEXT NOT NULL,
  "previousMinutes" INTEGER,
  "nextMinutes" INTEGER,
  "actorName" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkScheduleEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkScheduleEvent_organizationId_createdAt_idx" ON "WorkScheduleEvent"("organizationId", "createdAt");
CREATE INDEX "WorkScheduleEvent_organizationId_memberId_createdAt_idx" ON "WorkScheduleEvent"("organizationId", "memberId", "createdAt");

ALTER TABLE "WorkScheduleEvent" ADD CONSTRAINT "WorkScheduleEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkScheduleEvent" ADD CONSTRAINT "WorkScheduleEvent_memberId_organizationId_fkey" FOREIGN KEY ("memberId", "organizationId") REFERENCES "OrganizationMember"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
