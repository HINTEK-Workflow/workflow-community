ALTER TABLE "OrganizationMember" ADD COLUMN "workflowPermissions" JSONB;
ALTER TABLE "OrganizationInvitation" ADD COLUMN "workflowPermissions" JSONB;
