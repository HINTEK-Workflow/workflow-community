-- A company's own version of a HINTEK original (2026-09-27, decision B): the first change a company admin saves
-- to one of HINTEK's forms silently becomes the company's copy, used by that company instead of the original once it is
-- published; "Återställ till originalet" removes the copy. The copy remembers which original and which published version
-- it started from, so the editor can say when HINTEK has published a newer original. One copy per company and original.
ALTER TABLE "FormTemplate" ADD COLUMN "baseTemplateId" TEXT;
ALTER TABLE "FormTemplate" ADD COLUMN "baseVersion" INTEGER;
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_baseTemplateId_fkey" FOREIGN KEY ("baseTemplateId") REFERENCES "FormTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "FormTemplate_organizationId_baseTemplateId_key" ON "FormTemplate"("organizationId", "baseTemplateId");
