ALTER TABLE "OrganizationMember" ADD COLUMN "canDeleteControls" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "ControlVisit" ("userId" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "controlId" TEXT NOT NULL, "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ControlVisit_pkey" PRIMARY KEY ("userId", "organizationId", "controlId"));
CREATE INDEX "ControlVisit_userId_organizationId_openedAt_idx" ON "ControlVisit"("userId", "organizationId", "openedAt");
