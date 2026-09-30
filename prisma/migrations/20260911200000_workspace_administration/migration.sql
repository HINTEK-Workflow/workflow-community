-- AlterTable
ALTER TABLE "WorkspaceSettings" ADD COLUMN     "profile" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "AdministrationEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdministrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdministrationEvent_organizationId_createdAt_idx" ON "AdministrationEvent"("organizationId", "createdAt");

