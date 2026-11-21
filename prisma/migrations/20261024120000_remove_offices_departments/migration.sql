-- Kontor och avdelningar bort (2026-10-24): "Ta bort den helt, inga uppgifter behöver sparas någonstans." The
-- company's own offices and departments (Site, Department), the links from jobs and older controls (siteId,
-- departmentId) and the on/off choice (WorkspaceSettings.officeStructure) are dropped. Nothing is moved: what was saved
-- there is removed with the tables, by decision. The staff register's siteId (the building site's id number on
-- StaffRegisterEvent and in Project.staffRegister) is something else and is not touched.
ALTER TABLE "WorkflowTask" DROP CONSTRAINT IF EXISTS "WorkflowTask_departmentId_siteId_organizationId_fkey";
ALTER TABLE "WorkflowTask" DROP CONSTRAINT IF EXISTS "WorkflowTask_siteId_organizationId_fkey";
ALTER TABLE "Control" DROP CONSTRAINT IF EXISTS "Control_departmentId_siteId_organizationId_fkey";
ALTER TABLE "Control" DROP CONSTRAINT IF EXISTS "Control_siteId_organizationId_fkey";
ALTER TABLE "Control" DROP CONSTRAINT IF EXISTS "Control_department_requires_site";

DROP INDEX IF EXISTS "WorkflowTask_organizationId_siteId_departmentId_idx";
DROP INDEX IF EXISTS "Control_organizationId_siteId_departmentId_idx";

ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "departmentId";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "siteId";
ALTER TABLE "Control" DROP COLUMN IF EXISTS "departmentId";
ALTER TABLE "Control" DROP COLUMN IF EXISTS "siteId";

DROP TABLE IF EXISTS "Department";
DROP TABLE IF EXISTS "Site";

ALTER TABLE "WorkspaceSettings" DROP COLUMN IF EXISTS "officeStructure";
