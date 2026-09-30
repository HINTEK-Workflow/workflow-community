CREATE TABLE "PlannedActivityAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plannedActivityId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    CONSTRAINT "PlannedActivityAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlannedActivityAssignment_plannedActivityId_memberId_key"
ON "PlannedActivityAssignment"("plannedActivityId", "memberId");
CREATE INDEX "PlannedActivityAssignment_organizationId_memberId_plannedActivityId_idx"
ON "PlannedActivityAssignment"("organizationId", "memberId", "plannedActivityId");

ALTER TABLE "PlannedActivityAssignment" ADD CONSTRAINT "PlannedActivityAssignment_plannedActivityId_organizationId_fkey"
FOREIGN KEY ("plannedActivityId", "organizationId") REFERENCES "PlannedActivity"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlannedActivityAssignment" ADD CONSTRAINT "PlannedActivityAssignment_memberId_organizationId_fkey"
FOREIGN KEY ("memberId", "organizationId") REFERENCES "OrganizationMember"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve valid legacy single-responsible assignments. Legacy values without an
-- active membership deliberately remain display-only and consume no capacity.
INSERT INTO "PlannedActivityAssignment" ("id", "organizationId", "plannedActivityId", "memberId")
SELECT CONCAT('legacy-', "PlannedActivity"."id"), "PlannedActivity"."organizationId", "PlannedActivity"."id", "OrganizationMember"."id"
FROM "PlannedActivity"
JOIN "OrganizationMember"
  ON "OrganizationMember"."organizationId" = "PlannedActivity"."organizationId"
 AND "OrganizationMember"."userId" = "PlannedActivity"."assignedToUserId"
 AND "OrganizationMember"."isActive" = true
WHERE "PlannedActivity"."assignedToUserId" IS NOT NULL
ON CONFLICT ("plannedActivityId", "memberId") DO NOTHING;
