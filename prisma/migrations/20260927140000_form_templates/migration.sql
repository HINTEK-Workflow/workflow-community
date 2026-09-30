-- Forms (Daniel 2026-09-26, design v2): templates published centrally by the superadmin; protocols are WorkflowTask
-- rows of kind FORM that point to the exact, append-only template version they were created from.

CREATE TABLE "FormTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT 'green',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "draft" JSONB NOT NULL,
    "draftRevision" INTEGER NOT NULL DEFAULT 1,
    "publishedVersion" INTEGER,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FormTemplate_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED'))
);
CREATE INDEX "FormTemplate_status_updatedAt_idx" ON "FormTemplate"("status", "updatedAt");

CREATE TABLE "FormTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT 'green',
    "document" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FormTemplateVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FormTemplateVersion_templateId_version_key" ON "FormTemplateVersion"("templateId", "version");
ALTER TABLE "FormTemplateVersion" ADD CONSTRAINT "FormTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FormTemplateEvent" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FormTemplateEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FormTemplateEvent_templateId_createdAt_idx" ON "FormTemplateEvent"("templateId", "createdAt");
ALTER TABLE "FormTemplateEvent" ADD CONSTRAINT "FormTemplateEvent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowTask" ADD COLUMN "formTemplateId" TEXT, ADD COLUMN "formTemplateVersion" INTEGER;
CREATE INDEX "WorkflowTask_organizationId_formTemplateId_idx" ON "WorkflowTask"("organizationId", "formTemplateId");
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_formTemplateId_formTemplateVersion_fkey" FOREIGN KEY ("formTemplateId", "formTemplateVersion") REFERENCES "FormTemplateVersion"("templateId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A protocol always has both references; other kinds have neither.
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_form_reference_check" CHECK (
  ("kind" = 'FORM' AND "formTemplateId" IS NOT NULL AND "formTemplateVersion" IS NOT NULL)
  OR ("kind" <> 'FORM' AND "formTemplateId" IS NULL AND "formTemplateVersion" IS NULL)
);

-- Published versions are immutable: a protocol's data or PDF must never change because its template changed.
CREATE OR REPLACE FUNCTION form_template_version_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Publicerade formulärversioner kan inte ändras eller raderas.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FormTemplateVersion_immutable" BEFORE UPDATE OR DELETE ON "FormTemplateVersion"
  FOR EACH ROW EXECUTE FUNCTION form_template_version_immutable();

-- The new "Formulär" area in the member matrix: existing stored profiles get the same rights as for work orders
-- (decision 6 in the design), so nobody gains or loses access. Profiles that already name forms are left as they are.
UPDATE "OrganizationMember" m
SET "workflowPermissions" = jsonb_set(m."workflowPermissions", '{grants}', (m."workflowPermissions"->'grants') || COALESCE((
  SELECT jsonb_agg(replace(g, 'work-order:', 'forms:')) FROM jsonb_array_elements_text(m."workflowPermissions"->'grants') AS g WHERE g LIKE 'work-order:%'
), '[]'::jsonb))
WHERE m."workflowPermissions" IS NOT NULL AND jsonb_typeof(m."workflowPermissions"->'grants') = 'array'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(m."workflowPermissions"->'grants') AS g WHERE g LIKE 'forms:%');

UPDATE "OrganizationInvitation" i
SET "workflowPermissions" = jsonb_set(i."workflowPermissions", '{grants}', (i."workflowPermissions"->'grants') || COALESCE((
  SELECT jsonb_agg(replace(g, 'work-order:', 'forms:')) FROM jsonb_array_elements_text(i."workflowPermissions"->'grants') AS g WHERE g LIKE 'work-order:%'
), '[]'::jsonb))
WHERE i."workflowPermissions" IS NOT NULL AND jsonb_typeof(i."workflowPermissions"->'grants') = 'array'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(i."workflowPermissions"->'grants') AS g WHERE g LIKE 'forms:%');
