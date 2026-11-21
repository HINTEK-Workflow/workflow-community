-- The permission area of a form's protocols (2026-09-27, decision B): Kontroll före idrifttagning and
-- Riskbedömning built as forms keep the permission areas they have today, so a member limited for Kontroll före
-- idrifttagning stays limited when controls are protocols. Other forms use the Formulär area as before. A protocol stores
-- the area of its form when it is created; existing protocols (NULL) belong to Formulär. A company's version of an
-- original gets the original's area.
ALTER TABLE "FormTemplate" ADD COLUMN "permissionArea" TEXT NOT NULL DEFAULT 'forms';
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_permissionArea_check" CHECK ("permissionArea" IN ('forms', 'kfid', 'risk-assessment'));
ALTER TABLE "WorkflowTask" ADD COLUMN "formArea" TEXT;
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_formArea_check" CHECK ("formArea" IS NULL OR "formArea" IN ('forms', 'kfid', 'risk-assessment'));
UPDATE "FormTemplate" SET "permissionArea" = 'kfid' WHERE id = 'hintek-kontroll-fore-idrifttagning';
UPDATE "FormTemplate" SET "permissionArea" = 'risk-assessment' WHERE id = 'hintek-riskbedomning';
