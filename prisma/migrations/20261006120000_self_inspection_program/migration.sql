-- Egenkontrollprogram, etapp 1 (2026-10-06, docs/proposals/egenkontrollprogram.md): one programme per company
-- with sections, roles and the people in them, approved versions that never change, read confirmations, yearly
-- reviews and the deviation log with its action plan. A nullable customer link is prepared for etapp 2.

-- CreateTable
CREATE TABLE "SelfInspectionProgram" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL DEFAULT 'company',
    "customerId" TEXT,
    "title" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "activityTypes" TEXT[],
    "worksOnOthersInstallations" BOOLEAN NOT NULL DEFAULT true,
    "registrationCheckedAt" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionSection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "legalRef" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "SelfInspectionSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionRole" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "duties" TEXT NOT NULL DEFAULT '',
    "isEre" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" TEXT[],
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "SelfInspectionRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionRoleMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorizationLevel" TEXT NOT NULL DEFAULT '',
    "authorizationNumber" TEXT NOT NULL DEFAULT '',
    "registered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfInspectionRoleMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionReadConfirmation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionReadConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "reviewedAt" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "versionNumber" INTEGER,
    "registrationChecked" BOOLEAN NOT NULL,
    "deviationsReviewed" BOOLEAN NOT NULL,
    "competenceFollowed" BOOLEAN NOT NULL,
    "outcome" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfInspectionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfInspectionDeviation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DEVIATION',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'ROUTINE',
    "systematic" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "action" TEXT NOT NULL DEFAULT '',
    "responsibleUserId" TEXT,
    "dueDate" TEXT NOT NULL DEFAULT '',
    "followUp" TEXT NOT NULL DEFAULT '',
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SelfInspectionDeviation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionProgram_organizationId_scopeKey_key" ON "SelfInspectionProgram"("organizationId", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionProgram_id_organizationId_key" ON "SelfInspectionProgram"("id", "organizationId");

-- CreateIndex
CREATE INDEX "SelfInspectionSection_programId_sortOrder_idx" ON "SelfInspectionSection"("programId", "sortOrder");

-- CreateIndex
CREATE INDEX "SelfInspectionRole_programId_sortOrder_idx" ON "SelfInspectionRole"("programId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionRole_id_organizationId_key" ON "SelfInspectionRole"("id", "organizationId");

-- CreateIndex
CREATE INDEX "SelfInspectionRoleMember_organizationId_userId_idx" ON "SelfInspectionRoleMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionRoleMember_roleId_userId_key" ON "SelfInspectionRoleMember"("roleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionVersion_programId_number_key" ON "SelfInspectionVersion"("programId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionVersion_id_organizationId_key" ON "SelfInspectionVersion"("id", "organizationId");

-- CreateIndex
CREATE INDEX "SelfInspectionReadConfirmation_organizationId_userId_idx" ON "SelfInspectionReadConfirmation"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionReadConfirmation_versionId_userId_key" ON "SelfInspectionReadConfirmation"("versionId", "userId");

-- CreateIndex
CREATE INDEX "SelfInspectionReview_programId_reviewedAt_idx" ON "SelfInspectionReview"("programId", "reviewedAt");

-- CreateIndex
CREATE INDEX "SelfInspectionDeviation_organizationId_status_idx" ON "SelfInspectionDeviation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SelfInspectionDeviation_organizationId_reportedById_idx" ON "SelfInspectionDeviation"("organizationId", "reportedById");

-- CreateIndex
CREATE UNIQUE INDEX "SelfInspectionDeviation_programId_number_key" ON "SelfInspectionDeviation"("programId", "number");

-- AddForeignKey
ALTER TABLE "SelfInspectionProgram" ADD CONSTRAINT "SelfInspectionProgram_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionProgram" ADD CONSTRAINT "SelfInspectionProgram_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionSection" ADD CONSTRAINT "SelfInspectionSection_programId_organizationId_fkey" FOREIGN KEY ("programId", "organizationId") REFERENCES "SelfInspectionProgram"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionRole" ADD CONSTRAINT "SelfInspectionRole_programId_organizationId_fkey" FOREIGN KEY ("programId", "organizationId") REFERENCES "SelfInspectionProgram"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionRoleMember" ADD CONSTRAINT "SelfInspectionRoleMember_roleId_organizationId_fkey" FOREIGN KEY ("roleId", "organizationId") REFERENCES "SelfInspectionRole"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionRoleMember" ADD CONSTRAINT "SelfInspectionRoleMember_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "OrganizationMember"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionVersion" ADD CONSTRAINT "SelfInspectionVersion_programId_organizationId_fkey" FOREIGN KEY ("programId", "organizationId") REFERENCES "SelfInspectionProgram"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionReadConfirmation" ADD CONSTRAINT "SelfInspectionReadConfirmation_versionId_organizationId_fkey" FOREIGN KEY ("versionId", "organizationId") REFERENCES "SelfInspectionVersion"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionReview" ADD CONSTRAINT "SelfInspectionReview_programId_organizationId_fkey" FOREIGN KEY ("programId", "organizationId") REFERENCES "SelfInspectionProgram"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfInspectionDeviation" ADD CONSTRAINT "SelfInspectionDeviation_programId_organizationId_fkey" FOREIGN KEY ("programId", "organizationId") REFERENCES "SelfInspectionProgram"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A programme linked to a customer (etapp 2) must use a customer of the same company (the shared tenant check).
CREATE TRIGGER "SelfInspectionProgram_customer_tenant" BEFORE INSERT OR UPDATE OF "customerId", "organizationId" ON "SelfInspectionProgram"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_customer_tenant"();

-- An approved version never changes; a change is a new version. Deleting is left to the erasure of a whole company.
CREATE OR REPLACE FUNCTION "self_inspection_version_unchangeable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'En fastställd version av egenkontrollprogrammet kan inte ändras.' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SelfInspectionVersion_unchangeable" BEFORE UPDATE ON "SelfInspectionVersion"
  FOR EACH ROW EXECUTE FUNCTION "self_inspection_version_unchangeable"();

