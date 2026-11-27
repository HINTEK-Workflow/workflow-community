-- Ställföreträdare för bokningar (2026-10-09): the project's responsible person or an admin can hand the right
-- to change other people's bookings on the project to one named member of the same company, and take it back.
-- Additive only: every existing project gets NULL (no stand-in). Nothing is rewritten or deleted.
ALTER TABLE "Project" ADD COLUMN "planningDelegateUserId" TEXT;

-- Organisation-bound: the stand-in must be a member of the project's own company. Removing that membership clears only
-- the stand-in column (column list, PostgreSQL 15+), never the project's organizationId.
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_planningDelegateUserId_fkey"
  FOREIGN KEY ("organizationId", "planningDelegateUserId") REFERENCES "OrganizationMember"("organizationId", "userId")
  ON DELETE SET NULL ("planningDelegateUserId") ON UPDATE CASCADE;
