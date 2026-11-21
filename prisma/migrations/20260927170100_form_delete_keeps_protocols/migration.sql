-- Deleting a form that has protocols (2026-09-26: "Ja, ett formulär ska kunna raderas"). The form, its versions
-- and its history are deleted; every protocol keeps its own copy of the form document in its data, so its answers,
-- formulas, history and PDF stay intact. The protocol's reference to the deleted version becomes NULL.
ALTER TABLE "WorkflowTask" DROP CONSTRAINT "WorkflowTask_formTemplateId_formTemplateVersion_fkey";
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_formTemplateId_formTemplateVersion_fkey" FOREIGN KEY ("formTemplateId", "formTemplateVersion") REFERENCES "FormTemplateVersion"("templateId", "version") ON DELETE SET NULL ON UPDATE CASCADE;

-- A protocol has both references, or none once its form was deleted; other kinds never have them.
ALTER TABLE "WorkflowTask" DROP CONSTRAINT "WorkflowTask_form_reference_check";
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_form_reference_check" CHECK (
  ("kind" = 'FORM' AND (("formTemplateId" IS NOT NULL AND "formTemplateVersion" IS NOT NULL) OR ("formTemplateId" IS NULL AND "formTemplateVersion" IS NULL)))
  OR ("kind" <> 'FORM' AND "formTemplateId" IS NULL AND "formTemplateVersion" IS NULL)
);
