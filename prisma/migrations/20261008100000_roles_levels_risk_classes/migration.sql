-- Roller med nivå och riskklasser (2026-10-07, ersätter "roll per uppdrag"): every programme role has a level 1–3
-- and the company sets a risk class 1–3 per task type. A person's level is the highest among their roles; the routes
-- refuse to assign, start, fill in, complete or sign a task above it (lib/self-inspection/levels.ts). Organisation data
-- only (organizationId NOT NULL with a key to the company). Additive and safe to run again; nothing is removed – the
-- performer and inspector of older assignments stay in their columns, unused.

ALTER TABLE "SelfInspectionRole" ADD COLUMN IF NOT EXISTS "level" INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SelfInspectionRole_level_check' AND conrelid = '"SelfInspectionRole"'::regclass) THEN
    ALTER TABLE "SelfInspectionRole" ADD CONSTRAINT "SelfInspectionRole_level_check" CHECK ("level" BETWEEN 1 AND 3);
  END IF;
END $$;

-- HINTEK's proposal for the roles that came from the template (by key), where no other level has been chosen yet.
-- The other template roles (programme administrator, manager, hired, trainee) start at level 1 like every new role.
UPDATE "SelfInspectionRole"
   SET "level" = CASE "key" WHEN 'ere' THEN 3 WHEN 'inspector' THEN 3 WHEN 'planner' THEN 2 WHEN 'installer' THEN 2 ELSE "level" END
 WHERE "key" IN ('ere', 'inspector', 'planner', 'installer') AND "level" = 1;

CREATE TABLE IF NOT EXISTS "TaskRiskClass" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "riskClass" INTEGER NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskRiskClass_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskRiskClass_riskClass_check" CHECK ("riskClass" BETWEEN 1 AND 3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaskRiskClass_organizationId_key_key" ON "TaskRiskClass"("organizationId", "key");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaskRiskClass_organizationId_fkey' AND conrelid = '"TaskRiskClass"'::regclass) THEN
    ALTER TABLE "TaskRiskClass" ADD CONSTRAINT "TaskRiskClass_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
