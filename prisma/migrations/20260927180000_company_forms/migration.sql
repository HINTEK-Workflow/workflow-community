-- Company forms and sharing (Daniel 2026-09-27): a form belongs to HINTEK (organizationId NULL, shown to everyone)
-- or to one company (shown only there). The publisher is stamped by the server; an imported form keeps where it came from.
ALTER TABLE "FormTemplate" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "FormTemplate" ADD COLUMN "publisherName" TEXT NOT NULL DEFAULT 'HINTEK';
ALTER TABLE "FormTemplate" ADD COLUMN "importedFrom" JSONB;
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "FormTemplate_organizationId_status_updatedAt_idx" ON "FormTemplate"("organizationId", "status", "updatedAt");

ALTER TABLE "FormTemplateVersion" ADD COLUMN "publisherName" TEXT NOT NULL DEFAULT 'HINTEK';
ALTER TABLE "FormTemplateVersion" ADD COLUMN "importedFrom" JSONB;
