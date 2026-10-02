-- What an AI run may be about (plan 2026-10-01, fas 2 and 4): besides a control, a conversation and a document, now
-- also a task or a project (a proposal or a text written from it) and a company's day (the nightly digest).
-- The check is widened, nothing else changes.
ALTER TABLE "AiRun" DROP CONSTRAINT "AiRun_subject_shape";
ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_subject_shape" CHECK (
    (
      "subjectType" = 'KFID_CONTROL' AND
      "controlId" IS NOT NULL AND
      "subjectId" = "controlId"
    ) OR (
      "subjectType" IN ('WORKFLOW_ASSISTANT', 'DOCUMENT', 'WORKFLOW_TASK', 'PROJECT', 'ORGANIZATION_DAY') AND
      "controlId" IS NULL
    )
  );
